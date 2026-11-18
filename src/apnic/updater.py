"""APNIC dataset update orchestrator.

Coordinates downloading, cryptographic verification, format parsing,
and transactional SQLite publication on a daily (24-hour) schedule.
"""

import json
import logging
import os
import signal
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import config
from .database import APNICDatabase
from .downloader import APNICDownloader
from .parser import APNICParser, APNICParserError, ParsedDataset
from .verifier import APNICVerifier, VerificationResult

logger = logging.getLogger("apnic.updater")


@dataclass
class SyncStatus:
    current_serial: Optional[str] = None
    last_successful_import: Optional[str] = None
    last_update_attempt: Optional[str] = None
    signature_verification_status: str = "PENDING_KEY_CONFIGURATION"  # 'VERIFIED', 'PENDING_KEY_CONFIGURATION', 'FAILED', 'UNAVAILABLE'
    checksum_verification_status: str = "UNAVAILABLE"  # 'VERIFIED', 'FAILED', 'UNAVAILABLE'
    current_update_status: str = "IDLE"  # 'IDLE', 'RUNNING', 'SUCCESS', 'FAILED'
    last_error: Optional[str] = None
    error_category: Optional[str] = None
    sha256: Optional[str] = None
    record_count: int = 0
    trusted_key_configured: bool = False


