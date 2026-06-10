// UI Animation: THE ENFORCED DATA TAB
// Install the verification layer and your dashboard grows a second tab that is
// always the raw, verified table behind the charts. Light host dashboard →
// cabinet-open flip to the dark Data tab → green state → tamper → red state →
// closing line. Renders at 960x540@15fps; all timing from fps, all sizing
// from scaleOf(). No Math.random / Date.now — everything frame-derived.

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  interpolateColors,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, scaleOf, shortHash } from "../../theme";
import { HashChip } from "../../components";

export const DATA_TAB_DURATION_SEC = 14;

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// --- Beat timings in SECONDS (converted to frames via fps at render time) ----
const T = {
  // Beat 1: host dashboard builds in (light)
  header: 0.1,
  card0: 0.3,
  chart: 0.8,
  note: 1.0,
  // Beat 2: THE FLIP — Data tab activates, the whole surface goes dark
  flip: 2.0,
  flipEnd: 2.9,
  // Beat 3: GREEN state
  strip: 3.1,
  chips: 3.6,
  table: 4.2,
  rows: 4.5,
  totals: 6.2,
  meta: 6.5,
  // Beat 4: tamper
  glitchStart: 7.0,
  glitchEnd: 7.85,
  // Beat 5: RED state
  red: 8.0,
  banner: 8.4,
  // Beat 6: closing
  close: 12.5,
} as const;

// --- Host (vibe-coded dashboard) palette — light side only, local on purpose.
const HOST = {
  bg: "#f4f6fa",
  card: "#ffffff",
  ink: "#1d2939",
  sub: "#5b6575",
  accent: "#6366f1",
  accentSoft: "#818cf8",
  border: "#e4e8f0",
  up: "#12805c",
} as const;

// Deterministic digit scramble — derived from the frame number so renders are
// pure (same approach as Problem.tsx; Math.random would break Remotion).
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

// Fake-but-plausible rows behind "TikTok Performance" (max 8 for legibility).
const ROWS: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ["2026-05-25", "vid_8f31a2", "38,412", "2,981", "304"],
  ["2026-05-26", "vid_c07d44", "51,209", "4,118", "522"],
  ["2026-05-27", "vid_2be9f0", "24,887", "1,902", "188"],
  ["2026-05-28", "vid_77aa13", "94,310", "8,442", "1,206"],
  ["2026-05-29", "vid_d1c58e", "33,704", "2,610", "297"],
  ["2026-05-30", "vid_4e92b7", "67,118", "5,873", "740"],
  ["2026-05-31", "vid_a85c20", "29,455", "2,144", "231"],
  ["2026-06-01", "vid_f63d09", "112,940", "10,386", "1,684"],
];

const BAR_HEIGHTS = [34, 45, 22, 83, 30, 59, 26, 100, 40, 52, 19, 68, 44, 78, 56];

const SRC_HASH = shortHash("tiktok.xlsx");
const STAGE1_HASH = shortHash("clean_rows.py");
const STAGE2_HASH = shortHash("aggregate.py");

