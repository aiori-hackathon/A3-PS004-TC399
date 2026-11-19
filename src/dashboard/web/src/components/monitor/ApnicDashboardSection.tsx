import { useState } from 'react';
import { ApnicMonitor } from '@/components/monitor/ApnicMonitor';
import { ApnicExplorer } from '@/components/monitor/ApnicExplorer';
import { Database, BarChart3 } from 'lucide-react';

export function ApnicDashboardSection() {
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer'>('overview');

  return (
    <div className="space-y-6">
      {/* Tab Selector */}
      <div className="flex items-center justify-between border-b border-ivory/10 pb-2">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
              activeTab === 'overview'
                ? 'border-gold-300 text-gold-300 font-bold'
                : 'border-transparent text-ivory/60 hover:text-ivory'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            <span>Allocation Overview & Verification</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('explorer')}
            className={`flex items-center gap-2 border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
              activeTab === 'explorer'
                ? 'border-gold-300 text-gold-300 font-bold'
                : 'border-transparent text-ivory/60 hover:text-ivory'
            }`}
          >
            <Database className="h-4 w-4" />
            <span>Resource Explorer & Directory</span>
          </button>
        </div>
        <span className="font-mono text-xs text-ivory/40 hidden sm:inline">
          Official APNIC Delegated Registry
        </span>
      </div>

      {activeTab === 'overview' ? <ApnicMonitor /> : <ApnicExplorer />}
    </div>
  );
}
