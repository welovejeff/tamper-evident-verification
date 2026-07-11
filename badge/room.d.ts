// Type declarations for badge/room.js — the Signal Room: v2's one robust
// surface behind the untouched status light.

import type { BrowserVerifyResult } from "../types/core.js";

/** The state detail emitted after every verification run (also dispatched as
 * a bubbling `tamper-signal:state` CustomEvent on the mount container).
 * `state` is the CHAIN verdict; `attested` is the byte-identity boolean for
 * the published table (a stale table emits its chain state with
 * `attested: false`). The documented host gate is
 * `strict && (state === "red" || !attested)`. */
export interface RoomStateDetail {
  state: "green" | "yellow" | "red" | "unverifiable";
  attested: boolean;
  strict: boolean;
}

/** Deep-link / open() targets. `inspector:` takes a stage name or a receipt
 * index; `caveat:` an index into the yellow caveat list; `column:` a header. */
export type RoomOpenTarget =
  | "auto"
  | "break"
  | "rail"
  | "custody"
  | "log"
  | `inspector:${string}`
  | `caveat:${number}`
  | `column:${string}`;

export interface SignalRoomOptions {
  /** table.json URL; defaults to table.json beside chain.json. */
  tableUrl?: string;
  /** timeline.json URL; defaults to timeline.json beside chain.json. */
  timelineUrl?: string;
  /** Flag any control-totals movement across intact links as a caveat. */
  warnDrift?: boolean;
  /** Re-verify every N milliseconds (min 1000). */
  watch?: number;
  /** Emitted in every state detail so a host can gate its own UI. */
  strict?: boolean;
  /** Rows rendered before the "show all" footer (default 500). */
  maxRows?: number;
  /** Callback receiving every emitted state detail. */
  onState?: (detail: RoomStateDetail) => void;
  /** Programmatic deep-link target applied after the first render. */
  focus?: RoomOpenTarget;
  /** Initial emphasis only: "table" keeps the rail collapsed to chips,
   * "console" starts with the rail expanded. Default "room". */
  preset?: "room" | "table" | "console";
  /** "page" for the served route (full-bleed, hash deep links honored);
   * "embedded" (default) for an inline bordered card. */
  density?: "page" | "embedded";
  /** Override the footer's raw chain.json link. */
  rawHref?: string;
}

export interface SignalRoomHandle {
  /** The room's root element (carries id="tamper-room" when first in the
   * document, plus data-state / data-density / data-preset). */
  el: HTMLElement;
  /** Resolves with the first verification result. */
  ready: Promise<BrowserVerifyResult>;
  /** Fresh run: always bypasses the shared verification memo. */
  refresh(): Promise<BrowserVerifyResult>;
  /** The current display state ("red-stale" distinguishes the stale-table
   * band from a broken chain; emitted states never carry it). */
  getState(): "checking" | "green" | "yellow" | "red" | "red-stale" | "unverifiable";
  /** Scroll/expand hint, verdict-gated (a "break" on a green chain is a
   * no-op). Returns whether the target existed. */
  open(target: RoomOpenTarget): boolean;
  /** Remove the room and stop any watch loop. */
  destroy(): void;
}

/**
 * Mount the Signal Room: the data-table-first surface carrying the provenance
 * rail, break exhibit, receipt inspector, event log, chain-of-custody
 * timeline, and evidence export. Same argument contract as mountTamperSignal:
 * `pubKeyHex` may be a trusted key hex, an array of them (rotation), or the
 * options object.
 */
export function mountSignalRoom(
  containerEl: HTMLElement,
  chainUrl: string,
  pubKeyHex?: string | string[] | SignalRoomOptions,
  opts?: SignalRoomOptions
): SignalRoomHandle;

/** `<tamper-signal-room chain="/receipts/chain.json">` — the room as a custom
 * element; the mount handle is exposed as `.room`. */
export class TamperSignalRoomElement extends HTMLElement {
  static get observedAttributes(): string[];
  get room(): SignalRoomHandle | null;
}

/** React (and any JSX runtime) parity: the custom element used directly from
 * JSX. Import "tamper-signal/room" for the side effect of registering the
 * element, then render <tamper-signal-room chain="..." />. */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "tamper-signal-room": {
        chain: string;
        table?: string;
        timeline?: string;
        "pub-key"?: string;
        watch?: number | string;
        "warn-drift"?: boolean | "";
        strict?: boolean | "";
        "max-rows"?: number | string;
        focus?: string;
        preset?: "room" | "table" | "console";
        density?: "page" | "embedded";
        children?: never;
      } & Record<string, unknown>;
    }
  }
}
