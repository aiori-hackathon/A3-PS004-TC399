"""Unit tests for the APNIC checksum and signature verifier."""

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.apnic.verifier import APNICVerifier, VerificationResult


class APNICVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)

        # Create controlled test dataset
        self.dataset_content = b"2|apnic|20261119|1|19830613|20261118|+1000\napnic|AU|ipv4|1.0.0.0|256|20110811|assigned\n"
        self.dataset_path = self.dir_path / "delegated-apnic-latest"
        self.dataset_path.write_bytes(self.dataset_content)

        # Expected MD5
        self.expected_md5 = hashlib.md5(self.dataset_content).hexdigest()
        self.md5_path = self.dir_path / "delegated-apnic-latest.md5"
        self.md5_path.write_text(f"MD5 (delegated-apnic-latest) = {self.expected_md5}\n", encoding="utf-8")

        # Fake signature and public key
        self.sig_path = self.dir_path / "delegated-apnic-latest.asc"
        self.sig_path.write_text("-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n")

        self.key_path = self.dir_path / "CURRENT_PUBLIC_KEY"
        self.key_path.write_text("-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n")

        self.trusted_fp = "53484F6685D112B194DD25D9CB342F01D1524E14"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_correct_md5_verification(self):
        verifier = APNICVerifier(trusted_key_path=self.key_path, expected_fingerprint="")
        is_valid, computed, expected = verifier.verify_checksum(self.dataset_path, self.md5_path)
        self.assertTrue(is_valid)
        self.assertEqual(computed, self.expected_md5)
        self.assertEqual(expected, self.expected_md5)

    def test_incorrect_md5_verification(self):
        bad_md5_path = self.dir_path / "bad.md5"
        bad_md5_path.write_text("MD5 (delegated-apnic-latest) = 00112233445566778899aabbccddeeff\n")

        verifier = APNICVerifier(trusted_key_path=self.key_path, expected_fingerprint="")
        is_valid, computed, expected = verifier.verify_checksum(self.dataset_path, bad_md5_path)
        self.assertFalse(is_valid)
        self.assertNotEqual(computed, expected)

    def test_unconfigured_fingerprint_fails_safely_as_pending(self):
        # When expected_fingerprint is empty, MUST NOT invent or automatically trust keys
        verifier = APNICVerifier(trusted_key_path=self.key_path, expected_fingerprint="")
        res = verifier.verify_all(self.dataset_path, self.md5_path, self.sig_path)

        self.assertTrue(res.md5_verified)
        self.assertFalse(res.signature_verified)
        self.assertEqual(res.status, "PENDING_KEY_CONFIGURATION")
        self.assertEqual(res.error_type, "KeyConfigurationPending")
        self.assertIn("APNIC_GPG_FINGERPRINT", res.error_message)

    def test_untrusted_signing_key_fingerprint_mismatch(self):
        verifier = APNICVerifier(
            trusted_key_path=self.key_path,
            expected_fingerprint="1111222233334444555566667777888899990000",
        )

        with (
            patch("shutil.which", return_value="gpg"),
            patch("subprocess.run") as mock_subproc,
        ):
            # Mock gpg --version
            v_mock = MagicMock(returncode=0)
            # Mock gpg --import
            import_mock = MagicMock(returncode=0)
            # Mock gpg --fingerprint (returns a different fingerprint)
            fp_mock = MagicMock(
                returncode=0,
                stdout="fpr:::::::::9999888877776666555544443333222211110000:\n",
            )

            mock_subproc.side_effect = [v_mock, import_mock, fp_mock]

            res = verifier.verify_all(self.dataset_path, self.md5_path, self.sig_path)
            self.assertFalse(res.signature_verified)
            self.assertEqual(res.status, "FAILED")
            self.assertIn("Untrusted signing key", res.error_message)

    def test_valid_pgp_signature(self):
        verifier = APNICVerifier(
            trusted_key_path=self.key_path,
            expected_fingerprint=self.trusted_fp,
        )

        with (
            patch("shutil.which", return_value="gpg"),
            patch("subprocess.run") as mock_subproc,
        ):
            v_mock = MagicMock(returncode=0)
            import_mock = MagicMock(returncode=0)
            fp_mock = MagicMock(
                returncode=0,
                stdout=f"fpr:::::::::{self.trusted_fp}:\n",
            )
            verify_mock = MagicMock(
                returncode=0,
                stdout="",
                stderr="gpg: Good signature from APNIC\n",
            )

            mock_subproc.side_effect = [v_mock, import_mock, fp_mock, verify_mock]

            res = verifier.verify_all(self.dataset_path, self.md5_path, self.sig_path)
            self.assertTrue(res.valid)
            self.assertTrue(res.md5_verified)
            self.assertTrue(res.signature_verified)
            self.assertEqual(res.status, "VERIFIED")
            self.assertEqual(res.key_fingerprint, self.trusted_fp)

    def test_invalid_pgp_signature_rejected(self):
        verifier = APNICVerifier(
            trusted_key_path=self.key_path,
            expected_fingerprint=self.trusted_fp,
        )

        with (
            patch("shutil.which", return_value="gpg"),
            patch("subprocess.run") as mock_subproc,
        ):
            v_mock = MagicMock(returncode=0)
            import_mock = MagicMock(returncode=0)
            fp_mock = MagicMock(
                returncode=0,
                stdout=f"fpr:::::::::{self.trusted_fp}:\n",
            )
            verify_mock = MagicMock(
                returncode=1,
                stdout="",
                stderr="gpg: BAD signature from APNIC\n",
            )

            mock_subproc.side_effect = [v_mock, import_mock, fp_mock, verify_mock]

            res = verifier.verify_all(self.dataset_path, self.md5_path, self.sig_path)
            self.assertFalse(res.valid)
            self.assertFalse(res.signature_verified)
            self.assertEqual(res.status, "FAILED")
            self.assertIn("PGP signature verification failed", res.error_message)


if __name__ == "__main__":
    unittest.main()
