/** Exact status values accepted and returned by the existing AegisDNS API. */
export type GatewayStatus = 'SECURE' | 'INSECURE' | 'BOGUS' | 'ERROR' | 'BLOCKED_CD';

export interface GatewayMetric {
  id: string;
  timestamp: string;
  query: string;
  type: string;
  status: GatewayStatus;
  latency_ms: number;
  cpu_percent: number;
  client: string;
}

export type ApiStatus = 'connecting' | 'online' | 'offline';

export interface MetricsState {
  apiStatus: ApiStatus;
  metrics: GatewayMetric[];
  /** The newly observed metric; set only after initial history sync, for animation. */
  livePulse: GatewayMetric | null;
  lastSuccessfulFetchAt: number | null;
  metricsError: string | null;
}
