import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  Database,
  ArrowUpDown,
  Info,
} from 'lucide-react';

interface ApnicStatus {
  dataset_serial: string | null;
  last_successful_import: string | null;
  last_update_attempt: string | null;
  signature_verification_status: string;
  checksum_verification_status: string;
  current_update_status: string;
  last_error: string | null;
  trusted_key_configured: boolean;
}

interface CountryRecord {
  country_code: string;
  count: number;
  percentage: number;
  ipv4_count?: number;
  ipv6_count?: number;
  asn_count?: number;
}

interface ApnicSummary {
  total_records: number;
  ipv4_count: number;
  ipv6_count: number;
  asn_count: number;
  by_status: Record<string, number>;
  top_countries: Record<string, number>;
  countries?: CountryRecord[];
}

interface ApnicMetadata {
  dataset_name: string;
  serial_number: string | null;
  start_date: string | null;
  end_date: string | null;
  record_count: number;
  sha256_fingerprint: string | null;
  imported_at: string | null;
  source_filename: string | null;
}

type SortField = 'count' | 'country_code' | 'percentage';
type SortOrder = 'asc' | 'desc';

export function ApnicMonitor() {
  const [status, setStatus] = useState<ApnicStatus | null>(null);
  const [summary, setSummary] = useState<ApnicSummary | null>(null);
  const [metadata, setMetadata] = useState<ApnicMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  // Country table state
  const [countrySearch, setCountrySearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showAllCountries, setShowAllCountries] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [stRes, sumRes, metaRes] = await Promise.all([
          fetch('/api/apnic/status').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/api/apnic/summary').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('/api/apnic/metadata').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);

        if (mounted) {
          setStatus(stRes);
          setSummary(sumRes);
          setMetadata(metaRes);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    }

    void loadData();
    const interval = setInterval(loadData, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Compute Freshness
  const freshnessInfo = useMemo(() => {
    if (!status?.last_successful_import) {
      return { label: 'NO DATA', isStale: true, hoursAgo: null, color: 'text-ivory/50' };
    }
    const ms = Date.now() - new Date(status.last_successful_import).getTime();
    const hours = Math.round(ms / (1000 * 3600));
    if (hours > 36) {
      return { label: `STALE (${hours}h ago)`, isStale: true, hoursAgo: hours, color: 'text-amber-400' };
    }
    return { label: `FRESH (${hours}h ago)`, isStale: false, hoursAgo: hours, color: 'text-emerald-400' };
  }, [status?.last_successful_import]);

  // Cryptographic & Integrity Status Badges
  const chkOk = status?.checksum_verification_status === 'VERIFIED';
  const sigStatus = status?.signature_verification_status || 'UNAVAILABLE';
  const sigOk = sigStatus === 'VERIFIED';
  const isPendingKey = sigStatus === 'PENDING_KEY_CONFIGURATION';
  const isRunning = status?.current_update_status === 'RUNNING';

  let overallLabel = 'IDLE';
  let overallBadgeClass = 'border-ivory/20 bg-ivory/10 text-ivory/70';

  if (isRunning) {
    overallLabel = 'RUNNING';
    overallBadgeClass = 'border-gold-400/40 bg-gold-400/20 text-gold-300';
  } else if (status?.last_error) {
    overallLabel = 'FAILED';
    overallBadgeClass = 'border-rose-500/40 bg-rose-500/20 text-rose-300';
  } else if (chkOk && sigOk) {
    if (freshnessInfo.isStale) {
      overallLabel = 'STALE';
      overallBadgeClass = 'border-amber-500/40 bg-amber-500/20 text-amber-300';
    } else {
      overallLabel = 'VERIFIED';
      overallBadgeClass = 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300';
    }
  } else if (isPendingKey) {
    overallLabel = 'PENDING_KEY_CONFIGURATION';
    overallBadgeClass = 'border-amber-500/40 bg-amber-500/20 text-amber-300';
  }

  // Country dataset
  const countryList: CountryRecord[] = useMemo(() => {
    if (summary?.countries && summary.countries.length > 0) {
      return summary.countries;
    }
    if (summary?.top_countries) {
      const tot = summary.total_records || 1;
      return Object.entries(summary.top_countries).map(([cc, cnt]) => ({
        country_code: cc,
        count: cnt,
        percentage: Number(((cnt / tot) * 100).toFixed(2)),
      }));
    }
    return [];
  }, [summary]);

  const filteredAndSortedCountries = useMemo(() => {
    let list = countryList;
    const term = countrySearch.trim().toUpperCase();
    if (term) {
      list = list.filter((c) => c.country_code.toUpperCase().includes(term));
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'country_code') {
        cmp = a.country_code.localeCompare(b.country_code);
      } else if (sortField === 'percentage') {
        cmp = a.percentage - b.percentage;
      } else {
        cmp = a.count - b.count;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [countryList, countrySearch, sortField, sortOrder]);

  const displayedCountries = showAllCountries
    ? filteredAndSortedCountries
    : filteredAndSortedCountries.slice(0, 10);

  // Distribution calculations
  const total = summary?.total_records || 1;
  const v4Pct = Number((((summary?.ipv4_count || 0) / total) * 100).toFixed(1));
  const v6Pct = Number((((summary?.ipv6_count || 0) / total) * 100).toFixed(1));
  const asnPct = Number((((summary?.asn_count || 0) / total) * 100).toFixed(1));

  const allocatedCount = summary?.by_status?.allocated || 0;
  const assignedCount = summary?.by_status?.assigned || 0;
  const statusTotal = allocatedCount + assignedCount || 1;
  const allocPct = Number(((allocatedCount / statusTotal) * 100).toFixed(1));
  const assignPct = Number(((assignedCount / statusTotal) * 100).toFixed(1));

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  return (
    <div className="space-y-8">
      {/* 1. Statistics Cards (6 Key Indicators) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Panel className="p-4 space-y-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50">Total Records</span>
          <span className="block font-serif text-2xl font-bold text-ivory">
            {summary ? summary.total_records.toLocaleString() : '–'}
          </span>
          <span className="block text-[10px] text-ivory/40">APNIC Delegated</span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50">IPv4 Blocks</span>
          <span className="block font-serif text-2xl font-bold text-emerald-400">
            {summary ? summary.ipv4_count.toLocaleString() : '–'}
          </span>
          <span className="block text-[10px] text-ivory/40">{v4Pct}% of records</span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50">IPv6 Prefixes</span>
          <span className="block font-serif text-2xl font-bold text-cyan-400">
            {summary ? summary.ipv6_count.toLocaleString() : '–'}
          </span>
          <span className="block text-[10px] text-ivory/40">{v6Pct}% of records</span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50">ASN Allocations</span>
          <span className="block font-serif text-2xl font-bold text-gold-300">
            {summary ? summary.asn_count.toLocaleString() : '–'}
          </span>
          <span className="block text-[10px] text-ivory/40">{asnPct}% of records</span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50">Dataset Serial</span>
          <span className="block font-mono text-xl font-bold text-ivory">
            {status?.dataset_serial || metadata?.serial_number || '–'}
          </span>
          <span className="block text-[10px] text-ivory/40">Daily publication ID</span>
        </Panel>

        <Panel className="p-4 space-y-1">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50">Freshness</span>
          <span className={`block font-mono text-sm font-bold ${freshnessInfo.color}`}>
            {freshnessInfo.label}
          </span>
          <span className="block text-[10px] text-ivory/40">
            {status?.last_successful_import
              ? new Date(status.last_successful_import).toLocaleDateString()
              : 'Pending import'}
          </span>
        </Panel>
      </div>

      {/* 2. Dataset Health and Verification Panel */}
      <Panel className="p-6 md:p-8 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-ivory/10 pb-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-gold-300" />
            <div>
              <h3 className="font-serif text-lg font-semibold text-ivory">Dataset Health & Cryptographic Verification</h3>
              <p className="text-xs text-ivory/60">
                Multi-layer validation enforces transfer integrity and fail-safe cryptographic signature guarantees.
              </p>
            </div>
          </div>
          <span className={`self-start sm:self-auto rounded border px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${overallBadgeClass}`}>
            {overallLabel}
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 text-sm">
          {/* MD5 Integrity Check */}
          <div className="space-y-2 rounded border border-ivory/10 bg-ivory/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ivory/60">MD5 Checksum</span>
              <span
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${
                  chkOk ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {status?.checksum_verification_status ?? 'UNAVAILABLE'}
              </span>
            </div>
            <p className="text-xs text-ivory/70 leading-relaxed">
              <strong className="text-ivory">Transfer Integrity Check:</strong> Verified against official APNIC MD5.
              (Note: MD5 guards against transfer corruption, not hostile tamper resistance).
            </p>
          </div>

          {/* PGP Detached Signature */}
          <div className="space-y-2 rounded border border-ivory/10 bg-ivory/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ivory/60">PGP Signature</span>
              <span
                className={`rounded px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${
                  sigOk
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : isPendingKey
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {sigStatus}
              </span>
            </div>
            <p className="text-xs text-ivory/70 leading-relaxed">
              <strong className="text-ivory">Cryptographic Authentication:</strong> Fail-safe verification. PGP signature
              status is never marked verified without an explicitly pinned public-key fingerprint.
            </p>
          </div>

          {/* Key Setup & Pipeline State */}
          <div className="space-y-2 rounded border border-ivory/10 bg-ivory/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ivory/60">Trusted Key</span>
              <span className="font-mono text-xs font-semibold text-ivory">
                {status?.trusted_key_configured ? (
                  <span className="text-emerald-400">CONFIGURED</span>
                ) : (
                  <span className="text-amber-400">PENDING CONFIG</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-ivory/10">
              <span className="font-mono text-xs text-ivory/60">Updater Daemon</span>
              <span className="font-mono text-xs font-semibold text-ivory uppercase">
                {status?.current_update_status ?? 'IDLE'}
              </span>
            </div>
            <p className="text-[11px] text-ivory/50">24-hour autonomous synchronization cycle.</p>
          </div>

          {/* Error & Diagnostics */}
          <div className="space-y-2 rounded border border-ivory/10 bg-ivory/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ivory/60">Last Error</span>
              <span className={`font-mono text-xs font-semibold ${status?.last_error ? 'text-rose-400' : 'text-emerald-400'}`}>
                {status?.last_error ? 'FAULT' : 'NONE'}
              </span>
            </div>
            <p className="text-xs text-ivory/60 truncate" title={status?.last_error ?? 'No active errors recorded'}>
              {status?.last_error ? status.last_error : 'Operational pipeline healthy'}
            </p>
            <div className="pt-1 border-t border-ivory/10 text-[11px] text-ivory/40">
              Last attempt: {status?.last_update_attempt ? new Date(status.last_update_attempt).toLocaleTimeString() : '–'}
            </div>
          </div>
        </div>
      </Panel>

      {/* 3. Resource Distribution Visualizations */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* IPv4 vs IPv6 vs ASN Distribution */}
        <Panel className="p-6 space-y-4">
          <div className="border-b border-ivory/10 pb-3 flex items-center justify-between">
            <div>
              <h4 className="font-serif text-base font-semibold text-ivory">Resource Type Distribution</h4>
              <p className="text-xs text-ivory/50">Proportion of delegated records across categories</p>
            </div>
            <span className="font-mono text-xs text-ivory/60">{total.toLocaleString()} records</span>
          </div>

          {/* Segmented Progress Bar */}
          <div className="h-4 w-full overflow-hidden rounded-full bg-ivory/10 flex">
            <div
              style={{ width: `${v4Pct}%` }}
              className="bg-emerald-500 transition-all duration-500 hover:opacity-90"
              title={`IPv4: ${v4Pct}% (${summary?.ipv4_count.toLocaleString()} records)`}
            />
            <div
              style={{ width: `${v6Pct}%` }}
              className="bg-cyan-500 transition-all duration-500 hover:opacity-90"
              title={`IPv6: ${v6Pct}% (${summary?.ipv6_count.toLocaleString()} records)`}
            />
            <div
              style={{ width: `${asnPct}%` }}
              className="bg-gold-400 transition-all duration-500 hover:opacity-90"
              title={`ASN: ${asnPct}% (${summary?.asn_count.toLocaleString()} records)`}
            />
          </div>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-emerald-500 shrink-0" />
              <div>
                <span className="block font-mono font-bold text-ivory">{summary?.ipv4_count.toLocaleString()}</span>
                <span className="text-[10px] text-ivory/50">IPv4 ({v4Pct}%)</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-cyan-500 shrink-0" />
              <div>
                <span className="block font-mono font-bold text-ivory">{summary?.ipv6_count.toLocaleString()}</span>
                <span className="text-[10px] text-ivory/50">IPv6 ({v6Pct}%)</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-gold-400 shrink-0" />
              <div>
                <span className="block font-mono font-bold text-ivory">{summary?.asn_count.toLocaleString()}</span>
                <span className="text-[10px] text-ivory/50">ASN ({asnPct}%)</span>
              </div>
            </div>
          </div>
        </Panel>

        {/* Allocated vs Assigned Status */}
        <Panel className="p-6 space-y-4">
          <div className="border-b border-ivory/10 pb-3 flex items-center justify-between">
            <div>
              <h4 className="font-serif text-base font-semibold text-ivory">Allocation Status Breakdown</h4>
              <p className="text-xs text-ivory/50">Direct allocation vs delegated assignment</p>
            </div>
            <span className="font-mono text-xs text-ivory/60">
              {(allocatedCount + assignedCount).toLocaleString()} classified
            </span>
          </div>

          {/* Segmented Status Bar */}
          <div className="h-4 w-full overflow-hidden rounded-full bg-ivory/10 flex">
            <div
              style={{ width: `${allocPct}%` }}
              className="bg-indigo-500 transition-all duration-500 hover:opacity-90"
              title={`Allocated: ${allocPct}% (${allocatedCount.toLocaleString()} records)`}
            />
            <div
              style={{ width: `${assignPct}%` }}
              className="bg-amber-500 transition-all duration-500 hover:opacity-90"
              title={`Assigned: ${assignPct}% (${assignedCount.toLocaleString()} records)`}
            />
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-4 pt-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-indigo-500 shrink-0" />
              <div>
                <span className="block font-mono font-bold text-ivory">{allocatedCount.toLocaleString()}</span>
                <span className="text-[10px] text-ivory/50">Allocated ({allocPct}%)</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-amber-500 shrink-0" />
              <div>
                <span className="block font-mono font-bold text-ivory">{assignedCount.toLocaleString()}</span>
                <span className="text-[10px] text-ivory/50">Assigned ({assignPct}%)</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* 4. Country-Wise Resource Allocation Table */}
      <Panel className="p-6 md:p-8 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-ivory/10 pb-4">
          <div>
            <h3 className="font-serif text-lg font-semibold text-ivory">Country-Wise Resource Allocation</h3>
            <p className="text-xs text-ivory/60">
              Allocated and assigned records grouped by two-letter country code across the APNIC region.
            </p>
          </div>

          {/* Country Search */}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ivory/40" />
            <input
              type="text"
              value={countrySearch}
              onChange={(e) => setCountrySearch(e.target.value)}
              placeholder="Filter country code (e.g. AU, JP, IN)..."
              className="w-full rounded border border-ivory/20 bg-forest-900/60 py-1.5 pl-9 pr-3 font-mono text-xs text-ivory placeholder:text-ivory/30 focus:border-gold-300 focus:outline-none"
            />
          </div>
        </div>

        {/* Informative distinction notice */}
        <div className="flex items-start gap-2 rounded border border-ivory/10 bg-ivory/5 p-3 text-xs text-ivory/70">
          <Info className="h-4 w-4 shrink-0 text-gold-300 mt-0.5" />
          <span>
            <strong>Record Count vs IP Address Count:</strong> This table reflects the total number of allocation records
            delegated to each country. It does not equate to individual IP address counts, because IPv4 records span block sizes
            (e.g. +256 to +65536) and IPv6 records represent prefix lengths (e.g. /32 or /48) rather than discrete addresses.
          </span>
        </div>

        {/* Interactive Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ivory/10 text-ivory/50">
                <th
                  scope="col"
                  onClick={() => toggleSort('country_code')}
                  className="cursor-pointer px-4 py-3 font-mono text-[10px] font-normal uppercase tracking-wider hover:text-ivory"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Country Code</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  scope="col"
                  onClick={() => toggleSort('count')}
                  className="cursor-pointer px-4 py-3 font-mono text-[10px] font-normal uppercase tracking-wider hover:text-ivory text-right"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Record Count</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th
                  scope="col"
                  onClick={() => toggleSort('percentage')}
                  className="cursor-pointer px-4 py-3 font-mono text-[10px] font-normal uppercase tracking-wider hover:text-ivory text-right"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>% of APNIC Total</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </div>
                </th>
                <th scope="col" className="px-4 py-3 font-mono text-[10px] font-normal uppercase tracking-wider text-right">
                  Distribution Preview
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedCountries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-ivory/50">
                    No country allocations match &quot;{countrySearch}&quot;
                  </td>
                </tr>
              ) : (
                displayedCountries.map((c) => (
                  <tr
                    key={c.country_code}
                    className="border-b border-ivory/5 transition-colors hover:bg-ivory/[0.02]"
                  >
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-ivory">
                      <span className="rounded border border-ivory/20 bg-ivory/5 px-2 py-0.5 text-xs">
                        {c.country_code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-ivory-100">
                      {c.count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-gold-300">
                      {c.percentage.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-ivory/10">
                          <div
                            style={{ width: `${Math.min(100, c.percentage * 3)}%` }}
                            className="h-full bg-gold-400"
                          />
                        </div>
                        {c.ipv4_count !== undefined && (
                          <span className="font-mono text-[10px] text-ivory/40">
                            v4:{c.ipv4_count} v6:{c.ipv6_count} asn:{c.asn_count}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Show all / Show top 10 Toggle */}
        {filteredAndSortedCountries.length > 10 && (
          <div className="flex items-center justify-between pt-2">
            <span className="font-mono text-xs text-ivory/50">
              Showing {displayedCountries.length} of {filteredAndSortedCountries.length} country allocations
            </span>
            <button
              type="button"
              onClick={() => setShowAllCountries((prev) => !prev)}
              className="font-mono text-xs uppercase tracking-wider text-gold-300 underline underline-offset-4 hover:text-gold-200"
            >
              {showAllCountries ? 'Show Top 10' : `Show All ${filteredAndSortedCountries.length} Countries`}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
