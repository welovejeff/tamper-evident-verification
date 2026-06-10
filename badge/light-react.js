// React wrapper for the inline status light.
//
//   import { TamperSignal } from "./badge/light-react.js";
//   <TamperSignal chain="/receipts/chain.json" />
//
// Props mirror mountTamperSignal: chain (required), pubKey, watch, warnDrift,
// receiptsHref, theme. This file assumes a bundler that resolves "react";
// light.js itself has no dependencies and works from a plain script tag.

import { createElement, useEffect, useRef } from "react";
import { mountTamperSignal } from "./light.js";

export function TamperSignal({ chain, pubKey, watch, warnDrift, receiptsHref, theme }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const handle = mountTamperSignal(ref.current, chain, pubKey, {
      watch,
      warnDrift,
      receiptsHref,
      theme,
    });
    return () => handle.destroy();
  }, [chain, pubKey, watch, warnDrift, receiptsHref, theme]);
  return createElement("span", { ref });
}
