import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "aside" | "div" | "footer" | "header" | "main" | "section";
  children: ReactNode;
};

export function Surface({
  as: Component = "section",
  children,
  className,
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        "min-w-0 rounded-[2rem] border border-white/10 bg-surface/82 shadow-soft backdrop-blur-2xl",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function SectionHeader({
  action,
  className,
  description,
  title,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-[76px] items-center justify-between gap-4 border-b border-white/8 px-5 py-4 max-sm:grid max-sm:min-h-0 max-sm:grid-cols-1 max-sm:items-start max-sm:px-4",
        className
      )}
      {...props}
    >
      <div className="grid min-w-0 gap-1">
        <h2 className="truncate text-lg font-semibold leading-tight text-ink">
          {title}
        </h2>
        {description ? (
          <p className="min-w-0 text-sm text-muted max-sm:whitespace-normal">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
