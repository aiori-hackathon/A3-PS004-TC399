"""Offline statistical latency baseline calculator for AegisDNS.

This script runs strictly outside the DNS resolution path. It reads real
`dns_metrics` records (either from MongoDB when --mongo-url is given and
pymongo is installed, or from the dashboard HTTP API) and computes per-device
and per-domain latency baselines (median, p95, MAD, and robust z-score).

Outliers are strictly labelled "statistical outlier" — this tool does NOT
perform intrusion detection and makes no claim of detecting attacks or threats.
Groups with fewer than --min-samples real records are skipped.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import sys
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROBUST_Z_SCALE = 0.6745


def percentile(values: list[float], pct: float) -> float:
    if not values:
        raise ValueError("Cannot compute percentile of an empty list")
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, math.ceil((pct / 100.0) * len(ordered)) - 1))
    return float(ordered[idx])


def compute_group_baseline(
    records: list[dict[str, Any]],
    min_samples: int = 10,
    z_threshold: float = 3.5,
) -> dict[str, Any] | None:
    latencies = [
        float(r["latency_ms"])
        for r in records
        if isinstance(r.get("latency_ms"), (int, float))
        and math.isfinite(float(r["latency_ms"]))
        and float(r["latency_ms"]) >= 0
    ]
    if len(latencies) < min_samples:
        return None

    med = float(statistics.median(latencies))
    p95 = percentile(latencies, 95)
    abs_devs = [abs(x - med) for x in latencies]
    mad = float(statistics.median(abs_devs))

    outliers = []
    for r in records:
        raw = r.get("latency_ms")
        if not isinstance(raw, (int, float)) or not math.isfinite(float(raw)):
            continue
        val = float(raw)
        if mad > 0:
            rz = ROBUST_Z_SCALE * (val - med) / mad
            if abs(rz) >= z_threshold:
                outliers.append({
                    "id": r.get("id", ""),
                    "timestamp": str(r.get("timestamp", "")),
                    "latency_ms": round(val, 2),
                    "robust_z": round(rz, 2),
                    "label": "statistical outlier",
                })

    return {
        "count": len(latencies),
        "median_ms": round(med, 2),
        "p95_ms": round(p95, 2),
        "mad_ms": round(mad, 2),
        "outlier_count": len(outliers),
        "outliers": outliers,
    }


def compute_baselines(
    metrics: list[dict[str, Any]],
    min_samples: int = 10,
    z_threshold: float = 3.5,
) -> dict[str, Any]:
    by_device: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_domain: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for m in metrics:
        device = str(m.get("deviceId") or m.get("client") or "unknown").strip() or "unknown"
        domain = str(m.get("query") or "").rstrip(".").lower() or "unknown"
        by_device[device].append(m)
        by_domain[domain].append(m)

    device_baselines = {}
    skipped_devices = {}
    for dev, items in sorted(by_device.items()):
        result = compute_group_baseline(items, min_samples=min_samples, z_threshold=z_threshold)
        if result is None:
            skipped_devices[dev] = len(items)
        else:
            device_baselines[dev] = result

    domain_baselines = {}
    skipped_domains = {}
    for dom, items in sorted(by_domain.items()):
        result = compute_group_baseline(items, min_samples=min_samples, z_threshold=z_threshold)
        if result is None:
            skipped_domains[dom] = len(items)
        else:
            domain_baselines[dom] = result

    return {
        "total_records": len(metrics),
        "min_samples": min_samples,
        "z_threshold": z_threshold,
        "note": "Outliers are flagged as 'statistical outlier' using median/MAD robust z-score only; this is not intrusion detection.",
        "by_device": device_baselines,
        "by_domain": domain_baselines,
        "skipped": {
            "devices_below_min_samples": skipped_devices,
            "domains_below_min_samples": skipped_domains,
        },
    }


def load_metrics_from_http(metrics_url: str) -> list[dict[str, Any]]:
    req = Request(metrics_url, headers={"Accept": "application/json"}, method="GET")
    with urlopen(req, timeout=5) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return payload.get("metrics", []) if isinstance(payload, dict) else []


def load_metrics_from_mongo(mongo_url: str, db_name: str, limit: int) -> list[dict[str, Any]]:
    try:
        from pymongo import MongoClient  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "pymongo is required for --mongo-url (or omit --mongo-url to read from --metrics-url)"
        ) from exc

    client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
    try:
        col = client[db_name]["dns_metrics"]
        cursor = col.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit)
        docs = list(cursor)
        docs.reverse()
        return docs
    finally:
        client.close()


def default_metrics_url() -> str:
    url = os.getenv("METRICS_URL", "http://127.0.0.1:3001/api/metrics").strip()
    if url.endswith("/api/metrics"):
        return url
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}/api/metrics"
    return "http://127.0.0.1:3001/api/metrics"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metrics-url", default=default_metrics_url(), help="Dashboard GET /api/metrics URL")
    parser.add_argument("--mongo-url", default="", help="Optional MongoDB connection URI (uses pymongo)")
    parser.add_argument("--mongo-db", default=os.getenv("MONGO_DB", "aegisdns"), help="MongoDB database name")
    parser.add_argument("--limit", type=int, default=5000, help="Max records to read from MongoDB")
    parser.add_argument("--min-samples", type=int, default=10, help="Minimum real records required per group")
    parser.add_argument("--z-threshold", type=float, default=3.5, help="Robust z-score threshold for statistical outlier")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    try:
        if args.mongo_url:
            metrics = load_metrics_from_mongo(args.mongo_url, args.mongo_db, args.limit)
        else:
            metrics = load_metrics_from_http(args.metrics_url)
    except Exception as exc:
        print(f"Failed to load metrics: {exc}", file=sys.stderr)
        return 1

    report = compute_baselines(metrics, min_samples=args.min_samples, z_threshold=args.z_threshold)
    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    print(f"Loaded {report['total_records']} real DNS metric record(s) (min_samples={args.min_samples})")
    if not report["by_device"] and not report["by_domain"]:
        print("Insufficient real records to compute baselines; skipped.")
        return 0

    print("\nPer-device latency baselines:")
    for dev, stats in report["by_device"].items():
        print(
            f"  {dev:<24} n={stats['count']:<5} median={stats['median_ms']} ms  "
            f"p95={stats['p95_ms']} ms  statistical_outliers={stats['outlier_count']}"
        )

    print("\nPer-domain latency baselines:")
    for dom, stats in report["by_domain"].items():
        print(
            f"  {dom:<24} n={stats['count']:<5} median={stats['median_ms']} ms  "
            f"p95={stats['p95_ms']} ms  statistical_outliers={stats['outlier_count']}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
