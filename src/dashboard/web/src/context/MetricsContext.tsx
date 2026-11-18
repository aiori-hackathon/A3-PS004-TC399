import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { ApiStatus, DeviceEvent, DeviceSummary, FeedStatus, GatewayMetric, GatewayStatus, StorageHealth } from '@/types/monitor';

const MAX = 2000;
const FLUSH_MS = 250; // live events are batched so a burst renders once, not per event
const STATUSES = new Set<GatewayStatus>(['SECURE', 'INSECURE', 'BOGUS', 'ERROR', 'BLOCKED_CD']);
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function normalizeDeviceId(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown';
  const trimmed = raw.trim();
  if (!trimmed) return 'unknown';
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return cleaned || 'unknown';
}

function metricDeviceId(m: GatewayMetric): string {
  return m.deviceId ? normalizeDeviceId(m.deviceId) : normalizeDeviceId(m.client);
}

function eventDeviceId(e: DeviceEvent): string {
  return e.deviceId ? normalizeDeviceId(e.deviceId) : 'unknown';
}

function toMetric(v: unknown): GatewayMetric | null {
  if (!rec(v) || typeof v.id !== 'string' || typeof v.timestamp !== 'string' || typeof v.query !== 'string' ||
      typeof v.type !== 'string' || !STATUSES.has(v.status as GatewayStatus) || typeof v.client !== 'string' ||
      !Number.isFinite(v.latency_ms) || !Number.isFinite(v.cpu_percent)) return null;
  const ts = Date.parse(v.timestamp);
  if (!Number.isFinite(ts)) return null;
  const ede = Array.isArray(v.ede_info)
    ? v.ede_info.filter((e): e is { code: number; text: string } => rec(e) && Number.isInteger(e.code) && typeof e.text === 'string')
    : undefined;
  const deviceId = typeof v.deviceId === 'string' && v.deviceId.trim()
    ? normalizeDeviceId(v.deviceId)
    : normalizeDeviceId(v.client);
  return { ...(v as unknown as GatewayMetric), deviceId, ede_info: ede, ts };
}

function toDevice(v: unknown): DeviceEvent | null {
  if (!rec(v) || typeof v.id !== 'string' || typeof v.kind !== 'string') return null;
  const ts = typeof v.timestamp === 'string' ? Date.parse(v.timestamp) : NaN;
  const deviceId = typeof v.deviceId === 'string' && v.deviceId.trim()
    ? normalizeDeviceId(v.deviceId)
    : 'unknown';
  const free_heap_bytes = typeof v.free_heap_bytes === 'number'
    ? v.free_heap_bytes
    : typeof v.free_heap === 'number'
      ? v.free_heap
      : undefined;
  const free_heap = typeof v.free_heap === 'number'
    ? v.free_heap
    : free_heap_bytes;
  return {
    ...(v as unknown as DeviceEvent),
    deviceId,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    free_heap,
    free_heap_bytes,
  };
}

function toDeviceSummary(v: unknown): DeviceSummary | null {
  if (!rec(v) || typeof v.deviceId !== 'string' || typeof v.lastSeen !== 'string') return null;
  return {
    deviceId: v.deviceId,
    label: typeof v.label === 'string' && v.label ? v.label : v.deviceId,
    firstSeen: typeof v.firstSeen === 'string' ? v.firstSeen : v.lastSeen,
    lastSeen: v.lastSeen,
  };
}

interface Ctx {
  feed: FeedStatus;
  metrics: GatewayMetric[]; // newest first, filtered to active/selected device
  device: DeviceEvent[]; // newest first, filtered to active/selected device
  devices: DeviceSummary[];
  selectedDevice: string; // 'auto' | 'all' | <deviceId>
  activeDevice: string | null;
  lastDeviceSwitch: { deviceId: string; at: number } | null;
  selectDevice: (modeOrId: string) => void;
  paused: boolean;
  pending: number;
  togglePause: () => void;
  clear: () => void;
  apiStatus: ApiStatus;
  livePulse: number;
  metricsError: string | null;
  storageHealth: StorageHealth;
  storagePersistent: boolean;
  storageBuffered: number;
}
const C = createContext<Ctx | null>(null);

