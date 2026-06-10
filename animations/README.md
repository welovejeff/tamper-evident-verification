# Lineage Receipts Animations

Three explainer animations for the signed data lineage receipts protocol, each rendered two ways, plus three product-UI showcase GIFs for the README.

Explainers:

| Animation | Story | Blog GIF (960x540 @ 15fps) | TikTok (1080x1920 @ 30fps) |
|---|---|---|---|
| Problem | Export -> vibe-coded scripts -> dashboard; numbers silently change, nobody can prove where | `out/problem.gif` | `out/problem-vertical.mp4` |
| How | Every stage emits a signed receipt; receipts link output-hash -> input-hash into a verifiable chain | `out/how.gif` | `out/how-vertical.mp4` |
| Proof | Verify passes, someone tampers, verify fails at the exact link with the totals delta | `out/proof.gif` | `out/proof-vertical.mp4` |

UI showcase (16:9 only, animated from the mockups in `../designs/`; final copies live in `../docs/media/` for README embedding):

| Animation | Shows | Output |
|---|---|---|
| Light | Inline status light cycling green/yellow/red in a host dashboard, flagging the unverified metric | `out/light.gif` |
| DataTab | The enforced Data tab: dashboard flips to the raw verified table, break localized to a column | `out/data-tab.gif` |
| Console | The verification console: verify pass, tamper, chain severed at the exact link | `out/console.gif` |

A voiceover script for the explainers, timed to the on-screen beats, is in `VO-SCRIPT.md`.

## Usage

```bash
cd animations
npm install
npm run studio       # preview / tweak in Remotion Studio
npm run render:all   # render all nine outputs into out/
```

Render a single composition:

```bash
npx remotion render src/index.ts ProofVertical out/proof-vertical.mp4 --codec=h264
```

## Structure

- `src/theme.ts` - shared palette (dark terminal aesthetic), fonts, scale helpers, deterministic fake hashes
- `src/components.tsx` - shared building blocks (Terminal, HashChip, StageCard, TypeText, Reveal, Headline, LinkArrow)
- `src/scenes/{Problem,How,Proof}.tsx` - one responsive scene each; all timing derives from `fps` (seconds-based) and all sizing from `scaleOf(width, height)`, so the same component renders correctly in both the 16:9 GIF and 9:16 vertical compositions
- `src/scenes/ui/{InlineLight,DataTab,Console}.tsx` - the product-UI showcase scenes (16:9 only)
- `render-all.mjs` - renders all nine outputs

The animations describe the protocol generically (no package name) so they stay accurate as the implementation evolves.
