import { IntroSection } from '@/components/intro/IntroSection';
import { MonitorDashboard } from '@/components/monitor/MonitorDashboard';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AegisMark } from '@/components/layout/AegisMark';
import { MetricsProvider, useMetrics } from '@/context/MetricsContext';
import { distinctClientCount, newestMetric } from '@/lib/outcomes';

function DashboardApp() {
  const { apiStatus, metrics, lastSuccessfulFetchAt } = useMetrics();
  const latestMetric = newestMetric(metrics);

  return (
    <div data-dashboard-build="aegisdns-bolt-metrics-only-v3" className="min-h-screen bg-forest-950 text-ivory-100">
      <SiteHeader apiStatus={apiStatus} latestMetric={latestMetric} />
      <main>
        <IntroSection
          apiStatus={apiStatus}
          metricsCount={metrics.length}
          clientCount={distinctClientCount(metrics)}
          lastSuccessfulFetchAt={lastSuccessfulFetchAt}
        />
        <MonitorDashboard />
      </main>
      <footer className="border-t border-gold-500/20">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-12 md:flex-row md:items-center md:justify-between">
          <AegisMark tone="dark" />
          <p className="max-w-3xl font-mono text-[10px] uppercase leading-[1.7] tracking-[0.12em] text-ivory/45">
            Live dashboard view of the existing AegisDNS gateway metrics API. The dashboard displays only data supplied by the current backend; its in-memory metrics history resets when the dashboard server restarts. DNS, TLS, resolver and firmware workflows are unchanged.
          </p>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <MetricsProvider>
      <DashboardApp />
    </MetricsProvider>
  );
}

export default App;
