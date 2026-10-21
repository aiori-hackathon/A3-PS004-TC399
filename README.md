# AegisDNS

**Authenticated Gateway-Assisted DNSSEC for Resource-Constrained IoT**  
AIORI Hackathon 3 · PS-004 · IoT and Cloud Computing

AegisDNS is a lab prototype that lets a constrained IoT client send DNS queries through an authenticated DNS-over-TLS (DoT) gateway. The gateway forwards queries to a trusted Unbound resolver that validates DNSSEC, applies a policy to the result, and publishes telemetry to a live web dashboard.

> **Project status:** The local Docker-based DNSSEC lab and gateway test script have been exercised on Windows 11 with Docker Desktop. The following three resolver outcomes were observed: `valid.aegis.test` → `NOERROR` with `AD=1`; `bogus.aegis.test` → `SERVFAIL`; `insecure.aegis.test` → `NOERROR` without `AD`. The gateway test script also observed `SECURE`, `BOGUS`/`SERVFAIL`, `INSECURE`, and `BLOCKED_CD` outcomes. **ESP32 hardware integration and full baseline/performance benchmarking are still pending.**

## 1. Architecture

```text
ESP32 (Wi-Fi + mutual TLS / DNS-over-TLS, TCP 853)
                     |
                     v
         Python asyncio DoT gateway
         - validates client TLS certificate
         - rejects client queries with CD=1
         - forwards DNS queries to Unbound
         - applies SECURE / INSECURE / BOGUS / ERROR policy
         - emits latency and CPU telemetry
                     |
                     v
          Unbound validating resolver
          - local trust anchor for aegis.test
          - DNSSEC validation
                     |
                     v
          BIND9 authoritative test zones
          - valid.aegis.test
          - bogus.aegis.test
          - insecure.aegis.test (unsigned child)

Python gateway -- HTTP POST /api/metrics --> Express + Socket.io
                                               |
                                               v
                                        Live dashboard
                                        http://localhost:3000
```

**Important concepts:** TLS authenticates the gateway and protects the client-to-gateway connection. DNSSEC validates DNS data. A secure TLS connection alone does not prove that a DNS answer passed DNSSEC validation. In this lab, the gateway trusts the AD flag only from its configured, controlled Unbound resolver.

## 2. Repository layout

```text
AegisDNS/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── README_SHORT.txt
├── dns/
│   ├── Dockerfile
│   ├── named.conf
│   ├── scripts/setup-zone.sh
│   └── zone/
│       ├── aegis.test.zone
│       └── insecure.aegis.test.zone
├── resolver/
│   ├── Dockerfile
│   ├── start-unbound.sh
│   └── unbound.conf
├── gateway/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── gateway.py
├── dashboard/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── public/index.html
├── scripts/test_gateway.py
├── tools/certgen/
│   ├── Dockerfile
│   └── generate-certs.sh
└── esp32/
    ├── src/main.cpp
    └── certs/                  # local device cert files; ignored by Git
```

Generated DNSSEC material is written beneath `dns/generated/`; local TLS/PKI files are under `pki/`. These generated/private files must not be committed.

## 3. Prerequisites

For the local services:

- Windows 11 (instructions below use PowerShell)
- Docker Desktop running with the Linux/WSL 2 engine
- Git
- Python 3 for the host-side smoke-test script (`py` command on Windows)

For firmware work:

- Arduino IDE or another supported Arduino-ESP32 build environment
- ESP32 board and a USB **data** cable
- Wi-Fi network accessible to the gateway host

You do not need to install BIND9, Unbound, Node.js, or Python dependencies directly on Windows; the services and gateway dependencies run in containers. Python is needed on the host only to run `scripts/test_gateway.py` as currently provided.

## 4. Run locally on Windows

Open PowerShell in the repository directory. The examples assume `D:\AegisDNS`; adjust the path if you cloned elsewhere.

### 4.1 Configure environment

```powershell
cd D:\AegisDNS
Copy-Item .env.example .env
```

If `.env` already exists, **do not overwrite it**. Review `.env.example` for the names of supported settings. Keep `.env` local; it is ignored by Git.

### 4.2 Generate local development certificates

```powershell
docker compose --profile tools run --rm certgen
```

This generates local TLS and client credentials beneath `pki/`. The CA private key and client/server private keys are secrets; do not commit or send them through GitHub. Certificate generation must be rerun if the configured gateway hostname/address or certificate settings change.

### 4.3 Build and start the stack

```powershell
docker compose up --build -d
docker compose ps
```

Expected services are `authoritative`, `resolver`, `gateway`, and `dashboard`. Check startup logs if a service is restarting:

