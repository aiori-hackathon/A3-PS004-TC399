"""SQLite database management for APNIC delegated statistics.

Implements schema creation, transactional atomic imports using staging tables,
indexed IP and ASN lookups, metadata retrieval, and health checks.
"""

import ipaddress
import logging
import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

from . import config
from .parser import ParsedDataset, ResourceRecord

logger = logging.getLogger("apnic.database")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registry TEXT NOT NULL,
    country_code TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    start TEXT NOT NULL,
    value TEXT NOT NULL,
    date TEXT,
    status TEXT NOT NULL,
    extensions TEXT,
    start_num TEXT NOT NULL,
    end_num TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resources_ipv4 ON resources(resource_type, start_num, end_num) WHERE resource_type = 'ipv4';
CREATE INDEX IF NOT EXISTS idx_resources_ipv6 ON resources(resource_type, start_num, end_num) WHERE resource_type = 'ipv6';
CREATE INDEX IF NOT EXISTS idx_resources_asn ON resources(resource_type, start_num, end_num) WHERE resource_type = 'asn';
CREATE INDEX IF NOT EXISTS idx_resources_type_cc ON resources(resource_type, country_code);
CREATE INDEX IF NOT EXISTS idx_resources_type_status ON resources(resource_type, status);

CREATE TABLE IF NOT EXISTS dataset_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_serial TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    record_count INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    signature_verified INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    source_file TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);
"""

STAGING_SCHEMA_SQL = """
DROP TABLE IF EXISTS resources_staging;
DROP TABLE IF EXISTS dataset_metadata_staging;
DROP INDEX IF EXISTS idx_staging_ipv4;
DROP INDEX IF EXISTS idx_staging_ipv6;
DROP INDEX IF EXISTS idx_staging_asn;
DROP INDEX IF EXISTS idx_staging_type_cc;
DROP INDEX IF EXISTS idx_staging_type_status;

CREATE TABLE resources_staging (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registry TEXT NOT NULL,
    country_code TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    start TEXT NOT NULL,
    value TEXT NOT NULL,
    date TEXT,
    status TEXT NOT NULL,
    extensions TEXT,
    start_num TEXT NOT NULL,
    end_num TEXT NOT NULL
);

