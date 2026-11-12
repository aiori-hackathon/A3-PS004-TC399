import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import dns.edns
import dns.flags
import dns.message
import dns.rcode
import dns.rrset

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "gateway"))
import gateway


def make_response(rcode: int, authenticated: bool = False, ede_code=None):
    query = dns.message.make_query("example.test.", "A")
    response = dns.message.make_response(query)
    response.set_rcode(rcode)
    if authenticated:
        response.flags |= dns.flags.AD
    if ede_code is not None:
        response.use_edns(
            options=[dns.edns.EDEOption(ede_code, "test EDE detail")]
        )
    return query, response


class ClassifyResponseTests(unittest.TestCase):
    def test_secure_response(self):
        _, response = make_response(dns.rcode.NOERROR, authenticated=True)
        self.assertEqual(gateway.classify_response(response), "SECURE")

    def test_insecure_response(self):
        _, response = make_response(dns.rcode.NOERROR)
        self.assertEqual(gateway.classify_response(response), "INSECURE")

    def test_dnssec_bogus_servfail(self):
        _, response = make_response(
            dns.rcode.SERVFAIL,
            ede_code=dns.edns.EDECode.DNSSEC_BOGUS,
        )
        self.assertEqual(gateway.classify_response(response), "BOGUS")

    def test_other_upstream_failures_are_errors(self):
        _, servfail = make_response(dns.rcode.SERVFAIL)
        _, refused = make_response(dns.rcode.REFUSED)
        self.assertEqual(gateway.classify_response(servfail), "ERROR")
        self.assertEqual(gateway.classify_response(refused), "ERROR")


class ProcessPolicyTests(unittest.TestCase):
    def test_secure_and_insecure_responses_pass_through(self):
        for rcode, authenticated, expected in (
            (dns.rcode.NOERROR, True, "SECURE"),
            (dns.rcode.NOERROR, False, "INSECURE"),
        ):
            with self.subTest(expected=expected):
                query, upstream = make_response(rcode, authenticated)
                response, status = gateway.process_policy(query, upstream)
                self.assertIs(response, upstream)
                self.assertEqual(status, expected)

    def test_bogus_response_is_replaced_with_empty_servfail(self):
        query, upstream = make_response(
            dns.rcode.SERVFAIL,
            ede_code=dns.edns.EDECode.DNSSEC_BOGUS,
        )
        upstream.answer.append(
            dns.rrset.from_text(
                "example.test.", 60, "IN", "A", "192.0.2.1"
            )
        )

        response, status = gateway.process_policy(query, upstream)

        self.assertEqual(status, "BOGUS")
        self.assertEqual(response.rcode(), dns.rcode.SERVFAIL)
        self.assertFalse(response.answer)
        self.assertFalse(response.flags & dns.flags.AD)


class PublishMetricsTests(unittest.IsolatedAsyncioTestCase):
    async def test_publish_metrics_sends_shared_dashboard_token(self):
        class ResponseContext:
            status = 202

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc_value, traceback):
                return False

        class SessionStub:
            def post(self, *_args, **kwargs):
                self.kwargs = kwargs
                return ResponseContext()

        session = SessionStub()
        with patch.object(gateway, "DASHBOARD_API_TOKEN", "test-token"):
            await gateway.publish_metrics(session, {})

        self.assertEqual(
            session.kwargs["headers"],
            {"X-Dashboard-Token": "test-token"},
        )