```powershell
docker compose logs --tail 100 authoritative
docker compose logs --tail 100 resolver
docker compose logs --tail 100 gateway
docker compose logs --tail 100 dashboard
```

Dashboard: <http://localhost:3000>  
Gateway: TCP port `853` on the Docker host.  
The current Compose configuration binds the dashboard to `127.0.0.1:3000` for local access. Do not expose the resolver or authoritative DNS service publicly.

## 5. Verify DNSSEC outcomes

Run these commands from PowerShell. The quotes around `@127.0.0.1` are important because `@` is special syntax in PowerShell.

```powershell
docker compose exec resolver dig '@127.0.0.1' valid.aegis.test A +dnssec
docker compose exec resolver dig '@127.0.0.1' bogus.aegis.test A +dnssec
docker compose exec resolver dig '@127.0.0.1' insecure.aegis.test A +dnssec
```

Expected results:

| Name | Expected DNS result | AD bit | Meaning |
|---|---|---|---|
| `valid.aegis.test` | `NOERROR` | Present (`AD=1`) | Signature validated |
| `bogus.aegis.test` | `SERVFAIL` | Absent | DNSSEC validation failed; expected for deliberately broken RRSIG |
| `insecure.aegis.test` | `NOERROR` | Absent (`AD=0`) | Unsigned/insecure child delegation; not equivalent to bogus |

A `SERVFAIL` is not universally proof of a DNSSEC failure: real resolver deployments can return it for timeouts and configuration/network errors too. The lab intentionally uses the broken-signature domain to demonstrate the bogus path.

## 6. Test the gateway and dashboard

Keep the Docker stack running and execute:

```powershell
py scripts/test_gateway.py
```

The test issues queries for the three controlled domains and sends a `CD=1` query. The observed intended outcomes are:

```text
valid.aegis.test      SECURE      rcode=0 AD=1
bogus.aegis.test      SERVFAIL    rcode=2 AD=0
insecure.aegis.test   INSECURE    rcode=0 AD=0
CD=1 test             REFUSED     rcode=5 AD=0
```

The exact spacing and latency vary. Keep <http://localhost:3000> open; accepted metrics are sent to Express at `POST /api/metrics` and broadcast to browsers through Socket.io as the `dns_metric` event.

Useful checks:

```powershell
docker compose ps
docker compose logs --tail 60 gateway
docker compose logs --tail 60 dashboard
```

If only the dashboard is being changed, rebuild just that service:

```powershell
docker compose up -d --build --force-recreate dashboard
```

Hard-refresh the browser with **Ctrl+F5**.

## 7. ESP32 teammate handoff

The current firmware source is `esp32/src/main.cpp`. It uses `WiFiClientSecure`, performs DNS-over-TLS framing (2-byte message length prefix), sends DNS A queries, and prints the response status and query latency over Serial.

### Firmware checklist

1. Install Arduino IDE and the `esp32` board package by Espressif Systems.
2. Open `esp32/src/main.cpp` in an Arduino-ESP32 project and select the correct ESP32 board and serial port when hardware is available.
3. Set the Wi-Fi SSID and password locally.
4. Use a **device-specific client certificate and private key** issued by the CA trusted by the gateway. The gateway requires mutual TLS.
5. Embed/configure the public CA certificate used to validate the gateway certificate, and verify the gateway hostname against a matching certificate SAN.
6. Set the gateway endpoint to the laptop/server LAN IP and a hostname covered by the gateway certificate. `localhost` on the ESP32 would mean the ESP32 itself, not the laptop.
7. Ensure the ESP32 and gateway host can reach each other (same LAN for the initial test), TCP 853 is allowed by the host firewall, and the gateway is running.
8. Query `valid.aegis.test`, `bogus.aegis.test`, and `insecure.aegis.test`; compare the serial output with the dashboard events.

### Credentials and collaboration warning

Do **not** commit real certificate private keys, Wi-Fi passwords, or populated PEM secrets in tracked firmware source. The starter `main.cpp` contains placeholder PEM blocks; use local, ignored credentials or refactor them to a local ignored secrets header before inserting real credentials. Never send the CA private key (`rootCA.key`) to a teammate or put it in GitHub. To test against one person's gateway, the device needs its own client certificate signed by the CA that gateway trusts; exchange device credentials securely, or let each teammate test against their own local stack/CA first.

### Hostname and IP details

The server certificate's DNS/IP Subject Alternative Name must match the hostname/IP used by the ESP32. A certificate for `aegisdns.local` will not automatically validate if the device connects by a different name or only by an IP that is absent from the certificate SAN. Check the generated certificate and configure the device's hostname resolution accordingly. Do not disable certificate verification to work around name mismatches.

## 8. Git collaboration workflow

Use a separate branch per task. Avoid committing directly to `main` for ongoing feature work.

