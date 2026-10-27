This folder contains the AegisDNS application source, service Dockerfiles,
Docker Compose configuration, test script, and ESP32 firmware.

Run the stack from the repository root using the root `.env` file:

```powershell
docker compose --env-file .env -f src/docker-compose.yml up --build -d
```

See the root [README](../README.md) for setup, verification, and
troubleshooting instructions.
