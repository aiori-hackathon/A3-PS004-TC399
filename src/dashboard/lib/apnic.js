'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = process.env.APNIC_DB_PATH || path.resolve(__dirname, '../../../data/apnic/apnic.db');
const DEFAULT_STATUS_PATH = process.env.APNIC_STATUS_PATH || path.resolve(__dirname, '../../../data/apnic/sync_status.json');

function ipv4ToBigInt(ipStr) {
  const parts = ipStr.trim().split('.');
  if (parts.length !== 4) return null;
  let num = 0n;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = BigInt(part);
    if (n < 0n || n > 255n) return null;
    num = (num << 8n) + n;
  }
  return num;
}

function ipv6ToBigInt(ipStr) {
  let s = ipStr.trim().toLowerCase();
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':');
    const v4Part = s.slice(lastColon + 1);
    const v4Num = ipv4ToBigInt(v4Part);
    if (v4Num === null) return null;
    const high = (v4Num >> 16n).toString(16);
    const low = (v4Num & 0xffffn).toString(16);
    s = s.slice(0, lastColon) + `:${high}:${low}`;
  }
  const doubleColon = s.indexOf('::');
  let parts;
  if (doubleColon !== -1) {
    const head = s.slice(0, doubleColon).split(':').filter(Boolean);
    const tail = s.slice(doubleColon + 2).split(':').filter(Boolean);
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    parts = [...head, ...new Array(missing).fill('0'), ...tail];
  } else {
    parts = s.split(':');
  }
  if (parts.length !== 8) return null;
  let result = 0n;
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    result = (result << 16n) + BigInt(parseInt(part, 16));
  }
  return result;
}

class ApnicService {
  constructor(options = {}) {
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.statusPath = options.statusPath || DEFAULT_STATUS_PATH;
  }

  isDbAvailable() {
    try {
      return fs.existsSync(this.dbPath) && fs.statSync(this.dbPath).size > 0;
    } catch {
      return false;
    }
  }

