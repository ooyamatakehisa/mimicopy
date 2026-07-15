import type { CSSProperties } from "react";

export type DynamicStyle = CSSProperties & {
  [key: `--${string}`]: string;
};
