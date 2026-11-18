"""Unit tests for the APNIC update orchestrator."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.apnic.database import APNICDatabase
from src.apnic.downloader import APNICDownloader, DownloadResult
from src.apnic.parser import DatasetHeader, ParsedDataset, ResourceRecord
from src.apnic.updater import APNICUpdater, SyncStatus
from src.apnic.verifier import APNICVerifier, VerificationResult


class APNICUpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)
        self.db_path = self.dir_path / "updater_test.db"
        self.status_path = self.dir_path / "sync_status.json"

        self.db = APNICDatabase(self.db_path)
        self.downloader = MagicMock(spec=APNICDownloader)
        self.verifier = MagicMock(spec=APNICVerifier)

        self.updater = APNICUpdater(
            db=self.db,
            downloader=self.downloader,
            verifier=self.verifier,
            status_path=self.status_path,
        )

        # Sample dataset file
        self.dataset_file = self.dir_path / "delegated-apnic-latest"
        self.dataset_file.write_text("2|apnic|20261119|1|19830613|20261118|+1000\napnic|AU|ipv4|1.0.0.0|256|20110811|assigned\n")
        self.md5_file = self.dir_path / "delegated-apnic-latest.md5"
        self.md5_file.write_text("MD5 (delegated-apnic-latest) = dummy\n")
        self.sig_file = self.dir_path / "delegated-apnic-latest.asc"
        self.sig_file.write_text("dummy-sig\n")

    def tearDown(self):
        try:
            self.temp_dir.cleanup()
        except OSError:
            pass

    def test_successful_initial_ingestion(self):
        self.downloader.download_all.return_value = DownloadResult(
            success=True,
            dataset_path=self.dataset_file,
            md5_path=self.md5_file,
            sig_path=self.sig_file,
            is_new=True,
        )
        self.verifier.verify_all.return_value = VerificationResult(
            valid=True,
            md5_verified=True,
            signature_verified=True,
            sha256="test-sha256",
            status="VERIFIED",
        )

        success, status = self.updater.run_update(force=True)
        self.assertTrue(success)
        self.assertEqual(status.current_update_status, "SUCCESS")
        self.assertEqual(status.current_serial, "20261119")
        self.assertEqual(status.record_count, 1)

        # Check DB metadata
        meta = self.db.get_latest_metadata()
        self.assertIsNotNone(meta)
        self.assertEqual(meta["dataset_serial"], "20261119")

    def test_unchanged_dataset_detection(self):
        # First import
        self.downloader.download_all.return_value = DownloadResult(
            success=True,
            dataset_path=self.dataset_file,
            md5_path=self.md5_file,
            sig_path=self.sig_file,
            is_new=True,
        )
        self.verifier.verify_all.return_value = VerificationResult(
            valid=True,
            md5_verified=True,
            signature_verified=True,
            sha256="test-sha256",
            status="VERIFIED",
        )
        self.updater.run_update(force=True)

        # Second run: downloader says unchanged (is_new=False)
        self.downloader.download_all.return_value = DownloadResult(
            success=True,
            dataset_path=self.dataset_file,
            md5_path=self.md5_file,
            sig_path=self.sig_file,
            is_new=False,
        )
        success, status = self.updater.run_update(force=False)
        self.assertTrue(success)
        self.assertEqual(status.current_update_status, "SUCCESS")
        self.verifier.verify_all.assert_called_once()  # Verify was only called in the first run

    def test_network_download_failure(self):
        self.downloader.download_all.return_value = DownloadResult(
            success=False,
            error="Connection timed out",
        )

        success, status = self.updater.run_update(force=True)
        self.assertFalse(success)
        self.assertEqual(status.current_update_status, "FAILED")
        self.assertEqual(status.error_category, "DownloadFailure")
        self.assertIn("Connection timed out", status.last_error)

    def test_checksum_failure(self):
        self.downloader.download_all.return_value = DownloadResult(
            success=True,
            dataset_path=self.dataset_file,
            md5_path=self.md5_file,
            sig_path=self.sig_file,
            is_new=True,
        )
        self.verifier.verify_all.return_value = VerificationResult(
            valid=False,
            md5_verified=False,
            signature_verified=False,
            sha256="bad-sha",
            status="FAILED",
            error_type="ChecksumMismatch",
            error_message="MD5 mismatch",
        )

        success, status = self.updater.run_update(force=True)
        self.assertFalse(success)
        self.assertEqual(status.current_update_status, "FAILED")
        self.assertEqual(status.error_category, "ChecksumMismatch")

    def test_signature_failure(self):
        self.downloader.download_all.return_value = DownloadResult(
            success=True,
            dataset_path=self.dataset_file,
            md5_path=self.md5_file,
            sig_path=self.sig_file,
            is_new=True,
        )
        self.verifier.verify_all.return_value = VerificationResult(
            valid=False,
            md5_verified=True,
            signature_verified=False,
            sha256="ok-sha",
            status="FAILED",
            error_type="SignatureVerificationFailed",
            error_message="BAD signature",
        )

        success, status = self.updater.run_update(force=True)
        self.assertFalse(success)
        self.assertEqual(status.current_update_status, "FAILED")
        self.assertEqual(status.error_category, "SignatureVerificationFailed")

    def test_parsing_failure(self):
        bad_dataset_file = self.dir_path / "broken_dataset"
        bad_dataset_file.write_text("malformed header with no delimiters\n")

        self.downloader.download_all.return_value = DownloadResult(
            success=True,
            dataset_path=bad_dataset_file,
            md5_path=self.md5_file,
            sig_path=self.sig_file,
            is_new=True,
        )
        self.verifier.verify_all.return_value = VerificationResult(
            valid=True,
            md5_verified=True,
            signature_verified=True,
            sha256="sha",
            status="VERIFIED",
        )

        success, status = self.updater.run_update(force=True)
        self.assertFalse(success)
        self.assertEqual(status.current_update_status, "FAILED")
        self.assertEqual(status.error_category, "DatasetParsingFailure")


if __name__ == "__main__":
    unittest.main()
