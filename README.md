# AegisDNS

**Authenticated Gateway-Assisted DNSSEC for Resource-Constrained IoT**\
AIORI-3 Hackathon · PS-004 · IoT and Cloud Computing

AegisDNS is a lab prototype that allows a resource-constrained IoT
client to send DNS queries through an authenticated gateway. The gateway
forwards queries to a trusted Unbound resolver that performs DNSSEC
validation, applies an explicit policy to the result, and publishes
telemetry to a live web dashboard. A separate APNIC Network Intelligence
Layer provides read-only IP allocation metadata for monitoring; it does not
participate in DNS resolution or DNSSEC verdict decisions.

**Introductory video:** https://youtu.be/FeKZ9_0cWfo
**Live Working Demo video** https://youtu.be/X0fRskhgpoM?si=rnq5qApaaiQZneeC

## Current dashboard update, ports, and quick start

The current dashboard uses the Bolt-based AegisDNS interface. It presents five main views:
`OUTCOMES`, `PATH`, `LATENCY`, `QUERIES`, and `EVENTS`. It also shows the
ESP32 → Python gateway → Unbound → BIND9 request path, the latest DNS
verdict, retained gateway metrics, distinct client labels, and latency
statistics. The dashboard reads the real gateway metrics exposed by
`GET /api/metrics`; it does not depend on a separate device-telemetry API.

### Current ports and network addresses

| Component | Host-side address / port | Container-side port | Notes |
|---|---|---|---|
| Dashboard | `127.0.0.1:3001` | `3000/tcp` | Open `http://127.0.0.1:3001`; bound to localhost only |
| DNS-over-TLS gateway | `<HOST-LAN-IP>:8853/tcp` | `853/tcp` | ESP32 connects to the host's LAN IP on port `8853` |
| Unbound resolver | Not published on the host | `53/udp`, `53/tcp` | Internal Docker network only |
| BIND9 authoritative server | Not published on the host | `53/udp`, `53/tcp` | Internal Docker network only |

The gateway sends metrics to the dashboard over the internal Docker network
at `http://dashboard:3000/api/metrics`. Do not change this internal URL to
the host dashboard port. The current Docker bridge subnet is
`172.29.0.0/24`, with the authoritative server at `172.29.0.10`, resolver
at `172.29.0.20`, gateway at `172.29.0.30`, and dashboard at
`172.29.0.40`.

### Start the project

Run these PowerShell commands from the repository root (the folder
containing `.env.example` and `src/`):

```powershell
# Create a local environment file once; do not overwrite an existing one.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }

# First-time setup only, or when certificates need to be regenerated.
docker compose --env-file .env -f src/docker-compose.yml --profile tools run --build --rm certgen

# Build and start the complete stack.
docker compose --env-file .env -f src/docker-compose.yml up --build -d

# Check service status.
docker compose --env-file .env -f src/docker-compose.yml ps
```

Open the dashboard at **http://127.0.0.1:3001**. For ESP32 access, set the
device's gateway address to the computer's LAN IP and port **8853**; do not
use `localhost` on the ESP32. Allow inbound TCP `8853` through the host
firewall when the ESP32 connects from the LAN. Keep the dashboard bound to
localhost unless remote dashboard access is intentionally configured.

Useful commands:

```powershell
# Follow gateway logs.
docker compose --env-file .env -f src/docker-compose.yml logs -f gateway

# Follow dashboard logs.
docker compose --env-file .env -f src/docker-compose.yml logs -f dashboard

# Rebuild only the dashboard after frontend changes.
docker compose --env-file .env -f src/docker-compose.yml up -d --build --force-recreate dashboard

# Stop the stack.
docker compose --env-file .env -f src/docker-compose.yml down
```

> **Project status (verified as of this README):** The local
> Docker-based DNSSEC lab and gateway test script have been exercised on
> Windows 11 with Docker Desktop. The controlled resolver outcomes
> observed were `valid.aegis.test` → `NOERROR` with `AD=1`,
> `bogus.aegis.test` → `SERVFAIL`, and `insecure.aegis.test` → `NOERROR`
> without `AD`. The gateway test script also observed `SECURE`,
> `BOGUS`/`SERVFAIL`, `INSECURE`, and `BLOCKED_CD` outcomes. The ESP32
> firmware has now been built, uploaded, and executed on hardware. Four
> consecutive hardware rounds observed the expected results for all three
> DNSSEC test names over mutual TLS. Initial handshake and query latency
> and free-heap measurements have been captured; extended evaluation and
> baseline/performance benchmarking remain pending. Features, tests,
> benchmarks, and hardware compatibility should be marked complete only
> after they have been run and verified.

## Table of Contents

