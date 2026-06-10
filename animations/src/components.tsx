// Shared building blocks for all scenes. Dark terminal aesthetic.
// All components accept a `s` scale factor (from scaleOf) so the same scene
// works in 16:9 GIF comps and 9:16 vertical comps.

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./theme";

// --- Terminal window chrome -------------------------------------------------
export const Terminal: React.FC<{
  s: number;
  width: number | string;
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ s, width, title = "terminal", children, style }) => (
  <div
    style={{
      width,
      background: COLORS.panel,
      border: `${2 * s}px solid ${COLORS.panelBorder}`,
      borderRadius: 16 * s,
      overflow: "hidden",
      boxShadow: `0 ${24 * s}px ${64 * s}px rgba(0,0,0,0.5)`,
      ...style,
    }}
  >
    <div
      style={{
        background: COLORS.chrome,
        padding: `${14 * s}px ${20 * s}px`,
        display: "flex",
        alignItems: "center",
        gap: 10 * s,
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div
          key={c}
          style={{
            width: 16 * s,
            height: 16 * s,
            borderRadius: "50%",
            background: c,
            opacity: 0.9,
          }}
        />
      ))}
      <span
        style={{
          marginLeft: 12 * s,
          color: COLORS.dim,
          fontFamily: FONT.mono,
          fontSize: 22 * s,
        }}
      >
        {title}
      </span>
    </div>
    <div style={{ padding: 28 * s }}>{children}</div>
  </div>
);

// --- Hash chip ---------------------------------------------------------------
export const HashChip: React.FC<{
  s: number;
  text: string;
  color?: string;
  glow?: boolean;
}> = ({ s, text, color = COLORS.cyan, glow = false }) => (
  <span
    style={{
      fontFamily: FONT.mono,
      fontSize: 26 * s,
      color,
      background: "rgba(103,232,249,0.08)",
      border: `${1.5 * s}px solid ${color}44`,
      borderRadius: 8 * s,
      padding: `${4 * s}px ${12 * s}px`,
      whiteSpace: "nowrap",
      textShadow: glow ? `0 0 ${14 * s}px ${color}aa` : undefined,
    }}
  >
    {text}
  </span>
);

// --- Stage card (file / transform / dashboard node) ---------------------------
export const StageCard: React.FC<{
  s: number;
  icon: string;
  label: string;
  sub?: string;
  subColor?: string;
  accent?: string;
  width?: number;
  highlight?: boolean;
  children?: React.ReactNode;
}> = ({ s, icon, label, sub, subColor, accent = COLORS.dim, width, highlight, children }) => (
  <div
    style={{
      width: width ? width * s : undefined,
      background: COLORS.panel,
      border: `${2 * s}px solid ${highlight ? accent : COLORS.panelBorder}`,
      borderRadius: 14 * s,
      padding: `${20 * s}px ${24 * s}px`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 8 * s,
      boxShadow: highlight ? `0 0 ${36 * s}px ${accent}33` : undefined,
    }}
  >
    <div style={{ fontSize: 52 * s, lineHeight: 1 }}>{icon}</div>
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 26 * s,
        color: COLORS.text,
        fontWeight: 600,
        textAlign: "center",
      }}
    >
      {label}
    </div>
    {sub ? (
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 20 * s,
          color: subColor ?? COLORS.dim,
          textAlign: "center",
        }}
      >
        {sub}
      </div>
    ) : null}
    {children}
  </div>
);

// --- Animated typing text ------------------------------------------------------
export const TypeText: React.FC<{
  s: number;
  text: string;
  startFrame: number;
  charsPerFrame?: number;
  color?: string;
  fontSize?: number;
  prefix?: string;
}> = ({
  s,
  text,
  startFrame,
  charsPerFrame = 1.2,
  color = COLORS.text,
  fontSize = 26,
  prefix,
}) => {
  const frame = useCurrentFrame();
  const visible = Math.max(0, Math.floor((frame - startFrame) * charsPerFrame));
  const shown = text.slice(0, visible);
  const done = visible >= text.length;
  return (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: fontSize * s,
        color,
        whiteSpace: "pre-wrap",
        minHeight: fontSize * 1.4 * s,
      }}
    >
      {prefix ? <span style={{ color: COLORS.green }}>{prefix} </span> : null}
      {shown}
      {!done && frame >= startFrame ? (
        <span style={{ color: COLORS.green }}>▋</span>
      ) : null}
    </div>
  );
};

// --- Fade/slide-in wrapper ------------------------------------------------------
export const Reveal: React.FC<{
  startFrame: number;
  from?: "up" | "down" | "left" | "right" | "none";
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ startFrame, from = "up", children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 200, stiffness: 120 },
  });
  const dist = 36;
  const offset =
    from === "up"
      ? `translateY(${(1 - progress) * dist}px)`
      : from === "down"
        ? `translateY(${-(1 - progress) * dist}px)`
        : from === "left"
          ? `translateX(${(1 - progress) * dist}px)`
          : from === "right"
            ? `translateX(${-(1 - progress) * dist}px)`
            : "none";
  return (
    <div style={{ opacity: progress, transform: offset, ...style }}>
      {children}
    </div>
  );
};

// --- Big headline ----------------------------------------------------------------
export const Headline: React.FC<{
  s: number;
  children: React.ReactNode;
  color?: string;
  size?: number;
}> = ({ s, children, color = COLORS.text, size = 64 }) => (
  <div
    style={{
      fontFamily: FONT.sans,
      fontWeight: 800,
      fontSize: size * s,
      lineHeight: 1.15,
      color,
      textAlign: "center",
      letterSpacing: -0.5 * s,
    }}
  >
    {children}
  </div>
);

// --- Chain link arrow (animated draw) ------------------------------------------
export const LinkArrow: React.FC<{
  s: number;
  startFrame: number;
  vertical?: boolean;
  length?: number;
  color?: string;
  broken?: boolean;
}> = ({ s, startFrame, vertical = false, length = 70, color = COLORS.green, broken = false }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, startFrame + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const L = length * s;
  const thickness = 5 * s;
  if (broken) {
    // Broken link: two halves with a gap and a red ✗.
    return (
      <div
        style={{
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: "center",
          gap: 6 * s,
          opacity: progress,
        }}
      >
        <div
          style={{
            width: vertical ? thickness : L * 0.32,
            height: vertical ? L * 0.32 : thickness,
            background: COLORS.red,
            borderRadius: thickness,
          }}
        />
        <span style={{ color: COLORS.red, fontSize: 34 * s, fontFamily: FONT.mono, fontWeight: 700 }}>
          ✗
        </span>
        <div
          style={{
            width: vertical ? thickness : L * 0.32,
            height: vertical ? L * 0.32 : thickness,
            background: COLORS.red,
            borderRadius: thickness,
          }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: vertical ? thickness : L * progress,
          height: vertical ? L * progress : thickness,
          background: color,
          borderRadius: thickness,
          boxShadow: `0 0 ${10 * s}px ${color}88`,
        }}
      />
      <div
        style={{
          opacity: progress >= 1 ? 1 : 0,
          color,
          fontSize: 26 * s,
          lineHeight: 0.6,
          transform: vertical ? "rotate(90deg)" : undefined,
          marginLeft: vertical ? 0 : -2 * s,
        }}
      >
        ▶
      </div>
    </div>
  );
};
