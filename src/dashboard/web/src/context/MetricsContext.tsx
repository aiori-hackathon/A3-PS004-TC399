import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  GatewayMetric,
  GatewayStatus,
  MetricsState,
} from '@/types/monitor';

const REFRESH_INTERVAL_MS = 3000;
const MAX_METRICS = 2000;

const INITIAL_STATE: MetricsState = {
  apiStatus: 'connecting',
  metrics: [],
  livePulse: null,
  lastSuccessfulFetchAt: null,
  metricsError: null,
};

const MetricsContext = createContext<MetricsState>(INITIAL_STATE);
const VALID_STATUSES = new Set<GatewayStatus>([
  'SECURE', 'INSECURE', 'BOGUS', 'ERROR', 'BLOCKED_CD',
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isGatewayMetric(value: unknown): value is GatewayMetric {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' &&
    typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp)) &&
    typeof value.query === 'string' &&
    typeof value.type === 'string' &&
    typeof value.status === 'string' && VALID_STATUSES.has(value.status as GatewayStatus) &&
    typeof value.latency_ms === 'number' && Number.isFinite(value.latency_ms) &&
    typeof value.cpu_percent === 'number' && Number.isFinite(value.cpu_percent) &&
    typeof value.client === 'string';
}

function newestFirst<T extends { timestamp: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

export function MetricsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MetricsState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let hasSyncedMetrics = false;
    let previousLatestId: string | null = null;
    let timer: number | undefined;

    const refresh = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;

      try {
        const metricsPayload = await getJson('/api/metrics');
        if (!isRecord(metricsPayload) || !Array.isArray(metricsPayload.metrics)) {
          throw new Error('The metrics API returned an unexpected response shape.');
        }
        const metrics = newestFirst(metricsPayload.metrics.filter(isGatewayMetric)).slice(0, MAX_METRICS);
        const latest = metrics[0] ?? null;
        const livePulse = hasSyncedMetrics && latest && latest.id !== previousLatestId
          ? latest
          : null;
        previousLatestId = latest?.id ?? null;
        hasSyncedMetrics = true;

        if (!cancelled) {
          setState({
            apiStatus: 'online',
            metrics,
            livePulse,
            lastSuccessfulFetchAt: Date.now(),
            metricsError: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not read the AegisDNS metrics API.';
          setState((current) => ({
            ...current,
            apiStatus: 'offline',
            livePulse: null,
            metricsError: message,
          }));
        }
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
    // Poll only the existing gateway metrics read endpoint.
  }, []);

  const value = useMemo(() => state, [state]);
  return <MetricsContext.Provider value={value}>{children}</MetricsContext.Provider>;
}

export function useMetrics(): MetricsState {
  return useContext(MetricsContext);
}
