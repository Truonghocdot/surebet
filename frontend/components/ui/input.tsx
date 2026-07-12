import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      className={cn(
        "flex h-12 w-full rounded-2xl border bg-white px-4 text-base text-[var(--ink)] shadow-sm transition placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 sm:text-sm",
        error
          ? "border-[color:var(--danger)]/35 focus-visible:ring-[color:var(--danger)]/20"
          : "border-[color:var(--line)] focus-visible:border-[color:var(--accent)] focus-visible:ring-[color:var(--accent)]/20",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);

Input.displayName = "Input";
