export type GatewayStatus = 'SECURE' | 'INSECURE' | 'BOGUS' | 'ERROR' | 'BLOCKED_CD';
export interface EdeInfo { code: number; text: string }

export interface ApnicEnrichment {
  status?: string;
  found?: boolean;
  ip?: string;
  asn?: number | string;
  registry?: string;
  country_code?: string;
  resource_type?: string;
  allocation_start?: string;
  allocation_value?: string;
  allocation_status?: string;
  allocation_date?: string;
  error?: string;
}

export interface GatewayMetric {
  id: string;
  timestamp: string;
  query: string;
  type: string;
  status: GatewayStatus;
  latency_ms: number;
  cpu_percent: number;
  client: string;
  deviceId?: string;
  ede_info?: EdeInfo[];
  apnic?: ApnicEnrichment[];
  /** Parsed timestamp (client side). */
  ts: number;
  /** True when received live after the initial history load (used for the row flash). */
  live?: boolean;
}

export interface DeviceEvent {
  id: string;
  timestamp: string;
  ts: number;
  deviceId?: string;
  schemaVersion?: number;
  receivedAt?: string;
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

export interface DeviceSummary {
  deviceId: string;
  label: string;
  firstSeen: string;
  lastSeen: string;
}

export type FeedStatus = 'connecting' | 'live' | 'offline';
export type StorageHealth = 'ok' | 'degraded' | 'memory' | 'unknown';
export type TimeWindow = 'all' | '5m' | '1h';
export type ApiStatus = 'idle' | 'loading' | 'success' | 'error' | 'online' | 'offline';