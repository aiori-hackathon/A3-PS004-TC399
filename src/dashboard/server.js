const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const MAX_METRICS = 2000;
const MAX_DEVICE_TELEMETRY = 2000;
const metrics = [];
const deviceTelemetry = [];

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'AegisDNS dashboard' });
});

app.get('/api/metrics', (_req, res) => {
  res.json({ metrics });
});

app.get('/api/device/telemetry', (_req, res) => {
  res.json({ events: deviceTelemetry });
});

const validStatuses = new Set([
  'SECURE', 'INSECURE', 'BOGUS', 'ERROR', 'BLOCKED_CD'
]);

app.post('/api/metrics', (req, res) => {
  const input = req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'Expected a JSON object' });
  }
  if (typeof input.query !== 'string' || typeof input.status !== 'string' ||
      !validStatuses.has(input.status)) {
    return res.status(400).json({ error: 'Invalid metric fields' });
  }

  const metric = {
    id: randomUUID(),
    timestamp: typeof input.timestamp === 'string' ? input.timestamp : new Date().toISOString(),
    query: input.query.slice(0, 253),
    type: typeof input.type === 'string' ? input.type.slice(0, 20) : 'UNKNOWN',
    status: input.status,
    latency_ms: Number.isFinite(input.latency_ms) ? Math.max(0, input.latency_ms) : 0,
    cpu_percent: Number.isFinite(input.cpu_percent)
      ? Math.max(0, Math.min(100, input.cpu_percent)) : 0,
    client: typeof input.client === 'string' ? input.client.slice(0, 64) : ''
  };
  if (input.ede_info !== undefined) {
    if (!Array.isArray(input.ede_info) || input.ede_info.length > 8 ||
        input.ede_info.some((ede) => !ede || typeof ede !== 'object' ||
          Array.isArray(ede) || !Number.isInteger(ede.code) ||
          ede.code < 0 || ede.code > 65535 || typeof ede.text !== 'string')) {
      return res.status(400).json({ error: 'Invalid EDE metric details' });
    }
    metric.ede_info = input.ede_info.map((ede) => ({
      code: ede.code,
      text: ede.text.slice(0, 256)
    }));
  }

  metrics.push(metric);
  if (metrics.length > MAX_METRICS) metrics.shift();
  io.emit('dns_metric', metric);
  res.status(202).json({ accepted: true });
});

const validDeviceTelemetryKinds = new Set([
  'serial_status', 'tls_handshake', 'tls_failure', 'dns_result'
]);

app.post('/api/device/telemetry', (req, res) => {
  const input = req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return res.status(400).json({ error: 'Expected a JSON object' });
  }
  if (typeof input.kind !== 'string' || !validDeviceTelemetryKinds.has(input.kind)) {
    return res.status(400).json({ error: 'Invalid device telemetry kind' });
  }

  const event = {
    id: randomUUID(),
    timestamp: typeof input.timestamp === 'string' && !Number.isNaN(Date.parse(input.timestamp))
      ? input.timestamp : new Date().toISOString(),
    kind: input.kind
  };
  const validLatency = Number.isFinite(input.latency_ms) && input.latency_ms >= 0;
  const validHeap = Number.isInteger(input.free_heap) && input.free_heap >= 0;

  switch (input.kind) {
    case 'serial_status':
      if (typeof input.connected !== 'boolean' || typeof input.port !== 'string') {
        return res.status(400).json({ error: 'Invalid serial status fields' });
      }
      event.connected = input.connected;
      event.port = input.port.slice(0, 64);
      break;
    case 'tls_handshake':
      if (!validLatency || !validHeap) {
        return res.status(400).json({ error: 'Invalid TLS handshake fields' });
      }
      event.latency_ms = input.latency_ms;
      event.free_heap = input.free_heap;
      break;
    case 'tls_failure':
      if (typeof input.error !== 'string') {
        return res.status(400).json({ error: 'Invalid TLS failure fields' });
      }
      event.error = input.error.slice(0, 200);
      break;
    case 'dns_result':
      if (typeof input.query !== 'string' || typeof input.rcode !== 'string' ||
          typeof input.ad !== 'boolean' || typeof input.id_match !== 'boolean' ||
          !validLatency || !validHeap) {
        return res.status(400).json({ error: 'Invalid DNS result fields' });
      }
      event.query = input.query.slice(0, 253);
      event.rcode = input.rcode.slice(0, 20);
      event.ad = input.ad;
      event.id_match = input.id_match;
      event.latency_ms = input.latency_ms;
      event.free_heap = input.free_heap;
      break;
  }

  deviceTelemetry.push(event);
  if (deviceTelemetry.length > MAX_DEVICE_TELEMETRY) deviceTelemetry.shift();
  io.emit('device_telemetry', event);
  res.status(202).json({ accepted: true });
});

io.on('connection', (socket) => {
  console.log(`[Dashboard] Browser connected: ${socket.id}`);
  socket.emit('device_telemetry_history', { events: deviceTelemetry.slice() });
  socket.on('disconnect', () => console.log(`[Dashboard] Browser disconnected: ${socket.id}`));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AegisDNS dashboard listening on port ${PORT}`);
});
