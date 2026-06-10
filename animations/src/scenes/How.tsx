// Animation 2: HOW IT WORKS — the receipt chain.
// Every pipeline stage emits a signed receipt; receipts link because each
// stage's input hash must equal the previous stage's output hash.
//
// Responsive: 16:9 GIF comp (chain flows left→right) and 9:16 vertical comp
// (headline pinned near the top, chain flows top→bottom). All timing derives
// from fps (seconds), all sizing from scaleOf(width, height).

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, scaleOf, isVertical, shortHash } from "../theme";
import {
  HashChip,
  StageCard,
  Reveal,
  Headline,
  LinkArrow,
} from "../components";

export const HOW_DURATION_SEC = 18;

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// Deterministic hash seeds — re-used so matching hashes visibly match.
const H_SOURCE = shortHash("source");
const H_CODE = shortHash("clean-code");
const H_CLEAN = shortHash("clean-out");
const H_AGG = shortHash("agg-out");

// --- A hash that visibly "computes" then settles with a glow ----------------
const ComputingHash: React.FC<{
  s: number;
  seed: string;
  startSec: number;
  settleSec: number;
  caption: string;
}> = ({ s, seed, startSec, settleSec, caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = startSec * fps;
  const settle = settleSec * fps;
  const settled = frame >= settle;
  // Deterministic scramble: cycle through fake hashes ~10x/sec until settle.
  const spinStep = Math.max(1, Math.round(fps / 10));
  const text = settled
    ? shortHash(seed)
    : shortHash(`${seed}-spin-${Math.floor(frame / spinStep)}`);
  const captionOpacity = interpolate(
    frame,
    [settle + 0.2 * fps, settle + 0.6 * fps],
    [0, 1],
    CLAMP,
  );
  return (
    <Reveal
      startFrame={start}
      from="up"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6 * s,
      }}
    >
      <HashChip s={s} text={text} glow={settled && frame < settle + 2 * fps} />
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 19 * s,
          color: COLORS.dim,
          opacity: captionOpacity,
        }}
      >
        {caption}
      </div>
    </Reveal>
  );
};

// --- Receipt card ------------------------------------------------------------
type ReceiptLine = {
  label: string;
  value: string;
  hash?: boolean;
  color?: string;
  caption?: string;
  glow?: boolean;
};

const ReceiptPanel: React.FC<{
  s: number;
  title: string;
  lines: ReceiptLine[];
  appearSec: number;
  width: number; // unscaled design px
  signGlowSec?: number; // when the signature line flashes green
  compact?: boolean;
  signature?: string;
}> = ({
  s,
  title,
  lines,
  appearSec,
  width,
  signGlowSec,
  compact = false,
  signature = "signed: ed25519",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const labelSize = (compact ? 19 : 23) * s;
  const pad = (compact ? 14 : 20) * s;
  const sigGlow =
    signGlowSec === undefined
      ? 0
      : interpolate(
          frame,
          [signGlowSec * fps, (signGlowSec + 0.3) * fps, (signGlowSec + 1.4) * fps],
          [0, 1, 0.2],
          CLAMP,
        );
  return (
    <Reveal startFrame={appearSec * fps} from="up">
      <div
        style={{
          width: width * s,
          background: COLORS.panel,
          border: `${2 * s}px solid ${COLORS.panelBorder}`,
          borderRadius: 12 * s,
          overflow: "hidden",
          boxShadow: `0 ${12 * s}px ${36 * s}px rgba(0,0,0,0.45)`,
        }}
      >
        <div
          style={{
            background: COLORS.chrome,
            padding: `${8 * s}px ${pad}px`,
            fontFamily: FONT.mono,
            fontSize: (compact ? 18 : 21) * s,
            color: COLORS.dim,
            borderBottom: `${1.5 * s}px solid ${COLORS.panelBorder}`,
            whiteSpace: "nowrap",
          }}
        >
          🧾 {title}
        </div>
        <div
          style={{
            padding: pad,
            display: "flex",
            flexDirection: "column",
            gap: (compact ? 8 : 12) * s,
          }}
        >
          {lines.map((line, i) => (
            <Reveal
              key={line.label}
              startFrame={(appearSec + 0.25 * (i + 1)) * fps}
              from="left"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10 * s,
                  fontFamily: FONT.mono,
                  fontSize: labelSize,
                  color: COLORS.dim,
                }}
              >
                <span>{line.label}</span>
                {line.hash ? (
                  <HashChip
                    s={s}
                    text={line.value}
                    color={line.color ?? COLORS.cyan}
                    glow={line.glow ?? false}
                  />
                ) : (
                  <span style={{ color: COLORS.text }}>{line.value}</span>
                )}
              </div>
              {line.caption ? (
                <div
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 17 * s,
                    color: COLORS.faint,
                    marginTop: 4 * s,
                  }}
                >
                  {line.caption}
                </div>
              ) : null}
            </Reveal>
          ))}
          <Reveal
            startFrame={(appearSec + 0.25 * (lines.length + 1)) * fps}
            from="left"
          >
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: labelSize,
                color: COLORS.green,
                padding: `${4 * s}px ${8 * s}px`,
                marginLeft: -8 * s,
                borderRadius: 8 * s,
                background: `rgba(52,211,153,${0.16 * sigGlow})`,
                textShadow:
                  sigGlow > 0 ? `0 0 ${16 * s * sigGlow}px ${COLORS.green}` : undefined,
                whiteSpace: "nowrap",
              }}
            >
              ✍ {signature}
            </div>
          </Reveal>
        </div>
      </div>
    </Reveal>
  );
};

