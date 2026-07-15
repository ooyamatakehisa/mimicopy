import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...props }: TextInputProps) {
  return (
    <input
      className={cn(
        "h-11 min-w-0 rounded-2xl border border-white/10 bg-white/[0.07] px-3 text-sm text-ink outline-none transition-[background,border-color,box-shadow] placeholder:text-quiet focus:border-teal/55 focus:bg-white/[0.1] focus:shadow-[0_0_0_4px_rgba(67,224,202,0.1)]",
        className
      )}
      {...props}
    />
  );
}
