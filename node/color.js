// Terminal color for the human-facing CLI: the Node port of tamper_signal/color.py.
// Presentation layer only. Color is emitted to stdout only when it is an
// interactive terminal and no override turns it off; every primitive returns
// plain text when color is off, so the word and glyph survive without ANSI.
//
// Gating precedence (highest first):
//   1. --no-color flag (setNoColor)               -> off
//   2. NO_COLOR env present (any value)           -> off
//   3. FORCE_COLOR env present                    -> on
//   4. otherwise                                  -> stream.isTTY
// NO_COLOR wins over FORCE_COLOR. shouldColor is only evaluated against stdout;
// stderr (notices) and --json output are always plain.

// SGR codes. Kept identical to tamper_signal/color.py so the two CLIs match.
export const RESET = "\x1b[0m";
export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";

// "amber" names the color; the verdict value stays "yellow".
const VERDICT_COLOR = { green: GREEN, yellow: YELLOW, red: RED };

// Set by the CLI when --no-color is passed. Always wins over the environment.
let noColor = false;

export function setNoColor(value) {
  noColor = Boolean(value);
}

export function shouldColor(stream = process.stdout) {
  if (noColor) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return Boolean(stream && stream.isTTY);
}

function paint(text, code, stream) {
  return shouldColor(stream) ? `${code}${text}${RESET}` : text;
}

// Dim secondary detail (hashes, counts) when color is on.
export function dim(text, stream = process.stdout) {
  return paint(text, DIM, stream);
}

export function bold(text, stream = process.stdout) {
  return paint(text, BOLD, stream);
}

// The colored traffic-light glyph for a verdict ("green"/"yellow"/"red").
// The caller prints the verdict word alongside it, so meaning survives color-off.
export function light(verdict, stream = process.stdout) {
  return paint("●", VERDICT_COLOR[verdict] ?? "", stream);
}

// Paint text in a verdict's color ("green"/"yellow"/"red").
export function colorize(text, verdict, stream = process.stdout) {
  return paint(text, VERDICT_COLOR[verdict] ?? "", stream);
}

// Color a pre-formatted signed token by its sign (+green, -red).
export function signed(token, stream = process.stdout) {
  const text = String(token);
  if (text.startsWith("+")) return paint(text, GREEN, stream);
  if (text.startsWith("-")) return paint(text, RED, stream);
  return text;
}

// A signed movement value, colored by direction (increase green, decrease red).
// The sign is always printed, so direction reads without color and for
// colorblind users. Direction is a neutral cue, not a verdict.
export function delta(value, stream = process.stdout) {
  if (value > 0) return paint(`+${value}`, GREEN, stream);
  if (value < 0) return paint(`${value}`, RED, stream);
  return "0";
}
