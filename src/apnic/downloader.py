"""APNIC dataset downloader.

Handles downloading of the official delegated-apnic-latest dataset,
MD5 checksum sidecar, and detached PGP signature using HTTPS.
"""

import logging
import os
import shutil
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import config

logger = logging.getLogger("apnic.downloader")


@dataclass
class DownloadResult:
    success: bool
    dataset_path: Optional[Path] = None
    md5_path: Optional[Path] = None
    sig_path: Optional[Path] = None
    is_new: bool = True
    error: Optional[str] = None
    timestamp: str = ""


class APNICDownloader:
    """Manages secure and robust downloads from APNIC."""

    def __init__(
        self,
        dataset_url: str = config.APNIC_DATASET_URL,
        md5_url: str = config.APNIC_MD5_URL,
        sig_url: str = config.APNIC_SIG_URL,
        key_url: str = config.APNIC_KEY_URL,
        download_dir: Path = config.DOWNLOADS_DIR,
        timeout: int = config.REQUEST_TIMEOUT_SECONDS,
    ):
        self.dataset_url = dataset_url
        self.md5_url = md5_url
        self.sig_url = sig_url
        self.key_url = key_url
        self.download_dir = Path(download_dir)
        self.timeout = timeout
        self.user_agent = "AegisDNS-APNIC-Updater/1.0"

    def _download_file(self, url: str, dest_path: Path, min_bytes: int = 1) -> None:
        """Download a file from url to dest_path atomically via a temporary file."""
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        temp_fd, temp_path_str = tempfile.mkstemp(
            prefix="apnic_dl_",
            suffix=".tmp",
            dir=str(dest_path.parent),
        )
        os.close(temp_fd)
        temp_path = Path(temp_path_str)

        req = urllib.request.Request(
            url,
            headers={"User-Agent": self.user_agent},
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                if resp.status != 200:
                    raise urllib.error.HTTPError(
                        url, resp.status, f"HTTP status {resp.status}", resp.headers, None
                    )
                with open(temp_path, "wb") as f_out:
                    shutil.copyfileobj(resp, f_out)

            file_size = temp_path.stat().st_size
            if file_size < min_bytes:
                raise ValueError(
                    f"Downloaded file from {url} is empty or smaller than {min_bytes} bytes (size={file_size})"
                )

            # Atomic replace
            temp_path.replace(dest_path)
            logger.info("Successfully downloaded %s (%d bytes) to %s", url, file_size, dest_path)

        except Exception as exc:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            logger.error("Download failed for %s: %s", url, exc)
            raise

    def check_for_update(self, current_md5: Optional[str] = None) -> tuple[bool, Optional[str]]:
        """Fetch remote MD5 sidecar to check if dataset has changed without fetching full 4.5MB."""
        temp_md5_path = self.download_dir / "latest_probe.md5"
        try:
            self._download_file(self.md5_url, temp_md5_path, min_bytes=10)
            with open(temp_md5_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read().strip()

            remote_md5 = ""
            for token in content.replace("=", " ").split():
                if len(token) == 32 and all(c in "0123456789abcdefABCDEF" for c in token):
                    remote_md5 = token.lower()
                    break

            if temp_md5_path.exists():
                temp_md5_path.unlink()

            if not remote_md5:
                return True, None

            if current_md5 and current_md5.lower() == remote_md5:
                return False, remote_md5

            return True, remote_md5
        except Exception as exc:
            logger.warning("Could not probe remote MD5 for pre-check: %s", exc)
            if temp_md5_path.exists():
                try:
                    temp_md5_path.unlink()
                except OSError:
                    pass
            return True, None

    def download_all(self, force: bool = False, current_md5: Optional[str] = None) -> DownloadResult:
        """Download dataset, MD5, and detached PGP signature.

        Preserves existing downloads if an error occurs.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        dataset_target = self.download_dir / "delegated-apnic-latest"
        md5_target = self.download_dir / "delegated-apnic-latest.md5"
        sig_target = self.download_dir / "delegated-apnic-latest.asc"

        # Check if unchanged before large download if current_md5 is provided and not force
        if not force and current_md5 and dataset_target.exists():
            needs_update, remote_md5 = self.check_for_update(current_md5)
            if not needs_update:
                logger.info("APNIC dataset is unchanged (remote MD5 matches active MD5: %s)", current_md5)
                return DownloadResult(
                    success=True,
                    dataset_path=dataset_target,
                    md5_path=md5_target if md5_target.exists() else None,
                    sig_path=sig_target if sig_target.exists() else None,
                    is_new=False,
                    timestamp=now_iso,
                )

        try:
            # 1. Download MD5 checksum
            self._download_file(self.md5_url, md5_target, min_bytes=16)

            # 2. Download detached signature (.asc)
            self._download_file(self.sig_url, sig_target, min_bytes=32)

            # 3. Download main dataset file (delegated-apnic-latest is several megabytes)
            self._download_file(self.dataset_url, dataset_target, min_bytes=100_000)

            return DownloadResult(
                success=True,
                dataset_path=dataset_target,
                md5_path=md5_target,
                sig_path=sig_target,
                is_new=True,
                timestamp=now_iso,
            )
        except Exception as exc:
            err_msg = f"APNIC download failure: {exc}"
            logger.error(err_msg)
            return DownloadResult(
                success=False,
                dataset_path=dataset_target if dataset_target.exists() else None,
                md5_path=md5_target if md5_target.exists() else None,
                sig_path=sig_target if sig_target.exists() else None,
                is_new=False,
                error=err_msg,
                timestamp=now_iso,
            )
