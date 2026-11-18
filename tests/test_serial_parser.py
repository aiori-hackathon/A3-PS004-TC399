import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "tools"))
from serial_to_dashboard import parse_serial_line, build_telemetry_payload


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

    def test_parses_tls_handshake_with_cpu_and_heap(self):
        self.assertEqual(
            parse_serial_line(
                "TLS_HANDSHAKE_OK,handshake_ms=123,free_heap=45678,CPU=23.4%,HEAP=124000/320000"
            ),
            {
                "kind": "tls_handshake",
                "latency_ms": 123,
                "free_heap": 45678,
                "cpu_percent": 23.4,
                "ram_used_bytes": 124000,
                "ram_total_bytes": 320000,
                "free_heap_bytes": 45678,
            },
        )

    def test_parses_line_with_monitor_timestamp_prefix(self):
        self.assertEqual(
            parse_serial_line(
                "01:47:10.231 > TLS_HANDSHAKE_OK,handshake_ms=869,free_heap=182340,CPU=9.7%,HEAP=146528/328868"
            ),
            {
                "kind": "tls_handshake",
                "latency_ms": 869,
                "free_heap": 182340,
                "cpu_percent": 9.7,
                "ram_used_bytes": 146528,
                "ram_total_bytes": 328868,
                "free_heap_bytes": 182340,
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

    def test_parses_dns_result_with_cpu_and_heap(self):
        self.assertEqual(
            parse_serial_line(
                "RESULT,valid.aegis.test,NOERROR,rcode=0,AD=1,"
                "id_match=1,latency_ms=12.50,free_heap=32000,CPU=15.8%,HEAP=138000/320000"
            ),
            {
                "kind": "dns_result",
                "query": "valid.aegis.test",
                "rcode": "NOERROR",
                "ad": True,
                "id_match": True,
                "latency_ms": 12.5,
                "free_heap": 32000,
                "cpu_percent": 15.8,
                "ram_used_bytes": 138000,
                "ram_total_bytes": 320000,
                "free_heap_bytes": 32000,
            },
        )

    def test_parses_standalone_cpu_and_heap(self):
        self.assertEqual(
            parse_serial_line("CPU=18.5%,HEAP=125000/320000"),
            {
                "kind": "serial_status",
                "connected": True,
                "port": "serial",
                "cpu_percent": 18.5,
                "ram_used_bytes": 125000,
                "ram_total_bytes": 320000,
                "free_heap_bytes": 195000,
                "free_heap": 195000,
            },
        )

    def test_build_telemetry_payload_with_hardware_fields(self):
        event = {
            "kind": "dns_result",
            "latency_ms": 14.5,
            "free_heap": 32000,
            "cpu_percent": 25.4,
            "ram_used_bytes": 130000,
            "ram_total_bytes": 320000,
            "free_heap_bytes": 32000,
        }
        payload = build_telemetry_payload(event, device_id="esp32-node-1")
        self.assertEqual(payload["schemaVersion"], 2)
        self.assertEqual(payload["deviceId"], "esp32-node-1")
        self.assertEqual(payload["cpu_percent"], 25.4)
        self.assertEqual(payload["ram_used_bytes"], 130000)
        self.assertEqual(payload["ram_total_bytes"], 320000)
        self.assertEqual(payload["free_heap_bytes"], 32000)

    def test_non_matching_line_returns_none(self):
        self.assertIsNone(parse_serial_line("Wi-Fi connected"))


if __name__ == "__main__":
    unittest.main()
