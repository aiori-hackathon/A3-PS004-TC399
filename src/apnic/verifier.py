"""APNIC dataset integrity and signature verifier.

Performs:
1. MD5 checksum verification against the official .md5 sidecar.
2. Calculation of dataset SHA-256 fingerprint for provenance.
3. Detached OpenPGP signature verification (.asc) using GnuPG with
   an explicitly configured and independently verified fingerprint.
"""

import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import config

logger = logging.getLogger("apnic.verifier")


@dataclass
class VerificationResult:
    valid: bool
    md5_verified: bool
    signature_verified: bool
    sha256: str
    status: str  # 'VERIFIED', 'PENDING_KEY_CONFIGURATION', 'FAILED'
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    key_fingerprint: Optional[str] = None


class APNICVerifier:
    """Verifies MD5 integrity and OpenPGP detached signatures."""

    def __init__(
        self,
        trusted_key_path: Optional[Path] = None,
        expected_fingerprint: Optional[str] = None,
        gpg_binary: str = config.GPG_BINARY,
    ):
        self.trusted_key_path = Path(trusted_key_path or config.TRUSTED_KEY_PATH)
        self.expected_fingerprint = (
            expected_fingerprint
            if expected_fingerprint is not None
            else config.EXPECTED_GPG_FINGERPRINT
        ).strip().replace(" ", "").upper()
        self.gpg_binary = gpg_binary

    @staticmethod
    def calculate_sha256(file_path: Path) -> str:
        """Calculate the SHA-256 digest of a file in streaming chunks."""
        hasher = hashlib.sha256()
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        return hasher.hexdigest().lower()

    @staticmethod
    def calculate_md5(file_path: Path) -> str:
        """Calculate the MD5 digest of a file in streaming chunks."""
        hasher = hashlib.md5()
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        return hasher.hexdigest().lower()

    @staticmethod
    def parse_md5_file(md5_file_path: Path) -> str:
        """Parse APNIC's MD5 checksum file format."""
        with open(md5_file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read().strip()

        # Matches either `MD5 (delegated-apnic-latest) = <hash>` or `<hash>  file`
        for token in content.replace("=", " ").replace("(", " ").replace(")", " ").split():
            clean = token.strip().lower()
            if len(clean) == 32 and all(c in "0123456789abcdef" for c in clean):
                return clean

        raise ValueError(f"Could not parse valid MD5 hash from {md5_file_path}: {content[:100]}")

    def verify_checksum(self, dataset_path: Path, md5_path: Path) -> tuple[bool, str, str]:
        """Verify the MD5 checksum of the dataset against the published MD5 file.

        Returns (is_valid, computed_md5, expected_md5).
        """
        expected_md5 = self.parse_md5_file(md5_path)
        computed_md5 = self.calculate_md5(dataset_path)
        is_valid = computed_md5.lower() == expected_md5.lower()
        if not is_valid:
            logger.error(
                "MD5 mismatch! computed=%s, expected=%s",
                computed_md5,
                expected_md5,
            )
        else:
            logger.info("MD5 checksum verified successfully: %s", computed_md5)
        return is_valid, computed_md5, expected_md5

    def verify_pgp_signature(
        self,
        dataset_path: Path,
        sig_path: Path,
    ) -> tuple[bool, str, Optional[str], Optional[str]]:
        """Verify the detached PGP signature using GnuPG.

        Returns: (signature_ok, status, key_fingerprint, error_message)
        """
        # Rule: If expected fingerprint has not been configured, fail safely.
        # NEVER invent or automatically trust an unconfigured fingerprint.
        if not self.expected_fingerprint:
            err = (
                "APNIC trusted GPG fingerprint (APNIC_GPG_FINGERPRINT) is not configured. "
                "Manual out-of-band key verification is required before signature verification can be enabled."
            )
            logger.warning(err)
            return False, "PENDING_KEY_CONFIGURATION", None, err

        if not self.trusted_key_path.exists():
            err = (
                f"Configured trusted key file does not exist: {self.trusted_key_path}. "
                "Place the verified APNIC public key at this location."
            )
            logger.error(err)
            return False, "FAILED", None, err

        # Check if gpg executable is available
        gpg_cmd = shutil.which(self.gpg_binary) or self.gpg_binary
        try:
            version_check = subprocess.run(
                [gpg_cmd, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if version_check.returncode != 0:
                err = f"GPG binary '{self.gpg_binary}' returned error code {version_check.returncode}"
                logger.error(err)
                return False, "FAILED", None, err
        except (FileNotFoundError, OSError) as exc:
            err = (
                f"GnuPG binary '{self.gpg_binary}' not found or executable: {exc}. "
                "Ensure GnuPG is installed in the runtime environment."
            )
            logger.error(err)
            return False, "FAILED", None, err

        # Create isolated temporary GNUPGHOME
        with tempfile.TemporaryDirectory(prefix="apnic_gpg_") as tmp_gpghome:
            gpghome = Path(tmp_gpghome)

            # 1. Import trusted public key into temporary keyring
            import_proc = subprocess.run(
                [
                    gpg_cmd,
                    "--homedir",
                    str(gpghome),
                    "--batch",
                    "--no-default-keyring",
                    "--keyring",
                    str(gpghome / "apnic.kbx"),
                    "--import",
                    str(self.trusted_key_path),
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if import_proc.returncode != 0:
                err = f"Failed to import public key from {self.trusted_key_path}: {import_proc.stderr}"
                logger.error(err)
                return False, "FAILED", None, err

            # 2. Extract fingerprint of imported key and verify against configured fingerprint
            fp_proc = subprocess.run(
                [
                    gpg_cmd,
                    "--homedir",
                    str(gpghome),
                    "--batch",
                    "--no-default-keyring",
                    "--keyring",
                    str(gpghome / "apnic.kbx"),
                    "--with-colons",
                    "--fingerprint",
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            if fp_proc.returncode != 0:
                err = f"Failed to inspect imported key fingerprints: {fp_proc.stderr}"
                logger.error(err)
                return False, "FAILED", None, err

            # Parse fingerprint lines: `fpr:::::::::53484F6685D112B194DD25D9CB342F01D1524E14:`
            fingerprints = []
            for line in fp_proc.stdout.splitlines():
                parts = line.split(":")
                if parts[0] == "fpr" and len(parts) > 9:
                    fingerprints.append(parts[9].strip().replace(" ", "").upper())

            if not fingerprints:
                err = f"No valid fingerprint found in key file: {self.trusted_key_path}"
                logger.error(err)
                return False, "FAILED", None, err

            matched_fp = None
            for fp in fingerprints:
                if fp == self.expected_fingerprint:
                    matched_fp = fp
                    break

            if not matched_fp:
                err = (
                    f"Untrusted signing key! Imported fingerprint(s) {fingerprints} "
                    f"do not match expected fingerprint {self.expected_fingerprint}"
                )
                logger.error(err)
                return False, "FAILED", fingerprints[0], err

            # 3. Verify detached signature
            verify_proc = subprocess.run(
                [
                    gpg_cmd,
                    "--homedir",
                    str(gpghome),
                    "--batch",
                    "--no-default-keyring",
                    "--keyring",
                    str(gpghome / "apnic.kbx"),
                    "--verify",
                    str(sig_path),
                    str(dataset_path),
                ],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )

            stderr = verify_proc.stderr
            stdout = verify_proc.stdout
            combined_output = f"{stdout}\n{stderr}"

            if verify_proc.returncode != 0:
                err = f"PGP signature verification failed (returncode={verify_proc.returncode}): {stderr}"
                logger.error(err)
                return False, "FAILED", matched_fp, err

            # Check for Good signature message
            if "Good signature" in combined_output or "gpg: Good signature" in combined_output:
                logger.info(
                    "PGP signature verified successfully with key fingerprint %s",
                    matched_fp,
                )
                return True, "VERIFIED", matched_fp, None

            err = f"PGP verification completed without positive confirmation: {combined_output}"
            logger.error(err)
            return False, "FAILED", matched_fp, err

    def verify_all(
        self,
        dataset_path: Path,
        md5_path: Path,
        sig_path: Optional[Path] = None,
    ) -> VerificationResult:
        """Run all independent verification checks.

        Returns structured VerificationResult.
        """
        sha256 = self.calculate_sha256(dataset_path)

        # Check A: MD5 Checksum
        try:
            md5_ok, computed_md5, expected_md5 = self.verify_checksum(dataset_path, md5_path)
            if not md5_ok:
                return VerificationResult(
                    valid=False,
                    md5_verified=False,
                    signature_verified=False,
                    sha256=sha256,
                    status="FAILED",
                    error_type="ChecksumMismatch",
                    error_message=f"MD5 mismatch: computed {computed_md5} != expected {expected_md5}",
                )
        except Exception as exc:
            return VerificationResult(
                valid=False,
                md5_verified=False,
                signature_verified=False,
                sha256=sha256,
                status="FAILED",
                error_type="ChecksumError",
                error_message=f"Failed to verify MD5 checksum: {exc}",
            )

        # Check B: PGP Signature
        if sig_path is None or not sig_path.exists():
            return VerificationResult(
                valid=False,
                md5_verified=True,
                signature_verified=False,
                sha256=sha256,
                status="FAILED",
                error_type="MissingSignature",
                error_message="Signature file (.asc) is missing",
            )

        sig_ok, status, key_fp, sig_err = self.verify_pgp_signature(dataset_path, sig_path)

        if not sig_ok:
            error_type = (
                "KeyConfigurationPending"
                if status == "PENDING_KEY_CONFIGURATION"
                else "SignatureVerificationFailed"
            )
            return VerificationResult(
                valid=False,
                md5_verified=True,
                signature_verified=False,
                sha256=sha256,
                status=status,
                error_type=error_type,
                error_message=sig_err,
                key_fingerprint=key_fp,
            )

        return VerificationResult(
            valid=True,
            md5_verified=True,
            signature_verified=True,
            sha256=sha256,
            status="VERIFIED",
            key_fingerprint=key_fp,
        )
