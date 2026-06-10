---
title: "Multi-format Remotion scene pattern: fps-scaled timing, deterministic randomness, narrative QA"
date: 2026-06-10
category: design-patterns
module: animations
problem_type: design_pattern
component: tooling
severity: medium
applies_when:
  - "Building Remotion animations that must render at multiple resolutions, aspect ratios, or frame rates from one scene component"
  - "Adding visual randomness (glitches, scrambles, fake hashes) to frame-rendered video"
  - "Linking visual artifacts across scenes so identical data reads as identical on screen (e.g. matching hashes)"
  - "Reviewing animation output for narrative correctness, not just visual polish"
  - "Embedding rendered animation previews in README or docs without committing render output"
tags: [remotion, animation, multi-format, determinism, responsive-scaling, narrative-qa, video-rendering, design-previews]
---

# Multi-format Remotion scene pattern: fps-scaled timing, deterministic randomness, narrative QA

## Context

We needed three kinds of motion artifacts from one codebase: explainer GIFs for a blog post (960x540 @ 15fps, small files), vertical MP4s for TikTok (1080x1920 @ 30fps), and product-UI showcase GIFs for the README, all telling one coherent "tamper caught" incident. Building separate scenes per format would double the work and let the artifacts drift apart. The solution is a Remotion 4 project (`animations/`, React 18) where each scene is a single responsive component registered as multiple compositions, plus a still-frame QA loop that treats narrative coherence as a reviewable property.

## Guidance

### a) Responsive scene contract: seconds x fps, scaleOf, isVertical

Every scene derives **timing from `useVideoConfig().fps`** (author in seconds) and **sizing from a scale factor**; never hardcode frames or pixels. From `animations/src/theme.ts`:

```ts
export const scaleOf = (width: number, height: number): number =>
  Math.min(width, height) / 1080; // base design dim = smaller axis at 1080

export const isVertical = (width: number, height: number): boolean =>
  height > width;
```

Author beat timings as a seconds-based `T` object, converted at render time (`animations/src/scenes/Proof.tsx`):

```ts
const T = {                                // (abridged; source has more beats)
  cmd1: 0.5, sig1: 1.9, intact: 3.5,      // Beat 1: verify PASS
  tamperHead: 4.0, glitchStart: 5.4,       // Beat 2: tamper
  run2: 8.0, broken: 10.6, det1: 11.3,     // Beat 3: verify FAIL
  caught: 14.0, close: 17.0,
} as const;
// inside the component:
const { fps, width, height } = useVideoConfig();
const s = scaleOf(width, height);
const f = (sec: number): number => sec * fps;   // T.broken -> frames
```

Then register **one scene as multiple compositions** (`animations/src/Root.tsx`):

```tsx
const GIF = { width: 960, height: 540, fps: 15 } as const;
const VERTICAL = { width: 1080, height: 1920, fps: 30 } as const;

<Composition id="ProofGif" component={ProofScene}
  durationInFrames={Math.round(PROOF_DURATION_SEC * GIF.fps)} {...GIF} />
<Composition id="ProofVertical" component={ProofScene}
  durationInFrames={Math.round(PROOF_DURATION_SEC * VERTICAL.fps)} {...VERTICAL} />
```

Inside scenes, multiply all px values by `s` (`fontSize: 26 * s`) and switch layout with `isVertical` (`flexDirection: vertical ? "column" : "row"`). Shared components (`animations/src/components.tsx`) all accept `s` as a prop. Even type speed is fps-relative: `const typeSpeed = 25 / fps; // ~25 chars/sec at any fps`.

### b) Determinism: no Math.random, no Date.now

Remotion renders frames independently (possibly in parallel, possibly re-rendering any frame); components must be pure functions of `frame`. All glitch and scramble effects derive from the frame number (`animations/src/scenes/Problem.tsx`):

```ts
const scrambleDigits = (template: string, frame: number, salt: number): string =>
  template.split("").map((ch, i) => {
    if (ch < "0" || ch > "9") return ch;
    const n = Math.abs(Math.sin(frame * 12.9898 + i * 78.233 + salt * 37.719)) * 10;
    return String(Math.floor(n) % 10);
  }).join("");
```

Rule: any "random-looking" effect is a pure function of `frame` (plus a salt when the effect has multiple on-screen instances).

### c) Shared fake-data seeds for cross-artifact coherence

Fake hashes are deterministic per label (`animations/src/theme.ts`):

```ts
export const shortHash = (seed: string): string => {
  const full = fakeHash(seed);            // FNV-style hash of the seed string
  return `${full.slice(0, 4)}…${full.slice(-2)}`;
};
```

