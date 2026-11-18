import { memo, useMemo } from 'react';
import type { DeviceEvent } from '@/types/monitor';

function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '–';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getCpuColor(percent: number): string {
  if (percent >= 80) return '#ff5c6c'; // high load red
  if (percent >= 60) return '#f5b942'; // elevated yellow
  return '#3ddc97'; // normal green
}

function getRamColor(percent: number): string {
  if (percent >= 85) return '#ff5c6c';
  if (percent >= 70) return '#f5b942';
  return '#38bdf8';
}

function Sparkline({
  data,
  min = 0,
  max = 100,
  stroke = '#38bdf8',
  height = 34,
  width = 130,
}: {
  data: number[];
  min?: number;
  max?: number;
  stroke?: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-[34px] w-[130px] items-center justify-center rounded border border-line/40 bg-panel2/50 text-[10px] text-faint">
        {data.length === 1 ? '1 sample' : 'Waiting for trend'}
      </div>
    );
  }

  const computedMax = Math.max(max, ...data);
  const range = computedMax - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastX = (data.length - 1) * step;
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 8) - 4;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r="3" fill={stroke} />
    </svg>
  );
}

export interface ClientHardwareHealthProps {
  device: DeviceEvent[];
  activeDevice?: string | null;
  selectedDevice?: string;
}

export const ClientHardwareHealth = memo(function ClientHardwareHealth({
  device,
  activeDevice,
  selectedDevice,
}: ClientHardwareHealthProps) {
  // Extract recent hardware telemetry events (sorted oldest to newest for charts)
  const hardwareHistory = useMemo(() => {
    return device
      .filter((d) => d.cpu_percent != null || d.ram_used_bytes != null || d.free_heap != null)
      .slice(0, 30)
      .reverse();
  }, [device]);

  // Latest event with telemetry data
  const latest = useMemo(() => {
    return device.find((d) => d.cpu_percent != null || d.ram_used_bytes != null || d.free_heap != null);
  }, [device]);

  const cpuSamples = useMemo(() => {
    return hardwareHistory
      .map((d) => d.cpu_percent)
      .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  }, [hardwareHistory]);

  const ramSamples = useMemo(() => {
    return hardwareHistory
      .map((d) => {
        if (d.ram_used_bytes != null && d.ram_total_bytes != null && d.ram_total_bytes > 0) {
          return (d.ram_used_bytes / d.ram_total_bytes) * 100;
        }
        return null;
      })
      .filter((r): r is number => r != null && Number.isFinite(r));
  }, [hardwareHistory]);

  const currentCpu = latest?.cpu_percent != null ? Math.min(100, Math.max(0, latest.cpu_percent)) : null;
  const currentRamUsed = latest?.ram_used_bytes;
  const currentRamTotal = latest?.ram_total_bytes;
  const currentFreeHeap = latest?.free_heap_bytes ?? latest?.free_heap;

  const ramPercent = useMemo(() => {
    if (currentRamUsed != null && currentRamTotal != null && currentRamTotal > 0) {
      return Math.min(100, Math.max(0, (currentRamUsed / currentRamTotal) * 100));
    }
    if (currentFreeHeap != null && currentRamTotal != null && currentRamTotal > 0) {
      return Math.min(100, Math.max(0, ((currentRamTotal - currentFreeHeap) / currentRamTotal) * 100));
    }
    return null;
  }, [currentRamUsed, currentRamTotal, currentFreeHeap]);

  const cpuColor = currentCpu != null ? getCpuColor(currentCpu) : '#38bdf8';
  const ramColor = ramPercent != null ? getRamColor(ramPercent) : '#38bdf8';

  const deviceLabel = activeDevice && activeDevice !== 'unknown'
    ? activeDevice
    : selectedDevice && selectedDevice !== 'auto' && selectedDevice !== 'all'
      ? selectedDevice
      : 'ESP32 Client';

  return (
    <section id="hardware" className="panel scroll-mt-24" aria-label="Client hardware health">
      <div className="h2 mb-3">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M15 2v2" /><path d="M15 20v2" />
            <path d="M2 15h2" /><path d="M2 9h2" />
            <path d="M20 15h2" /><path d="M20 9h2" />
            <path d="M9 2v2" /><path d="M9 20v2" />
          </svg>
          Client Hardware Health
          <span className="rounded-full border border-line bg-panel2 px-2 py-0.5 font-mono text-[11px] font-normal text-accent">
            {deviceLabel}
          </span>
        </span>
        <span className="text-[11px] text-faint">
          {latest ? `Last updated ${new Date(latest.ts).toLocaleTimeString()}` : 'Awaiting hardware metrics'}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* CPU Load Metric Card */}
        <div className="rounded-md border border-line bg-panel2/60 p-3.5 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-mute">CPU Utilization</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold leading-none" style={{ color: cpuColor }}>
                  {currentCpu != null ? `${currentCpu.toFixed(1)}%` : '–'}
                </span>
                <span className="text-xs text-faint">FreeRTOS idle hook</span>
              </div>
            </div>
            <div className="text-right">
              <Sparkline
                data={cpuSamples}
                min={0}
                max={100}
                stroke={cpuColor}
              />
              <span className="mt-1 block text-[10px] text-faint">trend (last {cpuSamples.length} samples)</span>
            </div>
          </div>

          {/* Progress Bar Gauge */}
          <div className="mt-3">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-line/80">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${currentCpu ?? 0}%`,
                  backgroundColor: cpuColor,
                  boxShadow: currentCpu && currentCpu > 80 ? `0 0 8px ${cpuColor}` : undefined,
                }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] font-mono text-faint">
              <span>0% (Idle)</span>
              <span>50%</span>
              <span>100% (Full load)</span>
            </div>
          </div>
        </div>

        {/* RAM Consumption & Free Heap Metric Card */}
        <div className="rounded-md border border-line bg-panel2/60 p-3.5 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-mute">RAM Consumption / Heap</span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold leading-none" style={{ color: ramColor }}>
                  {ramPercent != null ? `${ramPercent.toFixed(1)}%` : '–'}
                </span>
                <span className="text-xs text-faint">
                  {currentRamUsed != null && currentRamTotal != null
                    ? `${formatBytes(currentRamUsed)} / ${formatBytes(currentRamTotal)}`
                    : currentFreeHeap != null
                      ? `${formatBytes(currentFreeHeap)} free`
                      : 'Heap metrics'}
                </span>
              </div>
            </div>
            <div className="text-right">
              <Sparkline
                data={ramSamples}
                min={0}
                max={100}
                stroke={ramColor}
              />
              <span className="mt-1 block text-[10px] text-faint">trend (last {ramSamples.length} samples)</span>
            </div>
          </div>

          {/* Dual Progress Bar for Used RAM and Free Heap */}
          <div className="mt-3">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-line/80">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${ramPercent ?? 0}%`,
                  backgroundColor: ramColor,
                }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-faint">
              <span>
                Used: <b className="font-semibold text-ink">{currentRamUsed != null ? formatBytes(currentRamUsed) : '–'}</b>
              </span>
              <span>
                Free Heap: <b className="font-semibold text-[#3ddc97]">{currentFreeHeap != null ? formatBytes(currentFreeHeap) : '–'}</b>
              </span>
              <span>
                Total: <b className="font-medium text-ink">{currentRamTotal != null ? formatBytes(currentRamTotal) : '–'}</b>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
