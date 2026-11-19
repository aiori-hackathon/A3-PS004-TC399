"""Unit tests for the Gateway Network Intelligence layer."""

import tempfile
import unittest
from pathlib import Path

import dns.message
import dns.rcode
import dns.rrset

from src.apnic.database import APNICDatabase
from src.apnic.parser import DatasetHeader, ParsedDataset, ResourceRecord
from src.gateway.network_intelligence import NetworkIntelligence


class NetworkIntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_intel.db"
        self.db = APNICDatabase(self.db_path)
        self.db.initialize_schema()

        # Seed sample data
        v4_start, v4_end = 16777216, 16777216 + 255
        v6_start, v6_end = 42540528726795050063891204319802818560, 42540528736698570378174246518995812351
        records = [
            ResourceRecord(
                registry="apnic",
                country_code="AU",
                resource_type="ipv4",
                start="1.0.0.0",
                value="256",
                date="20110811",
                status="assigned",
                extensions="",
                start_num=v4_start,
                end_num=v4_end,
            ),
            ResourceRecord(
                registry="apnic",
                country_code="JP",
                resource_type="ipv6",
                start="2001:200::",
                value="35",
                date="19990813",
                status="allocated",
                extensions="",
                start_num=v6_start,
                end_num=v6_end,
            ),
            ResourceRecord(
                registry="apnic",
                country_code="SG",
                resource_type="asn",
                start="997",
                value="1",
                date="20220628",
                status="allocated",
                extensions="",
                start_num=997,
                end_num=997,
            ),
        ]
        ds = ParsedDataset(
            header=DatasetHeader("2", "apnic", "20261119", 3, "19830613", "20261118", "+1000"),
            records=records,
            total_parsed=3,
        )
        self.db.import_dataset(ds, sha256="test", signature_verified=False)
        self.intel = NetworkIntelligence(db_path=self.db_path)

    def tearDown(self):
        try:
            self.temp_dir.cleanup()
        except OSError:
            pass

    def test_ipv4_lookup_returns_expected_metadata(self):
        res = self.intel.lookup_ip("1.0.0.10")
        self.assertEqual(res["status"], "available")
        self.assertTrue(res["found"])
        self.assertEqual(res["country_code"], "AU")
        self.assertEqual(res["registry"], "apnic")
        self.assertEqual(res["allocation_status"], "assigned")

    def test_ipv6_lookup_returns_expected_metadata(self):
        res = self.intel.lookup_ip("2001:200:1000::1")
        self.assertEqual(res["status"], "available")
        self.assertTrue(res["found"])
        self.assertEqual(res["country_code"], "JP")
        self.assertEqual(res["registry"], "apnic")

    def test_unknown_ip_returns_not_found(self):
        # 8.8.8.8 is ARIN (not APNIC)
        res = self.intel.lookup_ip("8.8.8.8")
        self.assertEqual(res["status"], "available")
        self.assertFalse(res["found"])

    def test_missing_database_returns_unavailable(self):
        non_existent = Path(self.temp_dir.name) / "does_not_exist.db"
        intel_missing = NetworkIntelligence(db_path=non_existent)
        res = intel_missing.lookup_ip("1.0.0.1")
        self.assertEqual(res["status"], "unavailable")
        self.assertFalse(res["found"])

    def test_dns_message_enrichment_does_not_alter_response_or_verdict(self):
        # Create a mock DNS response with A and AAAA records, and AD bit set
        query = dns.message.make_query("secure.aegis.test.", "A")
        response = dns.message.make_response(query)
        response.flags |= dns.flags.AD  # DNSSEC validated
        response.answer.append(
            dns.rrset.from_text("secure.aegis.test.", 60, "IN", "A", "1.0.0.1")
        )
        response.answer.append(
            dns.rrset.from_text("secure.aegis.test.", 60, "IN", "AAAA", "2001:200:1000::1")
        )

        wire_before = response.to_wire()
        ad_bit_before = bool(response.flags & dns.flags.AD)
        rcode_before = response.rcode()

        enrichments = self.intel.extract_answers_and_enrich(response)
        self.assertEqual(len(enrichments), 2)
        self.assertTrue(enrichments[0]["found"])
        self.assertEqual(enrichments[0]["country_code"], "AU")
        self.assertTrue(enrichments[1]["found"])
        self.assertEqual(enrichments[1]["country_code"], "JP")

        # Verify DNS message wire format, AD bit, and rcode are 100% byte-for-byte IDENTICAL
        self.assertEqual(response.to_wire(), wire_before)
        self.assertEqual(bool(response.flags & dns.flags.AD), ad_bit_before)
        self.assertTrue(bool(response.flags & dns.flags.AD))
        self.assertEqual(response.rcode(), rcode_before)

    def test_enrichment_when_db_missing_preserves_wire_and_does_not_raise(self):
        non_existent = Path(self.temp_dir.name) / "missing_gateway.db"
        intel_missing = NetworkIntelligence(db_path=non_existent)
        self.assertFalse(intel_missing.is_available())

        query = dns.message.make_query("secure.aegis.test.", "A")
        response = dns.message.make_response(query)
        response.flags |= dns.flags.AD
        response.answer.append(
            dns.rrset.from_text("secure.aegis.test.", 60, "IN", "A", "1.0.0.1")
        )

        wire_before = response.to_wire()
        enrichments = intel_missing.extract_answers_and_enrich(response)

        # Returns graceful unavailable status without failing or mutating wire
        self.assertEqual(len(enrichments), 1)
        self.assertEqual(enrichments[0]["status"], "unavailable")
        self.assertFalse(enrichments[0]["found"])
        self.assertEqual(response.to_wire(), wire_before)
        self.assertTrue(bool(response.flags & dns.flags.AD))


if __name__ == "__main__":
    unittest.main()
