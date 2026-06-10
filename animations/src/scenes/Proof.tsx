// Animation 3: THE PROOF — verify PASS, tamper, verify FAIL, caught at the link.
// Responsive: renders in 960x540@15fps (GIF) and 1080x1920@30fps (vertical).
// All timing derives from fps (seconds * fps), all sizing from scaleOf().

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, scaleOf, isVertical, shortHash } from "../theme";
import {
  Terminal,
  TypeText,
  Headline,
  LinkArrow,
  StageCard,
  Reveal,
} from "../components";

export const PROOF_DURATION_SEC = 19;

// --- Beat timings in SECONDS (converted to frames via fps at render time) ----
const T = {
  // Beat 1: first verify run (PASS)
  cmd1: 0.5,
  sig1: 1.9,
  linkA1: 2.4,
  linkB1: 2.9,
  intact: 3.5,
  // Beat 2: tamper
  tamperHead: 4.0,
  glitchStart: 5.4,
  glitchEnd: 6.5,
  // Beat 3: second verify run (FAIL)
  run2: 8.0,
  cmd2: 8.2,
  sig2: 9.4,
  linkA2: 9.9,
  broken: 10.6,
  det1: 11.3,
  det2: 11.9,
  // Beat 4: spotlight
  caught: 14.0,
  // Beat 5: closing
  close: 17.0,
} as const;

const EXPECTED_HASH = shortHash("clean-out");
const FOUND_HASH = shortHash("tampered");

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// Deterministic scrambled view count for the glitch window (no Math.random).
const glitchViews = (frame: number): string => {
  const d = (i: number): number =>
    Math.abs((frame + 1) * (i + 3) * 7919 + i * 104729) % 10;
  return `${d(0)}${d(1)}${d(2)},${d(3)}${d(4)}${d(5)}`;
};

// One line of CLI output, revealed (opacity fade) at `atSec`.
const OutLine: React.FC<{
  s: number;
  atSec: number;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  children: React.ReactNode;
}> = ({ s, atSec, color = COLORS.green, bold = false, dim = false, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const start = atSec * fps;
  if (frame < start) {
    return null;
  }
  const o = interpolate(frame, [start, start + 0.25 * fps], [0, 1], CLAMP);
  return (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 26 * s,
        lineHeight: 1.5,
        color,
        fontWeight: bold ? 700 : 400,
        opacity: o * (dim ? 0.7 : 1),
        whiteSpace: "pre",
      }}
    >
      {children}
    </div>
  );
};

