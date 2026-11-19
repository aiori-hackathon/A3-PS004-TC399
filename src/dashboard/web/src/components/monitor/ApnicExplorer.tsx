import React, { useEffect, useState, useCallback } from 'react';
import { Panel } from '@/components/ui/Panel';
import {
  Search,
  Globe,
  Database,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Filter,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Layers,
} from 'lucide-react';

interface LookupResult {
  found: boolean;
  query?: string;
  registry?: string;
  country_code?: string;
  resource_type?: 'ipv4' | 'ipv6' | 'asn' | string;
  start?: string;
  value?: string;
  date?: string;
  status?: string;
  extensions?: string;
  range?: string;
  contained?: boolean;
  dataset_serial?: string | null;
  disclaimer?: string;
  message?: string;
  error?: string;
}

interface ResourceItem {
  id: number;
  registry: string;
  country_code: string;
  resource_type: string;
  start: string;
  value: string;
  date: string;
  status: string;
  extensions: string;
  range: string;
  dataset_serial?: string | null;
}

interface ResourcesResponse {
  total: number;
  page: number;
  limit: number;
  pages: number;
  filters: {
    country: string | null;
    type: string | null;
    status: string | null;
  };
  resources: ResourceItem[];
  error?: string;
}

const SAMPLE_QUERIES = [
  { label: 'APNIC IPv4', value: '103.21.244.0', desc: 'Cloudflare APNIC pool' },
  { label: 'APNIC IPv6', value: '2404:6800::', desc: 'Google APNIC subnet (/32)' },
  { label: 'APNIC ASN', value: 'AS1221', desc: 'Telstra Australia' },
  { label: 'Non-APNIC IP', value: '8.8.8.8', desc: 'Google DNS (ARIN delegated)' },
  { label: 'Non-APNIC ASN', value: 'AS13335', desc: 'Cloudflare (ARIN delegated)' },
];

