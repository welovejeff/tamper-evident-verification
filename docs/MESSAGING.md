# Messaging Guide: Tamper Signal

The single source of truth for how we talk about this project. The product proves
**continuity, not correctness**. Every line of copy must survive that constraint.
If a sentence implies we validate that the numbers are *right*, kill it.

The hero line is locked:

> **"The light is green, the data is clean."**

---

## 0. The name

**Product: Tamper Signal.** Styled "Tamper Signal" in prose, `tamper-signal` as
the package name. **CLI: `receipts`** (the command reads like the pitch:
`receipts verify chain.json`). **Python import: `tamper_signal`.** The repo
slug stays `tamper-evident-verification`.

The layers each keep their own noun: the mechanism is the **receipt**, the
verdict is the **light**, the product that delivers both is the **signal**.
"Tamper signal" is a real hardware-security term (the line that fires when an
enclosure is opened), which grounds the name the same way the wax-seal
metaphor grounds the pill design.

The previous brand word, "lineage," is retired (decision 2026-06-10): it filed
the project under the warehouse-lineage category (OpenLineage, dbt, metadata
catalogs), which is exactly what this is not. See the banned list below.

## 0.5 Two registers, one truth

The project speaks in two registers, bound by the same rules:

- **Plain register** (the landing page, social, anything a non-technical
  vibe coder sees first): no code, no jargon nouns (hash, chain, key,
  pipeline as architecture), pain-first, "your AI assistant does the
  technical part." Receipts may carry their colloquial weight ("pull up the
  receipts"). In this register the indicator is called the **status light**
  ("the light" bare reads ambiguous; "pill" tested poorly). Decision
  2026-06-10, from a real user test: code blocks on the landing page scared
  away exactly the person the product serves.
- **Developer register** (README, AGENTS.md, demos, docs): precise nouns,
  real commands, real output.

The locked lines, the verdict table, the banned words, and the honesty rule
bind BOTH registers. "Plain" means fewer nouns, never bigger claims.

## 1. The traffic-light copy system

**Decision: only green rhymes.** All three states share the same skeleton, "The
light is ___, [verdict]." That structure is what makes them siblings. The rhyme
is reserved for green on purpose: the rhyme is the payoff, the little dopamine
hit of a clean chain. Yellow and red are warnings, and warnings should not sing.
A rhyming red line ("the light is red, your chain is dead") is funny exactly
once, then it reads like we're joking about the user's broken pipeline. Dropping
the rhyme on yellow and red also does work for us: when the line doesn't rhyme,
something is off. The pattern break *is* the signal.

| State | Line | Semantics |
|-------|------|-----------|
| Green | **The light is green, the data is clean.** | Chain intact. Every signature checks, every link matches. |
| Yellow | **The light is yellow, a human should look.** | Verifiable with caveats: coverage gap, unknown signing key, totals drift. Not broken, not blessed. |
| Red | **The light is red, the chain is broken.** | Verification failed. We can name the exact link and the exact delta. |

Supporting second lines, for expanded badge states and CLI output:

- Green: `Chain intact. N receipts, N links, all signatures valid.`
- Yellow: `Chain verifies, with caveats. Here's what we couldn't check.`
- Red: `Broken at link 1 -> 2 (transform_aggregate). row_count 48212 -> 48190 (-22).`

Yellow caveat taxonomy: alongside the existing yellow caveats (coverage gap,
unrecognized signing key, opt-in totals drift, missing or unverifiable anchor),
a declared tolerance adds four period-over-period caveats. Each locates exactly,
never blames, stays lowercase, and uses no em dashes:

- **band breach**: a recent bucket drifted beyond the declared band. *"totals
  drift beyond declared band: amount breached in 1 bucket, worst 2026-06-12
  (+1899.8%)"*
- **settled movement**: a bucket older than the settling window changed at all.
  *"settled period moved: amount changed in 1 settled bucket, worst 2026-05-02
  (+100)"*
- **bucket removed (interior)**: a period present in the previous run, sitting
  between this run's first and last bucket, is absent now. *"period buckets
  removed: 1 interior bucket present in the previous run is absent from this
  run, worst 2026-05-02"*
- **bucket loss**: the bucket column is no longer detected, so period judgment
  cannot run. *"bucket column no longer detected; period judgment unavailable"*

All four are yellow, never red: a number moving more than declared is a thing
for a human to look at, not a broken chain.

Rules: yellow never blames, it asks for eyes. Red never panics, it points. The
red state is the product's best moment, not its worst: we found the break and we
can show you where. Copy near red states should feel like a good error message,
not an alarm.

## 2. GitHub repo description and topics

**One-liner (117 chars):**

> Signed receipts for vibe-coded data pipelines. Proves nobody changed your data, and shows the exact link if they did.

Why this one: "signed receipts" is the mechanism, "vibe-coded" flags the
audience, and the second sentence is the honest claim plus the diagnosability
hook. It makes no correctness claim. Runner-up, if "vibe-coded" feels too
slangy for the repo header: `Tamper-evident receipts for ad-hoc data pipelines.
Green if the chain is intact, red at the exact broken link.`

