'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = process.env.APNIC_DB_PATH || path.resolve(__dirname, '../../../data/apnic/apnic.db');
const DEFAULT_STATUS_PATH = process.env.APNIC_STATUS_PATH || path.resolve(__dirname, '../../../data/apnic/sync_status.json');

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
    if (this.isDbAvailable()) {
      try {
        const db = new DatabaseSync(this.dbPath, { readOnly: true });
        try {
          const stmt = db.prepare(`
            SELECT dataset_serial, imported_at, record_count, sha256, signature_verified
            FROM dataset_metadata
            WHERE is_active = 1
            ORDER BY id DESC LIMIT 1
          `);
          dbMetadata = stmt.get();
        } finally {
          db.close();
        }
      } catch (err) {
        console.warn('[APNIC] Failed to read database metadata for status:', err.message);
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
    };

    if (!this.isDbAvailable()) {
      return emptySummary;
    }

    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
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

        // Top Countries
        const ccRows = db.prepare(`
          SELECT country_code, COUNT(*) as cnt
          FROM resources
          WHERE country_code != '*'
          GROUP BY country_code
          ORDER BY cnt DESC
          LIMIT 10
        `).all();
        const topCountries = {};
        for (const r of ccRows) {
          topCountries[r.country_code] = Number(r.cnt);
        }

        const total = (typeCounts.ipv4 || 0) + (typeCounts.ipv6 || 0) + (typeCounts.asn || 0);

        return {
          total_records: total,
          ipv4_count: typeCounts.ipv4 || 0,
          ipv6_count: typeCounts.ipv6 || 0,
          asn_count: typeCounts.asn || 0,
          by_status: byStatus,
          top_countries: topCountries,
        };
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('[APNIC] Failed to compute summary statistics:', err.message);
      return emptySummary;
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

    if (!this.isDbAvailable()) {
      return emptyMeta;
    }

    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
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
