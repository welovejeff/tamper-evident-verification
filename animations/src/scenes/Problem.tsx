// Animation 1: THE PROBLEM
// A social team downloads their TikTok performance xlsx, vibe-codes a report
// dashboard, and the dashboard hallucinates outcomes — inflated views, dropped
// rows — with no verification layer to catch it.
// Renders responsively in both 960x540@15fps and 1080x1920@30fps.
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, scaleOf, isVertical } from "../theme";
import { Headline, LinkArrow, Reveal, StageCard } from "../components";

export const PROBLEM_DURATION_SEC = 16;

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// Deterministic digit scramble — derived from the frame number so renders are
// pure (Math.random would break Remotion's frame-independent rendering).
const scrambleDigits = (
  template: string,
  frame: number,
  salt: number,
): string =>
  template
    .split("")
    .map((ch, i) => {
      if (ch < "0" || ch > "9") return ch;
      const n =
        Math.abs(Math.sin(frame * 12.9898 + i * 78.233 + salt * 37.719)) * 10;
      return String(Math.floor(n) % 10);
    })
    .join("");

// Crossfading headline pinned in a fixed-height slot so swaps don't reflow.
const FadeHeadline: React.FC<{
  s: number;
  inSec: number;
  outSec?: number;
  size: number;
  color?: string;
  children: React.ReactNode;
}> = ({ s, inSec, outSec, size, color, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = interpolate(
    frame,
    [inSec * fps, (inSec + 0.4) * fps],
    [0, 1],
    CLAMP,
  );
  const fadeOut =
    outSec === undefined
      ? 1
      : interpolate(frame, [outSec * fps, (outSec + 0.4) * fps], [1, 0], CLAMP);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${48 * s}px`,
        opacity: fadeIn * fadeOut,
      }}
    >
      <Headline s={s} size={size} color={color}>
        {children}
      </Headline>
    </div>
  );
};

// Floating red "?" that hovers over a chain link once trust is gone.
const QMark: React.FC<{ s: number; startSec: number; idx: number }> = ({
  s,
  startSec,
  idx,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = interpolate(
    frame,
    [startSec * fps, (startSec + 0.5) * fps],
    [0, 1],
    CLAMP,
  );
  const float = Math.sin((frame / fps) * 3 + idx * 1.9) * 7 * s;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: `translate(-50%, calc(-50% + ${float}px)) scale(${
          0.6 + 0.4 * appear
        })`,
        opacity: appear,
        color: COLORS.red,
        fontFamily: FONT.mono,
        fontWeight: 700,
        fontSize: 56 * s,
        textShadow: `0 0 ${18 * s}px ${COLORS.red}aa`,
      }}
    >
      ?
    </div>
  );
};

// The dashboard's numbers: views hallucinate upward and settle wrong; rows
// silently vanish. The team reports numbers that were never in the export.
const DashboardReadout: React.FC<{ s: number }> = ({ s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const valueGlitching = sec >= 7.5 && sec < 9.0;
  const valueSettled = sec >= 9.0;
  const value = valueGlitching
    ? scrambleDigits("1,284,003", frame, 1)
    : valueSettled
      ? "1,309,114"
      : "1,284,003";
  const flicker = Math.sin(frame * 1.7) > 0;
  const valueColor = valueSettled
    ? COLORS.red
    : valueGlitching
      ? flicker
        ? COLORS.red
        : COLORS.amber
      : COLORS.green;

  const rowsGlitching = sec >= 9.2 && sec < 9.7;
  const rowsSettled = sec >= 9.7;
  const rows = rowsGlitching
    ? scrambleDigits("48,212", frame, 2)
    : rowsSettled
      ? "48,190"
      : "48,212";
  const rowsColor = rowsGlitching || rowsSettled ? COLORS.red : COLORS.dim;
  // Brief red flash behind the readout as the rows silently vanish.
  const flash = interpolate(sec, [9.15, 9.3, 9.9], [0, 0.35, 0], CLAMP);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6 * s,
        marginTop: 4 * s,
        padding: `${6 * s}px ${16 * s}px`,
        borderRadius: 10 * s,
        background: `rgba(248,113,113,${flash})`,
      }}
    >
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 36 * s,
          fontWeight: 700,
          color: valueColor,
          textShadow:
            valueGlitching || valueSettled
              ? `0 0 ${14 * s}px ${COLORS.red}66`
              : undefined,
        }}
      >
        {value}
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: 19 * s, color: COLORS.dim }}>
        views
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: 22 * s, color: rowsColor }}>
        {rows} rows
      </div>
    </div>
  );
};

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = scaleOf(width, height);
  const vertical = isVertical(width, height);
  const t = (sec: number): number => sec * fps;
  const sec = frame / fps;

  // After 10s the whole chain dims — trust has evaporated.
  const dim = interpolate(frame, [t(10), t(11)], [1, 0.3], CLAMP);
  const cardW = vertical ? 430 : 250;
  const arrowLen = vertical ? 56 : 70;
  const glitchActive = sec >= 7.5 && sec < 10;

  const arrowWrap = (startSec: number, idx: number): React.ReactNode => (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ opacity: dim }}>
        <LinkArrow
          s={s}
          startFrame={t(startSec)}
          vertical={vertical}
          length={arrowLen}
        />
      </div>
      <QMark s={s} startSec={10.3 + idx * 0.25} idx={idx} />
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        flexDirection: "column",
        alignItems: "center",
        // Center the whole stack so the 16:9 GIF doesn't pool empty space at
        // the bottom; the vertical comp keeps its larger top margins.
        justifyContent: vertical ? "flex-start" : "center",
        fontFamily: FONT.sans,
      }}
    >
      {/* Headline slot: three crossfading beats. */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: vertical ? 340 * s : 120 * s,
          marginTop: vertical ? 130 * s : 30 * s,
          flexShrink: 0,
        }}
      >
        <FadeHeadline s={s} inSec={0} outSec={2.4} size={vertical ? 76 : 54}>
          You exported your TikTok data.
        </FadeHeadline>
        <FadeHeadline s={s} inSec={2.6} outSec={9.7} size={vertical ? 76 : 54}>
          Then you vibe-coded a dashboard.
        </FadeHeadline>
        <FadeHeadline s={s} inSec={10} size={vertical ? 68 : 48}>
          It hallucinated the numbers.
          {vertical ? <br /> : " "}
          <span style={{ color: COLORS.red }}>And nothing caught it.</span>
        </FadeHeadline>
      </div>

      {/* The pipeline chain: export → clean.py → aggregate.py → dashboard. */}
      <div
        style={{
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          marginTop: vertical ? 60 * s : 36 * s,
        }}
      >
        <div style={{ opacity: dim }}>
          <Reveal startFrame={t(0.5)}>
            <StageCard
              s={s}
              icon="📊"
              label="tiktok.xlsx"
              sub="48,212 rows"
              width={cardW}
            />
          </Reveal>
        </div>

        {arrowWrap(2.8, 0)}

        <div style={{ opacity: dim }}>
          <Reveal startFrame={t(3.1)}>
            <StageCard
              s={s}
              icon="⚡"
              label="clean.py"
              sub="// generated by AI"
              accent={COLORS.violet}
              highlight
              width={cardW}
            />
          </Reveal>
        </div>

        {arrowWrap(3.9, 1)}

        <div style={{ opacity: dim }}>
          <Reveal startFrame={t(4.3)}>
            <StageCard
              s={s}
              icon="⚡"
              label="report.py"
              sub="// generated by AI"
              accent={COLORS.violet}
              highlight
              width={cardW}
            />
          </Reveal>
        </div>

        {arrowWrap(6.0, 2)}

        <div style={{ opacity: dim }}>
          <Reveal startFrame={t(6.4)}>
            <StageCard
              s={s}
              icon="📈"
              label="dashboard"
              accent={COLORS.red}
              highlight={glitchActive}
              width={cardW}
            >
              <DashboardReadout s={s} />
            </StageCard>
          </Reveal>
        </div>
      </div>

      {/* Closing beat: tease animation 2. */}
      <Reveal
        startFrame={t(14)}
        from="up"
        style={{ marginTop: vertical ? 90 * s : 40 * s }}
      >
        <Headline s={s} size={vertical ? 60 : 44} color={COLORS.green}>
          There&rsquo;s a better way →
        </Headline>
      </Reveal>
    </AbsoluteFill>
  );
};
