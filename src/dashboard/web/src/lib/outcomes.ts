import type { GatewayMetric, GatewayStatus } from '@/types/monitor';

export const OUTCOME_ORDER: GatewayStatus[] = [
  'SECURE',
  'INSECURE',
  'BOGUS',
  'BLOCKED_CD',
  'ERROR',
];

interface OutcomeMeta {
  label: string;
  description: string;
  hex: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  dotClass: string;
  fillClass: string;
}

export const OUTCOME_META: Record<GatewayStatus, OutcomeMeta> = {
  SECURE: {
    label: 'Secure',
    description: 'The gateway received a NOERROR or NXDOMAIN response with the resolver AD bit set.',
    hex: '#7FC79C',
    textClass: 'text-verdict-secure',
    bgClass: 'bg-verdict-secure/10',
    borderClass: 'border-verdict-secure/40',
    dotClass: 'bg-verdict-secure',
    fillClass: 'bg-verdict-secure',
  },
  INSECURE: {
    label: 'Insecure',
    description: 'The gateway received NOERROR or NXDOMAIN without AD=1. This does not by itself mean the domain is malicious.',
    hex: '#D9B66A',
    textClass: 'text-verdict-insecure',
    bgClass: 'bg-verdict-insecure/10',
    borderClass: 'border-verdict-insecure/40',
    dotClass: 'bg-verdict-insecure',
    fillClass: 'bg-verdict-insecure',
  },
  BOGUS: {
    label: 'Bogus (lab)',
    description: 'The current lab gateway maps every resolver SERVFAIL to BOGUS for the deliberately corrupted-signature test. This is a lab-specific mapping, not a universal interpretation of SERVFAIL.',
    hex: '#E0786A',
    textClass: 'text-verdict-bogus',
    bgClass: 'bg-verdict-bogus/10',
    borderClass: 'border-verdict-bogus/40',
    dotClass: 'bg-verdict-bogus',
    fillClass: 'bg-verdict-bogus',
  },
  BLOCKED_CD: {
    label: 'Blocked (CD=1)',
    description: 'The gateway rejected a client request with the DNS Checking Disabled (CD) flag set, before forwarding it to Unbound. This is not a domain blocklist verdict.',
    hex: '#A3ADA7',
    textClass: 'text-verdict-blocked',
    bgClass: 'bg-verdict-blocked/10',
    borderClass: 'border-verdict-blocked/40',
    dotClass: 'bg-verdict-blocked',
    fillClass: 'bg-verdict-blocked',
  },
  ERROR: {
    label: 'Error',
    description: 'The gateway could not complete the request because of a parsing, protocol, resolver, or transport error. This is not automatically a DNSSEC validation failure.',
    hex: '#87958D',
    textClass: 'text-verdict-error',
    bgClass: 'bg-verdict-error/10',
    borderClass: 'border-verdict-error/40',
    dotClass: 'bg-verdict-error',
    fillClass: 'bg-verdict-error',
  },
};

export function countOutcomes(metrics: GatewayMetric[]): Record<GatewayStatus, number> {
  const counts: Record<GatewayStatus, number> = {
    SECURE: 0,
    INSECURE: 0,
    BOGUS: 0,
    BLOCKED_CD: 0,
    ERROR: 0,
  };
  for (const metric of metrics) counts[metric.status] += 1;
  return counts;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatShortTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(iso: string, now = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function newestMetric(metrics: GatewayMetric[]): GatewayMetric | undefined {
  return [...metrics].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
}

export function distinctClientCount(metrics: GatewayMetric[]): number {
  return new Set(metrics.map((metric) => metric.client.trim()).filter(Boolean)).size;
}
