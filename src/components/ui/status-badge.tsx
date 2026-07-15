import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const statusBadgeVariants = cva(
  "inline-flex min-w-[76px] items-center justify-center rounded-full border px-3 py-1.5 text-[0.7rem] font-bold uppercase tracking-normal",
  {
    defaultVariants: {
      state: "idle"
    },
    variants: {
      state: {
        error: "border-danger/35 bg-danger/12 text-danger",
        idle: "border-white/10 bg-white/[0.06] text-muted",
        loading: "border-coral/35 bg-coral/12 text-coral",
        ready: "border-teal/35 bg-teal/12 text-teal"
      }
    }
  }
);

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({
  className,
  state = "idle",
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(statusBadgeVariants({ state }), className)}
      {...props}
    />
  );
}
