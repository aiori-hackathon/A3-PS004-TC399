#!/bin/bash
set -euo pipefail

ZONE="aegis.test"
GEN="/var/lib/bind/generated"
KEYDIR="$GEN/keys"
mkdir -p "$GEN" "$KEYDIR"
chmod 755 "$GEN" "$KEYDIR" 2>/dev/null || true

# Generate the authoritative-zone signing key once and persist it in the
# generated directory. For a hackathon lab only; production key management
# should use a dedicated, protected signing workflow.
# Generate a KSK (SEP flag 257) for the local trust anchor and a separate
# ZSK (flag 256) for ordinary zone data. Persist both in the host-mounted folder.
if ! grep -Eq 'DNSKEY[[:space:]]+257' "$KEYDIR"/K${ZONE}.*.key 2>/dev/null; then
  echo "[AegisDNS] Generating ECDSA DNSSEC KSK..."
  (cd "$KEYDIR" && dnssec-keygen -f KSK -a ECDSAP256SHA256 -n ZONE "$ZONE")
fi
if ! grep -Eq 'DNSKEY[[:space:]]+256' "$KEYDIR"/K${ZONE}.*.key 2>/dev/null; then
  echo "[AegisDNS] Generating ECDSA DNSSEC ZSK..."
  (cd "$KEYDIR" && dnssec-keygen -a ECDSAP256SHA256 -n ZONE "$ZONE")
fi

KEYFILE="$(grep -El 'DNSKEY[[:space:]]+257' "$KEYDIR"/K${ZONE}.*.key | head -n 1 || true)"
if [[ -z "$KEYFILE" || ! -f "$KEYFILE" ]]; then
  echo "[AegisDNS] ERROR: DNSSEC KSK public key file not found." >&2
  exit 1
fi

cp /opt/aegisdns/aegis.test.zone "$GEN/aegis.test.unsigned"
cp /opt/aegisdns/insecure.aegis.test.zone "$GEN/insecure.aegis.test.zone"

# Smart signing includes the generated DNSKEY in the signed zone.
echo "[AegisDNS] Signing aegis.test..."
(
  cd "$KEYDIR"
  dnssec-signzone -S -o "$ZONE" \
    -f "$GEN/aegis.test.zone" \
    "$GEN/aegis.test.unsigned"
)

# Create a local trust-anchor file containing the public DNSKEY.
awk '{ for (i=1; i<=NF; i++) if (toupper($i) == "DNSKEY" && $(i+1) == 257) { print; found=1; break } } END { if (!found) exit 1 }' \
  "$KEYFILE" > "$GEN/aegis-trust-anchor.key"

# Deliberately corrupt the RRSIG that covers the A RRset at bogus.aegis.test.
# Keep this alteration scoped to the lab test record only.
python3 - "$GEN/aegis.test.zone" <<'PY'
from pathlib import Path
import re

path = Path("/var/lib/bind/generated/aegis.test.zone")
text = path.read_text()

# Locate the bogus A record.
owner_pattern = re.compile(
    r"(?m)^[ \t]*bogus\.aegis\.test\."
    r"[ \t]+\d+[ \t]+IN[ \t]+A\b[^\r\n]*\r?\n"
)

owner_match = owner_pattern.search(text)

if owner_match is None:
    raise SystemExit(
        "[AegisDNS] ERROR: bogus A record not found."
    )

# BIND may omit the owner name from the following RRSIG.
remaining = text[owner_match.end():]

# Match the RRSIG A record and separate the timestamp metadata
# from the actual Base64-encoded signature.
rrsig_pattern = re.compile(
    r"^[ \t]*\d+[ \t]+RRSIG[ \t]+A\b[^\r\n]*"
    r"\([ \t]*\r?\n"
    r"[ \t]*\d{14}[ \t]+\d{14}[ \t]+\d+"
    r"[ \t]+\S+[ \t]*\r?\n"
    r"(?P<signature>[^()]*)\)",
    re.MULTILINE
)

rrsig_match = rrsig_pattern.match(remaining)

if rrsig_match is None:
    raise SystemExit(
        "[AegisDNS] ERROR: bogus RRSIG record not found "
        "in the expected format."
    )

signature_text = rrsig_match.group("signature")

# Find a character inside the signature itself, not the timestamp.
character_match = re.search(
    r"[A-Za-z0-9+/]",
    signature_text
)

if character_match is None:
    raise SystemExit(
        "[AegisDNS] ERROR: signature data is empty."
    )

position = (
    owner_match.end()
    + rrsig_match.start("signature")
    + character_match.start()
)

original = text[position]
replacement = "A" if original != "A" else "B"

text = (
    text[:position]
    + replacement
    + text[position + 1:]
)

path.write_text(text)

print(
    "[AegisDNS] Deliberately corrupted the "
    "bogus.aegis.test RRSIG."
)
print(
    f"[AegisDNS] Changed signature character "
    f"{original} to {replacement}."
)
PY

# BIND will serve the records and signatures; it is not the validating resolver.
named-checkconf /etc/bind/named.conf
chown -R bind:bind "$GEN" || true
chmod 755 "$GEN" "$KEYDIR" 2>/dev/null || true
chmod 644 "$GEN/aegis.test.zone" "$GEN/insecure.aegis.test.zone" "$GEN/aegis-trust-anchor.key" "$GEN/aegis.test.unsigned" "$KEYDIR"/*.key 2>/dev/null || true
chmod 600 "$KEYDIR"/*.private 2>/dev/null || true
mkdir -p /run/named && chown bind:bind /run/named 2>/dev/null || true
echo "[AegisDNS] Authoritative zones prepared. Starting named..."
exec named -g -u bind -c /etc/bind/named.conf