class APNICUpdater:
    """Manages full APNIC data synchronization pipeline."""

    def __init__(
        self,
        db: Optional[APNICDatabase] = None,
        downloader: Optional[APNICDownloader] = None,
        verifier: Optional[APNICVerifier] = None,
        status_path: Optional[Path] = None,
    ):
        config.ensure_directories()
        self.db = db or APNICDatabase()
        self.downloader = downloader or APNICDownloader()
        self.verifier = verifier or APNICVerifier()
        self.status_path = Path(status_path or config.STATUS_FILE_PATH)
        self.lock_file = config.DATA_DIR / "updater.lock"
        self._running = True

    def load_status(self) -> SyncStatus:
        """Load persistent sync status from disk, falling back to database metadata."""
        status = SyncStatus()
        status.trusted_key_configured = bool(config.EXPECTED_GPG_FINGERPRINT)

        if self.status_path.exists():
            try:
                with open(self.status_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return SyncStatus(**data)
            except Exception as exc:
                logger.warning("Could not read status file %s: %s", self.status_path, exc)

        # Fallback to active DB metadata
        meta = self.db.get_latest_metadata()
        if meta:
            status.current_serial = meta.get("dataset_serial")
            status.last_successful_import = meta.get("imported_at")
            status.sha256 = meta.get("sha256")
            status.record_count = meta.get("record_count", 0)
            status.checksum_verification_status = "VERIFIED"
            status.signature_verification_status = (
                "VERIFIED" if meta.get("signature_verified") else "PENDING_KEY_CONFIGURATION"
            )
        return status

    def save_status(self, status: SyncStatus) -> None:
        """Persist current sync status to status_file atomically."""
        temp_status = self.status_path.with_suffix(".tmp")
        try:
            with open(temp_status, "w", encoding="utf-8") as f:
                json.dump(asdict(status), f, indent=2)
            temp_status.replace(self.status_path)
        except Exception as exc:
            logger.error("Failed to write sync status file: %s", exc)
            if temp_status.exists():
                try:
                    temp_status.unlink()
                except OSError:
                    pass

    def _acquire_lock(self) -> bool:
        """Acquire single-instance update lock."""
        if self.lock_file.exists():
            try:
                with open(self.lock_file, "r") as f:
                    pid = int(f.read().strip())
                # Check if process is still running
                try:
                    os.kill(pid, 0)
                    return False  # Already running
                except (OSError, ProcessLookupError):
                    # Stale lock
                    pass
            except Exception:
                pass

        try:
            with open(self.lock_file, "w") as f:
                f.write(str(os.getpid()))
            return True
        except Exception as exc:
            logger.error("Could not write lock file: %s", exc)
            return False

    def _release_lock(self) -> None:
        """Release single-instance update lock."""
        try:
            if self.lock_file.exists():
                self.lock_file.unlink()
        except OSError:
            pass

    def run_update(self, force: bool = False) -> tuple[bool, SyncStatus]:
        """Execute one complete synchronization cycle.

        Steps:
        1. Acquire single-instance lock.
        2. Inspect active metadata.
        3. Download dataset and sidecars (detect unchanged content).
        4. Calculate SHA-256 and verify MD5 checksum.
        5. Verify PGP signature using independently trusted key.
        6. Parse dataset and validate header and record count.
        7. Import dataset into SQLite using atomic staging tables.
        8. Save sync status and update provenance.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        status = self.load_status()
        status.last_update_attempt = now_iso
        status.trusted_key_configured = bool(config.EXPECTED_GPG_FINGERPRINT)

        if not self._acquire_lock():
            msg = "Update execution already in progress by another process"
            logger.warning(msg)
            return False, status

        try:
            status.current_update_status = "RUNNING"
            status.last_error = None
            status.error_category = None
            self.save_status(status)

            # Ensure schema is initialized
            self.db.initialize_schema()
            current_meta = self.db.get_latest_metadata()

            # Step 1: Download
            current_md5 = None
            # If we have an existing dataset file, get its MD5
            dataset_path = config.DOWNLOADS_DIR / "delegated-apnic-latest"
            md5_path = config.DOWNLOADS_DIR / "delegated-apnic-latest.md5"
            sig_path = config.DOWNLOADS_DIR / "delegated-apnic-latest.asc"

            if dataset_path.exists() and md5_path.exists() and current_meta:
                try:
                    current_md5 = self.verifier.parse_md5_file(md5_path)
                except Exception:
                    pass

            logger.info("APNIC update started (force=%s, current_serial=%s)", force, status.current_serial)
            dl_result = self.downloader.download_all(force=force, current_md5=current_md5)

            if not dl_result.success:
                status.current_update_status = "FAILED"
                status.error_category = "DownloadFailure"
                status.last_error = dl_result.error or "Download failed"
                self.save_status(status)
                logger.error("Update aborted: %s (last known-good dataset retained)", status.last_error)
                return False, status

            # Check if dataset is unchanged
            if not dl_result.is_new and current_meta:
                logger.info("Dataset is unchanged; skipping re-import (serial=%s)", current_meta["dataset_serial"])
                status.current_update_status = "SUCCESS"
                status.last_successful_import = current_meta["imported_at"]
                status.current_serial = current_meta["dataset_serial"]
                self.save_status(status)
                return True, status

            dataset_file = dl_result.dataset_path or dataset_path
            md5_file = dl_result.md5_path or md5_path
            sig_file = dl_result.sig_path or sig_target

            # Step 2: Verification
            logger.info("Verifying integrity and cryptographic signatures...")
            v_result = self.verifier.verify_all(dataset_file, md5_file, sig_file)

            status.sha256 = v_result.sha256
            status.checksum_verification_status = "VERIFIED" if v_result.md5_verified else "FAILED"
            status.signature_verification_status = v_result.status

            if not v_result.md5_verified:
                status.current_update_status = "FAILED"
                status.error_category = "ChecksumMismatch"
                status.last_error = v_result.error_message
                self.save_status(status)
                logger.error("Update aborted: MD5 checksum verification failed")
                return False, status

            # Note on signature verification:
            # If trusted key is not configured, we document and fail safely or flag as pending key configuration
            if not v_result.valid:
                status.current_update_status = "FAILED"
                status.error_category = v_result.error_type or "SignatureVerificationFailed"
                status.last_error = v_result.error_message
                self.save_status(status)
                logger.error("Update aborted: Signature verification failed: %s", v_result.error_message)
                return False, status

            # Step 3: Parsing & Validation
            logger.info("Parsing APNIC dataset...")
            try:
                parsed = APNICParser.parse_file(dataset_file)
            except APNICParserError as exc:
                status.current_update_status = "FAILED"
                status.error_category = "DatasetParsingFailure"
                status.last_error = str(exc)
                self.save_status(status)
                logger.error("Update aborted: %s", exc)
                return False, status

            # Step 4: Transactional SQLite Import
            logger.info("Importing candidate dataset (serial=%s, records=%d) to SQLite...", parsed.header.serial, len(parsed.records))
            try:
                self.db.import_dataset(
                    parsed,
                    sha256=v_result.sha256,
                    signature_verified=v_result.signature_verified,
                    source_file=dataset_file.name,
                )
            except Exception as exc:
                status.current_update_status = "FAILED"
                status.error_category = "DatabaseImportFailure"
                status.last_error = f"Database import error: {exc}"
                self.save_status(status)
                logger.error("Update aborted: %s", status.last_error)
                return False, status

            # Success: update status and archive copy
            status.current_update_status = "SUCCESS"
            status.current_serial = parsed.header.serial
            status.record_count = len(parsed.records)
            status.last_successful_import = datetime.now(timezone.utc).isoformat()
            status.last_error = None
            status.error_category = None
            self.save_status(status)

            # Archive to processed/
            try:
                archive_name = f"delegated-apnic-{parsed.header.serial}"
                archive_path = config.PROCESSED_DIR / archive_name
                import shutil
                shutil.copy2(dataset_file, archive_path)
            except Exception as exc:
                logger.warning("Could not archive dataset to processed/: %s", exc)

            logger.info("APNIC dataset update completed successfully (serial=%s)", parsed.header.serial)
            return True, status

        finally:
            self._release_lock()

    def run_daemon(self, interval_hours: Optional[int] = None) -> None:
        """Run recurring update service every interval_hours (default 24)."""
        interval_secs = (interval_hours or config.UPDATE_INTERVAL_HOURS) * 3600
        logger.info("Starting APNIC Update Daemon (interval=%d hours / %d seconds)", interval_hours or config.UPDATE_INTERVAL_HOURS, interval_secs)

        def _handle_exit(sig, frame):
            logger.info("APNIC daemon received termination signal (%s), shutting down...", sig)
            self._running = False

        signal.signal(signal.SIGINT, _handle_exit)
        signal.signal(signal.SIGTERM, _handle_exit)

        # Initial synchronization run
        try:
            self.run_update(force=False)
        except Exception as exc:
            logger.error("Initial APNIC sync failed: %s", exc)

        while self._running:
            # Sleep in small increments to respond promptly to termination signals
            slept = 0
            while self._running and slept < interval_secs:
                time.sleep(min(5, interval_secs - slept))
                slept += 5

            if not self._running:
                break

            try:
                self.run_update(force=False)
            except Exception as exc:
                logger.error("Scheduled APNIC sync failed: %s", exc)

        logger.info("APNIC daemon exited cleanly")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    )
    updater = APNICUpdater()
    if "--daemon" in sys.argv:
        updater.run_daemon()
    else:
        force = "--force" in sys.argv
        success, status = updater.run_update(force=force)
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
