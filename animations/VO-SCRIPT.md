# Voiceover Script — Tamper Signal Explainer Animations

Three animations, recorded as one continuous read (~53s) or split into three clips.
Timecodes are relative to each clip's start. Delivery: conversational, creator-to-creator,
a little dry on the problem, more confident as the solution lands. ~3 words/sec.

> **Optional cold-open hook** (say it over the very first frame — strong TikTok opener):
> *"Your AI-built dashboard is probably lying to you. Here's how to prove it."*

---

## 1 · THE PROBLEM  (0:00–0:16)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 0:00 | "You exported your TikTok data." | "You pull your TikTok numbers into a spreadsheet." |
| 0:03 | "Then you vibe-coded a dashboard." | "Then you let AI vibe-code a dashboard on top of it." |
| 0:07 | dashboard appears, numbers glitch | "And it looks great — until the views inflate, and a few thousand rows quietly disappear." |
| 0:11 | "It hallucinated the numbers. And nothing caught it." | "The AI hallucinated the numbers… and nothing in your pipeline caught it." |
| 0:14 | "There's a better way →" | "There's a better way." |

---

## 2 · HOW IT WORKS  (0:00–0:18)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 0:00 | source file → hash → receipt 0 | "Every step in your pipeline signs a receipt — a fingerprint of the exact data it touched." |
| 0:08 | receipt 1, matching hashes glow | "Each receipt links to the one before it. This step's input has to match the last step's output." |
| 0:13 | 3-receipt chain | "Chain them together, sign every link, and now the whole pipeline is verifiable." |
| 0:16 | ✓ "…made it through intact" | "If every link matches, your data made it through untouched." |

---

## 3 · THE PROOF  (0:00–0:19)

| Time | On screen | Voiceover |
|------|-----------|-----------|
| 0:00 | verify → CHAIN INTACT | "Run verify, and it checks the entire chain end to end. All green — the data's clean." |
| 0:04 | tamper, node turns red | "Now watch — someone changes the numbers after the fact." |
| 0:08 | "Run verify again." | "Run verify again…" |
| 0:11 | CHAIN BROKEN at link 1→2 | "…and it fails instantly — pointing at the exact link that broke, with what changed and by how much." |
| 0:17 | "Continuity you can prove." | "Continuity you can actually prove. It's open source, works with any pipeline, and you can drop it into your next vibe-coded project in minutes." |

---

## Notes

- **One important caveat to keep your claims honest:** this proves the data *made it through unchanged* — continuity, not correctness. It doesn't validate that the source numbers were right to begin with; it proves nothing was silently altered between export and dashboard. If you want a one-liner for it: *"It can't tell you the data is right — but it can prove nobody changed it."*
- **Posting separately?** Each section above stands alone. For single clips, add the open-source CTA to the end of whichever clip is last in the post (it currently lives at the end of Proof).
- **First 2 seconds matter on TikTok** — the cold-open hook line is there for that. You can also burn it in as a caption.
- **Pacing:** if a line feels rushed, cut the parenthetical clauses first (e.g. "with what changed and by how much" → "and shows you exactly what changed").

---

## Tighter alternate (≈35s, punchier energy)

**Problem:** "You export your TikTok data, vibe-code a dashboard… and trust whatever number it shows you. Big mistake — AI hallucinates, rows vanish, and nothing flags it."

**How:** "So sign a receipt at every step. Each one fingerprints the data and links to the step before it. A signed, verifiable chain from source to dashboard."

**Proof:** "Verify passes when the data's clean. Tamper with it, run it again — it fails on the exact broken link and tells you what changed. It's open source, works with any pipeline, and drops into your next vibe-coded project in minutes. Link below."
