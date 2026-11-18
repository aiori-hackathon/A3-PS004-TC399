'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeDeviceId } = require('../src/dashboard/lib/device');
const { buildMongoUrl, createMemoryStore, createMongoStore } = require('../src/dashboard/lib/storage');

test('buildMongoUrl safely encodes special characters like @ in passwords', () => {
  const url = buildMongoUrl({
    mongoHost: 'mongodb',
    mongoPort: 27017,
    mongoUser: 'aegisdns',
    mongoPassword: 'pass@2006#special:1/2',
    dbName: 'aegisdns',
  });
  assert.equal(
    url,
    'mongodb://aegisdns:pass%402006%23special%3A1%2F2@mongodb:27017/aegisdns?authSource=admin',
  );
  assert.equal(buildMongoUrl({}), '');
});

test('normalizeDeviceId normalises CN labels and falls back to unknown', () => {
  assert.equal(normalizeDeviceId('esp32-client'), 'esp32-client');
  assert.equal(normalizeDeviceId('  ESP32 Lab #2  '), 'esp32-lab-2');
  assert.equal(normalizeDeviceId(''), 'unknown');
  assert.equal(normalizeDeviceId(null), 'unknown');
  assert.equal(normalizeDeviceId('   '), 'unknown');
});

test('memory store keys metrics by client CN, supports device filtering, and lists devices', () => {
  const store = createMemoryStore({ maxMetrics: 100, maxTelemetry: 100 });
  assert.equal(store.getHealth().storage, 'memory');
  assert.equal(store.getHealth().persistent, false);

  store.saveMetric({
    id: 'm1',
    timestamp: '2026-11-18T10:00:00.000Z',
    query: 'valid.aegis.test.',
    type: 'A',
    status: 'SECURE',
    latency_ms: 4.2,
    cpu_percent: 2.1,
    client: 'esp32-lab-1',
  });
  store.saveMetric({
    id: 'm2',
    timestamp: '2026-11-18T10:00:05.000Z',
    query: 'bogus.aegis.test.',
    type: 'A',
    status: 'BOGUS',
    latency_ms: 6.8,
    cpu_percent: 3.0,
    client: 'esp32-lab-2',
    ede_info: [{ code: 6, text: 'DNSSEC Bogus' }],
  });

  const all = store.getMetrics();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, 'm1');
  assert.equal(all[1].id, 'm2');

  const d1 = store.getMetrics({ device: 'esp32-lab-1' });
  assert.equal(d1.length, 1);
  assert.equal(d1[0].deviceId, 'esp32-lab-1');

  const devices = store.getDevices();
  assert.equal(devices.length, 2);
  assert.deepEqual(
    devices.map((d) => d.deviceId).sort(),
    ['esp32-lab-1', 'esp32-lab-2'],
  );

  // Test hardware metrics persistence in memory store
  store.saveTelemetry({
    id: 't1',
    timestamp: '2026-11-18T10:00:10.000Z',
    deviceId: 'esp32-lab-1',
    kind: 'tls_handshake',
    latency_ms: 85,
    cpu_percent: 24.5,
    ram_used_bytes: 125000,
    ram_total_bytes: 327680,
    free_heap_bytes: 202680,
    free_heap: 202680,
  });
  const tEvents = store.getTelemetry({ device: 'esp32-lab-1' });
  assert.equal(tEvents.length, 1);
  assert.equal(tEvents[0].cpu_percent, 24.5);
  assert.equal(tEvents[0].ram_used_bytes, 125000);
  assert.equal(tEvents[0].ram_total_bytes, 327680);
  assert.equal(tEvents[0].free_heap_bytes, 202680);
});

