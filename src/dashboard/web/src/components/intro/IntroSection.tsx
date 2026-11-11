import { ArrowRight } from 'lucide-react';
import { NetworkIllustration } from '@/components/intro/NetworkIllustration';
import { AegisMark } from '@/components/layout/AegisMark';
import { Reveal } from '@/components/ui/Reveal';
import { formatRelative } from '@/lib/outcomes';
import type { ApiStatus } from '@/types/monitor';

interface IntroSectionProps {
  apiStatus: ApiStatus;
  metricsCount: number;
  clientCount: number;
  lastSuccessfulFetchAt: number | null;
}

export function IntroSection({
  apiStatus,
  metricsCount,
  clientCount,
  lastSuccessfulFetchAt,
}: IntroSectionProps) {
  const feedLabel = apiStatus === 'online' ? 'Connected' : apiStatus === 'offline' ? 'Unavailable' : 'Connecting';
  return (
    <section id="top" className="blueprint relative overflow-hidden bg-ivory-100 pb-20 pt-32 text-forest-900 md:pt-40">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal>
          <dl className="grid grid-cols-2 gap-px border border-forest-900/15 bg-forest-900/15 md:grid-cols-3">
            <StatusCell label="Metrics API" value={feedLabel} />
            <StatusCell label="Gateway metrics" value={`${metricsCount} retained`} />
            <StatusCell label="Distinct client labels" value={String(clientCount)} />
          </dl>
        </Reveal>

        <Reveal delay={60} className="mt-12">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <AegisMark tone="light" />
            <span className="hidden h-px w-16 bg-gold-500/60 md:block" aria-hidden="true" />
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-forest-700">
              DNS-over-TLS · Mutual TLS · DNSSEC validation
            </p>
          </div>
        </Reveal>

        <Reveal delay={120} className="mt-14 md:mt-20">
          <h1 className="max-w-5xl font-display text-[clamp(3rem,7.5vw,7rem)] leading-[1.2] tracking-[-0.02em] text-forest-900">
            Every name a device trusts is{' '}
            <em className="font-normal italic text-emerald-600">proven first.</em>
          </h1>
        </Reveal>

        <Reveal delay={240} className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <p className="max-w-xl text-lg leading-[1.5] text-forest-800/90">
            One ESP32 client connects to the Python gateway over mutually authenticated DNS-over-TLS.
            The gateway forwards requests to Unbound for DNSSEC validation; BIND9 serves the local
            <span className="font-mono text-base"> aegis.test </span>
            authoritative zone used by the lab.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="#path"
              className="group inline-flex items-center gap-3 bg-forest-900 px-6 py-3.5 font-mono text-xs uppercase tracking-[0.16em] text-ivory-100 transition-colors duration-300 hover:bg-forest-700"
            >
              Follow a verdict
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
            </a>
            <a
              href="#latency"
              className="inline-flex items-center gap-3 border border-forest-900/25 px-6 py-3.5 font-mono text-xs uppercase tracking-[0.16em] text-forest-900 transition-colors duration-300 hover:border-gold-500 hover:text-forest-700"
            >
              Gateway latency
            </a>
          </div>
        </Reveal>
      </div>

      <Reveal delay={360} className="mx-auto mt-16 max-w-7xl px-6 md:mt-24">
        <NetworkIllustration />
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-forest-700/70">
          Fig. 01 · ESP32 DoT client → Python gateway → Unbound validator → BIND9 local authority
        </p>
      </Reveal>

      <Reveal delay={480} className="mx-auto mt-16 max-w-7xl px-6">
        <dl className="grid gap-px border-y border-forest-900/15 bg-forest-900/15 md:grid-cols-3">
          <Stat value={String(metricsCount)} label="Gateway metrics retained by the API" />
          <Stat value={String(clientCount)} label="Distinct client labels in retained metrics" />
          <Stat value={lastSuccessfulFetchAt ? formatRelative(new Date(lastSuccessfulFetchAt).toISOString()) : '—'} label="Last successful /api/metrics read" />
        </dl>
      </Reveal>
    </section>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ivory-100 px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-forest-700/70">{label}</dt>
      <dd className="mt-1 font-mono text-xs uppercase tracking-[0.12em] text-forest-900">{value}</dd>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 bg-ivory-100 px-2 py-8 md:px-6">
      <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-forest-700">{label}</dt>
      <dd className="font-display text-4xl text-forest-900 md:text-5xl">{value}</dd>
    </div>
  );
}
