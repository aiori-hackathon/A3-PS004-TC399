import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_PATH = ROOT / "src" / "scripts" / "benchmark_gateway.py"
SPEC = importlib.util.spec_from_file_location("benchmark_gateway", BENCHMARK_PATH)
benchmark_gateway = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = benchmark_gateway
SPEC.loader.exec_module(benchmark_gateway)


class BenchmarkHelpersTests(unittest.TestCase):
    def test_summary_reports_median_and_nearest_rank_p95(self):
        result = benchmark_gateway.summarize([
            {"latency_ms": 10.0},
            {"latency_ms": 20.0},
            {"latency_ms": 30.0},
            {"latency_ms": 40.0},
            {"latency_ms": 50.0},
        ])

        self.assertEqual(result, {
            "samples": 5,
            "median_ms": 30.0,
            "p95_ms": 50.0,
            "min_ms": 10.0,
            "max_ms": 50.0,
        })

    def test_query_requests_dnssec_and_ad_data(self):
        query = benchmark_gateway.build_query("valid.aegis.test.", 1234)

        self.assertEqual(query.id, 1234)
        self.assertTrue(query.flags & benchmark_gateway.dns.flags.AD)
        self.assertTrue(query.ednsflags & benchmark_gateway.dns.flags.DO)

    def test_gateway_error_response_is_not_reported_as_secure(self):
        response = benchmark_gateway.dns.message.make_response(
            benchmark_gateway.build_query("bogus.aegis.test.", 1235)
        )
        response.set_rcode(benchmark_gateway.dns.rcode.SERVFAIL)

        result = benchmark_gateway.response_result(response, 12.0)

        self.assertEqual(result["rcode"], "SERVFAIL")
        self.assertEqual(result["status"], "ERROR")
        self.assertFalse(result["ad"])

    def test_unauthenticated_path_is_not_cache_warmed(self):
        self.assertEqual(
            benchmark_gateway.SCENARIOS[-1]["transport"],
            "unauthenticated_tls",
        )


if __name__ == "__main__":
    unittest.main()
