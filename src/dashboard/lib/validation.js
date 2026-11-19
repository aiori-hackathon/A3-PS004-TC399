'use strict';

const { z } = require('zod');
const { normalizeDeviceId } = require('./device');

const VALID_STATUSES = ['SECURE', 'INSECURE', 'BOGUS', 'ERROR', 'BLOCKED_CD'];
const VALID_TELEMETRY_KINDS = ['serial_status', 'tls_handshake', 'tls_failure', 'dns_result'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const finiteNonNegNumber = z
  .number()
  .refine((n) => Number.isFinite(n) && n >= 0, {
    message: 'Must be a finite non-negative number',
  });

const nonNegInt = z
  .number()
  .refine((n) => Number.isInteger(n) && n >= 0, {
    message: 'Must be a non-negative integer',
  });

const positiveInt = z
  .number()
  .refine((n) => Number.isInteger(n) && n > 0, {
    message: 'Must be a positive integer',
  });

const clampedCpuPercent = z
  .number()
  .refine((n) => Number.isFinite(n), {
    message: 'Must be a finite number',
  })
  .transform((n) => Math.max(0, Math.min(100, n)));

// Accept strict boolean OR integer 0/1 and normalise to boolean for storage/UI.
const boolOrZeroOne = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((v) => Boolean(v));

const isoTimestampOptional = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid ISO timestamp',
  })
  .optional();

const edeItemSchema = z.object({
  code: z
    .number()
    .int()
    .min(0)
    .max(65535),
  text: z.string().transform((s) => s.slice(0, 256)),
});

const edeInfoSchema = z.array(edeItemSchema).max(8);

const apnicItemSchema = z.object({
  status: z.string().max(32).optional(),
  found: z.boolean().optional(),
  ip: z.string().max(64).optional(),
  asn: z.union([z.number(), z.string()]).optional(),
  registry: z.string().max(32).optional(),
  country_code: z.string().max(8).optional(),
  resource_type: z.string().max(16).optional(),
  allocation_start: z.string().max(64).optional(),
  allocation_value: z.string().max(64).optional(),
  allocation_status: z.string().max(32).optional(),
  allocation_date: z.string().max(32).optional(),
  error: z.string().max(256).optional(),
}).passthrough();

const apnicInfoSchema = z.array(apnicItemSchema).max(64);

const metricInputSchema = z.object({
  timestamp: isoTimestampOptional,
  query: z
    .string()
    .min(1, 'Query must be a non-empty string')
    .transform((s) => s.slice(0, 253)),
  type: z
    .string()
    .optional()
    .default('UNKNOWN')
    .transform((s) => s.slice(0, 20)),
  status: z.enum(VALID_STATUSES),
  latency_ms: finiteNonNegNumber.optional().default(0),
  cpu_percent: finiteNonNegNumber
    .optional()
    .default(0)
    .transform((n) => Math.max(0, Math.min(100, n))),
  client: z
    .string()
    .optional()
    .default('')
    .transform((s) => s.slice(0, 64)),
  ede_info: edeInfoSchema.optional(),
  apnic: apnicInfoSchema.optional(),
});

const telemetryBaseShape = {
  timestamp: isoTimestampOptional,
  deviceId: z.string().max(128).optional(),
  schemaVersion: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(1),
  cpu_percent: clampedCpuPercent.optional(),
  ram_used_bytes: positiveInt.optional(),
  ram_total_bytes: positiveInt.optional(),
  free_heap_bytes: positiveInt.optional(),
};

const serialStatusSchema = z.object({
  ...telemetryBaseShape,
  kind: z.literal('serial_status'),
  connected: boolOrZeroOne,
  port: z.string().min(1).transform((s) => s.slice(0, 64)),
});

const tlsHandshakeSchema = z.object({
  ...telemetryBaseShape,
  kind: z.literal('tls_handshake'),
  latency_ms: finiteNonNegNumber,
  free_heap: nonNegInt.optional(),
});

const tlsFailureSchema = z.object({
  ...telemetryBaseShape,
  kind: z.literal('tls_failure'),
  error: z.string().transform((s) => s.slice(0, 200)),
});

const dnsResultSchema = z.object({
  ...telemetryBaseShape,
  kind: z.literal('dns_result'),
  query: z.string().min(1).transform((s) => s.slice(0, 253)),
  rcode: z.string().min(1).transform((s) => s.slice(0, 20)),
  ad: boolOrZeroOne,
  id_match: boolOrZeroOne,
  latency_ms: finiteNonNegNumber,
  free_heap: nonNegInt.optional(),
});

