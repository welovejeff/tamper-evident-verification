// UI scene: THE VERIFICATION CONSOLE — devtools for your data.
// Animates designs/02-debug-window.html: lamp + pipeline + event log.
// Mission control: calm when green, surgical when red.
// Renders in 960x540@15fps; all timing from fps, all sizing from scaleOf().
// Deterministic: no Math.random / Date.now anywhere.

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, scaleOf, shortHash } from "../../theme";
import { Terminal, HashChip, TypeText, Reveal, LinkArrow } from "../../components";

export const CONSOLE_DURATION_SEC = 14;

// --- Beat timings in SECONDS (converted to frames via fps at render time) ----
const T = {
  // build-in + green
  lampOn: 0.5,
  attach: 1.0,
  // verify run 1 (PASS)
  cmd1: 1.5, // 34 chars @ 25 cps → done ~2.9s
  sig1: 3.0,
  link01: 3.4,
  link12: 3.8,
  link23: 4.2,
  intact: 4.6,
  // tamper
  glitchStart: 5.2,
  note: 5.5,
  glitchEnd: 6.3,
  // verify run 2 (FAIL)
  cmd2: 6.6, // 34 chars @ 35 cps → done ~7.6s
  sig2: 7.7,
  link01b: 8.0,
  // RED
  broken: 8.5,
  det1: 9.4,
  det2: 10.0,
  // closing caption
  caption: 12.5,
} as const;

const EXPECTED_HASH = shortHash("clean-out"); // 6617…f3 — matches Proof.tsx
const FOUND_HASH = shortHash("tampered"); // bb30…43 — matches Proof.tsx

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// Deterministic frame-derived hash scramble for the tamper glitch.
const scrambleHash = (frame: number): string => {
  const hexAlphabet = "0123456789abcdef";
  const ch = (i: number): string =>
    hexAlphabet[
      Math.abs(Math.imul(frame + 13, 2654435761) + (i + 1) * 104729) % 16
    ];
  return `${ch(0)}${ch(1)}${ch(2)}${ch(3)}…${ch(4)}${ch(5)}`;
};

// --- Pipeline node data --------------------------------------------------------
const NODES = [
  { kind: "source", name: "tiktok.xlsx", seed: "ingest-out", meta: "48,212 rows" },
  { kind: "transform", name: "clean.py", seed: "clean-out", meta: null },
  { kind: "transform", name: "report.py", seed: "agg-out", meta: null },
  { kind: "render", name: "dashboard", seed: "dash-out", meta: null },
] as const;

// --- Event log script ------------------------------------------------------------
type LogKind = "info" | "note" | "cmd" | "ok" | "okBold" | "bad" | "badDim";
const LOG: { t: number; kind: LogKind; text: string; cps?: number }[] = [
  { t: T.attach, kind: "info", text: "console attached to chain tiktok-q2 (4 receipts)" },
  { t: T.cmd1, kind: "cmd", text: "receipts verify receipts/chain.json", cps: 25 },
  { t: T.sig1, kind: "ok", text: "✓ signatures valid (4/4)" },
  { t: T.link01, kind: "ok", text: "✓ link 0 → 1" },
  { t: T.link12, kind: "ok", text: "✓ link 1 → 2" },
  { t: T.link23, kind: "ok", text: "✓ link 2 → 3" },
  { t: T.intact, kind: "okBold", text: "✓ CHAIN INTACT · 4 receipts" },
  { t: T.note, kind: "note", text: "# clean.py output changed on disk" },
  { t: T.cmd2, kind: "cmd", text: "receipts verify receipts/chain.json", cps: 35 },
  { t: T.sig2, kind: "ok", text: "✓ signatures valid (4/4)" },
  { t: T.link01b, kind: "ok", text: "✓ link 0 → 1" },
  { t: T.broken, kind: "bad", text: "✗ CHAIN BROKEN at link 1 → 2" },
  { t: T.det1, kind: "badDim", text: `  expected ${EXPECTED_HASH} · found ${FOUND_HASH}` },
  { t: T.det2, kind: "badDim", text: "  delta: rows −22 · views −24,889" },
];
const LOG_VISIBLE = 6; // visible rows in the log strip before it scrolls

const LOG_STYLE: Record<
  Exclude<LogKind, "cmd">,
  { color: string; bold: boolean; dim: boolean }
> = {
  info: { color: COLORS.dim, bold: false, dim: true },
  note: { color: COLORS.faint, bold: false, dim: true },
  ok: { color: COLORS.green, bold: false, dim: false },
  okBold: { color: COLORS.green, bold: true, dim: false },
  bad: { color: COLORS.red, bold: true, dim: false },
  badDim: { color: COLORS.red, bold: false, dim: true },
};

