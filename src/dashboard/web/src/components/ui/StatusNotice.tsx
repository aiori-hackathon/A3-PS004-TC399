interface StatusNoticeProps {
  title: string;
  message: string;
}

export function StatusNotice({ title, message }: StatusNoticeProps) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-32 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold-300">{title}</p>
      <p className="mt-4 font-display text-3xl text-ivory-100">{message}</p>
    </div>
  );
}
