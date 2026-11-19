const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const originalLoad = Module._load;
const routes = new Map();
const emitted = [];
const app = {
  disable() {},
  use() {},
  get(route, handler) {
    for (const pathname of Array.isArray(route) ? route : [route]) {
      routes.set(`GET ${pathname}`, handler);
    }
  },
  post(route, handler) {
    routes.set(`POST ${route}`, handler);
  },
};
const express = () => app;
express.json = () => () => {};
express.static = () => () => {};

Module._load = function (request, parent, isMain) {
  if (request === 'express') return express;
  if (request === 'http') return { createServer: () => ({ listen() {} }) };
  if (request === 'socket.io') {
    return {
      Server: class {
        on() {}
        emit(...args) {
          emitted.push(args);
        }
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  require(path.join(__dirname, '..', 'src', 'dashboard', 'server.js'));
} finally {
  Module._load = originalLoad;
}

function request(method, pathname, body, query) {
  const result = {};
  const handler = routes.get(`${method} ${pathname}`);
  assert.ok(handler, `missing route ${method} ${pathname}`);
  handler(
    { body, query },
    {
      status(code) {
        result.status = code;
        return this;
      },
      json(value) {
        result.body = value;
        return this;
      },
    },
  );
  return result;
}

test('accepts and broadcasts a valid gateway metric', () => {
  const response = request('POST', '/api/metrics', {
    query: 'valid.aegis.test',
    status: 'SECURE',
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(emitted.at(-1)[0], 'dns_metric');
  assert.equal(emitted.at(-1)[1].query, 'valid.aegis.test');
});

test('rejects invalid gateway metric payloads', () => {
  assert.equal(request('POST', '/api/metrics', []).status, 400);
  assert.equal(
    request('POST', '/api/metrics', {
      query: 'valid.aegis.test',
      status: 'NOT_A_STATUS',
    }).status,
    400,
  );
  assert.equal(
    request('POST', '/api/metrics', {
      query: 'bogus.aegis.test',
      status: 'BOGUS',
      ede_info: [{ code: -1, text: 'invalid' }],
    }).status,
    400,
  );
});

test('accepts and broadcasts valid device telemetry', () => {
  const response = request('POST', '/api/device/telemetry', {
    kind: 'tls_handshake',
    latency_ms: 120,
    free_heap: 32000,
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(emitted.at(-1)[0], 'device_telemetry');
  assert.equal(emitted.at(-1)[1].free_heap, 32000);
});

test('rejects invalid device telemetry payloads', () => {
  assert.equal(request('POST', '/api/device/telemetry', null).status, 400);
  assert.equal(
    request('POST', '/api/device/telemetry', { kind: 'unknown' }).status,
    400,
  );
  assert.equal(
    request('POST', '/api/device/telemetry', {
      kind: 'dns_result',
      query: 'valid.aegis.test',
      rcode: 'NOERROR',
      ad: true,
      id_match: true,
      latency_ms: -1,
      free_heap: 100,
    }).status,
    400,
  );
});

test('returns APNIC status structure', () => {
  const response = request('GET', '/api/apnic/status');
  assert.ok(response.body);
  assert.ok('dataset_serial' in response.body);
  assert.ok('checksum_verification_status' in response.body);
  assert.ok('signature_verification_status' in response.body);
  assert.ok('current_update_status' in response.body);
});

test('returns APNIC summary structure with type counts', () => {
  const response = request('GET', '/api/apnic/summary');
  assert.ok(response.body);
  assert.ok(typeof response.body.total_records === 'number');
  assert.ok(typeof response.body.ipv4_count === 'number');
  assert.ok(typeof response.body.ipv6_count === 'number');
  assert.ok(typeof response.body.asn_count === 'number');
  assert.ok(typeof response.body.by_status === 'object');
  assert.ok(typeof response.body.top_countries === 'object');
});

test('returns APNIC metadata structure', () => {
  const response = request('GET', '/api/apnic/metadata');
  assert.ok(response.body);
  assert.equal(response.body.dataset_name, 'delegated-apnic-latest');
  assert.ok('serial_number' in response.body);
  assert.ok('record_count' in response.body);
  assert.ok('sha256_fingerprint' in response.body);
});

test('returns APNIC lookup results via GET /api/apnic/lookup', () => {
  const response = request('GET', '/api/apnic/lookup', null, { resource: '103.21.244.0' });
  assert.ok(response.body);
  assert.equal(response.body.found, true);
  assert.equal(response.body.country_code, 'US');

  // Specific ?ip= query
  const resIp = request('GET', '/api/apnic/lookup', null, { ip: '103.21.244.0' });
  assert.ok(resIp.body);
  assert.equal(resIp.body.found, true);
  assert.equal(resIp.body.resource_type, 'ipv4');

  // Specific ?asn= query
  const resAsn = request('GET', '/api/apnic/lookup', null, { asn: 'AS1221' });
  assert.ok(resAsn.body);
  assert.equal(resAsn.body.found, true);
  assert.equal(resAsn.body.country_code, 'AU');

  const missing = request('GET', '/api/apnic/lookup', null, {});
  assert.equal(missing.status, 400);
});

test('returns APNIC paginated and filtered resources via GET /api/apnic/resources', () => {
  const resAll = request('GET', '/api/apnic/resources', null, { page: '1', limit: '10' });
  assert.ok(resAll.body);
  assert.equal(resAll.body.page, 1);
  assert.equal(resAll.body.limit, 10);
  assert.ok(resAll.body.total > 0);
  assert.equal(resAll.body.resources.length, 10);

  // Filter by country
  const resAu = request('GET', '/api/apnic/resources', null, { country: 'AU', limit: '5' });
  assert.ok(resAu.body.total > 0);
  assert.equal(resAu.body.resources.length, 5);
  for (const r of resAu.body.resources) {
    assert.equal(r.country_code, 'AU');
  }

  // Filter by type
  const resIpv6 = request('GET', '/api/apnic/resources', null, { type: 'ipv6', limit: '5' });
  for (const r of resIpv6.body.resources) {
    assert.equal(r.resource_type, 'ipv6');
  }

  // Invalid filter returns 400
  const resInvalid = request('GET', '/api/apnic/resources', null, { country: 'INVALID' });
  assert.equal(resInvalid.status, 400);
});
