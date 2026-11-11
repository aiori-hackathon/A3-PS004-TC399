import { useMediaQuery } from '@/hooks/useMediaQuery';
import { OUTCOME_META } from '@/lib/outcomes';
import type { GatewayMetric } from '@/types/monitor';

interface ValidationPipelineProps {
  livePulse: GatewayMetric | null;
}

const STAGES = [
  {
    id: 'esp32',
    label: 'ESP32 client',
    role: 'The client connects to the gateway using DNS-over-TLS with mutual TLS authentication.',
    metricLabel: 'Gateway-observed client identity',
  },
  {
    id: 'gateway',
    label: 'Python gateway',
    role: 'Terminates mTLS, rejects CD=1 requests, forwards DNS to Unbound and publishes metrics.',
    metricLabel: 'What the API records',
  },
  {
    id: 'unbound',
    label: 'Unbound',
    role: 'The validating resolver. Its response code and AD bit are used by the gateway status classifier.',
    metricLabel: 'Resolver health API',
  },
  {
    id: 'bind9',
    label: 'BIND9 authority',
    role: 'Serves the local aegis.test authoritative lab zone used by the test scenarios.',
    metricLabel: 'Authority health API',
  },
] as const;

export function ValidationPipeline({ livePulse }: ValidationPipelineProps) {
  const isWide = useMediaQuery('(min-width: 768px)');
  const dotClass = livePulse ? OUTCOME_META[livePulse.status].dotClass : 'bg-ivory-100';
  const latest = livePulse;

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ivory/45">Configured request route</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ivory/45">ESP32 → gateway → resolver → authority</p>
      </div>
      <div className="relative">
        {isWide ? (
          <div className="relative grid grid-cols-4 gap-5">
            <div className="pointer-events-none absolute left-[6px] right-[calc(25%-10px)] top-5 h-px bg-ivory/20">
              {latest && (
                <span
                  key={latest.id}
                  className={`dot-travel-x absolute top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${dotClass}`}
                />
              )}
            </div>
            {STAGES.map((stage, index) => (
              <StageColumn key={stage.id} stage={stage} index={index} latest={latest} />
            ))}
          </div>
        ) : (
          <div className="relative">
            <div className="pointer-events-none absolute bottom-[120px] left-5 top-5 w-px bg-ivory/20">
              {latest && (
                <span
                  key={latest.id}
                  className={`dot-travel-y absolute left-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${dotClass}`}
                />
              )}
            </div>
            {STAGES.map((stage, index) => (
              <div key={stage.id} className="relative min-h-[142px] pl-12">
                <span className="absolute left-[14px] top-[14px] h-3 w-3 border border-gold-300 bg-forest-900" />
                <StageText stage={stage} index={index} latest={latest} />
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="mt-5 border-t border-ivory/10 pt-4 font-mono text-[10px] leading-[1.6] text-ivory/45">
        {latest
          ? `Last detected request: ${latest.query} · ${latest.status}. The travelling marker animates on newly received gateway records.`
          : 'Waiting for a new gateway metric. The path is shown from the configured AegisDNS topology; Unbound and BIND9 health are not exposed by the current dashboard API.'}
      </p>
    </div>
  );
}

interface StageProps {
  stage: (typeof STAGES)[number];
  index: number;
  latest: GatewayMetric | null;
}

function StageColumn({ stage, index, latest }: StageProps) {
  return (
    <div className="relative pr-2">
      <span className="mt-[14px] block h-3 w-3 border border-gold-300 bg-forest-900" />
      <div className="mt-6">
        <StageText stage={stage} index={index} latest={latest} />
      </div>
    </div>
  );
}

function StageText({ stage, index, latest }: StageProps) {
  let metricValue = 'Not exposed by current API';
  if (stage.id === 'esp32') metricValue = latest?.client || 'No gateway client identity yet';
  if (stage.id === 'gateway') metricValue = latest
    ? `${latest.latency_ms.toFixed(2)} ms · ${latest.cpu_percent.toFixed(1)}% process CPU`
    : 'Waiting for gateway metrics';

  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.18em] text-gold-300">0{index + 1}</p>
      <p className="mt-2 font-display text-2xl text-ivory-100">{stage.label}</p>
      <p className="mt-2 text-sm leading-[1.5] text-ivory/65">{stage.role}</p>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ivory/45">{stage.metricLabel}</p>
      <p className="mt-1 break-words font-mono text-[11px] leading-[1.5] text-ivory/80">{metricValue}</p>
    </div>
  );
}
