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

/** Serve the bundled browser assets (badge/light/element/table/console). */
export function assetsMiddleware(): Middleware;

/** A `<script type="module">` snippet that mounts the inline light. */
export function signalSnippet(
  chainUrl?: string,
  options?: { assetsPrefix?: string; selector?: string },
): string;

/** A standalone HTML page that mounts the inspector console. */
export function consolePage(chainUrl?: string, options?: { assetsPrefix?: string }): string;

export interface TamperSignalAttachOptions {
  receiptsDir?: string;
  urlPrefix?: string;
  assetsPrefix?: string;
  selector?: string;
}

export interface TamperSignalAttachResult {
  chainUrl: string;
  assetsPrefix: string;
  consoleUrl: string;
  /** The mount snippet to drop into your layout. */
  snippet: string;
}

/** Attach receipts serving, the bundled assets, and the console in one call. */
export function tamperSignal(
  app: Useable,
  options?: TamperSignalAttachOptions,
): TamperSignalAttachResult;
