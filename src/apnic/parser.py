"""APNIC delegated-resource statistics dataset parser.

Parses official APNIC delegated statistics files adhering to the
RIR Statistics Exchange Format (RFC 7535 / APNIC format specification).
"""

import ipaddress
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Union

logger = logging.getLogger("apnic.parser")


@dataclass
class DatasetHeader:
    version: str
    registry: str
    serial: str
    records: int
    startdate: str
    enddate: str
    utc_offset: str


@dataclass
class ResourceRecord:
    registry: str
    country_code: str
    resource_type: str  # 'ipv4', 'ipv6', 'asn'
    start: str
    value: str
    date: str
    status: str
    extensions: str
    start_num: int
    end_num: int


@dataclass
class ParsedDataset:
    header: DatasetHeader
    records: list[ResourceRecord] = field(default_factory=list)
    summary_counts: dict[str, int] = field(default_factory=dict)
    total_parsed: int = 0
    errors: list[str] = field(default_factory=list)


class APNICParserError(ValueError):
    """Raised when the APNIC dataset is malformed or invalid."""


class APNICParser:
    """Parser for APNIC delegated statistics format."""

    VALID_TYPES = {"ipv4", "ipv6", "asn"}

    @classmethod
    def parse_header_line(cls, line: str) -> DatasetHeader:
        """Parse the 7-field dataset header line."""
        fields = line.strip().split("|")
        if len(fields) < 7:
            raise APNICParserError(
                f"Malformed APNIC dataset header: expected 7 fields, got {len(fields)}: '{line}'"
            )

        try:
            record_count = int(fields[3])
            if record_count < 0:
                raise ValueError("Record count must be non-negative")
        except ValueError as exc:
            raise APNICParserError(
                f"Invalid record count in APNIC header '{fields[3]}': {exc}"
            ) from exc

        return DatasetHeader(
            version=fields[0].strip(),
            registry=fields[1].strip(),
            serial=fields[2].strip(),
            records=record_count,
            startdate=fields[4].strip(),
            enddate=fields[5].strip(),
            utc_offset=fields[6].strip(),
        )

    @classmethod
    def calculate_range(cls, resource_type: str, start: str, value: str) -> tuple[int, int]:
        """Calculate normalized [start_num, end_num] boundaries.

        Rules:
        - IPv4: value is address count (e.g. 256) -> start_num to start_num + value - 1
        - IPv6: value is CIDR prefix length (e.g. 32) -> network_address to broadcast_address
        - ASN: value is ASN count (e.g. 1) -> start_asn to start_asn + value - 1
        """
        rtype = resource_type.lower()
        if rtype == "ipv4":
            try:
                val = int(value)
                if val <= 0:
                    raise ValueError(f"IPv4 address count must be positive, got {val}")
                ip = ipaddress.IPv4Address(start.strip())
                start_num = int(ip)
                end_num = start_num + val - 1
                if end_num > 0xFFFFFFFF:
                    raise ValueError(f"IPv4 range exceeds 32-bit address space: {end_num}")
                return start_num, end_num
            except Exception as exc:
                raise APNICParserError(f"Invalid IPv4 record (start={start}, value={value}): {exc}") from exc

        if rtype == "ipv6":
            try:
                prefix_len = int(value)
                if not (0 <= prefix_len <= 128):
                    raise ValueError(f"IPv6 prefix length must be 0-128, got {prefix_len}")
                # Use strict=False so non-zero host bits in start don't crash parser
                net = ipaddress.IPv6Network(f"{start.strip()}/{prefix_len}", strict=False)
                return int(net.network_address), int(net.broadcast_address)
            except Exception as exc:
                raise APNICParserError(f"Invalid IPv6 record (start={start}, value={value}): {exc}") from exc

        if rtype == "asn":
            try:
                start_asn = int(start.strip())
                count = int(value.strip())
                if start_asn < 0:
                    raise ValueError(f"Start ASN must be non-negative, got {start_asn}")
                if count <= 0:
                    raise ValueError(f"ASN count must be positive, got {count}")
                end_asn = start_asn + count - 1
                return start_asn, end_asn
            except Exception as exc:
                raise APNICParserError(f"Invalid ASN record (start={start}, value={value}): {exc}") from exc

        raise APNICParserError(f"Unsupported resource type '{resource_type}'")

    @classmethod
    def parse_file(cls, file_path: Union[str, Path]) -> ParsedDataset:
        """Parse an APNIC delegated file from disk."""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"APNIC dataset file not found: {path}")

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return cls.parse_lines(f)

    @classmethod
    def parse_lines(cls, lines_iterable) -> ParsedDataset:
        """Parse dataset lines."""
        header: Optional[DatasetHeader] = None
        records: list[ResourceRecord] = []
        summary_counts: dict[str, int] = {}
        errors: list[str] = []

        line_num = 0
        for raw_line in lines_iterable:
            line_num += 1
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            fields = line.split("|")

            # Check for header line (first non-comment line)
            if header is None:
                # Header starts with version (numeric, typically 2 or 2.X)
                # Format: version|registry|serial|records|startdate|enddate|UTCoffset
                if len(fields) >= 7 and fields[0].isdigit():
                    header = cls.parse_header_line(line)
                    continue
                else:
                    raise APNICParserError(
                        f"Expected APNIC header on first non-comment line (line {line_num}), got: '{line}'"
                    )

            # Check for summary lines: registry|*|type|*|count|summary
            if len(fields) >= 6 and (fields[1] == "*" or fields[5] == "summary"):
                # summary line
                rtype = fields[2].lower()
                try:
                    count = int(fields[4])
                    summary_counts[rtype] = count
                except ValueError:
                    pass
                continue

            # Standard Resource record:
            # registry|cc|type|start|value|date|status[|extensions...]
            if len(fields) < 7:
                msg = f"Line {line_num}: Insufficient fields (expected >= 7, got {len(fields)}): '{line}'"
                errors.append(msg)
                continue

            registry = fields[0].strip()
            cc = fields[1].strip()
            rtype = fields[2].strip().lower()
            start = fields[3].strip()
            value = fields[4].strip()
            date = fields[5].strip()
            status = fields[6].strip()
            extensions = "|".join(fields[7:]).strip() if len(fields) > 7 else ""

            if rtype not in cls.VALID_TYPES:
                msg = f"Line {line_num}: Unsupported resource type '{rtype}'"
                errors.append(msg)
                continue

            try:
                start_num, end_num = cls.calculate_range(rtype, start, value)
            except APNICParserError as exc:
                errors.append(f"Line {line_num}: {exc}")
                continue

            record = ResourceRecord(
                registry=registry,
                country_code=cc,
                resource_type=rtype,
                start=start,
                value=value,
                date=date,
                status=status,
                extensions=extensions,
                start_num=start_num,
                end_num=end_num,
            )
            records.append(record)

        if header is None:
            raise APNICParserError("No valid APNIC header found in dataset")

        # Validate parsed record count against header records field
        if len(records) != header.records:
            err = (
                f"Record count mismatch! Header specified {header.records} records, "
                f"but {len(records)} resource records were parsed (with {len(errors)} errors)"
            )
            logger.error(err)
            raise APNICParserError(err)

        logger.info(
            "Successfully parsed APNIC dataset: serial=%s, records=%d (asn=%d, ipv4=%d, ipv6=%d)",
            header.serial,
            len(records),
            sum(1 for r in records if r.resource_type == "asn"),
            sum(1 for r in records if r.resource_type == "ipv4"),
            sum(1 for r in records if r.resource_type == "ipv6"),
        )

        return ParsedDataset(
            header=header,
            records=records,
            summary_counts=summary_counts,
            total_parsed=len(records),
            errors=errors,
        )
