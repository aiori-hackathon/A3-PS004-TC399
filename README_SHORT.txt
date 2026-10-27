AegisDNS quick start (Windows PowerShell)

1. Start Docker Desktop.
2. Extract this ZIP's contents into your AegisDNS folder.
3. Open PowerShell in that folder.
4. Run: Copy-Item .env.example .env
5. Generate certificates: docker compose --env-file .env -f src/docker-compose.yml --profile tools run --build --rm certgen
6. Build/start: docker compose --env-file .env -f src/docker-compose.yml up --build -d
7. Verify DNSSEC:
   docker compose --env-file .env -f src/docker-compose.yml exec resolver dig @127.0.0.1 valid.aegis.test A +dnssec
   docker compose --env-file .env -f src/docker-compose.yml exec resolver dig @127.0.0.1 bogus.aegis.test A +dnssec
   docker compose --env-file .env -f src/docker-compose.yml exec resolver dig @127.0.0.1 insecure.aegis.test A +dnssec
8. Open http://localhost:3000
9. Test the DoT gateway: py src/scripts/test_gateway.py
10. Stop: docker compose --env-file .env -f src/docker-compose.yml down

Read README.md for ESP32 setup, expected output, troubleshooting, and security notes.
