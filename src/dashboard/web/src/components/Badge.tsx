import { OUTCOME_META } from '@/lib/outcomes';
import type { GatewayStatus } from '@/types/monitor';

export function Badge({ status, label }: { status?: GatewayStatus; label?: string }) {
  const hex = status ? OUTCOME_META[status].hex : '#ff5c6c';
  return (
    <b className="inline-block whitespace-nowrap rounded-[3px] border px-1.5 py-px font-mono text-[11px] font-semibold"
       style={{ color: hex, borderColor: hex, background: `${hex}1f` }}>{label ?? status}</b>
  );
}
