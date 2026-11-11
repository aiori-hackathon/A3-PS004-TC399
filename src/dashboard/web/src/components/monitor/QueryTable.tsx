import { OutcomeBadge } from '@/components/ui/OutcomeBadge';
import { formatClock } from '@/lib/outcomes';
import type { GatewayMetric } from '@/types/monitor';

interface QueryTableProps {
  metrics: GatewayMetric[];
}

const HEADERS = ['Time', 'DNS name', 'Type', 'Client identity / peer', 'Gateway status', 'Latency'];

export function QueryTable({ metrics }: QueryTableProps) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse text-left">
        <thead>
          <tr className="border-b border-ivory/10">
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-3 pb-3 font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-ivory/45">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.length === 0 && (
            <tr>
              <td colSpan={HEADERS.length} className="px-3 py-12 text-center font-display text-xl text-ivory/60">
                No gateway records match this search and filter.
              </td>
            </tr>
          )}
          {metrics.map((metric) => (
            <tr key={metric.id} className="group border-b border-ivory/5 transition-colors duration-200 hover:bg-ivory/[0.03]">
              <td className="whitespace-nowrap px-3 py-4 align-top font-mono text-xs text-ivory/60">{formatClock(metric.timestamp)}</td>
              <td className="max-w-md px-3 py-4 align-top">
                <p className="break-all font-mono text-sm text-ivory-100">{metric.query}</p>
              </td>
              <td className="px-3 py-4 align-top font-mono text-xs text-ivory/70">{metric.type}</td>
              <td className="max-w-[230px] px-3 py-4 align-top font-mono text-xs text-ivory/70">
                <span className="break-all">{metric.client || 'Not reported'}</span>
              </td>
              <td className="px-3 py-4 align-top"><OutcomeBadge outcome={metric.status} /></td>
              <td className="whitespace-nowrap px-3 py-4 align-top font-mono text-xs text-ivory-100">{metric.latency_ms.toFixed(2)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
