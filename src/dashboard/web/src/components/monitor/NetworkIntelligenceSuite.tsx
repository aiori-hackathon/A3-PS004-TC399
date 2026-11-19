import { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { ApnicMonitor } from '@/components/monitor/ApnicMonitor';
import { ApnicExplorer } from '@/components/monitor/ApnicExplorer';
import {
  Globe,
  Route,
  ShieldAlert,
  Cpu,
  Radio,
  Clock,
  Sparkles,
  ExternalLink,
  Layers,
} from 'lucide-react';

type IntelligenceTab =
  | 'apnic'
  | 'bgp'
  | 'rpki'
  | 'threat'
  | 'behaviour';

interface TabConfig {
  id: IntelligenceTab;
  title: string;
  badge: 'ACTIVE' | 'COMING SOON';
  icon: typeof Globe;
  description: string;
}

const TABS: TabConfig[] = [
  {
    id: 'apnic',
    title: 'APNIC Allocation Intelligence',
    badge: 'ACTIVE',
    icon: Globe,
    description: 'Official delegated resource registries for IPv4, IPv6, and ASN allocations in the Asia-Pacific region.',
  },
  {
    id: 'bgp',
    title: 'BGP Routing Intelligence',
    badge: 'COMING SOON',
    icon: Route,
    description: 'AS-path analysis, prefix hijacking detection, and route propagation monitoring for resolved DNS endpoints.',
  },
  {
    id: 'rpki',
    title: 'RPKI Route Origin Validation',
    badge: 'COMING SOON',
    icon: ShieldAlert,
    description: 'Cryptographic validation of Route Origin Authorizations (ROAs) to detect BGP route misorigin anomalies.',
  },
  {
    id: 'threat',
    title: 'DNS Threat Intelligence',
    badge: 'COMING SOON',
    icon: Radio,
    description: 'Reputation scoring, malicious domain detection, DGA analysis, and passive DNS correlation.',
  },
  {
    id: 'behaviour',
    title: 'Device Behaviour Analytics',
    badge: 'COMING SOON',
    icon: Cpu,
    description: 'Baseline query rate profiling, DNS tunneling detection, and IoT device anomaly classification.',
  },
];

export function NetworkIntelligenceSuite() {
  const [activeTab, setActiveTab] = useState<IntelligenceTab>('apnic');
  const [apnicSubTab, setApnicSubTab] = useState<'overview' | 'explorer'>('overview');

  return (
    <div className="space-y-8">
      {/* Module Selector Bar */}
      <div className="flex flex-wrap gap-2 border-b border-ivory/10 pb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const isLive = tab.badge === 'ACTIVE';

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 rounded border px-4 py-2.5 font-mono text-xs transition-colors duration-200 ${
                isActive
                  ? 'border-gold-300 bg-gold-400/10 text-gold-200'
                  : 'border-ivory/10 bg-ivory/5 text-ivory/60 hover:border-ivory/25 hover:text-ivory'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="font-sans font-medium">{tab.title}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                  isLive
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-ivory/10 text-ivory/40'
                }`}
              >
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Tab Content */}
      {activeTab === 'apnic' && (
        <div className="space-y-6">
          {/* Sub Navigation between Overview & Explorer */}
          <div className="flex items-center justify-between border-b border-ivory/10 pb-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApnicSubTab('overview')}
                className={`border-b-2 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                  apnicSubTab === 'overview'
                    ? 'border-gold-300 text-gold-300 font-bold'
                    : 'border-transparent text-ivory/50 hover:text-ivory'
                }`}
              >
                Overview & Metrics
              </button>
              <button
                type="button"
                onClick={() => setApnicSubTab('explorer')}
                className={`border-b-2 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
                  apnicSubTab === 'explorer'
                    ? 'border-gold-300 text-gold-300 font-bold'
                    : 'border-transparent text-ivory/50 hover:text-ivory'
                }`}
              >
                Interactive Explorer
              </button>
            </div>
            <span className="font-mono text-xs text-ivory/40 hidden sm:inline">
              Source: delegated-apnic-latest (24h sync)
            </span>
          </div>

          {apnicSubTab === 'overview' ? <ApnicMonitor /> : <ApnicExplorer />}
        </div>
      )}

      {/* Future Modules (Clearly marked COMING SOON) */}
      {activeTab === 'bgp' && (
        <Panel className="p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-ivory/10 pb-4">
            <Route className="h-6 w-6 text-gold-300" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif text-xl font-semibold text-ivory">BGP Routing Intelligence</h3>
                <span className="rounded bg-ivory/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-ivory/50">
                  Coming Soon
                </span>
              </div>
              <p className="text-xs text-ivory/60 mt-1">
                Border Gateway Protocol route visibility and path security module.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 text-sm text-ivory/80 leading-relaxed">
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Planned Capabilities</h4>
              <ul className="space-y-2 list-disc list-inside text-xs text-ivory/70">
                <li>Real-time route leak and BGP hijack detection for resolved DNS A/AAAA records.</li>
                <li>AS-Path hop count analysis to identify suspicious network transit deviations.</li>
                <li>Correlation with APNIC ASN allocations to detect unauthorized origin advertisements.</li>
                <li>Passive BGP feed ingestion from RouteViews and RIPE RIS collector feeds.</li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Integration Architecture</h4>
              <p className="text-xs text-ivory/70">
                Operates as an asynchronous background intelligence layer without altering DNSSEC validation or adding
                latency to IoT query paths. Enriched metrics will be delivered to the dashboard via WebSocket events.
              </p>
              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 font-mono text-xs text-ivory/50">
                Status: In architectural design for post-PS-004 milestone.
              </div>
            </div>
          </div>
        </Panel>
      )}

      {activeTab === 'rpki' && (
        <Panel className="p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-ivory/10 pb-4">
            <ShieldAlert className="h-6 w-6 text-gold-300" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif text-xl font-semibold text-ivory">RPKI Route Origin Validation</h3>
                <span className="rounded bg-ivory/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-ivory/50">
                  Coming Soon
                </span>
              </div>
              <p className="text-xs text-ivory/60 mt-1">
                Resource Public Key Infrastructure cryptographic origin authentication.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 text-sm text-ivory/80 leading-relaxed">
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Planned Capabilities</h4>
              <ul className="space-y-2 list-disc list-inside text-xs text-ivory/70">
                <li>Route Origin Authorization (ROA) validation against all five RIR Trust Anchors (TALs).</li>
                <li>Classification of resolved IP routes into RPKI states: Valid, Invalid, or NotFound.</li>
                <li>Detection of sub-prefix hijacking attempts targeting authenticated IoT endpoints.</li>
                <li>Integration with local Routinator validator cache.</li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Integration Architecture</h4>
              <p className="text-xs text-ivory/70">
                Enriches gateway metric records after DNSSEC verification has concluded. The IoT gateway maintains
                strict policy independence between DNSSEC verdicts and RPKI routing states.
              </p>
              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 font-mono text-xs text-ivory/50">
                Status: Scheduled for integration with local Routinator instance.
              </div>
            </div>
          </div>
        </Panel>
      )}

      {activeTab === 'threat' && (
        <Panel className="p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-ivory/10 pb-4">
            <Radio className="h-6 w-6 text-gold-300" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif text-xl font-semibold text-ivory">DNS Threat Intelligence</h3>
                <span className="rounded bg-ivory/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-ivory/50">
                  Coming Soon
                </span>
              </div>
              <p className="text-xs text-ivory/60 mt-1">
                Multi-feed domain reputation, DGA detection, and IOC correlation.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 text-sm text-ivory/80 leading-relaxed">
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Planned Capabilities</h4>
              <ul className="space-y-2 list-disc list-inside text-xs text-ivory/70">
                <li>Automated matching of queried domains against open threat intelligence feeds (MISP, AlienVault OTX).</li>
                <li>Machine learning-based Domain Generation Algorithm (DGA) entropy scoring.</li>
                <li>Passive DNS history tracking to spot sudden IP resolution shifts (Fast-Flux).</li>
                <li>Supplementary advisory warnings displayed in dashboard query ledger.</li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Threat vs DNSSEC Independence</h4>
              <p className="text-xs text-ivory/70">
                A domain can be cryptographically SECURE according to DNSSEC while hosting malicious content.
                This module will explicitly present DNSSEC status and Threat score as orthogonal dimensions.
              </p>
              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 font-mono text-xs text-ivory/50">
                Status: In preliminary research phase.
              </div>
            </div>
          </div>
        </Panel>
      )}

      {activeTab === 'behaviour' && (
        <Panel className="p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-ivory/10 pb-4">
            <Cpu className="h-6 w-6 text-gold-300" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif text-xl font-semibold text-ivory">Device Behaviour Analytics</h3>
                <span className="rounded bg-ivory/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-ivory/50">
                  Coming Soon
                </span>
              </div>
              <p className="text-xs text-ivory/60 mt-1">
                Baseline query profiling and covert channel detection for IoT clients.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2 text-sm text-ivory/80 leading-relaxed">
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Planned Capabilities</h4>
              <ul className="space-y-2 list-disc list-inside text-xs text-ivory/70">
                <li>Per-device query rate and burst anomaly profiling keyed on mTLS client certificate CN.</li>
                <li>DNS tunneling detection (TXT record volume, high entropy subdomains, packet length).</li>
                <li>Unexpected NXDOMAIN frequency spikes indicating command-and-control beaconing.</li>
                <li>ESP32 memory footprint and TLS handshake latency health correlation.</li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-serif text-base font-semibold text-ivory">Integration Architecture</h4>
              <p className="text-xs text-ivory/70">
                Combines serial telemetry emitted by the ESP32 bridge with gateway DNS query volume to provide
                holistic end-to-end device posture assessment.
              </p>
              <div className="rounded border border-ivory/10 bg-ivory/5 p-3 font-mono text-xs text-ivory/50">
                Status: Roadmap integration with serial telemetry pipeline.
              </div>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
