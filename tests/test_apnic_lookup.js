'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { ApnicService } = require('../src/dashboard/lib/apnic');

const DB_PATH = path.resolve(__dirname, '../data/apnic/apnic.db');
const STATUS_PATH = path.resolve(__dirname, '../data/apnic/sync_status.json');

const apnic = new ApnicService({ dbPath: DB_PATH, statusPath: STATUS_PATH });

test('APNIC lookup: IPv4 address at start of allocation', () => {
  const res = apnic.lookupResource('103.21.244.0');
  assert.equal(res.found, true);
  assert.equal(res.resource_type, 'ipv4');
  assert.equal(res.registry, 'apnic');
  assert.equal(res.country_code, 'US');
  assert.equal(res.start, '103.21.244.0');
  assert.equal(res.value, '1024');
  assert.equal(res.contained, true);
  assert.ok(res.range.includes('103.21.244.0'));
});

test('APNIC lookup: IPv4 address within middle of range', () => {
  const res = apnic.lookupResource('103.21.244.55');
  assert.equal(res.found, true);
  assert.equal(res.resource_type, 'ipv4');
  assert.equal(res.start, '103.21.244.0');
  assert.equal(res.contained, true);
});

test('APNIC lookup: IPv6 address at start of allocation', () => {
  const res = apnic.lookupResource('2404:6800::');
  assert.equal(res.found, true);
  assert.equal(res.resource_type, 'ipv6');
  assert.equal(res.country_code, 'AU');
  assert.equal(res.start, '2404:6800::');
  assert.equal(res.value, '32');
  assert.equal(res.contained, true);
  assert.ok(res.range.includes('2404:6800::/32'));
});

test('APNIC lookup: IPv6 address inside allocated subnet', () => {
  const res = apnic.lookupResource('2404:6800:4000::1');
  assert.equal(res.found, true);
  assert.equal(res.resource_type, 'ipv6');
  assert.equal(res.start, '2404:6800::');
  assert.equal(res.contained, true);
});

test('APNIC lookup: ASN with "AS" prefix', () => {
  const res = apnic.lookupResource('AS1221');
  assert.equal(res.found, true);
  assert.equal(res.resource_type, 'asn');
  assert.equal(res.country_code, 'AU');
  assert.equal(res.start, '1221');
});

test('APNIC lookup: ASN as pure number', () => {
  const res = apnic.lookupResource('4608');
  assert.equal(res.found, true);
  assert.equal(res.resource_type, 'asn');
  assert.equal(res.country_code, 'AU');
  assert.equal(res.start, '4608');
});

test('APNIC lookup: non-APNIC ASN returns found=false with helpful message', () => {
  const res = apnic.lookupResource('AS13335');
  assert.equal(res.found, false);
  assert.equal(res.resource_type, 'asn');
  assert.ok(res.message.includes('not found in the APNIC delegated registry'));
});

test('APNIC lookup: non-APNIC IPv4 returns found=false with helpful message', () => {
  const res = apnic.lookupResource('8.8.8.8');
  assert.equal(res.found, false);
  assert.equal(res.resource_type, 'ipv4');
  assert.ok(res.message.includes('not found in the APNIC delegated registry'));
});

test('APNIC lookup: rejects malformed input gracefully', () => {
  assert.equal(apnic.lookupResource('').found, false);
  assert.equal(apnic.lookupResource('    ').found, false);
  assert.equal(apnic.lookupResource('not-an-ip').found, false);
  assert.equal(apnic.lookupResource('999.999.999.999').found, false);
  assert.equal(apnic.lookupResource(':::').found, false);
});

test('APNIC lookup: SQL injection payload safety', () => {
  const injection1 = apnic.lookupResource("103.21.244.0' OR '1'='1");
  assert.equal(injection1.found, false);
  assert.ok(injection1.error);

  const injection2 = apnic.lookupResource("AS1'; DROP TABLE resources; --");
  assert.equal(injection2.found, false);
});

test('APNIC lookup: handles nonexistent database gracefully without crashing', () => {
  const missingService = new ApnicService({ dbPath: '/tmp/nonexistent-apnic.db' });
  const res = missingService.lookupResource('103.21.244.0');
  assert.equal(res.found, false);
  assert.ok(res.error.includes('not available'));
});

test('APNIC summary includes full country percentage breakdown', () => {
  const summary = apnic.getSummary();
  assert.ok(Array.isArray(summary.countries));
  assert.ok(summary.countries.length > 50);

  const first = summary.countries[0];
  assert.ok(first.country_code);
  assert.ok(typeof first.count === 'number');
  assert.ok(typeof first.percentage === 'number');
  assert.ok(first.percentage > 0);

  // Check sort order is descending
  for (let i = 1; i < summary.countries.length; i++) {
    assert.ok(summary.countries[i - 1].count >= summary.countries[i].count);
  }
});
