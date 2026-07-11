type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  description
}: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h1 className="mt-3 font-display text-[clamp(2rem,3.7vw,3rem)] font-semibold leading-none text-[var(--ink)]">
          {title}
        </h1>
        <p className="mt-3 max-w-4xl text-[15px] leading-7 text-[var(--muted)]">
          {description}
        </p>
      </div>
    </div>
  );
}

