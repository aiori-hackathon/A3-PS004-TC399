// AegisDNS ESP32 client: DNS-over-TLS (mutual TLS) to the AegisDNS gateway.
// There is intentionally NO plaintext/insecure fallback path in this file.
#include <Arduino.h>
#include <WiFi.h>
#if __has_include(<WiFiClientSecure.h>)
#include <WiFiClientSecure.h>
using TlsClient = WiFiClientSecure;
#elif __has_include(<NetworkClientSecure.h>)
#include <NetworkClientSecure.h>
using TlsClient = NetworkClientSecure;
#else
#error "ESP32 secure Wi-Fi client header is unavailable; select/install the ESP32 Arduino core"
#endif
#include <time.h>
#include "secrets.h"   // Wi-Fi + gateway address (ignored by Git)
#include "certs.h"     // CA_CERT, CLIENT_CERT, CLIENT_KEY (generated, ignored by Git)
#include <time.h>
#include <string.h>
#include <esp_system.h>

static const char* NAMES[] = {"valid.aegis.test", "bogus.aegis.test", "insecure.aegis.test"};
static const size_t NAME_COUNT = sizeof(NAMES) / sizeof(NAMES[0]);

static TlsClient tls;

static bool syncTime() {
  // TLS certificate validity checks need a correct clock.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  time_t now = 0;
  uint32_t start = millis();
  while (now < 1700000000 && millis() - start < 20000) { delay(250); time(&now); }
  return now >= 1700000000;
}

// Builds [2-byte length][DNS message] for an A query with EDNS0 DO=1, CD=0, RD=1.
static size_t buildQuery(const char* name, uint8_t* buf, size_t cap, uint16_t id) {
  if (cap < 64 + strlen(name)) return 0;
  size_t p = 2;
  buf[p++] = id >> 8; buf[p++] = id & 0xFF;
  buf[p++] = 0x01; buf[p++] = 0x00;           // flags: RD only (CD=0)
  buf[p++] = 0; buf[p++] = 1;                 // QDCOUNT
  buf[p++] = 0; buf[p++] = 0;                 // ANCOUNT
  buf[p++] = 0; buf[p++] = 0;                 // NSCOUNT
  buf[p++] = 0; buf[p++] = 1;                 // ARCOUNT (OPT)
  const char* s = name;
  while (*s) {
    const char* dot = strchr(s, '.');
    size_t len = dot ? (size_t)(dot - s) : strlen(s);
    if (len == 0 || len > 63) return 0;
    buf[p++] = (uint8_t)len; memcpy(buf + p, s, len); p += len;
    s += len; if (*s == '.') s++;
  }
  buf[p++] = 0;
  buf[p++] = 0; buf[p++] = 1;                 // QTYPE A
  buf[p++] = 0; buf[p++] = 1;                 // QCLASS IN
  const uint8_t opt[] = {0x00, 0x00, 0x29, 0x04, 0xD0, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00}; // DO=1
  memcpy(buf + p, opt, sizeof(opt)); p += sizeof(opt);
  size_t msgLen = p - 2;
  buf[0] = msgLen >> 8; buf[1] = msgLen & 0xFF;
  return p;
}

static bool readExact(uint8_t* dst, size_t n, uint32_t timeoutMs) {
  size_t got = 0; uint32_t start = millis();
  while (got < n && millis() - start < timeoutMs) {
    if (!tls.connected() && !tls.available()) break;
    int r = tls.read(dst + got, n - got);
    if (r > 0) got += r; else delay(5);
  }
  return got == n;
}

static const char* rcodeName(uint8_t rc) {
  switch (rc) { case 0: return "NOERROR"; case 1: return "FORMERR"; case 2: return "SERVFAIL";
                case 3: return "NXDOMAIN"; case 5: return "REFUSED"; default: return "OTHER"; }
}

static bool runQuery(const char* name) {
  uint8_t q[300];
  uint16_t id = (uint16_t)esp_random();
  size_t qlen = buildQuery(name, q, sizeof(q), id);
  if (!qlen) { Serial.printf("RESULT,%s,BUILD_ERROR\n", name); return true; }

  uint32_t t0 = micros();
  if (tls.write(q, qlen) != qlen) { Serial.printf("RESULT,%s,SEND_ERROR\n", name); return false; }
  uint8_t lenb[2];
  if (!readExact(lenb, 2, 5000)) { Serial.printf("RESULT,%s,TIMEOUT\n", name); return false; }
  size_t rlen = ((size_t)lenb[0] << 8) | lenb[1];
  if (rlen < 12) { Serial.printf("RESULT,%s,BAD_LENGTH,%u\n", name, (unsigned)rlen); return false; }

  uint8_t header[12];
  uint32_t responseStart = millis();
  if (!readExact(header, sizeof(header), 5000)) { Serial.printf("RESULT,%s,SHORT_READ\n", name); return false; }
  bool idOk = (((uint16_t)header[0] << 8) | header[1]) == id;
  if (!idOk) { Serial.printf("RESULT,%s,ID_MISMATCH\n", name); return false; }

  size_t remaining = rlen - sizeof(header);
  uint8_t discard[128];
  while (remaining > 0) {
    uint32_t elapsed = millis() - responseStart;
    if (elapsed >= 5000) { Serial.printf("RESULT,%s,SHORT_READ\n", name); return false; }
    size_t chunk = remaining < sizeof(discard) ? remaining : sizeof(discard);
    if (!readExact(discard, chunk, 5000 - elapsed)) { Serial.printf("RESULT,%s,SHORT_READ\n", name); return false; }
    remaining -= chunk;
  }
  uint32_t us = micros() - t0;

  uint8_t rcode = header[3] & 0x0F;
  bool ad = header[3] & 0x20;
  Serial.printf("RESULT,%s,%s,rcode=%u,AD=%d,id_match=1,latency_ms=%.2f,free_heap=%u\n",
                name, rcodeName(rcode), rcode, ad, us / 1000.0, (unsigned)ESP.getFreeHeap());
  return true;
}

static void runRound() {
  Serial.printf("\n--- round start, free_heap=%u ---\n", (unsigned)ESP.getFreeHeap());
  tls.setCACert(CA_CERT);
  tls.setCertificate(CLIENT_CERT);
  tls.setPrivateKey(CLIENT_KEY);
  tls.setTimeout(10);

  uint32_t t0 = millis();
  if (!tls.connect(GATEWAY_HOST, GATEWAY_PORT)) {
    char err[100] = {0};
    int code = tls.lastError(err, sizeof(err));
    Serial.printf("TLS_CONNECT_FAILED,code=%d,%s (no fallback attempted)\n", code, err);
    return;
  }
  Serial.printf("TLS_HANDSHAKE_OK,handshake_ms=%lu,free_heap=%u\n",
                (unsigned long)(millis() - t0), (unsigned)ESP.getFreeHeap());
  for (size_t i = 0; i < NAME_COUNT; i++) {
    if (!runQuery(NAMES[i])) { tls.stop(); return; }
  }
  tls.stop();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("AegisDNS ESP32 client starting");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) { delay(500); Serial.print('.'); }
  if (WiFi.status() != WL_CONNECTED) { Serial.println("\nWi-Fi failed; restarting"); delay(2000); ESP.restart(); }
  Serial.printf("\nWi-Fi OK, IP=%s\n", WiFi.localIP().toString().c_str());
  if (!syncTime()) { Serial.println("NTP sync failed; restarting"); delay(2000); ESP.restart(); }
  Serial.println("Time synced");
}

void loop() {
  runRound();
  delay(ROUND_INTERVAL_S * 1000UL);
}
