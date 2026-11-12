import { memo, useMemo, useState, type PointerEvent } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import { fmtClock, fmtMs, OUTCOME_META, OUTCOME_ORDER } from '@/lib/outcomes';
import { percentile } from '@/lib/stats';
import type { GatewayMetric } from '@/types/monitor';

const P = { l: 38, r: 8, t: 8, b: 20 };

export const LatencyChart = memo(function LatencyChart({ metrics }: { metrics: GatewayMetric[] }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => metrics.slice(0, 80).reverse(), [metrics]);
  const H = 190, iw = Math.max(0, width - P.l - P.r), ih = H - P.t - P.b;
  const p95 = pts.length ? percentile(pts.map((m) => m.latency_ms), 95) : 0;
  const max = Math.max(10, Math.ceil((Math.max(0, ...pts.map((m) => m.latency_ms)) * 1.15) / 10) * 10);
  const X = (i: number) => P.l + (pts.length > 1 ? (i / (pts.length - 1)) * iw : iw / 2);
  const Y = (v: number) => P.t + ih - (v / max) * ih;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!pts.length || !iw) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left - P.l;
    setHover(Math.round(Math.min(1, Math.max(0, x / iw)) * (pts.length - 1)));
  };
  const a = hover != null ? pts[hover] : undefined;
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={H} onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Response time per lookup" className="block touch-pan-y">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line x1={P.l} x2={width - P.r} y1={Y((max * i) / 4)} y2={Y((max * i) / 4)} stroke="#1d2835" />
              <text x={P.l - 6} y={Y((max * i) / 4) + 4} textAnchor="end" fill="#5d6e82" fontSize="11">{Math.round((max * i) / 4)}</text>
            </g>
          ))}
          {pts.length > 0 && <>
            <line x1={P.l} x2={width - P.r} y1={Y(p95)} y2={Y(p95)} stroke="#f5b94280" strokeDasharray="4 4" />
            <path d={pts.map((m, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(m.latency_ms).toFixed(1)}`).join(' ')} fill="none" stroke="#4a5b6e" strokeWidth="1.2" />
            {pts.map((m, i) => <circle key={m.id} cx={X(i)} cy={Y(m.latency_ms)} r={i === hover ? 5 : 3} fill={OUTCOME_META[m.status].hex} />)}
            <text x={P.l} y={H - 5} fill="#5d6e82" fontSize="11">{fmtClock(pts[0].ts)}</text>
            <text x={width - P.r} y={H - 5} textAnchor="end" fill="#5d6e82" fontSize="11">{fmtClock(pts[pts.length - 1].ts)}</text>
          </>}
          {a && <line x1={X(hover!)} x2={X(hover!)} y1={P.t} y2={P.t + ih} stroke="#5d6e82" />}
        </svg>
      )}
      {!pts.length && <p className="absolute inset-0 grid place-items-center text-faint">Waiting for lookups</p>}
      {a && (
        <div className="pointer-events-none absolute top-1 z-10 rounded border border-line bg-panel2 px-2 py-1 font-mono text-[11px] shadow-lg"
             style={{ left: Math.min(Math.max(X(hover!) + 10, 0), Math.max(0, width - 190)) }}>
          <div style={{ color: OUTCOME_META[a.status].hex }}>{a.status} · {fmtMs(a.latency_ms)}</div>
          <div className="text-mute">{a.query} · {fmtClock(a.ts)}</div>
        </div>
      )}
    </div>
  );
});

export const ActivityChart = memo(function ActivityChart({ metrics, windowMs, now }: { metrics: GatewayMetric[]; windowMs: number; now: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const N = 30, H = 120, ih = H - 6 - 18;
  const { buckets, t0, max } = useMemo(() => {
    const t0 = windowMs ? now - windowMs : metrics.length ? metrics[metrics.length - 1].ts : now - 60_000;
    const bs = Math.max(1, (now - t0) / N);
    const buckets = Array.from({ length: N }, () => ({} as Record<string, number>));
    metrics.forEach((m) => { const i = Math.min(N - 1, Math.max(0, Math.floor((m.ts - t0) / bs))); buckets[i][m.status] = (buckets[i][m.status] ?? 0) + 1; });
    return { buckets, t0, max: Math.max(1, ...buckets.map((b) => Object.values(b).reduce((x, y) => x + y, 0))) };
  }, [metrics, windowMs, now]);
  const bw = Math.max(0, width - P.l - P.r) / N;
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Lookups over time by verdict" className="block">
          <text x={P.l - 6} y={14} textAnchor="end" fill="#5d6e82" fontSize="11">{max}</text>
          <text x={P.l - 6} y={H - 18} textAnchor="end" fill="#5d6e82" fontSize="11">0</text>
          {buckets.map((b, i) => {
            let y = H - 18;
            return OUTCOME_ORDER.map((s) => {
              const n = b[s]; if (!n) return null;
              const h = (n / max) * ih; y -= h;
              return <rect key={`${i}${s}`} x={P.l + i * bw + 1} y={y} width={Math.max(1, bw - 2)} height={h} fill={OUTCOME_META[s].hex}><title>{`${s}: ${n}`}</title></rect>;
            });
          })}
          <text x={P.l} y={H - 4} fill="#5d6e82" fontSize="11">{fmtClock(t0)}</text>
          <text x={width - P.r} y={H - 4} textAnchor="end" fill="#5d6e82" fontSize="11">now</text>
        </svg>
      )}
    </div>
  );
});