Because `shortHash("clean-out")` always yields the same chip (`6617…f3`) and `shortHash("tampered")` always yields `bb30…43`, reusing the **same seed strings** across scenes, HTML design mockups (`designs/`), and the README makes hashes visibly match wherever they appear; that matching is what makes a chain-link narrative legible. The same rule extends to incident numbers: rows -22, views -24,889, expected `6617…f3` / found `bb30…43` appear identically in the explainer animations, UI mockups, showcase GIFs, and README, so every artifact tells one incident.

### d) Still-frame narrative QA loop

Render single frames at narratively risky moments (beat boundaries) and read them like a viewer would:

```
npx remotion still src/index.ts ProofGif out/qa.png --frame=N
```

Critique the PNG, fix, re-render. Three checkable rules, each of which caught a real defect here:

1. **No state contradiction.** No on-screen verdict may contradict on-screen data. A terminal still showed `✓ CHAIN INTACT` ~1.5s after the data turned tampered-red. Fix: clear stale verdicts the instant the world changes. Proof's terminal has three states (PASS run, then a cleared waiting prompt with `# data changed on disk`, then the FAIL run), never PASS-while-tampered.
2. **Every printed datum is traceable.** Any value the terminal prints must be visible somewhere else on screen. The FAIL output's `found bb30…43` originally appeared nowhere else; fix: the tampered card's displayed hash flips to the found-hash so the printed value points at its source.
3. **Headlines sync with the action.** A narration headline must not outlive the beat it narrates. "Now someone tampers…" was still up 3.5s after the chain visibly broke; fix: headline crossfades hand off at the beat timestamps (the "Caught" headline starts at `T.det1`, landing with the CHAIN BROKEN reveal).

### e) Output hygiene

- Design explorations live as self-contained HTML mockups in `designs/` (parallel agents can build them); Remotion scenes mirror the chosen mockups.
- `animations/render-all.mjs` renders everything in one pass (GIFs via `--codec=gif`, verticals via `--codec=h264`); it accepts comp-id args for partial re-renders.
- `animations/out/` is gitignored (renders are reproducible); final GIFs are copied to committed `docs/media/` for README embedding.
- Any README GIF depicting UI that is not shipped is explicitly labeled "design preview."

## Why This Matters

- Without the seconds-x-fps + scaleOf contract, each new output format means rebuilding or forking every scene; with it, a new format is one `<Composition>` registration.
- `Math.random()`/`Date.now()` in Remotion produce flicker and frame-to-frame inconsistency that only shows up in renders: hard to debug, easy to prevent.
- Animations that contradict themselves (stale verdicts, untraceable numbers, lagging headlines) read as sloppy or, worse, dishonest; exactly wrong for a product whose pitch is verifiability.
- Mismatched fake data across blog/TikTok/README breaks the single-incident illusion; unlabeled mockup GIFs in a README overpromise unshipped UI.

## When to Apply

- Producing the same animated content for multiple aspect ratios or frame rates (blog GIF + vertical social + README) from one codebase.
- Writing any Remotion scene with glitch, scramble, or "random" visual effects.
- Generating fake-but-coherent demo data (hashes, IDs, counts) that appears in more than one artifact.
- Reviewing animation output where state changes over time: apply the three QA rules at every beat boundary.
- Deciding what render output to commit vs gitignore in a repo with media artifacts.

## Examples

**State contradiction, fixed with a three-state terminal** (`animations/src/scenes/Proof.tsx`)

Before: terminal content keyed only on "has the second run started," so the first run's `✓ CHAIN INTACT` stayed on screen through the tamper glitch: a PASS verdict next to visibly red, tampered data.

After:

```tsx
const showRun1 = frame < f(T.glitchStart);   // PASS run, valid only pre-tamper
const showRun2 = frame >= f(T.run2);         // FAIL run
// between them: cleared prompt + dim "# data changed on disk" note
```

**Hardcoded frames, fixed with seconds x fps**

Before (breaks the moment fps differs between comps; frame 159 is 10.6s at 15fps but 5.3s at 30fps):

```tsx
const isBroken = frame >= 159;
```

After:

```tsx
const { fps } = useVideoConfig();
const f = (sec: number) => sec * fps;
const isBroken = frame >= f(T.broken);   // T.broken = 10.6: same wall-clock moment in every comp
```

## Related

- `animations/README.md`: the in-repo usage README for this pattern (output table, structure notes). This doc generalizes it; that one documents the concrete instance.
- `README.md` (repo root): the pipeline's destination; embeds `docs/media/*.gif` with design-preview labeling.
- `animations/VO-SCRIPT.md`: the voiceover script whose timecodes define the narrative beats the QA loop checks against.
- `designs/01-NOTES.md`, `designs/02-NOTES.md`, `designs/03-NOTES.md`: the mockup-side origin of the showcase scenes; mockups pull signal colors and hash formats from `animations/src/theme.ts`.