export const DataTabScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = scaleOf(width, height);
  const f = (sec: number): number => sec * fps;

  // --- The flip: crossfade + slight vertical reveal, never a hard cut -------
  const dashO = interpolate(frame, [f(T.flip), f(T.flip + 0.5)], [1, 0], CLAMP);
  const dataO = interpolate(frame, [f(T.flip + 0.25), f(T.flipEnd)], [0, 1], CLAMP);
  const dataY = interpolate(
    frame,
    [f(T.flip + 0.25), f(T.flipEnd)],
    [34 * s, 0],
    CLAMP,
  );
  const flipRange: [number, number] = [f(T.flip), f(T.flipEnd)];
  const appBg = interpolateColors(frame, flipRange, [HOST.bg, COLORS.bg]);
  const chromeBorder = interpolateColors(frame, flipRange, [
    HOST.border,
    COLORS.panelBorder,
  ]);
  const inkCol = interpolateColors(frame, flipRange, [HOST.ink, COLORS.text]);
  const subCol = interpolateColors(frame, flipRange, [HOST.sub, COLORS.dim]);
  const dataTabBg = interpolateColors(frame, flipRange, [
    "rgba(17, 22, 29, 0)",
    "rgba(17, 22, 29, 1)",
  ]);
  const dataTabInk = interpolateColors(frame, flipRange, [
    HOST.sub,
    COLORS.text,
  ]);

  // --- Tamper + red state -----------------------------------------------------
  const glitching = frame >= f(T.glitchStart) && frame < f(T.glitchEnd);
  const tampered = frame >= f(T.glitchStart);
  const isRed = frame >= f(T.red);
  const viewsTotal = !tampered
    ? "1,284,003"
    : glitching
      ? scrambleDigits("1,284,003", frame, 3)
      : "1,259,114";
  const flicker = Math.sin(frame * 1.7) > 0;
  const glitchColor = glitching
    ? flicker
      ? COLORS.red
      : COLORS.amber
    : COLORS.red;
  // Brief red flash washing the data panel as the tamper lands.
  const flash = interpolate(
    frame,
    [f(T.glitchStart), f(T.glitchStart + 0.15), f(T.glitchStart + 0.5), f(T.glitchEnd + 0.3)],
    [0, 0.4, 0.15, 0],
    CLAMP,
  );
  const redP = interpolate(frame, [f(T.red), f(T.red + 0.4)], [0, 1], CLAMP);
  const viewsHeadCol = interpolateColors(
    frame,
    [f(T.red), f(T.red + 0.4)],
    [COLORS.dim, COLORS.red],
  );

  // --- Closing ------------------------------------------------------------------
  const closeP = interpolate(frame, [f(T.close), f(T.close + 0.6)], [0, 1], CLAMP);
  const closeLineO = interpolate(
    frame,
    [f(T.close + 0.25), f(T.close + 0.9)],
    [0, 1],
    CLAMP,
  );
  const closeLineY = interpolate(
    frame,
    [f(T.close + 0.25), f(T.close + 0.9)],
    [16 * s, 0],
    CLAMP,
  );

  // Fade/slide helper for staggered builds (deterministic, clamped).
  const rise = (atSec: number, dist = 22): React.CSSProperties => ({
    opacity: interpolate(frame, [f(atSec), f(atSec + 0.4)], [0, 1], CLAMP),
    transform: `translateY(${interpolate(
      frame,
      [f(atSec), f(atSec + 0.45)],
      [dist * s, 0],
      CLAMP,
    )}px)`,
  });

  // The tab-label dot: green from frame 0, flips red with the red state —
  // visible even from the tab bar, before you open the cabinet.
  const dotColor = isRed ? "#e5484d" : "#14b67e";
  const dotGlow = isRed
    ? `0 0 ${8 * s}px rgba(248,113,113,0.8)`
    : `0 0 ${6 * s}px rgba(52,211,153,0.7)`;

  // Status strip copy crossfade (green out, red in).
  const stripGreenO = interpolate(frame, [f(T.red), f(T.red + 0.35)], [1, 0], CLAMP);
  const stripRedO = interpolate(frame, [f(T.red + 0.1), f(T.red + 0.45)], [0, 1], CLAMP);

  // Meta line ↔ break banner share one fixed slot so the table never reflows.
  const metaO = interpolate(
    frame,
    [f(T.meta), f(T.meta + 0.4), f(T.red), f(T.red + 0.3)],
    [0, 1, 1, 0],
    CLAMP,
  );
  const bannerO = interpolate(frame, [f(T.banner), f(T.banner + 0.45)], [0, 1], CLAMP);
  const bannerY = interpolate(frame, [f(T.banner), f(T.banner + 0.45)], [10 * s, 0], CLAMP);

  // Red rails + tint on the views column.
  const viewsCellExtra: React.CSSProperties =
    redP > 0
      ? {
          background: `rgba(180, 35, 24, ${0.14 * redP})`,
          boxShadow: `inset ${2 * s}px 0 0 rgba(180,35,24,${0.55 * redP}), inset ${-2 * s}px 0 0 rgba(180,35,24,${0.55 * redP})`,
        }
      : {};

  const gridCols = `${172 * s}px ${196 * s}px 1fr 1fr 1fr`;
  const cellBase: React.CSSProperties = {
    padding: `${7 * s}px ${16 * s}px`,
    fontSize: 19 * s,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  return (
    <AbsoluteFill style={{ background: appBg, fontFamily: FONT.sans }}>
      {/* ===== App header ===== */}
      <div style={{ padding: `${20 * s}px ${32 * s}px 0`, ...rise(T.header) }}>
        <div
          style={{
            fontSize: 32 * s,
            fontWeight: 700,
            letterSpacing: -0.3 * s,
            color: inkCol,
          }}
        >
          TikTok Performance
        </div>
        <div style={{ fontSize: 18 * s, color: subCol, marginTop: 3 * s }}>
          creator analytics · last 15 days · built with v0 + Supabase
        </div>
      </div>

      {/* ===== Tab bar ===== */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8 * s,
          padding: `${12 * s}px ${32 * s}px 0`,
          borderBottom: `${1.5 * s}px solid ${chromeBorder}`,
          ...rise(T.header + 0.15),
        }}
      >
        {/* Host's own tab — active until the flip */}
        <div
          style={{
            fontSize: 21 * s,
            fontWeight: 600,
            color: dashO > 0.5 ? HOST.ink : subCol,
            background: `rgba(255,255,255,${0.95 * dashO})`,
            border: `${1 * s}px solid`,
            borderColor: dashO > 0.5 ? HOST.border : "transparent",
            borderBottom: "none",
            borderRadius: `${10 * s}px ${10 * s}px 0 0`,
            padding: `${9 * s}px ${24 * s}px ${10 * s}px`,
          }}
        >
          Dashboard
        </div>

        {/* The foreign tab we injected — mono, dark, dotted with state */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8 * s,
            fontFamily: FONT.mono,
            fontSize: 20 * s,
            fontWeight: 500,
            color: dataTabInk,
            background: dataTabBg,
            border: `${1 * s}px solid`,
            borderColor: dataO > 0.3 ? COLORS.panelBorder : "transparent",
            borderBottom: "none",
            borderRadius: `${10 * s}px ${10 * s}px 0 0`,
            padding: `${9 * s}px ${20 * s}px ${10 * s}px`,
          }}
        >
          <span
            style={{
              width: 9 * s,
              height: 9 * s,
              borderRadius: "50%",
              background: dotColor,
              boxShadow: dotGlow,
              flexShrink: 0,
            }}
          />
          🧾 Data
        </div>

        {/* Caption-ish mono note near the tab */}
        <div
          style={{
            marginLeft: "auto",
            fontFamily: FONT.mono,
            fontSize: 16 * s,
            color: subCol,
            paddingBottom: 10 * s,
            opacity: 0.85,
            ...rise(T.note, 10),
          }}
        >
          installed by tamper-signal
        </div>
      </div>

      {/* ===== Panel area (both panels stacked; flip crossfades them) ===== */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* ---------- HOST DASHBOARD (light) ---------- */}
        <AbsoluteFill
          style={{
            padding: `${20 * s}px ${32 * s}px`,
            opacity: dashO,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16 * s,
              marginBottom: 16 * s,
            }}
          >
            {(
              [
                ["Total Views", "1.28M", "▲ 12.4% vs prior 15d"],
                ["Likes", "104.6K", "▲ 8.1%"],
                ["Shares", "12.9K", "▲ 15.7%"],
              ] as const
            ).map(([k, v, t], i) => (
              <div
                key={k}
                style={{
                  background: HOST.card,
                  border: `${1 * s}px solid ${HOST.border}`,
                  borderRadius: 12 * s,
                  padding: `${14 * s}px ${18 * s}px`,
                  boxShadow: `0 ${1 * s}px ${2 * s}px rgba(16,24,40,0.05)`,
                  ...rise(T.card0 + i * 0.15),
                }}
              >
                <div style={{ fontSize: 17 * s, color: HOST.sub, fontWeight: 600 }}>
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 34 * s,
                    fontWeight: 800,
                    letterSpacing: -0.5 * s,
                    color: HOST.ink,
                    marginTop: 3 * s,
                  }}
                >
                  {v}
                </div>
                <div
                  style={{
                    fontSize: 15 * s,
                    fontWeight: 600,
                    color: HOST.up,
                    marginTop: 5 * s,
                  }}
                >
                  {t}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: HOST.card,
              border: `${1 * s}px solid ${HOST.border}`,
              borderRadius: 12 * s,
              padding: `${16 * s}px ${18 * s}px ${10 * s}px`,
              boxShadow: `0 ${1 * s}px ${2 * s}px rgba(16,24,40,0.05)`,
              ...rise(T.chart),
            }}
          >
            <div style={{ fontSize: 20 * s, fontWeight: 700, color: HOST.ink }}>
              Daily Views
            </div>
            <div style={{ fontSize: 15 * s, color: HOST.sub, marginBottom: 12 * s }}>
              May 25 – Jun 8, 2026
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 8 * s,
                height: 170 * s,
                borderBottom: `${1 * s}px solid ${HOST.border}`,
                padding: `0 ${4 * s}px`,
              }}
            >
              {BAR_HEIGHTS.map((h, i) => {
                const grow = interpolate(
                  frame,
                  [f(0.9 + i * 0.05), f(1.45 + i * 0.05)],
                  [0, 1],
                  CLAMP,
                );
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: `${h * grow}%`,
                      borderRadius: `${4 * s}px ${4 * s}px 0 0`,
                      background: `linear-gradient(180deg, ${HOST.accentSoft}, ${HOST.accent})`,
                    }}
                  />
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13 * s,
                color: HOST.sub,
                padding: `${6 * s}px ${4 * s}px 0`,
              }}
            >
              <span>May 25</span>
              <span>May 29</span>
              <span>Jun 2</span>
              <span>Jun 5</span>
              <span>Jun 8</span>
            </div>
          </div>
        </AbsoluteFill>

        {/* ---------- DATA TAB (ours, dark) ---------- */}
        <AbsoluteFill
          style={{
            padding: `${16 * s}px ${32 * s}px`,
            opacity: dataO,
            transform: `translateY(${dataY}px)`,
            fontFamily: FONT.mono,
            color: COLORS.text,
            display: "flex",
            flexDirection: "column",
            gap: 12 * s,
            pointerEvents: "none",
          }}
        >
          {/* (a) verification status strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18 * s,
              background: COLORS.panel,
              border: `${1.5 * s}px solid ${COLORS.panelBorder}`,
              borderRadius: 12 * s,
              padding: `${12 * s}px ${20 * s}px`,
              ...rise(T.strip),
            }}
          >
            {/* traffic lamps */}
            <div
              style={{
                display: "flex",
                gap: 8 * s,
                flexShrink: 0,
                padding: `${7 * s}px ${10 * s}px`,
                background: COLORS.chrome,
                border: `${1 * s}px solid ${COLORS.panelBorder}`,
                borderRadius: 999,
              }}
            >
              {(["red", "amber", "green"] as const).map((lamp) => {
                const lit =
                  (lamp === "green" && !isRed) || (lamp === "red" && isRed);
                const c =
                  lamp === "red"
                    ? COLORS.red
                    : lamp === "amber"
                      ? COLORS.amber
                      : COLORS.green;
                return (
                  <span
                    key={lamp}
                    style={{
                      width: 15 * s,
                      height: 15 * s,
                      borderRadius: "50%",
                      background: lit ? c : COLORS.faint,
                      boxShadow: lit ? `0 0 ${10 * s}px ${c}cc` : undefined,
                    }}
                  />
                );
              })}
            </div>

            {/* state copy — green and red stacked, crossfading */}
            <div style={{ position: "relative", flex: 1, height: 56 * s }}>
              <div style={{ position: "absolute", inset: 0, opacity: stripGreenO }}>
                <div
                  style={{
                    fontSize: 24 * s,
                    fontWeight: 700,
                    color: COLORS.green,
                  }}
                >
                  The light is green, the data is clean.
                </div>
                <div style={{ fontSize: 17 * s, color: COLORS.dim, marginTop: 6 * s }}>
                  3 of 3 receipts verified · hash chain intact · ed25519 signatures valid
                </div>
              </div>
              <div style={{ position: "absolute", inset: 0, opacity: stripRedO }}>
                <div
                  style={{ fontSize: 24 * s, fontWeight: 700, color: COLORS.red }}
                >
                  The light is red, the chain is broken.
                </div>
                <div style={{ fontSize: 17 * s, color: COLORS.dim, marginTop: 6 * s }}>
                  hash chain breaks after stage 1 · control total mismatch on{" "}
                  <span style={{ color: COLORS.red }}>views</span> · do not present this dashboard
                </div>
              </div>
            </div>
          </div>

          {/* meta line ↔ break banner: one fixed slot, no reflow */}
          <div style={{ position: "relative", height: 52 * s, flexShrink: 0 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                fontSize: 17 * s,
                color: COLORS.dim,
                opacity: metaO,
              }}
            >
              showing 8 of 14,892 filtered rows · source 48,212 · totals computed over the full verified set
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                gap: 10 * s,
                border: `${1.5 * s}px solid ${COLORS.redDeep}`,
                background: "rgba(180, 35, 24, 0.13)",
                borderRadius: 10 * s,
                padding: `0 ${16 * s}px`,
                fontSize: 17.5 * s,
                color: "#fecaca",
                whiteSpace: "nowrap",
                opacity: bannerO,
                transform: `translateY(${bannerY}px)`,
              }}
            >
              <span style={{ color: COLORS.red, fontWeight: 700 }}>
                BREAK · views
              </span>
              <span>
                expected 1,284,003 · found 1,259,114 · Δ{" "}
                <span style={{ color: COLORS.red, fontWeight: 700 }}>−24,889</span>{" "}
                · rows <span style={{ color: COLORS.red, fontWeight: 700 }}>−22</span>{" "}
                · broke after stage 1
              </span>
            </div>
          </div>

          {/* (c) provenance chips */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9 * s,
              whiteSpace: "nowrap",
              ...rise(T.chips),
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8 * s,
                background: COLORS.panel,
                border: `${1 * s}px solid ${COLORS.panelBorder}`,
                borderRadius: 8 * s,
                padding: `${6 * s}px ${12 * s}px`,
                fontSize: 17 * s,
              }}
            >
              📄 tiktok.xlsx <span style={{ color: COLORS.dim }}>· 48,212 rows ·</span>{" "}
              <HashChip s={s * 0.65} text={SRC_HASH} />{" "}
              <span style={{ color: COLORS.green }}>✓</span>
            </span>
            <span style={{ color: COLORS.faint, fontSize: 18 * s }}>→</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8 * s,
                background: COLORS.panel,
                border: `${1 * s}px solid ${COLORS.panelBorder}`,
                borderRadius: 8 * s,
                padding: `${6 * s}px ${12 * s}px`,
                fontSize: 17 * s,
              }}
            >
              <span style={{ color: COLORS.dim }}>stage 1</span> clean_rows.py{" "}
              <span style={{ color: COLORS.cyan }}>{STAGE1_HASH}</span>{" "}
              <span style={{ color: COLORS.green }}>✓</span>
            </span>
            <span style={{ color: COLORS.faint, fontSize: 18 * s }}>→</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8 * s,
                background: COLORS.panel,
                border: `${1 * s}px solid ${isRed ? COLORS.redDeep : COLORS.panelBorder}`,
                borderRadius: 8 * s,
                padding: `${6 * s}px ${12 * s}px`,
                fontSize: 17 * s,
              }}
            >
              <span style={{ color: COLORS.dim }}>stage 2</span> aggregate.py{" "}
              <span style={{ color: COLORS.cyan }}>{STAGE2_HASH}</span>{" "}
              {isRed ? (
                <span style={{ color: COLORS.red, fontWeight: 700 }}>✗ mismatch</span>
              ) : (
                <span style={{ color: COLORS.green }}>✓</span>
              )}
            </span>
            <span style={{ color: COLORS.faint, fontSize: 18 * s }}>→</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8 * s,
                background: COLORS.panel,
                border: `${1 * s}px solid ${isRed ? COLORS.redDeep : COLORS.greenDeep}`,
                borderRadius: 8 * s,
                padding: `${6 * s}px ${12 * s}px`,
                fontSize: 17 * s,
              }}
            >
              🧾 <span style={{ color: COLORS.dim }}>receipt</span>{" "}
              {isRed ? (
                <span style={{ color: COLORS.red, fontWeight: 700 }}>✗ chain broken</span>
              ) : (
                <span style={{ color: COLORS.green }}>signed · ed25519</span>
              )}
            </span>
          </div>

          {/* (b) raw data table — this table IS the chart */}
          <div
            style={{
              position: "relative",
              border: `${1.5 * s}px solid ${COLORS.panelBorder}`,
              borderRadius: 10 * s,
              overflow: "hidden",
              background: COLORS.panel,
              ...rise(T.table),
            }}
          >
            {/* header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                background: COLORS.chrome,
                borderBottom: `${1 * s}px solid ${COLORS.panelBorder}`,
              }}
            >
              {(["date", "video id", "views", "likes", "shares"] as const).map(
                (h, i) => (
                  <div
                    key={h}
                    style={{
                      ...cellBase,
                      fontSize: 15 * s,
                      letterSpacing: 0.8 * s,
                      textTransform: "uppercase",
                      fontWeight: 600,
                      color: h === "views" ? viewsHeadCol : COLORS.dim,
                      textAlign: i < 2 ? "left" : "right",
                      ...(h === "views" ? viewsCellExtra : {}),
                    }}
                  >
                    {h}
                  </div>
                ),
              )}
            </div>

            {/* body rows, staggered in */}
            {ROWS.map(([date, vid, views, likes, shares], r) => {
              const rowIn = rise(T.rows + r * 0.17, 10);
              return (
                <div
                  key={vid}
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    borderBottom: `${1 * s}px solid ${COLORS.chrome}`,
                    ...rowIn,
                  }}
                >
                  <div style={{ ...cellBase, textAlign: "left", color: COLORS.dim }}>
                    {date}
                  </div>
                  <div
                    style={{ ...cellBase, textAlign: "left", color: COLORS.violet }}
                  >
                    {vid}
                  </div>
                  <div style={{ ...cellBase, ...viewsCellExtra }}>{views}</div>
                  <div style={cellBase}>{likes}</div>
                  <div style={cellBase}>{shares}</div>
                </div>
              );
            })}

            {/* pinned totals row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                background: COLORS.chrome,
                borderTop: `${2 * s}px solid ${COLORS.panelBorder}`,
                fontWeight: 700,
                ...rise(T.totals, 8),
              }}
            >
              <div
                style={{
                  ...cellBase,
                  textAlign: "left",
                  color: COLORS.dim,
                  fontWeight: 600,
                  gridColumn: "span 2",
                }}
              >
                Σ totals{" "}
                <span style={{ color: COLORS.faint }}>(signed)</span>
              </div>
              <div
                style={{
                  ...cellBase,
                  color: tampered ? glitchColor : COLORS.text,
                  textShadow: glitching
                    ? `0 0 ${10 * s}px ${COLORS.red}aa`
                    : undefined,
                  ...viewsCellExtra,
                  ...(redP > 0
                    ? {
                        background: `linear-gradient(rgba(180,35,24,${0.32 * redP}), rgba(180,35,24,${0.32 * redP})), ${COLORS.chrome}`,
                      }
                    : {}),
                }}
              >
                {isRed ? (
                  <span
                    style={{
                      color: COLORS.dim,
                      fontWeight: 400,
                      fontSize: 15 * s,
                      textDecoration: "line-through",
                      marginRight: 8 * s,
                      opacity: redP,
                    }}
                  >
                    1,284,003
                  </span>
                ) : null}
                {viewsTotal}
                {!tampered ? (
                  <span style={{ color: COLORS.green, marginLeft: 6 * s }}>✓</span>
                ) : null}
              </div>
              <div style={cellBase}>
                104,557
                <span style={{ color: COLORS.green, marginLeft: 6 * s }}>✓</span>
              </div>
              <div style={cellBase}>
                12,940
                <span style={{ color: COLORS.green, marginLeft: 6 * s }}>✓</span>
              </div>
            </div>

            {/* tamper flash wash over the table */}
            <AbsoluteFill
              style={{
                background: `rgba(248,113,113,${0.18 * flash})`,
                pointerEvents: "none",
              }}
            />
          </div>
        </AbsoluteFill>
      </div>

      {/* ===== Tamper flash at the edges of the whole app ===== */}
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          boxShadow: `inset 0 0 ${110 * s}px rgba(248,113,113,${0.5 * flash})`,
        }}
      />

      {/* ===== Closing: dim + mono line bottom-center ===== */}
      <AbsoluteFill
        style={{
          background: `rgba(11,15,20,${0.82 * closeP})`,
          justifyContent: "flex-end",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 26 * s,
            color: COLORS.dim,
            marginBottom: 220 * s,
            opacity: closeLineO,
            transform: `translateY(${closeLineY}px)`,
            whiteSpace: "nowrap",
          }}
        >
          every chart shows its table ·{" "}
          <span style={{ color: COLORS.green }}>green light, open table</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