**Topics:** `tamper-signal` `tamper-evident` `data-integrity` `provenance`
`ed25519` `hash-chain` `signed-receipts` `data-pipelines` `analytics`
`verification` `python` `vibe-coding`

(`hash-chain` is fine as a topic; `blockchain` is not. See section 5.)

## 3. Hero block

```
# The light is green, the data is clean.

Every stage of your pipeline signs a receipt: a fingerprint of the data in,
the code that ran, and the data out. Verify the chain and know your dashboard
numbers descend from the original export, untouched.

It can't tell you the data is right, but it can prove nobody changed it.
```

The caveat sentence is load-bearing. It goes directly under the subhead, not in
a footnote, not behind a "learn more" link. Leading with the limitation is the
most credible thing we can do, and it's a one-sentence differentiator from
every tool that vaguely promises "trust."

## 4. Secondary taglines

| Context | Line |
|---------|------|
| Blog post title | **Your vibe-coded dashboard needs receipts** |
| TikTok caption / cold open | **Your AI-built dashboard is probably lying to you. Here's how to prove it.** |
| Conference talk title | **Continuity, not correctness: signed receipts for pipelines nobody reviewed** |
| Sticker / t-shirt | **Trust receipts, not vibes.** |
| Closer / CTA contexts | **Continuity you can prove.** |

Notes: the TikTok line is already proven in the VO script; keep it verbatim.
The conference title leads with the honest framing because that's the
interesting talk. The sticker line works without any product context, which is
the whole job of a sticker.

## 5. Voice and vocabulary

Voice in one sentence: a developer explaining a clever, small thing to another
developer, dry about the problem, confident about the mechanism, scrupulously
honest about the limits.

**Words we use:**

- **receipt**: the core noun. Every stage signs one.
- **chain** and **link**: receipts link; the chain verifies or breaks at a link.
- **light**: green / yellow / red. The user-facing verdict.
- **fingerprint**: friendly synonym for hash in spoken/social copy.
- **hash** (evidence hash, semantic hash): in docs and CLI, be precise.
- **sign / signed**: always says who vouched, not just what changed.
- **vibe-coded**: names the audience's reality without judging it.
- **continuity**: the thing we actually prove. Use it constantly.
- **control totals**: hashes say "broken," totals say "how broken."
- **tamper-evident**: not tamper-*proof*. Evident. We detect, we don't prevent.
- **intact / broken**: the chain's only two honest endpoints.
- **the exact link**: always pair a failure claim with its locatability.
- **descend from**: dashboard numbers descend from the export. Continuity language.
- **drop in**: how it installs. Small, frictionless, no infrastructure.
- **a human should look**: yellow's whole semantics in five words.

**Words we avoid:**

- **lineage** (as a brand word): retired 2026-06-10. It imports the
  warehouse-lineage category (OpenLineage, dbt, catalogs) we are explicitly
  not in. Say "descend from," "continuity," or "the receipt chain." Plain
  descriptive uses ("warehouse lineage tools") are fine when naming that
  other category.
- **blockchain**: yes, it's a hash chain. No consensus, no tokens, no network,
  just signed files on disk; the word imports a decade of baggage we don't want.
- **trust layer / trustless**: vague, claims more than continuity.
- **seamless**: marketing filler; also false, you do have to add a decorator.
- **AI-powered**: the product is the antidote to unchecked AI output, not AI.
- **revolutionary / game-changing**: it's receipts. Receipts are old. That's the charm.
- **immutable**: overclaims. Files can be edited; we just catch it.
- **guarantee / bulletproof / military-grade**: security copy that invites breakage.
- **ensures accuracy / validates correctness**: forbidden. This is the one claim
  the product explicitly cannot make.
- **source of truth**: we prove descent from a source, not the truth of it.
- **enterprise-grade**: we are proudly the tool you use *before* the enterprise stack.

## 6. The opinionated stance: show the table

For READMEs and landing copy, under a heading like "Dashboards should show
their work":

> We think any dashboard built on verified data should let you see the data.
> Not a tooltip, not an export-on-request: a Data tab, right next to the
> charts, showing the raw verified table the pretty numbers came from. If the
> chain is intact and the light is green, there is no reason to hide the rows,
> and if you find yourself wanting to hide them, that's worth sitting with.
> A chart asks you to believe; a table lets you check. Green light, open table:
> that's the whole standard.

This stance is deliberately a little confrontational ("worth sitting with") and
should stay that way. It gives the project a point of view beyond its feature
set, and it sets up a natural roadmap item (a verified Data tab component)
without promising one.

---

## Quick reference card

- Hero: **The light is green, the data is clean.**
- Yellow: **The light is yellow, a human should look.**
- Red: **The light is red, the chain is broken.**
- Caveat (verbatim, always): *It can't tell you the data is right, but it can
  prove nobody changed it.*
- One word for what we prove: **continuity**.
- One word we never say: **blockchain**.
- No em dashes in README or UI copy (per UPDATE.md section 9). This guide keeps
  the same rule for all public copy.
