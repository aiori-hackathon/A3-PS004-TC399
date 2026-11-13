export type GatewayStatus = 'SECURE' | 'INSECURE' | 'BOGUS' | 'ERROR' | 'BLOCKED_CD';
export interface EdeInfo { code: number; text: string }

export interface GatewayMetric {
  id: string;
  timestamp: string;
  query: string;
  type: string;
  status: GatewayStatus;
  latency_ms: number;
  cpu_percent: number;
  client: string;
  ede_info?: EdeInfo[];
  /** Parsed timestamp (client side). */
  ts: number;
  /** True when received live after the initial history load (used for the row flash). */
  live?: boolean;
}

export interface DeviceEvent {
  id: string;
  timestamp: string;
  ts: number;
  kind: 'serial_status' | 'tls_handshake' | 'tls_failure' | 'dns_result';
  connected?: boolean;
  port?: string;
  latency_ms?: number;
  free_heap?: number;
  error?: string;
  query?: string;
  rcode?: string;
  ad?: boolean;
  id_match?: boolean;
}

export type FeedStatus = 'connecting' | 'live' | 'offline';
export type TimeWindow = 'all' | '5m' | '1h';
