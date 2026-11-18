"""Standard-library end-to-end smoke test and test-run recorder for AegisDNS.

Run from the project root after starting the stack with
`docker compose --env-file .env -f src/docker-compose.yml up --build -d`:
    python src/scripts/test_gateway.py

Environment variables (defaults match HOST mode):
    GATEWAY_HOST  (default: 127.0.0.1; NETWORK mode: gateway)
    GATEWAY_PORT  (default: 8853;      NETWORK mode: 853)
    METRICS_URL   (default: http://127.0.0.1:3001/api/metrics;
                   NETWORK mode: http://dashboard:3000/api/metrics)
    DASHBOARD_URL (optional override for dashboard base URL)
    PKI_DIR       (default: src/pki)
"""

import argparse
import json
import os
import socket
import ssl
import struct
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PKI = Path(os.getenv("PKI_DIR", str(ROOT / "pki")))
HOST = os.getenv("GATEWAY_HOST", "127.0.0.1")
PORT = int(os.getenv("GATEWAY_PORT", "8853"))
METRICS_URL = os.getenv("METRICS_URL", "http://127.0.0.1:3001/api/metrics")

# Authoritative test expectations encoded in the test-expectation model.
TEST_SCENARIOS = [
    {"scenario": "valid", "domain": "valid.aegis.test", "cd": False, "expectedStatus": "SECURE"},
    {"scenario": "bogus", "domain": "bogus.aegis.test", "cd": False, "expectedStatus": "BOGUS"},
    {"scenario": "insecure", "domain": "insecure.aegis.test", "cd": False, "expectedStatus": "INSECURE"},
    {"scenario": "cd_bypass", "domain": "valid.aegis.test", "cd": True, "expectedStatus": "BLOCKED_CD"},
]

DOMAINS = [s["domain"] for s in TEST_SCENARIOS if not s["cd"]]


