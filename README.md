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
> `BOGUS`/`SERVFAIL`, `INSECURE`, and `BLOCKED_CD` outcomes. ESP32
> hardware integration and full baseline/performance benchmarking remain
> pending. Features, tests, benchmarks, and hardware compatibility
> should be marked complete only after they have been run and verified.

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

The current local test path exercises the Docker-based resolver and
gateway using `scripts/test_gateway.py`. ESP32 is the target hardware
client; its real hardware integration is not yet verified.

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
    └── certs/                 # local device certificate files; ignored by Git
```

Generated DNSSEC material is written beneath `dns/generated/`; local
TLS/PKI files are under `pki/`. These generated and private files must
not be committed. The layout above describes the current project
structure; update it if repository files change.

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
`scripts/test_gateway.py` as currently provided.

The initial verified local environment is Windows 11 with Docker
Desktop. Other operating systems and ESP32 board/framework combinations
should be tested rather than assumed compatible.

## 4. Run Locally on Windows

Open PowerShell in the repository directory. Examples assume
`D:\AegisDNS`; adjust the path if you cloned the repository elsewhere.

### 4.1 Configure the environment

``` powershell
cd D:\AegisDNS
Copy-Item .env.example .env
```

If `.env` already exists, **do not overwrite it**. Review `.env.example`
for supported settings. Keep `.env` local; it is ignored by Git.

### 4.2 Generate local development certificates

``` powershell
docker compose --profile tools run --rm certgen
```

This generates local TLS and client credentials beneath `pki/`. The CA
private key and client/server private keys are secrets; do not commit
them or send them through GitHub. Regenerate certificates if the
configured gateway hostname/address or certificate settings change.

### 4.3 Build and start the stack

``` powershell
docker compose up --build -d
docker compose ps
```

Expected services are `authoritative`, `resolver`, `gateway`, and
`dashboard`. Check startup logs if a service is restarting:

``` powershell
docker compose logs --tail 100 authoritative
docker compose logs --tail 100 resolver
docker compose logs --tail 100 gateway
docker compose logs --tail 100 dashboard
```

-   Dashboard: http://localhost:3000
-   Gateway: TCP port `853` on the Docker host.
-   The current Compose configuration binds the dashboard to
    `127.0.0.1:3000` for local access.

Do not expose the resolver or authoritative DNS service publicly.

## 5. Verify DNSSEC Outcomes

Run these commands from PowerShell. The quotes around `@127.0.0.1` are
important because `@` has special syntax in PowerShell.

``` powershell
docker compose exec resolver dig '@127.0.0.1' valid.aegis.test A +dnssec
docker compose exec resolver dig '@127.0.0.1' bogus.aegis.test A +dnssec
docker compose exec resolver dig '@127.0.0.1' insecure.aegis.test A +dnssec
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
py scripts/test_gateway.py
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
docker compose ps
docker compose logs --tail 60 gateway
docker compose logs --tail 60 dashboard
```

If only the dashboard is being changed, rebuild that service:

``` powershell
docker compose up -d --build --force-recreate dashboard
```

Then hard-refresh the browser with **Ctrl+F5**.

### Reporting test results

When documenting new tests, include the command executed,
software/environment versions, expected and observed outcomes, pass/fail
counts, and known gaps. Do not describe an unexecuted test as passed.
Keep resolver validation outcomes separate from gateway policy
decisions.

## 7. ESP32 Integration and Teammate Handoff

The current firmware source is `esp32/src/main.cpp`. It uses
`WiFiClientSecure`, implements DNS-over-TLS framing with a 2-byte
message-length prefix, sends DNS A queries, and prints response status
and query latency over Serial. **Physical ESP32 integration is pending
and must not be described as verified until tested on the target
board.**

### Firmware checklist

1.  Install Arduino IDE and the `esp32` board package by Espressif
    Systems.
2.  Open `esp32/src/main.cpp` in an Arduino-ESP32 project and select the
    correct board and serial port when hardware is available.
3.  Set the Wi-Fi SSID and password locally.
4.  Use a **device-specific client certificate and private key** issued
    by the CA trusted by the gateway. The gateway requires mutual TLS.
5.  Configure the public CA certificate used to validate the gateway
    certificate, and verify the gateway hostname against a matching
    certificate Subject Alternative Name (SAN).
6.  Set the gateway endpoint to the laptop/server LAN IP and a hostname
    covered by the gateway certificate. `localhost` on the ESP32 refers
    to the ESP32 itself, not the laptop.
7.  Ensure the ESP32 and gateway host can reach each other (same LAN for
    the initial test), TCP 853 is allowed by the host firewall, and the
    gateway is running.
8.  Query `valid.aegis.test`, `bogus.aegis.test`, and
    `insecure.aegis.test`; compare serial output with dashboard events.
9.  Record board model, framework/library versions, connection result,
    observed responses, and any memory or timing measurements.

### Credentials and collaboration warning

Do **not** commit real certificate private keys, Wi-Fi passwords, or
populated PEM secrets in tracked firmware source. The starter `main.cpp`
contains placeholder PEM blocks; use local, ignored credentials or
refactor them into a local ignored secrets header before inserting real
credentials.

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

## 8. Git Collaboration Workflow

Use a separate branch per task. Avoid committing directly to `main` for
ongoing feature work.

### First publish (repository owner)

Create an **empty** GitHub repository; do not generate an additional
GitHub README or `.gitignore` because these already exist locally. From
the project folder:

``` powershell
git status
git remote add origin https://github.com/<OWNER>/AegisDNS.git
git push -u origin main
```

Replace `<OWNER>` with the GitHub account or organization. If `origin`
already exists, inspect `git remote -v` rather than adding it again.
Keep the repository private until secrets and publication choices have
been reviewed.

Invite teammates from GitHub repository **Settings → Collaborators**.
They must accept the invitation.

### Teammate: clone and create a branch

``` powershell
git clone https://github.com/<OWNER>/AegisDNS.git
cd AegisDNS
git switch -c feature/esp32-integration
Copy-Item .env.example .env
docker compose --profile tools run --rm certgen
docker compose up --build -d
```

If a teammate is working on firmware without access to the ESP32 yet,
they can edit and compile-check the source when their toolchain is
available. Physical connectivity and TLS validation require hardware and
authorized credentials.

### Each contributor: commit and push a branch

``` powershell
git status
git add esp32/src/main.cpp
git commit -m "feat(esp32): improve gateway client"
git push -u origin feature/esp32-integration
```

Stage only the files relevant to your change. Open a pull request to
merge the feature branch into `main`. For dashboard work, use a separate
branch such as `feature/dashboard-ui` and stage the relevant
`dashboard/` files.

Before every push, check for accidentally staged secrets:

``` powershell
git status --short
git diff --cached --name-only
```

Repository privacy is not a substitute for keeping private credentials
out of Git.

## 9. Security Principles, Threat Model, and Limitations

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

The gateway must not trust a client-supplied claim that a result is
secure. A successful DNS lookup must not be treated as proof of DNSSEC
validation. Validation status and the policy decision must be
represented separately.

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

**Authoritative container restarts or zone does not load**\
Inspect `docker compose logs --tail 100 authoritative`. The signed test
zone must load without syntax errors.

**PowerShell errors on `@127.0.0.1`**\
Quote the argument: `dig '@127.0.0.1' ...`.

**Valid name returns `NXDOMAIN` from Unbound**\
Check `resolver/unbound.conf`, especially the
`local-zone: "test." transparent` setting and the `stub-zone` for
`aegis.test.`. Validate the configuration with:

``` powershell
docker compose exec resolver unbound-checkconf /etc/unbound/unbound.conf
```

Then inspect resolver logs.

**Gateway returns `SERVFAIL` for every name**\
Inspect `docker compose logs --tail 100 gateway`. Confirm resolver
host/port environment settings and ensure code changes were rebuilt:

``` powershell
docker compose up -d --build --force-recreate gateway
```

**No events appear on the dashboard**\
Keep the gateway and dashboard running, execute
`py scripts/test_gateway.py`, and inspect both service logs. Confirm
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

### Pending milestones

-   [ ] Verify ESP32 compilation and connection to the gateway using
    real mutual TLS.
-   [ ] Confirm hostname verification and a no-plaintext-fallback
    failure path on hardware.
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

Report measured values only. Save raw results as CSV or JSON and
generate charts from those files. Include the test environment and
methodology so results can be reproduced. The full baseline/performance
benchmark and ESP32 resource measurements are currently pending.

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

Consult the relevant RFCs and official documentation when implementing
protocol behavior. Do not claim that a reference supports a feature
without verifying the relevant section.

------------------------------------------------------------------------

**Contributing guidelines:** Keep changes focused and documented, add
tests for new behavior, never commit private keys or credentials, record
actual test and benchmark results, clearly identify incomplete or
simulated functionality, and document changes to the threat model or
validation policy.

**Disclaimer:** AegisDNS is an educational hackathon prototype. Do not
deploy it to protect critical infrastructure without a full security
review, appropriate operational controls, and validation in the intended
environment.

**Keep secrets local. Commit source code and documentation; never commit
live credentials.**
