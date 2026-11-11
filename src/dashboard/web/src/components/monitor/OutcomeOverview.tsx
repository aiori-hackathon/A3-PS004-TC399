import { Panel } from '@/components/ui/Panel';
import { OutcomeBadge } from '@/components/ui/OutcomeBadge';
import { OUTCOME_META, OUTCOME_ORDER, countOutcomes } from '@/lib/outcomes';
import type { GatewayMetric } from '@/types/monitor';

interface OutcomeOverviewProps {
  metrics: GatewayMetric[];
}

export function OutcomeOverview({ metrics }: OutcomeOverviewProps) {
  const counts = countOutcomes(metrics);
  const total = metrics.length;
  const shareOf = (count: number) => total === 0 ? 0 : Math.round((count / total) * 100);

  return (
    <Panel className="p-6 md:p-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ivory/50">
            {total.toLocaleString()} gateway records retained by this dashboard server
          </p>
          <p className="mt-4 font-display text-7xl leading-[1.2] text-ivory-100 md:text-8xl">
            {shareOf(counts.SECURE)}<span className="text-gold-300">%</span>
          </p>
          <p className="mt-2 max-w-md text-base leading-[1.5] text-ivory/70">
            of recorded requests were classified SECURE by the gateway. The remaining statuses are shown separately rather than being treated as one generic failure group.
          </p>
        </div>

        <div>
          <div className="flex h-3 w-full gap-px overflow-hidden bg-ivory/10" role="img" aria-label="Share of each recorded gateway status">
            {OUTCOME_ORDER.map((outcome) => (
              <span
                key={outcome}
                className={`bar-grow h-full ${OUTCOME_META[outcome].fillClass}`}
                style={{ width: `${shareOf(counts[outcome])}%` }}
              />
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ivory/50">
            Each segment represents its share of the retained gateway records
          </p>
        </div>
      </div>

      <dl className="mt-10 grid gap-px bg-ivory/10 sm:grid-cols-2 lg:grid-cols-5">
        {OUTCOME_ORDER.map((outcome) => (
          <div key={outcome} className="flex flex-col gap-4 bg-forest-900 p-5">
            <OutcomeBadge outcome={outcome} />
            <div>
              <dt className="sr-only">{OUTCOME_META[outcome].label} records</dt>
              <dd className="font-display text-4xl text-ivory-100">
                {counts[outcome]}
                <span className="ml-2 font-mono text-xs text-ivory/50">{shareOf(counts[outcome])}%</span>
              </dd>
            </div>
            <p className="text-sm leading-[1.5] text-ivory/60">{OUTCOME_META[outcome].description}</p>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
