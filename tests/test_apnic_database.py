"""Unit tests for the APNIC SQLite database storage."""

import tempfile
import unittest
from pathlib import Path

from src.apnic.database import APNICDatabase
from src.apnic.parser import DatasetHeader, ParsedDataset, ResourceRecord


class APNICDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_apnic.db"
        self.db = APNICDatabase(self.db_path)

        # Build sample dataset
        self.header = DatasetHeader(
            version="2",
            registry="apnic",
            serial="20261119",
            records=3,
            startdate="19830613",
            enddate="20261118",
            utc_offset="+1000",
        )
        v4_start, v4_end = 16777216, 16777216 + 255
        v6_start, v6_end = 42540528726795050063891204319802818560, 42540528736698570378174246518995812351
        asn_start, asn_end = 997, 997

        self.records = [
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
                start_num=asn_start,
                end_num=asn_end,
            ),
        ]
        self.dataset = ParsedDataset(
            header=self.header,
            records=self.records,
            total_parsed=3,
        )

    def tearDown(self):
        try:
            self.temp_dir.cleanup()
        except OSError:
            pass

    def test_database_initialization_and_schema(self):
        self.db.initialize_schema()
        self.assertTrue(self.db_path.exists())
        health = self.db.health_check()
        self.assertTrue(health["healthy"])
        self.assertEqual(health["integrity"], "ok")

    def test_import_and_metadata_retrieval(self):
        self.db.initialize_schema()
        self.db.import_dataset(
            self.dataset,
            sha256="abcdef1234567890",
            signature_verified=True,
            source_file="delegated-apnic-test",
        )

        meta = self.db.get_latest_metadata()
        self.assertIsNotNone(meta)
        self.assertEqual(meta["dataset_serial"], "20261119")
        self.assertEqual(meta["record_count"], 3)
        self.assertEqual(meta["sha256"], "abcdef1234567890")
        self.assertEqual(meta["signature_verified"], 1)

    def test_ipv4_lookup(self):
        self.db.initialize_schema()
        self.db.import_dataset(self.dataset, sha256="test", signature_verified=False)

        # Hit
        found = self.db.lookup_ip("1.0.0.50")
        self.assertIsNotNone(found)
        self.assertEqual(found["country_code"], "AU")
        self.assertEqual(found["status"], "assigned")

        # Miss
        miss = self.db.lookup_ip("8.8.8.8")
        self.assertIsNone(miss)

    def test_ipv6_lookup(self):
        self.db.initialize_schema()
        self.db.import_dataset(self.dataset, sha256="test", signature_verified=False)

        # Hit
        found = self.db.lookup_ip("2001:200:1000::1")
        self.assertIsNotNone(found)
        self.assertEqual(found["country_code"], "JP")

        # Miss
        miss = self.db.lookup_ip("2001:4860:4860::8888")
        self.assertIsNone(miss)

    def test_asn_lookup(self):
        self.db.initialize_schema()
        self.db.import_dataset(self.dataset, sha256="test", signature_verified=False)

        # Hit as int
        found = self.db.lookup_asn(997)
        self.assertIsNotNone(found)
        self.assertEqual(found["country_code"], "SG")

        # Hit as string with prefix
        found_str = self.db.lookup_asn("AS997")
        self.assertIsNotNone(found_str)
        self.assertEqual(found_str["country_code"], "SG")

        # Miss
        miss = self.db.lookup_asn(65000)
        self.assertIsNone(miss)

    def test_summary_statistics(self):
        self.db.initialize_schema()
        self.db.import_dataset(self.dataset, sha256="test", signature_verified=False)

        summary = self.db.get_summary_stats()
        self.assertEqual(summary["total_records"], 3)
        self.assertEqual(summary["ipv4_count"], 1)
        self.assertEqual(summary["ipv6_count"], 1)
        self.assertEqual(summary["asn_count"], 1)
        self.assertIn("AU", summary["top_countries"])

    def test_failed_update_preserves_old_data(self):
        self.db.initialize_schema()
        # Initial good import
        self.db.import_dataset(self.dataset, sha256="first", signature_verified=False)
        old_meta = self.db.get_latest_metadata()

        # Create a candidate dataset with intentional defect causing import error
        broken_record = ResourceRecord(
            registry="apnic",
            country_code="AU",
            resource_type="ipv4",
            start="1.0.0.0",
            value="256",
            date="20110811",
            status="assigned",
            extensions="",
            start_num=100,
            end_num=50,  # Invalid range
        )
        bad_dataset = ParsedDataset(
            header=DatasetHeader(
                version="2",
                registry="apnic",
                serial="99999999",
                records=5,  # Mismatch with actual records count to trigger staging failure
                startdate="19830613",
                enddate="20261118",
                utc_offset="+1000",
            ),
            records=[broken_record],
            total_parsed=1,
        )

        with self.assertRaises(ValueError):
            self.db.import_dataset(bad_dataset, sha256="second", signature_verified=False)

        # Verify old dataset is untouched!
        current_meta = self.db.get_latest_metadata()
        self.assertEqual(current_meta["dataset_serial"], old_meta["dataset_serial"])
        self.assertEqual(current_meta["sha256"], "first")
        self.assertIsNotNone(self.db.lookup_ip("1.0.0.50"))


if __name__ == "__main__":
    unittest.main()
