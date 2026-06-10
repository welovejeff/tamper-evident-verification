// Shared design system for all three animations. Dark terminal aesthetic.
// Every scene component MUST size itself from useVideoConfig() so the same
// scene renders correctly in both the blog GIF comps (16:9) and the TikTok
// comps (9:16 1080x1920).

export const COLORS = {
  bg: "#0b0f14", // near-black blue
  panel: "#11161d", // terminal window body
  panelBorder: "#1f2937",
  chrome: "#161d26", // terminal title bar
  text: "#e5e7eb",
  dim: "#8b98a5",
  faint: "#3d4854",
  green: "#34d399", // verified / PASS
  greenDeep: "#067647",
  red: "#f87171", // broken / FAIL
  redDeep: "#b42318",
  amber: "#fbbf24",
  cyan: "#67e8f9", // hashes
  violet: "#a78bfa", // code / transforms
} as const;

export const FONT = {
  mono: "ui-monospace, 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace",
  sans: "-apple-system, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, sans-serif",
} as const;

// Layout scale: 1.0 at 1080px-wide vertical; GIF comps scale down.
// Use: const s = scaleOf(width, height)  then multiply px values by s.
export const scaleOf = (width: number, height: number): number => {
  // Base design dimension is the smaller axis at 1080.
  return Math.min(width, height) / 1080;
};

export const isVertical = (width: number, height: number): boolean =>
  height > width;

// Short hash chips used everywhere, deterministic per label.
export const fakeHash = (seed: string): string => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return (hex(h) + hex(Math.imul(h, 2654435761))).slice(0, 12);
};

export const shortHash = (seed: string): string => {
  const full = fakeHash(seed);
  return `${full.slice(0, 4)}…${full.slice(-2)}`;
};
