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
            {"latency_ms": 10.0, "success": True, "dnssec_verdict": "SECURE"},
            {"latency_ms": 20.0, "success": True, "dnssec_verdict": "SECURE"},
            {"latency_ms": 30.0, "success": True, "dnssec_verdict": "SECURE"},
            {"latency_ms": 40.0, "success": False, "dnssec_verdict": "ERROR"},
            {"latency_ms": 50.0, "success": False, "dnssec_verdict": "ERROR"},
        ])

        self.assertEqual(result["samples"], 5)
        self.assertEqual(result["sample_count"], 5)
        self.assertEqual(result["success_count"], 3)
        self.assertEqual(result["failure_count"], 2)
        self.assertEqual(result["median_ms"], 30.0)
        self.assertEqual(result["p95_ms"], 50.0)
        self.assertEqual(result["min_ms"], 10.0)
        self.assertEqual(result["max_ms"], 50.0)
        self.assertEqual(result["dnssec_verdict"], "MIXED")
        self.assertEqual(
            result["dnssec_verdict_counts"],
            {"SECURE": 3, "ERROR": 2},
        )

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
        self.assertEqual(result["dnssec_verdict"], "ERROR")
        self.assertFalse(result["ad"])

    def test_dnssec_bogus_verdict_requires_matching_ede(self):
        response = benchmark_gateway.dns.message.make_response(
            benchmark_gateway.build_query("bogus.aegis.test.", 1236)
        )
        response.set_rcode(benchmark_gateway.dns.rcode.SERVFAIL)
        response.use_edns(
            edns=0,
            options=[
                benchmark_gateway.dns.edns.EDEOption(
                    benchmark_gateway.dns.edns.EDECode.DNSSEC_BOGUS,
                    "signature verification failed",
                )
            ],
        )

        result = benchmark_gateway.response_result(response, 12.0)

        self.assertEqual(result["dnssec_verdict"], "BOGUS")

    def test_unauthenticated_path_is_not_cache_warmed(self):
        self.assertEqual(
            benchmark_gateway.SCENARIOS[-1]["transport"],
            "unauthenticated_tls",
        )


if __name__ == "__main__":
    unittest.main()
