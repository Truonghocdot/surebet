import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)]",
        className
      )}
    />
  );
}

