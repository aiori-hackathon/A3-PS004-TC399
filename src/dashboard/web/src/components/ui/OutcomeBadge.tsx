import { OUTCOME_META } from '@/lib/outcomes';
import type { GatewayStatus } from '@/types/monitor';

interface OutcomeBadgeProps {
  outcome: GatewayStatus;
  size?: 'sm' | 'md';
}

export function OutcomeBadge({ outcome, size = 'sm' }: OutcomeBadgeProps) {
  const meta = OUTCOME_META[outcome];
  const sizeClass = size === 'md' ? 'px-4 py-1.5 text-xs' : 'px-2.5 py-1 text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-2 border font-mono uppercase tracking-[0.12em] ${meta.borderClass} ${meta.bgClass} ${meta.textClass} ${sizeClass}`}
      title={meta.description}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