export function ApnicExplorer() {
  // Direct Lookup state
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  // Directory filter & pagination state
  const [countryFilter, setCountryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(20);

  // Directory data state
  const [directoryData, setDirectoryData] = useState<ResourcesResponse | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState<boolean>(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  // Fetch Directory Resources
  const fetchResources = useCallback(
    async (targetPage = 1, country = countryFilter, type = typeFilter, status = statusFilter) => {
      setDirectoryLoading(true);
      setDirectoryError(null);

      try {
        const params = new URLSearchParams();
        params.set('page', String(targetPage));
        params.set('limit', String(limit));
        if (country.trim()) params.set('country', country.trim().toUpperCase());
        if (type) params.set('type', type);
        if (status) params.set('status', status);

        const res = await fetch(`/api/apnic/resources?${params.toString()}`);
        const data = await res.json();
        if (!res.ok || data.error) {
          setDirectoryError(data.error || 'Failed to fetch APNIC resources');
          setDirectoryData(null);
        } else {
          setDirectoryData(data);
          setPage(data.page || targetPage);
        }
      } catch (err: unknown) {
        setDirectoryError(err instanceof Error ? err.message : 'Network error while querying resources');
        setDirectoryData(null);
      } finally {
        setDirectoryLoading(false);
      }
    },
    [countryFilter, typeFilter, statusFilter, limit],
  );

  useEffect(() => {
    void fetchResources(1);
  }, [fetchResources]);

  // Handle Direct Lookup
  const handleSearch = async (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : lookupQuery).trim();
    if (!q) return;

    if (targetQuery !== undefined) {
      setLookupQuery(targetQuery);
    }

    setLookupLoading(true);
    setLookupResult(null);

    try {
      let endpoint = `/api/apnic/lookup?resource=${encodeURIComponent(q)}`;
      if (q.toUpperCase().startsWith('AS') || /^\d+$/.test(q)) {
        endpoint = `/api/apnic/lookup?asn=${encodeURIComponent(q)}`;
      } else if (q.includes('.') || q.includes(':')) {
        endpoint = `/api/apnic/lookup?ip=${encodeURIComponent(q)}`;
      }

      const res = await fetch(endpoint);
      const data = await res.json();
      setLookupResult(data);
    } catch (err: unknown) {
      setLookupResult({
        found: false,
        error: err instanceof Error ? err.message : 'Failed to connect to APNIC lookup API',
      });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleSearch();
    }
  };

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchResources(1, countryFilter, typeFilter, statusFilter);
  };

  const handleResetFilters = () => {
    setCountryFilter('');
    setTypeFilter('');
    setStatusFilter('');
    void fetchResources(1, '', '', '');
  };

  const formatResourceValue = (type?: string, val?: string) => {
    if (!val) return '–';
    if (type === 'ipv4') {
      const num = Number(val);
      return `${num.toLocaleString()} addresses (~/${32 - Math.log2(num)})`;
    }
    if (type === 'ipv6') {
      return `/${val} prefix length`;
    }
    if (type === 'asn') {
      const count = Number(val);
      return count > 1 ? `${count} contiguous ASNs` : '1 Autonomous System';
    }
    return val;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || '–';
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  };

  return (
    <div className="space-y-8">
      {/* SECTION 1: Targeted IP / ASN Inspector */}
      <Panel className="space-y-6 p-6 md:p-8">
        <div className="border-b border-ivory/10 pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-gold-300" />
              <h3 className="font-serif text-xl font-semibold text-ivory">Targeted Resource Inspector</h3>
            </div>
            <span className="font-mono text-xs uppercase tracking-wider text-ivory/50">
              Indexed Numerical B-Tree Range Scan
            </span>
          </div>
          <p className="mt-2 text-sm text-ivory/70">
            Query specific IPv4 host addresses, IPv6 subnets, or Autonomous System Numbers. Resolves exact
            delegation range containment and country assignments using indexed SQLite queries.
          </p>
        </div>

        {/* Search Input Bar */}
        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory/40" />
              <input
                type="text"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter IPv4 (103.21.244.0), IPv6 (2404:6800::), or ASN (AS1221)..."
                className="w-full rounded border border-ivory/20 bg-forest-900/60 py-2.5 pl-10 pr-4 font-mono text-sm text-ivory placeholder:text-ivory/30 focus:border-gold-300 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSearch()}
              disabled={lookupLoading || !lookupQuery.trim()}
              className="inline-flex items-center justify-center gap-2 rounded bg-gold-400/20 px-6 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-gold-300 transition-colors duration-200 hover:bg-gold-400/30 disabled:opacity-40"
            >
              {lookupLoading ? 'Scanning...' : 'Inspect'}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Quick Sample Queries */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-mono text-xs text-ivory/40">Quick examples:</span>
            {SAMPLE_QUERIES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => void handleSearch(item.value)}
                className="inline-flex items-center gap-1.5 rounded border border-ivory/10 bg-ivory/5 px-2.5 py-1 font-mono text-xs text-ivory/70 transition-colors hover:border-gold-300/40 hover:text-gold-200"
                title={item.desc}
              >
                <span>{item.label}</span>
                <span className="text-[10px] text-ivory/40">({item.value})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Lookup Results Display */}
        {lookupLoading && (
          <div className="flex items-center justify-center rounded border border-ivory/10 bg-ivory/[0.02] py-8">
            <div className="flex items-center gap-3 text-sm text-ivory/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-transparent" />
              <span>Querying local APNIC delegated B-Tree index...</span>
            </div>
          </div>
        )}

        {!lookupLoading && lookupResult && lookupResult.found && (
          <div className="rounded border border-emerald-500/30 bg-emerald-950/20 p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ivory/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <span className="font-mono text-lg font-bold text-ivory">{lookupResult.query}</span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-emerald-300">
                    Contained in Allocation
                  </span>
                </div>
                <p className="font-mono text-xs text-ivory/60">
                  Allocated Range: <span className="text-ivory font-semibold">{lookupResult.range}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded border border-ivory/20 px-2.5 py-1 font-mono text-xs uppercase text-ivory/80">
                  Type: <strong className="text-ivory">{lookupResult.resource_type?.toUpperCase()}</strong>
                </span>
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs uppercase text-emerald-300">
                  Status: <strong className="text-emerald-200">{lookupResult.status?.toUpperCase()}</strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Country Code</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory">
                  {lookupResult.country_code || '–'}
                </span>
                <span className="text-[10px] text-ivory/40">Administrative assignment</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Registry</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory uppercase">
                  {lookupResult.registry || '–'}
                </span>
                <span className="text-[10px] text-ivory/40">Regional Internet Registry</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Allocation Date</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory">
                  {formatDate(lookupResult.date)}
                </span>
                <span className="text-[10px] text-ivory/40">YYYY-MM-DD</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Block Capacity</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory">
                  {formatResourceValue(lookupResult.resource_type, lookupResult.value)}
                </span>
                <span className="text-[10px] text-ivory/40">
                  {lookupResult.resource_type === 'ipv6' ? 'CIDR prefix length' : 'Record value'}
                </span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Dataset Serial</span>
                <span className="mt-1 block font-mono text-sm font-semibold text-gold-300">
                  {lookupResult.dataset_serial || '–'}
                </span>
                <span className="text-[10px] text-ivory/40">APNIC Snapshot ID</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Range Start</span>
                <span className="mt-1 block font-mono text-sm font-semibold text-ivory">
                  {lookupResult.start}
                </span>
                <span className="text-[10px] text-ivory/40">Lower boundary</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 col-span-2">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Extensions</span>
                <span className="mt-1 block font-mono text-sm font-semibold text-ivory">
                  {lookupResult.extensions || 'None (Standard delegation)'}
                </span>
                <span className="text-[10px] text-ivory/40">Extended attributes</span>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
              <HelpCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <strong className="text-amber-300">Administrative Allocation vs Physical Geolocation:</strong>{' '}
                {lookupResult.disclaimer ||
                  'The country code reflects administrative resource delegation by APNIC (delegated-apnic-latest) to the managing entity, which may differ from the actual physical location of downstream servers or CDN edge nodes.'}
              </div>
            </div>
          </div>
        )}

        {!lookupLoading && lookupResult && !lookupResult.found && (
          <div className="rounded border border-ivory/15 bg-ivory/5 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-serif text-base font-semibold text-ivory">
                  {lookupResult.error ? 'Lookup Error' : 'Resource Not in APNIC Delegated Registry'}
                </h4>
                <p className="text-sm text-ivory/70">
                  {lookupResult.error || lookupResult.message || 'No matching resource found.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* SECTION 2: Filterable & Paginated Directory Explorer (/api/apnic/resources) */}
      <Panel className="space-y-6 p-6 md:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-ivory/10 pb-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-gold-300" />
            <div>
              <h3 className="font-serif text-xl font-semibold text-ivory">Resource Delegation Directory</h3>
              <p className="text-xs text-ivory/60">
                Browse and filter the local SQLite allocation registry with server-side pagination.
              </p>
            </div>
          </div>
          {directoryData && (
            <span className="font-mono text-xs text-ivory/60">
              Total Delegations: <strong className="text-gold-300 font-bold">{directoryData.total.toLocaleString()}</strong>
            </span>
          )}
        </div>

        {/* Filter Controls Bar */}
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50 mb-1">
              Resource Type
            </label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full rounded border border-ivory/20 bg-forest-900/60 py-2 px-3 font-mono text-xs text-ivory focus:border-gold-300 focus:outline-none"
            >
              <option value="">All Types (IPv4, IPv6, ASN)</option>
              <option value="ipv4">IPv4 Blocks</option>
              <option value="ipv6">IPv6 Prefixes</option>
              <option value="asn">ASN Delegations</option>
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50 mb-1">
              Allocation Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded border border-ivory/20 bg-forest-900/60 py-2 px-3 font-mono text-xs text-ivory focus:border-gold-300 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="allocated">Allocated</option>
              <option value="assigned">Assigned</option>
            </select>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ivory/50 mb-1">
              Country Code
            </label>
            <input
              type="text"
              maxLength={2}
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value.toUpperCase())}
              placeholder="e.g. AU, IN, JP..."
              className="w-full rounded border border-ivory/20 bg-forest-900/60 py-2 px-3 font-mono text-xs text-ivory placeholder:text-ivory/30 focus:border-gold-300 focus:outline-none"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={directoryLoading}
              className="flex-1 rounded bg-gold-400/20 py-2 px-3 font-mono text-xs font-semibold uppercase tracking-wider text-gold-300 hover:bg-gold-400/30 transition-colors"
            >
              Filter
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              disabled={directoryLoading}
              className="rounded border border-ivory/20 py-2 px-3 font-mono text-xs uppercase tracking-wider text-ivory/60 hover:text-ivory hover:border-ivory/40 transition-colors"
            >
              Reset
            </button>
          </div>
        </form>

        {/* Directory Error State */}
        {directoryError && (
          <div className="rounded border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-300">
            {directoryError}
          </div>
        )}

        {/* Directory Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ivory/10 text-ivory/45">
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider">
                  Resource Range
                </th>
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider">
                  Type
                </th>
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider">
                  Country
                </th>
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider">
                  Registry
                </th>
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider">
                  Allocated Date
                </th>
                <th scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-wider text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {directoryLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-sm text-ivory/50">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-transparent mr-2 align-middle" />
                    Loading delegation records...
                  </td>
                </tr>
              ) : !directoryData || directoryData.resources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-sm text-ivory/50">
                    No APNIC resource allocations match the selected filters.
                  </td>
                </tr>
              ) : (
                directoryData.resources.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-ivory/5 transition-colors hover:bg-ivory/[0.02]"
                  >
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-ivory">
                      {item.range}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          item.resource_type === 'ipv4'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : item.resource_type === 'ipv6'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'bg-gold-400/20 text-gold-300'
                        }`}
                      >
                        {item.resource_type}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-ivory font-semibold">
                      <span className="rounded border border-ivory/15 bg-ivory/5 px-2 py-0.5">
                        {item.country_code}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs uppercase text-ivory/70">
                      {item.registry}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs text-ivory/70 uppercase">
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-ivory/60">
                      {formatDate(item.date)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleSearch(item.start)}
                        className="rounded border border-ivory/20 px-2 py-0.5 font-mono text-[10px] uppercase text-gold-300 hover:border-gold-300 hover:bg-gold-400/10 transition-colors"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Navigation */}
        {directoryData && directoryData.pages > 1 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2 border-t border-ivory/10">
            <span className="font-mono text-xs text-ivory/50">
              Page {directoryData.page} of {directoryData.pages.toLocaleString()} (Showing {directoryData.resources.length} of {directoryData.total.toLocaleString()} records)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchResources(page - 1)}
                disabled={page <= 1 || directoryLoading}
                className="inline-flex items-center gap-1 rounded border border-ivory/20 px-3 py-1 font-mono text-xs text-ivory/70 hover:text-ivory hover:border-ivory/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => void fetchResources(page + 1)}
                disabled={page >= directoryData.pages || directoryLoading}
                className="inline-flex items-center gap-1 rounded border border-ivory/20 px-3 py-1 font-mono text-xs text-ivory/70 hover:text-ivory hover:border-ivory/40 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