1.  [Architecture](#1-architecture)
2.  [Repository Layout](#2-repository-layout)
3.  [Prerequisites](#3-prerequisites)
4.  [Run Locally on Windows](#4-run-locally-on-windows)
5.  [Verify DNSSEC Outcomes](#5-verify-dnssec-outcomes)
6.  [Test the Gateway and Dashboard](#6-test-the-gateway-and-dashboard)
7.  [ESP32 Integration and Teammate
    Handoff](#7-esp32-integration-and-teammate-handoff)
8.  [Git Collaboration Workflow](#8-git-collaboration-workflow)
9.  [Security Principles, Threat Model, and
    Limitations](#9-security-principles-threat-model-and-limitations)
10. [Troubleshooting](#10-troubleshooting)
11. [Progress and Development
    Roadmap](#11-progress-and-development-roadmap)
12. [References](#12-references)

## 1. Architecture

``` text
ESP32 client (target)
Wi-Fi + mutual TLS / DNS-over-TLS (host TCP 8853 → container TCP 853)
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
                                          http://127.0.0.1:3001
```

### Request flow

1.  The IoT client connects to the gateway over an authenticated,
    encrypted channel.
2.  The client submits a DNS query.
3.  The gateway authenticates the client and forwards the query to its
    configured resolver.
4.  Unbound performs DNSSEC validation.
5.  The gateway interprets the trusted resolver's result and applies its
    policy.
6.  The response and corresponding telemetry are returned or published
    as configured.
7.  The client should accept or reject the result according to the
    documented protocol and policy.

The local test path exercises the Docker-based resolver and gateway
using `src/scripts/test_gateway.py`. The ESP32 client has also been
uploaded and executed on target hardware; its initial DNSSEC outcomes
and timing measurements are recorded in Section 7. Extended hardware
security testing and benchmarking remain in progress.

### Important trust boundary

TLS/mTLS authenticates endpoints and protects the client-to-gateway
channel. DNSSEC validates DNS data. A successful TLS connection alone
does **not** prove that a DNS answer passed DNSSEC validation. In this
lab, the gateway trusts the `AD` flag only from its configured,
controlled Unbound resolver. Unless independent DNSSEC validation is
implemented on the device, AegisDNS does **not** claim end-to-end DNSSEC
validation by the IoT client.

## 2. Repository Layout

``` text
AegisDNS/
├── .env.example
├── .gitignore
├── .gitattributes
├── requirements.txt
├── README.md
├── README_SHORT.txt
├── A3-PS004-TC399.pdf
└── src/
    ├── README.md
    ├── docker-compose.yml
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
    ├── pki/                  # generated local certificates; ignored by Git
    └── esp32/
        ├── platformio.ini
        ├── include/secrets.h.example
        ├── src/main.cpp
        ├── tools/gen_certs_header.ps1
        └── certs/             # local device certificate files; ignored by Git
```

All application folders and Docker configuration are under `src/`.
Generated DNSSEC material is written beneath `src/dns/generated/`; local
TLS/PKI files are under `src/pki/`.

### What changed and where to run commands

- The application folders (`dashboard`, `dns`, `esp32`, `gateway`,
  `pki`, `resolver`, `scripts`, and `tools`) and
  `docker-compose.yml` are now inside `src/`.
- The root contains the README files, `.env.example`, `requirements.txt`,
  and project PDF. Create and keep your local `.env` at the root beside
  `src/`.
- `.gitattributes` keeps shell scripts in LF format so their Docker
  entrypoints work after Windows checkouts.
- Run Docker and Python commands from the repository root, not from
  `src/`. Use `-f src/docker-compose.yml` when running Compose.
- The Compose project name is pinned to `a3-ps004-tc399` to reuse this
  project's existing Docker network. Keep this name unless you also
  plan a network migration.

## 3. Prerequisites

### For the local services

-   Windows 11; the commands below use PowerShell.
-   Docker Desktop running with the Linux/WSL 2 engine.
-   Git.
-   Python 3 for the host-side smoke-test script (`py` command on
    Windows).

### For firmware work

-   Arduino IDE or another supported Arduino-ESP32 build environment.
-   ESP32 board and a **USB data cable**.
-   Wi-Fi network accessible to the gateway host.

BIND9, Unbound, Node.js, and the gateway's Python dependencies run in
containers; they do not need to be installed directly on Windows for the
documented Docker workflow. Python is required on the host to run
`src/scripts/test_gateway.py` as currently provided.

The initial verified local environment is Windows 11 with Docker
Desktop. Other operating systems and ESP32 board/framework combinations
should be tested rather than assumed compatible.

## 4. Run Locally on Windows

Open PowerShell in the repository root (the directory containing
`.env.example`, `README.md`, and `src/`). Examples assume
`D:\AegisDNS`; adjust the path if you cloned the repository elsewhere.
All Compose commands explicitly use `src/docker-compose.yml`.

### 4.1 Configure the environment

``` powershell
cd D:\AegisDNS
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

If `.env` already exists, **do not overwrite it**. Review `.env.example`
for supported settings. Keep `.env` local; it is ignored by Git.

### 4.2 Generate local development certificates

``` powershell
docker compose --env-file .env -f src/docker-compose.yml --profile tools run --build --rm certgen
```

This generates local TLS and client credentials beneath `src/pki/`. The CA
private key and client/server private keys are secrets; do not commit
them or send them through GitHub. Regenerate certificates if the
configured gateway hostname/address or certificate settings change.
After generation, the certificate paths `src/pki/rootCA.crt`,
`src/pki/server.crt`, and `src/pki/server.key` must be files, not
directories. The `--build` option ensures the certificate generator
image contains the current LF-formatted script.

### 4.3 Build and start the stack

``` powershell
docker compose --env-file .env -f src/docker-compose.yml up --build -d
docker compose --env-file .env -f src/docker-compose.yml ps
```

Expected services are `authoritative`, `resolver`, `gateway`, and
`dashboard`. Check startup logs if a service is restarting:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 authoritative
docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 resolver
docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 gateway
docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 dashboard
```

-   HTML dashboard: http://localhost:3000
-   React dashboard: http://localhost:3001
-   Gateway: TCP port `8853` on the Docker host, forwarded to port `853`
    inside the container.
-   The HTML dashboard proxies API and Socket.IO requests to the React
    dashboard's shared backend.

Do not expose the resolver or authoritative DNS service publicly.

### Docker command reference

Run these commands from the repository root (the folder containing
`.env.example` and `src/`). Docker Desktop must be running. If `.env`
does not exist yet, create it once with:

``` powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

``` powershell
# Generate local certificates (first run, or when renewing them)
docker compose --env-file .env -f src/docker-compose.yml --profile tools run --build --rm certgen

# Build images and start all services
docker compose --env-file .env -f src/docker-compose.yml up --build -d

# Check service status
docker compose --env-file .env -f src/docker-compose.yml ps

# Follow logs for all services, or replace with a service name
docker compose --env-file .env -f src/docker-compose.yml logs -f
docker compose --env-file .env -f src/docker-compose.yml logs -f gateway

# Restart/rebuild one service after changing its source
docker compose --env-file .env -f src/docker-compose.yml up -d --build --force-recreate gateway

# Stop and remove the project's containers and network
docker compose --env-file .env -f src/docker-compose.yml down
```

Replace `gateway` in the logs or rebuild command with `dashboard`,
`resolver`, or `authoritative` as needed. `down` keeps generated
certificates and DNS data in `src/`.

## 5. Verify DNSSEC Outcomes

Run these commands from PowerShell. The quotes around `@127.0.0.1` are
important because `@` has special syntax in PowerShell.

``` powershell
docker compose --env-file .env -f src/docker-compose.yml exec resolver dig '@127.0.0.1' valid.aegis.test A +dnssec
docker compose --env-file .env -f src/docker-compose.yml exec resolver dig '@127.0.0.1' bogus.aegis.test A +dnssec
docker compose --env-file .env -f src/docker-compose.yml exec resolver dig '@127.0.0.1' insecure.aegis.test A +dnssec
```

### Expected controlled-lab results

  -------------------------------------------------------------------------------
  Name                    Expected DNS      AD bit            Interpretation
                          result                              
  ----------------------- ----------------- ----------------- -------------------
  `valid.aegis.test`      `NOERROR`         Present (`AD=1`)  Signature validated

  `bogus.aegis.test`      `SERVFAIL`        Absent            DNSSEC validation
                                                              failed; the lab
                                                              deliberately uses a
                                                              broken RRSIG

  `insecure.aegis.test`   `NOERROR`         Absent (`AD=0`)   Unsigned/insecure
                                                              child delegation;
                                                              not equivalent to
                                                              bogus
  -------------------------------------------------------------------------------

These outcomes have been observed in the local lab. The gateway classifies a
`SERVFAIL` as `BOGUS` only when the resolver includes EDE code 6 (`DNSSEC
Bogus`); other `SERVFAIL` responses are classified as `ERROR`. This avoids
treating timeouts, network errors, or configuration problems as DNSSEC
validation failures.

## 6. Test the Gateway and Dashboard

Keep the Docker stack running and execute:

``` powershell
py src/scripts/test_gateway.py
```

The script queries the three controlled domains and sends a query with
`CD=1`. The observed intended outcomes are:

``` text
valid.aegis.test      SECURE      rcode=0 AD=1
bogus.aegis.test      SERVFAIL    rcode=2 AD=0
insecure.aegis.test   INSECURE    rcode=0 AD=0
CD=1 test             REFUSED     rcode=5 AD=0
```

Exact spacing and latency vary. Keep http://127.0.0.1:3001 open.
Accepted metrics are sent to Express at `POST /api/metrics` and
broadcast to browsers through Socket.io as the `dns_metric` event.
Extended DNS Error (EDE) details returned by the resolver are included in
gateway logs and shown in the latest lookup card when present.
The dashboard also retains the latest 2,000 device telemetry events in
memory. They are available from `GET /api/device/telemetry` and replayed to
browsers on Socket.IO connection, so refreshing the page restores device
history while the dashboard process is running. Restarting the dashboard
clears this in-memory history.

The regression tests are offline unit tests: they do not start Docker, contact
Unbound, or make external network requests. Install the project's Python
requirements once if they are not already installed:

```powershell
py -m pip install -r requirements.txt
```

With Python dependencies and Node.js available, run the complete suite from
the repository root with one command:

```powershell
py tests/run_tests.py
```

These tests cover gateway classification and packet handling, serial-line
parsing, and dashboard JSON payload validation. They complement the live
Docker integration test above.

Useful checks:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml ps
docker compose --env-file .env -f src/docker-compose.yml logs --tail 60 gateway
docker compose --env-file .env -f src/docker-compose.yml logs --tail 60 dashboard
```

If only the dashboard is being changed, rebuild that service:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml up -d --build --force-recreate dashboard
```

Then hard-refresh the browser with **Ctrl+F5**.

### Reporting test results

When documenting new tests, include the command executed,
software/environment versions, expected and observed outcomes, pass/fail
counts, and known gaps. Do not describe an unexecuted test as passed.
Keep resolver validation outcomes separate from gateway policy
decisions.

## 7. ESP32 Integration and Teammate Handoff

The PlatformIO project is `src/esp32/`, with firmware in
`src/esp32/src/main.cpp`. PlatformIO installs the ESP32 Arduino framework,
which provides the `Arduino.h`, `WiFi.h`, and `WiFiClientSecure.h` headers.
No separate library paths are needed for those framework libraries.

From the repository root, prepare the ignored local headers and build:

``` powershell
if (-not (Test-Path src\esp32\include\secrets.h)) {
    Copy-Item src\esp32\include\secrets.h.example src\esp32\include\secrets.h
}
# Edit src\esp32\include\secrets.h with local Wi-Fi and gateway settings.
powershell -File src\esp32\tools\gen_certs_header.ps1
pio run -d src\esp32
```

The certificate script reads credentials from `src/pki/` and generates
the ignored `src/esp32/include/certs.h`; it requires a client certificate
and key as well as the CA certificate. Never commit or share the generated
header because it contains the client private key.

When the board connects to the gateway and sends DNS queries, those
lookups are forwarded to the dashboard automatically. The dashboard
identifies a device using the common name (CN) in its mutually
authenticated client certificate; issue a distinct client certificate
CN for each device if you need to tell multiple devices apart. The
dashboard keeps up to 2,000 recent events in memory and replays them to
the page after a refresh while the dashboard process remains running.

The firmware uses
`WiFiClientSecure`, implements DNS-over-TLS framing with a 2-byte
message-length prefix, sends DNS A queries, and prints response status
and query latency over Serial. The client is configured for mutual TLS
using the trusted CA certificate, client certificate, and client private
key. It verifies the DNS transaction ID and consumes response bodies in
bounded chunks; query read or identity failures terminate the TLS
connection rather than continuing with an uncertain stream. The source
has explicit `<string.h>` and `<esp_system.h>` includes for its direct
`strlen`/`strchr`/`memcpy` and `esp_random()` use. The firmware build,
upload, and hardware execution have been completed.

### Initial ESP32 hardware results

The following observations were captured from four consecutive rounds
on the ESP32. Each round established a TLS connection and queried all
three test names. These are initial samples, not a completed benchmark.

| Measurement | Observed result |
| --- | ---: |
| TLS handshake latency | 891–907 ms; mean 899.5 ms (4 samples) |
| `valid.aegis.test` | `NOERROR`, `AD=1`, transaction ID matched in all 4 samples |
| `bogus.aegis.test` | `SERVFAIL`, `AD=0`, transaction ID matched in all 4 samples |
| `insecure.aegis.test` | `NOERROR`, `AD=0`, transaction ID matched in all 4 samples |
| Valid-query latency | 13.84–43.78 ms; mean 26.55 ms (4 samples) |
| Bogus-query latency | 18.52–53.53 ms; mean 27.28 ms (4 samples) |
| Insecure-query latency | 18.00–53.26 ms; mean 34.56 ms (4 samples) |
| Free heap after TLS handshake | 181,468–181,496 bytes |

The observed DNSSEC behavior is consistent with the expected validating
resolver outcomes: valid data is returned with the AD flag set, bogus
data is rejected with `SERVFAIL`, and insecure data is returned without
AD. DNSSEC validation occurs at the gateway's configured resolver; the
ESP32 does not independently validate DNSSEC signatures. Query latency
is measured by the firmware from before the query write until the full
response has been consumed, and therefore includes client-side send/read
time as well as gateway/resolver response time.

### Firmware checklist

1.  Open `src/esp32/` as a PlatformIO project; `platformio.ini` selects
    the ESP32 Arduino framework and board.
2.  Set the Wi-Fi SSID and password in the ignored local
    `src/esp32/include/secrets.h`.
3.  Use a **device-specific client certificate and private key** issued
    by the CA trusted by the gateway. The gateway requires mutual TLS.
4.  Configure the public CA certificate used to validate the gateway
    certificate, and verify the gateway hostname against a matching
    certificate Subject Alternative Name (SAN); generate the ignored
    `certs.h` with `src/esp32/tools/gen_certs_header.ps1`.
5.  Set the gateway endpoint to the laptop/server LAN IP and a hostname
    covered by the gateway certificate. `localhost` on the ESP32 refers
    to the ESP32 itself, not the laptop.
6.  Ensure the ESP32 and gateway host can reach each other (same LAN for
    the initial test), TCP 8853 is allowed by the host firewall, and the
    gateway is running.
7.  Query `valid.aegis.test`, `bogus.aegis.test`, and
    `insecure.aegis.test`; compare serial output with dashboard events.
8.  Record board model, framework/library versions, connection result,
    observed responses, and any memory or timing measurements.

### Credentials and collaboration warning

Do **not** commit real certificate private keys, Wi-Fi passwords, or
populated PEM secrets in tracked firmware source. Keep Wi-Fi settings in
the ignored `secrets.h` and certificate PEMs in the ignored generated
`certs.h`; the latter contains a client private key.

Never send the CA private key (`rootCA.key`) to a teammate or put it on
GitHub. To test against another person's gateway, the device needs its
own client certificate signed by the CA that gateway trusts. Exchange
device credentials securely, or have each teammate test against their
own local stack/CA first.

### Hostname and IP details

The server certificate's DNS/IP SAN must match the hostname or IP used
by the ESP32. A certificate for `aegisdns.local` will not automatically
validate if the device connects using a different name or an IP absent
from the certificate SAN. Check the generated certificate and configure
device hostname resolution accordingly. **Do not disable certificate
verification** to work around name mismatches.

## 8. Security Principles, Threat Model, and Limitations

### Security principles

AegisDNS keeps three security functions distinct:

-   **DNSSEC:** Authenticates DNS data and protects its integrity
    through the DNSSEC chain of trust. DNSSEC does not encrypt DNS
    queries.
-   **TLS/mTLS:** Protects the client-to-gateway channel and
    authenticates communicating endpoints according to the configured
    certificate trust policy.
-   **Gateway policy enforcement:** Decides whether a response may be
    returned based on the trusted resolver's validation outcome and the
    configured policy.

### Validation outcomes and intended handling

  -----------------------------------------------------------------------
  Outcome                 Meaning                 Intended handling
  ----------------------- ----------------------- -----------------------
  `SECURE`                DNSSEC validation       Permit according to
                          succeeded               policy

  `INSECURE`              DNS data is not         Apply an explicit,
                          authenticated by        documented policy
                          DNSSEC; this alone does 
                          not prove an attack     

  `BOGUS`                 DNSSEC validation       Reject the response
                          failed                  

  `INDETERMINATE`         A reliable validation   Fail closed by default
                          outcome could not be    
                          established             

  Resolver error /        Resolver could not      Return an explicit
  timeout                 provide a reliable      error; never report it
                          result                  as secure
  -----------------------------------------------------------------------

The exact mapping from resolver responses to these outcomes must be
tested against the selected Unbound version and configuration. The
current lab demonstrates secure, bogus, insecure, and `CD=1` rejection
paths. Additional error classification and failure-path coverage remain
development work.

### Threats the design aims to address

-   Forged DNS data that fails DNSSEC validation.
-   Unauthorized clients attempting to access the gateway.
-   Gateway impersonation when certificate validation is correctly
    configured.
-   Accidental acceptance of bogus, indeterminate, or failed resolver
    outcomes.
-   Malformed requests and basic resource-abuse scenarios, subject to
    implemented limits.

### Limitations and safeguards

-   This is a hackathon/lab prototype, not hardened production DNS
    infrastructure or a production security certification.
-   The gateway is a trusted security component and a potential single
    point of failure. A compromised gateway could misreport validation
    status or return manipulated data.
-   mTLS secures the client-to-gateway channel but does not, by itself,
    prove that a DNS answer is authentic.
-   The dashboard metrics endpoint is currently unauthenticated. Keep it
    on a trusted private network until gateway-to-dashboard
    authentication and access controls are added.
-   Trust the `AD` bit only from the resolver that the gateway controls
    and protects; do not accept an arbitrary client-supplied `AD` bit as
    proof.
-   Distinguish DNSSEC-bogus outcomes from transport failures, timeouts,
    indeterminate results, and resolver configuration errors before
    production use.
-   Define an explicit policy for insecure results. This demo reports
    them separately; a deployment may reject or return flagged results
    depending on its requirements.
-   Do not expose recursive DNS services (Unbound) or the authoritative
    lab server directly to the public Internet.
-   Dashboard statistics are in-memory session data and reset on
    refresh; they are not a durable benchmark store.
-   ESP32 compatibility depends on the board, framework, certificate
    handling, memory limits, and TLS libraries. Simulator/laptop
    performance may not represent constrained-hardware performance.
-   Availability depends on the gateway, resolver, network, and power
    supply.

Future hardening could include gateway redundancy, key rotation, rate
limiting, persistent monitoring, gateway-to-dashboard authentication,
and independent validation strategies.

## 10. Troubleshooting

**Docker command not found**\
Start Docker Desktop, open a new terminal, and check `docker --version`
and `docker info`.

**Docker reports `Pool overlaps with other one on this address space`**\
Confirm that you are running Compose from the repository root and using
`-f src/docker-compose.yml`. This file pins the project name so it
reuses the AegisDNS network. If the error continues, another Docker
network may be using the configured `172.29.0.0/24` subnet. Check
`docker network ls` and inspect the relevant network before changing
anything. Do not remove or prune networks belonging to other projects.
The subnet is paired with static service IPs in `src/docker-compose.yml`;
changing it requires updating those addresses and the gateway's resolver
address together.

**Container says `bash\r` or a startup script cannot be found**\
The shell scripts should use LF line endings, enforced by the root
`.gitattributes`. Rebuild the affected image from the repository root:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml up --build --force-recreate -d
```

**Authoritative container restarts or zone does not load**\
Inspect `docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 authoritative`. The signed test
zone must load without syntax errors.

**PowerShell errors on `@127.0.0.1`**\
Quote the argument: `dig '@127.0.0.1' ...`.

**Valid name returns `NXDOMAIN` from Unbound**\
Check `src/resolver/unbound.conf`, especially the
`local-zone: "test." transparent` setting and the `stub-zone` for
`aegis.test.`. Validate the configuration with:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml exec resolver unbound-checkconf /etc/unbound/unbound.conf
```

Then inspect resolver logs.

**Gateway test reports `Permission denied` or the gateway keeps restarting**\
Check `docker compose --env-file .env -f src/docker-compose.yml ps` and
the gateway logs. If certificate generation was skipped or failed, run:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml --profile tools run --build --rm certgen
docker compose --env-file .env -f src/docker-compose.yml up --build --force-recreate -d
```

Then confirm `src/pki/server.crt`, `src/pki/server.key`, and
`src/pki/rootCA.crt` are files, not directories. Never commit the private
keys.

**Gateway returns `SERVFAIL` for every name**\
Inspect `docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 gateway`. Confirm resolver
host/port environment settings and ensure code changes were rebuilt:

``` powershell
docker compose --env-file .env -f src/docker-compose.yml up -d --build --force-recreate gateway
```

**No events appear on the dashboard**\
Keep the gateway and dashboard running, execute
`py src/scripts/test_gateway.py`, and inspect both service logs. Confirm
that the gateway's metrics URL uses the Compose service name for the
dashboard when called from inside Docker.

**ESP32 TLS connection fails**\
Check Wi-Fi reachability, host firewall TCP 8853, client certificate
trust, gateway certificate SAN/hostname match, and that the
certificate/private-key pair is correct. Do not disable certificate
verification.

## 11. Progress and Development Roadmap

The checklist below distinguishes verified local work from pending work.
Update it only when a task has actually been completed and verified.

### Verified in the current local lab

-   [x] Docker-based local DNSSEC lab runs on Windows 11 with Docker
    Desktop.
-   [x] Controlled resolver outcomes observed for valid, bogus, and
    insecure test domains.
-   [x] Gateway test script observed `SECURE`, `BOGUS`/`SERVFAIL`,
    `INSECURE`, and `BLOCKED_CD` outcomes.
-   [x] Gateway telemetry can be sent to the dashboard during the local
    test flow.

### Verified ESP32 milestones

-   [x] Compile the ESP32 firmware with PlatformIO.
-   [x] Upload the firmware and execute it on the target ESP32 hardware.
-   [x] Establish the configured mutual-TLS connection to the gateway
    and receive DNS responses for the three test names.
-   [x] Observe the expected valid (`NOERROR`, `AD=1`), bogus
    (`SERVFAIL`, `AD=0`), and insecure (`NOERROR`, `AD=0`) outcomes
    across four consecutive rounds.
-   [x] Capture initial TLS handshake latency, query latency, transaction
    ID match, and free-heap readings in the serial output.
-   [x] Run at least 30–50 consecutive rounds and save the complete
    serial output for extended evaluation.
-   [x] Calculate mean, median, minimum, maximum, and p95 query latency
    from the extended sample set.
-   [x] Confirm hostname verification and test the no-plaintext-fallback
    failure path on hardware.
-   [x] Test rejection of an untrusted gateway certificate and an
    invalid client certificate.
-   [x] Confirm ESP32 test requests appear on the live dashboard.
-   [x] Persist structured events to JSONL/CSV for repeatable
    evaluation.
-   [x] Improve classification of resolver errors versus DNSSEC-bogus
    outcomes.

### Pending milestones

-   [ ] Add automated unit and integration tests for authentication,
    malformed requests, resolver failures, timeouts, and validation
    outcomes.
-   [ ] Add authentication/access controls to the telemetry endpoint
    before any broader deployment.
-   [x] Implement a baseline-versus-AegisDNS benchmark runner with separate
    cold-cache and warm-cache measurements.
-   [ ] Measure median and p95 latency, throughput, success/rejection
    rates, gateway CPU/RSS memory, resolver response time, TLS/mTLS
    overhead, and ESP32 free heap/handshake timing where applicable.
-   [ ] Record hardware, software versions, cache state, query mix,
    concurrency, duration, and sample count; separate cold-cache and
    warm-cache runs where practical.
-   [ ] Finalize setup instructions and retain demo/test evidence.

### Benchmarking guidelines

Compare clearly defined configurations:

1.  **Baseline:** DNS lookup through the selected resolver without the
    AegisDNS gateway application layer.
2.  **Gateway path:** DNS lookup through the authenticated gateway and
    DNSSEC-validation path.
3.  **Negative cases:** Bogus DNSSEC responses and unauthenticated
    connection attempts.

The local benchmark runner compares direct Unbound, authenticated gateway,
bogus-signature, and unauthenticated-gateway paths. It reports cold and warm
samples separately, including median and p95 latency. Cold DNS samples restart
Unbound before each measurement; warm samples prime the same query first.
Unauthenticated TLS rejection does not query Unbound, so its cache state is
reported as not applicable. The cold run therefore briefly interrupts other
clients using the local resolver.

Start the Compose stack and generate the local PKI files first, then run from
the repository root:

```powershell
py src/scripts/benchmark_gateway.py --cold-samples 3 --warm-samples 20
```

The resolver is published only on `127.0.0.1:15353` for direct baseline
measurements. The gateway listens on port `853` inside Docker and is published
as `127.0.0.1:8853` on the host. Each run writes a persistent
`benchmark-results.json` file in the repository root (override with
`--json-out`). It records separate baseline and gateway results, sample count,
median and p95 latency, success/failure counts, per-sample responses, and the
observed EDE-based DNSSEC verdict plus verdict counts. These direct measurements
are the benchmark record; in-memory dashboard metrics are not used. Results
are local to the hardware and should not be compared without recording system
load and configuration. Success counts mean the measured DNS response matches
the expected RCODE/AD bits, or that the unauthenticated TLS connection was
rejected; DNSSEC verdicts are recorded independently. The `bogus` path checks
for the configured invalid-signature test domain returning `SERVFAIL` with
`AD=false`; if Unbound omits DNSSEC Bogus EDE, the gateway's observed verdict
is `ERROR`, not `BOGUS`, and that distinction is retained in each JSON response.
Each gateway sample opens a new TCP/TLS connection, so the latency delta
includes connection setup and mTLS authentication rather than DNS processing
alone.

## 11.5 Persistence, Networking Modes & Offline Baselines

### MongoDB Persistence & Device Correlation
When started via Docker Compose, the dashboard persists data to an internal-only `mongodb` container (`mongo:7.0.14`, static IP `172.29.0.50` on `aegis_net`, no published host port) using a single database (`aegisdns`) keyed by `deviceId`:
- `devices`: auto-created per normalised mTLS client CN (or telemetry `deviceId`), tracking `firstSeen` and `lastSeen`.
- `dns_metrics` & `device_telemetry`: MongoDB time-series collections (`timeField: timestamp`, `metaField: deviceId`) with configurable TTL retention (`RETENTION_DAYS`, default `30` days).
- `test_runs`: stores observed-vs-expected results from `src/scripts/test_gateway.py` (`GET /api/test-runs`).
- **Degraded mode:** If MongoDB stops mid-run, the dashboard buffers writes in memory, continues returning `202` and broadcasting over Socket.IO, exposes `storage: "degraded"` on `GET /health`, and replays buffered records without duplicates when MongoDB returns.
- **Device correlation:** DNS metrics derive `deviceId` from the mTLS client certificate CN (`client`). Set `DEVICE_ID` (or `--device-id`) on `src/tools/serial_to_dashboard.py` to that same CN (for example `esp32-client`) so gateway metrics and ESP32 serial telemetry line up under one device entry; otherwise telemetry defaults to `unknown`.
- **Migrating from in-memory mode:** Add `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DB`, and `RETENTION_DAYS` from `.env.example` to your local `.env`, then restart with `docker compose --env-file .env -f src/docker-compose.yml up -d --build`. If `MONGO_URL` is unset (e.g. direct `node server.js` or unit tests), the dashboard falls back to in-memory mode automatically.

### HOST Mode vs NETWORK Mode
- **HOST mode (default when running Python directly on your laptop/PC):**
  - `GATEWAY_HOST=127.0.0.1`, `GATEWAY_PORT=8853`, `METRICS_URL=http://127.0.0.1:3001/api/metrics`, `DASHBOARD_URL=http://127.0.0.1:3001`.
  - Run smoke tests & record `test_runs`: `python src/scripts/test_gateway.py`
  - Run offline statistical latency baseline (outside DNS path): `python src/scripts/latency_baseline.py`
  - Run ESP32 serial bridge: `python src/tools/serial_to_dashboard.py --port COM13 --device-id esp32-client`
- **NETWORK mode (running tools inside `aegis_net` via Compose profiles):**
  - `GATEWAY_HOST=gateway`, `GATEWAY_PORT=853`, `METRICS_URL=http://dashboard:3000/api/metrics`, `DASHBOARD_URL=http://dashboard:3000`.
  - Run containerized smoke test: `docker compose --env-file .env -f src/docker-compose.yml --profile tools run --rm gateway-tester`
  - **Linux / Raspberry Pi edge nodes only (`serial-linux` profile):** USB serial passthrough (`devices:`) works on Linux hosts, **not** on Docker Desktop for Windows/macOS. On Linux, run `docker compose --env-file .env -f src/docker-compose.yml --profile serial-linux up -d serial-bridge`. On Windows/macOS, run `serial_to_dashboard.py` directly on the host in HOST mode.

## 11.6 APNIC Network Intelligence Layer

AegisDNS includes an independent **APNIC Network Intelligence Layer** that ingests official APNIC delegated-resource allocation data, maintains a local searchable SQLite database, and provides supplementary network intelligence to the gateway and dashboard without ever becoming part of the DNSSEC trust or validation chain.

### Current implementation status

The implementation includes the updater daemon, atomic SQLite publication,
read-only gateway enrichment, read-only dashboard APIs, and APNIC monitor views
for both the React and HTML dashboards. DNSSEC validation and DNS response
handling remain unchanged.

A local ingestion snapshot has observed serial `20261119` with `89,809`
resource records: `58,433` IPv4, `17,350` IPv6, and `14,026` ASN records.
The top allocated country-code counts observed in that snapshot were AU, IN,
CN, ID, and BD. These allocation statistics are supplementary network metadata;
they are not proof of live routing or physical server location.

The MD5 sidecar is implemented and checked. OpenPGP signature verification is
not active until an operator independently configures the signing trust anchor:

- the code does **not** hardcode or automatically trust a key fingerprint;
- a fingerprint must be verified out-of-band against APNIC's published
  signing-key information;
- without `APNIC_GPG_FINGERPRINT`, status remains
  `PENDING_KEY_CONFIGURATION`;
- a locally present "good signature" result from GPG alone is not sufficient
  for deployment unless the configured key fingerprint is first verified.

### 1. Architectural Principle: Strict Decoupling
```
APNIC FTP/HTTPS
      |
      v
APNIC Downloader
      |
      v
Integrity & Signature Verification (MD5 + GnuPG detached signature)
      |
      v
Dataset Parser (RIR Statistics Exchange format)
      |
      v
SQLite Database (Staging tables -> Atomic swap -> WAL mode)
      |
      +-----------------------------+
      |                             |
      v                             v
Gateway Supplementary Enrichment  Dashboard APIs (/api/apnic/*)
(Post-DNSSEC verdict only)          |
                                    v
                              APNIC Data Monitor UI
```
**CRITICAL RULE:** APNIC data enriches AegisDNS network intelligence; it **must never** decide whether a DNS response is DNSSEC secure, override an Unbound DNSSEC verdict, alter AD-bit interpretation, change BOGUS handling, or block DNS requests if SQLite is unavailable.

### 2. Dataset Sources & Official Sidecars
The integration ingests official daily resource files directly from APNIC:
- **Dataset:** `https://ftp.apnic.net/stats/apnic/delegated-apnic-latest`
- **MD5 Checksum:** `https://ftp.apnic.net/stats/apnic/delegated-apnic-latest.md5`
- **Detached OpenPGP Signature:** `https://ftp.apnic.net/stats/apnic/delegated-apnic-latest.asc`
- **APNIC Public Key:** `https://ftp.apnic.net/stats/apnic/CURRENT_PUBLIC_KEY`

### 3. Data Format & Interpretation
APNIC delegated statistics conform to RFC 7535 / RIR Statistics format:
- **Header:** `version|registry|serial|records|startdate|enddate|UTCoffset`
- **Summary:** `registry|*|type|*|count|summary`
- **Resource Records:** `registry|cc|type|start|value|date|status[|extensions...]`
- **Field Value Interpretation:**
  - `ipv4`: `value` is the **number of IPv4 addresses** (e.g. `256` for a `/24`). Stored as normalized decimal boundaries.
  - `ipv6`: `value` is the **CIDR prefix length** (e.g. `32` for a `/32`). Stored as 32-character fixed-width hexadecimal boundaries for exact 128-bit lexicographical range queries without integer overflow.
  - `asn`: `value` is the **number of ASNs** in the block. Stored as decimal boundaries.
- **Validation:** Parsed record total must strictly match the `records` count in the dataset header.

### 4. Important Operational Notice: Allocations vs Live Routing
> [!IMPORTANT]
> **APNIC delegated statistics describe resource allocation and assignment records. They are not a live DNS feed, a live BGP routing table, or a guaranteed physical geolocation source.**
> A resource registered to a country code indicates where it was originally allocated by APNIC; it does not guarantee the current live physical server location or active BGP routing path.

### 5. GPG Verification & Trusted Fingerprint Setup
The verification engine performs two independent checks:
1. **MD5 Checksum:** Verifies file transfer integrity against `delegated-apnic-latest.md5`.
2. **OpenPGP Detached Signature:** Verified using GnuPG with an **explicitly configured trusted fingerprint**. Downloading a key from the same FTP server and trusting it automatically is strictly prohibited.

#### How to verify the APNIC key fingerprint out-of-band:
1. Obtain the APNIC public key from `CURRENT_PUBLIC_KEY` or official APNIC security documentation.
2. Inspect its fingerprint using `gpg`:
   ```bash
   gpg --with-colons --import CURRENT_PUBLIC_KEY
   gpg --fingerprint "APNIC"
   ```
3. Independently verify the primary key fingerprint against APNIC's official
   security documentation or a trusted out-of-band channel. Do not copy a
   fingerprint from a report, benchmark, or this README without completing that
   verification.
4. Set only the verified fingerprint in your `.env`:
   ```env
   APNIC_GPG_FINGERPRINT=<VERIFIED_40_CHARACTER_HEXADECIMAL_FINGERPRINT>
   ```
5. Place the matching APNIC public key at `data/apnic/CURRENT_PUBLIC_KEY` or set
   `APNIC_TRUSTED_KEY_PATH` to the verified key's location.
If `APNIC_GPG_FINGERPRINT` is left unset, the system fails safely and marks signature verification as `PENDING_KEY_CONFIGURATION`. It will never invent or automatically accept an unverified key.

### 6. Environment Variables
| Variable | Default | Purpose |
|---|---|---|
| `APNIC_DATA_DIR` | `data/apnic` | Base directory for downloads, processed archives, and SQLite DB |
| `APNIC_DB_PATH` | `data/apnic/apnic.db` | Location of the SQLite database |
| `APNIC_UPDATE_INTERVAL_HOURS` | `24` | Scheduled update interval |
| `APNIC_REQUEST_TIMEOUT_SECONDS`| `60` | Network request timeout for HTTPS downloads |
| `APNIC_GPG_FINGERPRINT` | `""` | Independently verified 40-character GPG fingerprint |
| `APNIC_TRUSTED_KEY_PATH` | `data/apnic/CURRENT_PUBLIC_KEY` | Path to the trusted APNIC public key file |

### 7. Running the Updater Manually & Scheduled Daemon
- **Run one-off synchronization:**
  ```powershell
  python -m src.apnic.updater
  # Force update even if MD5 sidecar matches:
  python -m src.apnic.updater --force
  ```
- **Run 24-hour background daemon:**
  ```powershell
  python -m src.apnic.updater --daemon
  ```

### 8. Transactional Storage & Failure Recovery
- **Safe Staging Tables:** Candidate datasets are parsed, validated, and inserted into temporary staging tables (`resources_staging`).
- **Integrity Validation:** Record count, schema integrity, and checksums are verified before any changes touch active tables.
- **Atomic Table Swap:** Active tables are swapped within a single SQLite transaction.
- **Failure Recovery:** If a download, checksum, signature, parsing, or insertion step fails, the transaction rolls back, `resources_staging` is discarded, the failure is recorded in `sync_status.json`, and **the previous known-good database remains active and untouched**.

### 9. Dashboard API Endpoints
All APNIC endpoints are strictly read-only (`mode=ro`), use parameterized SQL queries, and query the local SQLite database without blocking gateway operations or DNS resolution.

#### 1. System Status
`GET /api/apnic/status`
Returns the current updater health, dataset serial, synchronization timestamps, and cryptographic verification states.
```json
{
  "available": true,
  "updater_status": "SUCCESS",
  "dataset_serial": "20261119",
  "total_records": 89809,
  "last_successful_import": "2026-11-19T02:08:42.123456Z",
  "last_attempt": "2026-11-19T02:08:42.123456Z",
  "checksum_verification": "VERIFIED",
  "signature_verification": "PENDING_KEY_CONFIGURATION",
  "trusted_fingerprint_configured": false,
  "last_error": null
}
```

#### 2. Resource Summary & Distribution
`GET /api/apnic/summary`
Returns aggregate statistics, counts by resource type (`ipv4`, `ipv6`, `asn`), allocation status breakdown (`allocated`, `assigned`), and country allocation distributions with percentage shares.
```json
{
  "total_records": 89809,
  "by_type": {
    "ipv4": 58433,
    "ipv6": 17350,
    "asn": 14026
  },
  "by_status": {
    "allocated": 52622,
    "assigned": 37187
  },
  "by_country": [
    { "country_code": "AU", "count": 14494, "percentage": 16.14 },
    { "country_code": "IN", "count": 13293, "percentage": 14.8 },
    { "country_code": "CN", "count": 11447, "percentage": 12.75 },
    { "country_code": "ID", "count": 9869, "percentage": 10.99 },
    { "country_code": "BD", "count": 6083, "percentage": 6.77 }
  ],
  "dataset_serial": "20261119"
}
```

#### 3. Dataset Provenance Metadata
`GET /api/apnic/metadata`
Returns formal provenance metadata from the RIR dataset header, including start/end date ranges and the cryptographic SHA-256 provenance fingerprint of the ingested dataset.
```json
{
  "dataset_name": "delegated-apnic-latest",
  "dataset_serial": "20261119",
  "start_date": "19830613",
  "end_date": "20261118",
  "record_count": 89809,
  "sha256": "3cb0179d6fe78f56644fcfc142b7dd10be2aa17cba55fec549ec3d81b896f642",
  "source": "ftp://ftp.apnic.net/stats/apnic/delegated-apnic-latest"
}
```

#### 4. Targeted Resource Lookup (IP & ASN)
`GET /api/apnic/lookup?ip=<ip_address>` or `GET /api/apnic/lookup?asn=<asn>`
Performs high-performance B-Tree indexed containment searches against the 89,809 records.
- For IPv4: Normalised 10-digit decimal comparison (`start_num <= ? AND end_num >= ?`).
- For IPv6: Exact 128-bit hexadecimal 32-character boundary comparison.
- For ASN: Integer range search handling both bare integers (`4608`) and prefixed strings (`AS4608`).

**Example: IPv4 Lookup (`/api/apnic/lookup?ip=1.0.0.1`)**
```json
{
  "found": true,
  "query": "1.0.0.1",
  "type": "ipv4",
  "resource": {
    "registry": "apnic",
    "country_code": "AU",
    "resource_type": "ipv4",
    "start": "1.0.0.0",
    "value": "256",
    "date": "20110811",
    "status": "assigned",
    "range": "1.0.0.0 - 1.0.0.255",
    "dataset_serial": "20261119"
  }
}
```

**Example: IPv6 Lookup (`/api/apnic/lookup?ip=2001:200::1`)**
```json
{
  "found": true,
  "query": "2001:200::1",
  "type": "ipv6",
  "resource": {
    "registry": "apnic",
    "country_code": "JP",
    "resource_type": "ipv6",
    "start": "2001:200::",
    "value": "35",
    "date": "19990813",
    "status": "allocated",
    "range": "2001:200::/35",
    "dataset_serial": "20261119"
  }
}
```

**Example: ASN Lookup (`/api/apnic/lookup?asn=AS4608` or `?asn=4608`)**
```json
{
  "found": true,
  "query": "AS4608",
  "type": "asn",
  "resource": {
    "registry": "apnic",
    "country_code": "AU",
    "resource_type": "asn",
    "start": "4608",
    "value": "1",
    "date": "19950220",
    "status": "allocated",
    "range": "AS4608",
    "dataset_serial": "20261119"
  }
}
```

**Example: Non-APNIC or Unallocated Resource (`/api/apnic/lookup?ip=8.8.8.8`)**
```json
{
  "found": false,
  "query": "8.8.8.8",
  "type": "ipv4",
  "message": "Resource is outside APNIC regional allocations or unallocated"
}
```

#### 5. Filterable Resource Directory
`GET /api/apnic/resources?country=AU&type=ipv4&status=assigned&page=1&limit=20`
Provides server-side paginated and indexed browsing across the entire APNIC delegated-resource inventory.
- Parameters:
  - `country`: 2-letter uppercase ISO country code (e.g. `AU`, `IN`, `JP`, `CN`).
  - `type`: `ipv4`, `ipv6`, or `asn`.
  - `status`: `allocated` or `assigned`.
  - `page`: 1-based page index (default: `1`).
  - `limit`: page size between `1` and `100` (default: `20`).
- Returns:
```json
{
  "total": 12450,
  "page": 1,
  "limit": 20,
  "total_pages": 623,
  "data": [
    {
      "registry": "apnic",
      "country_code": "AU",
      "resource_type": "ipv4",
      "start": "1.0.0.0",
      "value": "256",
      "date": "20110811",
      "status": "assigned",
      "range": "1.0.0.0 - 1.0.0.255"
    }
  ]
}
```

### 10. Dashboard Navigation & UI Components
The AegisDNS web dashboard (`http://127.0.0.1:3001`) integrates APNIC network intelligence across both macro-level allocation views and query-level live telemetry:

#### 1. APNIC Network Intelligence Tab Container
The primary APNIC section is divided into two focused views:
- **Allocation Overview & Verification:**
  - **KPI Metric Cards:** Displays Total Resource Records (`89,809`), IPv4 allocations (`58,433`), IPv6 allocations (`17,350`), ASN allocations (`14,026`), active dataset serial (`20261119`), and synchronization freshness.
  - **Dataset Health & Verification Panel:** Surfaces daemon health (`IDLE`, `RUNNING`, `SUCCESS`, `STALE`), MD5 checksum status (`VERIFIED` / `FAILED`), detached OpenPGP signature status (`VERIFIED` / `PENDING_KEY_CONFIGURATION` / `FAILED`), trusted fingerprint presence, and error logs.
  - **Resource Breakdown Visualizations:** Interactive segmented distribution bars for Resource Types (IPv4 vs IPv6 vs ASN) and Allocation Status (Allocated vs Assigned).
  - **Country Allocation Directory Table:** Sortable and searchable table of all participating ISO country codes, displaying record counts, percentage shares, and an explicit disclaimer distinguishing record counts from raw IP counts.
- **Resource Explorer & Directory:**
  - **Interactive Targeted Inspector:** Dedicated search bar supporting IPv4 addresses (`1.0.0.1`), IPv6 addresses (`2001:200::1`), and ASNs (`AS4608`). Displays structured badge details: Registry, Country Code, Resource Range, Allocation Status, Date, and Dataset Serial.
  - **Delegation Directory Table:** Server-side paginated browsing tool featuring multi-criteria filter dropdowns for Resource Type, Allocation Status, and Country Code, complete with previous/next page controls and empty-state handling.

#### 2. Live DNS Event Enrichment
When DNS queries resolve to A or AAAA records, the gateway extracts answer IP addresses and cross-references them against the local APNIC database:
- **DNS Query Table:** Dedicated "APNIC Intelligence" column displaying allocation badges with country code, allocation status, and tooltip range details.
- **Latest Verdict Panel:** Displays supplementary APNIC allocation metadata alongside the DNSSEC verdict, explicitly isolated by a geolocation disclaimer.
- **Event History:** Enriched with administrative allocation context without mutating log severity or DNSSEC resolution timestamps.

### 11. Verification Status Definitions
| Status | Context | Technical Meaning |
|---|---|---|
| `VERIFIED` | Checksum / PGP | The MD5 digest matches the official `.md5` sidecar, or the detached OpenPGP `.asc` signature was successfully validated by GnuPG using an operator-configured trusted public key. |
| `PENDING_KEY_CONFIGURATION` | Signature | The system safely bypassed GPG signature verification because `APNIC_GPG_FINGERPRINT` is unconfigured. Untrusted keys are never automatically trusted. |
| `FAILED` | Checksum / Signature / Sync | MD5 digest mismatch, invalid cryptographic signature, or schema staging verification failure. The transaction was rolled back and previous known-good data preserved. |
| `IDLE` | Updater Daemon | The daemon is healthy, initialized, and currently sleeping between its 24-hour scheduled update intervals. |
| `RUNNING` | Updater Daemon | The download, verification, parsing, or atomic database swap is actively executing. |
| `STALE` | Dataset Freshness | The dataset's age exceeds the 24-hour update interval (e.g. prolonged network partition or repeated download failure). |

### 12. Important Operational Notice: Allocations vs Geolocation
> [!IMPORTANT]
> **APNIC delegated statistics describe administrative resource allocation and assignment records. They are not a live DNS feed, a live BGP routing table, or a guaranteed physical geolocation source.**
> - **Administrative Country Code:** A country code (e.g., `AU`, `IN`, `CN`) signifies the national jurisdiction of the organization to which APNIC assigned the address block. It does **not** prove that the physical server hosting the domain is located within that country.
> - **Record Counts vs IP Address Counts:** Record count refers to the number of entries in `delegated-apnic-latest`. In IPv4, `value` denotes individual address count (e.g. `256` for `/24`). In IPv6, `value` denotes the **CIDR prefix length** (e.g. `32` for `/32`, which represents $2^{96}$ addresses). Comparing IPv4 and IPv6 record counts does not reflect relative address pool sizes.
> - **Strict DNSSEC Independence:** APNIC network intelligence is strictly supplementary. It **never** influences DNSSEC verdict classification (`SECURE`, `INSECURE`, `BOGUS`), does **not** alter the Authenticated Data (`AD`) bit or wire format returned to the IoT client, and never blocks resolution if SQLite is unavailable.

### 13. Docker Deployment
In `src/docker-compose.yml`, an isolated `apnic-updater` container is added to `aegis_net`:
- `apnic-updater`: mounts `../data/apnic:/data/apnic` (read-write), runs the Python updater daemon, and executes GPG signature checks.
- `gateway` & `dashboard`: mount `../data/apnic:/data/apnic:ro` (strictly read-only).
- Decoupled lifecycle: If the `apnic-updater` container is stopped or restarted, the gateway and dashboard continue operating without interruption.

The updater image uses the repository root as its build context and runs
`python -m src.apnic.updater --daemon` from `/app`. Build and operate it from
the repository root:

```powershell
docker compose --env-file .env -f src/docker-compose.yml build apnic-updater
docker compose --env-file .env -f src/docker-compose.yml up -d apnic-updater
docker compose --env-file .env -f src/docker-compose.yml ps apnic-updater
docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 apnic-updater
```

To check the read-only dashboard APIs from PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/apnic/status
Invoke-RestMethod http://127.0.0.1:3001/api/apnic/summary
Invoke-RestMethod http://127.0.0.1:3001/api/apnic/metadata
```

### Observed local dataset and updater status

The local APNIC dataset snapshot observed on 19 November 2026 has serial
`20261119` and `89,809` resource records: `58,433` IPv4, `17,350` IPv6, and
`14,026` ASN records. The five largest country-code groups in that snapshot
were AU (`14,494`), IN (`13,293`), CN (`11,447`), ID (`9,869`), and BD
(`6,083`). Counts change when APNIC publishes a new dataset.

The recorded updater status is `SUCCESS`, with checksum `VERIFIED`,
signature status `PENDING_KEY_CONFIGURATION`, and no trusted fingerprint
configured. The updater container was observed running. An MD5 match verifies
the downloaded bytes against the APNIC sidecar; it does not authenticate the
publisher. Do not describe the active dataset as PGP-authenticated until the
operator-configured trust chain verifies its detached signature.

### 14. Automated Testing Instructions
Run the APNIC regression and unit test suites across Python and Node.js:
```powershell
# Python APNIC test suite
python -m unittest tests/test_apnic_database.py tests/test_apnic_parser.py tests/test_apnic_verifier.py tests/test_apnic_updater.py tests/test_network_intelligence.py

# Node.js dashboard, API, and APNIC lookup test suite
node --test tests/test_apnic_lookup.js tests/test_dashboard.js tests/test_storage.js tests/test_validation.js
```
This executes:
- `test_apnic_parser.py`: header, IPv4/IPv6/ASN range calculations, comment filtering, extensions, and malformed record validation.
- `test_apnic_verifier.py`: MD5 verification, missing fingerprint safety, untrusted key rejection, and signature verification.
- `test_apnic_database.py`: schema creation, staging imports, IPv4/IPv6/ASN lookups, metadata retrieval, and rollback safety.
- `test_apnic_updater.py`: initial sync, unchanged dataset detection, network failures, checksum failures, and parse errors.
- `test_network_intelligence.py`: gateway lookups, unknown IP handling, missing database resilience, wire format preservation, and strict AD bit/verdict independence.
- `test_apnic_lookup.js`: 20 unit tests covering IPv4 range queries, IPv6 128-bit prefix matching, ASN prefix and integer parsing, non-APNIC containment rejection, SQL injection immunity, paginated resource directory queries with limit bounds, filter validation, and missing database safety.
- `test_dashboard.js`: `/api/apnic/status`, `/api/apnic/summary`, `/api/apnic/metadata`, `/api/apnic/lookup`, and `/api/apnic/resources` responses.

Verified current test status:

- Python APNIC suite: `37/37` tests passed.
- Node.js suite: `40` passed, `1` skipped (live MongoDB integration), `0` failed.
- The React/Vite dashboard frontend build (`npm --prefix src/dashboard/web run build`) completed successfully with zero TypeScript or bundling errors.

Remaining APNIC validation work includes independently verifying and
configuring APNIC's signing-key fingerprint, confirming a successful detached
signature using that configured trust anchor, and exercising long-running
scheduled updates and failed-update recovery end to end. The previous gateway
bogus-DNSSEC test-recorder mismatch also remains a separate investigation item;
it must not be presented as an APNIC feature or as resolved by APNIC
enrichment.

The SHA-256 provenance field reported by the APNIC metadata endpoint is
calculated for the downloaded dataset file. It is not a substitute for OpenPGP
signature verification. MD5 checks detect sidecar mismatch or transfer
corruption; the signature check is required to establish authenticity.

### Known Measurement and Configuration Caveats

- PGP signature verification is implemented but remains inactive until
  `APNIC_GPG_FINGERPRINT` is set to an independently verified operator trust
  anchor.
- The benchmark JSON record is now retained in the repository at
  `benchmark-results.json`, together with cold/warm, throughput, and resource
  utilization evidence. Results remain local to the test hardware and load
  configuration.
- Set `GATEWAY_IP` to `127.0.0.1` for loopback-only certificate/test use or to
  the host's actual LAN IPv4 address for ESP32 access. `127.0.0.0` is not a host
  address and must not be used.
- ESP32 latency values include `delay(5)` retry/backoff quantization and are
  not a sub-millisecond timing measurement; high-resolution OS or gateway
  timings should not be inferred from ESP32 serial output alone.

## 12. References

-   [RFC 4033 --- DNS Security Introduction and
    Requirements](https://www.rfc-editor.org/rfc/rfc4033)
-   [RFC 4034 --- Resource Records for the DNS Security
    Extensions](https://www.rfc-editor.org/rfc/rfc4034)
-   [RFC 4035 --- Protocol Modifications for the DNS Security
    Extensions](https://www.rfc-editor.org/rfc/rfc4035)
-   [RFC 7858 --- Specification for DNS over Transport Layer Security
    (TLS)](https://www.rfc-editor.org/rfc/rfc7858)
-   [RFC 9525 --- Service Identity in
    TLS](https://www.rfc-editor.org/rfc/rfc9525)
-   [Unbound Documentation](https://unbound.docs.nlnetlabs.nl/)
-   [FastAPI Documentation](https://fastapi.tiangolo.com/)
-   [Python Documentation](https://docs.python.org/3/)

------------------------------------------------------------------------

**Disclaimer:** AegisDNS is an educational hackathon prototype. Do not
deploy it to protect critical infrastructure without a full security
review, appropriate operational controls, and validation in the intended
environment.
