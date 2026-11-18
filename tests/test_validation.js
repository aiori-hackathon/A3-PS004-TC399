'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validateMetricPayload,
  validateTelemetryPayload,
  validateTestRunPayload,
} = require('../src/dashboard/lib/validation');

test('accepts exact payloads emitted by gateway.py including ede_info and clamps cpu_percent > 100', () => {
  const res = validateMetricPayload({
    timestamp: '2026-11-18T12:00:00+00:00',
    query: 'bogus.aegis.test.',
    type: 'A',
    status: 'BOGUS',
    latency_ms: 14.32,
    cpu_percent: 145.6, // psutil can exceed 100 on multi-core
    client: 'esp32-client',
    ede_info: [{ code: 6, text: 'DNSSEC Bogus' }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.cpu_percent, 100);
  assert.equal(res.data.deviceId, 'esp32-client');
  assert.deepEqual(res.data.ede_info, [{ code: 6, text: 'DNSSEC Bogus' }]);
});

test('accepts minimal metric payload with optional defaults and truncates long strings', () => {
  const res = validateMetricPayload({
    query: 'a'.repeat(300),
    type: 'T'.repeat(50),
    status: 'SECURE',
    client: 'C'.repeat(100),
    ede_info: [{ code: 0, text: 'x'.repeat(400) }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.query.length, 253);
  assert.equal(res.data.type.length, 20);
  assert.equal(res.data.client.length, 64);
  assert.equal(res.data.ede_info[0].text.length, 256);
  assert.equal(res.data.latency_ms, 0);
  assert.equal(res.data.cpu_percent, 0);
});

test('rejects malformed and hostile metric payloads with issues', () => {
  const badCases = [
    null,
    [],
    'string',
    { status: 'SECURE' }, // missing query
    { query: '', status: 'SECURE' }, // empty query
    { query: 'valid.aegis.test', status: 'UNKNOWN_STATUS' },
    { query: 'valid.aegis.test', status: 'SECURE', latency_ms: -1 },
    { query: 'valid.aegis.test', status: 'SECURE', latency_ms: Number.NaN },
    { query: 'valid.aegis.test', status: 'SECURE', latency_ms: Number.POSITIVE_INFINITY },
    { query: 'valid.aegis.test', status: 'SECURE', latency_ms: '12.5' },
    { query: 'valid.aegis.test', status: 'SECURE', cpu_percent: -5 },
    { query: 'valid.aegis.test', status: 'SECURE', timestamp: 'not-a-date' },
    { query: 'valid.aegis.test', status: 'SECURE', ede_info: [{ code: -1, text: 'bad' }] },
    { query: 'valid.aegis.test', status: 'SECURE', ede_info: [{ code: 70000, text: 'bad' }] },
    { query: 'valid.aegis.test', status: 'SECURE', ede_info: Array(9).fill({ code: 1, text: 'x' }) },
  ];

  for (const payload of badCases) {
    const res = validateMetricPayload(payload);
    assert.equal(res.ok, false, `Expected rejection for ${JSON.stringify(payload)}`);
    assert.ok(typeof res.error === 'string' && res.error.length > 0);
    assert.ok(Array.isArray(res.issues) && res.issues.length > 0);
  }
});

test('strips unknown/hostile keys from validated metrics', () => {
  const hostile = JSON.parse('{"query":"valid.aegis.test","status":"SECURE","__proto__":{"polluted":true},"$where":"1==1"}');
  const res = validateMetricPayload(hostile);
  assert.equal(res.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(res.data, '$where'), false);
  assert.equal(({}).polluted, undefined);
});

test('accepts all 4 telemetry kinds and normalises 0/1 flags to booleans', () => {
  const s1 = validateTelemetryPayload({
    kind: 'serial_status',
    connected: 1,
    port: 'COM13',
    deviceId: 'ESP32-Lab-1',
    schemaVersion: 2,
  });
  assert.equal(s1.ok, true);
  assert.equal(s1.data.connected, true);
  assert.equal(s1.data.deviceId, 'esp32-lab-1');
  assert.equal(s1.data.schemaVersion, 2);

  const s2 = validateTelemetryPayload({
    kind: 'dns_result',
    query: 'valid.aegis.test',
    rcode: 'NOERROR',
    ad: 0,
    id_match: 1,
    latency_ms: 11.25,
    free_heap: 44120,
  });
  assert.equal(s2.ok, true);
  assert.equal(s2.data.ad, false);
  assert.equal(s2.data.id_match, true);
  assert.equal(s2.data.deviceId, 'unknown');
  assert.equal(s2.data.schemaVersion, 1);

  const s3 = validateTelemetryPayload({
    kind: 'tls_handshake',
    latency_ms: 120,
    free_heap: 50000,
  });
  assert.equal(s3.ok, true);

  const s4 = validateTelemetryPayload({
    kind: 'tls_failure',
    error: 'E'.repeat(300),
  });
  assert.equal(s4.ok, true);
  assert.equal(s4.data.error.length, 200);
});

test('rejects invalid telemetry kinds, string numbers, negative values, and invalid booleans', () => {
  const badCases = [
    null,
    { kind: 'bogus_kind' },
    { kind: 'serial_status', connected: 'true', port: 'COM3' },
    { kind: 'serial_status', connected: 2, port: 'COM3' },
    { kind: 'tls_handshake', latency_ms: -1, free_heap: 100 },
    { kind: 'tls_handshake', latency_ms: '120', free_heap: 100 },
    { kind: 'tls_handshake', latency_ms: 120, free_heap: 12.5 },
    { kind: 'dns_result', query: 'a.test', rcode: 'NOERROR', ad: '1', id_match: 1, latency_ms: 5, free_heap: 100 },
  ];
  for (const payload of badCases) {
    const res = validateTelemetryPayload(payload);
    assert.equal(res.ok, false, `Expected rejection for ${JSON.stringify(payload)}`);
    assert.ok(Array.isArray(res.issues) && res.issues.length > 0);
  }
});

test('validates test run payloads', () => {
  const ok = validateTestRunPayload({
    runId: 'run-123',
    deviceId: 'esp32-client',
    scenario: 'valid',
    domain: 'valid.aegis.test',
    expectedStatus: 'SECURE',
    observedStatus: 'SECURE',
    latency_ms: 12.4,
    passed: true,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.passed, true);

  const bad = validateTestRunPayload({
    runId: '',
    scenario: 'valid',
    domain: 'valid.aegis.test',
    expectedStatus: 'INVALID',
    observedStatus: 'SECURE',
    latency_ms: -2,
    passed: true,
  });
  assert.equal(bad.ok, false);
});
