import { ShieldCheck } from 'lucide-react';

interface AegisMarkProps {
  tone: 'light' | 'dark';
}

export function AegisMark({ tone }: AegisMarkProps) {
  const textClass = tone === 'light' ? 'text-forest-900' : 'text-ivory-100';
  const subClass = tone === 'light' ? 'text-forest-700' : 'text-ivory/60';
  return (
    <div className={`flex items-center gap-3 ${textClass}`}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold-500/70">
        <ShieldCheck className="h-5 w-5 text-gold-500" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span className="leading-none">
        <span className="block font-display text-xl tracking-tight">AegisDNS</span>
        <span className={`mt-1.5 block font-mono text-[10px] uppercase tracking-[0.24em] ${subClass}`}>
          IoT DNSSEC
        </span>
      </span>
    </div>
  );
}
