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

function request(method, pathname, body) {
  const result = {};
  const handler = routes.get(`${method} ${pathname}`);
  assert.ok(handler, `missing route ${method} ${pathname}`);
  handler(
    { body },
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
