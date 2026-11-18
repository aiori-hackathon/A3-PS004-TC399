"""Configuration for the APNIC Network Intelligence Layer."""

import os
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parents[1]

# Storage paths
DEFAULT_DATA_DIR = Path(os.getenv("APNIC_DATA_DIR", PROJECT_ROOT / "data" / "apnic"))
DATA_DIR = DEFAULT_DATA_DIR
DOWNLOADS_DIR = DATA_DIR / "downloads"
PROCESSED_DIR = DATA_DIR / "processed"
DB_PATH = Path(os.getenv("APNIC_DB_PATH", DATA_DIR / "apnic.db"))
STATUS_FILE_PATH = DATA_DIR / "sync_status.json"

# Official APNIC FTP/HTTPS endpoints
APNIC_DATASET_URL = os.getenv(
    "APNIC_DATASET_URL",
    "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest",
)
APNIC_MD5_URL = os.getenv(
    "APNIC_MD5_URL",
    "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest.md5",
)
APNIC_SIG_URL = os.getenv(
    "APNIC_SIG_URL",
    "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest.asc",
)
APNIC_KEY_URL = os.getenv(
    "APNIC_KEY_URL",
    "https://ftp.apnic.net/stats/apnic/CURRENT_PUBLIC_KEY",
)

# Network & update timing
UPDATE_INTERVAL_HOURS = int(os.getenv("APNIC_UPDATE_INTERVAL_HOURS", "24"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("APNIC_REQUEST_TIMEOUT_SECONDS", "60"))

# GPG Verification settings
# NEVER automatically accept or invent an unverified fingerprint.
# The expected fingerprint MUST be explicitly configured by an operator.
EXPECTED_GPG_FINGERPRINT = os.getenv("APNIC_GPG_FINGERPRINT", "").strip()
TRUSTED_KEY_PATH = Path(
    os.getenv("APNIC_TRUSTED_KEY_PATH", DATA_DIR / "CURRENT_PUBLIC_KEY")
)
GPG_BINARY = os.getenv("GPG_BINARY", "gpg")


def ensure_directories() -> None:
    """Ensure that the required data directories exist."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
