# Your vibe-coded dashboard needs receipts

*June 2026 · [Tamper Signal on GitHub](https://github.com/welovejeff/tamper-evident-verification)*

Your social team exports a month of TikTok performance data. Someone opens an AI assistant, describes the dashboard they want, and has it running by the end of the afternoon. It looks great. The charts are clean, the totals are plausible, and everyone moves on.

Then a transform silently drops 22 rows. Or the model hallucinates an aggregation and views come up 24,889 short. The dashboard still renders. The chart still looks plausible. The wrong number goes in front of your boss, and nothing in that workflow ever knew.

![An AI-built dashboard glitching: views inflate and rows quietly disappear while everything keeps rendering](../media/problem.gif)

## Vibe-coded pipelines fail silently

This is the specific failure mode of AI-written data code: it works most of the time, and when it doesn't, it doesn't crash. It drops rows. It double-counts. It coerces a column wrong and quietly shifts every total. Nobody re-checks 48,000 rows by hand, because nobody re-checks 48,000 rows by hand.

The traditional answers assume infrastructure you don't have. Warehouse lineage, dbt, data-quality suites: all great, all built for teams with a warehouse, an orchestrator, and a metadata catalog. The team running xlsx-to-dashboard has none of that, and is the team most exposed.

What that team needs is something closer to a receipt.

## Sign a receipt at every step

Here is the whole mechanism. Every stage of your pipeline signs a receipt: a fingerprint of the data it received, a fingerprint of the code it ran, a fingerprint of the data it produced. Receipts link, because each stage's input fingerprint has to match the previous stage's output fingerprint. Chain them together and the whole pipeline becomes verifiable, end to end.

![Each pipeline step emits a signed receipt, and matching fingerprints link them into a chain](../media/how.gif)

Each receipt also carries control totals: row counts, numeric sums, date ranges, null counts. The hashes can tell you a chain is broken; the totals tell you how broken. That difference matters when you are staring at a red light at 4:55pm.

Everything is signed with Ed25519, and everything is plain files on disk. No database, no server, no catalog. Yes, it is technically a hash chain; no, it is not that other thing. There is no consensus, no network, no tokens. Just receipts, like the shoebox under your bed, except these ones check themselves.

## Run verify, get a verdict

One command walks the chain: every signature, every link, and optionally your current dashboard file against the final receipt.

![Verify passes on the intact chain, then someone tampers with a value and verify fails at the exact link](../media/proof.gif)

The verdict is a traffic light.

The light is green, the data is clean. Every link verifies, every signature checks. Your dashboard numbers descend from the original export, untouched.

The light is yellow, a human should look. The chain verifies, with caveats: a gap in the receipt coverage, a signing key you haven't said you trust, totals drifting in ways you asked it to flag. Yellow never blames. It asks for eyes.

The light is red, the chain is broken. And this is the part worth paying for, even though it costs nothing: red doesn't shrug. It names the exact link and the exact delta.

```
✗ CHAIN BROKEN at link 1 -> 2 (transform_aggregate)
  expected input hash a3f1...9c  (output of transform_clean)
  found    input hash 77b2...d4
  Control totals delta vs upstream: row_count 48212 -> 48190 (-22)
```

Not "validation failed." Not a stack trace. The stage, the expected fingerprint, the found fingerprint, and 22 missing rows. A red light that points is a different product than an alarm that panics.

## What this proves, and what it doesn't

This proves continuity, not correctness. It can't tell you the data is right, but it can prove nobody changed it.

If the source export is wrong, the chain will faithfully verify wrong numbers all the way to your dashboard. It is not a data-quality tool, and any tool in this space that promises to "ensure accuracy" is describing something it cannot do. What the chain gives you is narrower and, honestly, more useful when things break: certainty about where a number came from, and the exact point where that stopped being true.

## The light lives in the dashboard

The verdict isn't only a CLI thing. A small badge, or the newer inline status light, drops into any web frontend and re-verifies the whole chain in the viewer's browser using Web Crypto: every signature, every link, on page load. No server-side trust required. When the chain breaks, the light can even flag the specific on-page metric that no longer descends from the source.

And once the light is green, we think your dashboard should show its work. Not a tooltip, not an export-on-request: a Data tab, right next to the charts, with the raw verified table the pretty numbers came from. If the chain is intact there is no reason to hide the rows, and if you find yourself wanting to hide them, that's worth sitting with. A chart asks you to believe; a table lets you check.

## Try it in five minutes

Python 3.11+, MIT licensed. The pipeline tooling is Python today; the badge and the light run in any frontend. (A Node package for receipt creation is on the roadmap, so JS pipelines can sign receipts too.)

```bash
git clone https://github.com/welovejeff/tamper-evident-verification && cd tamper-evident-verification
pip install -e .
receipts demo
```

The demo runs the whole story end to end: it generates a deliberately messy export, ingests it, runs two AI-written-style transforms, verifies the chain (green), tampers with one spend value, and verifies again (red, with the link and the delta). Then it serves the badge so you can see all three states side by side.

Wrapping your own transforms is one decorator:

```python
from tamper_signal import receipt_step

@receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
def transform_clean(records):
    return [r for r in records if r.get("campaign_name")]
```

The wrapper verifies the chain tail before running, refuses to extend a broken chain, and signs a new receipt when it's done.

Trust receipts, not vibes.
