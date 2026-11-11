import { useEffect, useState } from 'react';
import { AegisMark } from '@/components/layout/AegisMark';
import { formatRelative } from '@/lib/outcomes';
import type { ApiStatus, GatewayMetric } from '@/types/monitor';

const NAV_LINKS = [
  { href: '#overview', label: 'Outcomes' },
  { href: '#path', label: 'Path' },
  { href: '#latency', label: 'Latency' },
  { href: '#queries', label: 'Queries' },
  { href: '#events', label: 'Events' },
];

interface SiteHeaderProps {
  apiStatus: ApiStatus;
  latestMetric?: GatewayMetric;
}

export function SiteHeader({ apiStatus, latestMetric }: SiteHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const statusLabel = apiStatus === 'online'
    ? 'API connected'
    : apiStatus === 'offline'
      ? 'API unavailable'
      : 'Connecting';
  const statusClass = apiStatus === 'online'
    ? 'border-emerald-400/50 text-emerald-300'
    : apiStatus === 'offline'
      ? 'border-verdict-bogus/50 text-verdict-bogus'
      : 'border-gold-500/50 text-gold-300';

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color] duration-500 ${
        scrolled ? 'border-gold-500/20 bg-forest-950/90 backdrop-blur-md' : 'border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <a href="#top" className="shrink-0" aria-label="AegisDNS home">
          <AegisMark tone={scrolled ? 'dark' : 'light'} />
        </a>
        <nav aria-label="Monitor sections" className="hidden items-center gap-6 xl:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-300 ${
                scrolled ? 'text-ivory/70 hover:text-gold-300' : 'text-forest-800 hover:text-forest-900'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
            scrolled ? statusClass : `border-forest-900/30 ${apiStatus === 'online' ? 'text-forest-800' : 'text-forest-700'}`
          }`}>
            {statusLabel}
          </span>
          <span className={`hidden font-mono text-[9px] sm:block ${scrolled ? 'text-ivory/45' : 'text-forest-800/70'}`}>
            {latestMetric ? `Last gateway metric ${formatRelative(latestMetric.timestamp)}` : 'Awaiting gateway metrics'}
          </span>
        </div>
      </div>
    </header>
  );
}
