'use strict';

/**
 * Normalise a device identifier (e.g. mTLS cert CN or bridge DEVICE_ID)
 * into a stable, URL-safe key. Falls back to "unknown".
 */
function normalizeDeviceId(raw) {
  if (typeof raw !== 'string') return 'unknown';
  const trimmed = raw.trim();
  if (!trimmed) return 'unknown';
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return cleaned || 'unknown';
}

function deviceLabel(raw, fallbackId) {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim().slice(0, 64);
  }
  return fallbackId || 'unknown';
}

module.exports = {
  normalizeDeviceId,
  deviceLabel,
};