CREATE TABLE dataset_metadata_staging (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_serial TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    record_count INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    signature_verified INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    source_file TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);
"""


class APNICDatabase:
    """Manages the SQLite database for APNIC data."""

    def __init__(self, db_path: Optional[Union[str, Path]] = None):
        self.db_path = Path(db_path or config.DB_PATH)

    def get_connection(self, read_only: bool = False) -> sqlite3.Connection:
        """Create a sqlite3 connection with WAL mode and row factory."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        if read_only and not self.db_path.exists():
            raise FileNotFoundError(f"Database file does not exist: {self.db_path}")

        conn = sqlite3.connect(
            str(self.db_path),
            timeout=10.0,
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        if not read_only:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def initialize_schema(self) -> None:
        """Initialize base tables and indexes if they do not exist."""
        conn = self.get_connection()
        try:
            conn.executescript(SCHEMA_SQL)
            logger.info("APNIC database initialized at %s", self.db_path)
        finally:
            conn.close()

    @staticmethod
    def _normalize_range_val(resource_type: str, val: Union[int, str]) -> str:
        """Format range boundaries as zero-padded fixed-width text for consistent lexical indexing."""
        rtype = resource_type.lower()
        if rtype == "ipv6":
            return f"{int(val):032x}"
        # For IPv4 and ASN, pad to 10 decimal digits (0 to 4294967295)
        return f"{int(val):010d}"

    def import_dataset(
        self,
        dataset: ParsedDataset,
        sha256: str,
        signature_verified: bool,
        source_file: str = "delegated-apnic-latest",
    ) -> bool:
        """Atomically import parsed dataset into SQLite using staging tables.

        If any error occurs during insertion or validation, the active database
        remains completely untouched.
        """
        conn = self.get_connection()
        try:
            # 1. Create staging tables
            conn.executescript(STAGING_SCHEMA_SQL)

            # 2. Batch insert records into resources_staging
            batch_size = 5000
            batch = []
            now_iso = datetime.now(timezone.utc).isoformat()

            insert_sql = """
            INSERT INTO resources_staging (
                registry, country_code, resource_type, start, value, date,
                status, extensions, start_num, end_num
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """

            for rec in dataset.records:
                s_norm = self._normalize_range_val(rec.resource_type, rec.start_num)
                e_norm = self._normalize_range_val(rec.resource_type, rec.end_num)
                batch.append((
                    rec.registry,
                    rec.country_code,
                    rec.resource_type,
                    rec.start,
                    rec.value,
                    rec.date,
                    rec.status,
                    rec.extensions,
                    s_norm,
                    e_norm,
                ))
                if len(batch) >= batch_size:
                    conn.executemany(insert_sql, batch)
                    batch.clear()

            if batch:
                conn.executemany(insert_sql, batch)
                batch.clear()

            # 3. Insert metadata into dataset_metadata_staging
            conn.execute(
                """
                INSERT INTO dataset_metadata_staging (
                    dataset_serial, start_date, end_date, record_count,
                    sha256, signature_verified, imported_at, source_file, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    dataset.header.serial,
                    dataset.header.startdate,
                    dataset.header.enddate,
                    len(dataset.records),
                    sha256,
                    1 if signature_verified else 0,
                    now_iso,
                    source_file,
                ),
            )

            # 4. Create indexes on staging table
            conn.executescript("""
            CREATE INDEX IF NOT EXISTS idx_staging_ipv4 ON resources_staging(resource_type, start_num, end_num) WHERE resource_type = 'ipv4';
            CREATE INDEX IF NOT EXISTS idx_staging_ipv6 ON resources_staging(resource_type, start_num, end_num) WHERE resource_type = 'ipv6';
            CREATE INDEX IF NOT EXISTS idx_staging_asn ON resources_staging(resource_type, start_num, end_num) WHERE resource_type = 'asn';
            CREATE INDEX IF NOT EXISTS idx_staging_type_cc ON resources_staging(resource_type, country_code);
            CREATE INDEX IF NOT EXISTS idx_staging_type_status ON resources_staging(resource_type, status);
            """)

            # 5. Sanity check: count matches
            cur = conn.execute("SELECT COUNT(*) FROM resources_staging")
            staged_count = cur.fetchone()[0]
            if staged_count != len(dataset.records) or staged_count != dataset.header.records:
                raise ValueError(
                    f"Staging verification failed: staged {staged_count} records != header {dataset.header.records} (records list {len(dataset.records)})"
                )

            # 6. Atomic swap inside transaction
            with conn:
                # Ensure active tables exist before swap
                conn.executescript(SCHEMA_SQL)

                # Swap tables
                conn.execute("DROP TABLE IF EXISTS resources_old;")
                conn.execute("DROP TABLE IF EXISTS dataset_metadata_old;")
                conn.execute("ALTER TABLE resources RENAME TO resources_old;")
                conn.execute("ALTER TABLE dataset_metadata RENAME TO dataset_metadata_old;")
                conn.execute("ALTER TABLE resources_staging RENAME TO resources;")
                conn.execute("ALTER TABLE dataset_metadata_staging RENAME TO dataset_metadata;")
                conn.execute("DROP TABLE IF EXISTS resources_old;")
                conn.execute("DROP TABLE IF EXISTS dataset_metadata_old;")

            logger.info(
                "Successfully published APNIC dataset serial %s with %d records",
                dataset.header.serial,
                staged_count,
            )
            return True

        except Exception as exc:
            logger.error("Failed to import APNIC dataset to SQLite: %s", exc)
            try:
                conn.execute("DROP TABLE IF EXISTS resources_staging;")
                conn.execute("DROP TABLE IF EXISTS dataset_metadata_staging;")
            except Exception:
                pass
            raise
        finally:
            conn.close()

    def lookup_ip(self, ip_str: str) -> Optional[dict[str, Any]]:
        """Lookup allocation record for an IPv4 or IPv6 address."""
        if not self.db_path.exists():
            return None

        try:
            ip_obj = ipaddress.ip_address(ip_str.strip())
        except ValueError:
            return None

        rtype = "ipv4" if ip_obj.version == 4 else "ipv6"
        target_val = (
            f"{int(ip_obj):010d}"
            if rtype == "ipv4"
            else f"{int(ip_obj):032x}"
        )

        query = """
        SELECT registry, country_code, resource_type, start, value, date, status, extensions
        FROM resources
        WHERE resource_type = ? AND start_num <= ? AND end_num >= ?
        LIMIT 1
        """

        try:
            conn = self.get_connection(read_only=True)
            try:
                cur = conn.execute(query, (rtype, target_val, target_val))
                row = cur.fetchone()
                if row:
                    return dict(row)
                return None
            finally:
                conn.close()
        except sqlite3.OperationalError:
            return None

    def lookup_asn(self, asn: Union[int, str]) -> Optional[dict[str, Any]]:
        """Lookup allocation record for an Autonomous System Number."""
        if not self.db_path.exists():
            return None

        try:
            asn_int = int(str(asn).replace("AS", "").replace("as", "").strip())
        except ValueError:
            return None

        query = """
        SELECT registry, country_code, resource_type, start, value, date, status, extensions
        FROM resources
        WHERE resource_type = 'asn' AND start_num <= ? AND end_num >= ?
        LIMIT 1
        """

        try:
            conn = self.get_connection(read_only=True)
            try:
                target_asn = f"{asn_int:010d}"
                cur = conn.execute(query, (target_asn, target_asn))
                row = cur.fetchone()
                if row:
                    return dict(row)
                return None
            finally:
                conn.close()
        except sqlite3.OperationalError:
            return None

    def get_latest_metadata(self) -> Optional[dict[str, Any]]:
        """Retrieve metadata for the currently active dataset."""
        if not self.db_path.exists():
            return None

        query = """
        SELECT id, dataset_serial, start_date, end_date, record_count,
               sha256, signature_verified, imported_at, source_file
        FROM dataset_metadata
        WHERE is_active = 1
        ORDER BY id DESC
        LIMIT 1
        """
        try:
            conn = self.get_connection(read_only=True)
            try:
                cur = conn.execute(query)
                row = cur.fetchone()
                if row:
                    return dict(row)
                return None
            finally:
                conn.close()
        except sqlite3.OperationalError:
            return None

    def get_summary_stats(self) -> dict[str, Any]:
        """Calculate counts grouped by resource_type, status, and top countries."""
        empty_summary = {
            "total_records": 0,
            "ipv4_count": 0,
            "ipv6_count": 0,
            "asn_count": 0,
            "by_status": {},
            "top_countries": {},
        }
        if not self.db_path.exists():
            return empty_summary

        try:
            conn = self.get_connection(read_only=True)
            try:
                # Type counts
                type_cur = conn.execute(
                    "SELECT resource_type, COUNT(*) as cnt FROM resources GROUP BY resource_type"
                )
                counts = {r["resource_type"]: r["cnt"] for r in type_cur.fetchall()}

                # Status counts
                status_cur = conn.execute(
                    "SELECT status, COUNT(*) as cnt FROM resources GROUP BY status"
                )
                by_status = {r["status"]: r["cnt"] for r in status_cur.fetchall()}

                # Top countries
                cc_cur = conn.execute(
                    "SELECT country_code, COUNT(*) as cnt FROM resources WHERE country_code != '*' GROUP BY country_code ORDER BY cnt DESC LIMIT 10"
                )
                top_countries = {r["country_code"]: r["cnt"] for r in cc_cur.fetchall()}

                total = sum(counts.values())
                return {
                    "total_records": total,
                    "ipv4_count": counts.get("ipv4", 0),
                    "ipv6_count": counts.get("ipv6", 0),
                    "asn_count": counts.get("asn", 0),
                    "by_status": by_status,
                    "top_countries": top_countries,
                }
            finally:
                conn.close()
        except sqlite3.OperationalError:
            return empty_summary

    def health_check(self) -> dict[str, Any]:
        """Perform a quick health and integrity check on the database."""
        if not self.db_path.exists():
            return {
                "healthy": False,
                "error": "Database file not found",
                "exists": False,
            }

        try:
            conn = self.get_connection(read_only=True)
            try:
                cur = conn.execute("PRAGMA quick_check")
                res = cur.fetchone()[0]
                meta = self.get_latest_metadata()
                return {
                    "healthy": res == "ok",
                    "integrity": res,
                    "exists": True,
                    "has_data": meta is not None,
                    "serial": meta.get("dataset_serial") if meta else None,
                    "record_count": meta.get("record_count") if meta else 0,
                }
            finally:
                conn.close()
        except Exception as exc:
            return {
                "healthy": False,
                "error": str(exc),
                "exists": True,
            }
