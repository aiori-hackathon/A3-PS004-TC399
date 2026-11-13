import { memo, useMemo } from 'react';
import { Badge } from '@/components/Badge';
import { edeText, fmtClock, fmtMs, nameOf, OUTCOME_META } from '@/lib/outcomes';
import { percentile } from '@/lib/stats';
import type { DeviceEvent, GatewayMetric, GatewayStatus } from '@/types/monitor';

export const LatestLookup = memo(function LatestLookup({ latest, counts, total }: { latest?: GatewayMetric; counts: Record<GatewayStatus, number>; total: number }) {
  const stages = [['Device', 'sent', total], ['Gateway', 'blocked CD=1', counts.BLOCKED_CD], ['Resolver', 'failed', counts.BOGUS + counts.ERROR], ['Zone', 'answered', counts.SECURE + counts.INSECURE]] as const;
  const meta = latest ? OUTCOME_META[latest.status] : null;
  return (
    <section className="panel" aria-label="Latest lookup">
      <h2 className="h2">Latest lookup <span>{latest ? fmtClock(latest.ts) : ''}</span></h2>
      {latest && meta ? (
        <div key={latest.id} className="animate-[slidein_.25s_ease-out]">
          <Badge status={latest.status} />
          <p className="mt-2 break-all font-mono text-xl font-semibold">{nameOf(latest.query)}</p>
          <p className="text-mute">{meta.reason}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {([['Type', latest.type], ['Latency', fmtMs(latest.latency_ms)], ['Gateway CPU', `${latest.cpu_percent.toFixed(1)}%`], ['Client identity', latest.client || 'not reported'], ...(latest.ede_info?.length ? [['Resolver EDE', edeText(latest.ede_info)]] : [])] as string[][]).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-faint">{k}</dt><dd className="break-all text-right font-mono">{v}</dd></div>
            ))}
          </dl>
        </div>
      ) : <p className="py-6 text-center text-faint">No lookups yet. Run the ESP32 or <code className="font-mono">py src/scripts/test_gateway.py</code>.</p>}
      <div className="mt-4 flex items-stretch">
        {stages.map(([name, cap, n], i) => (
          <div key={name} className="flex flex-1 items-stretch">
            {i > 0 && <span className="self-center px-1 text-faint" aria-hidden>›</span>}
            <div className="min-w-0 flex-1 rounded-[5px] border p-2 text-center transition-all duration-300"
                 style={latest && meta?.stop === i ? { borderColor: meta.hex, boxShadow: `0 0 10px ${meta.hex}70` } : { borderColor: '#1d2835' }}>
              <span className="block text-xs font-semibold">{name}</span>
              <b className="block font-mono text-lg">{n.toLocaleString()}</b>
              <small className="text-[11px] text-faint">{cap}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});

export const SecurityEvents = memo(function SecurityEvents({ metrics, device }: { metrics: GatewayMetric[]; device: DeviceEvent[] }) {
  const items = useMemo(() => {
    const it: { id: string; ts: number; tag: string; hex: string; text: string }[] = [];
    for (const m of metrics) {
      if (m.status === 'SECURE' || m.status === 'INSECURE') continue;
      it.push({ id: m.id, ts: m.ts, tag: m.status, hex: OUTCOME_META[m.status].hex, text: `${nameOf(m.query)} ${m.type}${m.client ? ' from ' + m.client : ''}${m.ede_info?.length ? ' · EDE ' + edeText(m.ede_info) : ''}` });
      if (it.length >= 30) break;
    }
    for (const d of device) {
      if (d.kind === 'tls_failure') it.push({ id: d.id, ts: d.ts, tag: 'TLS_FAIL', hex: '#ff5c6c', text: d.error ?? '' });
      else if (d.kind === 'dns_result' && d.id_match === false) it.push({ id: d.id, ts: d.ts, tag: 'ID_MISMATCH', hex: '#ff5c6c', text: d.query ?? '' });
    }
    return it.sort((a, b) => b.ts - a.ts).slice(0, 14);
  }, [metrics, device]);
  return (
    <section className="panel"><h2 className="h2">Security events <span>blocked, failed, errors</span></h2>
      {items.length ? (
        <ul className="max-h-[230px] overflow-auto">
          {items.map((i) => (
            <li key={i.id} className="grid grid-cols-[62px_92px_1fr] items-center gap-2 border-b border-line py-1.5 last:border-0">
              <span className="font-mono text-xs text-faint">{fmtClock(i.ts)}</span>
              <Badge label={i.tag} status={i.tag in OUTCOME_META ? (i.tag as GatewayStatus) : undefined} />
              <span className="break-all text-xs">{i.text}</span>
            </li>
          ))}
        </ul>
      ) : <p className="py-6 text-center text-faint">No blocked, failed or error events.</p>}
    </section>
  );
});

export const DevicePanel = memo(function DevicePanel({ device }: { device: DeviceEvent[] }) {
  const hs = device.filter((d) => d.kind === 'tls_handshake');
  const fails = device.filter((d) => d.kind === 'tls_failure').length;
  const bridge = device.find((d) => d.kind === 'serial_status');
  const heap = device.find((d) => Number.isFinite(d.free_heap));
  const mean = hs.length ? hs.reduce((a, d) => a + (d.latency_ms ?? 0), 0) / hs.length : 0;
  const rows: [string, React.ReactNode][] = [
    ['TLS handshake (last / mean)', hs.length ? `${Math.round(hs[0].latency_ms ?? 0)} / ${Math.round(mean)} ms` : '–'],
    ['TLS connection failures', fails ? <b className="text-[#ff5c6c]">{fails}</b> : '0'],
    ['Free heap', heap ? `${heap.free_heap!.toLocaleString()} B` : '–'],
    ['Serial bridge', bridge ? (bridge.connected ? `connected ${bridge.port}` : 'disconnected') : '–'],
  ];
  return (
    <section className="panel"><h2 className="h2">ESP32 device <span>{device.length ? `${device.length} events` : 'start serial_to_dashboard.py'}</span></h2>
      <dl className="mb-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-faint">{k}</dt><dd className="text-right font-mono">{v}</dd></div>)}
      </dl>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[11px] text-faint">{['Name', 'RCODE', 'AD', 'ID', 'RTT'].map((h, i) => <th key={h} className={`border-b border-line py-1 font-medium ${i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>
          {['valid', 'bogus', 'insecure'].map((k) => {
            const n = `${k}.aegis.test`, r = device.find((d) => d.kind === 'dns_result' && nameOf(d.query ?? '').toLowerCase() === n);
            return r ? (
              <tr key={n} className="border-b border-line"><td className="py-1 font-mono">{n}</td><td>{r.rcode}</td><td style={{ color: r.ad ? '#3ddc97' : '#8b9bb0' }}>{r.ad ? 1 : 0}</td><td style={{ color: r.id_match ? '#3ddc97' : '#ff5c6c' }}>{r.id_match ? 'ok' : 'BAD'}</td><td className="text-right font-mono">{fmtMs(r.latency_ms)}</td></tr>
            ) : <tr key={n} className="border-b border-line"><td className="py-1 font-mono">{n}</td><td colSpan={4} className="text-faint">no result</td></tr>;
          })}
        </tbody>
      </table>
    </section>
  );
});

