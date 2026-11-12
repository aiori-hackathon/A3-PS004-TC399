import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "tools"))
import serial_to_dashboard

parse_serial_line = serial_to_dashboard.parse_serial_line


class ParseSerialLineTests(unittest.TestCase):
    def test_parses_tls_handshake(self):
        self.assertEqual(
            parse_serial_line(
                "TLS_HANDSHAKE_OK,handshake_ms=123,free_heap=45678"
            ),
            {
                "kind": "tls_handshake",
                "latency_ms": 123,
                "free_heap": 45678,
            },
        )

    def test_parses_dns_result(self):
        self.assertEqual(
            parse_serial_line(
                "RESULT,valid.aegis.test,NOERROR,rcode=0,AD=1,"
                "id_match=1,latency_ms=12.50,free_heap=32000"
            ),
            {
                "kind": "dns_result",
                "query": "valid.aegis.test",
                "rcode": "NOERROR",
                "ad": True,
                "id_match": True,
                "latency_ms": 12.5,
                "free_heap": 32000,
            },
        )

    def test_non_matching_line_returns_none(self):
        self.assertIsNone(parse_serial_line("Wi-Fi connected"))


class PostEventTests(unittest.TestCase):
    def test_posts_shared_dashboard_token_header(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 202
        with (
            patch.dict(os.environ, {"DASHBOARD_API_TOKEN": "test-token"}),
            patch.object(
                serial_to_dashboard, "urlopen", return_value=response
            ) as urlopen,
        ):
            serial_to_dashboard.post_event(
                "http://localhost:3000",
                {"kind": "tls_failure", "error": "test"},
            )

        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.get_header("X-dashboard-token"),
            "test-token",
        )

    def test_requires_shared_dashboard_token(self):
        with (
            patch.dict(os.environ, {"DASHBOARD_API_TOKEN": ""}),
            self.assertRaisesRegex(RuntimeError, "DASHBOARD_API_TOKEN"),
        ):
            serial_to_dashboard.post_event(
                "http://localhost:3000",
                {"kind": "tls_failure", "error": "test"},
            )


if __name__ == "__main__":
    unittest.main()
