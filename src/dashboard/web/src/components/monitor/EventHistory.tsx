import { useMemo } from 'react';
import { Panel } from '@/components/ui/Panel';
import { formatClock, formatRelative, OUTCOME_META } from '@/lib/outcomes';
import type { GatewayMetric } from '@/types/monitor';

type TimelineSeverity = 'info' | 'notice' | 'critical';
type TimelineSource = 'gateway';

interface TimelineItem {
  id: string;
  timestamp: string;
  source: TimelineSource;
  severity: TimelineSeverity;
  title: string;
  detail: string;
}

interface EventHistoryProps {
  metrics: GatewayMetric[];
}

const SEVERITY_META: Record<TimelineSeverity, { label: string; textClass: string; dotClass: string }> = {
  info: { label: 'Info', textClass: 'text-emerald-300', dotClass: 'bg-emerald-300' },
  notice: { label: 'Notice', textClass: 'text-gold-300', dotClass: 'bg-gold-300' },
  critical: { label: 'Attention', textClass: 'text-verdict-bogus', dotClass: 'bg-verdict-bogus' },
};

export function EventHistory({ metrics }: EventHistoryProps) {
  const timeline = useMemo(() => {
    const gatewayItems: TimelineItem[] = metrics.map((metric): TimelineItem => {
      const statusMeta = OUTCOME_META[metric.status];
      const severity: TimelineSeverity = metric.status === 'BOGUS' || metric.status === 'ERROR'
        ? 'critical'
        : metric.status === 'INSECURE' || metric.status === 'BLOCKED_CD'
          ? 'notice'
          : 'info';
      return {
        id: `gateway-${metric.id}`,
        timestamp: metric.timestamp,
        source: 'gateway',
        severity,
        title: `${statusMeta.label} · ${metric.query}`,
        detail: `${metric.type} · ${metric.client || 'client not reported'} · ${metric.latency_ms.toFixed(2)} ms gateway latency`,
      };
    });

    return gatewayItems
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 30);
  }, [metrics]);

  return (
    <Panel className="p-6 md:p-8">
      {timeline.length === 0 ? (
        <p className="py-8 text-center font-display text-xl text-ivory/60">No gateway metrics have been received yet.</p>
      ) : (
        <ol className="relative">
          {timeline.map((event, index) => {
            const severity = SEVERITY_META[event.severity];
            const isLast = index === timeline.length - 1;
            return (
              <li key={event.id} className="relative grid grid-cols-[5.5rem_minmax(0,1fr)] gap-5 pb-8 last:pb-0">
                {!isLast && <span className="absolute bottom-0 left-[calc(5.5rem+27px)] top-5 w-px bg-ivory/10" aria-hidden="true" />}
                <div className="pt-0.5 text-right">
                  <p className="font-mono text-xs text-ivory/75">{formatClock(event.timestamp)}</p>
                  <p className="mt-1 font-mono text-[10px] text-ivory/40">{formatRelative(event.timestamp)}</p>
                </div>
                <div className="relative pl-7">
                  <span className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border border-forest-900 ${severity.dotClass}`} aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`font-mono text-[10px] uppercase tracking-[0.16em] ${severity.textClass}`}>{severity.label}</p>
                    <span className="border border-ivory/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ivory/45">{event.source}</span>
                  </div>
                  <p className="mt-1.5 break-words font-display text-xl leading-[1.2] text-ivory-100">{event.title}</p>
                  <p className="mt-2 break-words text-sm leading-[1.5] text-ivory/65">{event.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