class ProcessQueryTests(unittest.IsolatedAsyncioTestCase):
    async def run_query(
        self,
        query_wire: bytes,
        resolver_side_effect=None,
        tcp_side_effect=None,
    ):
        published = []

        async def record_metric(_session, payload):
            published.append(payload)

        def resolver_mock(result):
            if isinstance(result, BaseException) or (
                isinstance(result, type)
                and issubclass(result, BaseException)
            ):
                return AsyncMock(side_effect=result)
            return AsyncMock(return_value=result)

        with (
            patch.object(
                gateway.dns.asyncquery,
                "udp",
                new=resolver_mock(resolver_side_effect),
            ) as resolver_query,
            patch.object(
                gateway.dns.asyncquery,
                "tcp",
                new=resolver_mock(tcp_side_effect),
            ) as tcp_query,
            patch.object(gateway, "publish_metrics", new=record_metric),
            patch.object(gateway, "cpu_percent", return_value=0.0),
        ):
            response_wire = await gateway.process_query(
                query_wire, session=None, client="test-client"
            )
            await asyncio.sleep(0)

        self.assertEqual(len(published), 1)
        return response_wire, published[0], resolver_query, tcp_query

    async def test_cpu_sampler_is_primed_before_measurement_interval(self):
        with (
            patch.object(gateway.psutil, "cpu_percent") as cpu_percent,
            patch.object(
                gateway.asyncio, "sleep", new=AsyncMock()
            ) as sleep,
        ):
            await gateway.prime_cpu_percent()

        cpu_percent.assert_called_once_with(interval=None)
        sleep.assert_awaited_once_with(gateway.CPU_PERCENT_INTERVAL)

    def test_cpu_percent_uses_module_sampler(self):
        with patch.object(
            gateway.psutil, "cpu_percent", return_value=17.5
        ) as cpu_percent:
            self.assertEqual(gateway.cpu_percent(), 17.5)

        cpu_percent.assert_called_once_with(interval=None)

    async def test_malformed_packet_is_rejected(self):
        response_wire, metric, resolver_query, tcp_query = await self.run_query(
            b"\x00"
        )

        self.assertEqual(response_wire, b"")
        self.assertEqual(metric["status"], "ERROR")
        resolver_query.assert_not_awaited()
        tcp_query.assert_not_awaited()

    async def test_cd_query_is_refused_without_resolver_request(self):
        query = dns.message.make_query("example.test.", "A")
        query.flags |= dns.flags.CD

        response_wire, metric, resolver_query, tcp_query = await self.run_query(
            query.to_wire()
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.rcode(), dns.rcode.REFUSED)
        self.assertEqual(metric["status"], "BLOCKED_CD")
        resolver_query.assert_not_awaited()
        tcp_query.assert_not_awaited()

    async def test_resolver_timeout_returns_servfail_and_records_error(self):
        query = dns.message.make_query("example.test.", "A")

        response_wire, metric, resolver_query, tcp_query = await self.run_query(
            query.to_wire(), resolver_side_effect=dns.exception.Timeout
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.rcode(), dns.rcode.SERVFAIL)
        self.assertEqual(metric["status"], "ERROR")
        resolver_query.assert_awaited_once()
        tcp_query.assert_not_awaited()

    async def test_truncated_udp_retries_over_tcp_with_timeout(self):
        query = dns.message.make_query("example.test.", "A")
        _, truncated = make_response(dns.rcode.NOERROR)
        truncated.flags |= dns.flags.TC
        _, tcp_response = make_response(
            dns.rcode.NOERROR, authenticated=True
        )

        response_wire, metric, udp_query, tcp_query = await self.run_query(
            query.to_wire(),
            resolver_side_effect=truncated,
            tcp_side_effect=tcp_response,
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.flags & dns.flags.TC, 0)
        self.assertTrue(response.flags & dns.flags.AD)
        self.assertEqual(metric["status"], "SECURE")
        udp_query.assert_awaited_once()
        tcp_query.assert_awaited_once()
        self.assertIs(
            udp_query.await_args.args[0],
            tcp_query.await_args.args[0],
        )
        self.assertEqual(tcp_query.await_args.kwargs["timeout"], 3.0)

    async def test_tcp_retry_failure_returns_error_not_truncated_verdict(self):
        query = dns.message.make_query("example.test.", "A")
        _, truncated = make_response(
            dns.rcode.NOERROR, authenticated=True
        )
        truncated.flags |= dns.flags.TC

        response_wire, metric, _, tcp_query = await self.run_query(
            query.to_wire(),
            resolver_side_effect=truncated,
            tcp_side_effect=dns.exception.Timeout,
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.rcode(), dns.rcode.SERVFAIL)
        self.assertFalse(response.flags & dns.flags.AD)
        self.assertEqual(metric["status"], "ERROR")
        tcp_query.assert_awaited_once()

    async def test_truncated_tcp_response_returns_error(self):
        query = dns.message.make_query("example.test.", "A")
        _, truncated = make_response(
            dns.rcode.NOERROR, authenticated=True
        )
        truncated.flags |= dns.flags.TC

        response_wire, metric, _, _ = await self.run_query(
            query.to_wire(),
            resolver_side_effect=truncated,
            tcp_side_effect=truncated,
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.rcode(), dns.rcode.SERVFAIL)
        self.assertFalse(response.flags & dns.flags.AD)
        self.assertEqual(metric["status"], "ERROR")


if __name__ == "__main__":
    unittest.main()
