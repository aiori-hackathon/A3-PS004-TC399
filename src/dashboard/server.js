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
const metrics = [];

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'AegisDNS dashboard' });
});

app.get('/api/metrics', (_req, res) => {
  res.json({ metrics });
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

  metrics.push(metric);
  if (metrics.length > MAX_METRICS) metrics.shift();
  io.emit('dns_metric', metric);
  res.status(202).json({ accepted: true });
});

io.on('connection', (socket) => {
  console.log(`[Dashboard] Browser connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[Dashboard] Browser disconnected: ${socket.id}`));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AegisDNS dashboard listening on port ${PORT}`);
});
