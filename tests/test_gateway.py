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


class ProcessQueryTests(unittest.IsolatedAsyncioTestCase):
    async def run_query(self, query_wire: bytes, resolver_side_effect=None):
        published = []

        async def record_metric(_session, payload):
            published.append(payload)

        with (
            patch.object(
                gateway.dns.asyncquery,
                "udp",
                new=AsyncMock(side_effect=resolver_side_effect),
            ) as resolver_query,
            patch.object(gateway, "publish_metrics", new=record_metric),
            patch.object(gateway, "cpu_percent", return_value=0.0),
        ):
            response_wire = await gateway.process_query(
                query_wire, session=None, client="test-client"
            )
            await asyncio.sleep(0)

        self.assertEqual(len(published), 1)
        return response_wire, published[0], resolver_query

    async def test_malformed_packet_is_rejected(self):
        response_wire, metric, resolver_query = await self.run_query(b"\x00")

        self.assertEqual(response_wire, b"")
        self.assertEqual(metric["status"], "ERROR")
        resolver_query.assert_not_awaited()

    async def test_cd_query_is_refused_without_resolver_request(self):
        query = dns.message.make_query("example.test.", "A")
        query.flags |= dns.flags.CD

        response_wire, metric, resolver_query = await self.run_query(
            query.to_wire()
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.rcode(), dns.rcode.REFUSED)
        self.assertEqual(metric["status"], "BLOCKED_CD")
        resolver_query.assert_not_awaited()

    async def test_resolver_timeout_returns_servfail_and_records_error(self):
        query = dns.message.make_query("example.test.", "A")

        response_wire, metric, resolver_query = await self.run_query(
            query.to_wire(), resolver_side_effect=dns.exception.Timeout
        )

        response = dns.message.from_wire(response_wire)
        self.assertEqual(response.rcode(), dns.rcode.SERVFAIL)
        self.assertEqual(metric["status"], "ERROR")
        resolver_query.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
