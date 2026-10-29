# AegisDNS

**Authenticated Gateway-Assisted DNSSEC for Resource-Constrained IoT**\
AIORI-3 Hackathon · PS-004 · IoT and Cloud Computing

AegisDNS is a lab prototype that allows a resource-constrained IoT
client to send DNS queries through an authenticated gateway. The gateway
forwards queries to a trusted Unbound resolver that performs DNSSEC
validation, applies an explicit policy to the result, and publishes
telemetry to a live web dashboard.

**Introductory video:** https://youtu.be/FeKZ9_0cWfo

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
Wi-Fi + mutual TLS / DNS-over-TLS (TCP 853)
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

-   Dashboard: http://localhost:3000
-   Gateway: TCP port `853` on the Docker host.
-   The current Compose configuration binds the dashboard to
    `127.0.0.1:3000` for local access.

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

These outcomes have been observed in the local lab. A `SERVFAIL` is
**not universally proof** of a DNSSEC validation failure: real resolver
deployments may also return it for timeouts, network errors, or
configuration problems. The deliberately broken-signature test zone is
used to demonstrate the bogus path.

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

Exact spacing and latency vary. Keep http://localhost:3000 open.
Accepted metrics are sent to Express at `POST /api/metrics` and
broadcast to browsers through Socket.io as the `dns_metric` event.

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
    the initial test), TCP 853 is allowed by the host firewall, and the
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
network may be using the configured `172.28.0.0/24` subnet. Check
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
Check Wi-Fi reachability, host firewall TCP 853, client certificate
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

### Pending milestones

-   [ ] Run at least 30–50 consecutive rounds and save the complete
    serial output for extended evaluation.
-   [ ] Calculate mean, median, minimum, maximum, and p95 query latency
    from the extended sample set.
-   [ ] Confirm hostname verification and test the no-plaintext-fallback
    failure path on hardware.
-   [ ] Test rejection of an untrusted gateway certificate and an
    invalid client certificate.
-   [ ] Confirm ESP32 test requests appear on the live dashboard.
-   [ ] Persist structured events to JSONL/CSV for repeatable
    evaluation.
-   [ ] Improve classification of resolver errors versus DNSSEC-bogus
    outcomes.
-   [ ] Add automated unit and integration tests for authentication,
    malformed requests, resolver failures, timeouts, and validation
    outcomes.
-   [ ] Add authentication/access controls to the telemetry endpoint
    before any broader deployment.
-   [ ] Implement a baseline-versus-AegisDNS benchmark runner.
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