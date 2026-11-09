import { Panel } from '@/components/ui/Panel';
import { OutcomeBadge } from '@/components/ui/OutcomeBadge';
import { OUTCOME_META, formatClock, formatRelative } from '@/lib/outcomes';
import type { GatewayMetric } from '@/types/monitor';

interface LatestVerdictProps {
  metric?: GatewayMetric;
}

export function LatestVerdict({ metric }: LatestVerdictProps) {
  if (!metric) {
    return (
      <Panel className="flex min-h-[340px] flex-col justify-center p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ivory/50">No gateway metrics yet</p>
        <p className="mt-4 font-display text-2xl text-ivory-100">Waiting for the first DNS request.</p>
        <p className="mt-3 text-sm leading-[1.5] text-ivory/55">The panel will populate when the existing Python gateway posts a record to /api/metrics.</p>
      </Panel>
    );
  }

  const meta = OUTCOME_META[metric.status];
  return (
    <Panel className="relative flex h-full min-h-[340px] flex-col p-6 md:p-8">
      <span className={`absolute inset-x-0 top-0 h-px ${meta.fillClass}`} aria-hidden="true" />
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ivory/50">Latest gateway verdict</p>
        <p className="font-mono text-[11px] text-ivory/50">{formatRelative(metric.timestamp)}</p>
      </div>

      <div className="mt-8">
        <OutcomeBadge outcome={metric.status} size="md" />
      </div>

      <p className="mt-6 break-all font-display text-2xl leading-[1.2] text-ivory-100">{metric.query}</p>
      <p className="mt-2 font-mono text-xs text-ivory/55">{metric.type} record · client {metric.client || 'not reported'}</p>

      <blockquote className={`mt-8 border-l-2 pl-5 ${meta.borderClass}`}>
        <p className="text-sm leading-[1.5] text-ivory/80">{meta.description}</p>
        <p className="mt-3 text-xs leading-[1.5] text-ivory/45">
          The current metrics endpoint supplies the gateway classification, latency and process CPU. Raw DNS RCODE, AD-bit and device-side timing are not included in this view.
        </p>
      </blockquote>

      <dl className="mt-auto grid grid-cols-2 gap-px bg-ivory/10 pt-8">
        <div className="bg-forest-900 py-4 pr-4">
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ivory/45">Gateway latency</dt>
          <dd className="mt-1 font-display text-3xl text-ivory-100">{metric.latency_ms.toFixed(2)}<span className="ml-1 font-mono text-xs text-ivory/50">ms</span></dd>
        </div>
        <div className="bg-forest-900 py-4 pl-4">
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ivory/45">Gateway process CPU</dt>
          <dd className="mt-1 font-display text-3xl text-ivory-100">{metric.cpu_percent.toFixed(1)}<span className="ml-1 font-mono text-xs text-ivory/50">%</span></dd>
        </div>
        <div className="col-span-2 flex items-center justify-between gap-4 bg-forest-900 py-3 text-xs">
          <span className="font-mono uppercase tracking-[0.12em] text-ivory/45">Received</span>
          <span className="font-mono text-ivory/75">{formatClock(metric.timestamp)}</span>
        </div>
      </dl>
    </Panel>
  );
}