  _openDb() {
    if (!this.isDbAvailable()) return null;
    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        db.exec('PRAGMA busy_timeout = 5000;');
      } catch {
        // Ignored
      }
      return db;
    } catch (err) {
      console.warn('[APNIC] Could not open database:', err.message);
      return null;
    }
  }

  getStatus() {
    let fileStatus = null;
    if (fs.existsSync(this.statusPath)) {
      try {
        const raw = fs.readFileSync(this.statusPath, 'utf8');
        fileStatus = JSON.parse(raw);
      } catch (err) {
        console.warn('[APNIC] Failed to parse status file:', err.message);
      }
    }

    let dbMetadata = null;
    const db = this._openDb();
    if (db) {
      try {
        const stmt = db.prepare(`
          SELECT dataset_serial, imported_at, record_count, sha256, signature_verified
          FROM dataset_metadata
          WHERE is_active = 1
          ORDER BY id DESC LIMIT 1
        `);
        dbMetadata = stmt.get();
      } catch (err) {
        console.warn('[APNIC] Failed to read database metadata for status:', err.message);
      } finally {
        db.close();
      }
    }

    if (fileStatus) {
      return {
        dataset_serial: fileStatus.current_serial || (dbMetadata && dbMetadata.dataset_serial) || null,
        last_successful_import: fileStatus.last_successful_import || (dbMetadata && dbMetadata.imported_at) || null,
        last_update_attempt: fileStatus.last_update_attempt || null,
        signature_verification_status: fileStatus.signature_verification_status || (dbMetadata && dbMetadata.signature_verified ? 'VERIFIED' : 'PENDING_KEY_CONFIGURATION'),
        checksum_verification_status: fileStatus.checksum_verification_status || (dbMetadata ? 'VERIFIED' : 'UNAVAILABLE'),
        current_update_status: fileStatus.current_update_status || (dbMetadata ? 'IDLE' : 'UNAVAILABLE'),
        last_error: fileStatus.last_error || null,
        error_category: fileStatus.error_category || null,
        trusted_key_configured: Boolean(fileStatus.trusted_key_configured),
      };
    }

    if (dbMetadata) {
      return {
        dataset_serial: dbMetadata.dataset_serial || null,
        last_successful_import: dbMetadata.imported_at || null,
        last_update_attempt: dbMetadata.imported_at || null,
        signature_verification_status: dbMetadata.signature_verified ? 'VERIFIED' : 'PENDING_KEY_CONFIGURATION',
        checksum_verification_status: 'VERIFIED',
        current_update_status: 'IDLE',
        last_error: null,
        error_category: null,
        trusted_key_configured: false,
      };
    }

    return {
      dataset_serial: null,
      last_successful_import: null,
      last_update_attempt: null,
      signature_verification_status: 'UNAVAILABLE',
      checksum_verification_status: 'UNAVAILABLE',
      current_update_status: 'UNAVAILABLE',
      last_error: 'No APNIC dataset imported yet',
      error_category: 'NoDataset',
      trusted_key_configured: false,
    };
  }

  getSummary() {
    const emptySummary = {
      total_records: 0,
      ipv4_count: 0,
      ipv6_count: 0,
      asn_count: 0,
      by_status: {},
      top_countries: {},
      countries: [],
    };

    const db = this._openDb();
    if (!db) {
      return emptySummary;
    }

    try {
      try {
        // Types
        const typeRows = db.prepare(`
          SELECT resource_type, COUNT(*) as cnt
          FROM resources
          GROUP BY resource_type
        `).all();
        const typeCounts = {};
        for (const r of typeRows) {
          typeCounts[r.resource_type] = Number(r.cnt);
        }

        // Status
        const statusRows = db.prepare(`
          SELECT status, COUNT(*) as cnt
          FROM resources
          GROUP BY status
        `).all();
        const byStatus = {};
        for (const r of statusRows) {
          byStatus[r.status] = Number(r.cnt);
        }

        const total = (typeCounts.ipv4 || 0) + (typeCounts.ipv6 || 0) + (typeCounts.asn || 0);

        // Countries breakdown
        const countryRows = db.prepare(`
          SELECT country_code,
                 COUNT(*) as cnt,
                 SUM(CASE WHEN resource_type = 'ipv4' THEN 1 ELSE 0 END) as ipv4_cnt,
                 SUM(CASE WHEN resource_type = 'ipv6' THEN 1 ELSE 0 END) as ipv6_cnt,
                 SUM(CASE WHEN resource_type = 'asn' THEN 1 ELSE 0 END) as asn_cnt
          FROM resources
          WHERE country_code != '*'
          GROUP BY country_code
          ORDER BY cnt DESC
        `).all();

        const countries = countryRows.map((r) => {
          const c = Number(r.cnt);
          return {
            country_code: r.country_code,
            count: c,
            percentage: total > 0 ? Number(((c / total) * 100).toFixed(2)) : 0,
            ipv4_count: Number(r.ipv4_cnt || 0),
            ipv6_count: Number(r.ipv6_cnt || 0),
            asn_count: Number(r.asn_cnt || 0),
          };
        });

        const topCountries = {};
        for (const r of countryRows.slice(0, 10)) {
          topCountries[r.country_code] = Number(r.cnt);
        }

        return {
          total_records: total,
          ipv4_count: typeCounts.ipv4 || 0,
          ipv6_count: typeCounts.ipv6 || 0,
          asn_count: typeCounts.asn || 0,
          by_status: byStatus,
          top_countries: topCountries,
          countries,
        };
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[APNIC] Failed to compute summary statistics:', err.message);
      return emptySummary;
    }
  }

  parseResourceQuery(query) {
    if (typeof query !== 'string') return null;
    const clean = query.trim();
    if (!clean || clean.length > 256) return null;

    // Check ASN: "AS123", "as123", or pure digits
    const asnMatch = clean.match(/^(?:as)?(\d+)$/i);
    if (asnMatch && !clean.includes('.')) {
      const asnNum = Number(asnMatch[1]);
      if (Number.isSafeInteger(asnNum) && asnNum >= 0 && asnNum <= 4294967295) {
        return {
          type: 'asn',
          value: asnNum,
          query: clean,
          normalizedTarget: String(asnNum).padStart(10, '0'),
        };
      }
    }

    // Check IP
    const ipFamily = net.isIP(clean);
    if (ipFamily === 4) {
      const bInt = ipv4ToBigInt(clean);
      if (bInt !== null) {
        return {
          type: 'ipv4',
          value: clean,
          query: clean,
          normalizedTarget: bInt.toString(10).padStart(10, '0'),
        };
      }
    } else if (ipFamily === 6) {
      const bInt = ipv6ToBigInt(clean);
      if (bInt !== null) {
        return {
          type: 'ipv6',
          value: clean,
          query: clean,
          normalizedTarget: bInt.toString(16).padStart(32, '0'),
        };
      }
    }

    return null;
  }

  lookupResource(rawQuery) {
    if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
      return {
        found: false,
        error: 'Query parameter is required. Enter an IPv4, IPv6, or ASN.',
      };
    }

    const parsed = this.parseResourceQuery(rawQuery);
    if (!parsed) {
      return {
        found: false,
        error: `Invalid resource format: "${String(rawQuery).slice(0, 64)}". Please provide a valid IPv4 address (e.g. 103.21.244.0), IPv6 address (e.g. 2404:6800::), or ASN (e.g. AS1221).`,
      };
    }

    const db = this._openDb();
    if (!db) {
      return {
        found: false,
        query: parsed.query,
        resource_type: parsed.type,
        error: 'APNIC intelligence database is not available on this gateway node.',
      };
    }

    try {
      try {
        const stmt = db.prepare(`
          SELECT id, registry, country_code, resource_type, start, value, date, status, extensions
          FROM resources
          WHERE resource_type = ? AND start_num <= ? AND end_num >= ?
          LIMIT 1
        `);
        const row = stmt.get(parsed.type, parsed.normalizedTarget, parsed.normalizedTarget);
        if (!row) {
          return {
            found: false,
            query: parsed.query,
            resource_type: parsed.type,
            message: `Resource ${parsed.query} was not found in the APNIC delegated registry. (Note: APNIC only delegates resources in the Asia-Pacific region; other RIRs like ARIN, RIPE, LACNIC, and AFRINIC manage other ranges).`,
          };
        }

        let rangeDescription = row.start;
        if (row.resource_type === 'ipv4') {
          rangeDescription = `${row.start} (+${row.value} hosts)`;
        } else if (row.resource_type === 'ipv6') {
          rangeDescription = `${row.start}/${row.value} (CIDR prefix length)`;
        } else if (row.resource_type === 'asn') {
          rangeDescription = Number(row.value) > 1
            ? `AS${row.start} - AS${Number(row.start) + Number(row.value) - 1}`
            : `AS${row.start}`;
        }

        let datasetSerial = null;
        try {
          const metaRow = db.prepare('SELECT dataset_serial FROM dataset_metadata WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
          if (metaRow) datasetSerial = metaRow.dataset_serial;
        } catch {
          // Metadata read failure is non-fatal
        }

        return {
          found: true,
          query: parsed.query,
          registry: row.registry,
          country_code: row.country_code,
          resource_type: row.resource_type,
          start: row.start,
          value: row.value,
          date: row.date,
          status: row.status,
          extensions: row.extensions || '',
          range: rangeDescription,
          contained: true,
          dataset_serial: datasetSerial,
          disclaimer: 'Country code denotes administrative allocation in delegated-apnic-latest, not physical host geolocation.',
        };
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[APNIC] Lookup query failed:', err.message);
      return {
        found: false,
        query: parsed.query,
        resource_type: parsed.type,
        error: 'An internal error occurred while executing the lookup query.',
      };
    }
  }

  getResources(options = {}) {
    const defaultResult = {
      total: 0,
      page: 1,
      limit: 20,
      pages: 0,
      filters: {},
      resources: [],
    };

    if (!this.isDbAvailable()) {
      return {
        ...defaultResult,
        error: 'APNIC intelligence database is not available on this gateway node.',
      };
    }

    const rawCountry = typeof options.country === 'string' ? options.country.trim() : '';
    const rawType = typeof options.type === 'string' ? options.type.trim().toLowerCase() : '';
    const rawStatus = typeof options.status === 'string' ? options.status.trim().toLowerCase() : '';

    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const params = [];

    if (rawCountry) {
      if (/^[a-zA-Z]{2}$/i.test(rawCountry) || rawCountry === '*') {
        whereClauses.push('country_code = ?');
        params.push(rawCountry.toUpperCase());
      } else {
        return {
          ...defaultResult,
          error: `Invalid country code: "${rawCountry.slice(0, 16)}". Expected 2-letter ISO country code.`,
        };
      }
    }

    if (rawType) {
      if (['ipv4', 'ipv6', 'asn'].includes(rawType)) {
        whereClauses.push('resource_type = ?');
        params.push(rawType);
      } else {
        return {
          ...defaultResult,
          error: `Invalid resource type: "${rawType.slice(0, 16)}". Expected ipv4, ipv6, or asn.`,
        };
      }
    }

    if (rawStatus) {
      if (['allocated', 'assigned', 'reserved', 'available'].includes(rawStatus)) {
        whereClauses.push('status = ?');
        params.push(rawStatus);
      } else {
        return {
          ...defaultResult,
          error: `Invalid allocation status: "${rawStatus.slice(0, 16)}".`,
        };
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const db = this._openDb();
    if (!db) {
      return defaultResult;
    }

    try {
      try {
        let datasetSerial = null;
        try {
          const metaRow = db.prepare('SELECT dataset_serial FROM dataset_metadata WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
          if (metaRow) datasetSerial = metaRow.dataset_serial;
        } catch {
          // Metadata read failure is non-fatal
        }

        const countStmt = db.prepare(`SELECT COUNT(*) as total FROM resources ${whereSql}`);
        const countRow = countStmt.get(...params);
        const total = Number(countRow?.total || 0);
        const pages = Math.ceil(total / limit) || 1;

        const dataStmt = db.prepare(`
          SELECT id, registry, country_code, resource_type, start, value, date, status, extensions
          FROM resources
          ${whereSql}
          ORDER BY id ASC
          LIMIT ? OFFSET ?
        `);
        const rows = dataStmt.all(...params, limit, offset);

        const resources = rows.map((row) => {
          let rangeDescription = row.start;
          if (row.resource_type === 'ipv4') {
            rangeDescription = `${row.start} (+${row.value} hosts)`;
          } else if (row.resource_type === 'ipv6') {
            rangeDescription = `${row.start}/${row.value} (CIDR prefix length)`;
          } else if (row.resource_type === 'asn') {
            rangeDescription = Number(row.value) > 1
              ? `AS${row.start} - AS${Number(row.start) + Number(row.value) - 1}`
              : `AS${row.start}`;
          }

          return {
            id: Number(row.id),
            registry: row.registry,
            country_code: row.country_code,
            resource_type: row.resource_type,
            start: row.start,
            value: row.value,
            date: row.date,
            status: row.status,
            extensions: row.extensions || '',
            range: rangeDescription,
            dataset_serial: datasetSerial,
          };
        });

        return {
          total,
          page,
          limit,
          pages,
          filters: {
            country: rawCountry ? rawCountry.toUpperCase() : null,
            type: rawType || null,
            status: rawStatus || null,
          },
          resources,
        };
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[APNIC] Failed to fetch resources:', err.message);
      return {
        ...defaultResult,
        error: 'An internal error occurred while querying resources.',
      };
    }
  }

  getMetadata() {
    const emptyMeta = {
      dataset_name: 'delegated-apnic-latest',
      serial_number: null,
      start_date: null,
      end_date: null,
      record_count: 0,
      sha256_fingerprint: null,
      imported_at: null,
      source_filename: null,
    };

    const db = this._openDb();
    if (!db) {
      return emptyMeta;
    }

    try {
      try {
        const stmt = db.prepare(`
          SELECT dataset_serial, start_date, end_date, record_count,
                 sha256, signature_verified, imported_at, source_file
          FROM dataset_metadata
          WHERE is_active = 1
          ORDER BY id DESC LIMIT 1
        `);
        const row = stmt.get();
        if (!row) {
          return emptyMeta;
        }

        return {
          dataset_name: 'delegated-apnic-latest',
          serial_number: row.dataset_serial,
          start_date: row.start_date,
          end_date: row.end_date,
          record_count: Number(row.record_count),
          sha256_fingerprint: row.sha256,
          imported_at: row.imported_at,
          source_filename: path.basename(row.source_file || 'delegated-apnic-latest'),
        };
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[APNIC] Failed to query dataset metadata:', err.message);
      return emptyMeta;
    }
  }
}

module.exports = { ApnicService };
