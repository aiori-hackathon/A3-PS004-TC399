import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "scripts"))
sys.path.insert(0, str(ROOT / "src" / "tools"))

import latency_baseline
import serial_to_dashboard
import test_gateway


class TestExpectationModelTests(unittest.TestCase):
    def test_matches_scenarios_and_records_mismatches_without_raising(self):
        wire_results = [
            {"domain": "valid.aegis.test", "status": "SECURE", "rcode": 0, "AD": True, "latency_ms": 10.0},
            {"domain": "bogus.aegis.test", "status": "SERVFAIL", "rcode": 2, "AD": False, "latency_ms": 12.0},
            {"domain": "insecure.aegis.test", "status": "INSECURE", "rcode": 0, "AD": False, "latency_ms": 9.0},
            {"domain": "valid.aegis.test", "status": "REFUSED", "rcode": 5, "AD": False, "latency_ms": 4.0},
        ]
        real_metrics = [
            {"id": "1", "query": "valid.aegis.test.", "status": "SECURE", "latency_ms": 4.5, "deviceId": "esp32-client"},
            # Deliberate mismatch: ERROR instead of BOGUS (e.g. EDE missing)
            {"id": "2", "query": "bogus.aegis.test.", "status": "ERROR", "latency_ms": 6.1, "deviceId": "esp32-client"},
            {"id": "3", "query": "insecure.aegis.test.", "status": "INSECURE", "latency_ms": 3.9, "deviceId": "esp32-client"},
            {"id": "4", "query": "valid.aegis.test.", "status": "BLOCKED_CD", "latency_ms": 1.2, "deviceId": "esp32-client"},
        ]

        records = test_gateway.build_test_run_records(
            run_id="run-abc",
            started_at="2026-11-18T12:00:00+00:00",
            scenarios=test_gateway.TEST_SCENARIOS,
            wire_results=wire_results,
            new_metrics=real_metrics,
        )

        self.assertEqual(len(records), 4)
        self.assertTrue(records[0]["passed"])
        self.assertEqual(records[0]["expectedStatus"], "SECURE")
        self.assertEqual(records[0]["observedStatus"], "SECURE")

        # Mismatch is captured cleanly as passed=False
        self.assertFalse(records[1]["passed"])
        self.assertEqual(records[1]["expectedStatus"], "BOGUS")
        self.assertEqual(records[1]["observedStatus"], "ERROR")

        self.assertTrue(records[2]["passed"])
        self.assertTrue(records[3]["passed"])
        self.assertEqual(records[3]["observedStatus"], "BLOCKED_CD")


class LatencyBaselineTests(unittest.TestCase):
    def test_skips_when_below_min_samples(self):
        metrics = [
            {"id": str(i), "deviceId": "esp32-1", "query": "valid.aegis.test.", "latency_ms": 5.0 + i * 0.1}
            for i in range(5)
        ]
        report = latency_baseline.compute_baselines(metrics, min_samples=10)
        self.assertEqual(report["by_device"], {})
        self.assertEqual(report["skipped"]["devices_below_min_samples"]["esp32-1"], 5)

    def test_computes_median_p95_and_flags_statistical_outlier(self):
        # 11 normal observations around 10 ms + 1 clear statistical outlier at 250 ms
        values = [9.5, 9.8, 10.0, 10.1, 10.2, 10.0, 9.9, 10.3, 9.7, 10.1, 10.0, 250.0]
        metrics = [
            {
                "id": f"m{i}",
                "timestamp": f"2026-11-18T12:00:{i:02d}Z",
                "deviceId": "esp32-1",
                "query": "valid.aegis.test.",
                "latency_ms": v,
            }
            for i, v in enumerate(values)
        ]
        report = latency_baseline.compute_baselines(metrics, min_samples=10, z_threshold=3.5)
        dev = report["by_device"]["esp32-1"]
        self.assertEqual(dev["count"], 12)
        self.assertAlmostEqual(dev["median_ms"], 10.0, places=2)
        self.assertEqual(dev["outlier_count"], 1)
        self.assertEqual(dev["outliers"][0]["id"], "m11")
        self.assertEqual(dev["outliers"][0]["label"], "statistical outlier")


class SerialBridgeContractTests(unittest.TestCase):
    def test_build_telemetry_payload_adds_schema_version_and_real_numbers(self):
        parsed = serial_to_dashboard.parse_serial_line(
            "RESULT,valid.aegis.test,NOERROR,rcode=0,AD=1,"
            "id_match=1,latency_ms=14.75,free_heap=41200"
        )
        payload = serial_to_dashboard.build_telemetry_payload(parsed)
        self.assertEqual(payload["schemaVersion"], 2)
        self.assertEqual(payload["deviceId"], "unknown")
        self.assertIsInstance(payload["latency_ms"], float)
        self.assertIsInstance(payload["free_heap"], int)
        self.assertNotIsInstance(payload["latency_ms"], str)
        self.assertNotIsInstance(payload["free_heap"], str)

    def test_build_telemetry_payload_uses_explicit_device_id(self):
        payload = serial_to_dashboard.build_telemetry_payload(
            {"kind": "tls_handshake", "latency_ms": 120, "free_heap": 45000},
            device_id="esp32-client",
        )
        self.assertEqual(payload["deviceId"], "esp32-client")
        self.assertEqual(payload["schemaVersion"], 2)


if __name__ == "__main__":
    unittest.main()
