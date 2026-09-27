---
title: "growth: +10 GitHub stars in 7 days (content SEO/GEO + launch)"
type: growth
date: 2026-09-26
evidence: docs/plans/2026-09-26-001-growth-github-stars-evidence.md
---

> **How this was made:** a 9-agent workflow. Four research sweeps (repo/site audit, star-growth evidence, SEO + GEO, channel map), three competing strategies (launch spike, compounding SEO/GEO, conversion + warm network), a synthesis that scored them, and an adversarial red-team pass that fixed 1 blocker and 5 major issues. Baseline on 2026-09-26: 2 stars (1 external), 0 forks, last push 2026-07-13. Cited findings are in the evidence file.

# Tamper Signal: +10 GitHub stars by Saturday 2026-10-03

## Status (updated Sun 2026-09-27)

**Done on branch `claude/github-stars-growth-strategy-us37ov` (merge to ship):**

| Plan item | Where |
|---|---|
| Demo runs after a plain pip install, in its own folder | `tamper_signal/_demo/`, `tamper_signal/demo.py`, `tests/test_demo.py` |
| `receipts` hints now say `tamper-signal`; docs + source links in CLI output | `tamper_signal/cli.py`, `node/cli.js`, `badge/room.js` |
| README hero, absolute images for PyPI, badges, PyPI metadata | `README.md`, `pyproject.toml` |
| Star path: hero button, demo closing block, blog try-it box | `index.html`, `demo.html`, `blog/*.html` |
| `llms.txt`, sitemap, blog index JSON-LD | `llms.txt`, `sitemap.xml`, `blog/index.html` |
| Comparison page (Brief 2) | `docs/compare.html` |
| Tutorial post (Brief 1), pulled forward from week 2 | `blog/where-did-my-pandas-rows-go.html`; dev.to copy with canonical URL in `docs/blog/` |
| Checklist post (Brief 3), pulled forward from week 3 | `blog/check-your-ai-dashboard-numbers.html`; dev.to copy in `docs/blog/` |
| Em dashes out of site copy | `blog/`, `docs/`, `index.html`, `demo.html` |
| Demo page fits a 390px phone | `demo.html`, `badge/room.js` |
| Claude Code plugin + Context7 config (GEO for coding agents) | `.claude-plugin/`, `plugins/tamper-signal/`, `context7.json` |
| CONTRIBUTING, starter issues #63 #64 #65 #67 #68 #71 | `CONTRIBUTING.md`, GitHub issues. First contributor (fatihcvs) opened PRs #69 and #70 within hours; both reviewed, small changes requested |
| Release check script, social preview image | `scripts/check-release.sh`, `docs/media/social-preview.png` |

**HN gate decided (Sun 9/27): Path N.** No established HN account, so no Show HN this week. Odds of +10 by Sat drop to about 20%. Changes to the calendar:
- Warm waves 1a and 1b widen to 12-15 people each; wave 2 goes out Wed if the repo is under 6 stars (was: under 4 from wave 1).
- Tue: r/dataengineering (moved up from Thu) and the pandas tutorial on dev.to (moved up from week 2), in the Show HN slot.
- Thu: r/ClaudeCode plus r/SideProject. Fri: r/coolgithubprojects plus r/opensource (Promotional flair).
- Mon: optional email to hn@ycombinator.com asking about a later Show HN, and create a Product Hunt account so a week-2 or week-3 launch is possible. Take part in HN comments genuinely in the meantime.
- The launch kit (private page) carries every step and draft in this order.

**Yours (in order):**
1. Merge the PR; the site deploys from `main`.
2. `git tag v2.1.0 && git push origin v2.1.0`, wait for `release.yml`, create the GitHub Release from the CHANGELOG, then `scripts/check-release.sh 2.1.0`. No outreach until it prints "All checks passed."
3. Settings: upload `docs/media/social-preview.png` as the social preview, enable Discussions, add topics `hacktoberfest` `data-provenance` `audit-trail` `pandas`, pin the repo on your profile.
4. Submit the repo at context7.com/add-library.
5. The HN gate decision, the warm list, and every post in the appendix (your voice).
6. Close #59 (v2.0 shipped) and decide on PR #60.


## 1. Bottom line

**Getting +10 stars (2 to 12+) by Sat Oct 3 is less likely than not, about 35%. It depends on two things: 16-24 personal one-to-one asks sent Sun-Mon, and one hand-written Show HN on Tue Sep 29. The Show HN only happens if you already have an established HN account.** This week, content SEO/GEO helps visitors convert and gives you pages to link in replies. It starts paying off in stars in weeks 3-12.

