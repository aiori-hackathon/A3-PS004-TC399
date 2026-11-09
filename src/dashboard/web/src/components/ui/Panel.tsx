import type { ReactNode } from 'react';

interface PanelProps {
  children: ReactNode;
  className?: string;
}

const CORNER_CLASSES = [
  'left-0 top-0 border-l border-t',
  'right-0 top-0 border-r border-t',
  'bottom-0 left-0 border-b border-l',
  'bottom-0 right-0 border-b border-r',
];

export function Panel({ children, className = '' }: PanelProps) {
  return (
    <div className={`relative border border-ivory/10 bg-forest-900/80 ${className}`}>
      {CORNER_CLASSES.map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          className={`pointer-events-none absolute h-3 w-3 border-gold-300/70 ${corner}`}
        />
      ))}
      {children}
    </div>
  );
}
