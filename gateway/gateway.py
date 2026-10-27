"""AegisDNS lab DNS-over-TLS gateway.

This is a demonstrator, not a hardened production resolver. It enforces mutual
TLS, denies CD=1 queries, forwards DNS messages to a trusted Unbound instance,
classifies DNSSEC outcomes from that resolver, and publishes best-effort metrics.
"""

import asyncio
import copy
import json
import os
import ssl
import time
from datetime import datetime, timezone

import aiohttp
import dns.asyncquery
import dns.exception
import dns.flags
import dns.message
import dns.opcode
import dns.rcode
import dns.rdatatype
import psutil

HOST = "0.0.0.0"
PORT = 853
RESOLVER_HOST = os.getenv("RESOLVER_HOST", "127.0.0.1")
RESOLVER_PORT = int(os.getenv("RESOLVER_PORT", "53"))
METRICS_URL = os.getenv("METRICS_URL", "http://localhost:3000/api/metrics")
TLS_CERT = os.getenv("TLS_CERT", "certs/server.crt")
TLS_KEY = os.getenv("TLS_KEY", "certs/server.key")
CLIENT_CA = os.getenv("CLIENT_CA", "certs/rootCA.crt")
MAX_DNS_MESSAGE = 65535


def error_response(
    query: dns.message.Message, rcode_value: int
) -> dns.message.Message:
    """Build an error response without falsely asserting authenticated data."""
    response = dns.message.make_response(query)
    response.set_rcode(rcode_value)
    response.flags &= ~dns.flags.AD
    return response


def classify_response(response: dns.message.Message) -> str:
    """Classify according to the trusted resolver's result.

    For this lab, SERVFAIL is reported as BOGUS because the deliberately broken
    signature should cause a validation failure. In production, SERVFAIL must
    be distinguished from timeouts and other resolver failures.
    """
    rcode = response.rcode()
    authenticated = bool(response.flags & dns.flags.AD)

    if rcode == dns.rcode.SERVFAIL:
        return "BOGUS"
    if rcode in (dns.rcode.NOERROR, dns.rcode.NXDOMAIN) and authenticated:
        return "SECURE"
    if rcode in (dns.rcode.NOERROR, dns.rcode.NXDOMAIN) and not authenticated:
        return "INSECURE"
    return "ERROR"


def process_policy(
    query: dns.message.Message, upstream: dns.message.Message
) -> tuple[dns.message.Message, str]:
    """Apply gateway policy and return (downstream response, status)."""
    status = classify_response(upstream)

    if status == "BOGUS":
        # Never pass the resolver's answer data through for a bogus result.
        return error_response(query, dns.rcode.SERVFAIL), status

    # The resolver response retains its ID, question, and DNSSEC AD indication.
    return upstream, status


async def publish_metrics(
    session: aiohttp.ClientSession, payload: dict
) -> None:
    """Best-effort telemetry; dashboard failure must not break DNS handling."""
    try:
        timeout = aiohttp.ClientTimeout(total=2.0)
        async with session.post(
            METRICS_URL, json=payload, timeout=timeout
        ) as response:
            if response.status >= 400:
                print(
                    f"[METRICS] Dashboard returned HTTP {response.status}",
                    flush=True,
                )
    except Exception as exc:
        print(f"[METRICS] Delivery failed: {exc}", flush=True)


def cpu_percent() -> float:
    try:
        return float(psutil.Process().cpu_percent(interval=None))
    except Exception:
        return 0.0


