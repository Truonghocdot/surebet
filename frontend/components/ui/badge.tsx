import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] sm:px-3 sm:text-xs sm:tracking-[0.16em]",
  {
    variants: {
      variant: {
        teal: "border-teal-200 bg-teal-50 text-teal-700",
        orange: "border-orange-200 bg-orange-50 text-orange-700",
        red: "border-red-200 bg-red-50 text-red-700",
        slate: "border-slate-200 bg-slate-50 text-slate-700"
      }
    },
    defaultVariants: {
      variant: "slate"
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
