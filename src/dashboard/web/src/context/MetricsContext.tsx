import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { DeviceEvent, FeedStatus, GatewayMetric, GatewayStatus } from '@/types/monitor';

const MAX = 2000;
const FLUSH_MS = 250; // live events are batched so a burst renders once, not per event
const STATUSES = new Set<GatewayStatus>(['SECURE', 'INSECURE', 'BOGUS', 'ERROR', 'BLOCKED_CD']);
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function toMetric(v: unknown): GatewayMetric | null {
  if (!rec(v) || typeof v.id !== 'string' || typeof v.timestamp !== 'string' || typeof v.query !== 'string' ||
      typeof v.type !== 'string' || !STATUSES.has(v.status as GatewayStatus) || typeof v.client !== 'string' ||
      !Number.isFinite(v.latency_ms) || !Number.isFinite(v.cpu_percent)) return null;
  const ts = Date.parse(v.timestamp);
  if (!Number.isFinite(ts)) return null;
  const ede = Array.isArray(v.ede_info)
    ? v.ede_info.filter((e): e is { code: number; text: string } => rec(e) && Number.isInteger(e.code) && typeof e.text === 'string')
    : undefined;
  return { ...(v as unknown as GatewayMetric), ede_info: ede, ts };
}
function toDevice(v: unknown): DeviceEvent | null {
  if (!rec(v) || typeof v.id !== 'string' || typeof v.kind !== 'string') return null;
  const ts = typeof v.timestamp === 'string' ? Date.parse(v.timestamp) : NaN;
  return { ...(v as unknown as DeviceEvent), ts: Number.isFinite(ts) ? ts : Date.now() };
}

interface Ctx {
  feed: FeedStatus;
  metrics: GatewayMetric[]; // newest first
  device: DeviceEvent[]; // newest first
  paused: boolean;
  pending: number;
  togglePause: () => void;
  clear: () => void;
}
const C = createContext<Ctx | null>(null);

export function MetricsProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<FeedStatus>('connecting');
  const [metrics, setMetrics] = useState<GatewayMetric[]>([]);
  const [device, setDevice] = useState<DeviceEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState(0);
  const pausedRef = useRef(false);
  const buf = useRef<GatewayMetric[]>([]);
  const devBuf = useRef<DeviceEvent[]>([]);
  const ids = useRef(new Set<string>());
  const devIds = useRef(new Set<string>());
  const synced = useRef(false);

  useEffect(() => {
    const addMetrics = (batch: GatewayMetric[]) => {
      const fresh = batch.filter((m) => !ids.current.has(m.id));
      if (!fresh.length) return;
      fresh.forEach((m) => ids.current.add(m.id));
      fresh.sort((a, b) => b.ts - a.ts);
      setMetrics((prev) => {
        const next = [...fresh, ...prev].slice(0, MAX);
        if (ids.current.size > MAX * 2) ids.current = new Set(next.map((m) => m.id));
        return next;
      });
    };
    const addDevice = (batch: DeviceEvent[]) => {
      const fresh = batch.filter((d) => !devIds.current.has(d.id));
      if (!fresh.length) return;
      fresh.forEach((d) => devIds.current.add(d.id));
      setDevice((prev) => [...fresh.sort((a, b) => b.ts - a.ts), ...prev].slice(0, 800));
    };

    const loadHistory = async () => {
      try {
        const r = await fetch('/api/metrics', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d: unknown = await r.json();
        if (rec(d) && Array.isArray(d.metrics)) addMetrics(d.metrics.map(toMetric).filter((m): m is GatewayMetric => !!m));
        synced.current = true;
        setFeed('live');
      } catch { setFeed('offline'); }
    };

    const socket = io({ reconnectionDelayMax: 4000 });
    socket.on('connect', () => { synced.current = false; void loadHistory(); });
    socket.on('disconnect', () => setFeed('offline'));
    socket.on('connect_error', () => setFeed('offline'));
    socket.on('dns_metric', (m: unknown) => {
      const x = toMetric(m);
      if (x) buf.current.push({ ...x, live: synced.current });
      if (buf.current.length > 1000) buf.current.shift();
    });
    socket.on('device_telemetry', (e: unknown) => { const x = toDevice(e); if (x) devBuf.current.push(x); });
    socket.on('device_telemetry_history', (d: unknown) => {
      if (rec(d) && Array.isArray(d.events)) addDevice(d.events.map(toDevice).filter((x): x is DeviceEvent => !!x));
    });

    const timer = window.setInterval(() => {
      if (pausedRef.current) { setPending(buf.current.length); return; }
      if (buf.current.length) addMetrics(buf.current.splice(0));
      if (devBuf.current.length) addDevice(devBuf.current.splice(0));
    }, FLUSH_MS);
    // Fallback if the websocket is blocked: the socket's own polling transport still delivers events.
    return () => { window.clearInterval(timer); socket.close(); };
  }, []);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (!pausedRef.current) setPending(0);
  }, []);
  const clear = useCallback(() => { setMetrics([]); buf.current = []; setPending(0); }, []);

  const value = useMemo(() => ({ feed, metrics, device, paused, pending, togglePause, clear }),
    [feed, metrics, device, paused, pending, togglePause, clear]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useMetrics(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useMetrics must be used inside MetricsProvider');
  return v;
}