async def process_query(
    query_wire: bytes, session: aiohttp.ClientSession
) -> bytes:
    start = time.perf_counter()
    qname = "unknown"
    qtype = "UNKNOWN"
    status = "ERROR"
    query = None

    try:
        # Parse the incoming message before attempting any upstream resolution.
        try:
            query = dns.message.from_wire(
                query_wire, ignore_trailing=False
            )
        except dns.exception.DNSException as exc:
            print(f"[DNS] Invalid client DNS message: {exc}", flush=True)
            return b""

        if not query.question:
            status = "ERROR"
            return error_response(query, dns.rcode.FORMERR).to_wire()

        if len(query.question) != 1:
            status = "ERROR"
            return error_response(query, dns.rcode.FORMERR).to_wire()

        question = query.question[0]
        qname = question.name.to_text()
        qtype = dns.rdatatype.to_text(question.rdtype)

        # This prototype accepts normal DNS QUERY messages only.
        if query.opcode() != dns.opcode.QUERY:
            status = "ERROR"
            return error_response(query, dns.rcode.NOTIMP).to_wire()

        # CD=1 asks the resolver to skip DNSSEC validation. Reject it here.
        if query.flags & dns.flags.CD:
            status = "BLOCKED_CD"
            return error_response(query, dns.rcode.REFUSED).to_wire()

        try:
            # IMPORTANT: dnspython Message/QueryMessage has no .copy() method.
            # copy.copy() creates a separate message, so adding AD/DO flags does
            # not mutate the original client query. The previous query.copy()
            # call raised AttributeError and converted every request to SERVFAIL.
            upstream_query = copy.copy(query)

            # Tell Unbound that we understand and want the AD bit in its reply.
            upstream_query.flags |= dns.flags.AD

            # Request DNSSEC records as well. This is not required just to get
            # AD, but is useful for diagnostics and preserves DNSSEC material.
            if upstream_query.edns < 0:
                upstream_query.use_edns(
                    edns=0,
                    ednsflags=dns.flags.DO,
                )
            else:
                upstream_query.ednsflags |= dns.flags.DO

            upstream = await dns.asyncquery.udp(
                upstream_query,
                RESOLVER_HOST,
                port=RESOLVER_PORT,
                timeout=3.0,
            )

        except (dns.exception.Timeout, OSError) as exc:
            status = "ERROR"
            print(
                f"[DNS] Resolver timeout/transport error for {qname}: {exc}",
                flush=True,
            )
            return error_response(query, dns.rcode.SERVFAIL).to_wire()
        except dns.exception.DNSException as exc:
            status = "ERROR"
            print(
                f"[DNS] Resolver DNS-protocol error for {qname}: {exc}",
                flush=True,
            )
            return error_response(query, dns.rcode.SERVFAIL).to_wire()

        response, status = process_policy(query, upstream)
        print(
            f"[DNS] {qname} {qtype}: "
            f"rcode={dns.rcode.to_text(upstream.rcode())}, "
            f"AD={int(bool(upstream.flags & dns.flags.AD))}, status={status}",
            flush=True,
        )
        return response.to_wire()

    except Exception as exc:
        status = "ERROR"
        print(f"[DNS] Unexpected processing failure: {exc!r}", flush=True)
        if query is not None:
            return error_response(query, dns.rcode.SERVFAIL).to_wire()
        return b""

    finally:
        latency_ms = (time.perf_counter() - start) * 1000.0
        metric = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "query": qname,
            "type": qtype,
            "status": status,
            "latency_ms": round(latency_ms, 2),
            "cpu_percent": round(cpu_percent(), 1),
        }
        print(json.dumps(metric), flush=True)
        asyncio.create_task(publish_metrics(session, metric))


async def read_dns_message(reader: asyncio.StreamReader) -> bytes:
    """Read one DNS-over-TCP/TLS message using its two-byte length prefix."""
    prefix = await reader.readexactly(2)
    length = int.from_bytes(prefix, "big")
    if not 1 <= length <= MAX_DNS_MESSAGE:
        raise ValueError(f"Invalid DNS message length: {length}")
    return await reader.readexactly(length)


async def write_dns_message(
    writer: asyncio.StreamWriter, wire: bytes
) -> None:
    if not wire:
        return
    writer.write(len(wire).to_bytes(2, "big") + wire)
    await writer.drain()


async def handle_client(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    session: aiohttp.ClientSession,
) -> None:
    peer = writer.get_extra_info("peername")
    print(f"[TLS] Client connected: {peer}", flush=True)

    try:
        while True:
            query_wire = await read_dns_message(reader)
            response_wire = await process_query(query_wire, session)
            if response_wire:
                await write_dns_message(writer, response_wire)
            else:
                # Invalid DNS packet: close rather than leave the client waiting.
                break
    except asyncio.IncompleteReadError:
        pass
    except (ConnectionError, OSError, ssl.SSLError) as exc:
        print(f"[TLS] Connection ended: {exc}", flush=True)
    except Exception as exc:
        print(f"[TLS] Client handler error: {exc!r}", flush=True)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        print(f"[TLS] Client disconnected: {peer}", flush=True)


async def main() -> None:
    tls = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(certfile=TLS_CERT, keyfile=TLS_KEY)
    tls.load_verify_locations(cafile=CLIENT_CA)
    tls.verify_mode = ssl.CERT_REQUIRED

    connector = aiohttp.TCPConnector(limit=100)
    async with aiohttp.ClientSession(connector=connector) as session:
        server = await asyncio.start_server(
            lambda reader, writer: handle_client(reader, writer, session),
            host=HOST,
            port=PORT,
            ssl=tls,
            limit=MAX_DNS_MESSAGE + 2,
        )
        print(
            f"[AegisDNS] Mutual-TLS DNS listener on {HOST}:{PORT}",
            flush=True,
        )
        async with server:
            await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[AegisDNS] Shutting down", flush=True)
