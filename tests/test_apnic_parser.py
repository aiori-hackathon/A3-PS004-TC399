"""Unit tests for the APNIC delegated statistics dataset parser."""

import unittest
from io import StringIO
from pathlib import Path

from src.apnic.parser import APNICParser, APNICParserError, DatasetHeader, ResourceRecord


class APNICParserTests(unittest.TestCase):
    def test_valid_header_parsing(self):
        line = "2|apnic|20261119|4|19830613|20261118|+1000"
        header = APNICParser.parse_header_line(line)
        self.assertEqual(header.version, "2")
        self.assertEqual(header.registry, "apnic")
        self.assertEqual(header.serial, "20261119")
        self.assertEqual(header.records, 4)
        self.assertEqual(header.startdate, "19830613")
        self.assertEqual(header.enddate, "20261118")
        self.assertEqual(header.utc_offset, "+1000")

    def test_header_insufficient_fields(self):
        with self.assertRaises(APNICParserError):
            APNICParser.parse_header_line("2|apnic|20261119|4|19830613")

    def test_header_invalid_record_count(self):
        with self.assertRaises(APNICParserError):
            APNICParser.parse_header_line("2|apnic|20261119|not-a-number|19830613|20261118|+1000")

    def test_ipv4_range_calculation(self):
        start_num, end_num = APNICParser.calculate_range("ipv4", "1.0.0.0", "256")
        self.assertEqual(start_num, 16777216)
        self.assertEqual(end_num, 16777216 + 255)

    def test_ipv6_range_calculation(self):
        start_num, end_num = APNICParser.calculate_range("ipv6", "2001:200::", "35")
        self.assertIsInstance(start_num, int)
        self.assertIsInstance(end_num, int)
        self.assertLess(start_num, end_num)

    def test_asn_range_calculation(self):
        start_num, end_num = APNICParser.calculate_range("asn", "173", "1")
        self.assertEqual(start_num, 173)
        self.assertEqual(end_num, 173)

        start_multi, end_multi = APNICParser.calculate_range("asn", "2497", "32")
        self.assertEqual(start_multi, 2497)
        self.assertEqual(end_multi, 2497 + 31)

    def test_comments_and_blank_lines_ignored(self):
        sample = """
        # Comment line
        # Another comment
        
        2|apnic|20261119|2|19830613|20261118|+1000
        # Comment inside
        apnic|AU|ipv4|1.0.0.0|256|20110811|assigned
        apnic|JP|asn|173|1|20020801|allocated
        """
        parsed = APNICParser.parse_lines(sample.strip().splitlines())
        self.assertEqual(parsed.header.serial, "20261119")
        self.assertEqual(len(parsed.records), 2)
        self.assertEqual(parsed.records[0].country_code, "AU")
        self.assertEqual(parsed.records[1].country_code, "JP")

    def test_summary_lines_parsed(self):
        sample = """
        2|apnic|20261119|2|19830613|20261118|+1000
        apnic|*|asn|*|1|summary
        apnic|*|ipv4|*|1|summary
        apnic|AU|ipv4|1.0.0.0|256|20110811|assigned
        apnic|JP|asn|173|1|20020801|allocated
        """
        parsed = APNICParser.parse_lines(sample.strip().splitlines())
        self.assertEqual(parsed.summary_counts.get("asn"), 1)
        self.assertEqual(parsed.summary_counts.get("ipv4"), 1)
        self.assertEqual(len(parsed.records), 2)

    def test_optional_extensions(self):
        sample = """
        2|apnic|20261119|1|19830613|20261118|+1000
        apnic|AU|ipv4|1.0.0.0|256|20110811|assigned|12345|ext-foo
        """
        parsed = APNICParser.parse_lines(sample.strip().splitlines())
        self.assertEqual(len(parsed.records), 1)
        self.assertEqual(parsed.records[0].extensions, "12345|ext-foo")

    def test_unsupported_resource_type_rejected(self):
        sample = """
        2|apnic|20261119|1|19830613|20261118|+1000
        apnic|AU|custom_type|1.0.0.0|256|20110811|assigned
        """
        with self.assertRaises(APNICParserError):
            APNICParser.parse_lines(sample.strip().splitlines())

    def test_record_count_mismatch_raises_error(self):
        sample = """
        2|apnic|20261119|5|19830613|20261118|+1000
        apnic|AU|ipv4|1.0.0.0|256|20110811|assigned
        """
        with self.assertRaises(APNICParserError) as ctx:
            APNICParser.parse_lines(sample.strip().splitlines())
        self.assertIn("Record count mismatch", str(ctx.exception))

    def test_invalid_resource_values_rejected(self):
        with self.assertRaises(APNICParserError):
            APNICParser.calculate_range("ipv4", "999.999.999.999", "256")

        with self.assertRaises(APNICParserError):
            APNICParser.calculate_range("ipv4", "1.0.0.0", "-10")

        with self.assertRaises(APNICParserError):
            APNICParser.calculate_range("ipv6", "invalid::ipv6", "32")

        with self.assertRaises(APNICParserError):
            APNICParser.calculate_range("ipv6", "2001:db8::", "129")

        with self.assertRaises(APNICParserError):
            APNICParser.calculate_range("asn", "not_asn", "1")


if __name__ == "__main__":
    unittest.main()
