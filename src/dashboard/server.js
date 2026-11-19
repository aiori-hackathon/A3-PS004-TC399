'use strict';

const fs = require('fs');
const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const { createStorage } = require('./lib/storage');
const { ApnicService } = require('./lib/apnic');
const {
  validateMetricPayload,
  validateTelemetryPayload,
  validateTestRunPayload,
} = require('./lib/validation');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const MAX_METRICS = 2000;
const MAX_DEVICE_TELEMETRY = 2000;
const MAX_TEST_RUNS = 2000;

const rejectionCounts = {
  metrics: 0,
  telemetry: 0,
  testRuns: 0,
  malformedJson: 0,
};

function recordRejection(bucket, endpoint, errorText, issues) {
  rejectionCounts[bucket] = (rejectionCounts[bucket] || 0) + 1;
  const summary = Array.isArray(issues) && issues.length
    ? issues.map((i) => `${i.path}: ${i.message}`).join('; ')
    : errorText;
  console.warn(
    `[Validation] Rejected POST ${endpoint} (count=${rejectionCounts[bucket]}): ${summary}`,
  );
}

const storage = createStorage({
  mongoUrl: process.env.MONGO_URL || '',
  mongoHost: process.env.MONGO_HOST || '',
  mongoPort: process.env.MONGO_PORT || 27017,
  mongoUser: process.env.MONGO_USER || '',
  mongoPassword: process.env.MONGO_PASSWORD || '',
  dbName: process.env.MONGO_DB || 'aegisdns',
  maxMetrics: MAX_METRICS,
  maxTelemetry: MAX_DEVICE_TELEMETRY,
  maxTestRuns: MAX_TEST_RUNS,
  retentionDays: Number(process.env.RETENTION_DAYS || 30),
  maxBuffer: Number(process.env.MAX_FALLBACK_BUFFER || 2000),
});

const apnic = new ApnicService();

if (storage.mode === 'mongo') {
  void storage.connect();
}

function runMaybeAsync(result, onSuccess, onError) {
  if (result && typeof result.then === 'function') {
    return result.then(onSuccess, onError);
  }
  return onSuccess(result);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') {
    recordRejection('malformedJson', req.path || 'unknown', 'Payload too large');
    return res.status(413).json({
      error: 'Payload too large',
      issues: [{ path: '(body)', message: 'Request body exceeds 16kb limit' }],
    });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    recordRejection('malformedJson', req.path || 'unknown', 'Malformed JSON body');
    return res.status(400).json({
      error: 'Expected a JSON object',
      issues: [{ path: '(body)', message: 'Invalid JSON syntax' }],
    });
  }
  return next(err);
});
const webDistPath = path.join(__dirname, 'web', 'dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
}
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  const healthOp = typeof storage.checkHealth === 'function'
    ? storage.checkHealth()
    : storage.getHealth();
  return runMaybeAsync(
    healthOp,
    (storageHealth) => {
      res.json({
        status: 'ok',
        service: 'AegisDNS dashboard',
        ...storageHealth,
        rejections: { ...rejectionCounts },
      });
    },
    (err) => {
      res.json({
        status: 'ok',
        service: 'AegisDNS dashboard',
        storage: 'degraded',
        persistent: storage.mode === 'mongo',
        storageError: err && err.message ? err.message : 'Storage health check failed',
        rejections: { ...rejectionCounts },
      });
    },
  );
});

app.get('/api/metrics', (req, res) => {
  const query = (req && req.query) || {};
  const device = typeof query.device === 'string' && query.device.trim() ? query.device : undefined;
  return runMaybeAsync(
    storage.getMetrics({ device, limit: MAX_METRICS }),
    (metrics) => res.json({ metrics }),
    (err) => {
      console.error('[API] GET /api/metrics failed:', err);
      res.status(500).json({ error: 'Failed to load metrics' });
    },
  );
});

app.get('/api/device/telemetry', (req, res) => {
  const query = (req && req.query) || {};
  const device = typeof query.device === 'string' && query.device.trim() ? query.device : undefined;
  return runMaybeAsync(
    storage.getTelemetry({ device, limit: MAX_DEVICE_TELEMETRY }),
    (events) => res.json({ events }),
    (err) => {
      console.error('[API] GET /api/device/telemetry failed:', err);
      res.status(500).json({ error: 'Failed to load device telemetry' });
    },
  );
});

app.get('/api/devices', (_req, res) => {
  return runMaybeAsync(
    storage.getDevices(),
    (devices) => res.json({ devices }),
    (err) => {
      console.error('[API] GET /api/devices failed:', err);
      res.status(500).json({ error: 'Failed to load devices' });
    },
  );
});

app.get('/api/test-runs', (req, res) => {
  const query = (req && req.query) || {};
  const device = typeof query.device === 'string' && query.device.trim() ? query.device : undefined;
  const runId = typeof query.runId === 'string' && query.runId.trim() ? query.runId : undefined;
  return runMaybeAsync(
    storage.getTestRuns({ device, runId, limit: MAX_TEST_RUNS }),
    (runs) => res.json({ runs }),
    (err) => {
      console.error('[API] GET /api/test-runs failed:', err);
      res.status(500).json({ error: 'Failed to load test runs' });
    },
  );
});