### First publish (repository owner)

Create an **empty** GitHub repository (do not generate an additional GitHub README or `.gitignore`, since these exist locally). Then, from the project folder:

```powershell
git status
git remote add origin https://github.com/<OWNER>/AegisDNS.git
git push -u origin main
```

Replace `<OWNER>` with the GitHub account or organization. If `origin` already exists, inspect `git remote -v` instead of adding it again. Keep the repository private until secrets and publication choices have been reviewed.

Invite your teammate from GitHub repository **Settings → Collaborators**. They must accept the invitation.

### Teammate: clone and create a branch

```powershell
git clone https://github.com/<OWNER>/AegisDNS.git
cd AegisDNS
git switch -c feature/esp32-integration
Copy-Item .env.example .env
docker compose --profile tools run --rm certgen
docker compose up --build -d
```

If they only work on firmware and do not have the ESP32 yet, they can edit and compile-check the source when their toolchain is available; physical connectivity and TLS validation need the hardware and authorized credentials.

### Each contributor: commit and push their branch

```powershell
git status
git add esp32/src/main.cpp
git commit -m "feat(esp32): improve gateway client"
git push -u origin feature/esp32-integration
```

Stage only the files relevant to your own change. Then open a pull request on GitHub to merge the feature branch into `main`. For dashboard work, use a separate branch name such as `feature/dashboard-ui` and stage the relevant `dashboard/` files instead.

Before every push, check for accidentally staged secrets:

```powershell
git status --short
git diff --cached --name-only
```

Never rely on repository privacy as a substitute for keeping private credentials out of Git.

## 9. Security and prototype limitations

- This is a hackathon/lab prototype, not hardened production DNS infrastructure.
- The dashboard metrics endpoint is currently unauthenticated. Keep it on a trusted private network until gateway-to-dashboard authentication and access controls are added.
- Trust the AD bit only from the resolver that the gateway controls and protects. Do not accept an arbitrary client-supplied AD bit as proof.
- Distinguish bogus validation from transport failure, timeout, indeterminate result, and resolver configuration error before production use.
- Define an explicit policy for insecure results. This demo reports insecure separately; teams may choose to reject or return flagged results depending on the intended policy.
- Do not expose recursive DNS services (Unbound) or the authoritative lab server directly to the public Internet.
- Dashboard statistics are in-memory session data; they reset on refresh and are not a durable benchmark store.
- Full repeatable performance evaluation (baseline comparison, median/p95 latency, gateway RSS/memory, ESP32 free heap and TLS handshake timing) remains future work.

## 10. Troubleshooting

**Docker command not found**  
Start Docker Desktop, open a new terminal, and check `docker --version` and `docker info`.

**Authoritative container restarts or zone does not load**  
Inspect `docker compose logs --tail 100 authoritative`. The signed test zone must load without syntax errors.

**PowerShell errors on `@127.0.0.1`**  
Quote the argument: `dig '@127.0.0.1' ...`.

**Valid name returns `NXDOMAIN` from Unbound**  
Check `resolver/unbound.conf`, especially the `local-zone: "test." transparent` setting and the `stub-zone` for `aegis.test.`. Validate the config with `docker compose exec resolver unbound-checkconf /etc/unbound/unbound.conf` and inspect resolver logs.

**Gateway returns `SERVFAIL` for every name**  
Inspect `docker compose logs --tail 100 gateway`; confirm resolver host/port environment and ensure code changes were rebuilt with `docker compose up -d --build --force-recreate gateway`.

**No events appear on the dashboard**  
Keep the gateway and dashboard running, run `py scripts/test_gateway.py`, and inspect both service logs. Confirm that the gateway's metrics URL uses the Compose service name for the dashboard when inside Docker.

**ESP32 TLS connection fails**  
Check Wi-Fi reachability, host firewall TCP 853, client certificate trust, gateway certificate SAN/hostname match, and that the certificate/private key pair is correct. Do not disable certificate verification.

## 11. Current next milestones

- [ ] ESP32 compiles and connects to the gateway using real mutual TLS
- [ ] Confirm hostname verification and a no-plaintext-fallback failure path on hardware
- [ ] Confirm ESP32 test requests appear on the live dashboard
- [ ] Persist structured events to JSONL/CSV for repeatable evaluation
- [ ] Add a baseline-vs-AegisDNS benchmark runner and report median/p95 latency
- [ ] Measure gateway CPU and memory, and ESP32 free heap/TLS handshake timing
- [ ] Improve classification of resolver errors vs. DNSSEC-bogus outcomes
- [ ] Add authentication/access controls to the telemetry endpoint before any broader deployment

---

**Keep the secrets local. Commit source code and documentation; do not commit live credentials.**
