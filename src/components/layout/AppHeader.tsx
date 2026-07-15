import type { ReactNode } from "react";
import { Surface } from "../ui/Surface";

type AppHeaderProps = {
  actions: ReactNode;
  onNavigateHome: () => void;
  subtitle: ReactNode;
};

export function AppHeader({
  actions,
  onNavigateHome,
  subtitle
}: AppHeaderProps) {
  return (
    <Surface
      as="header"
      className="flex min-h-[82px] items-center justify-between gap-4 rounded-[2rem] p-4 max-lg:flex-col max-lg:items-stretch"
    >
      <button
        className="flex min-w-60 items-center gap-3 rounded-full bg-white/[0.03] p-1.5 pr-5 text-left transition hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal max-lg:w-full"
        type="button"
        title="ライブラリへ"
        onClick={onNavigateHome}
      >
        <span className="grid size-11 place-items-center rounded-full border border-teal/30 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.38),transparent_30%),linear-gradient(135deg,rgba(67,224,202,0.95),rgba(122,167,255,0.72))] text-base font-black text-[#061210] shadow-[0_14px_36px_rgba(67,224,202,0.2)]">
          M
        </span>
        <span className="grid min-w-0 gap-1">
          <h1 className="m-0 text-xl font-semibold leading-none text-ink">
            Mimicopy
          </h1>
          <span className="truncate text-sm text-muted max-sm:whitespace-normal">
            {subtitle}
          </span>
        </span>
      </button>

      {actions}
    </Surface>
  );
}
