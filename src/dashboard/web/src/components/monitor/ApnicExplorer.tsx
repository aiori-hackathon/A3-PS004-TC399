import React, { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Search, Globe, Database, CheckCircle2, AlertCircle, HelpCircle, ArrowRight, ShieldCheck } from 'lucide-react';

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
  disclaimer?: string;
  message?: string;
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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);

  const handleSearch = async (targetQuery?: string) => {
    const q = (targetQuery !== undefined ? targetQuery : query).trim();
    if (!q) return;

    if (targetQuery !== undefined) {
      setQuery(targetQuery);
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/apnic/lookup?resource=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResult(data);
    } catch (err: unknown) {
      setResult({
        found: false,
        error: err instanceof Error ? err.message : 'Failed to connect to APNIC lookup API',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleSearch();
    }
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
    <Panel className="space-y-6 p-6 md:p-8">
      {/* Header & Description */}
      <div className="border-b border-ivory/10 pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-gold-300" />
            <h3 className="font-serif text-xl font-semibold text-ivory">APNIC Resource Explorer</h3>
          </div>
          <span className="font-mono text-xs uppercase tracking-wider text-ivory/50">
            Read-Only Local B-Tree Lookup
          </span>
        </div>
        <p className="mt-2 text-sm text-ivory/70">
          Query APNIC-delegated resource allocations (IPv4, IPv6, and Autonomous System Numbers). Range queries
          utilize indexed numerical boundaries without blocking DNS query resolution.
        </p>
      </div>

      {/* Search Input Bar */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter IPv4 (103.21.244.0), IPv6 (2404:6800::), or ASN (AS1221)..."
              className="w-full rounded border border-ivory/20 bg-forest-900/60 py-2.5 pl-10 pr-4 font-mono text-sm text-ivory placeholder:text-ivory/30 focus:border-gold-300 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={loading || !query.trim()}
            className="inline-flex items-center justify-center gap-2 rounded bg-gold-400/20 px-6 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-gold-300 transition-colors duration-200 hover:bg-gold-400/30 disabled:opacity-40"
          >
            {loading ? 'Searching...' : 'Explore'}
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

      {/* Results Area */}
      <div className="mt-4">
        {loading && (
          <div className="flex items-center justify-center rounded border border-ivory/10 bg-ivory/[0.02] py-12">
            <div className="flex items-center gap-3 text-sm text-ivory/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-transparent" />
              <span>Querying local APNIC delegated database...</span>
            </div>
          </div>
        )}

        {!loading && result && result.found && (
          <div className="rounded border border-emerald-500/30 bg-emerald-950/20 p-6 space-y-6">
            {/* Top Match Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ivory/10 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <span className="font-mono text-lg font-bold text-ivory">{result.query}</span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-emerald-300">
                    Contained in Allocation
                  </span>
                </div>
                <p className="font-mono text-xs text-ivory/60">
                  Allocated Range: <span className="text-ivory font-semibold">{result.range}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded border border-ivory/20 px-2.5 py-1 font-mono text-xs uppercase text-ivory/80">
                  Type: <strong className="text-ivory">{result.resource_type?.toUpperCase()}</strong>
                </span>
                <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs uppercase text-emerald-300">
                  Status: <strong className="text-emerald-200">{result.status?.toUpperCase()}</strong>
                </span>
              </div>
            </div>

            {/* Field Grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Country Code</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory">
                  {result.country_code || '–'}
                </span>
                <span className="text-[10px] text-ivory/40">Administrative assignment</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Registry</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory uppercase">
                  {result.registry || '–'}
                </span>
                <span className="text-[10px] text-ivory/40">Regional Internet Registry</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Allocation Date</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory">
                  {formatDate(result.date)}
                </span>
                <span className="text-[10px] text-ivory/40">YYYY-MM-DD</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Block Capacity</span>
                <span className="mt-1 block font-mono text-base font-semibold text-ivory">
                  {formatResourceValue(result.resource_type, result.value)}
                </span>
                <span className="text-[10px] text-ivory/40">
                  {result.resource_type === 'ipv6' ? 'CIDR prefix length' : 'Record value'}
                </span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 col-span-2 sm:col-span-1">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Range Start</span>
                <span className="mt-1 block font-mono text-sm font-semibold text-ivory">
                  {result.start}
                </span>
                <span className="text-[10px] text-ivory/40">Lower boundary</span>
              </div>

              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 col-span-2 sm:col-span-1">
                <span className="block text-[11px] uppercase tracking-wider text-ivory/50">Extensions</span>
                <span className="mt-1 block font-mono text-sm font-semibold text-ivory">
                  {result.extensions || 'None (Standard delegation)'}
                </span>
                <span className="text-[10px] text-ivory/40">Extended attributes</span>
              </div>
            </div>

            {/* Geolocation Disclaimer Notice */}
            <div className="flex items-start gap-2.5 rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/80">
              <HelpCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <strong className="text-amber-300">Administrative Allocation vs Physical Geolocation:</strong>{' '}
                {result.disclaimer ||
                  'The country code reflects administrative resource delegation by APNIC (delegated-apnic-latest) to the managing entity, which may differ from the actual physical location of downstream servers or CDN edge nodes.'}
              </div>
            </div>
          </div>
        )}

        {!loading && result && !result.found && (
          <div className="rounded border border-ivory/15 bg-ivory/5 p-6 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-serif text-base font-semibold text-ivory">
                  {result.error ? 'Lookup Error' : 'Resource Not in APNIC Delegated Registry'}
                </h4>
                <p className="text-sm text-ivory/70">
                  {result.error || result.message || 'No matching resource found.'}
                </p>
                {result.query && !result.error && (
                  <div className="mt-3 text-xs text-ivory/50 space-y-1">
                    <p>• APNIC exclusively manages IP addresses and ASNs for the Asia-Pacific region.</p>
                    <p>• Resources for the Americas (ARIN), Europe/Middle East (RIPE NCC), Latin America (LACNIC), or Africa (AFRINIC) will not be found in this dataset.</p>
                    <p>• IANA private/reserved ranges (e.g. RFC 1918, CGNAT 100.64.0.0/10) are also not listed in public RIR delegations.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && !result && (
          <div className="flex flex-col items-center justify-center rounded border border-dashed border-ivory/15 py-12 text-center">
            <Database className="h-8 w-8 text-ivory/30" />
            <p className="mt-3 font-serif text-base text-ivory/70">Search the Local APNIC Allocation Registry</p>
            <p className="mt-1 max-w-md text-xs text-ivory/40">
              Enter any IPv4 address, IPv6 subnet, or Autonomous System Number to determine whether it is
              allocated by APNIC, its country assignment, and its allocation boundaries.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
