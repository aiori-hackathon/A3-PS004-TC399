"""Standard-library end-to-end smoke test for the AegisDNS DoT listener.

Run from the project root after starting the stack with
`docker compose --env-file .env -f src/docker-compose.yml up --build -d`:
    py src/scripts/test_gateway.py
It uses the local CA and demo client certificate created by certgen.
"""

import socket
import ssl
import struct
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKI = ROOT / "pki"
HOST = "127.0.0.1"
PORT = 853
DOMAINS = [
    "valid.aegis.test",
    "bogus.aegis.test",
    "insecure.aegis.test",
]


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


def query(domain: str, ident: int, cd: bool = False) -> dict:
    ctx = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=str(PKI / "rootCA.crt"))
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(str(PKI / "esp32-client.crt"), str(PKI / "esp32-client.key"))
    wire = make_query(domain, ident, cd=cd)
    started = time.perf_counter()
    with socket.create_connection((HOST, PORT), timeout=5) as tcp:
        with ctx.wrap_socket(tcp, server_hostname=HOST) as tls:
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


def main() -> None:
    cases = [(domain, False) for domain in DOMAINS]
    cases.append(("valid.aegis.test", True))  # Expected REFUSED (rcode 5)
    for idx, (domain, cd) in enumerate(cases, 1000):
        try:
            result = query(domain, idx, cd=cd)
            suffix = " CD=1 test (expect rcode 5/REFUSED)" if cd else ""
            print(
                f"{result['domain']:<28} status={result['status']:<22} "
                f"rcode={result['rcode']} AD={int(result['AD'])} "
                f"latency={result['latency_ms']} ms{suffix}"
            )
        except Exception as exc:
            print(f"{domain:<28} FAILED: {exc}")
            raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
