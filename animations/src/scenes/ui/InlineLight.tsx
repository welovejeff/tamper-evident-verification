// UI Direction 01: THE INLINE STATUS LIGHT — a tiny dark verification
// instrument bolted into a pastel vibe-coded dashboard's header.
// Green → yellow → red, then the money shot: the instrument reaches into the
// host page and flags the metric fed by the broken stage.
//
// Renders in 960x540@15fps (GIF). All timing derives from fps (seconds * fps),
// all sizing from scaleOf(). No Math.random / Date.now anywhere.

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, scaleOf, shortHash } from "../../theme";
import { Reveal } from "../../components";

export const INLINE_LIGHT_DURATION_SEC = 14;

// --- Beat timings in SECONDS (converted to frames via fps at render time) ----
const T = {
  // Beat 0: host dashboard builds in, pill lands last
  hostIn: 0.1,
  cards: 0.35,
  chart: 0.75,
  pill: 1.1,
  // Beat 1: GREEN
  green: 1.5,
  popG: 1.9,
  popGClose: 4.5,
  // Beat 2: YELLOW (double pulse)
  yellow: 5.0,
  pulseY2: 5.7,
  popY: 5.4,
  popYClose: 7.5,
  // Beat 3: RED + money shot (host metric flagged)
  red: 8.0,
  popR: 8.4,
  popRClose: 12.3,
  // Beat 4: dim + closing caption
  dim: 12.5,
} as const;

const EXPECTED_HASH = shortHash("clean-out");
const FOUND_HASH = shortHash("tampered");

const CLAMP = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

// --- Host theme: deliberately NOT ours. Light, rounded, pastel. -------------
const HOST = {
  bg: "#f4f5f7",
  card: "#ffffff",
  ink: "#1f2430",
  inkSoft: "#6b7280",
  line: "#e6e8ee",
  accentTop: "#2dd4bf", // pastel teal
  accentBot: "#99e7dd",
  roseTop: "#fda4af", // pastel rose (one accent bar)
  roseBot: "#fecdd5",
  trendUp: "#0d9474",
  trendDown: "#d4536b",
} as const;

type LightState = "green" | "yellow" | "red";

const STATE_META: Record<
  LightState,
  { word: string; sub: string; color: string }
> = {
  green: { word: "VERIFIED", sub: " · chain intact", color: COLORS.green },
  yellow: { word: "CAVEAT", sub: " · coverage gap", color: COLORS.amber },
  red: { word: "BROKEN", sub: " · hash mismatch", color: COLORS.red },
};

// Deterministic bar heights (% of chart area), Mon–Sun, from the design HTML.
const BARS = [
  ["Mon", 42],
  ["Tue", 58],
  ["Wed", 50],
  ["Thu", 74],
  ["Fri", 66],
  ["Sat", 96],
  ["Sun", 81],
] as const;

