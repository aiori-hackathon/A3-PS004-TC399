"""Forward ESP32 serial telemetry to the local AegisDNS dashboard."""

import argparse
import importlib
import json
import logging
import re
import sys
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

LOG = logging.getLogger("esp32-dashboard-bridge")
HANDSHAKE_RE = re.compile(
    r"^TLS_HANDSHAKE_OK,handshake_ms=(\d+),free_heap=(\d+)$"
)
TLS_FAILURE_RE = re.compile(r"^TLS_CONNECT_FAILED,code=(-?\d+),(.*)$")
RESULT_RE = re.compile(
    r"^RESULT,([^,]+),([^,]+),rcode=(\d+),AD=([01]),"
    r"id_match=([01]),latency_ms=(\d+(?:\.\d+)?),free_heap=(\d+)$"
)


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


def post_event(dashboard_url: str, event: dict) -> None:
    payload = dict(event)
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()
    request = Request(
        f"{dashboard_url.rstrip('/')}/api/device/telemetry",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=2) as response:
        if response.status != 202:
            raise RuntimeError(f"dashboard returned HTTP {response.status}")


def run(port: str, baud: int, dashboard_url: str) -> None:
    try:
        serial = importlib.import_module("serial")
    except ImportError as exc:
        raise RuntimeError("pyserial is required; install it with 'pip install pyserial'") from exc

    LOG.info("Opening ESP32 serial port %s at %d baud", port, baud)
    with serial.Serial(port, baudrate=baud, timeout=1) as device:
        post_event(
            dashboard_url,
            {"kind": "serial_status", "connected": True, "port": port},
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
                    post_event(dashboard_url, event)
                except (OSError, URLError, RuntimeError) as exc:
                    LOG.error("Could not forward %s telemetry: %s", event["kind"], exc)
                else:
                    LOG.info("Forwarded %s telemetry", event["kind"])
        finally:
            try:
                post_event(
                    dashboard_url,
                    {"kind": "serial_status", "connected": False, "port": port},
                )
            except (OSError, URLError, RuntimeError) as exc:
                LOG.error("Could not report serial bridge shutdown: %s", exc)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="ESP32 serial port, e.g. COM13")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument(
        "--dashboard-url",
        default="http://127.0.0.1:3000",
        help="Local dashboard base URL",
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    try:
        run(args.port, args.baud, args.dashboard_url)
    except KeyboardInterrupt:
        LOG.info("Serial bridge stopped")
    except (OSError, URLError, RuntimeError) as exc:
        LOG.error("Serial bridge failed: %s", exc)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
