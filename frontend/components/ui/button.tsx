import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-white shadow-[0_14px_32px_rgba(11,138,119,0.24)] hover:bg-[var(--accent-strong)]",
        secondary:
          "border border-[color:var(--line)] bg-white/80 text-[var(--ink)] hover:bg-white",
        ghost:
          "bg-transparent text-[var(--muted)] hover:bg-black/5 hover:text-[var(--ink)]",
        danger:
          "bg-[var(--danger)] text-white hover:bg-[var(--danger-strong)]"
      },
      size: {
        sm: "h-9 px-4",
        md: "h-11 px-5",
        lg: "h-12 px-6"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ size, variant }), className)}
      ref={ref}
      {...props}
    />
  )
);

Button.displayName = "Button";

