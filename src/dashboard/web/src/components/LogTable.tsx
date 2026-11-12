import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { edeText, fmtClock, fmtMs, nameOf, OUTCOME_META, OUTCOME_ORDER } from '@/lib/outcomes';
import type { GatewayMetric, GatewayStatus } from '@/types/monitor';

const PAGE = 100;
type Filter = 'ALL' | GatewayStatus;

const Row = memo(function Row({ m, onOpen }: { m: GatewayMetric; onOpen: (m: GatewayMetric) => void }) {
  const hex = OUTCOME_META[m.status].hex;
  return (
    <tr tabIndex={0} aria-label={`Open ${nameOf(m.query)} lookup details`} onClick={() => onOpen(m)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(m);
          }
        }}
        className={`cursor-pointer border-b border-line hover:bg-panel2 ${m.live ? 'row-flash' : ''}`} style={{ '--flash': `${hex}38` } as React.CSSProperties}>
      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-faint">{fmtClock(m.ts)}</td>
      <td className="px-2.5"><Badge status={m.status} /></td>
      <td className="px-2.5 font-mono">{nameOf(m.query)}</td>
      <td className="px-2.5 text-mute">{m.type}</td>
      <td className="whitespace-nowrap px-2.5 text-right font-mono"><i className="mr-1.5 inline-block h-1 rounded-sm align-middle opacity-80" style={{ width: Math.min(60, m.latency_ms / 4), background: hex }} />{fmtMs(m.latency_ms)}</td>
      <td className="px-2.5 text-right font-mono">{m.cpu_percent.toFixed(1)}%</td>
      <td className="px-2.5 text-mute">{m.client || '–'}</td>
      <td className="break-all px-2.5 font-mono text-mute">{edeText(m.ede_info) || '–'}</td>
    </tr>
  );
});

function download(name: string, mime: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

export function LogTable({ metrics, all, onClear, notify }: { metrics: GatewayMetric[]; all: GatewayMetric[]; onClear: () => void; notify: (s: string) => void }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<GatewayMetric | null>(null);
  const dq = useDeferredValue(q.trim().toLowerCase());
  const counts = useMemo(() => { const c: Record<string, number> = {}; metrics.forEach((m) => { c[m.status] = (c[m.status] ?? 0) + 1; }); return c; }, [metrics]);
  const rows = useMemo(() => metrics.filter((m) => (filter === 'ALL' || m.status === filter) && (!dq || `${m.query} ${m.client} ${m.type} ${m.status}`.toLowerCase().includes(dq))), [metrics, filter, dq]);
  useEffect(() => { setLimit(PAGE); }, [filter, dq]);
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open]);

  const chron = () => [...all].reverse();
  const csv = () => {
    if (!all.length) return notify('Nothing to export.');
    const f = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    download(`aegisdns-${Date.now()}.csv`, 'text/csv;charset=utf-8', ['timestamp,query,type,status,latency_ms,cpu_percent,client,ede', ...chron().map((m) => [m.timestamp, m.query, m.type, m.status, m.latency_ms, m.cpu_percent, m.client, edeText(m.ede_info)].map(f).join(','))].join('\r\n'));
  };
  const jsonl = () => {
    if (!all.length) return notify('Nothing to export.');
    download(`aegisdns-${Date.now()}.jsonl`, 'application/x-ndjson', chron().map(({ ts, live, ...m }) => JSON.stringify(m)).join('\n') + '\n');
  };

  return (
    <section id="queries" className="panel scroll-mt-24" aria-label="Lookup log">
      <h2 className="h2">Lookup log <span>{Math.min(limit, rows.length)} of {rows.length} shown · {all.length} retained · click a row for details</span></h2>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by verdict" className="flex flex-wrap gap-1.5">
          {(['ALL', ...OUTCOME_ORDER] as Filter[]).map((f) => {
            const on = f === filter, hex = f === 'ALL' ? '#38bdf8' : OUTCOME_META[f].hex;
            return <button key={f} aria-pressed={on} onClick={() => setFilter(f)} className="rounded-full border px-2.5 py-0.5 text-mute transition-colors"
              style={on ? { color: hex, borderColor: hex, background: `${hex}1a` } : { borderColor: '#1d2835' }}>{f}<small className="ml-1.5 text-faint">{f === 'ALL' ? metrics.length : counts[f] ?? 0}</small></button>;
          })}
        </div>
        <span className="flex-1" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter name, client, type" aria-label="Filter log" className="w-full min-w-0 rounded-md border border-line bg-bg px-2.5 py-1.5 sm:w-56" />
        <button className="btn" onClick={csv}>CSV</button>
        <button className="btn" onClick={jsonl}>JSONL</button>
        <button className="btn" onClick={onClear} title="Clear dashboard history only; server history is kept">Clear view</button>
      </div>
      <div className="max-h-[440px] overflow-auto rounded-[5px] border border-line">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="sticky top-0 bg-panel2"><tr className="text-left text-[11px] text-mute">{['Time', 'Verdict', 'Name', 'Type', 'Latency', 'CPU', 'Client', 'Resolver EDE'].map((h, i) => <th key={h} className={`px-2.5 py-2 font-medium ${i === 4 || i === 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, limit).map((m) => <Row key={m.id} m={m} onOpen={setOpen} />)}
            {!rows.length && <tr><td colSpan={8} className="py-9 text-center text-faint">{all.length ? 'No lookups match this filter.' : 'Waiting for the first lookup from the gateway.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button className="btn mt-2.5 w-full" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(null)}>
          <aside role="dialog" aria-label="Lookup details" onClick={(e) => e.stopPropagation()} className="drawer absolute right-0 top-0 h-full w-full max-w-md overflow-auto border-l border-line bg-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between"><Badge status={open.status} /><button className="btn" onClick={() => setOpen(null)} aria-label="Close details">Close (Esc)</button></div>
            <p className="mt-3 break-all font-mono text-lg font-semibold">{nameOf(open.query)}</p>
            <p className="text-mute">{OUTCOME_META[open.status].reason}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              {[['Time', new Date(open.ts).toLocaleString()], ['Record type', open.type], ['Gateway latency', fmtMs(open.latency_ms)], ['Gateway CPU', `${open.cpu_percent.toFixed(1)}%`], ['Client identity', open.client || 'not reported'], ['Resolver EDE', edeText(open.ede_info) || 'none'], ['Record id', open.id]].map(([k, v]) => <div key={k} className="contents"><dt className="text-faint">{k}</dt><dd className="break-all text-right font-mono">{v}</dd></div>)}
            </dl>
          </aside>
        </div>
      )}
    </section>
  );
}
