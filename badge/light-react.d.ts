// Type declarations for "tamper-signal/react": the React wrapper for the
// inline status light.

import type { FC } from "react";

export interface TamperSignalProps {
  /** URL of chain.json (required). */
  chain: string;
  /** Trusted public key hex, single or rotation list. */
  pubKey?: string | string[];
  /** Re-verify every N milliseconds (min 1000). */
  watch?: number;
  /** Flag any control-totals movement across intact links. */
  warnDrift?: boolean;
  /** href for the popover's "view receipts" link. */
  receiptsHref?: string;
  /**
   * The HOST page's surface ("light" default, or "dark"). On a dark host the
   * pill inverts to a light pill. Pick this to match what you see.
   */
  surface?: "light" | "dark";
  /** Boolean shortcut for `surface="dark"`. */
  invert?: boolean;
  /**
   * @deprecated Use `surface`. `theme="light"` == `surface="dark"` (a light
   * pill, for a dark host). Kept working for back-compat.
   */
  theme?: "light" | "dark";
}

export const TamperSignal: FC<TamperSignalProps>;
