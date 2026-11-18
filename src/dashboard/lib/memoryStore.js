'use strict';

const { normalizeDeviceId, deviceLabel } = require('./device');

function createMemoryStore(options = {}) {
  const maxMetrics = options.maxMetrics || 2000;
  const maxTelemetry = options.maxTelemetry || 2000;
  const maxTestRuns = options.maxTestRuns || 2000;

  const metrics = [];
  const deviceTelemetry = [];
  const testRuns = [];
  const devices = new Map();

  function touchDevice(deviceId, label, seenAtIso) {
    const seen = seenAtIso || new Date().toISOString();
    const existing = devices.get(deviceId);
    if (existing) {
      if (label && label !== 'unknown') existing.label = label;
      existing.lastSeen = seen;
    } else {
      devices.set(deviceId, {
        deviceId,
        label: deviceLabel(label, deviceId),
        firstSeen: seen,
        lastSeen: seen,
      });
    }
  }

  return {
    mode: 'memory',
    isAsync: false,

    connect() {
      return Promise.resolve();
    },

    close() {
      return Promise.resolve();
    },

    getHealth() {
      return {
        storage: 'memory',
        persistent: false,
      };
    },

    saveMetric(metric) {
      const id = metric.deviceId || normalizeDeviceId(metric.client);
      const stored = { ...metric, deviceId: id };
      metrics.push(stored);
      if (metrics.length > maxMetrics) metrics.shift();
      touchDevice(id, metric.client, stored.timestamp);
      return stored;
    },

    getMetrics(filter = {}) {
      const limit = Math.min(Math.max(1, Number(filter.limit) || maxMetrics), maxMetrics);
      let list = metrics;
      if (filter.device) {
        const target = normalizeDeviceId(filter.device);
        list = metrics.filter((m) => (m.deviceId || normalizeDeviceId(m.client)) === target);
      }
      return list.slice(-limit);
    },

    saveTelemetry(event) {
      const id = event.deviceId || 'unknown';
      const stored = { ...event, deviceId: id };
      deviceTelemetry.push(stored);
      if (deviceTelemetry.length > maxTelemetry) deviceTelemetry.shift();
      touchDevice(id, stored.deviceId, stored.receivedAt || stored.timestamp);
      return stored;
    },

    getTelemetry(filter = {}) {
      const limit = Math.min(Math.max(1, Number(filter.limit) || maxTelemetry), maxTelemetry);
      let list = deviceTelemetry;
      if (filter.device) {
        const target = normalizeDeviceId(filter.device);
        list = deviceTelemetry.filter((e) => (e.deviceId || 'unknown') === target);
      }
      return list.slice(-limit);
    },

    getDevices() {
      return Array.from(devices.values()).sort((a, b) =>
        String(b.lastSeen).localeCompare(String(a.lastSeen)),
      );
    },

    saveTestRun(run) {
      const stored = { ...run };
      testRuns.push(stored);
      if (testRuns.length > maxTestRuns) testRuns.shift();
      if (stored.deviceId) {
        touchDevice(stored.deviceId, stored.deviceId, stored.startedAt);
      }
      return stored;
    },

    getTestRuns(filter = {}) {
      const limit = Math.min(Math.max(1, Number(filter.limit) || maxTestRuns), maxTestRuns);
      let list = testRuns;
      if (filter.device) {
        const target = normalizeDeviceId(filter.device);
        list = list.filter((r) => r.deviceId === target);
      }
      if (filter.runId) {
        list = list.filter((r) => r.runId === filter.runId);
      }
      return list.slice(-limit).reverse();
    },
  };
}

module.exports = { createMemoryStore };