export const TopTable = memo(function TopTable({ metrics }: { metrics: GatewayMetric[] }) {
  const rows = useMemo(() => {
    const by = (f: (m: GatewayMetric) => string, pre: string) => {
      const map = new Map<string, { n: number; l: number[]; s: GatewayStatus }>();
      for (const m of metrics) { const k = f(m); if (!k) continue; const o = map.get(k) ?? { n: 0, l: [], s: m.status }; o.n++; o.l.push(m.latency_ms); map.set(k, o); }
      return [...map].sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([k, o]) => ({ key: pre + k, ...o }));
    };
    return [...by((m) => nameOf(m.query), ''), ...by((m) => m.client, '◆ ')];
  }, [metrics]);
  return (
    <section className="panel"><h2 className="h2">Top names and clients <span>in window</span></h2>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[11px] text-faint"><th className="border-b border-line py-1 font-medium">Name / client</th><th className="border-b border-line text-right font-medium">Count</th><th className="border-b border-line text-right font-medium">Median</th><th className="border-b border-line text-right font-medium">Last</th></tr></thead>
        <tbody>{rows.length ? rows.map((r) => (
          <tr key={r.key} className="border-b border-line"><td className="break-all py-1 font-mono">{r.key}</td><td className="text-right">{r.n}</td><td className="text-right font-mono">{fmtMs(percentile(r.l, 50))}</td><td className="text-right"><Badge status={r.s} /></td></tr>
        )) : <tr><td colSpan={4} className="py-6 text-center text-faint">No data</td></tr>}</tbody>
      </table>
    </section>
  );
});
