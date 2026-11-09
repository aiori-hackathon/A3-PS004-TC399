import { useMetrics } from '@/context/MetricsContext';
import { EventHistory } from '@/components/monitor/EventHistory';
import { LatencyChart } from '@/components/monitor/LatencyChart';
import { LatestVerdict } from '@/components/monitor/LatestVerdict';
import { OutcomeOverview } from '@/components/monitor/OutcomeOverview';
import { QueryActivity } from '@/components/monitor/QueryActivity';
import { ValidationPipeline } from '@/components/monitor/ValidationPipeline';
import { Reveal } from '@/components/ui/Reveal';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusNotice } from '@/components/ui/StatusNotice';
import { newestMetric } from '@/lib/outcomes';

export function MonitorDashboard() {
  const { apiStatus, metrics, livePulse, metricsError } = useMetrics();
  const latestMetric = newestMetric(metrics);

  return (
    <div className="fine-lines relative">
      <div className="mx-auto flex max-w-7xl flex-col gap-24 px-6 py-24 md:gap-28 md:py-28">
        {apiStatus === 'offline' && (
          <StatusNotice
            title="Dashboard API unavailable"
            message={metricsError ?? 'The dashboard could not read the existing AegisDNS metrics endpoint.'}
          />
        )}

        <Reveal>
          <section id="overview" className="scroll-mt-24 space-y-10">
            <SectionHeader
              index="01"
              eyebrow="Gateway outcome overview"
              title="The verdicts AegisDNS actually recorded"
              description="Counts are calculated only from GET /api/metrics. All five gateway status values are kept distinct."
            />
            <OutcomeOverview metrics={metrics} />
          </section>
        </Reveal>

        <Reveal>
          <section id="path" className="scroll-mt-24 space-y-10">
            <SectionHeader
              index="02"
              eyebrow="Request path"
              title="Follow a DNS request through AegisDNS"
              description="A marker travels the four-stage path when a new gateway metric is detected. The diagram describes the configured flow; it does not claim live health checks for Unbound or BIND9."
            />
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:items-stretch">
              <div className="border border-ivory/10 bg-forest-900/50 p-6 md:p-8">
                <ValidationPipeline livePulse={livePulse} />
              </div>
              <LatestVerdict metric={latestMetric} />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section id="latency" className="scroll-mt-24 space-y-10">
            <SectionHeader
              index="03"
              eyebrow="Gateway performance"
              title="Request latency measured inside the gateway"
              description="Each point is an actual latency_ms value from the Python gateway. This is gateway-side processing time, not the ESP32's full Wi-Fi and TLS round trip; no synthetic threshold is applied."
            />
            <LatencyChart metrics={metrics} />
          </section>
        </Reveal>

        <Reveal>
          <section id="queries" className="scroll-mt-24 space-y-10">
            <SectionHeader
              index="04"
              eyebrow="Gateway query activity"
              title="Search the DNS requests received by the gateway"
              description="The table uses the query, type, client, status, latency and timestamp fields returned by the existing metrics API."
            />
            <QueryActivity metrics={metrics} />
          </section>
        </Reveal>

        <Reveal>
          <section id="events" className="scroll-mt-24 space-y-10">
            <SectionHeader
              index="05"
              eyebrow="Gateway event history"
              title="Recent DNS requests recorded by the gateway"
              description="Each entry represents one metric returned by the existing gateway metrics API. No serial-side or synthetic events are added."
            />
            <EventHistory metrics={metrics} />
          </section>
        </Reveal>
      </div>
    </div>
  );
}
