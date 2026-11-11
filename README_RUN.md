# AegisDNS — Run Commands

This file is a quick command reference for starting and testing the AegisDNS project on **Windows 11 using PowerShell**.

> Run Docker and Python commands from the **repository root** — the folder containing `.env.example` and `src/`.
> Docker Desktop must be running with its Linux/WSL 2 engine.
>
> These commands start the local Docker lab (authoritative DNS, Unbound resolver, gateway, and dashboard). ESP32 firmware commands are listed separately.

## 1. First-Time Setup

### 1.1 Create the local environment file

```powershell
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
}
```

If `.env` already exists, keep it and do not overwrite it. Review its settings if the gateway or local environment needs configuration.

### 1.2 Generate development certificates

Run this the first time, or when renewing/recreating the local certificate set:

```powershell
docker compose --env-file .env -f src/docker-compose.yml --profile tools run --build --rm certgen
```

The generated PKI files are stored under `src/pki/`. Keep private keys local and out of Git.

## 2. Start the AegisDNS Docker Stack

Build the images and start all services in the background:

```powershell
docker compose --env-file .env -f src/docker-compose.yml up --build -d
```

Check the services:

```powershell
docker compose --env-file .env -f src/docker-compose.yml ps
```

Expected services:

- `authoritative`
- `resolver`
- `gateway`
- `dashboard` (React UI and shared backend)
- `dashboard-html` (HTML UI on port 3000)

### Open the dashboard

The HTML dashboard is at:

http://localhost:3000

The React dashboard remains available at http://localhost:3001. Both
frontends use the same backend APIs and live telemetry.

The gateway listens on TCP port `8853` on the Docker host and forwards it
to port `853` inside the container.

## 3. Check Logs and Service Health

Follow logs for the full stack:

```powershell
docker compose --env-file .env -f src/docker-compose.yml logs -f
```

Follow only the gateway logs:

```powershell
docker compose --env-file .env -f src/docker-compose.yml logs -f gateway
```

Other service names can be used in place of `gateway`, such as `resolver`, `authoritative`, or `dashboard`.

To show the latest 100 log lines without following:

```powershell
docker compose --env-file .env -f src/docker-compose.yml logs --tail 100 gateway
```

## 4. Run the Gateway DNSSEC Test

Keep the Docker stack running. From the repository root, run:

```powershell
py src/scripts/test_gateway.py
```

The controlled test cases are expected to demonstrate:

| Test | Expected behavior |
|---|---|
| `valid.aegis.test` | `SECURE`, `NOERROR`, `AD=1` |
| `bogus.aegis.test` | `SERVFAIL` / `BOGUS`, `AD=0` |
| `insecure.aegis.test` | `INSECURE`, `NOERROR`, `AD=0` |
| Query with `CD=1` | Rejected by gateway policy, expected `REFUSED` |

Keep the dashboard open at http://localhost:3000 to view telemetry events. Exact output and latency may vary.

## 5. Query the Resolver Directly

These commands run `dig` inside the resolver container. The quotes around `@127.0.0.1` are important in PowerShell.

```powershell
docker compose --env-file .env -f src/docker-compose.yml exec resolver dig '@127.0.0.1' valid.aegis.test A +dnssec
docker compose --env-file .env -f src/docker-compose.yml exec resolver dig '@127.0.0.1' bogus.aegis.test A +dnssec
docker compose --env-file .env -f src/docker-compose.yml exec resolver dig '@127.0.0.1' insecure.aegis.test A +dnssec
```

## 6. Measure Gateway Overhead

With the stack running and local certificates generated, run the benchmark
from the repository root:

```powershell
py src/scripts/benchmark_gateway.py --cold-samples 3 --warm-samples 20 --json-out benchmark-results.json
```

The direct Unbound baseline uses `127.0.0.1:15353`; the authenticated gateway's
container port `853` is mapped to host port `8853`. Cold samples restart
Unbound before each measured DNS request. Warm samples prime the same name
before timing. The unauthenticated case only measures mTLS rejection and has
no Unbound cache state. Restarting Unbound during the cold phase briefly
interrupts other resolver clients.

