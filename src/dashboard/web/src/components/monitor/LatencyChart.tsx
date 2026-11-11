import { useMemo, useState, type PointerEvent } from 'react';
import { Panel } from '@/components/ui/Panel';
import { useElementWidth } from '@/hooks/useElementWidth';
import { formatShortTime } from '@/lib/outcomes';
import { median, percentile } from '@/lib/stats';
import type { GatewayMetric } from '@/types/monitor';

const CHART_HEIGHT = 320;
const PAD = { top: 24, right: 24, bottom: 44, left: 56 };
const MAX_POINTS = 100;

interface LatencyChartProps {
  metrics: GatewayMetric[];
}

export function LatencyChart({ metrics }: LatencyChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const samples = useMemo(() => [...metrics]
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-MAX_POINTS), [metrics]);

  const values = samples.map((sample) => sample.latency_ms);
  const peak = values.length ? Math.max(...values) : 0;
  const yMax = Math.max(10, Math.ceil((peak * 1.15) / 10) * 10);
  const innerWidth = Math.max(0, width - PAD.left - PAD.right);
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const baseline = PAD.top + innerHeight;
  const xAt = (index: number) => PAD.left + (samples.length > 1 ? (index / (samples.length - 1)) * innerWidth : innerWidth / 2);
  const yAt = (value: number) => PAD.top + innerHeight - (value / yMax) * innerHeight;
  const linePath = samples
    .map((sample, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(sample.latency_ms).toFixed(1)}`)
    .join(' ');
  const areaPath = samples.length
    ? `${linePath} L${xAt(samples.length - 1).toFixed(1)} ${baseline} L${xAt(0).toFixed(1)} ${baseline} Z`
    : '';
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(yMax * fraction));
  const tickIndexes = [...new Set([0, Math.floor((samples.length - 1) / 3), Math.floor(((samples.length - 1) * 2) / 3), samples.length - 1])];

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!samples.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - PAD.left;
    const ratio = innerWidth > 0 ? Math.min(1, Math.max(0, offsetX / innerWidth)) : 0;
    setHoverIndex(Math.round(ratio * (samples.length - 1)));
  };

  const activeSample = hoverIndex !== null ? samples[hoverIndex] : undefined;
  const activeX = hoverIndex !== null ? xAt(hoverIndex) : 0;

  return (
    <Panel className="p-6 md:p-10">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ivory/50">
            Latest {samples.length} gateway observations
          </p>
          <p className="mt-3 max-w-xl text-base leading-[1.5] text-ivory/70">
            Each plotted point is one latency_ms value recorded by the Python gateway. No minute averages or configurable guard thresholds are inferred.
          </p>
        </div>
        <dl className="flex flex-wrap gap-6 md:gap-8">
          <Stat label="Median" value={median(values)} />
          <Stat label="95th percentile" value={percentile(values, 95)} />
          <Stat label="Peak" value={peak} />
        </dl>
      </div>

      <div ref={ref} className="relative mt-8 w-full touch-pan-y">
        {width > 0 && samples.length > 0 ? (
          <svg
            width={width}
            height={CHART_HEIGHT}
            role="img"
            aria-label="Line chart showing actual gateway latency observations"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
            className="block select-none"
          >
            <defs>
              <linearGradient id="latency-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#84B89B" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#84B89B" stopOpacity="0" />
              </linearGradient>
            </defs>
            {gridValues.map((value, index) => (
              <g key={`${value}-${index}`}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yAt(value)} y2={yAt(value)} className="stroke-ivory/10" />
                <text x={PAD.left - 12} y={yAt(value) + 4} textAnchor="end" fill="#D9CFB4" className="font-mono text-[11px]">{value}</text>
              </g>
            ))}
            {tickIndexes.map((index) => samples[index] && (
              <text
                key={samples[index].id}
                x={xAt(index)}
                y={CHART_HEIGHT - 14}
                textAnchor={index === 0 ? 'start' : index === samples.length - 1 ? 'end' : 'middle'}
                fill="#D9CFB4"
                className="font-mono text-[11px]"
              >
                {formatShortTime(samples[index].timestamp)}
              </text>
            ))}
            <path d={areaPath} fill="url(#latency-fill)" />
            <path d={linePath} fill="none" className="stroke-emerald-300" strokeWidth="2" strokeLinejoin="round" />
            {activeSample && (
              <g>
                <line x1={activeX} x2={activeX} y1={PAD.top} y2={baseline} className="stroke-ivory/40" />
                <circle cx={activeX} cy={yAt(activeSample.latency_ms)} r={5} className="fill-forest-950 stroke-gold-300" strokeWidth="2" />
              </g>
            )}
          </svg>
        ) : (
          <div className="flex h-[320px] items-center justify-center border border-dashed border-ivory/15 text-center font-mono text-xs uppercase tracking-[0.14em] text-ivory/45">
            No gateway latency records yet
          </div>
        )}
      </div>

      <p className="mt-4 min-h-5 font-mono text-xs text-ivory/60" aria-live="polite">
        {activeSample
          ? `${formatShortTime(activeSample.timestamp)} · ${activeSample.latency_ms.toFixed(2)} ms · ${activeSample.query}`
          : samples.length ? 'Move across the chart to inspect an individual gateway observation' : 'The chart will populate when the gateway posts DNS metrics.'}
      </p>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ivory/45">{label}</dt>
      <dd className="mt-1 font-display text-3xl text-ivory-100">
        {value.toFixed(2)}<span className="ml-1 font-mono text-xs text-ivory/50">ms</span>
      </dd>
    </div>
  );
}
