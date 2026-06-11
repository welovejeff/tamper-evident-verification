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
   * "light" renders a light pill, intended for a DARK host page. On a light
   * host, omit it -- the default dark pill is correct there.
   */
  theme?: "light" | "dark";
}

export const TamperSignal: FC<TamperSignalProps>;
