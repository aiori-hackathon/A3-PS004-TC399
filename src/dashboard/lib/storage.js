'use strict';

const { createMemoryStore } = require('./memoryStore');
const { createMongoStore } = require('./mongoStore');

function buildMongoUrl(options = {}) {
  const explicit = typeof options.mongoUrl === 'string' ? options.mongoUrl.trim() : '';
  if (explicit) return explicit;

  const host = typeof options.mongoHost === 'string' ? options.mongoHost.trim() : '';
  if (!host) return '';

  const port = Number(options.mongoPort || 27017);
  const dbName = (options.dbName || 'aegisdns').trim();
  const user = typeof options.mongoUser === 'string' ? options.mongoUser : '';
  const password = typeof options.mongoPassword === 'string' ? options.mongoPassword : '';

  if (user) {
    const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`;
    return `mongodb://${auth}${host}:${port}/${encodeURIComponent(dbName)}?authSource=admin`;
  }
  return `mongodb://${host}:${port}/${encodeURIComponent(dbName)}`;
}

function createStorage(options = {}) {
  const mongoUrl = buildMongoUrl(options);
  if (!mongoUrl) {
    return createMemoryStore(options);
  }
  return createMongoStore({ ...options, mongoUrl });
}

module.exports = {
  buildMongoUrl,
  createStorage,
  createMemoryStore,
  createMongoStore,
};
