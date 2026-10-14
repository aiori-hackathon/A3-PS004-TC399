# AegisDNS

**Authenticated Gateway-Assisted DNSSEC for Resource-Constrained IoT**

AegisDNS is an AIORI-3 Hackathon project for **PS-004: Authenticated
Gateway-Assisted DNSSEC for IoT**. It explores how an IoT device can use
a trusted gateway to obtain DNS responses backed by real DNSSEC
validation, without requiring the constrained device to implement the
complete DNSSEC validation process itself.

> **Project status:** Prototype under development. Features, tests,
> benchmarks, and hardware compatibility must be marked as implemented
> only after they have been run and verified. This README describes the
> intended architecture and development plan; it does not claim that
> unverified components are already complete.

## Youtube Link of Introductory video:
https://youtu.be/FeKZ9_0cWfo

## Table of Contents

-   [Problem](#problem)
-   [Proposed Solution](#proposed-solution)
-   [Architecture](#architecture)
-   [Security Principles](#security-principles)
-   [Planned Features](#planned-features)
-   [Technology Stack](#technology-stack)
-   [Repository Structure](#repository-structure)
-   [Prerequisites](#prerequisites)
-   [Getting Started](#getting-started)
-   [Validation Policy](#validation-policy)
-   [Testing Plan](#testing-plan)
-   [Benchmarking](#benchmarking)
-   [Threat Model and Limitations](#threat-model-and-limitations)
-   [Development Roadmap](#development-roadmap)
-   [References](#references)
-   [Contributing](#contributing)
-   [Disclaimer](#disclaimer)

## Problem

IoT devices often have limited processing power, memory, energy, and
software resources. Implementing and maintaining a complete DNSSEC
validation stack on every device can add complexity.

Ordinary DNS resolution alone does not establish that DNS data has been
authenticated. An attacker who can influence an unprotected resolution
path may attempt to provide forged or manipulated DNS answers.

A gateway-assisted design moves DNSSEC validation to a trusted gateway
while securing the connection between the IoT client and that gateway.
This reduces the validation burden on the client, but it also introduces
a trust boundary: the client must authenticate the gateway and
understand that DNSSEC validation is being performed by the gateway's
trusted resolver.

## Proposed Solution

AegisDNS is designed around the following flow:

1.  An IoT client connects to an authorized gateway over an
    authenticated, encrypted channel.
2.  The client submits a DNS query using the project's defined request
    protocol.
3.  The gateway validates the request and forwards the query to a
    configured DNSSEC-validating resolver.
4.  The resolver performs DNSSEC validation.
5.  The gateway determines the validation outcome and applies an
    explicit policy.
6.  The gateway returns the answer, validation status, and policy
    decision over the protected channel.
7.  The client accepts or rejects the result according to the documented
    protocol and policy.

The initial development path uses a Python client simulator to validate
the complete flow before adding ESP32 hardware integration.

## Architecture

``` text
+-----------------------+
| IoT Client            |
| Python simulator      |
| ESP32 client (target) |
+-----------+-----------+
            |
            | Mutual TLS (mTLS)
            | Authenticated + encrypted
            v
+-----------------------+
| AegisDNS Gateway      |
|                       |
| 1. Authenticate       |
| 2. Validate request   |
| 3. Query resolver     |
| 4. Apply policy       |
| 5. Return status      |
+-----------+-----------+
            |
            | DNS query to trusted resolver
            v
+-----------------------+
| Unbound Resolver      |
| DNSSEC validation     |
+-----------+-----------+
            |
            v
       DNS hierarchy
```

**Important trust boundary:** DNSSEC validation takes place at the
configured validating resolver. The client authenticates the gateway and
trusts its reported validation result over the authenticated channel.
Unless independent validation is implemented on the device, AegisDNS
does **not** claim end-to-end DNSSEC validation by the IoT client.

## Security Principles

AegisDNS keeps three distinct security functions separate:

-   **DNSSEC:** Authenticates DNS data and protects its integrity
    through the DNSSEC chain of trust. DNSSEC does not encrypt DNS
    queries.
-   **TLS/mTLS:** Protects the client--gateway channel and authenticates
    the communicating endpoints according to the configured certificate
    trust policy.
-   **Gateway policy enforcement:** Decides whether a response may be
    returned based on the actual validation outcome and the project's
    configured policy.

The gateway must not trust a client-supplied claim that a result is
secure. A successful DNS lookup must not be treated as proof of DNSSEC
validation. The DNSSEC validation result and the policy decision must be
represented separately.

### Validation outcomes

  -----------------------------------------------------------------------
  Outcome                 Meaning                 Intended handling
  ----------------------- ----------------------- -----------------------
  `SECURE`                DNSSEC validation       Permit according to
                          succeeded               policy

  `INSECURE`              The answer is not       Apply an explicit
                          authenticated by        configurable policy
                          DNSSEC; this is not     
                          automatically proof of  
                          an attack               

  `BOGUS`                 DNSSEC validation       Reject the response
                          failed                  

  `INDETERMINATE`         A reliable validation   Fail closed by default
                          outcome could not be    
                          established             

  Resolver error /        The resolver could not  Return an explicit
  timeout                 provide a reliable      error; never report it
                          result                  as secure
  -----------------------------------------------------------------------

The exact mapping from resolver responses to these outcomes must be
implemented and tested against the selected Unbound version and
configuration.

## Planned Features

-   Authenticated, encrypted client--gateway communication using mutual
    TLS.
-   A gateway service with separate transport, resolver, policy, and
    response-handling modules.
-   Real DNSSEC validation through Unbound.
-   Controlled test cases for valid signed, bogus, and insecure zones.
-   Explicit rejection of bogus DNSSEC responses.
-   Authentication-failure and resolver-failure handling.
-   Python client simulator.
-   ESP32 integration, subject to board, framework, and TLS-library
    compatibility.
-   Automated unit and integration tests.
-   Benchmarks for latency, throughput, CPU, memory, and rejection
    behavior.
-   Optional lightweight dashboard for query outcomes and gateway
    health.

These are project goals, not claims that every feature is already
implemented.

## Technology Stack

  -----------------------------------------------------------------------
  Component               Planned technology      Purpose
  ----------------------- ----------------------- -----------------------
  IoT client              Python simulator; ESP32 Submit queries and
                          client target           process responses

  Gateway API             Python, FastAPI         Request handling and
                                                  policy enforcement

  DNS resolver            Unbound                 DNSSEC-validating
                                                  resolution

  Secure transport        TLS with mutual         Authenticate endpoints
                          authentication          and protect the channel

  Certificates            OpenSSL or equivalent   Development CA and
                          tooling                 endpoint certificates

  Tests                   pytest and integration  Verify expected
                          scripts                 behavior

  Benchmarks              Python, CSV/JSON output Measure performance
                                                  reproducibly

  Version control         Git                     Track source and
                                                  configuration
  -----------------------------------------------------------------------

Versions should be pinned in the dependency files and recorded in test
reports once the implementation environment is established.

## Repository Structure

The following is a suggested structure. Update it to match the files
that actually exist in the repository.

``` text
AegisDNS/
├── README.md
├── requirements.txt
├── .env.example
├── .gitignore
├── config/
├── gateway/
│   ├── app.py
│   ├── config.py
│   ├── dnssec_resolver.py
│   ├── policy.py
│   ├── security.py
│   └── schemas.py
├── client/
│   ├── simulator/
│   └── esp32/
├── resolver/
│   └── test-zones/
├── certificates/
│   └── README.md
├── tests/
│   ├── unit/
│   └── integration/
├── benchmarks/
├── scripts/
├── dashboard/
└── docs/
    ├── requirements.md
    ├── threat-model.md
    ├── architecture.md
    ├── dnssec-validation.md
    ├── gateway.md
    ├── transport-security.md
    ├── iot-client.md
    ├── end-to-end-demo.md
    ├── testing.md
    └── benchmarking.md
```

## Prerequisites

The planned development environment is a Linux system such as Ubuntu or
Debian. A Linux virtual machine or WSL2 may be used on Windows if the
required networking and resolver behavior is supported.

Expected tools include:

-   Python 3 and `venv`
-   `pip`
-   Unbound
-   OpenSSL
-   `dig` or equivalent DNS inspection tools
-   Git
-   pytest
-   ESP32 toolchain and supported TLS libraries for hardware integration

Exact package names and supported versions should be confirmed for the
target operating system.

## Getting Started

Because implementation and configuration may change during development,
use the following as the intended setup sequence. Run commands only
after the corresponding files and configuration have been added to the
repository.

### 1. Clone the repository

``` bash
git clone https://github.com/vardan-18/A3-PS004-TC399.git
cd A3-PS004-TC399
```

### 2. Create a Python environment

``` bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
```

On Windows PowerShell, activate the environment with:

``` powershell
.venv\Scripts\Activate.ps1
```

### 3. Install Python dependencies

Once `requirements.txt` is available:

``` bash
pip install -r requirements.txt
```

### 4. Configure the resolver and certificates

-   Configure Unbound to perform DNSSEC validation.
-   Configure the gateway to use the intended resolver endpoint.
-   Create a development certificate authority and issue the gateway and
    client certificates.
-   Configure both endpoints to trust the correct CA.
-   Keep private keys and secrets outside version control.

Follow the detailed instructions in `docs/dnssec-validation.md` and
`docs/transport-security.md` once those files have been implemented.

### 5. Start and verify each component

The intended startup order is:

1.  Start and verify the resolver.
2.  Start the gateway with TLS/mTLS enabled.
3.  Run the Python client simulator with a trusted client certificate.
4.  Execute the DNSSEC and authentication integration tests.
5.  Connect the ESP32 client after the simulator-based flow works.

**Do not assume that a command or endpoint exists until it has been
implemented and documented.** The final repository should replace these
general steps with exact tested commands.

## Validation Policy

The gateway must distinguish DNSSEC validation status from its policy
decision. A suggested default policy is:

-   `SECURE`: allow the validated response.
-   `BOGUS`: reject.
-   `INDETERMINATE`: reject or return an explicit validation error.
-   Resolver unavailable or timeout: return an explicit error; never
    mark the response secure.
-   `INSECURE`: apply a clearly documented policy. For a strict
    demonstration, configure the gateway to reject insecure results; if
    insecure results are allowed, label them accurately and record that
    decision.

The policy must be configurable and tested. The gateway must obtain
validation status from its trusted resolver path, not from
client-provided metadata. Any use of DNS flags such as the AD bit
requires an explicit trust arrangement and verification of the resolver
behavior.

## Testing Plan

The test suite should cover at least:

  -----------------------------------------------------------------------
  Scenario                            Expected result
  ----------------------------------- -----------------------------------
  Valid signed DNSSEC zone            Report `SECURE`; return only if
                                      policy permits

  Bogus DNSSEC zone                   Report `BOGUS`; reject

  Insecure zone                       Report `INSECURE`; apply configured
                                      policy

  Indeterminate validation            Explicit error or rejection

  Trusted client certificate          Accept connection

  Untrusted client certificate        Reject connection

  Untrusted gateway certificate       Client refuses connection

  Resolver unavailable                Explicit failure; no false secure
                                      result

  DNS timeout                         Explicit timeout handling

  Malformed request                   Reject safely

  Unsupported record type             Return a documented error

  Repeated queries                    Remain stable within configured
                                      limits
  -----------------------------------------------------------------------

Unit tests may use mocks to test isolated modules. Integration tests
must separately exercise the real validating resolver and secure
transport.

When reporting test results, include the command executed, software
environment, pass/fail counts, and any known gaps. Do not label
unexecuted tests as passed.

## Benchmarking

The benchmark suite should compare clearly defined configurations, such
as:

1.  **Baseline:** DNS lookup through the selected resolver without the
    AegisDNS gateway application layer.
2.  **Gateway path:** DNS lookup through the authenticated gateway and
    DNSSEC-validation path.
3.  **Negative cases:** Bogus DNSSEC results and unauthenticated
    connection attempts.

Measure, where applicable:

-   Median, p95, and p99 latency
-   Throughput
-   Success and rejection rates
-   Gateway CPU and memory use
-   Resolver response time
-   TLS/mTLS overhead
-   Behavior under controlled concurrency

Record the hardware, software versions, cache state, query mix,
concurrency, test duration, and sample count. Separate cold-cache and
warm-cache tests when practical.

**No benchmark numbers should be reported until they have been
measured.** Results should be saved in CSV or JSON and generated charts
should be derived from those files.

## Threat Model and Limitations

### Threats addressed by the design

-   Forged DNS data that fails DNSSEC validation.
-   Unauthorized clients attempting to access the gateway.
-   Impersonation of the gateway when certificate validation is
    correctly configured.
-   Accidental acceptance of bogus, indeterminate, or failed resolver
    outcomes.
-   Malformed requests and basic resource-abuse scenarios, subject to
    implemented limits.

### Important limitations

-   The gateway becomes a trusted security component and a potential
    single point of failure.
-   A compromised gateway can lie about validation status or return
    manipulated data.
-   DNSSEC does not provide confidentiality for DNS queries.
-   mTLS secures the client--gateway channel but does not, by itself,
    prove that the DNS answer is authentic.
-   Availability depends on the gateway, resolver, network, and power
    supply.
-   ESP32 compatibility depends on the specific board, framework,
    certificate handling, memory limits, and TLS libraries.
-   Performance on a laptop or simulator may not represent performance
    on constrained hardware.
-   This is a hackathon prototype, not a production security
    certification.

A future version could investigate gateway redundancy, key rotation,
hardened deployment, rate limiting, monitoring, and independent
validation strategies.

## Development Roadmap

-   [ ] Define requirements and threat model.
-   [ ] Establish the Linux development environment.
-   [ ] Configure Unbound and prove DNSSEC validation using controlled
    test zones.
-   [ ] Implement the gateway's resolver and policy modules.
-   [ ] Configure and verify mutual TLS.
-   [ ] Build the Python client simulator.
-   [ ] Demonstrate valid, bogus, insecure, and failure cases.
-   [ ] Add automated unit and integration tests.
-   [ ] Implement ESP32 integration.
-   [ ] Run reproducible performance benchmarks.
-   [ ] Add an optional dashboard.
-   [ ] Finalize setup instructions and demo evidence.

Update this checklist as work is completed and verified.

## References

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
protocol behavior. Do not claim a reference supports a feature without
verifying the relevant section.

## Contributing

Contributions should prioritize correctness, reproducibility, and
security.

1.  Keep changes focused and documented.
2.  Add tests for new behavior.
3.  Never commit private keys, credentials, or secrets.
4.  Record actual test and benchmark results.
5.  Clearly identify incomplete or simulated functionality.
6.  Explain changes to the threat model or validation policy.

## Disclaimer

AegisDNS is an educational and hackathon prototype under development. It
is not a substitute for a professionally reviewed production DNS
security architecture. Do not deploy it to protect critical
infrastructure without a full security review, appropriate operational
controls, and validation under the intended environment.
