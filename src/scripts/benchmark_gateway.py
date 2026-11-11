"""Measure direct-resolver and authenticated-gateway DNS latency.

Cold samples restart the local resolver to clear its cache. Warm samples are
measured only after an unrecorded lookup has primed the same query name.
"""

import argparse
import json
import math
import shutil
import socket
import ssl
import statistics
import struct
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import dns.flags
import dns.message
import dns.query
import dns.rcode
import dns.rdatatype

ROOT = Path(__file__).resolve().parents[2]
PKI = ROOT / "src" / "pki"
COMPOSE_FILE = ROOT / "src" / "docker-compose.yml"
DEFAULT_RESOLVER_HOST = "127.0.0.1"
DEFAULT_RESOLVER_PORT = 15353
DEFAULT_GATEWAY_HOST = "127.0.0.1"
DEFAULT_GATEWAY_PORT = 8853
DEFAULT_TIMEOUT = 5.0
RESOLVER_START_TIMEOUT = 20.0

SCENARIOS = (
    {
        "name": "baseline",
        "description": "Direct to Unbound, valid.aegis.test",
        "query": "valid.aegis.test.",
        "transport": "udp",
        "expected": {"rcode": "NOERROR", "ad": True},
    },
    {
        "name": "gateway",
        "description": "Authenticated gateway, valid.aegis.test",
        "query": "valid.aegis.test.",
        "transport": "tls",
        "expected": {"rcode": "NOERROR", "ad": True},
    },
    {
        "name": "bogus",
        "description": "Authenticated gateway, bogus.aegis.test",
        "query": "bogus.aegis.test.",
        "transport": "tls",
        "expected": {"rcode": "SERVFAIL", "ad": False},
    },
    {
        "name": "unauthenticated",
        "description": "Gateway without a client certificate",
        "query": "valid.aegis.test.",
        "transport": "unauthenticated_tls",
    },
)


def build_query(qname: str, ident: int) -> dns.message.QueryMessage:
    query = dns.message.make_query(
        qname,
        dns.rdatatype.A,
        use_edns=0,
        want_dnssec=True,
    )
    query.id = ident
    query.flags |= dns.flags.AD
    return query


def make_tls_context(
    host: str, *, authenticate: bool, ca_file: Path
) -> ssl.SSLContext:
    context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=str(ca_file))
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    if authenticate:
        context.load_cert_chain(
            str(PKI / "esp32-client.crt"),
            str(PKI / "esp32-client.key"),
        )
    return context


