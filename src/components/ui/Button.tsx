import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border font-medium text-sm transition-[background,border-color,box-shadow,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:pointer-events-none disabled:opacity-40 active:translate-y-px",
  {
    defaultVariants: {
      size: "md",
      variant: "secondary"
    },
    variants: {
      size: {
        icon: "size-10 p-0",
        md: "h-11 min-w-24 px-4",
        sm: "h-9 px-3.5",
        transport: "h-11 min-w-16 px-4"
      },
      variant: {
        accent:
          "border-teal/45 bg-teal/15 text-teal shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-teal/75 hover:bg-teal/22 hover:shadow-[0_12px_28px_rgba(67,224,202,0.12)]",
        danger:
          "border-white/10 bg-white/[0.06] text-ink hover:border-danger/60 hover:bg-danger/14 hover:text-danger",
        primary:
          "border-teal/80 bg-teal text-[#07100f] shadow-[0_18px_40px_rgba(67,224,202,0.22)] hover:border-teal hover:bg-[#64f4df]",
        secondary:
          "border-white/10 bg-white/[0.07] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-white/18 hover:bg-white/[0.11] hover:shadow-tight"
      }
    }
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  size,
  variant,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ size, variant }), className)}
      type={type}
      {...props}
    />
  );
}

export function IconButton(props: Omit<ButtonProps, "size">) {
  return <Button size="icon" {...props} />;
}
