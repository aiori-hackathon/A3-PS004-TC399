"""Forward ESP32 serial telemetry to the local AegisDNS dashboard.

Environment variables (defaults match HOST mode):
    SERIAL_PORT    Serial device path (e.g. COM13 on Windows, /dev/ttyUSB0 on Linux)
    SERIAL_BAUD    Serial baud rate (default: 115200)
    DASHBOARD_URL  Dashboard base URL (default: derived from METRICS_URL or http://127.0.0.1:3000)
    METRICS_URL    Optional alternative URL (e.g. http://127.0.0.1:3001/api/metrics or http://dashboard:3000/api/metrics)
    DEVICE_ID      Optional device identifier; set equal to the ESP32 mTLS cert CN so
                   DNS metrics and serial telemetry line up (default: "unknown").
"""

import argparse
import importlib
import json
import logging
import math
import os
import re
import sys
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

LOG = logging.getLogger("esp32-dashboard-bridge")
SCHEMA_VERSION = 2

HANDSHAKE_RE = re.compile(
    r"^TLS_HANDSHAKE_OK,handshake_ms=(\d+),free_heap=(\d+)$"
)
TLS_FAILURE_RE = re.compile(r"^TLS_CONNECT_FAILED,code=(-?\d+),(.*)$")
RESULT_RE = re.compile(
    r"^RESULT,([^,]+),([^,]+),rcode=(\d+),AD=([01]),"
    r"id_match=([01]),latency_ms=(\d+(?:\.\d+)?),free_heap=(\d+)$"
)


def default_dashboard_url() -> str:
    explicit = os.getenv("DASHBOARD_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    metrics_url = os.getenv("METRICS_URL", "").strip()
    if metrics_url:
        parsed = urlparse(metrics_url)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    return "http://127.0.0.1:3000"


def parse_serial_line(line: str) -> dict | None:
    """Parse only complete telemetry records emitted by the firmware."""
    line = line.strip()
    if match := HANDSHAKE_RE.fullmatch(line):
        return {
            "kind": "tls_handshake",
            "latency_ms": int(match.group(1)),
            "free_heap": int(match.group(2)),
        }
    if match := TLS_FAILURE_RE.fullmatch(line):
        return {
            "kind": "tls_failure",
            "error": f"code={match.group(1)} {match.group(2)}"[:200],
        }
    if match := RESULT_RE.fullmatch(line):
        return {
            "kind": "dns_result",
            "query": match.group(1)[:253],
            "rcode": match.group(2)[:20],
            "ad": match.group(4) == "1",
            "id_match": match.group(5) == "1",
            "latency_ms": float(match.group(6)),
            "free_heap": int(match.group(7)),
        }
    return None


def build_telemetry_payload(event: dict, device_id: str | None = None) -> dict:
    """Attach contract metadata and guarantee numeric fields are real numbers."""
    payload = dict(event)
    if "latency_ms" in payload:
        val = float(payload["latency_ms"])
        if not math.isfinite(val) or val < 0:
            raise ValueError(f"Invalid latency_ms value: {payload['latency_ms']!r}")
        payload["latency_ms"] = int(val) if isinstance(payload["latency_ms"], int) else val
    if "free_heap" in payload:
        heap = int(payload["free_heap"])
        if heap < 0:
            raise ValueError(f"Invalid free_heap value: {payload['free_heap']!r}")
        payload["free_heap"] = heap
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    payload["deviceId"] = (device_id or "").strip() or "unknown"
    payload["schemaVersion"] = SCHEMA_VERSION
    return payload


def post_event(
    dashboard_url: str, event: dict, device_id: str | None = None
) -> None:
    payload = build_telemetry_payload(event, device_id=device_id)
    request = Request(
        f"{dashboard_url.rstrip('/')}/api/device/telemetry",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=2) as response:
        if response.status != 202:
            raise RuntimeError(f"dashboard returned HTTP {response.status}")


def run(
    port: str, baud: int, dashboard_url: str, device_id: str = "unknown"
) -> None:
    try:
        serial = importlib.import_module("serial")
    except ImportError as exc:
        raise RuntimeError("pyserial is required; install it with 'pip install pyserial'") from exc

    resolved_device_id = (device_id or "").strip() or "unknown"
    LOG.info(
        "Opening ESP32 serial port %s at %d baud (deviceId=%s, schemaVersion=%d)",
        port,
        baud,
        resolved_device_id,
        SCHEMA_VERSION,
    )
    with serial.Serial(port, baudrate=baud, timeout=1) as device:
        post_event(
            dashboard_url,
            {"kind": "serial_status", "connected": True, "port": port},
            device_id=resolved_device_id,
        )
        LOG.info("Forwarding ESP32 telemetry to %s", dashboard_url)
        try:
            while True:
                raw_line = device.readline()
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8", errors="replace").strip()
                event = parse_serial_line(line)
                if event is None:
                    continue
                try:
                    post_event(dashboard_url, event, device_id=resolved_device_id)
                except (OSError, URLError, RuntimeError, ValueError) as exc:
                    LOG.error("Could not forward %s telemetry: %s", event["kind"], exc)
                else:
                    LOG.info("Forwarded %s telemetry", event["kind"])
        finally:
            try:
                post_event(
                    dashboard_url,
                    {"kind": "serial_status", "connected": False, "port": port},
                    device_id=resolved_device_id,
                )
            except (OSError, URLError, RuntimeError, ValueError) as exc:
                LOG.error("Could not report serial bridge shutdown: %s", exc)


def main() -> int:
    env_port = os.getenv("SERIAL_PORT", "").strip() or None
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        default=env_port,
        required=env_port is None,
        help="ESP32 serial port, e.g. COM13 or /dev/ttyUSB0 (or set SERIAL_PORT)",
    )
    parser.add_argument("--baud", type=int, default=int(os.getenv("SERIAL_BAUD", "115200")))
    parser.add_argument(
        "--dashboard-url",
        default=default_dashboard_url(),
        help="Dashboard base URL (HOST mode: http://127.0.0.1:3001; NETWORK mode: http://dashboard:3000)",
    )
    parser.add_argument(
        "--device-id",
        default=os.getenv("DEVICE_ID", "unknown"),
        help="Optional device identifier (set equal to the mTLS cert CN so both streams line up; defaults to 'unknown')",
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    try:
        run(args.port, args.baud, args.dashboard_url, device_id=args.device_id)
    except KeyboardInterrupt:
        LOG.info("Serial bridge stopped")
    except (OSError, URLError, RuntimeError) as exc:
        LOG.error("Serial bridge failed: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