def receive_exact(sock: ssl.SSLSocket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = sock.recv(size - len(chunks))
        if not chunk:
            raise ConnectionError("Gateway closed the connection unexpectedly")
        chunks.extend(chunk)
    return bytes(chunks)


def read_tls_dns_response(
    tls: ssl.SSLSocket, query: dns.message.QueryMessage
) -> dns.message.Message:
    wire = query.to_wire()
    tls.sendall(struct.pack("!H", len(wire)) + wire)
    length = struct.unpack("!H", receive_exact(tls, 2))[0]
    response = dns.message.from_wire(receive_exact(tls, length))
    if response.id != query.id:
        raise ValueError(f"DNS ID mismatch: sent {query.id}, received {response.id}")
    return response


def response_result(
    response: dns.message.Message, latency_ms: float
) -> dict:
    return {
        "latency_ms": round(latency_ms, 3),
        "rcode": dns.rcode.to_text(response.rcode()),
        "ad": bool(response.flags & dns.flags.AD),
        "status": (
            "SECURE"
            if response.rcode() in (dns.rcode.NOERROR, dns.rcode.NXDOMAIN)
            and response.flags & dns.flags.AD
            else "INSECURE"
            if response.rcode() in (dns.rcode.NOERROR, dns.rcode.NXDOMAIN)
            else "ERROR"
        ),
    }


def query_unbound(
    qname: str,
    ident: int,
    host: str,
    port: int,
    timeout: float,
) -> dict:
    query = build_query(qname, ident)
    started = time.perf_counter()
    response = dns.query.udp(query, host, port=port, timeout=timeout)
    elapsed_ms = (time.perf_counter() - started) * 1000
    return response_result(response, elapsed_ms)


def query_gateway(
    qname: str,
    ident: int,
    host: str,
    port: int,
    timeout: float,
    *,
    authenticate: bool,
) -> dict:
    query = build_query(qname, ident)
    context = make_tls_context(
        host, authenticate=authenticate, ca_file=PKI / "rootCA.crt"
    )
    started = time.perf_counter()
    with socket.create_connection((host, port), timeout=timeout) as tcp:
        with context.wrap_socket(tcp, server_hostname=host) as tls:
            tls.settimeout(timeout)
            response = read_tls_dns_response(tls, query)
    elapsed_ms = (time.perf_counter() - started) * 1000
    return response_result(response, elapsed_ms)


def query_unauthenticated(
    qname: str,
    ident: int,
    host: str,
    port: int,
    timeout: float,
) -> dict:
    query = build_query(qname, ident)
    context = make_tls_context(
        host, authenticate=False, ca_file=PKI / "rootCA.crt"
    )
    started = time.perf_counter()
    with socket.create_connection((host, port), timeout=timeout) as tcp:
        try:
            with context.wrap_socket(tcp, server_hostname=host) as tls:
                tls.settimeout(timeout)
                response = read_tls_dns_response(tls, query)
        except (ssl.SSLError, ConnectionError) as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000
            return {
                "latency_ms": round(elapsed_ms, 3),
                "rejected": True,
                "reason": str(exc)[:160],
            }
    elapsed_ms = (time.perf_counter() - started) * 1000
    return {
        **response_result(response, elapsed_ms),
        "rejected": False,
        "reason": "Gateway returned a DNS response without client authentication",
    }


def restart_resolver() -> None:
    docker = shutil.which("docker")
    if docker is None:
        raise RuntimeError("Docker CLI is required to clear Unbound's cache for cold samples")
    command = [docker, "compose"]
    env_file = ROOT / ".env"
    if env_file.is_file():
        command.extend(["--env-file", str(env_file)])
    command.extend(["-f", str(COMPOSE_FILE), "restart", "resolver"])
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError(
            "Could not restart the resolver to clear its cache: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )


def wait_for_resolver(host: str, port: int) -> None:
    deadline = time.monotonic() + RESOLVER_START_TIMEOUT
    probe = struct.pack("!HHHHHH", 0xA3EF, 0x0100, 0, 0, 0, 0)
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
            udp.settimeout(0.5)
            try:
                udp.sendto(probe, (host, port))
                response, _ = udp.recvfrom(512)
                if len(response) >= 12 and response[:2] == probe[:2]:
                    return
            except OSError:
                pass
        time.sleep(0.1)
    raise TimeoutError(
        f"Unbound did not answer a UDP probe on {host}:{port} after resolver restart"
    )


def summarize(samples: list[dict]) -> dict:
    if not samples:
        return {"samples": 0}
    latencies = sorted(sample["latency_ms"] for sample in samples)
    p95_index = max(0, math.ceil(0.95 * len(latencies)) - 1)
    return {
        "samples": len(latencies),
        "median_ms": round(statistics.median(latencies), 3),
        "p95_ms": round(latencies[p95_index], 3),
        "min_ms": round(latencies[0], 3),
        "max_ms": round(latencies[-1], 3),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resolver-host", default=DEFAULT_RESOLVER_HOST)
    parser.add_argument("--resolver-port", type=int, default=DEFAULT_RESOLVER_PORT)
    parser.add_argument("--gateway-host", default=DEFAULT_GATEWAY_HOST)
    parser.add_argument("--gateway-port", type=int, default=DEFAULT_GATEWAY_PORT)
    parser.add_argument("--cold-samples", type=int, default=3)
    parser.add_argument("--warm-samples", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--json-out", type=Path)
    args = parser.parse_args()
    if args.cold_samples < 1 or args.warm_samples < 1:
        parser.error("--cold-samples and --warm-samples must be positive")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    return args


def run_scenario(scenario: dict, args: argparse.Namespace, ident: int) -> dict:
    if scenario["transport"] == "udp":
        return query_unbound(
            scenario["query"],
            ident,
            args.resolver_host,
            args.resolver_port,
            args.timeout,
        )
    if scenario["transport"] == "unauthenticated_tls":
        return query_unauthenticated(
            scenario["query"],
            ident,
            args.gateway_host,
            args.gateway_port,
            args.timeout,
        )
    return query_gateway(
        scenario["query"],
        ident,
        args.gateway_host,
        args.gateway_port,
        args.timeout,
        authenticate=True,
    )


def run_phase(
    phase: str,
    scenarios: tuple[dict, ...],
    args: argparse.Namespace,
    ident_start: int,
) -> tuple[dict, int]:
    summaries = {}
    ident = ident_start
    for scenario in scenarios:
        is_unauthenticated = scenario["transport"] == "unauthenticated_tls"
        count = args.cold_samples if phase == "cold" else args.warm_samples

        if phase == "warm":
            run_scenario(scenario, args, ident)
            ident = (ident + 1) & 0xFFFF

        samples = []
        for _ in range(count):
            if phase == "cold" and not is_unauthenticated:
                restart_resolver()
                wait_for_resolver(args.resolver_host, args.resolver_port)
            sample = run_scenario(scenario, args, ident)
            ident = (ident + 1) & 0xFFFF
            samples.append(sample)

        if is_unauthenticated:
            if any(not sample.get("rejected") for sample in samples):
                raise RuntimeError(
                    "Gateway accepted a connection without a client certificate"
                )
        elif any(
            sample.get("rcode") != scenario["expected"]["rcode"]
            or sample.get("ad") != scenario["expected"]["ad"]
            for sample in samples
        ):
            raise RuntimeError(
                f"Unexpected DNS verdict during {scenario['name']} benchmark"
            )

        summaries[scenario["name"]] = {
            "description": scenario["description"],
            "resolver_cache": "not_applicable" if is_unauthenticated else phase,
            **summarize(samples),
            "rejected": sum(
                sample.get("rejected") is True for sample in samples
            ),
            "responses": [
                {key: value for key, value in sample.items() if key != "latency_ms"}
                for sample in samples
            ],
        }
    return summaries, ident


def print_report(report: dict) -> None:
    for phase in ("cold", "warm"):
        print(f"\n{phase.upper()} RUN")
        print(
            f"{'Path':<18} {'Samples':>7} {'Median ms':>11} "
            f"{'p95 ms':>9} {'Min ms':>9} {'Max ms':>9} {'Rejected':>9}"
        )
        for name, result in report[phase].items():
            if name == "gateway_overhead_vs_baseline":
                continue
            print(
                f"{name:<18} {result['samples']:>7} "
                f"{result.get('median_ms', 0):>11.3f} "
                f"{result.get('p95_ms', 0):>9.3f} "
                f"{result.get('min_ms', 0):>9.3f} "
                f"{result.get('max_ms', 0):>9.3f} "
                f"{result['rejected']:>9}"
            )
        print("Unauthenticated rows measure TLS rejection; resolver cache is N/A.")

        baseline = report[phase]["baseline"]
        gateway = report[phase]["gateway"]
        delta = round(gateway["median_ms"] - baseline["median_ms"], 3)
        overhead_percent = (
            round(delta / baseline["median_ms"] * 100, 2)
            if baseline["median_ms"] else None
        )
        percent_text = (
            f"{overhead_percent:+.2f}%"
            if overhead_percent is not None else "n/a"
        )
        print(
            f"Authenticated gateway median delta vs direct baseline: "
            f"{delta:+.3f} ms ({percent_text})"
        )

def main() -> int:
    args = parse_args()
    for certificate in (
        PKI / "rootCA.crt",
        PKI / "esp32-client.crt",
        PKI / "esp32-client.key",
    ):
        if not certificate.is_file():
            print(f"Required benchmark certificate is missing: {certificate}", file=sys.stderr)
            return 1

    try:
        cold, ident = run_phase("cold", SCENARIOS, args, ident_start=2000)
        warm, _ = run_phase("warm", SCENARIOS, args, ident_start=ident)
    except (dns.exception.DNSException, OSError, RuntimeError, TimeoutError, ValueError) as exc:
        print(f"Benchmark failed: {exc}", file=sys.stderr)
        return 1

    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "configuration": {
            "resolver": f"{args.resolver_host}:{args.resolver_port}",
            "gateway": f"{args.gateway_host}:{args.gateway_port}",
            "cold_samples": args.cold_samples,
            "warm_samples": args.warm_samples,
            "timeout_seconds": args.timeout,
            "cold_definition": "Resolver restarted before every measured DNS sample.",
            "warm_definition": "One unrecorded lookup primes each exact query before sampling.",
        },
        "cold": cold,
        "warm": warm,
    }
    for phase in ("cold", "warm"):
        baseline_ms = report[phase]["baseline"]["median_ms"]
        gateway_ms = report[phase]["gateway"]["median_ms"]
        delta_ms = round(gateway_ms - baseline_ms, 3)
        report[phase]["gateway_overhead_vs_baseline"] = {
            "median_delta_ms": delta_ms,
            "median_delta_percent": (
                round(delta_ms / baseline_ms * 100, 2) if baseline_ms else None
            ),
        }
    print_report(report)
    if args.json_out:
        output_path = args.json_out.resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"\nJSON results: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
