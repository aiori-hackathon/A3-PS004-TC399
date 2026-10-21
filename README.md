# AegisDNS — local hackathon starter

A Dockerized prototype of **Authenticated Gateway-Assisted DNSSEC for Resource-Constrained IoT**. It includes a BIND9 authoritative server, an Unbound validating resolver, a mutual-TLS Python DNS-over-TLS gateway, a Node.js + Socket.io dashboard, an ESP32 Arduino sketch, and a host-side smoke test.

> **Status:** starter scaffold, not a production security product. You must run the DNSSEC checks below and confirm the three results before relying on the demo. In this lab, `SERVFAIL` is shown as `BOGUS` for the intentionally corrupted signature. A real resolver can return `SERVFAIL` for other causes too.

## What this package does

- `valid.aegis.test` — signed by the local `aegis.test` zone key; Unbound trusts that zone through a generated local trust anchor.
- `bogus.aegis.test` — the `A` signature is intentionally modified after signing; Unbound should return `SERVFAIL`.
- `insecure.aegis.test` — a separate unsigned child zone, delegated by the signed parent without a DS record; Unbound should answer without setting `AD`.
- Python listens for DNS-over-TLS on TCP/853 and requires a client certificate signed by the development CA.
- The browser dashboard receives best-effort metrics through Node.js on port 3000.

The addresses in `192.0.2.0/24` are documentation-only example addresses. They are not intended to be reachable public services.

---

## Part A — Windows 11 setup (recommended order)

### 1. Install and start Docker Desktop

Install Docker Desktop for Windows with the WSL 2 backend, start it, and wait until Docker reports that it is running. You do not need to install BIND9, Unbound, Node.js, or Python on Windows for the containerized services.

### 2. Extract this project

Download `AegisDNS_starter.zip`, then extract its contents **inside the folder named `AegisDNS`**. When extraction is done, the folder should contain `docker-compose.yml`, `README.md`, `dns`, `resolver`, `gateway`, `dashboard`, `esp32`, `scripts`, and `tools`.

For example:

```text
C:\Users\YOUR_USER\Projects\AegisDNS\docker-compose.yml
```

Do not put the zip file itself inside the project and forget to extract it.

### 3. Open PowerShell in the project folder

In File Explorer, open the `AegisDNS` folder, click the address bar, type `powershell`, and press Enter. Confirm you are in the project directory:

```powershell
Get-ChildItem
```

### 4. Create your local environment file

```powershell
Copy-Item .env.example .env
```

For a first test from the same PC, keep `GATEWAY_IP=127.0.0.1`. Before using the ESP32, replace that value with your PC's local IPv4 address from `ipconfig` (usually the Wi-Fi adapter's IPv4 address, for example `192.168.1.25`). The certificate must include the address or hostname your device will use to reach the gateway.

### 5. Generate the development certificates

Run:

```powershell
docker compose --profile tools run --rm certgen
```

This builds a small helper container and creates files under `pki`. It generates a root CA, a gateway/server certificate, and a separate ESP32 client certificate. The gateway requires the client certificate because mutual TLS is enabled.

If you change `GATEWAY_IP` after generating certificates, rerun the command so the server certificate contains the correct IP SAN. The Root CA is reused unless you manually delete `pki/rootCA.crt` and `pki/rootCA.key`.

**Keep `pki/rootCA.key`, `pki/server.key`, and `pki/esp32-client.key` private. Never commit the `pki` folder to GitHub.** These are development credentials, not production-grade enrollment or key management.

### 6. Build and launch the services

```powershell
docker compose up --build -d
```

Check that the containers are running:

```powershell
docker compose ps
```

If a container keeps restarting, inspect its logs:

```powershell
docker compose logs --tail 150 authoritative
docker compose logs --tail 150 resolver
docker compose logs --tail 150 gateway
docker compose logs --tail 150 dashboard
```

The first BIND startup generates and signs the zone. The resolver waits for the generated trust-anchor file. On the first startup, give that initialization a little time, then inspect the logs for errors.

### 7. Verify the DNSSEC results before testing the gateway

Run these commands from PowerShell:

```powershell
docker compose exec resolver dig @127.0.0.1 valid.aegis.test A +dnssec
docker compose exec resolver dig @127.0.0.1 bogus.aegis.test A +dnssec
docker compose exec resolver dig @127.0.0.1 insecure.aegis.test A +dnssec
```

Expected results:

| Query | Expected result |
|---|---|
| `valid.aegis.test` | `NOERROR`; response flags include `ad` |
| `bogus.aegis.test` | `SERVFAIL` (the deliberately corrupted RRSIG fails validation) |
| `insecure.aegis.test` | `NOERROR`; response flags do **not** include `ad` |

Look at the `status:` line and `flags:` line in the `dig` output. The insecure result should be an answer without the `ad` flag. If these results do not match, **stop here and inspect the resolver/authoritative logs**; the dashboard cannot compensate for incorrect DNSSEC setup.

### 8. Open the dashboard

Open this address in your browser:

```text
http://localhost:3000
```

The page should show `Connected to live feed`. It remains idle until a query goes through the Python gateway.

### 9. Test DNS-over-TLS from Windows