// --- Scene -------------------------------------------------------------------
export const HowScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = scaleOf(width, height);
  const vertical = isVertical(width, height);
  const t = (sec: number) => sec * fps;

  // Headline crossfades (three beats).
  const h1 = interpolate(frame, [t(0), t(0.4), t(7.5), t(8)], [0, 1, 1, 0], CLAMP);
  const h2 = interpolate(frame, [t(8), t(8.4), t(12.4), t(12.9)], [0, 1, 1, 0], CLAMP);
  const h3 = interpolate(frame, [t(13), t(13.4), t(15.6), t(16)], [0, 1, 1, 0], CLAMP);

  // Build phase (beats 1-3) exits with a zoom-down at 13s; chain zooms in.
  const buildOpacity = interpolate(frame, [t(12.4), t(13)], [1, 0], CLAMP);
  const buildScale = interpolate(frame, [t(12.4), t(13)], [1, 0.82], CLAMP);
  const chainIn = interpolate(frame, [t(12.9), t(13.5)], [0, 1], CLAMP);
  const chainScale = interpolate(frame, [t(12.9), t(13.5)], [1.1, 1], CLAMP);
  const chainDim = interpolate(frame, [t(16), t(16.6)], [1, 0.2], CLAMP);

  // While only stage 0 exists (0-8s) keep it centered, then slide to make room.
  const groupShift = interpolate(
    frame,
    [t(7.8), t(8.6)],
    [(vertical ? 320 : 310) * s, 0],
    CLAMP,
  );

  // Matching-hash emphasis window (receipt 0 output ↔ receipt 1 input).
  const matchGlow = frame >= t(9.4) && frame <= t(11.6);

  const headlines: { opacity: number; text: string }[] = [
    { opacity: h1, text: "Give every stage a receipt." },
    { opacity: h2, text: "Each stage links to the last." },
    { opacity: h3, text: "A chain. Signed. Verifiable." },
  ];

  const fullReceiptW = vertical ? 600 : 470;
  const compactReceiptW = vertical ? 520 : 330;

  return (
    <AbsoluteFill
      style={{ background: COLORS.bg, display: "flex", flexDirection: "column" }}
    >
      {/* Headline zone — pinned near the top in both orientations */}
      <div
        style={{
          position: "relative",
          height: (vertical ? 230 : 110) * s,
          marginTop: (vertical ? 100 : 28) * s,
          width: "100%",
          flexShrink: 0,
        }}
      >
        {headlines.map((h) => (
          <div
            key={h.text}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: `0 ${60 * s}px`,
              opacity: h.opacity,
            }}
          >
            <Headline s={s} size={vertical ? 58 : 46}>
              {h.text}
            </Headline>
          </div>
        ))}
      </div>

      {/* Content zone — three crossfading layers */}
      <div style={{ position: "relative", flex: 1, width: "100%" }}>
        {/* Layer 1: build the first two receipts (beats 1-3) */}
        {frame < t(13.2) ? (
          <AbsoluteFill
            style={{
              justifyContent: "center",
              alignItems: "center",
              opacity: buildOpacity,
              transform: `translate${vertical ? "Y" : "X"}(${groupShift}px) scale(${buildScale})`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: vertical ? "column" : "row",
                alignItems: "center",
                gap: (vertical ? 20 : 30) * s,
              }}
            >
              {/* Stage 0: the source file + its receipt */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14 * s,
                }}
              >
                <Reveal startFrame={t(0.5)} from="up">
                  <StageCard
                    s={s}
                    icon="📊"
                    label="tiktok.xlsx"
                    sub="source data"
                    accent={COLORS.cyan}
                    highlight
                    width={290}
                  />
                </Reveal>
                <ComputingHash
                  s={s}
                  seed="source"
                  startSec={1.0}
                  settleSec={1.8}
                  caption="hash of the data"
                />
                <ReceiptPanel
                  s={s}
                  title="receipt 0 — source"
                  appearSec={3.0}
                  signGlowSec={5.0}
                  width={fullReceiptW}
                  lines={[
                    {
                      label: "data hash:",
                      value: H_SOURCE,
                      hash: true,
                      glow: matchGlow,
                    },
                    { label: "rows:", value: "48,212" },
                  ]}
                />
              </div>

              {/* The link between matching hashes */}
              <LinkArrow
                s={s}
                startFrame={t(9.2)}
                vertical={vertical}
                length={80}
              />

              {/* Stage 1: the transform + its receipt */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 14 * s,
                }}
              >
                <Reveal startFrame={t(8.2)} from={vertical ? "up" : "right"}>
                  <StageCard
                    s={s}
                    icon="⚡"
                    label="clean.py"
                    sub="transform"
                    accent={COLORS.violet}
                    highlight
                    width={290}
                  />
                </Reveal>
                <ReceiptPanel
                  s={s}
                  title="receipt 1 — clean"
                  appearSec={8.7}
                  signGlowSec={10.9}
                  width={fullReceiptW}
                  lines={[
                    {
                      label: "input hash:",
                      value: H_SOURCE,
                      hash: true,
                      glow: matchGlow,
                    },
                    {
                      label: "code hash:",
                      value: H_CODE,
                      hash: true,
                      color: COLORS.violet,
                      caption: "even the code is hashed",
                    },
                    { label: "output hash:", value: H_CLEAN, hash: true },
                  ]}
                />
              </div>
            </div>
          </AbsoluteFill>
        ) : null}

        {/* Layer 2: zoomed-out chain of three receipts (beat 4) */}
        {frame >= t(12.8) ? (
          <AbsoluteFill
            style={{
              justifyContent: "center",
              alignItems: "center",
              opacity: chainIn * chainDim,
              transform: `scale(${chainScale})`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: vertical ? "column" : "row",
                alignItems: "center",
                gap: 14 * s,
              }}
            >
              <ReceiptPanel
                s={s}
                compact
                title="receipt 0 — source"
                appearSec={13.0}
                width={compactReceiptW}
                signature="ed25519"
                lines={[{ label: "out:", value: H_SOURCE, hash: true }]}
              />
              <LinkArrow s={s} startFrame={t(13.7)} vertical={vertical} length={56} />
              <ReceiptPanel
                s={s}
                compact
                title="receipt 1 — clean"
                appearSec={13.25}
                width={compactReceiptW}
                signature="ed25519"
                lines={[
                  { label: "in:", value: H_SOURCE, hash: true },
                  { label: "out:", value: H_CLEAN, hash: true },
                ]}
              />
              <LinkArrow s={s} startFrame={t(14.1)} vertical={vertical} length={56} />
              <ReceiptPanel
                s={s}
                compact
                title="receipt 2 — aggregate"
                appearSec={13.5}
                width={compactReceiptW}
                signature="ed25519"
                lines={[
                  { label: "in:", value: H_CLEAN, hash: true },
                  { label: "out:", value: H_AGG, hash: true },
                ]}
              />
            </div>
          </AbsoluteFill>
        ) : null}

        {/* Layer 3: closing checkmark (beat 5) */}
        {frame >= t(15.9) ? (
          <AbsoluteFill
            style={{
              justifyContent: "center",
              alignItems: "center",
              padding: 60 * s,
            }}
          >
            <Reveal
              startFrame={t(16.1)}
              from="up"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 24 * s,
              }}
            >
              <div
                style={{
                  fontSize: 120 * s,
                  lineHeight: 1,
                  color: COLORS.green,
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  textShadow: `0 0 ${40 * s}px ${COLORS.green}88`,
                }}
              >
                ✓
              </div>
              <div
                style={{
                  fontFamily: FONT.sans,
                  fontWeight: 700,
                  fontSize: (vertical ? 44 : 36) * s,
                  lineHeight: 1.3,
                  color: COLORS.text,
                  textAlign: "center",
                  maxWidth: (vertical ? 840 : 760) * s,
                }}
              >
                If every link matches, the data made it through intact.
              </div>
            </Reveal>
          </AbsoluteFill>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
