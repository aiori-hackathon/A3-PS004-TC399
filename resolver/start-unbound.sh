#!/bin/sh
set -eu
ANCHOR="/generated/aegis-trust-anchor.key"
COUNT=0
while [ ! -s "$ANCHOR" ]; do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -gt 120 ]; then
    echo "[AegisDNS] Timed out waiting for DNSSEC trust anchor at $ANCHOR" >&2
    exit 1
  fi
  sleep 1
done

unbound-checkconf /etc/unbound/unbound.conf
exec unbound -d -c /etc/unbound/unbound.conf