export function MetricsProvider({ children }: { children: ReactNode }) {
  const [feed, setFeed] = useState<FeedStatus>('connecting');
  const [metrics, setMetrics] = useState<GatewayMetric[]>([]);
  const [device, setDevice] = useState<DeviceEvent[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('auto');
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const [lastDeviceSwitch, setLastDeviceSwitch] = useState<{ deviceId: string; at: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState(0);

  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle');
  const [livePulse, setLivePulse] = useState<number>(Date.now());
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealth>('unknown');
  const [storagePersistent, setStoragePersistent] = useState(false);
  const [storageBuffered, setStorageBuffered] = useState(0);

  const pausedRef = useRef(false);
  const selectedRef = useRef<string>('auto');
  const activeRef = useRef<string | null>(null);
  const buf = useRef<GatewayMetric[]>([]);
  const devBuf = useRef<DeviceEvent[]>([]);
  const ids = useRef(new Set<string>());
  const devIds = useRef(new Set<string>());
  const synced = useRef(false);

  const resetLocalView = useCallback(() => {
    setMetrics([]);
    setDevice([]);
    buf.current = [];
    devBuf.current = [];
    ids.current = new Set();
    devIds.current = new Set();
    setPending(0);
  }, []);

  const addMetrics = useCallback((batch: GatewayMetric[]) => {
    const fresh = batch.filter((m) => !ids.current.has(m.id));
    if (!fresh.length) return;
    fresh.forEach((m) => ids.current.add(m.id));
    fresh.sort((a, b) => b.ts - a.ts);
    setMetrics((prev) => {
      const next = [...fresh, ...prev].slice(0, MAX);
      if (ids.current.size > MAX * 2) ids.current = new Set(next.map((m) => m.id));
      return next;
    });
  }, []);

  const addDevice = useCallback((batch: DeviceEvent[]) => {
    const fresh = batch.filter((d) => !devIds.current.has(d.id));
    if (!fresh.length) return;
    fresh.forEach((d) => devIds.current.add(d.id));
    setDevice((prev) => [...fresh.sort((a, b) => b.ts - a.ts), ...prev].slice(0, 800));
  }, []);

  const fetchDevicesList = useCallback(async (): Promise<DeviceSummary[]> => {
    try {
      const r = await fetch('/api/devices', { cache: 'no-store' });
      if (!r.ok) return [];
      const d: unknown = await r.json();
      if (rec(d) && Array.isArray(d.devices)) {
        const list = d.devices.map(toDeviceSummary).filter((x): x is DeviceSummary => !!x);
        setDevices(list);
        return list;
      }
    } catch {
      // ignore transient errors; main feed status covers connectivity
    }
    return [];
  }, []);

  const loadForDevice = useCallback(async (targetDevice: string | null, resetFirst = false) => {
    setApiStatus('loading');
    if (resetFirst) {
      resetLocalView();
    }
    try {
      const querySuffix = targetDevice ? `?device=${encodeURIComponent(targetDevice)}` : '';
      const [metricsRes, telRes] = await Promise.all([
        fetch(`/api/metrics${querySuffix}`, { cache: 'no-store' }),
        fetch(`/api/device/telemetry${querySuffix}`, { cache: 'no-store' }),
      ]);
      if (!metricsRes.ok) throw new Error(String(metricsRes.status));
      const md: unknown = await metricsRes.json();
      const loadedMetrics = rec(md) && Array.isArray(md.metrics)
        ? md.metrics.map(toMetric).filter((m): m is GatewayMetric => !!m)
        : [];
      addMetrics(loadedMetrics);

      if (telRes.ok) {
        const td: unknown = await telRes.json();
        const loadedTel = rec(td) && Array.isArray(td.events)
          ? td.events.map(toDevice).filter((x): x is DeviceEvent => !!x)
          : [];
        addDevice(loadedTel);
      }

      synced.current = true;
      setFeed('live');
      setApiStatus('success');
      setMetricsError(null);
    } catch (err) {
      setFeed('offline');
      setApiStatus('error');
      setMetricsError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    }
  }, [addDevice, addMetrics, resetLocalView]);

  const selectDevice = useCallback((modeOrId: string) => {
    selectedRef.current = modeOrId;
    setSelectedDevice(modeOrId);
    if (modeOrId === 'all') {
      activeRef.current = null;
      setActiveDevice(null);
      void loadForDevice(null, true);
    } else if (modeOrId === 'auto') {
      void (async () => {
        const list = await fetchDevicesList();
        const latest = list[0]?.deviceId ?? null;
        activeRef.current = latest;
        setActiveDevice(latest);
        await loadForDevice(latest, true);
      })();
    } else {
      activeRef.current = modeOrId;
      setActiveDevice(modeOrId);
      void loadForDevice(modeOrId, true);
    }
  }, [fetchDevicesList, loadForDevice]);

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (!r.ok) return;
        const h: unknown = await r.json();
        if (!rec(h)) return;
        if (h.storage === 'ok' || h.storage === 'degraded' || h.storage === 'memory') {
          setStorageHealth(h.storage);
        }
        if (typeof h.persistent === 'boolean') {
          setStoragePersistent(h.persistent);
        }
        if (typeof h.bufferedWrites === 'number' && Number.isFinite(h.bufferedWrites)) {
          setStorageBuffered(h.bufferedWrites);
        } else {
          setStorageBuffered(0);
        }
      } catch {
        // Leave last known storage health intact when unreachable; feed alert covers connectivity.
      }
    };

    const syncOnConnect = async () => {
      synced.current = false;
      const list = await fetchDevicesList();
      if (selectedRef.current === 'auto') {
        const latestDev = activeRef.current || list[0]?.deviceId || null;
        activeRef.current = latestDev;
        setActiveDevice(latestDev);
        await loadForDevice(latestDev, true);
      } else if (selectedRef.current === 'all') {
        await loadForDevice(null, true);
      } else {
        await loadForDevice(selectedRef.current, true);
      }
    };

    const switchActiveDeviceAuto = (incomingDevice: string, firstMetric?: GatewayMetric, firstEvent?: DeviceEvent) => {
      const prev = activeRef.current;
      activeRef.current = incomingDevice;
      setActiveDevice(incomingDevice);
      resetLocalView();
      if (firstMetric) buf.current.push(firstMetric);
      if (firstEvent) devBuf.current.push(firstEvent);
      if (prev && prev !== incomingDevice) {
        setLastDeviceSwitch({ deviceId: incomingDevice, at: Date.now() });
      }
      void fetchDevicesList();
      void loadForDevice(incomingDevice, false);
    };

    const socket = io({ reconnectionDelayMax: 4000 });
    socket.on('connect', () => { void syncOnConnect(); void loadHealth(); });
    socket.on('disconnect', () => setFeed('offline'));
    socket.on('connect_error', () => setFeed('offline'));

    socket.on('dns_metric', (m: unknown) => {
      const x = toMetric(m);
      if (!x) return;
      const incomingDevice = metricDeviceId(x);
      setLivePulse(Date.now());

      if (selectedRef.current === 'auto') {
        if (activeRef.current !== incomingDevice) {
          switchActiveDeviceAuto(incomingDevice, { ...x, live: synced.current });
          return;
        }
      } else if (selectedRef.current !== 'all' && selectedRef.current !== incomingDevice) {
        // Refresh device list in background if an unselected device appears, without polluting current view
        void fetchDevicesList();
        return;
      }

      buf.current.push({ ...x, live: synced.current });
      if (buf.current.length > 1000) buf.current.shift();
    });

    socket.on('device_telemetry', (e: unknown) => {
      const x = toDevice(e);
      if (!x) return;
      const incomingDevice = eventDeviceId(x);

      if (selectedRef.current === 'auto') {
        if (incomingDevice !== 'unknown' && activeRef.current !== incomingDevice) {
          switchActiveDeviceAuto(incomingDevice, undefined, x);
          return;
        }
        if (activeRef.current && incomingDevice !== 'unknown' && incomingDevice !== activeRef.current) {
          return;
        }
      } else if (selectedRef.current !== 'all' && incomingDevice !== selectedRef.current) {
        return;
      }

      devBuf.current.push(x);
    });

    socket.on('device_telemetry_history', (d: unknown) => {
      if (!rec(d) || !Array.isArray(d.events)) return;
      const parsed = d.events.map(toDevice).filter((x): x is DeviceEvent => !!x);
      const target = selectedRef.current === 'all' ? null : activeRef.current;
      const filtered = target
        ? parsed.filter((ev) => eventDeviceId(ev) === target)
        : parsed;
      addDevice(filtered);
    });

    const timer = window.setInterval(() => {
      if (pausedRef.current) { setPending(buf.current.length); return; }
      if (buf.current.length) addMetrics(buf.current.splice(0));
      if (devBuf.current.length) addDevice(devBuf.current.splice(0));
    }, FLUSH_MS);
    void loadHealth();
    const healthTimer = window.setInterval(() => { void loadHealth(); }, 15000);
    return () => { window.clearInterval(timer); window.clearInterval(healthTimer); socket.close(); };
  }, [addDevice, addMetrics, fetchDevicesList, loadForDevice, resetLocalView]);

  const togglePause = useCallback(() => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    if (!pausedRef.current) setPending(0);
  }, []);
  const clear = useCallback(() => { setMetrics([]); buf.current = []; setPending(0); }, []);

  const value = useMemo(() => ({
    feed, metrics, device, devices, selectedDevice, activeDevice, lastDeviceSwitch, selectDevice,
    paused, pending, togglePause, clear,
    apiStatus, livePulse, metricsError, storageHealth, storagePersistent, storageBuffered,
  }), [
    feed, metrics, device, devices, selectedDevice, activeDevice, lastDeviceSwitch, selectDevice,
    paused, pending, togglePause, clear,
    apiStatus, livePulse, metricsError, storageHealth, storagePersistent, storageBuffered,
  ]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useMetrics(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useMetrics must be used inside MetricsProvider');
  return v;
}
