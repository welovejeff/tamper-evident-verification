// Type declarations for "tamper-signal/express": the Express/Connect attach
// helper. Internally framework-free (plain (req, res, next) handlers).

/** A minimal (req, res, next) middleware, structurally compatible with Express. */
export type Middleware = (req: any, res: any, next: (err?: unknown) => void) => void;

/** Anything with `use(path, ...handlers)` -- Express, Connect, Polka, etc. */
export interface Useable {
  use(path: string, ...handlers: Middleware[]): unknown;
}

/** Serve a receipts directory (flat files only, no traversal). */
export function receiptsMiddleware(options?: { receiptsDir?: string }): Middleware;

/** Serve the bundled browser assets (badge/light/element/table/console/room). */
export function assetsMiddleware(): Middleware;

/** A `<script type="module">` snippet that mounts the inline light. When
 * `receiptsHref` is set, the light's "view receipts →" link lands there
 * (the attach helper pre-wires it to the served room page). `pubKey` and
 * `warnDrift` carry the attach-level verification policy so the pill and the
 * room can never disagree. */
export function signalSnippet(
  chainUrl?: string,
  options?: {
    assetsPrefix?: string;
    selector?: string;
    receiptsHref?: string;
    pubKey?: string | string[];
    warnDrift?: boolean;
  },
): string;

/** A `<script type="module">` snippet that mounts an inline embedded-density
 * Signal Room, for hosts that render their own Data tab. */
export function roomSnippet(
  chainUrl?: string,
  options?: {
    assetsPrefix?: string;
    selector?: string;
    strict?: boolean;
    pubKey?: string | string[];
    warnDrift?: boolean;
  },
): string;

/** Deprecated alias of the room mount: the console is a room preset since 2.1. */
export function consoleSnippet(
  chainUrl?: string,
  options?: { assetsPrefix?: string; selector?: string },
): string;

/** A standalone HTML page that mounts the Signal Room (page density; honors
 * ?focus=auto and hash deep links). */
export function roomPage(
  chainUrl?: string,
  options?: {
    assetsPrefix?: string;
    preset?: "room" | "table" | "console";
    strict?: boolean;
    pubKey?: string | string[];
    warnDrift?: boolean;
  },
): string;

/** Deprecated alias: serves the room with its rail open (preset "console"). */
export function consolePage(chainUrl?: string, options?: { assetsPrefix?: string }): string;

export interface TamperSignalAttachOptions {
  receiptsDir?: string;
  urlPrefix?: string;
  assetsPrefix?: string;
  selector?: string;
  /** Serve the room page and pre-wire the light's receiptsHref to it
   * (default true). Not recommended to disable; the light will link to raw
   * JSON. */
  room?: boolean;
  /** Bake strict mode into the served room page and roomSnippet. */
  strict?: boolean;
  /** Trusted key hex (or rotation list) baked into the served room page. */
  pubKey?: string | string[];
  /** Bake warn-drift into the served room page. */
  warnDrift?: boolean;
}

export interface TamperSignalAttachResult {
  chainUrl: string;
  assetsPrefix: string;
  /** The served Signal Room page (`${assetsPrefix}/receipts`). */
  roomUrl: string;
  /** Deprecated alias route, room-backed since 2.1. */
  consoleUrl: string;
  /** The light mount snippet to drop into your layout (receiptsHref
   * pre-wired to the room unless room:false). */
  snippet: string;
  /** An inline embedded-density room mount, for a host-rendered Data tab. */
  roomSnippet: string;
  /** Deprecated alias of roomSnippet's role, kept for 2.x. */
  consoleSnippet: string;
}

/** Attach receipts serving, the bundled assets, and the Signal Room in one
 * call. One call creates both halves: the light snippet and the live room
 * behind it. */
export function tamperSignal(
  app: Useable,
  options?: TamperSignalAttachOptions,
): TamperSignalAttachResult;