- **Probability (my estimate):** about 40% with an established HN account (Path H), about 20% without one (Path N), and 75-80% once a Show HN has 8+ points by 15:00 ET Tuesday.
- **Do first:** fix the funnel on Saturday. 2.1.0 was never published, `tamper-signal demo` crashes outside a clone, and no page asks for a star. Everything that ships in the package must land before the tag.
- **Two honesty rules for every draft:** the README's "22 rows" TikTok story is an illustration, not something that happened to you. Red means "changed between signed steps". A wrapped step that drops rows is signed and stays green; `--warn-drift` shows it as yellow.

## 2. The star math

| Source | Low | High | Evidence basis |
|---|---|---|---|
| Warm 1:1 wave 1 (16-24 people, Sun-Mon) | 2 | 6 | Preevy got its first 100 stars from personal outreach ([star-history, 2023](https://www.star-history.com/blog/playbook-for-more-github-stars/)). The rate is my estimate (about half open it, 25-40% of those star). No 2024-26 data |
| Warm wave 2 (weaker ties, Wed, only if wave 1 < 4) | 0 | 3 | Same basis, lower rate (estimate) |
| Show HN, Tue (Path H only) | 0 | 20 | About 1.4 stars per upvote, 92% within 48h. Median post 2 points, 90th percentile 24 ([danfking, 188k Show HNs](https://danfking.github.io/blog/2026/04/23/show-hn-by-the-numbers/)). Halo: 37 points, 80 stars |
| r/dataengineering + r/ClaudeCode (Thu) | 0 | 5 | Rules come from third-party mirrors. A 2026 small-repo retro got "near zero" from Reddit ([Batty](https://dev.to/battyterm/building-in-public-our-open-source-growth-dashboard-after-4-weeks-55hd)) |
| r/Python Sunday thread + r/coolgithubprojects | 0 | 3 | Estimate. Thread replies get little exposure |
| LinkedIn + X/Bluesky | 0 | 4 | No published LinkedIn-to-stars data. Bluesky gave "minimal traffic" (Batty) |
| PyCoder's / JS Weekly / Node Weekly | 0 | 2 | Inclusion not guaranteed ([pycoders.com/submissions](https://pycoders.com/submissions)) |
| Hacktoberfest (Oct 1) + feedback loop | 0 | 2 | One comparable repo had more forks than stars (estimate) |
| Awesome lists, SEO/GEO, Context7 | 0 | 1 | Merge backlogs of 175 to 1.1k items; indexing takes weeks |
| **Total** | **2** | **46** | These highs won't happen together. **Central case: warm ~3-4 + HN ~3 (median post) + everything else ~2 = about +8** |

## 3. Strategy scorecard

5 is best in every column. For effort, 5 means lightest.

| Strategy | P(+10 in 7d) | Solo effort | Compounding | Rule compliance | Evidence | Total |
|---|---|---|---|---|---|---|
| A. Launch spike (HN + Reddit double) | 3 | 2 | 3 | 4 | 4 | 16 |
| **B. Content as payload (SEO/GEO lens)** | 3 | 3 | 5 | 5 | 4 | **20** |
| C. Warm floor only | 2 | 4 | 2 | 5 | 2 | 15 |

**Why B is the spine:**
1. It uses the same two levers as A: warm asks go out before HN traffic, and the Show HN goes up Tuesday.
2. Every content hour also serves the launch. compare.html is the reply link for "isn't this just X?"
3. From A: the release gate and the Thursday Reddit double. From C: the send log, the exclusions, one ask per person, and "at 12 stars, stop asking."

## 4. Before launch (Sat-Sun): conversion fixes

**Rule:** anything that ships in the package must merge before `git tag v2.1.0`. That covers the demo, CLI strings, CLI link lines, README (PyPI long description) and pyproject. Cap the demo fix at 1.5h.

### Ship blockers (Sat, before tagging)

| File | Change | Why |
|---|---|---|
| `tamper_signal/demo.py` (~43-64), new `tamper_signal/_demo/` | Move `examples/make_sample_export.py`, `transform_clean.py`, `transform_aggregate.py` and the sample export into the package. Add a **pytest** test that runs `tamper-signal demo --no-serve` in `tmp_path` | release.yml runs `pytest` itself, so only a pytest test gates publishing. `docs/quickstart.html` line 74 promises this tour |
| `tamper_signal/cli.py` (681; BUNDLE_README 77/82), `node/cli.js` (118/123), `badge/room.js` (221/226/248), `docs/faq.html` (69, 231), `docs/index.html` (75), `CONCEPTS.md` (46), `docs/MESSAGING.md` section 0 | `receipts` to `tamper-signal` | `receipts` is the deprecated alias |
| `demo.py` (after 164), `cli.py` (after `init`, epilog ~2271) | One plain line with the docs and repo URLs. Never under `--json` | No path from the terminal back to the repo |
| `README.md` | New hero (Appendix F). Socket badges on line 5 to 2.1.0, CI badge, absolute `raw.githubusercontent.com` image URLs (lines 27/135/164/178), remove the em dashes (4 lines) | 4 images 404 on PyPI; copy rules forbid em dashes |
| `pyproject.toml` | Keywords, classifiers (no "Quality Assurance"), Documentation/Changelog/Issues URLs | PyPI shows no keywords or classifiers |

### Release (Sun 10:00, gates all outreach)
1. `git tag v2.1.0 && git push origin v2.1.0`, then watch the test, pypi and npm jobs (NPM_TOKEN).
2. `npm view tamper-signal@2.1.0 exports` lists `./room`; PyPI shows 2.1.0 with working images.
3. In a fresh venv: `pip install tamper-signal && tamper-signal demo --no-serve`.
4. Create the GitHub Release "v2.1.0: one light, one room" by hand from CHANGELOG, with `light.gif` attached.

### Star path and hygiene (Sun, deploys separately)

| Where | Change |
|---|---|
| `index.html` 569, `showGitHubStars()` | "visit GitHub" becomes "Star on GitHub"; show the count only at 25+ |
| `demo.html` (before footer) | Closing block: copy-to-your-AI prompt, pip/npm, Star on GitHub |
| `blog/*.html` | Shared end box (try it, source and star). Remove em dashes in `vibe-coded-pipelines-fail-silently.html` (11 lines, including the title) |
| `llms.txt` | Fix lines 5/7/9, add the 4 missing posts, Live demo to `/demo.html`, "Current version: 2.1.0", remove the line 22 em dash |
| `AGENTS.md` step 9 | One neutral line: include the repo link in the handoff summary. **Never a star ask** |
| `sitemap.xml`, `blog/index.html` | Add `one-light-one-room.html`, bump lastmods, add the missing BlogPosting |
| GitHub | Social preview (og-card at 1280x640), enable Discussions, close #59, merge or close PR #60, topics `data-provenance` `audit-trail` `pandas`, **pin the repo on your profile** |

## 5. Day-by-day calendar

Times are ET (EDT, UTC-4, confirmed from commit timezone). Total is about 20h, and no day goes over 3.25h. Week 2 gets the dev.to tutorial (Brief 1) and the Slack posts.

### Sat 2026-09-26 (3h)

| Time (ET / UTC) | Action | Effort |
|---|---|---|
| 10:00 / 14:00 | Package the demo plus the pytest test (hard 1.5h cap) | 1.5h |
| 11:30 / 15:30 | README hero, pyproject, `receipts` strings, CLI link lines. Merge to main | 1h |
| 12:30 / 16:30 | Warm list: 25-35 people you know **who have GitHub accounts**, plus a send-log sheet | 0.25h |
| 12:45 / 16:45 | **HN gate.** Established account with months of genuine history: Path H. New or none: Path N | 0.25h |

### Sun 2026-09-27 (3h)

| Time | Action | Effort |
|---|---|---|
| 10:00 / 14:00 | Tag, verify the release (section 4), publish the Release. **If it's broken, fix it before any outreach** | 1h |
| 11:00 / 15:00 | Star CTAs, llms.txt, sitemap, GitHub settings, pin the repo | 1h |
| 12:00 / 16:00 | r/Python "Sunday Daily Thread" reply (Appendix B3) | 0.25h |
| 12:15 / 16:15 | PyCoder's form + editor@cooperpress.com (Appendix D) | 0.25h |
| 14:00 / 18:00 | Warm wave 1a: 8-12 personal messages (Appendix G) | 0.5h |

### Mon 2026-09-28 (2.75h)

| Time | Action | Effort |
|---|---|---|
| 08:00 / 12:00 | Warm wave 1b: 8-12 professional contacts | 0.75h |
| 11:00 / 15:00 | `docs/compare.html` lean v1 (Brief 2) + 2 FAQ entries (1.25h cap) | 1.25h |
| 19:00 / 23:00 | **Path H:** hand-write the maker comment (Appendix A). **Path N:** one short email to hn@ycombinator.com asking whether a Show HN is OK | 0.5h |

### Tue 2026-09-29 (3.25h)

| Time | Action | Effort |
|---|---|---|
| 09:00 / 13:00 (or any 12-17 UTC slot where you can clear 3h) | **Path H:** submit the Show HN (repo link) and post the maker comment within 5 minutes | 0.25h |
| next 2.5h | Reply within 15 minutes. Link compare.html when it fits | 2.5h |
| 20:00 / 00:00 Wed | Answer warm replies, log feedback | 0.5h |

Path N: move r/dataengineering to today (Appendix B1) and keep r/ClaudeCode on Thursday.

### Wed 2026-09-30 (2h)

| Time | Action | Effort |
|---|---|---|
| 08:00 / 12:00 | LinkedIn (Appendix C) + X/Bluesky thread (Appendix E) | 1h |
| 10:00 / 14:00 | Warm checkpoint. Send wave 2 only if wave 1 produced fewer than 4 stars | 0.5h |
| 13:00 / 17:00 | Turn HN or Reddit critiques into issues that credit the commenter | 0.5h |

### Thu 2026-10-01 (2.25h)

| Time | Action | Effort |
|---|---|---|
| 08:30 / 12:30 | r/dataengineering, Open Source flair (skip if it was posted Tue) | 0.75h |
| 11:00 / 15:00 | Hacktoberfest topic, 3 real good first issues (Node `doctor`, Node `demo`, JS xlsx ingest), CONTRIBUTING.md | 0.75h |
| 12:00 / 16:00 | r/ClaudeCode, "Built with Claude" flair (Appendix B2) | 0.75h |

### Fri 2026-10-02 (2h)

| Time | Action | Effort |
|---|---|---|
| 09:00 / 13:00 | r/coolgithubprojects: "[Python/JS] Tamper Signal - signed receipts and a traffic light for data pipelines" | 0.25h |
| 10:00 / 14:00 | Thank each person who gave feedback, linking the issue or fix | 0.5h |
| 11:00 / 15:00 | awesome-vibe-coding PR, bureado supply-chain PR, awesome-claude-code web form (human-written) | 0.5h |
| 14:00 / 18:00 | Context7 + `context7.json`; sitemap to Search Console, Bing, Brave | 0.75h |

### Sat 2026-10-03 (1.5h)

| Time | Action | Effort |
|---|---|---|
| 10:00 / 14:00 | Pull starred_at and referrers, attribution table, record the KPI | 0.5h |
| 10:30 / 14:30 | GEO baseline: 5 prompts x 4 engines | 0.75h |
| 11:15 / 15:15 | Week-2 plan | 0.25h |

## 6. Content SEO

tampersignal.com ranks for none of 12+ unbranded queries, even a near-exact title of its own post. This week, content converts visitors and gives each post something to link. Expect 0-1 stars from content by Oct 3. Every brief must teach something that works without the tool and must never claim correctness.

| # | Target query | Format and angle | URL | Ship | Time to impact |
|---|---|---|---|---|---|
| 2 | "great expectations alternative small team", "pandera vs great expectations", "in-toto for data" | Answer first, visible table (question answered, infra, proves what, fails how, setup time), "use X when", dated line. "Not lineage", never "lineage" | `/docs/compare.html` | Mon 9/28 | Reply link now; citations 4-12 weeks |
| 5 | "data provenance python library" | README first-screen definition sentence | `README.md` | Sat 9/26 | GitHub search: days |
| 1 | "why did my dataframe lose rows", "detect silent row drops pandas" | dev.to-native tutorial: 3-stage pipeline, a buggy filter whose drop shows in its own receipt (yellow with `--warn-drift`), then a hand edit between steps turns it red at the exact link. Fair table vs dframe-trace, Pandera, GE. "Honest limitations" | dev.to | Week 2 (Tue 10/6) | 2-8 weeks |
| 3 | "AI dashboard numbers don't match export" | 5-step manual checklist, then "your AI assistant can set this up" | `/blog/check-your-ai-dashboard-numbers.html` | Week 3 | 4-12 weeks |
| 4 | "hash chain data integrity python" | Build-it-yourself in ~60 lines, where the toy version breaks. Never "blockchain" | `/blog/tamper-evident-pipeline-60-lines.html` | Week 4 | 4-12 weeks |

## 7. GEO: answer engines and coding agents

Coding agents are the only AI surface you can reach this week. Answer engines need indexing, freshness and comparison-shaped pages, which take weeks.

| Move | Serves | Ship | Time to impact |
|---|---|---|---|
| Accurate `llms.txt`, AGENTS.md link line, CLI strings | Claude Code, Cursor | Sat-Sun | Immediate for agents. 97% of llms.txt files get no answer-engine requests ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)) |
| `compare.html` with visible table + FAQ | ChatGPT, Perplexity, AI Mode ("best X" and comparison pages are 43.8% of ChatGPT-cited page types, [Ahrefs](https://ahrefs.com/blog/best-lists-research/)) | Mon | 4-12 weeks |
| Freshness: 2.1.0 release, dated "Last updated" lines | All engines (cited pages run ~26% fresher) | Sun | Weeks |
| Search Console, Bing, Brave, IndexNow | Bing feeds ChatGPT/Copilot; Brave feeds Claude | Fri | Days to index |
| Context7 + `context7.json` (exclude legacy, designs, animations, docs/plans, docs/brainstorms; rules from AGENTS.md) | Agents that already know the name | Fri | ~24h after approval |
| Citable threads: HN, Reddit, Discussions Q&A with real questions | Perplexity, Google AI surfaces | Tue-Fri | ChatGPT's Reddit citations fell 94% after Aug 14 ([Pierview](https://www.pierview.ai/guides/reddit-citations-chatgpt-perplexity-decline-2026)) |
| Canonical + SoftwareApplication JSON-LD | Google | Week 2 | Low priority: no measured citation uplift |
| `skills/tamper-signal/SKILL.md` + awesome-claude-skills | Claude Code skill browsers | After 10 stars | 1-4 weeks |

**Baseline prompts** (log cited yes/no in ChatGPT search, Perplexity, AI Mode, Claude; re-run monthly):
1. "python library to prove my dashboard data wasn't changed"
2. "how do I detect silently dropped rows in a pandas pipeline"
3. "signed receipts for data pipeline stages"
4. "lightweight alternative to great expectations for a CSV to dashboard pipeline"
5. "how to verify an AI-built dashboard matches the source export"

## 8. Channel rules and blockers

Check every live sidebar before posting. The Reddit rules below come from mirrors because reddit.com blocked the research fetches.

| Channel | Status | Rule |
|---|---|---|
| HN Show HN | Path H only | [/showlim](https://news.ycombinator.com/showlim): newcomers should "become a good contributor" first. No AI-written or AI-edited text. No upvote asks. Link something people can try (repo or demo), not a blog post |
| Lobsters | Blocked | Invite-only; no `show` tag for 70 days |
| Product Hunt | Blocked (new account) | 7-day wait; no upvote asks |
| travisvn/awesome-claude-skills | Blocked until 10 stars | Auto-closes under 10 |
| awesome-claude-code | Eligible, slow | 14+ days old plus later commits (met). Web-UI form only, human-written. Maintainer warns not to treat the list as promotion |
| awesome-python, awesome-data-engineering | Not yet | Weighs PyPI downloads / needs 30 days and outside users |
| r/programming | Blocked | Bans LLM-related and "I made this" posts |
| r/Python | Thread only | Standalone showcases removed |
| r/dataengineering | Once a month | Disclose authorship; Open Source flair |
| r/ClaudeAI, r/cursor, r/analytics | Gated | Ask mods first; r/analytics needs 5 comment karma |
| Console.dev, Data Engineering Weekly | Ineligible | Pre-1.0 only / no tool promotion |
| GitHub Trending | Unreachable | Lowest daily Python entry already had 1,167+ stars |

### Never do: stars
1. Bought or automated stars. GitHub deleted 90% of repos caught running fake-star campaigns ([StarScout](https://arxiv.org/html/2412.13459v2)).
2. Star-for-star exchanges and points networks (githubstarmate, upvote.club, "grow together" threads).
3. Starring from a second GitHub account of your own.
4. Anything offered in return for a star, including credit that depends on starring.

### Never do: votes and outreach
1. Asking anyone to upvote or comment on HN, Reddit or PH, including friends, Slack and Discord.
2. Working around /showlim: a new account launching a Show HN, a second account, or resubmitting the same project as a regular story after a refusal.
3. Putting the HN link in warm messages, or deleting and reposting.
4. Mass DMs, or emailing addresses taken from GitHub profiles ([AUP section 7](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)).
5. Asking students, direct reports, or anyone you grade or manage. Nudging people who didn't reply.

### Never do: copy
1. AI-written or AI-edited HN posts or comments.
2. A star ask inside AGENTS.md (reads as prompt injection).
3. Presenting "22 rows" as something that happened to you, unless it did.
4. Implying it catches wrong logic. A signed step that drops rows is green (yellow with `--warn-drift`). Never "ensures accuracy", "guarantees", "blockchain", "immutable" or "trust layer".

## 9. Tracking and pivot rules

GA4 can't attribute stars: consent is denied by default and traffic is below modeling thresholds. GitHub referrers show domains only, so skip `?ref=`. Use UTMs only on tampersignal.com links. The send log covers messaging apps that strip referrers.

### Daily 10-minute routine (09:00 ET)
1. Match `starred_at` to the send log and post times.
2. Save referrers and views to dated files (GitHub keeps 14 days).
3. One line in the log: stars today, likely source, what to change.

```bash
R=welovejeff/tamper-evident-verification
gh api -H "Accept: application/vnd.github.star+json" "repos/$R/stargazers" --paginate \
  --jq '.[] | [.starred_at, .user.login] | @tsv'
gh api "repos/$R/traffic/popular/referrers" > "referrers-$(date +%F).json"
gh api "repos/$R/traffic/views" > "views-$(date +%F).json"
```

### Pivot rules

| When | If | Then |
|---|---|---|
| Sat, 1.5h into the demo fix | pytest demo test not passing | Tag without it, change quickstart line 74 to "clone, then demo", lead posts with the browser demo |
| Sun, after the tag | PyPI/npm not at 2.1.0 or `./room` missing | Hold every warm ask and post until fixed. Never send people to a broken install |
| Sat HN gate | Path N | No Show HN. Email hn@ycombinator.com Mon; post only if they say yes. r/dataengineering moves to Tue |
| Mon 18:00 | Wave 1 < 2 stars | Ask 2 repliers where they stopped, fix it, send wave 2 Wed |
| Tue 15:00 | Show HN under 5 points | Answer comments only, send wave 2 Wed, keep Thursday Reddit, add r/SideProject Fri |
| Tue 15:00 | 20+ points or front page | Clear Wednesday for the thread, ship one requested fix as 2.1.1 within 24h |
| Any Reddit post | Removed, or invisible in incognito after 15 min | One modmail, no repost. Use r/SideProject or r/opensource (Promotional flair) instead |
| Any time | 12+ stars | Stop asking. Switch to the Claude skill, Brief 1, compounding work |
| Sat 10/3 | Under +10 | Report the true number. Weekly briefs, Product Hunt prep 2-3 weeks out, monthly GEO re-run |

## 10. Appendix: drafts

Edit every draft into your own voice. HN and awesome-claude-code forbid AI-written text, so for those you get facts, not text to paste. Bracketed lines are claims only you can make.

### A. Show HN (Path H only; you write the comment)

**Title (75 chars):** `Show HN: Tamper Signal - signed receipts for each stage of a data pipeline`
**Backup:** `Show HN: Tamper Signal - find the pipeline step that changed your numbers`

**First comment beats (150-250 words, yours):**
1. **[Who you are and why you built it. Only what actually happened.]** If the TikTok scenario is illustrative, call it "the failure I kept worrying about".
2. **Try it:** tampersignal.com/demo.html (no install). `pip install tamper-signal` / `npm install tamper-signal`. `tamper-signal demo --no-serve` only if Saturday's fix shipped.
3. **How it works:** each stage signs an Ed25519 receipt with hashes of input, code and output plus control totals. The receipts are plain files linked in chain.json. `verify` exits 0 green, 1 red, 2 yellow; red names the link and the delta. The browser light re-verifies. Python and Node read the same chains.
4. **Limits:** "It can't tell you the data is right, but it can prove nobody changed it." A wrapped step that drops rows is signed; its receipt shows the drop, and `--warn-drift` flags it yellow. The key holder can re-sign a fresh chain; optional Sigstore anchoring covers existence at a time.
5. **Differs, built with Claude Code, ask for critique of the trust model.** Link /docs/compare.html.

### B1. r/dataengineering (Open Source flair)

**Title:** Open source: signed receipts for each pipeline stage, so verify can name the step where the numbers changed

> Disclosure: I'm the author. MIT licensed, no paid tier.
>
> Small pipelines (export, a few Python transforms, a dashboard) fail quietly. A filter drops rows, a file gets hand-edited between steps, and nothing errors.
>
> Tamper Signal has every stage sign an Ed25519 receipt: a hash of its input, its code and its output, plus control totals (row count, per-column sums, null counts). Receipts are plain JSON files linked in chain.json. `tamper-signal verify` re-checks every signature and link and exits 0 (green), 1 (red) or 2 (yellow), so it drops into CI. If data changed between signed steps, it names the exact link and the delta, e.g. `row_count 48212 -> 48190 (-22)`. A step that drops rows records the drop in its own receipt, and `--warn-drift` flags it yellow for pipelines that should preserve totals.
>
> Design choices I'd like critique on:
> - The semantic hash is format-agnostic, so an xlsx ingest verifies against a CSV or JSON copy of the same data.
> - Control totals only sum plain decimals. "1,234" is skipped on purpose (locale ambiguity).
> - The key holder can re-sign a fresh chain. Optional Sigstore anchoring records that a chain existed at a time.
>
> Where it sits: dbt tests, Great Expectations and Pandera check rules you write. OpenLineage records warehouse lineage metadata. This proves continuity, not correctness: it can't tell you the data is right, but it can prove nobody changed it. Comparison: tampersignal.com/docs/compare.html
>
> `pip install tamper-signal` or `npm install tamper-signal` (same chains). Repo: github.com/welovejeff/tamper-evident-verification
>
> What would stop you from using this in a real pipeline?

### B2. r/ClaudeCode ("Built with Claude" flair)

**Title:** Built with Claude Code: signed receipts that show which step changed your dashboard's numbers

> I built Tamper Signal with Claude Code; most commits carry a Claude co-author line. [One or two sentences, in your words, on why.]
>
> Every pipeline stage signs a receipt: a fingerprint of the data in, the code that ran, and the data out, plus row counts and column totals. A status light on the dashboard re-checks the receipts in the browser:
>
> The light is green, the data is clean.
> The light is yellow, a human should look.
> The light is red, the chain is broken.
>
> Red points at the exact step and the delta. A step that drops rows shows it in its own receipt.
>
> The agent part: the repo has an AGENTS.md runbook. Tell your agent "add tamper signal" and it installs the package, signs the source export, wraps the transforms that fit, and mounts the light.
> Or in Claude Code: `/plugin marketplace add welovejeff/tamper-evident-verification`, then `/plugin install tamper-signal@welovejeff`.
>
> What it doesn't do: it can't tell you the data is right, but it can prove nobody changed it.
>
> [light.gif]
> Demo (no install): tampersignal.com/demo.html
> Repo: github.com/welovejeff/tamper-evident-verification
>
> My project, MIT. Where does the agent flow break for you?

### B3. r/Python Sunday Daily Thread reply

> **Tamper Signal** (I'm the author, MIT)
>
> **What My Project Does:** signs an Ed25519 receipt at every pipeline stage (hash of input, code and output, plus row counts and column totals) and verifies the chain as green, yellow or red. Red names the exact stage and the delta.
>
> **Target Audience:** small export-to-dashboard pipelines, especially AI-written ones. 2.x, Python 3.11+. No server, no warehouse.
>
> **Comparison:** Pandera and Great Expectations check rules you write. This checks that, when every stage is wrapped, the data your dashboard reads descends from the original export. Continuity, not correctness.
>
> ```python
> from tamper_signal import receipt_step
>
> @receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
> def clean(df):
>     return df[df["campaign_name"].notna()]
> ```
>
> `tamper-signal verify receipts/chain.json` exits 0/1/2 for CI. Repo: github.com/welovejeff/tamper-evident-verification

### C. LinkedIn (Wed 08:00 ET, link in first comment)

> Your marketing team exports a month of TikTok numbers. Someone builds a dashboard on it with an AI assistant in an afternoon. It looks great.
>
> Then a cleanup step quietly drops a few rows, or someone edits a file by hand along the way. The chart still looks plausible, and nothing flags it.
>
> I built Tamper Signal, a free, open-source tool for that gap. Every step that touches the data leaves a signed receipt: what came in, what ran, what went out, and the row counts, so a drop is visible instead of silent. A small status light on the dashboard checks the receipts.
>
> The light is green, the data is clean.
> The light is yellow, a human should look.
> The light is red, the chain is broken.
>
> If anything changed between signed steps, it goes red at the exact step and shows how much moved.
>
> What it can't do: it can't tell you the data is right, but it can prove nobody changed it.
>
> Your AI assistant can do the setup: tell it "add tamper signal" and it follows the guide in the repo.
>
> If you build dashboards with AI tools, try the 60-second demo (first comment) and tell me what confused you. A star on GitHub helps other people find it.

**First comment:** Demo, no install: https://tampersignal.com/demo.html?utm_source=linkedin&utm_medium=social&utm_campaign=launch-2026-09 · Source: https://github.com/welovejeff/tamper-evident-verification

**Second comment (if the first gets replies):** The five checks to run when an AI-built dashboard disagrees with its export, no install needed: https://tampersignal.com/blog/check-your-ai-dashboard-numbers.html?utm_source=linkedin&utm_medium=social&utm_campaign=launch-2026-09

### D. Awesome-list and newsletter blurbs

- **awesome-vibe-coding** (bottom of Command Line Tools): `- [Tamper Signal](https://github.com/welovejeff/tamper-evident-verification) - Signed receipts for AI-built data pipelines, verified as a green/yellow/red light.`
- **bureado/awesome-software-supply-chain-security** (Identity, signing and provenance): `- [Tamper Signal](https://github.com/welovejeff/tamper-evident-verification) - Ed25519-signed receipts for each data-pipeline stage, linked into a verifiable chain, with optional Sigstore anchoring.`
- **PyCoder's Weekly:** "tamper-signal: signed receipts and a green/yellow/red verdict for Python data pipelines" + repo URL.
- **editor@cooperpress.com** ("tamper-signal for JavaScript Weekly / Node Weekly"): "Hi, tamper-signal (MIT) signs a receipt at every stage of a JS or Python data pipeline and verifies the chain as a green, yellow or red light. On npm, `receiptStep()` wraps a records-to-records function, and a `<tamper-signal>` web component and React light re-verify the chain in the browser with Web Crypto. It proves continuity, not correctness. npm: npmjs.com/package/tamper-signal · Repo: github.com/welovejeff/tamper-evident-verification. Thanks, Jeff"
- **awesome-claude-code:** type your own words into the web form.

### E. X / Bluesky thread (Wed 08:15 ET)

1. An AI assistant can build a data dashboard in an afternoon. If a cleanup step drops rows or someone edits a file mid-pipeline, nothing crashes and the chart still looks fine. [light.gif]
2. Tamper Signal gives every pipeline step a signed receipt: a fingerprint of the data in, the code that ran, the data out, plus row counts and column totals. A step that drops rows shows it in its own receipt.
3. Verify and you get one light. "The light is green, the data is clean." If the data changed between signed steps, it goes red at the exact step with the delta: row_count 48212 -> 48190 (-22).
4. It can't tell you the data is right, but it can prove nobody changed it. Python + Node, MIT, plain files. Demo: tampersignal.com/demo.html · Repo: github.com/welovejeff/tamper-evident-verification

### F. README hero + star line (replaces the top of `README.md`)

```markdown
# The light is green, the data is clean.

Tamper Signal is an open-source Python and JavaScript library and CLI that signs a receipt at every stage of a data pipeline and verifies the chain as a green, yellow, or red light: lightweight data provenance for export-to-dashboard pipelines.

It can't tell you the data is right, but it can prove nobody changed it.

![The status light going green, yellow, and red inside a dashboard](https://raw.githubusercontent.com/welovejeff/tamper-evident-verification/main/docs/media/light.gif)

**Try it in your browser, no install:** [tampersignal.com/demo.html](https://tampersignal.com/demo.html) · `pip install tamper-signal` · `npm install tamper-signal`

If this is useful, a star helps other people with AI-built dashboards find it.
```

Contributing (line 216): `Issues, ideas and stars all help. Small starter tasks are labeled good first issue.`

### H. r/SideProject (Thu) and r/opensource (Fri, Promotional flair)

**r/SideProject title:** I built signed receipts for AI-built dashboards: a light that goes red at the exact step where the numbers changed

> [One or two sentences, in your words: what made you build it.]
>
> Tamper Signal gives every step of a data pipeline a signed receipt: a fingerprint of the data in, the code that ran, the data out, plus row counts and column totals. A small status light on the dashboard re-checks the receipts in the browser. If a number changed between signed steps, it goes red at that step and shows how much moved.
>
> It can't tell you the data is right, but it can prove nobody changed it.
>
> Demo, no install: https://tampersignal.com/demo.html
> Repo (MIT, Python + JS): https://github.com/welovejeff/tamper-evident-verification
>
> What would make you trust (or not trust) a light like this on a dashboard you didn't build?

**r/opensource title:** Tamper Signal (MIT): signed receipts for every stage of a data pipeline, Python and JavaScript

> I'm the author. Tamper Signal has each pipeline stage sign an Ed25519 receipt (hashes of input, code, and output, plus control totals). Receipts are plain JSON files linked in a chain; `tamper-signal verify` exits 0 green, 1 red, 2 yellow, so it drops into CI, and a browser status light re-checks the same chain.
>
> Continuity, not correctness: it can't tell you the data is right, but it can prove nobody changed it.
>
> Starter issues are labeled good first issue, and a first outside contributor already has two PRs in review.
>
> Repo: https://github.com/welovejeff/tamper-evident-verification
> Demo: https://tampersignal.com/demo.html

### I. Email to the HN moderators (optional, Mon; edit into your own words)

> Subject: Show HN question from a new account
>
> Hi, I maintain Tamper Signal (https://github.com/welovejeff/tamper-evident-verification), an open-source library that signs a receipt at each stage of a data pipeline so a dashboard can prove its numbers weren't changed along the way. My HN account is new. Would a Show HN for it be OK, or should I take part in the community for a while first?
>
> Thanks,
> Jeff

### F2. dev.to cross-posts (the pandas one moves up to Tue 9/29)

Publish `docs/blog/where-did-my-pandas-rows-go.md` (Tue 9/29, in the Show HN slot) and `docs/blog/check-your-ai-dashboard-numbers.md` (Thu 10/8) on dev.to. Both carry `canonical_url` pointing at tampersignal.com, so search credit stays with the site. Read each once in your own voice before publishing; dev.to asks authors to disclose AI assistance.

### G. Warm 1:1 message (personalize each one; never mention HN)

> Hi [name], I've been building an open-source tool called Tamper Signal: every step of a data pipeline signs a receipt, and a status light on the dashboard goes red at the exact step where the numbers changed without a receipt. [One line on why you thought of them.] Would you try the 60-second browser demo (tampersignal.com/demo.html) and tell me one thing that confused you? If it's useful, a star on GitHub helps other people find it: github.com/welovejeff/tamper-evident-verification. No pressure either way.
