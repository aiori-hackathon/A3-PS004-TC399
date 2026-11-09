import { useMemo, useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { QueryTable } from '@/components/monitor/QueryTable';
import { OUTCOME_META, OUTCOME_ORDER, countOutcomes } from '@/lib/outcomes';
import type { GatewayMetric, GatewayStatus } from '@/types/monitor';
import { Search } from 'lucide-react';

type OutcomeFilter = 'ALL' | GatewayStatus;
const PREVIEW_COUNT = 10;

interface QueryActivityProps {
  metrics: GatewayMetric[];
}

export function QueryActivity({ metrics }: QueryActivityProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<OutcomeFilter>('ALL');
  const [showAll, setShowAll] = useState(false);
  const counts = useMemo(() => countOutcomes(metrics), [metrics]);

  const matching = useMemo(() => {
    const term = search.trim().toLowerCase();
    return metrics.filter((metric) => {
      if (filter !== 'ALL' && metric.status !== filter) return false;
      if (!term) return true;
      return [metric.query, metric.type, metric.status, metric.client]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [metrics, filter, search]);

  const visible = showAll ? matching : matching.slice(0, PREVIEW_COUNT);

  return (
    <Panel className="p-6 md:p-8">
      <div className="flex flex-col gap-6 border-b border-ivory/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <label className="relative block w-full lg:max-w-md">
          <span className="sr-only">Search gateway DNS metrics</span>
          <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory/40" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setShowAll(false);
            }}
            placeholder="Search domain, client, type or status"
            className="w-full border-b border-ivory/20 bg-transparent py-2.5 pl-8 font-sans text-base text-ivory-100 placeholder:text-ivory/35 transition-colors duration-300 focus:border-gold-300 focus:outline-none"
          />
        </label>

        <div role="group" aria-label="Filter by gateway status" className="flex flex-wrap gap-2">
          <FilterChip active={filter === 'ALL'} label="All" count={metrics.length} onSelect={() => setFilter('ALL')} />
          {OUTCOME_ORDER.map((outcome) => (
            <FilterChip
              key={outcome}
              active={filter === outcome}
              label={OUTCOME_META[outcome].label}
              count={counts[outcome]}
              dotClass={OUTCOME_META[outcome].dotClass}
              onSelect={() => setFilter(outcome)}
            />
          ))}
        </div>
      </div>

      <QueryTable metrics={visible} />

      <div className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs text-ivory/55">Showing {visible.length} of {matching.length} matching gateway records</p>
        {matching.length > PREVIEW_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="self-start font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300 underline decoration-gold-500/50 underline-offset-8 transition-colors duration-300 hover:text-gold-200 sm:self-auto"
          >
            {showAll ? 'Show fewer records' : `Show all ${matching.length} records`}
          </button>
        )}
      </div>
    </Panel>
  );
}

interface FilterChipProps {
  active: boolean;
  label: string;
  count: number;
  dotClass?: string;
  onSelect: () => void;
}

function FilterChip({ active, label, count, dotClass, onSelect }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-300 ${
        active
          ? 'border-gold-300 bg-gold-300/10 text-gold-200'
          : 'border-ivory/15 text-ivory/65 hover:border-ivory/40 hover:text-ivory-100'
      }`}
    >
      {dotClass && <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />}
      {label}
      <span className="text-ivory/45">{count}</span>
    </button>
  );
}
