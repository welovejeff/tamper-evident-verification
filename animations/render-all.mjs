// Render all outputs: 3 explainer GIFs (blog) + 3 vertical MP4s (TikTok)
// + 3 product-UI showcase GIFs (README, copied to ../docs/media/).
// Usage: node render-all.mjs [comp-id ...]   (no args = render everything)
import { execSync } from "node:child_process";

const ALL = [
  { id: "ProblemGif", out: "out/problem.gif", codec: "gif" },
  { id: "HowGif", out: "out/how.gif", codec: "gif" },
  { id: "ProofGif", out: "out/proof.gif", codec: "gif" },
  { id: "ProblemVertical", out: "out/problem-vertical.mp4", codec: "h264" },
  { id: "HowVertical", out: "out/how-vertical.mp4", codec: "h264" },
  { id: "ProofVertical", out: "out/proof-vertical.mp4", codec: "h264" },
  { id: "LightGif", out: "out/light.gif", codec: "gif" },
  { id: "DataTabGif", out: "out/data-tab.gif", codec: "gif" },
  { id: "ConsoleGif", out: "out/console.gif", codec: "gif" },
];

const only = process.argv.slice(2);
const targets = only.length ? ALL.filter((t) => only.includes(t.id)) : ALL;

for (const t of targets) {
  console.log(`\n=== Rendering ${t.id} -> ${t.out} ===`);
  execSync(
    `npx remotion render src/index.ts ${t.id} ${t.out} --codec=${t.codec} --log=error`,
    { stdio: "inherit" }
  );
}
console.log("\nAll renders complete.");
