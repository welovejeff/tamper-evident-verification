// Composition registry. Each of the three animations is ONE responsive scene
// component registered twice:
//   <Name>Gif      — 960x540 16:9 @ 15fps  (blog GIF, smaller files)
//   <Name>Vertical — 1080x1920 9:16 @ 30fps (TikTok)
// Scene components MUST derive all timing from useVideoConfig().fps (work in
// seconds) and all sizing from scaleOf(width, height) so both comps look right.

import React from "react";
import { Composition } from "remotion";
import { ProblemScene, PROBLEM_DURATION_SEC } from "./scenes/Problem";
import { HowScene, HOW_DURATION_SEC } from "./scenes/How";
import { ProofScene, PROOF_DURATION_SEC } from "./scenes/Proof";
import { InlineLightScene, INLINE_LIGHT_DURATION_SEC } from "./scenes/ui/InlineLight";
import { DataTabScene, DATA_TAB_DURATION_SEC } from "./scenes/ui/DataTab";
import { ConsoleScene, CONSOLE_DURATION_SEC } from "./scenes/ui/Console";

const GIF = { width: 960, height: 540, fps: 15 } as const;
const VERTICAL = { width: 1080, height: 1920, fps: 30 } as const;

export const Root: React.FC = () => (
  <>
    <Composition
      id="ProblemGif"
      component={ProblemScene}
      durationInFrames={Math.round(PROBLEM_DURATION_SEC * GIF.fps)}
      {...GIF}
    />
    <Composition
      id="ProblemVertical"
      component={ProblemScene}
      durationInFrames={Math.round(PROBLEM_DURATION_SEC * VERTICAL.fps)}
      {...VERTICAL}
    />
    <Composition
      id="HowGif"
      component={HowScene}
      durationInFrames={Math.round(HOW_DURATION_SEC * GIF.fps)}
      {...GIF}
    />
    <Composition
      id="HowVertical"
      component={HowScene}
      durationInFrames={Math.round(HOW_DURATION_SEC * VERTICAL.fps)}
      {...VERTICAL}
    />
    <Composition
      id="ProofGif"
      component={ProofScene}
      durationInFrames={Math.round(PROOF_DURATION_SEC * GIF.fps)}
      {...GIF}
    />
    <Composition
      id="ProofVertical"
      component={ProofScene}
      durationInFrames={Math.round(PROOF_DURATION_SEC * VERTICAL.fps)}
      {...VERTICAL}
    />
    {/* Product-UI showcase GIFs for the README (16:9 only). */}
    <Composition
      id="LightGif"
      component={InlineLightScene}
      durationInFrames={Math.round(INLINE_LIGHT_DURATION_SEC * GIF.fps)}
      {...GIF}
    />
    <Composition
      id="DataTabGif"
      component={DataTabScene}
      durationInFrames={Math.round(DATA_TAB_DURATION_SEC * GIF.fps)}
      {...GIF}
    />
    <Composition
      id="ConsoleGif"
      component={ConsoleScene}
      durationInFrames={Math.round(CONSOLE_DURATION_SEC * GIF.fps)}
      {...GIF}
    />
  </>
);