export const InlineLightScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = scaleOf(width, height);
  const f = (sec: number): number => sec * fps;

  // --- Current light state -----------------------------------------------------
  const state: LightState =
    frame < f(T.yellow) ? "green" : frame < f(T.red) ? "yellow" : "red";
  const lit = frame >= f(T.green);
  const meta = STATE_META[state];
  const dotColor = lit ? meta.color : COLORS.faint;

  // --- Host build-in -------------------------------------------------------------
  const hostO = interpolate(frame, [f(T.hostIn), f(T.hostIn + 0.5)], [0, 1], CLAMP);

  // --- Pulse rings on the status dot (one div per deterministic event) ------------
  const rings: ReadonlyArray<{ at: number; dur: number; color: string }> = [
    { at: T.green, dur: 0.6, color: COLORS.green },
    { at: T.yellow, dur: 0.6, color: COLORS.amber }, // double pulse…
    { at: T.pulseY2, dur: 0.6, color: COLORS.amber }, // …second beat
    { at: T.red, dur: 0.45, color: COLORS.red }, // sharp single pulse
  ];

  // --- Popover open/close progress -------------------------------------------------
  const popP = (openSec: number, closeSec: number): number =>
    interpolate(
      frame,
      [f(openSec), f(openSec + 0.35), f(closeSec), f(closeSec + 0.35)],
      [0, 1, 1, 0],
      CLAMP,
    );
  const popGreen = popP(T.popG, T.popGClose);
  const popYellow = popP(T.popY, T.popYClose);
  const popRed = popP(T.popR, T.popRClose);

  // --- Money shot: host metric flipped + flagged at the red beat --------------------
  const tampered = frame >= f(T.red);
  const flagO = interpolate(frame, [f(T.red), f(T.red + 0.35)], [0, 1], CLAMP);
  const cardPop = interpolate(
    frame,
    [f(T.red), f(T.red + 0.15), f(T.red + 0.4)],
    [1, 1.04, 1],
    CLAMP,
  );

  // --- Closing dim + caption ----------------------------------------------------------
  const dimO = interpolate(frame, [f(T.dim), f(T.dim + 0.5)], [0, 0.5], CLAMP);
  const capO = interpolate(frame, [f(T.dim + 0.15), f(T.dim + 0.65)], [0, 1], CLAMP);
  const capY = interpolate(frame, [f(T.dim + 0.15), f(T.dim + 0.65)], [20 * s, 0], CLAMP);

  // Header geometry (design units * s). The pill is its own absolute layer so it
  // stays above the closing dim — the instrument never goes dark.
  const headerH = 100 * s;
  const pad = 48 * s;

  // --- Metric cards (host data; views card is the one fed by the broken stage) -------
  const metrics = [
    {
      label: "Total Views",
      value: tampered ? "1.26M" : "1.28M",
      trend: tampered ? "▲ 11.4% vs last week" : "▲ 12.4% vs last week",
      trendColor: HOST.trendUp,
      suspect: true,
    },
    {
      label: "Likes",
      value: "104.6K",
      trend: "▲ 3.1%",
      trendColor: HOST.trendUp,
      suspect: false,
    },
    {
      label: "Shares",
      value: "12.9K",
      trend: "▼ 0.8%",
      trendColor: HOST.trendDown,
      suspect: false,
    },
  ];

  // --- Popover body per state ------------------------------------------------------------
  const popDetail: React.CSSProperties = {
    fontFamily: FONT.mono,
    fontSize: 21 * s,
    lineHeight: 1.55,
    color: COLORS.dim,
  };

  const renderPopover = (
    p: number,
    verdict: string,
    verdictColor: string,
    children: React.ReactNode,
  ): React.ReactNode => {
    if (p <= 0) {
      return null;
    }
    return (
      <div
        style={{
          position: "absolute",
          top: 70 * s,
          right: 0,
          width: 560 * s,
          background: COLORS.panel,
          border: `${1.5 * s}px solid ${COLORS.panelBorder}`,
          borderRadius: 14 * s,
          boxShadow: `0 ${20 * s}px ${56 * s}px rgba(4,8,14,0.45)`,
          opacity: p,
          transform: `scale(${0.92 + 0.08 * p}) translateY(${(1 - p) * -10 * s}px)`,
          transformOrigin: "top right",
          overflow: "hidden",
        }}
      >
        {/* anchor notch */}
        <div
          style={{
            position: "absolute",
            top: -7 * s,
            right: 34 * s,
            width: 13 * s,
            height: 13 * s,
            background: COLORS.chrome,
            borderLeft: `${1.5 * s}px solid ${COLORS.panelBorder}`,
            borderTop: `${1.5 * s}px solid ${COLORS.panelBorder}`,
            transform: "rotate(45deg)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12 * s,
            background: COLORS.chrome,
            borderBottom: `${1.5 * s}px solid ${COLORS.panelBorder}`,
            padding: `${12 * s}px ${20 * s}px`,
            fontFamily: FONT.mono,
            fontSize: 18 * s,
          }}
        >
          <span style={{ color: COLORS.dim, letterSpacing: 1.5 * s }}>LINEAGE</span>
          <span style={{ color: verdictColor, fontWeight: 700 }}>{verdict}</span>
        </div>
        <div style={{ padding: `${16 * s}px ${20 * s}px ${18 * s}px` }}>{children}</div>
      </div>
    );
  };

  return (
    <AbsoluteFill style={{ background: HOST.bg, fontFamily: FONT.sans }}>
      {/* ════════ FAKE HOST APP (someone else's pastel dashboard) ════════ */}
      <div style={{ opacity: hostO, position: "absolute", inset: 0 }}>
        {/* --- host header bar --- */}
        <div
          style={{
            height: headerH,
            background: HOST.card,
            borderBottom: `${1.5 * s}px solid ${HOST.line}`,
            display: "flex",
            alignItems: "center",
            gap: 16 * s,
            padding: `0 ${pad}px`,
          }}
        >
          <div
            style={{
              width: 40 * s,
              height: 40 * s,
              borderRadius: 12 * s,
              background: `linear-gradient(135deg, ${HOST.accentTop}, ${HOST.roseTop})`,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 28 * s, fontWeight: 700, color: HOST.ink, letterSpacing: -0.4 * s }}>
            TikTok Performance
            <span style={{ fontWeight: 400, color: HOST.inkSoft }}> · creator analytics</span>
          </div>
          {/* fake date-range chip; right margin reserves the pill's slot */}
          <div
            style={{
              marginLeft: "auto",
              marginRight: 420 * s,
              fontSize: 20 * s,
              color: HOST.inkSoft,
              border: `${1.5 * s}px solid ${HOST.line}`,
              borderRadius: 10 * s,
              padding: `${8 * s}px ${14 * s}px`,
            }}
          >
            Last 7 days ▾
          </div>
        </div>

        {/* --- host main: metric cards + chart --- */}
        <div style={{ padding: pad }}>
          <div style={{ display: "flex", gap: 28 * s, marginBottom: 28 * s }}>
            {metrics.map((m, i) => {
              const isSuspect = m.suspect && tampered;
              return (
                <Reveal key={m.label} startFrame={f(T.cards + i * 0.15)} from="up" style={{ flex: 1 }}>
                  <div
                    style={{
                      background: HOST.card,
                      border: `${2 * s}px solid ${isSuspect ? COLORS.red : HOST.line}`,
                      borderRadius: 22 * s,
                      padding: `${24 * s}px ${30 * s}px`,
                      boxShadow: isSuspect
                        ? `0 0 0 ${5 * s}px rgba(248,113,113,${0.18 * flagO})`
                        : undefined,
                      transform: m.suspect ? `scale(${cardPop})` : undefined,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 18 * s,
                        fontWeight: 600,
                        color: HOST.inkSoft,
                        textTransform: "uppercase",
                        letterSpacing: 0.8 * s,
                        marginBottom: 8 * s,
                      }}
                    >
                      {m.label}
                    </div>
                    <div
                      style={{
                        fontSize: 46 * s,
                        fontWeight: 700,
                        letterSpacing: -1 * s,
                        color: isSuspect ? COLORS.redDeep : HOST.ink,
                      }}
                    >
                      {m.value}
                    </div>
                    <div style={{ fontSize: 18 * s, marginTop: 6 * s, color: m.trendColor }}>
                      {m.trend}
                    </div>
                    {m.suspect ? (
                      <div
                        style={{
                          fontFamily: FONT.mono,
                          fontSize: 18 * s,
                          color: COLORS.red,
                          marginTop: 8 * s,
                          opacity: flagO,
                        }}
                      >
                        ⚠ lineage: unverified value
                      </div>
                    ) : null}
                  </div>
                </Reveal>
              );
            })}
          </div>

          {/* --- CSS-bar chart panel --- */}
          <Reveal startFrame={f(T.chart)} from="up">
            <div
              style={{
                background: HOST.card,
                border: `${1.5 * s}px solid ${HOST.line}`,
                borderRadius: 22 * s,
                padding: `${24 * s}px ${30 * s}px`,
              }}
            >
              <div style={{ fontSize: 22 * s, fontWeight: 600, color: HOST.ink, marginBottom: 16 * s }}>
                Views by day
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 18 * s,
                  height: 330 * s,
                }}
              >
                {BARS.map(([day, pct], i) => {
                  const grow = interpolate(
                    frame,
                    [f(0.9 + i * 0.06), f(1.3 + i * 0.06)],
                    [0, 1],
                    CLAMP,
                  );
                  const rose = i === 5;
                  return (
                    <div
                      key={day}
                      style={{
                        flex: 1,
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        gap: 8 * s,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: `${pct * grow * 0.88}%`,
                          minHeight: 4 * s,
                          borderRadius: `${8 * s}px ${8 * s}px ${4 * s}px ${4 * s}px`,
                          background: rose
                            ? `linear-gradient(180deg, ${HOST.roseTop}, ${HOST.roseBot})`
                            : `linear-gradient(180deg, ${HOST.accentTop}, ${HOST.accentBot})`,
                        }}
                      />
                      <span style={{ fontSize: 18 * s, color: HOST.inkSoft }}>{day}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      {/* ════════ closing dim — sits BELOW the instrument layer ════════ */}
      <AbsoluteFill style={{ background: `rgba(23,28,38,${dimO})`, pointerEvents: "none" }} />

      {/* ════════ OUR INSTRUMENT: the inline status light (only dark element) ════════ */}
      <div style={{ position: "absolute", top: 24 * s, right: pad }}>
        <Reveal startFrame={f(T.pill)} from="down">
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12 * s,
              background: COLORS.bg,
              border: `${1.5 * s}px solid ${COLORS.panelBorder}`,
              borderRadius: 999,
              padding: `${12 * s}px ${22 * s}px ${12 * s}px ${16 * s}px`,
              fontFamily: FONT.mono,
              fontSize: 22 * s,
              letterSpacing: 0.4 * s,
              whiteSpace: "nowrap",
              boxShadow: `0 ${8 * s}px ${28 * s}px rgba(4,8,14,0.35)`,
            }}
          >
            {/* status dot + deterministic pulse rings */}
            <div style={{ position: "relative", width: 16 * s, height: 16 * s, flexShrink: 0 }}>
              {rings.map(({ at, dur, color }) => {
                const p = interpolate(frame, [f(at), f(at + dur)], [0, 1], CLAMP);
                if (p <= 0 || p >= 1) {
                  return null;
                }
                return (
                  <div
                    key={at}
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: `${2 * s}px solid ${color}`,
                      opacity: 1 - p,
                      transform: `scale(${1 + 2.4 * p})`,
                    }}
                  />
                );
              })}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  background: dotColor,
                  boxShadow: lit ? `0 0 ${10 * s}px ${dotColor}cc` : undefined,
                }}
              />
            </div>
            <span>
              <span style={{ color: lit ? meta.color : COLORS.dim, fontWeight: 700 }}>
                {lit ? meta.word : "LINEAGE"}
              </span>
              <span style={{ color: COLORS.dim }}>{lit ? meta.sub : " · verifying"}</span>
            </span>
            <span style={{ color: COLORS.faint, fontSize: 18 * s }}>▸</span>
          </div>
        </Reveal>

        {/* --- GREEN popover --- */}
        {renderPopover(
          popGreen,
          "CHAIN VERIFIED",
          COLORS.green,
          <>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 24 * s,
                fontWeight: 700,
                color: COLORS.green,
                marginBottom: 10 * s,
              }}
            >
              The light is green, the data is clean.
            </div>
            <div style={popDetail}>3 receipts · 2 transforms · signatures valid ed25519</div>
          </>,
        )}

        {/* --- YELLOW popover --- */}
        {renderPopover(
          popYellow,
          "VERIFIED WITH CAVEATS",
          COLORS.amber,
          <>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 24 * s,
                fontWeight: 700,
                color: COLORS.amber,
                marginBottom: 10 * s,
              }}
            >
              The light is yellow, a human should look.
            </div>
            <div style={popDetail}>⚠ stage 2 emitted no receipt</div>
          </>,
        )}

        {/* --- RED popover --- */}
        {renderPopover(
          popRed,
          "CHAIN BROKEN",
          COLORS.red,
          <>
            <div
              style={{
                fontFamily: FONT.mono,
                fontSize: 24 * s,
                fontWeight: 700,
                color: COLORS.red,
                marginBottom: 10 * s,
              }}
            >
              The light is red, the chain is broken.
            </div>
            <div style={popDetail}>
              expected <span style={{ color: COLORS.cyan }}>{EXPECTED_HASH}</span>
              {"   found "}
              <span style={{ color: COLORS.red }}>{FOUND_HASH}</span>
            </div>
            <div
              style={{
                marginTop: 10 * s,
                border: `${1.5 * s}px solid rgba(248,113,113,0.4)`,
                background: "rgba(180,35,24,0.14)",
                borderRadius: 10 * s,
                padding: `${10 * s}px ${14 * s}px`,
                fontFamily: FONT.mono,
                fontSize: 21 * s,
                color: COLORS.red,
              }}
            >
              Δ views −24,889 · rows −22
            </div>
          </>,
        )}
      </div>

      {/* ════════ closing caption ════════ */}
      <div
        style={{
          position: "absolute",
          bottom: 56 * s,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: capO,
          transform: `translateY(${capY}px)`,
        }}
      >
        <div
          style={{
            background: COLORS.bg,
            border: `${1.5 * s}px solid ${COLORS.panelBorder}`,
            borderRadius: 999,
            padding: `${14 * s}px ${32 * s}px`,
            fontFamily: FONT.mono,
            fontSize: 26 * s,
            color: COLORS.text,
            boxShadow: `0 ${12 * s}px ${36 * s}px rgba(4,8,14,0.4)`,
          }}
        >
          one light · <span style={{ color: COLORS.green }}>any dashboard</span> · open source
        </div>
      </div>
    </AbsoluteFill>
  );
};
