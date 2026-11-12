import { useEffect, useMemo, useState } from 'react';
import { ActivityChart, LatencyChart } from '@/components/Charts';
import { LogTable } from '@/components/LogTable';
import { DevicePanel, LatestLookup, SecurityEvents, TopTable } from '@/components/Panels';
import { MetricsProvider, useMetrics } from '@/context/MetricsContext';
import { OUTCOME_META, OUTCOME_ORDER, WINDOW_MS } from '@/lib/outcomes';
import { percentile } from '@/lib/stats';
import type { GatewayStatus, TimeWindow } from '@/types/monitor';

const WINDOWS: [TimeWindow, string][] = [['5m', '5 min'], ['1h', '1 hour'], ['all', 'All']];

function Kpi({ label, value, sub, hex = '#38bdf8', hot = false }: { label: string; value: string; sub: string; hex?: string; hot?: boolean }) {
  return (
    <div className="rounded-md border border-line border-l-[3px] bg-panel px-3.5 py-2.5 transition-colors duration-300" style={{ borderLeftColor: hex, ...(hot ? { borderColor: hex, background: `${hex}14` } : {}) }}>
      <small className="text-xs text-mute">{label}</small>
      <b className="block font-mono text-[26px] font-semibold leading-tight">{value}</b>
      <em className="text-xs not-italic text-faint">{sub}</em>
    </div>
  );
}

function Dashboard() {
  const { feed, metrics, device, paused, pending, togglePause, clear } = useMetrics();
  const [win, setWin] = useState<TimeWindow>('all');
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState('');
  const [start] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); }, [toast]);

  const windowMs = WINDOW_MS[win];
  // Re-evaluate the window every 5 s (not every second) so lists stay stable between ticks.
  const stepNow = Math.floor(now / 5000) * 5000;
  const view = useMemo(() => (windowMs ? metrics.filter((m) => m.ts >= stepNow - windowMs) : metrics), [metrics, windowMs, stepNow]);
  const counts = useMemo(() => { const c = Object.fromEntries(OUTCOME_ORDER.map((s) => [s, 0])) as Record<GatewayStatus, number>; view.forEach((m) => c[m.status]++); return c; }, [view]);
  const lat = useMemo(() => view.map((m) => m.latency_ms), [view]);
  const n = view.length, threats = counts.BOGUS + counts.BLOCKED_CD;
  const mins = n > 1 ? (view[0].ts - view[n - 1].ts) / 60000 : 0;
  const p50 = n ? percentile(lat, 50) : null, p95 = n ? percentile(lat, 95) : null;
  const short = (v: number | null) => (v == null ? '–' : v < 10 ? v.toFixed(1) : String(Math.round(v)));
  const feedUi = { live: ['#3ddc97', paused ? 'Paused' : 'Live'], connecting: ['#f5b942', 'Connecting'], offline: ['#ff5c6c', 'Feed lost, retrying'] }[feed];
  const devFresh = device[0] && now - device[0].ts < 90_000;
  const s = Math.floor((now - start) / 1000), p = (x: number) => String(x).padStart(2, '0');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3.5 px-4 py-2">
          <div className="mr-auto flex items-center gap-2 text-base font-bold">
            <svg viewBox="0 0 32 32" className="h-[22px] w-[22px] text-accent" fill="none" aria-hidden><path d="M16 3 27 7v8c0 7-4.6 11.4-11 14C9.6 26.4 5 22 5 15V7l11-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="m11 16 3.5 3.5L21.5 12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>AegisDNS
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs text-mute" role="status">
            <i className={`h-2 w-2 rounded-full ${feed === 'live' && !paused ? 'live-dot' : ''}`} style={{ background: feedUi[0] }} />{feedUi[1]}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-2.5 py-0.5 text-xs text-mute">
            <i className="h-2 w-2 rounded-full" style={{ background: device.length ? (devFresh ? '#3ddc97' : '#f5b942') : '#5d6e82' }} />ESP32: {device.length ? (devFresh ? 'reporting' : 'idle') : 'no telemetry'}
          </span>
          <span className="font-mono text-faint">{p((s / 3600) | 0)}:{p(((s / 60) | 0) % 60)}:{p(s % 60)}</span>
          <div className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="Time window">
            {WINDOWS.map(([k, l]) => <button key={k} aria-pressed={win === k} onClick={() => setWin(k)} className={`border-l border-line px-3 py-1 first:border-0 transition-colors ${win === k ? 'bg-accent font-semibold text-[#04121c]' : 'bg-panel text-mute hover:text-ink'}`}>{l}</button>)}
          </div>
          <button className="btn" aria-pressed={paused} onClick={togglePause} style={paused ? { borderColor: '#f5b942', color: '#f5b942' } : undefined}>{paused ? (pending ? `Resume (${pending})` : 'Resume') : 'Pause'}</button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-3 px-4 pb-10 pt-3.5">
        <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Lookups" value={n.toLocaleString()} sub={mins > 0.1 ? `${(n / mins).toFixed(1)} per min` : 'in window'} />
          <Kpi label="Secure rate" value={n ? `${Math.round((counts.SECURE / n) * 100)}%` : '–'} sub={`${counts.SECURE} SECURE · ${counts.INSECURE} INSECURE`} hex={OUTCOME_META.SECURE.hex} />
          <Kpi label="Threats stopped" value={String(threats)} sub={`${counts.BOGUS} BOGUS · ${counts.BLOCKED_CD} CD=1`} hex={threats ? OUTCOME_META.BOGUS.hex : OUTCOME_META.SECURE.hex} hot={threats > 0} />
          <Kpi label="Errors" value={String(counts.ERROR)} sub="resolver / transport" hex={OUTCOME_META.ERROR.hex} />
          <Kpi label="Latency p50 / p95" value={`${short(p50)} / ${short(p95)}`} sub="ms, measured in gateway" />
          <Kpi label="Gateway CPU" value={metrics[0] ? `${metrics[0].cpu_percent.toFixed(1)}%` : '–'} sub="latest sample" />
        </section>

        <div className="grid gap-3 lg:grid-cols-[5fr_7fr]">
          <LatestLookup latest={metrics[0]} counts={counts} total={n} />
          <section className="panel">
            <h2 className="h2">Response time per lookup <span>last 80 · dashed = p95</span></h2>
            <LatencyChart metrics={view} />
            <h2 className="h2 mt-3">Lookups over time by verdict <span className="flex gap-2 font-mono">{OUTCOME_ORDER.map((o) => <b key={o} style={{ color: OUTCOME_META[o].hex }}>{o}</b>)}</span></h2>
            <ActivityChart metrics={view} windowMs={windowMs} now={stepNow} />
          </section>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <SecurityEvents metrics={view} device={device} />
          <DevicePanel device={device} />
          <TopTable metrics={view} />
        </div>

        <LogTable metrics={view} all={metrics} onClear={() => { clear(); setToast('View cleared. Server history is kept.'); }} notify={setToast} />
      </main>
      <div role="status" aria-live="polite" className={`pointer-events-none fixed bottom-4 right-4 max-w-sm rounded-md border border-line bg-panel2 px-3.5 py-2.5 shadow-xl transition-all duration-200 ${toast ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}>{toast}</div>
    </div>
  );
}

export default function App() {
  return <MetricsProvider><Dashboard /></MetricsProvider>;
}
