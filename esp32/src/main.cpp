#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <cstring>

// Set these before flashing. The server certificate contains the DNS SAN
// aegisdns.local. Configure a local DNS/mDNS mapping from this name to the PC
// running Docker. Using the name ensures the TLS hostname check is meaningful.
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* GATEWAY_HOST = "aegisdns.local"; // Must resolve to your PC IP and match the certificate DNS SAN
const uint16_t GATEWAY_PORT = 853;

// Paste the contents of pki/rootCA.crt, pki/esp32-client.crt and
// pki/esp32-client.key into these PEM strings. Never paste rootCA.key here.
static const char* ROOT_CA = R"PEM(
-----BEGIN CERTIFICATE-----
PASTE_ROOT_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)PEM";

static const char* CLIENT_CERT = R"PEM(
-----BEGIN CERTIFICATE-----
PASTE_ESP32_CLIENT_CERTIFICATE_HERE
-----END CERTIFICATE-----
)PEM";

static const char* CLIENT_KEY = R"PEM(
-----BEGIN PRIVATE KEY-----
PASTE_ESP32_CLIENT_PRIVATE_KEY_HERE
-----END PRIVATE KEY-----
)PEM";

const char* DOMAINS[] = {
  "valid.aegis.test",
  "bogus.aegis.test",
  "insecure.aegis.test"
};
const size_t DOMAIN_COUNT = sizeof(DOMAINS) / sizeof(DOMAINS[0]);
uint16_t nextDnsId = 1000;

void put16(uint8_t* out, size_t& offset, uint16_t value) {
  out[offset++] = static_cast<uint8_t>((value >> 8) & 0xff);
  out[offset++] = static_cast<uint8_t>(value & 0xff);
}

uint16_t get16(const uint8_t* in, size_t offset) {
  return (static_cast<uint16_t>(in[offset]) << 8) | in[offset + 1];
}

bool encodeName(const char* name, uint8_t* out, size_t& offset, size_t cap) {
  const char* label = name;
  while (*label) {
    const char* dot = strchr(label, '.');
    size_t n = dot ? static_cast<size_t>(dot - label) : strlen(label);
    if (n == 0 || n > 63 || offset + n + 1 >= cap) return false;
    out[offset++] = static_cast<uint8_t>(n);
    memcpy(out + offset, label, n);
    offset += n;
    if (!dot) break;
    label = dot + 1;
  }
  if (offset >= cap) return false;
  out[offset++] = 0;
  return true;
}

size_t buildQuery(const char* name, uint8_t* out, size_t cap, uint16_t id) {
  if (cap < 32) return 0;
  memset(out, 0, cap);
  size_t offset = 0;
  put16(out, offset, id);
  put16(out, offset, 0x0100); // RD=1, CD=0
  put16(out, offset, 1);      // QDCOUNT
  put16(out, offset, 0);      // ANCOUNT
  put16(out, offset, 0);      // NSCOUNT
  put16(out, offset, 0);      // ARCOUNT
  if (!encodeName(name, out, offset, cap)) return 0;
  put16(out, offset, 1); // QTYPE A
  put16(out, offset, 1); // QCLASS IN
  return offset;
}

bool readExact(WiFiClientSecure& client, uint8_t* out, size_t n, uint32_t timeoutMs = 6000) {
  size_t got = 0;
  uint32_t started = millis();
  while (got < n && millis() - started < timeoutMs) {
    int availableBytes = client.available();
    if (availableBytes > 0) {
      size_t want = min(n - got, static_cast<size_t>(availableBytes));
      int justRead = client.read(out + got, want);
      if (justRead > 0) got += static_cast<size_t>(justRead);
    } else if (!client.connected()) {
      return false;
    } else {
      delay(1);
    }
  }
  return got == n;
}

bool runQuery(const char* domain) {
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  client.setCertificate(CLIENT_CERT);
  client.setPrivateKey(CLIENT_KEY);
  // TLS certificate validation remains enabled. Do not use setInsecure().
  uint32_t start = micros();
  if (!client.connect(GATEWAY_HOST, GATEWAY_PORT)) {
    Serial.printf("[TLS] Connection/certificate verification failed for %s\n", domain);
    client.stop();
    return false;
  }

  uint8_t query[512];
  uint16_t id = nextDnsId++;
  size_t queryLength = buildQuery(domain, query, sizeof(query), id);
  if (queryLength == 0) {
    Serial.println("[DNS] Could not encode query name");
    client.stop();
    return false;
  }

  uint8_t prefix[2] = {
    static_cast<uint8_t>((queryLength >> 8) & 0xff),
    static_cast<uint8_t>(queryLength & 0xff)
  };
  if (client.write(prefix, 2) != 2 || client.write(query, queryLength) != queryLength) {
    Serial.println("[TLS] Failed to write DNS query");
    client.stop();
    return false;
  }

  uint8_t replyPrefix[2];
  if (!readExact(client, replyPrefix, 2)) {
    Serial.println("[TLS] Timed out reading DNS response length");
    client.stop();
    return false;
  }
  size_t responseLength = get16(replyPrefix, 0);
  if (responseLength < 12 || responseLength > 4096) {
    Serial.printf("[DNS] Invalid response length: %u\n", static_cast<unsigned>(responseLength));
    client.stop();
    return false;
  }

  static uint8_t response[4096];
  if (!readExact(client, response, responseLength)) {
    Serial.println("[TLS] Timed out reading DNS response");
    client.stop();
    return false;
  }
  float latencyMs = (micros() - start) / 1000.0f;
  uint16_t responseId = get16(response, 0);
  uint16_t flags = get16(response, 2);
  uint8_t rcode = flags & 0x0f;
  bool ad = (flags & 0x0020) != 0;
  if (responseId != id) {
    Serial.println("[DNS] Response ID did not match query ID");
    client.stop();
    return false;
  }

  const char* status = "DNS_ERROR";
  if ((rcode == 0 || rcode == 3) && ad) status = "SECURE";
  else if ((rcode == 0 || rcode == 3) && !ad) status = "INSECURE_OR_UNAUTHENTICATED";
  else if (rcode == 2) status = "SERVFAIL (expected for bogus test)";

  Serial.printf("[DNS] %-28s status=%s rcode=%u AD=%u latency=%.2f ms\n",
                domain, status, rcode, ad ? 1 : 0, latencyMs);
  client.stop();
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nAegisDNS ESP32 DoT demo");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.printf("\nWi-Fi connected; ESP32 IP: %s\n", WiFi.localIP().toString().c_str());
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(2000);
    return;
  }
  for (size_t i = 0; i < DOMAIN_COUNT; ++i) {
    runQuery(DOMAINS[i]);
    delay(1200);
  }
  delay(3000);
}
