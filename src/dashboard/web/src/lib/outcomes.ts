import type { GatewayStatus, TimeWindow } from '@/types/monitor';

export const OUTCOME_ORDER: GatewayStatus[] = ['SECURE', 'INSECURE', 'BOGUS', 'BLOCKED_CD', 'ERROR'];

/** `stop` = index of the path stage where the lookup ends: 0 device, 1 gateway, 2 resolver, 3 zone. */
export const OUTCOME_META: Record<GatewayStatus, { hex: string; reason: string; stop: number }> = {
  SECURE: { hex: '#3ddc97', stop: 3, reason: 'DNSSEC validated (AD=1). Answer returned.' },
  INSECURE: { hex: '#f5b942', stop: 3, reason: 'Name is unsigned (AD=0). Answer returned but not authenticated.' },
  BOGUS: { hex: '#ff5c6c', stop: 2, reason: 'DNSSEC validation failed (EDE 6). Answer withheld, SERVFAIL sent.' },
  BLOCKED_CD: { hex: '#a78bfa', stop: 1, reason: 'Client set CD=1 to skip validation. Refused by policy.' },
  ERROR: { hex: '#8b9bb0', stop: 2, reason: 'Timeout, malformed query or resolver error. Not a validation verdict.' },
};

export const WINDOW_MS: Record<TimeWindow, number> = { all: 0, '5m': 300_000, '1h': 3_600_000 };

export const fmtMs = (v: number | null | undefined) =>
  v == null ? '–' : v < 10 ? `${v.toFixed(2)} ms` : v < 100 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`;
export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const nameOf = (q: string) => q.replace(/\.$/, '') || q;
export const edeText = (e?: { code: number; text: string }[]) =>
  (e ?? []).map((x) => `${x.code}${x.text ? ' ' + x.text : ''}`).join('; ');
