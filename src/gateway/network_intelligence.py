"""Gateway network intelligence interface for APNIC enrichment.

Provides supplementary IP and ASN allocation lookups for DNS answers
after DNSSEC verdict classification. This layer NEVER affects the DNS
response, verdict, or trust chain.
"""

import ipaddress
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any, Optional, Union

import dns.message
import dns.rdatatype

logger = logging.getLogger("gateway.network_intelligence")

# Default database location (can be overridden by APNIC_DB_PATH env var)
DEFAULT_DB_PATH = Path(
    os.getenv(
        "APNIC_DB_PATH",
        Path(__file__).resolve().parents[2] / "data" / "apnic" / "apnic.db",
    )
)


class NetworkIntelligence:
    """Read-only interface to local APNIC SQLite database."""

    def __init__(self, db_path: Optional[Union[str, Path]] = None):
        self.db_path = Path(db_path or DEFAULT_DB_PATH)

    def is_available(self) -> bool:
        """Check if the local APNIC database exists and is queryable."""
        return self.db_path.exists() and self.db_path.stat().st_size > 0

    def _get_connection(self) -> Optional[sqlite3.Connection]:
        """Open a read-only SQLite connection, returning None on failure."""
        if not self.is_available():
            return None
        try:
            # Open URI with mode=ro to enforce read-only access from gateway
            db_uri = f"file:{self.db_path.resolve().as_posix()}?mode=ro"
            conn = sqlite3.connect(
                db_uri,
                uri=True,
                timeout=1.0,  # Never hang gateway DNS handling
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            return conn
        except (sqlite3.Error, OSError) as exc:
            logger.debug("Could not open APNIC database: %s", exc)
            return None

    def lookup_ip(self, ip_str: str) -> dict[str, Any]:
        """Lookup an IP address in APNIC database.

        Returns structured result:
        - {"status": "available", "found": True, "registry": ..., "country_code": ..., "resource_type": ...}
        - {"status": "available", "found": False}
        - {"status": "unavailable", "found": False}
        """
        try:
            ip_obj = ipaddress.ip_address(ip_str.strip())
        except ValueError:
            return {"status": "invalid_input", "found": False, "ip": ip_str}

        conn = self._get_connection()
        if conn is None:
            return {"status": "unavailable", "found": False, "ip": ip_str}

        try:
            rtype = "ipv4" if ip_obj.version == 4 else "ipv6"
            target_val = (
                f"{int(ip_obj):010d}"
                if rtype == "ipv4"
                else f"{int(ip_obj):032x}"
            )

            cur = conn.execute(
                """
                SELECT registry, country_code, resource_type, start, value, date, status
                FROM resources
                WHERE resource_type = ? AND start_num <= ? AND end_num >= ?
                LIMIT 1
                """,
                (rtype, target_val, target_val),
            )
            row = cur.fetchone()
            if row:
                return {
                    "status": "available",
                    "found": True,
                    "ip": ip_str,
                    "registry": row["registry"],
                    "country_code": row["country_code"],
                    "resource_type": row["resource_type"],
                    "allocation_start": row["start"],
                    "allocation_value": row["value"],
                    "allocation_status": row["status"],
                    "allocation_date": row["date"],
                }
            return {"status": "available", "found": False, "ip": ip_str}
        except (sqlite3.Error, Exception) as exc:
            logger.debug("APNIC lookup query error for %s: %s", ip_str, exc)
            return {"status": "unavailable", "found": False, "ip": ip_str, "error": str(exc)}
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def lookup_asn(self, asn: Union[int, str]) -> dict[str, Any]:
        """Lookup an Autonomous System Number in APNIC database."""
        try:
            asn_int = int(str(asn).replace("AS", "").replace("as", "").strip())
        except ValueError:
            return {"status": "invalid_input", "found": False, "asn": asn}

        conn = self._get_connection()
        if conn is None:
            return {"status": "unavailable", "found": False, "asn": asn_int}

        try:
            target_asn = f"{asn_int:010d}"
            cur = conn.execute(
                """
                SELECT registry, country_code, resource_type, start, value, date, status
                FROM resources
                WHERE resource_type = 'asn' AND start_num <= ? AND end_num >= ?
                LIMIT 1
                """,
                (target_asn, target_asn),
            )
            row = cur.fetchone()
            if row:
                return {
                    "status": "available",
                    "found": True,
                    "asn": asn_int,
                    "registry": row["registry"],
                    "country_code": row["country_code"],
                    "allocation_start": row["start"],
                    "allocation_value": row["value"],
                    "allocation_status": row["status"],
                    "allocation_date": row["date"],
                }
            return {"status": "available", "found": False, "asn": asn_int}
        except (sqlite3.Error, Exception) as exc:
            logger.debug("APNIC ASN lookup error for %s: %s", asn_int, exc)
            return {"status": "unavailable", "found": False, "asn": asn_int, "error": str(exc)}
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def extract_answers_and_enrich(self, message: dns.message.Message) -> list[dict[str, Any]]:
        """Extract IP addresses from DNS answer section and enrich with APNIC intelligence.

        Never alters the DNS message or any DNSSEC record.
        """
        enrichments = []
        if not message or not message.answer:
            return enrichments

        for rrset in message.answer:
            if rrset.rdtype in (dns.rdatatype.A, dns.rdatatype.AAAA):
                for item in rrset:
                    ip_str = getattr(item, "address", str(item))
                    info = self.lookup_ip(ip_str)
                    enrichments.append(info)
        return enrichments
