interface SectionHeaderProps {
  index: string;
  eyebrow: string;
  title: string;
  description?: string;
}

export function SectionHeader({ index, eyebrow, title, description }: SectionHeaderProps) {
  return (
    <header className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-end md:gap-12">
      <div>
        <div className="tech-ruler" aria-hidden="true" />
        <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.22em] text-gold-300">
          <span>{index}</span>
          <span className="mx-3 text-ivory/30">/</span>
          <span>{eyebrow}</span>
        </p>
        <h2 className="mt-4 font-display text-4xl leading-[1.2] text-ivory-100 md:text-5xl">{title}</h2>
      </div>
      {description && <p className="text-base leading-[1.5] text-ivory/70">{description}</p>}
    </header>
  );
}