export const ProofScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = scaleOf(width, height);
  const vertical = isVertical(width, height);
  const f = (sec: number): number => sec * fps;
  const tSec = frame / fps;

  // --- Headline crossfades ---------------------------------------------------
  const seg = (startSec: number, endSec: number): number =>
    interpolate(
      frame,
      [f(startSec), f(startSec + 0.4), f(endSec - 0.4), f(endSec)],
      [0, 1, 1, 0],
      CLAMP,
    );
  const h1 = seg(0, T.tamperHead + 0.2);
  const h2 = seg(T.tamperHead + 0.2, T.run2 - 0.2);
  const h2b = seg(T.run2 - 0.2, T.det1);
  // "Caught" lands with the CHAIN BROKEN reveal, not 3s later at the spotlight.
  const h3 = seg(T.det1, PROOF_DURATION_SEC + 1);

  // --- Tamper glitch on the middle node ---------------------------------------
  const glitching = frame >= f(T.glitchStart) && frame < f(T.glitchEnd);
  const tampered = frame >= f(T.glitchStart);
  const viewsText = !tampered
    ? "284,003"
    : glitching
      ? glitchViews(frame)
      : "259,114";
  const flashO = interpolate(
    frame,
    [f(T.glitchStart), f(T.glitchStart + 0.15), f(T.glitchEnd), f(T.glitchEnd + 0.4)],
    [0, 1, 1, 0],
    CLAMP,
  );
  const flashScale =
    1 + 0.25 * Math.sin((tSec - T.glitchStart) * 12) * flashO;

  // --- Chain break + red edge glow pulse --------------------------------------
  const isBroken = frame >= f(T.broken);
  const sinceBreak = tSec - T.broken;
  const edgeGlow =
    sinceBreak < 0
      ? 0
      : Math.exp(-sinceBreak / 2.5) *
        (0.55 + 0.45 * Math.cos(sinceBreak * Math.PI * 2.2));

  // --- Beat 4 spotlight --------------------------------------------------------
  const spot = interpolate(frame, [f(T.caught), f(T.caught + 0.8)], [0, 1], CLAMP);

  // --- Beat 5 closing overlay ---------------------------------------------------
  const closeO = interpolate(frame, [f(T.close), f(T.close + 0.6)], [0, 1], CLAMP);
  const closeY = interpolate(frame, [f(T.close), f(T.close + 0.6)], [24 * s, 0], CLAMP);

  // Terminal has three states so the verdict never contradicts the diagram:
  //   1. first run (PASS)            — until the tamper begins
  //   2. cleared, waiting prompt     — tamper happened; old PASS is now stale
  //   3. second run (FAIL)           — after "Run verify again."
  const showRun1 = frame < f(T.glitchStart);
  const showRun2 = frame >= f(T.run2);
  const typeSpeed = 25 / fps; // ~25 chars per second at any fps
  const arrowLen = vertical ? 80 : 90;

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: (vertical ? 64 : 22) * s,
        padding: `${40 * s}px ${(vertical ? 48 : 40) * s}px`,
      }}
    >
      {/* --- Headline (crossfading per beat) --- */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: (vertical ? 170 : 100) * s,
          flexShrink: 0,
        }}
      >
        {(
          [
            ["Verify the whole chain.", h1, COLORS.text],
            ["Now someone tampers…", h2, COLORS.text],
            ["Run verify again.", h2b, COLORS.text],
            ["Caught. At the exact link.", h3, COLORS.red],
          ] as const
        ).map(([text, opacity, color]) => (
          <div
            key={text}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              opacity,
            }}
          >
            <Headline s={s} size={vertical ? 68 : 56} color={color}>
              {text}
            </Headline>
          </div>
        ))}
      </div>

      {/* --- Chain diagram: 3 receipts, 2 links --- */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10 * s,
          transform: `scale(${1 + 0.14 * spot})`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10 * s,
            opacity: 1 - 0.55 * spot,
          }}
        >
          <Reveal startFrame={f(0.6)} from="up">
            <StageCard
              s={s}
              icon="🧾"
              label="ingest"
              sub={shortHash("ingest-out")}
              accent={COLORS.green}
              width={210}
            />
          </Reveal>
          <LinkArrow s={s} startFrame={f(T.linkA1)} length={arrowLen} />
        </div>

        {/* middle node — the tamper target */}
        <Reveal startFrame={f(0.8)} from="up">
          <div style={{ position: "relative" }}>
            <StageCard
              s={s}
              icon="🧾"
              label="clean"
              // Once tampered, the card shows the hash the data NOW produces —
              // the same "found" value verify prints. The receipt's expected
              // hash lives in the terminal's "expected …" line.
              sub={tampered ? FOUND_HASH : EXPECTED_HASH}
              subColor={tampered ? COLORS.red : undefined}
              accent={tampered ? COLORS.red : COLORS.green}
              highlight={tampered}
              width={210}
            >
              <div
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 23 * s,
                  fontWeight: 600,
                  color: tampered ? COLORS.red : COLORS.green,
                  textShadow: glitching
                    ? `0 0 ${12 * s}px ${COLORS.red}aa`
                    : undefined,
                }}
              >
                views: {viewsText}
              </div>
            </StageCard>
            <div
              style={{
                position: "absolute",
                top: -20 * s,
                right: -14 * s,
                fontSize: 46 * s,
                color: COLORS.red,
                opacity: flashO,
                transform: `scale(${flashScale}) rotate(-12deg)`,
                textShadow: `0 0 ${16 * s}px ${COLORS.red}cc`,
              }}
            >
              ✎
            </div>
          </div>
        </Reveal>

        {/* link 1 → 2 — flips to broken at the FAIL moment */}
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: -36 * s,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${COLORS.red}3a 0%, transparent 70%)`,
              opacity: spot,
            }}
          />
          {isBroken ? (
            <LinkArrow s={s} startFrame={f(T.broken)} length={arrowLen} broken />
          ) : (
            <LinkArrow s={s} startFrame={f(T.linkB1)} length={arrowLen} />
          )}
        </div>

        <Reveal startFrame={f(1.0)} from="up">
          <StageCard
            s={s}
            icon="🧾"
            label="report"
            sub={shortHash("agg-out")}
            accent={COLORS.green}
            width={210}
          />
        </Reveal>
      </div>

      {/* --- Terminal --- */}
      <div
        style={{
          width: vertical ? "92%" : "66%",
          opacity: 1 - 0.7 * spot,
          flexShrink: 0,
        }}
      >
        <Terminal s={s} width="100%" title="verify">
          <div
            style={{
              minHeight: 255 * s,
              display: "flex",
              flexDirection: "column",
              gap: 2 * s,
            }}
          >
            {showRun1 ? (
              <>
                <TypeText
                  s={s}
                  text="verify chain.json"
                  startFrame={f(T.cmd1)}
                  charsPerFrame={typeSpeed}
                  prefix="$"
                />
                <OutLine s={s} atSec={T.sig1}>
                  ✓ signatures valid
                </OutLine>
                <OutLine s={s} atSec={T.linkA1}>
                  ✓ link 0 → 1
                </OutLine>
                <OutLine s={s} atSec={T.linkB1}>
                  ✓ link 1 → 2
                </OutLine>
                <OutLine s={s} atSec={T.intact} bold>
                  ✓ CHAIN INTACT · 3 receipts · 2 transforms
                </OutLine>
              </>
            ) : !showRun2 ? (
              // Tamper happened — the prior PASS is stale, so the terminal
              // clears to a waiting prompt. A dim note explains the gap.
              <>
                <OutLine s={s} atSec={T.glitchStart} color={COLORS.faint} dim>
                  # data changed on disk
                </OutLine>
                <div
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 26 * s,
                    color: COLORS.text,
                    marginTop: 4 * s,
                  }}
                >
                  <span style={{ color: COLORS.green }}>$ </span>
                  <span style={{ color: COLORS.green }}>▋</span>
                </div>
              </>
            ) : (
              <>
                <TypeText
                  s={s}
                  text="verify chain.json"
                  startFrame={f(T.cmd2)}
                  charsPerFrame={typeSpeed}
                  prefix="$"
                />
                <OutLine s={s} atSec={T.sig2}>
                  ✓ signatures valid
                </OutLine>
                <OutLine s={s} atSec={T.linkA2}>
                  ✓ link 0 → 1
                </OutLine>
                <OutLine s={s} atSec={T.broken} color={COLORS.red} bold>
                  ✗ CHAIN BROKEN at link 1 → 2
                </OutLine>
                <OutLine s={s} atSec={T.det1} color={COLORS.red} dim>
                  {`  expected ${EXPECTED_HASH}   found ${FOUND_HASH}`}
                </OutLine>
                <OutLine s={s} atSec={T.det2} color={COLORS.red} dim>
                  {"  delta: rows -22 · views -24,889"}
                </OutLine>
              </>
            )}
          </div>
        </Terminal>
      </div>

      {/* --- Red edge-glow pulse on chain break --- */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: `inset 0 0 ${130 * s}px rgba(248,113,113,${0.45 * edgeGlow})`,
        }}
      />

      {/* --- Closing card --- */}
      <AbsoluteFill
        style={{
          background: "rgba(11,15,20,0.94)",
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 28 * s,
          opacity: closeO,
          padding: `0 ${60 * s}px`,
        }}
      >
        <div style={{ transform: `translateY(${closeY}px)` }}>
          <Headline s={s} size={vertical ? 76 : 64} color={COLORS.green}>
            Continuity you can prove.
          </Headline>
        </div>
        <div
          style={{
            transform: `translateY(${closeY}px)`,
            fontFamily: FONT.mono,
            fontSize: 27 * s,
            color: COLORS.dim,
          }}
        >
          open source · works with any pipeline
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