test('mongo store buffers writes when degraded and replays without duplicates on recovery', async () => {
  let failWrites = true;
  const collections = {
    dns_metrics: [],
    device_telemetry: [],
    devices: new Map(),
    test_runs: [],
  };

  function makeFakeCollection(name) {
    return {
      async createIndex() { return 'ok'; },
      async insertOne(doc) {
        if (failWrites) throw new Error('Simulated Mongo outage');
        collections[name].push(doc);
        return { insertedId: doc.id };
      },
      async insertMany(docs) {
        if (failWrites) throw new Error('Simulated Mongo outage');
        for (const d of docs) collections[name].push(d);
        return { insertedCount: docs.length };
      },
      async updateOne(filter, update) {
        if (failWrites) throw new Error('Simulated Mongo outage');
        const key = filter.deviceId;
        const existing = collections.devices.get(key) || {
          deviceId: key,
          firstSeen: update.$setOnInsert?.firstSeen || new Date(),
          label: update.$setOnInsert?.label || key,
          lastSeen: update.$max?.lastSeen || new Date(),
        };
        if (update.$set?.label) existing.label = update.$set.label;
        if (update.$max?.lastSeen && update.$max.lastSeen > existing.lastSeen) {
          existing.lastSeen = update.$max.lastSeen;
        }
        collections.devices.set(key, existing);
      },
      find(query = {}) {
        const list = name === 'devices'
          ? Array.from(collections.devices.values())
          : collections[name].filter((doc) => {
              if (query.deviceId && doc.deviceId !== query.deviceId) return false;
              if (query.id && query.id.$in) return query.id.$in.includes(doc.id);
              return true;
            });
        return {
          sort() { return this; },
          limit() { return this; },
          async toArray() { return list.slice(); },
        };
      },
    };
  }

  const fakeClient = {
    async connect() {
      if (failWrites) throw new Error('Simulated initial outage');
    },
    async close() {},
    db() {
      return {
        listCollections() { return { async toArray() { return []; } }; },
        async createCollection() {},
        async command() {
          if (failWrites) throw new Error('Simulated ping failure');
          return { ok: 1 };
        },
        collection(name) { return makeFakeCollection(name); },
      };
    },
  };

  const store = createMongoStore({
    mongoUrl: 'mongodb://fake:27017/aegisdns',
    dbName: 'aegisdns',
    retentionDays: 30,
    mongoClientFactory: () => fakeClient,
  });

  await store.connect();
  assert.equal(store.getHealth().storage, 'degraded');

  // Write while Mongo is down — must not throw, must buffer
  await store.saveMetric({
    id: 'buf-1',
    timestamp: '2026-11-18T10:01:00.000Z',
    query: 'valid.aegis.test.',
    type: 'A',
    status: 'SECURE',
    latency_ms: 5.0,
    cpu_percent: 1.0,
    client: 'esp32-a',
  });
  await store.saveTelemetry({
    id: 'tel-1',
    timestamp: '2026-11-18T10:01:01.000Z',
    kind: 'tls_handshake',
    latency_ms: 110,
    free_heap: 42000,
    deviceId: 'esp32-a',
    schemaVersion: 2,
    receivedAt: '2026-11-18T10:01:01.000Z',
  });
  assert.equal(store.getHealth().bufferedWrites, 2);

  // Simulate duplicate already present before recovery
  collections.dns_metrics.push({ id: 'buf-1', deviceId: 'esp32-a', timestamp: new Date('2026-11-18T10:01:00.000Z') });

  // Mongo recovers
  failWrites = false;
  await store.connect();
  assert.equal(store.getHealth().storage, 'ok');
  assert.equal(store.getHealth().bufferedWrites, 0);
  // buf-1 was not duplicated
  assert.equal(collections.dns_metrics.filter((d) => d.id === 'buf-1').length, 1);
  // tel-1 was replayed
  assert.equal(collections.device_telemetry.filter((d) => d.id === 'tel-1').length, 1);

  await store.close();
});

const realMongoUrl = process.env.TEST_MONGO_URL;
test('real MongoDB integration: persists metrics, telemetry, devices, and test runs across reconnect', { skip: !realMongoUrl }, async () => {
  const dbName = `aegisdns_ci_${Date.now()}`;
  const store1 = createMongoStore({ mongoUrl: realMongoUrl, dbName, retentionDays: 7 });
  await store1.connect();
  assert.equal(store1.getHealth().storage, 'ok');

  await store1.saveMetric({
    id: 'ci-m1',
    timestamp: new Date('2026-11-18T12:00:00.000Z').toISOString(),
    query: 'valid.aegis.test.',
    type: 'A',
    status: 'SECURE',
    latency_ms: 3.5,
    cpu_percent: 2.0,
    client: 'esp32-alpha',
    ede_info: [],
  });
  await store1.saveMetric({
    id: 'ci-m2',
    timestamp: new Date('2026-11-18T12:00:02.000Z').toISOString(),
    query: 'bogus.aegis.test.',
    type: 'A',
    status: 'BOGUS',
    latency_ms: 8.1,
    cpu_percent: 2.5,
    client: 'esp32-beta',
    ede_info: [{ code: 6, text: 'DNSSEC Bogus' }],
  });
  await store1.saveTelemetry({
    id: 'ci-t1',
    timestamp: new Date('2026-11-18T12:00:03.000Z').toISOString(),
    kind: 'tls_handshake',
    latency_ms: 145,
    free_heap: 48000,
    deviceId: 'esp32-alpha',
    schemaVersion: 2,
    receivedAt: new Date('2026-11-18T12:00:03.000Z').toISOString(),
  });
  await store1.close();

  // Simulate restart with fresh store instance
  const store2 = createMongoStore({ mongoUrl: realMongoUrl, dbName, retentionDays: 7 });
  await store2.connect();
  const metrics = await store2.getMetrics();
  assert.equal(metrics.length, 2);
  assert.equal(metrics[0].id, 'ci-m1');
  assert.equal(metrics[1].id, 'ci-m2');
  const alphaOnly = await store2.getMetrics({ device: 'esp32-alpha' });
  assert.equal(alphaOnly.length, 1);
  const devices = await store2.getDevices();
  assert.equal(devices.length, 2);
  const telemetry = await store2.getTelemetry({ device: 'esp32-alpha' });
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].free_heap, 48000);
  await store2.close();
});