## 7. Build, Upload, and Monitor the ESP32

The PlatformIO firmware project is located at `src/esp32/`.

### 6.1 Prepare local ESP32 configuration

If the local secrets header does not exist yet:

```powershell
if (-not (Test-Path src\esp32\include\secrets.h)) {
    Copy-Item src\esp32\include\secrets.h.example src\esp32\include\secrets.h
}
```

Edit `src\esp32\include\secrets.h` and set the Wi-Fi and gateway configuration. The ESP32 must be able to reach the gateway host over the network; do not use `localhost` as the gateway address on the device.

Generate the certificate header from the local project PKI:

```powershell
powershell -File src\esp32\tools\gen_certs_header.ps1
```

This creates the ignored `src/esp32/include/certs.h`, which contains the client certificate and private key. Do not commit or share it.

### 6.2 Build the firmware

```powershell
pio run -d src\esp32
```

If your PlatformIO installation uses the isolated project cache used during development, set it first:

```powershell
$env:PLATFORMIO_CORE_DIR = Join-Path $env:USERPROFILE '.pio-a3'
pio run -d src\esp32
```

### 6.3 Upload firmware to the ESP32

Connect the ESP32 using a USB data cable, then run:

```powershell
pio run -d src\esp32 -t upload
```

If PlatformIO does not select the correct serial port, identify the ESP32 COM port in Windows Device Manager and specify it, for example:

```powershell
pio run -d src\esp32 -t upload --upload-port COM5
```

Replace `COM5` with the actual port.

### 6.4 Open the serial monitor

```powershell
pio device monitor -d src\esp32 -b 115200
```

The firmware should report Wi-Fi connection, time synchronization, TLS handshake status, and results for:

- `valid.aegis.test`
- `bogus.aegis.test`
- `insecure.aegis.test`

A successful build or upload alone does not establish that the end-to-end DNSSEC tests passed. Check the serial output.

### 6.5 Stream ESP32 telemetry to the dashboard

The gateway already streams DNS query verdicts and gateway latency to the
dashboard. To show the ESP32's own TLS handshake time, DNS round-trip time,
response flags, and free heap as a separate live feed, install the host
requirements and run the serial bridge. Close PlatformIO's serial monitor
first; only one program can use the ESP32 serial port at a time.

```powershell
py -m pip install -r requirements.txt
pio device list
py src\tools\serial_to_dashboard.py --port COM13
```

Replace `COM13` with the ESP32 port shown on your computer. Keep the
dashboard open at http://localhost:3000. The bridge posts telemetry to the
local dashboard, which broadcasts it immediately to connected browsers.
Device-side DNS observations are shown separately from gateway metrics;
DNSSEC validation remains the responsibility of the gateway resolver.

## 7. Restart or Rebuild a Service

For example, to rebuild and recreate the gateway after changing its source:

```powershell
docker compose --env-file .env -f src/docker-compose.yml up -d --build --force-recreate gateway
```

Replace `gateway` with `dashboard`, `resolver`, or `authoritative` as appropriate.

## 8. Stop the Project

Stop and remove the Docker containers and project network:

```powershell
docker compose --env-file .env -f src/docker-compose.yml down
```

This does not remove the generated certificate files or DNS data stored in the project directories.

To start again later, use the command in **Section 2**:

```powershell
docker compose --env-file .env -f src/docker-compose.yml up --build -d
```

## Security Reminders

- Do not commit `.env`, `src/esp32/include/secrets.h`, generated `certs.h`, or private keys.
- Do not disable TLS certificate verification to work around certificate or hostname problems.
- The ESP32 client uses mutual TLS to connect to the gateway; the gateway's configured Unbound resolver performs DNSSEC validation.
- Do not expose the resolver or authoritative DNS service publicly for this local lab.
