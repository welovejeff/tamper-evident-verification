// React wrapper for the inline status light.
//
//   import { LineageLight } from "lineage-receipts/badge/light-react.js";
//   <LineageLight chain="/receipts/chain.json" />
//
// Props mirror mountLineageLight: chain (required), pubKey, watch, warnDrift,
// receiptsHref, theme. This file assumes a bundler that resolves "react";
// light.js itself has no dependencies and works from a plain script tag.

import { createElement, useEffect, useRef } from "react";
import { mountLineageLight } from "./light.js";

export function LineageLight({ chain, pubKey, watch, warnDrift, receiptsHref, theme }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const handle = mountLineageLight(ref.current, chain, pubKey, {
      watch,
      warnDrift,
      receiptsHref,
      theme,
    });
    return () => handle.destroy();
  }, [chain, pubKey, watch, warnDrift, receiptsHref, theme]);
  return createElement("span", { ref });
}
