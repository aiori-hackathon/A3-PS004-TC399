import { useEffect, useState } from 'react';
import { Panel } from '@/components/ui/Panel';

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

interface ApnicSummary {
  total_records: number;
  ipv4_count: number;
  ipv6_count: number;
  asn_count: number;
  by_status: Record<string, number>;
  top_countries: Record<string, number>;
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

export function ApnicMonitor() {
  const [status, setStatus] = useState<ApnicStatus | null>(null);
  const [summary, setSummary] = useState<ApnicSummary | null>(null);
  const [metadata, setMetadata] = useState<ApnicMetadata | null>(null);
  const [loading, setLoading] = useState(true);

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

  const chkOk = status?.checksum_verification_status === 'VERIFIED';
  const sigOk = status?.signature_verification_status === 'VERIFIED';
  const isPendingKey = status?.signature_verification_status === 'PENDING_KEY_CONFIGURATION';

  // Overall status: Only Verified after BOTH checksum and signature verification succeed!
  let overallState = 'Unavailable';
  let badgeColor = 'bg-stone-600 text-stone-100';

  if (chkOk && sigOk) {
    overallState = 'Verified';
    badgeColor = 'bg-emerald-600 text-emerald-100';
  } else if (isPendingKey) {
    overallState = 'Pending Key';
    badgeColor = 'bg-amber-600 text-amber-100';
  } else if (status?.last_error) {
    overallState = 'Failed';
    badgeColor = 'bg-rose-600 text-rose-100';
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {/* Dataset Information */}
      <Panel className="space-y-4 p-6">
        <div className="flex items-center justify-between border-b border-ivory/10 pb-3">
          <h3 className="font-serif text-lg font-semibold text-ivory">Dataset Information</h3>
          <span className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${badgeColor}`}>
            {overallState}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ivory/60">Dataset</dt>
          <dd className="text-right font-medium text-ivory">{metadata?.dataset_name ?? 'delegated-apnic-latest'}</dd>
          <dt className="text-ivory/60">Serial</dt>
          <dd className="text-right font-medium text-ivory">{metadata?.serial_number ?? '–'}</dd>
          <dt className="text-ivory/60">Dates</dt>
          <dd className="text-right font-medium text-ivory">
            {metadata?.start_date && metadata?.end_date ? `${metadata.start_date} to ${metadata.end_date}` : '–'}
          </dd>
          <dt className="text-ivory/60">Total Records</dt>
          <dd className="text-right font-medium text-ivory">
            {metadata ? metadata.record_count.toLocaleString() : '–'}
          </dd>
        </dl>
      </Panel>

      {/* Cryptographic Verification */}
      <Panel className="space-y-4 p-6">
        <div className="border-b border-ivory/10 pb-3">
          <h3 className="font-serif text-lg font-semibold text-ivory">Integrity & Verification</h3>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ivory/60">MD5 Checksum</dt>
          <dd className="text-right">
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                chkOk ? 'bg-emerald-600/30 text-emerald-300' : 'bg-rose-600/30 text-rose-300'
              }`}
            >
              {status?.checksum_verification_status ?? 'UNAVAILABLE'}
            </span>
          </dd>
          <dt className="text-ivory/60">PGP Signature</dt>
          <dd className="text-right">
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold uppercase ${
                sigOk
                  ? 'bg-emerald-600/30 text-emerald-300'
                  : isPendingKey
                  ? 'bg-amber-600/30 text-amber-300'
                  : 'bg-rose-600/30 text-rose-300'
              }`}
            >
              {status?.signature_verification_status ?? 'UNAVAILABLE'}
            </span>
          </dd>
          <dt className="text-ivory/60">Key Setup</dt>
          <dd className="text-right font-medium text-ivory">
            {status?.trusted_key_configured ? (
              <span className="text-emerald-400">Configured</span>
            ) : (
              <span className="text-amber-400">Pending Setup</span>
            )}
          </dd>
          <dt className="text-ivory/60">SHA-256</dt>
          <dd
            className="truncate text-right font-mono text-xs text-ivory/80"
            title={metadata?.sha256_fingerprint ?? ''}
          >
            {metadata?.sha256_fingerprint ? `${metadata.sha256_fingerprint.slice(0, 16)}…` : '–'}
          </dd>
        </dl>
      </Panel>

      {/* Resource Allocations */}
      <Panel className="space-y-4 p-6">
        <div className="border-b border-ivory/10 pb-3">
          <h3 className="font-serif text-lg font-semibold text-ivory">Allocated Resources</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-ivory/10 bg-ivory/5 p-2 text-center">
            <span className="block font-serif text-base font-bold text-ivory">
              {summary ? summary.ipv4_count.toLocaleString() : '–'}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-ivory/50">IPv4</span>
          </div>
          <div className="rounded border border-ivory/10 bg-ivory/5 p-2 text-center">
            <span className="block font-serif text-base font-bold text-ivory">
              {summary ? summary.ipv6_count.toLocaleString() : '–'}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-ivory/50">IPv6</span>
          </div>
          <div className="rounded border border-ivory/10 bg-ivory/5 p-2 text-center">
            <span className="block font-serif text-base font-bold text-ivory">
              {summary ? summary.asn_count.toLocaleString() : '–'}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-ivory/50">ASN</span>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-ivory/60">Top CCs</dt>
          <dd className="truncate text-right font-medium text-ivory">
            {summary && Object.keys(summary.top_countries).length > 0
              ? Object.entries(summary.top_countries)
                  .slice(0, 4)
                  .map(([cc, n]) => `${cc} (${n})`)
                  .join(', ')
              : '–'}
          </dd>
        </dl>
      </Panel>

      {/* Sync & Health */}
      <Panel className="space-y-4 p-6">
        <div className="border-b border-ivory/10 pb-3">
          <h3 className="font-serif text-lg font-semibold text-ivory">Daily Synchronization</h3>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ivory/60">Last Success</dt>
          <dd className="text-right font-medium text-ivory">
            {status?.last_successful_import ? new Date(status.last_successful_import).toLocaleTimeString() : '–'}
          </dd>
          <dt className="text-ivory/60">Last Attempt</dt>
          <dd className="text-right font-medium text-ivory">
            {status?.last_update_attempt ? new Date(status.last_update_attempt).toLocaleTimeString() : '–'}
          </dd>
          <dt className="text-ivory/60">Pipeline</dt>
          <dd className="text-right font-medium text-ivory">{status?.current_update_status ?? 'IDLE'}</dd>
          <dt className="text-ivory/60">Last Error</dt>
          <dd className={`truncate text-right text-xs ${status?.last_error ? 'text-rose-400' : 'text-ivory/60'}`}>
            {status?.last_error ?? 'None'}
          </dd>
        </dl>
      </Panel>
    </div>
  );
}