// File name with the extension tinted violet, like the design's .node-name .ext.
const NodeName: React.FC<{ name: string }> = ({ name }) => {
  const m = name.match(/^(.*)(\.\w+)$/);
  if (!m) {
    return <>{name}</>;
  }
  return (
    <>
      {m[1]}
      <span style={{ color: COLORS.violet }}>{m[2]}</span>
    </>
  );
};

export const ConsoleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = scaleOf(width, height);
  const f = (sec: number): number => sec * fps;
  const tSec = frame / fps;

  // --- Window build-in ---------------------------------------------------------
  const winO = interpolate(frame, [0, f(0.4)], [0, 1], CLAMP);
  const winScale = interpolate(frame, [0, f(0.4)], [0.96, 1], CLAMP);

  // --- Lamp: green breathing → red double-blink alarm ---------------------------
  const isRed = frame >= f(T.broken);
  const lampOn = interpolate(frame, [f(T.lampOn - 0.1), f(T.lampOn + 0.4)], [0, 1], CLAMP);
  // Slow sin breathing, ~4s period, while green.
  const breathe = 0.5 + 0.5 * Math.sin(((tSec - T.lampOn) * Math.PI * 2) / 4);
  // Sharp double-blink each 1.4s cycle while red (two gaussian brightness spikes).
  const sinceBreak = Math.max(0, tSec - T.broken);
  const cyc = sinceBreak % 1.4;
  const spike = (center: number, amp: number): number =>
    amp * Math.exp(-((cyc - center) * (cyc - center)) / (2 * 0.045 * 0.045));
  const redBlink = 1 + spike(0.08, 0.7) + spike(0.34, 0.55);
  const lampSnap = interpolate(frame, [f(T.broken), f(T.broken + 0.25)], [1.3, 1], CLAMP);
  const lampSize = 40 * s;
  const lampColor = isRed ? COLORS.red : lampOn > 0.5 ? COLORS.green : COLORS.faint;
  const lampGlow = isRed
    ? `0 0 ${26 * s}px ${7 * s}px rgba(248,113,113,${0.35 + 0.25 * (redBlink - 1)})`
    : `0 0 ${(20 + 10 * breathe) * s}px ${4 * s}px rgba(52,211,153,${
        (0.3 + 0.25 * breathe) * lampOn
      })`;
  const lampBrightness = isRed ? redBlink : 1 + 0.16 * breathe * lampOn;

  // --- State line crossfade -----------------------------------------------------
  const greenLineO = interpolate(frame, [f(T.broken - 0.15), f(T.broken)], [1, 0], CLAMP);
  const redLineO = interpolate(frame, [f(T.broken), f(T.broken + 0.2)], [0, 1], CLAMP);

  // --- Tamper glitch on clean.py -------------------------------------------------
  const glitching = frame >= f(T.glitchStart) && frame < f(T.glitchEnd);
  const tampered = frame >= f(T.glitchStart);
  // Red flicker: toggles every 2 frames during the glitch window.
  const flickerHot =
    glitching && Math.floor((frame - f(T.glitchStart)) / 2) % 2 === 0;
  const cleanHash = !tampered
    ? EXPECTED_HASH
    : glitching
      ? scrambleHash(frame)
      : FOUND_HASH;
  const flashO = interpolate(
    frame,
    [f(T.glitchStart), f(T.glitchStart + 0.15), f(T.glitchEnd), f(T.glitchEnd + 0.4)],
    [0, 1, 1, 0],
    CLAMP,
  );
  const flashScale = 1 + 0.25 * Math.sin((tSec - T.glitchStart) * 12) * flashO;

  // --- Red edge-glow pulse on the whole window (same approach as Proof.tsx) -----
  const edgeGlow =
    sinceBreak <= 0
      ? 0
      : Math.exp(-sinceBreak / 2.5) *
        (0.55 + 0.45 * Math.cos(sinceBreak * Math.PI * 2.2));

  // --- Event log scroll: push old lines up as new ones land beyond the fold ------
  const logLH = 32 * s;
  let logScroll = 0;
  for (let i = LOG_VISIBLE; i < LOG.length; i++) {
    logScroll += interpolate(
      frame,
      [f(LOG[i].t - 0.3), f(LOG[i].t)],
      [0, logLH],
      CLAMP,
    );
  }

  // --- Closing caption ------------------------------------------------------------
  const capO = interpolate(frame, [f(T.caption), f(T.caption + 0.6)], [0, 1], CLAMP);
  const capY = interpolate(frame, [f(T.caption), f(T.caption + 0.6)], [16 * s, 0], CLAMP);

  // Per-link arrow timing: arrows draw green as their PASS log line lands.
  const linkStarts = [T.link01, T.link12, T.link23] as const;
  const arrowLen = 80;
  const arrowSlotW = 106 * s;

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        justifyContent: "center",
        alignItems: "center",
        padding: `${28 * s}px ${36 * s}px ${56 * s}px`,
      }}
    >
      {/* ── window chrome ── */}
      <div
        style={{
          width: "94%",
          opacity: winO,
          transform: `scale(${winScale})`,
        }}
      >
        <Terminal s={s} width="100%" title="tamper signal · verification console">
          {/* full-bleed inner wrapper (cancels Terminal body padding) */}
          <div style={{ margin: -28 * s }}>
            {/* ── 1 ▸ status header: the room's traffic light ── */}
            <Reveal startFrame={f(0.1)} from="up">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18 * s,
                  padding: `${16 * s}px ${22 * s}px ${14 * s}px`,
                  borderBottom: `${1.5 * s}px solid ${COLORS.panelBorder}`,
                  background: `linear-gradient(180deg, ${COLORS.chrome}, ${COLORS.panel})`,
                }}
              >
                <div
                  style={{
                    width: lampSize,
                    height: lampSize,
                    borderRadius: "50%",
                    flexShrink: 0,
                    border: `${2 * s}px solid ${
                      isRed ? COLORS.redDeep : lampOn > 0.5 ? COLORS.greenDeep : COLORS.panelBorder
                    }`,
                    background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.4), transparent 55%), ${lampColor}`,
                    boxShadow: lampGlow,
                    filter: `brightness(${lampBrightness})`,
                    transform: `scale(${lampSnap})`,
                  }}
                />
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                  {(
                    [
                      ["The light is green, the data is clean.", COLORS.green, greenLineO * lampOn],
                      ["The light is red, the chain is broken.", COLORS.red, redLineO],
                    ] as const
                  ).map(([line, color, opacity], idx) => (
                    <div
                      key={line}
                      style={{
                        // green line holds the layout; red line overlays it
                        position: idx === 1 ? "absolute" : "relative",
                        inset: idx === 1 ? 0 : undefined,
                        opacity,
                        fontFamily: FONT.mono,
                        fontSize: 30 * s,
                        fontWeight: 700,
                        letterSpacing: 0.3 * s,
                        color,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {line}
                    </div>
                  ))}
                  <div
                    style={{
                      marginTop: 5 * s,
                      fontFamily: FONT.mono,
                      fontSize: 18 * s,
                      color: COLORS.dim,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isRed
                      ? `broken at clean.py → report.py · downstream unverifiable`
                      : `chain tiktok-q2 · 4 receipts · 3 links`}
                  </div>
                </div>
              </div>
            </Reveal>

            {/* ── 2 ▸ receipt chain pipeline ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: `${22 * s}px ${20 * s}px ${20 * s}px`,
                borderBottom: `${1.5 * s}px solid ${COLORS.panelBorder}`,
              }}
            >
              {NODES.map((node, i) => {
                const isClean = i === 1; // the tamper target
                const hot = isClean && tampered;
                const accent = hot ? COLORS.red : COLORS.green;
                const cardGlow = isClean && flickerHot;
                return (
                  <React.Fragment key={node.name}>
                    <Reveal startFrame={f(0.3 + 0.15 * i)} from="up">
                      <div style={{ position: "relative" }}>
                        <div
                          style={{
                            width: 190 * s,
                            background: COLORS.panel,
                            border: `${1.5 * s}px solid ${
                              cardGlow ? COLORS.red : COLORS.panelBorder
                            }`,
                            borderTop: `${4 * s}px solid ${accent}`,
                            borderRadius: 10 * s,
                            padding: `${10 * s}px ${12 * s}px ${11 * s}px`,
                            display: "flex",
                            flexDirection: "column",
                            gap: 6 * s,
                            boxShadow: hot
                              ? `0 0 ${(cardGlow ? 34 : 22) * s}px ${COLORS.red}44`
                              : undefined,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: FONT.mono,
                              fontSize: 14 * s,
                              letterSpacing: 1.4 * s,
                              textTransform: "uppercase",
                              color: COLORS.faint,
                            }}
                          >
                            {node.kind}
                          </div>
                          <div
                            style={{
                              fontFamily: FONT.mono,
                              fontSize: 23 * s,
                              fontWeight: 700,
                              color: COLORS.text,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <NodeName name={node.name} />
                          </div>
                          {node.meta ? (
                            <div
                              style={{
                                fontFamily: FONT.mono,
                                fontSize: 17 * s,
                                color: COLORS.dim,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {node.meta}
                            </div>
                          ) : null}
                          <div>
                            <HashChip
                              s={s}
                              text={isClean ? cleanHash : shortHash(node.seed)}
                              color={hot ? COLORS.red : COLORS.cyan}
                              glow={isClean && glitching}
                            />
                          </div>
                          <div
                            style={{
                              fontFamily: FONT.mono,
                              fontSize: 18 * s,
                              color: COLORS.green,
                              whiteSpace: "nowrap",
                            }}
                          >
                            ✓ sig ed25519
                          </div>
                        </div>
                        {/* red ✎ tamper flash */}
                        {isClean ? (
                          <div
                            style={{
                              position: "absolute",
                              top: -18 * s,
                              right: -12 * s,
                              fontSize: 40 * s,
                              color: COLORS.red,
                              opacity: flashO,
                              transform: `scale(${flashScale}) rotate(-12deg)`,
                              textShadow: `0 0 ${14 * s}px ${COLORS.red}cc`,
                            }}
                          >
                            ✎
                          </div>
                        ) : null}
                      </div>
                    </Reveal>
                    {i < NODES.length - 1 ? (
                      <div
                        style={{
                          width: arrowSlotW,
                          flexShrink: 0,
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        {i === 1 && isRed ? (
                          <LinkArrow
                            s={s}
                            startFrame={f(T.broken)}
                            length={arrowLen}
                            broken
                          />
                        ) : (
                          <LinkArrow
                            s={s}
                            startFrame={f(linkStarts[i])}
                            length={arrowLen}
                          />
                        )}
                      </div>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </div>

            {/* ── 3 ▸ event log strip ── */}
            <Reveal startFrame={f(0.8)} from="up">
              <div style={{ background: "#0a0d12", borderRadius: `0 0 ${14 * s}px ${14 * s}px` }}>
                <div
                  style={{
                    padding: `${7 * s}px ${22 * s}px ${5 * s}px`,
                    fontFamily: FONT.mono,
                    fontSize: 14 * s,
                    letterSpacing: 2 * s,
                    textTransform: "uppercase",
                    color: COLORS.faint,
                    borderBottom: `${1.5 * s}px solid #131a22`,
                  }}
                >
                  event log
                </div>
                <div
                  style={{
                    height: LOG_VISIBLE * logLH,
                    overflow: "hidden",
                    padding: `${6 * s}px ${22 * s}px ${8 * s}px`,
                  }}
                >
                  <div style={{ transform: `translateY(${-logScroll}px)` }}>
                    {LOG.map((line, i) => {
                      const started = frame >= f(line.t);
                      return (
                        <div
                          key={`${i}-${line.t}`}
                          style={{
                            height: logLH,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          {!started ? null : line.kind === "cmd" ? (
                            <TypeText
                              s={s}
                              text={line.text}
                              startFrame={f(line.t)}
                              charsPerFrame={(line.cps ?? 25) / fps}
                              fontSize={20}
                              prefix="$"
                            />
                          ) : (
                            <div
                              style={{
                                fontFamily: FONT.mono,
                                fontSize: 20 * s,
                                color: LOG_STYLE[line.kind].color,
                                fontWeight: LOG_STYLE[line.kind].bold ? 700 : 400,
                                opacity:
                                  interpolate(
                                    frame,
                                    [f(line.t), f(line.t + 0.25)],
                                    [0, 1],
                                    CLAMP,
                                  ) * (LOG_STYLE[line.kind].dim ? 0.7 : 1),
                                whiteSpace: "pre",
                              }}
                            >
                              {line.text}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Terminal>
      </div>

      {/* ── red inset edge-glow pulse on chain break (Proof.tsx approach) ── */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: `inset 0 0 ${130 * s}px rgba(248,113,113,${0.45 * edgeGlow})`,
        }}
      />

      {/* ── closing caption ── */}
      <div
        style={{
          position: "absolute",
          bottom: 16 * s,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: capO,
          transform: `translateY(${capY}px)`,
          fontFamily: FONT.mono,
          fontSize: 24 * s,
          color: COLORS.dim,
        }}
      >
        devtools for your data’s chain of custody
      </div>
    </AbsoluteFill>
  );
};
