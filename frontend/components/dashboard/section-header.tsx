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
    <div className="flex flex-col gap-3 sm:gap-4">
      <div>
        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-[clamp(1.65rem,7vw,3rem)] font-semibold leading-[1.05] text-[var(--ink)] sm:mt-3">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)] sm:mt-3 sm:text-[15px] sm:leading-7">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
