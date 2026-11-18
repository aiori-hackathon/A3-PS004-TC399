'use strict';

const { normalizeDeviceId, deviceLabel } = require('./device');
const { createMemoryStore } = require('./memoryStore');

function parseDateSafe(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed);
  return new Date();
}

function stripMetricDoc(doc) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    timestamp: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : String(doc.timestamp),
  };
}

function stripTelemetryDoc(doc) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    timestamp: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : String(doc.timestamp),
    receivedAt: doc.receivedAt instanceof Date ? doc.receivedAt.toISOString() : doc.receivedAt,
  };
}

function stripDeviceDoc(doc) {
  return {
    deviceId: doc.deviceId,
    label: doc.label || doc.deviceId,
    firstSeen: doc.firstSeen instanceof Date ? doc.firstSeen.toISOString() : String(doc.firstSeen),
    lastSeen: doc.lastSeen instanceof Date ? doc.lastSeen.toISOString() : String(doc.lastSeen),
  };
}

function stripTestRunDoc(doc) {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    startedAt: doc.startedAt instanceof Date ? doc.startedAt.toISOString() : String(doc.startedAt),
  };
}

function createMongoStore(options) {
  const {
    mongoUrl,
    dbName = 'aegisdns',
    maxMetrics = 2000,
    maxTelemetry = 2000,
    maxTestRuns = 2000,
    maxBuffer = 2000,
    retentionDays = 30,
    mongoClientFactory = null,
  } = options;

  const retentionSeconds = Math.max(3600, Math.round(Number(retentionDays || 30) * 86400));
  const fallback = createMemoryStore({ maxMetrics, maxTelemetry, maxTestRuns });

  let client = null;
  let db = null;
  let ready = false;
  let degraded = true;
  let lastError = 'MongoDB connection pending';
  let closed = false;
  let retryAttempt = 0;
  let retryTimer = null;
  let flushing = false;

  const pendingMetrics = [];
  const pendingTelemetry = [];
  const pendingTestRuns = [];

  function pushBounded(queue, item) {
    queue.push(item);
    if (queue.length > maxBuffer) {
      queue.shift();
    }
  }

  function markDegraded(context, err) {
    const msg = err && err.message ? err.message : String(err);
    const wasReady = ready && !degraded;
    degraded = true;
    lastError = msg;
    if (wasReady) {
      console.error(`[Storage] MongoDB DEGRADED (${context}): ${msg}`);
    } else {
      console.error(`[Storage] MongoDB unavailable (${context}): ${msg}`);
    }
    scheduleReconnect();
  }

  async function ensureTimeSeriesCollection(name, extraIndexes) {
    const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
    if (existing.length === 0) {
      await db.createCollection(name, {
        timeseries: {
          timeField: 'timestamp',
          metaField: 'deviceId',
          granularity: 'seconds',
        },
        expireAfterSeconds: retentionSeconds,
      });
    } else {
      try {
        await db.command({ collMod: name, expireAfterSeconds: retentionSeconds });
      } catch (err) {
        console.warn(`[Storage] Could not update TTL on ${name}: ${err.message}`);
      }
    }

    const col = db.collection(name);
    await col.createIndex({ deviceId: 1, timestamp: -1 });
    await col.createIndex({ id: 1 });
    for (const idx of extraIndexes || []) {
      await col.createIndex(idx.spec, idx.options || {});
    }
  }

  async function ensureSchema() {
    await ensureTimeSeriesCollection('dns_metrics');
    await ensureTimeSeriesCollection('device_telemetry');

    const devicesCol = db.collection('devices');
    await devicesCol.createIndex({ deviceId: 1 }, { unique: true });
    await devicesCol.createIndex({ lastSeen: -1 });

    const testRunsCol = db.collection('test_runs');
    await testRunsCol.createIndex({ runId: 1, startedAt: -1 });
    await testRunsCol.createIndex({ deviceId: 1, startedAt: -1 });
    await testRunsCol.createIndex({ id: 1 }, { unique: true, sparse: true });
    try {
      await testRunsCol.createIndex(
        { startedAt: 1 },
        { expireAfterSeconds: retentionSeconds },
      );
    } catch (err) {
      console.warn(`[Storage] Could not ensure TTL index on test_runs: ${err.message}`);
    }
  }

  async function upsertDevice(deviceId, label, seenDate) {
    const cleanLabel = deviceLabel(label, deviceId);
    const update = {
      $setOnInsert: { deviceId, firstSeen: seenDate },
      $max: { lastSeen: seenDate },
    };
    if (cleanLabel && cleanLabel !== 'unknown') {
      update.$set = { label: cleanLabel };
    } else {
      update.$setOnInsert.label = cleanLabel;
    }
    await db.collection('devices').updateOne({ deviceId }, update, { upsert: true });
  }

  async function flushBuffers() {
    if (!ready || !db || flushing || closed) return;
    flushing = true;
    try {
      // Replay buffered DNS metrics without duplicates
      if (pendingMetrics.length > 0) {
        const batch = pendingMetrics.slice();
        const ids = batch.map((m) => m.id);
        const existingDocs = await db
          .collection('dns_metrics')
          .find({ id: { $in: ids } }, { projection: { id: 1 } })
          .toArray();
        const existingIds = new Set(existingDocs.map((d) => d.id));
        const toInsert = batch.filter((m) => !existingIds.has(m.id));
        if (toInsert.length > 0) {
          const docs = toInsert.map((m) => ({
            ...m,
            timestamp: parseDateSafe(m.timestamp),
          }));
          await db.collection('dns_metrics').insertMany(docs, { ordered: false });
          for (const m of toInsert) {
            await upsertDevice(m.deviceId, m.client, parseDateSafe(m.timestamp));
          }
        }
        pendingMetrics.splice(0, batch.length);
        console.log(`[Storage] Replayed ${toInsert.length} buffered DNS metric(s) to MongoDB`);
      }

      // Replay buffered device telemetry without duplicates
      if (pendingTelemetry.length > 0) {
        const batch = pendingTelemetry.slice();
        const ids = batch.map((e) => e.id);
        const existingDocs = await db
          .collection('device_telemetry')
          .find({ id: { $in: ids } }, { projection: { id: 1 } })
          .toArray();
        const existingIds = new Set(existingDocs.map((d) => d.id));
        const toInsert = batch.filter((e) => !existingIds.has(e.id));
        if (toInsert.length > 0) {
          const docs = toInsert.map((e) => ({
            ...e,
            timestamp: parseDateSafe(e.timestamp),
            receivedAt: parseDateSafe(e.receivedAt || e.timestamp),
          }));
          await db.collection('device_telemetry').insertMany(docs, { ordered: false });
          for (const e of toInsert) {
            await upsertDevice(e.deviceId, e.deviceId, parseDateSafe(e.receivedAt || e.timestamp));
          }
        }
        pendingTelemetry.splice(0, batch.length);
        console.log(`[Storage] Replayed ${toInsert.length} buffered telemetry event(s) to MongoDB`);
      }

      // Replay buffered test runs without duplicates
      if (pendingTestRuns.length > 0) {
        const batch = pendingTestRuns.slice();
        const ids = batch.map((r) => r.id).filter(Boolean);
        const existingDocs = ids.length
          ? await db
              .collection('test_runs')
              .find({ id: { $in: ids } }, { projection: { id: 1 } })
              .toArray()
          : [];
        const existingIds = new Set(existingDocs.map((d) => d.id));
        const toInsert = batch.filter((r) => !existingIds.has(r.id));
        if (toInsert.length > 0) {
          const docs = toInsert.map((r) => ({
            ...r,
            startedAt: parseDateSafe(r.startedAt),
          }));
          await db.collection('test_runs').insertMany(docs, { ordered: false });
        }
        pendingTestRuns.splice(0, batch.length);
        console.log(`[Storage] Replayed ${toInsert.length} buffered test run(s) to MongoDB`);
      }

      if (degraded) {
        degraded = false;
        lastError = null;
        console.log('[Storage] MongoDB recovered and healthy');
      }
    } catch (err) {
      markDegraded('replay', err);
    } finally {
      flushing = false;
    }
  }

  function scheduleReconnect() {
    if (closed || retryTimer) return;
    const delayMs = Math.min(15000, 1000 * Math.pow(2, Math.min(retryAttempt, 4)));
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void attemptConnect();
    }, delayMs);
    if (typeof retryTimer.unref === 'function') retryTimer.unref();
  }

  async function attemptConnect() {
    if (closed) return;
    try {
      if (!client) {
        if (mongoClientFactory) {
          client = mongoClientFactory(mongoUrl);
        } else {
          const { MongoClient } = require('mongodb');
          client = new MongoClient(mongoUrl, {
            serverSelectionTimeoutMS: 2000,
            connectTimeoutMS: 2000,
            socketTimeoutMS: 5000,
          });
        }
        await client.connect();
        db = client.db(dbName);
        await ensureSchema();
      } else {
        await db.command({ ping: 1 }, { maxTimeMS: 1500 });
        if (!ready) {
          await ensureSchema();
        }
      }
      ready = true;
      retryAttempt = 0;
      await flushBuffers();
      if (!degraded) {
        console.log(`[Storage] MongoDB connected (db=${dbName}, retention=${retentionDays}d)`);
      }
    } catch (err) {
      ready = false;
      if (client) {
        try {
          await client.close();
        } catch (_) {
          // ignore close errors during retry
        }
        client = null;
        db = null;
      }
      markDegraded('connect', err);
    }
  }

  return {
    mode: 'mongo',
    isAsync: true,

    connect() {
      return attemptConnect();
    },

    async close() {
      closed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (client) {
        try {
          await client.close();
        } catch (_) {
          // ignore
        }
        client = null;
        db = null;
      }
      ready = false;
    },

    getHealth() {
      const bufferedWrites =
        pendingMetrics.length + pendingTelemetry.length + pendingTestRuns.length;
      const isOk = ready && !degraded;
      return {
        storage: isOk ? 'ok' : 'degraded',
        persistent: true,
        bufferedWrites,
        ...(isOk || !lastError ? {} : { storageError: lastError }),
      };
    },

    async checkHealth() {
      if (db && ready) {
        try {
          await db.command({ ping: 1 }, { maxTimeMS: 1000 });
          if (degraded) {
            await flushBuffers();
          }
        } catch (err) {
          ready = false;
          markDegraded('health-ping', err);
        }
      } else if (!closed) {
        scheduleReconnect();
      }
      return this.getHealth();
    },

    async saveMetric(metric) {
      const deviceId = metric.deviceId || normalizeDeviceId(metric.client);
      const stored = { ...metric, deviceId };
      fallback.saveMetric(stored);

      if (!ready || !db) {
        pushBounded(pendingMetrics, stored);
        scheduleReconnect();
        return stored;
      }

      try {
        const tsDate = parseDateSafe(stored.timestamp);
        await db.collection('dns_metrics').insertOne({
          ...stored,
          timestamp: tsDate,
        });
        await upsertDevice(deviceId, stored.client, tsDate);
        if (degraded) {
          void flushBuffers();
        }
      } catch (err) {
        pushBounded(pendingMetrics, stored);
        markDegraded('saveMetric', err);
      }
      return stored;
    },

    async getMetrics(filter = {}) {
      const limit = Math.min(Math.max(1, Number(filter.limit) || maxMetrics), maxMetrics);
      if (!ready || !db) {
        return fallback.getMetrics({ device: filter.device, limit });
      }
      try {
        const query = {};
        if (filter.device) {
          query.deviceId = normalizeDeviceId(filter.device);
        }
        const docs = await db
          .collection('dns_metrics')
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();
        const results = docs.reverse().map(stripMetricDoc);

        // Include any still-buffered writes (deduped) so caller never loses visibility
        if (pendingMetrics.length > 0) {
          const seen = new Set(results.map((r) => r.id));
          for (const item of pendingMetrics) {
            if (query.deviceId && item.deviceId !== query.deviceId) continue;
            if (!seen.has(item.id)) {
              results.push(item);
              seen.add(item.id);
            }
          }
          return results.slice(-limit);
        }
        return results;
      } catch (err) {
        markDegraded('getMetrics', err);
        return fallback.getMetrics({ device: filter.device, limit });
      }
    },

    async saveTelemetry(event) {
      const deviceId = event.deviceId || 'unknown';
      const stored = { ...event, deviceId };
      fallback.saveTelemetry(stored);

      if (!ready || !db) {
        pushBounded(pendingTelemetry, stored);
        scheduleReconnect();
        return stored;
      }

      try {
        const tsDate = parseDateSafe(stored.timestamp);
        const receivedDate = parseDateSafe(stored.receivedAt || stored.timestamp);
        await db.collection('device_telemetry').insertOne({
          ...stored,
          timestamp: tsDate,
          receivedAt: receivedDate,
        });
        await upsertDevice(deviceId, deviceId, receivedDate);
        if (degraded) {
          void flushBuffers();
        }
      } catch (err) {
        pushBounded(pendingTelemetry, stored);
        markDegraded('saveTelemetry', err);
      }
      return stored;
    },

    async getTelemetry(filter = {}) {
      const limit = Math.min(Math.max(1, Number(filter.limit) || maxTelemetry), maxTelemetry);
      if (!ready || !db) {
        return fallback.getTelemetry({ device: filter.device, limit });
      }
      try {
        const query = {};
        if (filter.device) {
          query.deviceId = normalizeDeviceId(filter.device);
        }
        const docs = await db
          .collection('device_telemetry')
          .find(query)
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray();
        const results = docs.reverse().map(stripTelemetryDoc);

        if (pendingTelemetry.length > 0) {
          const seen = new Set(results.map((r) => r.id));
          for (const item of pendingTelemetry) {
            if (query.deviceId && item.deviceId !== query.deviceId) continue;
            if (!seen.has(item.id)) {
              results.push(item);
              seen.add(item.id);
            }
          }
          return results.slice(-limit);
        }
        return results;
      } catch (err) {
        markDegraded('getTelemetry', err);
        return fallback.getTelemetry({ device: filter.device, limit });
      }
    },

    async getDevices() {
      if (!ready || !db) {
        return fallback.getDevices();
      }
      try {
        const docs = await db.collection('devices').find({}).sort({ lastSeen: -1 }).toArray();
        return docs.map(stripDeviceDoc);
      } catch (err) {
        markDegraded('getDevices', err);
        return fallback.getDevices();
      }
    },

    async saveTestRun(run) {
      const stored = { ...run };
      fallback.saveTestRun(stored);

      if (!ready || !db) {
        pushBounded(pendingTestRuns, stored);
        scheduleReconnect();
        return stored;
      }

      try {
        const startedDate = parseDateSafe(stored.startedAt);
        await db.collection('test_runs').insertOne({
          ...stored,
          startedAt: startedDate,
        });
        if (stored.deviceId) {
          await upsertDevice(stored.deviceId, stored.deviceId, startedDate);
        }
        if (degraded) {
          void flushBuffers();
        }
      } catch (err) {
        pushBounded(pendingTestRuns, stored);
        markDegraded('saveTestRun', err);
      }
      return stored;
    },

    async getTestRuns(filter = {}) {
      const limit = Math.min(Math.max(1, Number(filter.limit) || maxTestRuns), maxTestRuns);
      if (!ready || !db) {
        return fallback.getTestRuns({ device: filter.device, runId: filter.runId, limit });
      }
      try {
        const query = {};
        if (filter.device) query.deviceId = normalizeDeviceId(filter.device);
        if (filter.runId) query.runId = String(filter.runId);
        const docs = await db
          .collection('test_runs')
          .find(query)
          .sort({ startedAt: -1 })
          .limit(limit)
          .toArray();
        return docs.map(stripTestRunDoc);
      } catch (err) {
        markDegraded('getTestRuns', err);
        return fallback.getTestRuns({ device: filter.device, runId: filter.runId, limit });
      }
    },
  };
}

module.exports = { createMongoStore };
