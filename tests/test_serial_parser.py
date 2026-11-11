import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "tools"))
from serial_to_dashboard import parse_serial_line


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


if __name__ == "__main__":
    unittest.main()