const telemetryByKind = {
  serial_status: {
    schema: serialStatusSchema,
    errorText: 'Invalid serial status fields',
  },
  tls_handshake: {
    schema: tlsHandshakeSchema,
    errorText: 'Invalid TLS handshake fields',
  },
  tls_failure: {
    schema: tlsFailureSchema,
    errorText: 'Invalid TLS failure fields',
  },
  dns_result: {
    schema: dnsResultSchema,
    errorText: 'Invalid DNS result fields',
  },
};

const testRunInputSchema = z.object({
  runId: z.string().min(1).max(64),
  deviceId: z.string().max(64).optional().default('unknown'),
  startedAt: isoTimestampOptional,
  scenario: z.string().min(1).max(64),
  domain: z.string().min(1).max(253),
  expectedStatus: z.enum(VALID_STATUSES),
  observedStatus: z.string().min(1).max(32),
  latency_ms: finiteNonNegNumber,
  passed: boolOrZeroOne,
});

function formatZodIssues(zodError) {
  return zodError.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function validateMetricPayload(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: 'Expected a JSON object',
      issues: [{ path: '(root)', message: 'Expected a JSON object' }],
    };
  }

  // Check ede_info specifically first if present so we preserve the exact existing error message
  if (input.ede_info !== undefined) {
    const edeResult = edeInfoSchema.safeParse(input.ede_info);
    if (!edeResult.success) {
      return {
        ok: false,
        error: 'Invalid EDE metric details',
        issues: formatZodIssues(edeResult.error),
      };
    }
  }

  const parsed = metricInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid metric fields',
      issues: formatZodIssues(parsed.error),
    };
  }

  const data = parsed.data;
  const normalized = {
    timestamp: data.timestamp || new Date().toISOString(),
    query: data.query,
    type: data.type,
    status: data.status,
    latency_ms: data.latency_ms,
    cpu_percent: data.cpu_percent,
    client: data.client,
    deviceId: normalizeDeviceId(data.client),
  };
  if (data.ede_info !== undefined) {
    normalized.ede_info = data.ede_info;
  }
  if (data.apnic !== undefined) {
    normalized.apnic = data.apnic;
  }
  return { ok: true, data: normalized };
}

function validateTelemetryPayload(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: 'Expected a JSON object',
      issues: [{ path: '(root)', message: 'Expected a JSON object' }],
    };
  }

  if (typeof input.kind !== 'string' || !VALID_TELEMETRY_KINDS.includes(input.kind)) {
    return {
      ok: false,
      error: 'Invalid device telemetry kind',
      issues: [{ path: 'kind', message: `Expected one of: ${VALID_TELEMETRY_KINDS.join(', ')}` }],
    };
  }

  const entry = telemetryByKind[input.kind];
  const parsed = entry.schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: entry.errorText,
      issues: formatZodIssues(parsed.error),
    };
  }

  const nowIso = new Date().toISOString();
  const data = parsed.data;
  const normalized = {
    ...data,
    timestamp: data.timestamp || nowIso,
    deviceId: normalizeDeviceId(data.deviceId),
    schemaVersion: data.schemaVersion,
    receivedAt: nowIso,
  };
  if (data.cpu_percent !== undefined) {
    normalized.cpu_percent = data.cpu_percent;
  }
  if (data.ram_used_bytes !== undefined) {
    normalized.ram_used_bytes = data.ram_used_bytes;
  }
  if (data.ram_total_bytes !== undefined) {
    normalized.ram_total_bytes = data.ram_total_bytes;
  }
  if (data.free_heap_bytes !== undefined) {
    normalized.free_heap_bytes = data.free_heap_bytes;
    if (normalized.free_heap === undefined) {
      normalized.free_heap = data.free_heap_bytes;
    }
  } else if (data.free_heap !== undefined) {
    normalized.free_heap_bytes = data.free_heap;
  }
  return { ok: true, data: normalized };
}

function validateTestRunPayload(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: 'Expected a JSON object',
      issues: [{ path: '(root)', message: 'Expected a JSON object' }],
    };
  }

  const parsed = testRunInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid test run fields',
      issues: formatZodIssues(parsed.error),
    };
  }

  const data = parsed.data;
  return {
    ok: true,
    data: {
      runId: data.runId,
      deviceId: normalizeDeviceId(data.deviceId),
      startedAt: data.startedAt || new Date().toISOString(),
      scenario: data.scenario,
      domain: data.domain,
      expectedStatus: data.expectedStatus,
      observedStatus: data.observedStatus,
      latency_ms: data.latency_ms,
      passed: data.passed,
    },
  };
}

module.exports = {
  VALID_STATUSES,
  VALID_TELEMETRY_KINDS,
  metricInputSchema,
  validateMetricPayload,
  validateTelemetryPayload,
  validateTestRunPayload,
};
