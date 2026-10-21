AegisDNS quick start (Windows PowerShell)

1. Start Docker Desktop.
2. Extract this ZIP's contents into your AegisDNS folder.
3. Open PowerShell in that folder.
4. Run: Copy-Item .env.example .env
5. Generate certificates: docker compose --profile tools run --rm certgen
6. Build/start: docker compose up --build -d
7. Verify DNSSEC:
   docker compose exec resolver dig @127.0.0.1 valid.aegis.test A +dnssec
   docker compose exec resolver dig @127.0.0.1 bogus.aegis.test A +dnssec
   docker compose exec resolver dig @127.0.0.1 insecure.aegis.test A +dnssec
8. Open http://localhost:3000
9. Test the DoT gateway: py scripts/test_gateway.py
10. Stop: docker compose down

Read README.md for ESP32 setup, expected output, troubleshooting, and security notes.