def dashboard_base_url(metrics_url: str | None = None) -> str:
    explicit = os.getenv("DASHBOARD_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    url = (metrics_url or METRICS_URL).strip()
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return "http://127.0.0.1:3001"


def encode_name(name: str) -> bytes:
    result = bytearray()
    for label in name.rstrip(".").split("."):
        encoded = label.encode("ascii")
        if not encoded or len(encoded) > 63:
            raise ValueError(f"Invalid DNS label in {name!r}")
        result.append(len(encoded))
        result.extend(encoded)
    result.append(0)
    return bytes(result)


def recv_exact(sock: ssl.SSLSocket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        part = sock.recv(size - len(chunks))
        if not part:
            raise ConnectionError("Gateway closed the connection unexpectedly")
        chunks.extend(part)
    return bytes(chunks)


def make_query(qname: str, ident: int, cd: bool = False) -> bytes:
    # RD=1; optionally set CD=1 to verify the gateway refuses validation bypass.
    flags = 0x0100 | (0x0010 if cd else 0)
    header = struct.pack("!HHHHHH", ident, flags, 1, 0, 0, 0)
    question = encode_name(qname) + struct.pack("!HH", 1, 1)  # A / IN
    return header + question


def query(
    domain: str,
    ident: int,
    cd: bool = False,
    host: str | None = None,
    port: int | None = None,
    pki_dir: Path | None = None,
) -> dict:
    target_host = host or HOST
    target_port = port or PORT
    pki = pki_dir or PKI
    server_hostname = os.getenv("GATEWAY_TLS_SERVERNAME", "").strip() or target_host

    ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=str(pki / "rootCA.crt"))
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(str(pki / "esp32-client.crt"), str(pki / "esp32-client.key"))
    wire = make_query(domain, ident, cd=cd)
    started = time.perf_counter()
    with socket.create_connection((target_host, target_port), timeout=5) as tcp:
        with ctx.wrap_socket(tcp, server_hostname=server_hostname) as tls:
            tls.sendall(struct.pack("!H", len(wire)) + wire)
            length = struct.unpack("!H", recv_exact(tls, 2))[0]
            response = recv_exact(tls, length)
    latency_ms = (time.perf_counter() - started) * 1000
    if len(response) < 12:
        raise ValueError("Gateway returned a DNS message shorter than its header")
    rid, flags = struct.unpack_from("!HH", response, 0)
    if rid != ident:
        raise ValueError(f"DNS ID mismatch: sent {ident}, received {rid}")
    rcode = flags & 0x000F
    ad = bool(flags & 0x0020)
    status = "SECURE" if rcode in (0, 3) and ad else (
        "INSECURE" if rcode in (0, 3) else
        "SERVFAIL" if rcode == 2 else
        "REFUSED" if rcode == 5 else f"RCODE_{rcode}"
    )
    return {"domain": domain, "status": status, "rcode": rcode, "AD": ad, "latency_ms": round(latency_ms, 2)}


def fetch_metrics(base_url: str, timeout: float = 3.0) -> list[dict]:
    req = Request(f"{base_url}/api/metrics", headers={"Accept": "application/json"}, method="GET")
    with urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload.get("metrics", []) if isinstance(payload, dict) else []


def post_test_run(base_url: str, record: dict, timeout: float = 3.0) -> dict:
    req = Request(
        f"{base_url}/api/test-runs",
        data=json.dumps(record).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize_domain(name: str) -> str:
    return (name or "").rstrip(".").lower()


def build_test_run_records(
    run_id: str,
    started_at: str,
    scenarios: list[dict],
    wire_results: list[dict],
    new_metrics: list[dict],
) -> list[dict]:
    """Match each executed scenario against the real gateway metrics it produced.

    A mismatch between expectedStatus and observedStatus is recorded as
    passed=False rather than raising an exception.
    """
    remaining = list(new_metrics)
    records = []

    for scenario, wire in zip(scenarios, wire_results):
        target_domain = normalize_domain(scenario["domain"])
        matched = None
        for idx, metric in enumerate(remaining):
            if normalize_domain(metric.get("query", "")) != target_domain:
                continue
            # Disambiguate valid.aegis.test (CD=0) vs valid.aegis.test (CD=1)
            if scenario["cd"] and metric.get("status") != "BLOCKED_CD" and len(remaining) > 1:
                # Look ahead for a BLOCKED_CD metric for the same domain
                cd_idx = next(
                    (
                        j for j, m in enumerate(remaining)
                        if normalize_domain(m.get("query", "")) == target_domain
                        and m.get("status") == "BLOCKED_CD"
                    ),
                    None,
                )
                if cd_idx is not None:
                    matched = remaining.pop(cd_idx)
                    break
            matched = remaining.pop(idx)
            break

        if matched is not None:
            observed = str(matched.get("status", "UNKNOWN"))
            latency_ms = float(matched.get("latency_ms", wire["latency_ms"]))
            device_id = str(matched.get("deviceId") or matched.get("client") or "unknown")
        else:
            observed = "MISSING_METRIC"
            latency_ms = float(wire["latency_ms"])
            device_id = "unknown"

        expected = scenario["expectedStatus"]
        records.append({
            "runId": run_id,
            "deviceId": device_id,
            "startedAt": started_at,
            "scenario": scenario["scenario"],
            "domain": scenario["domain"],
            "expectedStatus": expected,
            "observedStatus": observed,
            "latency_ms": round(latency_ms, 2),
            "passed": observed == expected,
        })

    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="AegisDNS gateway smoke test & test-run recorder")
    parser.add_argument("--host", default=HOST, help=f"Gateway host (default: {HOST})")
    parser.add_argument("--port", type=int, default=PORT, help=f"Gateway port (default: {PORT})")
    parser.add_argument(
        "--dashboard-url",
        default=dashboard_base_url(),
        help="Dashboard base URL used to read metrics and store test_runs",
    )
    parser.add_argument(
        "--no-record",
        action="store_true",
        help="Run DNS queries only without recording results to /api/test-runs",
    )
    args = parser.parse_args()

    base_url = args.dashboard_url.rstrip("/")
    before_ids: set[str] = set()
    dashboard_available = False
    if not args.no_record:
        try:
            before_ids = {m["id"] for m in fetch_metrics(base_url) if "id" in m}
            dashboard_available = True
        except (OSError, URLError, ValueError) as exc:
            print(f"[WARN] Could not read {base_url}/api/metrics before run: {exc}")

    run_id = uuid.uuid4().hex[:12]
    started_at = datetime.now(timezone.utc).isoformat()
    wire_results = []

    for idx, scenario in enumerate(TEST_SCENARIOS, 1000):
        domain = scenario["domain"]
        cd = scenario["cd"]
        try:
            result = query(domain, idx, cd=cd, host=args.host, port=args.port)
            wire_results.append(result)
            suffix = " CD=1 test (expect rcode 5/REFUSED)" if cd else ""
            print(
                f"{result['domain']:<28} status={result['status']:<22} "
                f"rcode={result['rcode']} AD={int(result['AD'])} "
                f"latency={result['latency_ms']} ms{suffix}"
            )
        except Exception as exc:
            print(f"{domain:<28} FAILED: {exc}")
            raise SystemExit(1) from exc

    if args.no_record or not dashboard_available:
        return

    # Poll briefly for the gateway's async fire-and-forget metric POSTs to land.
    new_metrics: list[dict] = []
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        try:
            current = fetch_metrics(base_url)
            new_metrics = [m for m in current if m.get("id") not in before_ids]
            if len(new_metrics) >= len(TEST_SCENARIOS):
                break
        except (OSError, URLError, ValueError):
            break
        time.sleep(0.2)

    records = build_test_run_records(run_id, started_at, TEST_SCENARIOS, wire_results, new_metrics)
    stored = 0
    for rec in records:
        try:
            post_test_run(base_url, rec)
            stored += 1
        except (OSError, URLError, ValueError) as exc:
            print(f"[WARN] Could not store test run for {rec['scenario']}: {exc}")

    passed_count = sum(1 for r in records if r["passed"])
    print(
        f"[TEST_RUN] runId={run_id} stored={stored}/{len(records)} "
        f"matched={passed_count}/{len(records)}"
    )
    for rec in records:
        verdict = "PASS" if rec["passed"] else "MISMATCH"
        print(
            f"  [{verdict}] scenario={rec['scenario']:<10} domain={rec['domain']:<22} "
            f"expected={rec['expectedStatus']:<10} observed={rec['observedStatus']:<14} "
            f"latency={rec['latency_ms']} ms device={rec['deviceId']}"
        )


if __name__ == "__main__":
    main()
