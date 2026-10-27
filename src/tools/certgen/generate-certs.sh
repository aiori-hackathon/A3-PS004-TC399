#!/usr/bin/env bash
set -euo pipefail
OUT="${OUT:-/out}"
GATEWAY_IP="${GATEWAY_IP:-127.0.0.1}"
mkdir -p "$OUT"

if [[ ! -s "$OUT/rootCA.key" || ! -s "$OUT/rootCA.crt" ]]; then
  echo "[certgen] Creating development Root CA..."
  openssl genrsa -out "$OUT/rootCA.key" 3072
  openssl req -x509 -new -sha256 \
    -key "$OUT/rootCA.key" \
    -days 3650 \
    -out "$OUT/rootCA.crt" \
    -subj "/CN=AegisDNS Development Root CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
else
  echo "[certgen] Reusing existing Root CA certificate."
fi

# Re-issue end-entity certificates on each run so a changed GATEWAY_IP is reflected.
openssl genrsa -out "$OUT/server.key" 2048
openssl req -new -sha256 \
  -key "$OUT/server.key" \
  -out "$OUT/server.csr" \
  -subj "/CN=aegisdns.local"
SAN="DNS:aegisdns.local,IP:127.0.0.1"
if [[ "$GATEWAY_IP" != "127.0.0.1" ]]; then
  SAN="$SAN,IP:${GATEWAY_IP}"
fi
cat > "$OUT/server.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=${SAN}
EXT
openssl x509 -req -sha256 \
  -in "$OUT/server.csr" \
  -CA "$OUT/rootCA.crt" \
  -CAkey "$OUT/rootCA.key" \
  -CAcreateserial \
  -days 825 \
  -out "$OUT/server.crt" \
  -extfile "$OUT/server.ext"

openssl genrsa -out "$OUT/esp32-client.key" 2048
openssl req -new -sha256 \
  -key "$OUT/esp32-client.key" \
  -out "$OUT/esp32-client.csr" \
  -subj "/CN=AegisDNS ESP32 demo client"
cat > "$OUT/client.ext" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=clientAuth
EXT
openssl x509 -req -sha256 \
  -in "$OUT/esp32-client.csr" \
  -CA "$OUT/rootCA.crt" \
  -CAkey "$OUT/rootCA.key" \
  -CAcreateserial \
  -days 825 \
  -out "$OUT/esp32-client.crt" \
  -extfile "$OUT/client.ext"

chmod 600 "$OUT/rootCA.key" "$OUT/server.key" "$OUT/esp32-client.key"
chmod 644 "$OUT/rootCA.crt" "$OUT/server.crt" "$OUT/esp32-client.crt"
echo "[certgen] Certificates generated in the mounted src/pki directory."
echo "[certgen] Root CA private key is sensitive; never commit src/pki to Git."
