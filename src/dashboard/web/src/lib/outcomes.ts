import type { GatewayStatus, TimeWindow, GatewayMetric } from '@/types/monitor';

export const OUTCOME_ORDER: GatewayStatus[] = ['SECURE', 'INSECURE', 'BOGUS', 'BLOCKED_CD', 'ERROR'];

/** `stop` = index of the path stage where the lookup ends: 0 device, 1 gateway, 2 resolver, 3 zone. */
export const OUTCOME_META: Record<GatewayStatus, { 
  hex: string; 
  reason: string; 
  stop: number; 
  label: string;
  description: string;
  fillClass: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
  dotClass: string;
}> = {
  SECURE: { 
    hex: '#3ddc97', stop: 3, reason: 'DNSSEC validated (AD=1). Answer returned.',
    label: 'Secure', description: 'DNSSEC validation succeeded.',
    fillClass: 'fill-emerald-500', borderClass: 'border-emerald-500',
    bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-500', dotClass: 'bg-emerald-500'
  },
  INSECURE: { 
    hex: '#f5b942', stop: 3, reason: 'Name is unsigned (AD=0). Answer returned but not authenticated.',
    label: 'Insecure', description: 'Data is not authenticated by DNSSEC.',
    fillClass: 'fill-amber-500', borderClass: 'border-amber-500',
    bgClass: 'bg-amber-500/10', textClass: 'text-amber-500', dotClass: 'bg-amber-500'
  },
  BOGUS: { 
    hex: '#ff5c6c', stop: 2, reason: 'DNSSEC validation failed (EDE 6). Answer withheld, SERVFAIL sent.',
    label: 'Bogus', description: 'DNSSEC validation failed.',
    fillClass: 'fill-red-500', borderClass: 'border-red-500',
    bgClass: 'bg-red-500/10', textClass: 'text-red-500', dotClass: 'bg-red-500'
  },
  BLOCKED_CD: { 
    hex: '#a78bfa', stop: 1, reason: 'Client set CD=1 to skip validation. Refused by policy.',
    label: 'Blocked', description: 'Blocked by gateway policy.',
    fillClass: 'fill-purple-500', borderClass: 'border-purple-500',
    bgClass: 'bg-purple-500/10', textClass: 'text-purple-500', dotClass: 'bg-purple-500'
  },
  ERROR: { 
    hex: '#8b9bb0', stop: 2, reason: 'Timeout, malformed query or resolver error. Not a validation verdict.',
    label: 'Error', description: 'Resolver could not provide a reliable result.',
    fillClass: 'fill-gray-500', borderClass: 'border-gray-500',
    bgClass: 'bg-gray-500/10', textClass: 'text-gray-500', dotClass: 'bg-gray-500'
  },
};

export const WINDOW_MS: Record<TimeWindow, number> = { all: 0, '5m': 300_000, '1h': 3_600_000 };

export const fmtMs = (v: number | null | undefined) =>
  v == null ? '–' : v < 10 ? `${v.toFixed(2)} ms` : v < 100 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`;

// FIXED: Accept `string` in addition to `number` because JSON timestamps are strings.
export const fmtClock = (ts: number | string) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// --- Aliases and helpers required by the updated UI components ---
export const formatClock = fmtClock;

export const nameOf = (q: string) => q.replace(/\.$/, '') || q;

export const edeText = (e?: { code: number; text: string }[]) =>
  (e ?? []).map((x) => `${x.code}${x.text ? ' ' + x.text : ''}`).join('; ');

export function formatRelative(ts: number | string | Date): string {
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function formatShortTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// FIXED: Return `undefined` instead of `null` to match UI component expectations.
export function newestMetric<T>(metrics: T[]): T | undefined {
  if (!metrics || metrics.length === 0) return undefined;
  return metrics[metrics.length - 1];
}

export function countOutcomes(metrics: GatewayMetric[]): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!metrics) return counts;
  for (const m of metrics) {
    const verdict = m.status || 'UNKNOWN';
    counts[verdict] = (counts[verdict] || 0) + 1;
  }
  return counts;
}