import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[24px] border border-white/60 bg-white/82 shadow-[0_18px_38px_rgba(15,31,38,0.12)] backdrop-blur md:rounded-[28px] md:shadow-[var(--shadow)]",
        className
      )}
      {...props}
    />
  );
}