app.get('/api/apnic/status', (_req, res) => {
  try {
    const status = apnic.getStatus();
    res.json(status);
  } catch (err) {
    console.error('[API] GET /api/apnic/status failed:', err);
    res.status(500).json({ error: 'Failed to load APNIC status' });
  }
});

app.get('/api/apnic/summary', (_req, res) => {
  try {
    const summary = apnic.getSummary();
    res.json(summary);
  } catch (err) {
    console.error('[API] GET /api/apnic/summary failed:', err);
    res.status(500).json({ error: 'Failed to load APNIC summary' });
  }
});

app.get('/api/apnic/metadata', (_req, res) => {
  try {
    const metadata = apnic.getMetadata();
    res.json(metadata);
  } catch (err) {
    console.error('[API] GET /api/apnic/metadata failed:', err);
    res.status(500).json({ error: 'Failed to load APNIC metadata' });
  }
});

app.get('/api/apnic/lookup', (req, res) => {
  try {
    const query = req.query || {};
    const ip = typeof query.ip === 'string' ? query.ip.trim() : '';
    const asn = typeof query.asn === 'string' ? query.asn.trim() : '';
    const generic = (typeof query.resource === 'string' && query.resource.trim())
      || (typeof query.q === 'string' && query.q.trim())
      || (req.body && typeof req.body.resource === 'string' && req.body.resource.trim())
      || '';

    const target = ip || asn || generic;
    if (!target) {
      return res.status(400).json({
        found: false,
        error: 'Missing required query parameter: provide ?ip=, ?asn=, or ?resource= (e.g. /api/apnic/lookup?ip=103.21.244.0 or /api/apnic/lookup?asn=AS1221)',
      });
    }

    const result = apnic.lookupResource(target);
    res.json(result);
  } catch (err) {
    console.error('[API] GET /api/apnic/lookup failed:', err);
    res.status(500).json({ found: false, error: 'Internal lookup error' });
  }
});

app.get('/api/apnic/resources', (req, res) => {
  try {
    const query = req.query || {};
    const country = typeof query.country === 'string' ? query.country.trim() : '';
    const type = typeof query.type === 'string' ? query.type.trim() : '';
    const status = typeof query.status === 'string' ? query.status.trim() : '';
    const page = query.page !== undefined ? query.page : 1;
    const limit = query.limit !== undefined ? query.limit : 20;

    const result = apnic.getResources({ country, type, status, page, limit });
    if (result.error && result.error.startsWith('Invalid')) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[API] GET /api/apnic/resources failed:', err);
    res.status(500).json({
      total: 0,
      page: 1,
      limit: 20,
      pages: 0,
      filters: {},
      resources: [],
      error: 'Failed to retrieve APNIC resources',
    });
  }
});

app.post('/api/metrics', (req, res) => {
  const result = validateMetricPayload(req.body);
  if (!result.ok) {
    recordRejection('metrics', '/api/metrics', result.error, result.issues);
    return res.status(400).json({ error: result.error, issues: result.issues });
  }

  const metric = {
    id: randomUUID(),
    ...result.data,
  };

  return runMaybeAsync(
    storage.saveMetric(metric),
    (saved) => {
      io.emit('dns_metric', saved);
      res.status(202).json({ accepted: true });
    },
    (err) => {
      console.error('[API] POST /api/metrics storage failure:', err);
      io.emit('dns_metric', metric);
      res.status(202).json({ accepted: true });
    },
  );
});

app.post('/api/device/telemetry', (req, res) => {
  const result = validateTelemetryPayload(req.body);
  if (!result.ok) {
    recordRejection('telemetry', '/api/device/telemetry', result.error, result.issues);
    return res.status(400).json({ error: result.error, issues: result.issues });
  }

  const event = {
    id: randomUUID(),
    ...result.data,
  };

  return runMaybeAsync(
    storage.saveTelemetry(event),
    (saved) => {
      io.emit('device_telemetry', saved);
      res.status(202).json({ accepted: true });
    },
    (err) => {
      console.error('[API] POST /api/device/telemetry storage failure:', err);
      io.emit('device_telemetry', event);
      res.status(202).json({ accepted: true });
    },
  );
});

app.post('/api/test-runs', (req, res) => {
  const result = validateTestRunPayload(req.body);
  if (!result.ok) {
    recordRejection('testRuns', '/api/test-runs', result.error, result.issues);
    return res.status(400).json({ error: result.error, issues: result.issues });
  }

  const run = {
    id: randomUUID(),
    ...result.data,
  };

  return runMaybeAsync(
    storage.saveTestRun(run),
    (saved) => {
      res.status(202).json({ accepted: true, run: saved });
    },
    (err) => {
      console.error('[API] POST /api/test-runs storage failure:', err);
      res.status(202).json({ accepted: true, run });
    },
  );
});

io.on('connection', (socket) => {
  console.log(`[Dashboard] Browser connected: ${socket.id}`);
  void runMaybeAsync(
    storage.getTelemetry({ limit: MAX_DEVICE_TELEMETRY }),
    (events) => socket.emit('device_telemetry_history', { events }),
    (err) => {
      console.error('[Socket] Failed to load telemetry history:', err);
      socket.emit('device_telemetry_history', { events: [] });
    },
  );
  socket.on('disconnect', () => console.log(`[Dashboard] Browser disconnected: ${socket.id}`));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AegisDNS dashboard listening on port ${PORT} (storage=${storage.mode})`);
});

module.exports = { app, server, io, storage, rejectionCounts, apnic };
