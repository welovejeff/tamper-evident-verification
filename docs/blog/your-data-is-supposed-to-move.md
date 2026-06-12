# Your data is supposed to move

*By [Jeff MacDonald](https://github.com/welovejeff) · June 2026 · Tamper Signal 1.6.0*

A trust tool that cries wolf gets muted, and a muted trust tool is worthless.

That one sentence is the reason 1.6.0 exists. Tamper Signal has always been able to prove your dashboard numbers descend from the source unchanged. It turns out "unchanged" was the wrong word for the pipelines people actually run.

## The daily-refresh problem

Open any real reporting export. A paid-media pull, a month of TikTok performance, a Google Analytics download. Run it today, run it again tomorrow, and the numbers will be different. Not because anyone tampered with anything. Because the data is still settling.

Conversions arrive late. Attribution backfills. The reporting window keeps maturing for a day or two after the period closes, and then it stops. Anyone who has lived in this data knows the rule by heart: a metric moving less than five percent day over day is not a story, it is Tuesday.

Tamper Signal's original check asked one question: is this byte-for-byte identical to last time? For a one-shot pipeline that froze on a deadline, that was exactly right. For a dashboard that refreshes every morning, the answer is always no, and an answer that is always no carries no information. That is why the old drift warning shipped switched off by default. Left on, it fired every single day, and a light that flashes every day is a light you learn to ignore.

## Teach it what normal looks like

1.6.0 gives the receipt chain two things it never had: a memory, and a sense of normal.

The sense of normal is a tolerance band you declare once, at ingest, and sign into the chain:

```bash
receipts ingest export.csv --origin "TikTok, May 2026" --band 5% --settle 72h
```

You are telling the tool the truth about your data: expect movement up to five percent day over day, and expect it to keep settling for about seventy-two hours. Because the declaration is signed into the manifest, nobody can quietly widen the band later to hide a problem. Loosening the rules breaks the signature.

Then verification does something smarter than byte-equality. It judges each day's data in one of two zones:

- 🟢 **Recent, still-settling data may drift inside the band and stay green.** Yesterday's impressions ticked up four percent? That is the window maturing. The light does not flinch, because nothing happened that should make it flinch.
- 🟡 **Settled data is frozen.** A number from three weeks ago already settled. Nothing legitimate should be touching it, so any movement there, even half a percent, trips yellow and asks for a human. A flat tolerance would have shrugged at that two percent edit to last month's totals. This one catches it.

This is both quieter and more protective than the old check. Quieter, because the normal daily wobble no longer lights anything up. More protective, because the place a real problem hides, a small change to settled history, is exactly where the light now looks hardest. The whole point is to spend the light's credibility only where it counts.

## A memory, so you can ask "what changed?"

The second half is history. Every time you verify, Tamper Signal now quietly archives a small signed snapshot of that run. Over weeks and quarters those snapshots become a record you can interrogate.

```bash
receipts diff      # what moved since the last run, and at which stage
receipts log       # the trend, day over day, week over week
```

When this week's number looks off, you no longer have to guess whether the data moved or the AI rewrote your transform. `diff` tells you exactly which stage's code changed and exactly how the totals shifted. `log` shows you the settling curve flattening over two or three days, the way it always does, which is what makes the one day it does not jump out.

## Still continuity, not correctness

A band is not a claim that your data is right. It is your own signed statement of how much a period normally moves, and the tool holding you to it. Tamper Signal still proves continuity, not correctness. It still cannot tell you the source export was good.

What 1.6.0 changes is narrower and, like the red light that names the broken link, more useful in practice. The green light now means something on a pipeline that refreshes every morning, because it stopped crying wolf on the mornings nothing was wrong. The light is green, the data is clean, and now it stays believable on the days your data was only doing what data does.

## Upgrade

```bash
pip install --upgrade tamper-signal      # or: npm install tamper-signal@latest
```

1.6.0 is fully backward compatible. Chains you signed under earlier versions still verify green. With no band declared, verification behaves exactly as it did before, so you can adopt the new judgment one pipeline at a time. The one new habit worth knowing: verifying now leaves a small history trail in `receipts/history/`, which is what diff and log read. Commit it or ignore it, to taste.

Your data is supposed to move. Now your receipts know the difference.