The smoke test uses only Python's standard library; it does not require `pip install`. Make sure you have Python 3.10+ installed, then run:

```powershell
py scripts/test_gateway.py
```

It connects to `127.0.0.1:853`, validates the server certificate against the Root CA, presents the client certificate, and queries all three test domains. It also sends a `CD=1` query to confirm that the gateway returns `REFUSED` (rcode 5). A successful run should show `SECURE` for the valid name, `SERVFAIL` for the bogus name, and `INSECURE` for the insecure name. It also sends event metrics to the dashboard, so the live log and latency chart should update.

If Python is not installed on Windows, you can use the ESP32 test or install Python from the official Python distribution; Docker itself does not depend on a host Python install.

### 10. Shut down

```powershell
docker compose down
```

This keeps generated DNSSEC keys and certificates. To delete containers and networks *and* reset the test data manually, stop the services first, then remove generated files from `dns/generated` and `pki`. Never delete private keys from a production deployment without understanding the consequences.

---

## Part B — ESP32 setup

### 1. Set the LAN IP before generating certificates

Run `ipconfig`, find the PC's Wi-Fi adapter IPv4 address, and put it in `.env`, for example:

```text
GATEWAY_IP=192.168.1.25
```

Then regenerate the certificates and recreate the gateway:

```powershell
docker compose --profile tools run --rm certgen
docker compose up -d --force-recreate gateway
```

Make sure TCP/853 is allowed through the Windows firewall on your private network. The ESP32 and PC should be on the same LAN. Do not expose port 853 or port 3000 to the public internet.

### 2. Copy the certificates into firmware

Open these files in the `pki` folder:

- `rootCA.crt` → paste into `ROOT_CA` in `esp32/src/main.cpp`
- `esp32-client.crt` → paste into `CLIENT_CERT`
- `esp32-client.key` → paste into `CLIENT_KEY`

Keep PEM headers and footers. Paste the complete file contents between the raw-string delimiters. Do **not** paste `rootCA.key` or `server.key` into the ESP32 sketch.

### 3. Configure and upload

Open `esp32/src/main.cpp` in Arduino IDE. Install the Espressif ESP32 board support package if you have not already done so. Set `WIFI_SSID`, `WIFI_PASSWORD`, and `GATEWAY_HOST`.

For hostname verification, set `GATEWAY_HOST` to `aegisdns.local` and arrange a local DNS/mDNS mapping from that name to the PC's LAN IP. If your network cannot resolve that name, create a local DNS host record in your router or configure the LAN name service. The certificate also includes `GATEWAY_IP` as an IP SAN, but prefer the DNS hostname so certificate-name validation follows the conventional hostname path. **Never call `setInsecure()`** to work around a certificate error.

Select your ESP32 board and serial port, upload the sketch, then open Serial Monitor at `115200` baud. It cycles through the three test names and prints DNS result, AD bit, and elapsed time.

The sketch includes TLS connection setup in its latency value because it opens a new TLS connection per query. If you need steady-state DNS-only latency, keep a TLS session open and send multiple DNS messages over the same connection.

---

## Troubleshooting

**`docker compose` cannot find certificates:** Run the certificate-generation command first. Check that `pki/server.crt`, `pki/server.key`, and `pki/rootCA.crt` exist.

**Resolver restarts waiting for the trust anchor:** Check `docker compose logs authoritative`. Confirm the generated folder contains `aegis.test.zone`, `insecure.aegis.test.zone`, and `aegis-trust-anchor.key`.

**The valid query lacks `ad`:** Do not treat the query as secure. Check the trust-anchor file, signed zone, clock, resolver logs, and BIND's zone-load logs.

**The bogus query does not produce `SERVFAIL`:** Look for the setup-script line confirming that the bogus RRSIG was corrupted. Check whether the current BIND signer output format changed; the script intentionally stops if it cannot locate the RRSIG rather than silently pretending the test succeeded.

**The insecure query has `ad`:** Check that `insecure.aegis.test` is a separate unsigned child zone and the signed parent contains no DS record for it.

**Dashboard is blank:** Check `docker compose logs dashboard gateway`, then run `py scripts/test_gateway.py`. Confirm `http://localhost:3000/health` returns JSON.

**ESP32 cannot connect:** Check the PC's LAN IP, `GATEWAY_IP`, server certificate SAN, Windows firewall, same-LAN connectivity, certificate PEM formatting, and the gateway logs. Do not disable TLS verification.

---

## Important limitations and safe-use notes

- This is a local demonstrator, not a production resolver or firewall.
- The root CA private key is used to sign demo certificates and must be kept offline in any real deployment.
- The gateway trusts Unbound's AD bit because Unbound is a controlled component on an isolated Docker network. The AD bit alone is not a cryptographic proof to an arbitrary client.
- A `SERVFAIL` can mean DNSSEC validation failure, timeout, or another resolver error. The dashboard's `BOGUS` mapping is intentionally simplified for this lab.
- The metrics API has no authentication in this starter. Keep it on a trusted lab network; add authentication and rate limits before broader use.
- The dashboard tracks events from its current browser session only and does not persist or replay historical metrics.
- `aegis.test` is a private test zone and is not a public DNSSEC delegation.
