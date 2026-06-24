---
title: git push fails with 403 when the active gh CLI account silently flips
date: 2026-06-17
category: docs/solutions/developer-experience/
module: deployment
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "Publishing to GitHub Pages by pushing to main on welovejeff/tamper-evident-verification"
  - "The machine has more than one authenticated gh CLI account"
  - "git push returns 403 denied to a different user after earlier pushes in the same session succeeded"
tags:
  - github-pages
  - gh-cli
  - git-push
  - authentication
  - credential-helper
  - multi-account
  - deploy
---

# git push fails with 403 when the active gh CLI account silently flips

## Context

This site publishes by pushing to `main` (GitHub Pages deploys straight from the branch — root `CNAME` + `.nojekyll`, no deploy workflow). Mid-session, a `git push origin main` that should have worked failed with a 403:

```
remote: Permission to welovejeff/tamper-evident-verification.git denied to jmacdonald-ms.
fatal: unable to access 'https://github.com/welovejeff/tamper-evident-verification.git/': The requested URL returned error: 403
```

The confusing part: two earlier pushes in the *same session* had succeeded, and nothing in the repo, remote, or working tree had changed. The error also named an unexpected user (`jmacdonald-ms`) instead of the expected one (`welovejeff`).

The machine has **two** authenticated GitHub CLI accounts — `welovejeff` (push access to this repo) and `jmacdonald-ms` (no access) — and the **active** `gh` account had silently flipped to `jmacdonald-ms`. Because git authenticates through the `gh` credential helper, the active gh account governs push permission.

## Guidance

Diagnose which account is active, switch to the one with push access, then push.

```bash
# 1. Diagnose — look for "Active account: true" and per-account access
gh auth status
# Shows welovejeff AND jmacdonald-ms authenticated; active had flipped to jmacdonald-ms

# 2. Fix — make the push-capable account active
gh auth switch --user welovejeff

# 3. Push
git push origin main
```

Verify the active account, and (since Pages deploys from `main`) that the build actually ran:

```bash
gh auth status   # welovejeff -> "Active account: true"
gh api repos/welovejeff/tamper-evident-verification/pages/builds/latest --jq '.status'
# wait for: built
```

## Why This Matters

git here does not carry its own token — it delegates to the `gh` credential helper, so push permission is decided by whichever gh account is **active**, not by the remote URL or a standalone PAT. With multiple accounts authenticated, the active one can change mid-session (another `gh` command, a context switch, keychain state), so a session that pushed successfully earlier is **no guarantee** the next push will. The 403 looks like a credentials or remote-URL problem and sends you debugging the wrong things; the real lever is the active-account state.

## When to Apply

- Before pushing/publishing to this repo when more than one gh account is authenticated.
- Any time `git push` returns `403 ... denied to <some-other-user>` — read the username in the error; it tells you the wrong account is active.
- When a push that worked earlier in the session suddenly fails with no config change.

## Examples

Failing path (active account is the wrong one):

```bash
$ git push origin main
remote: Permission to welovejeff/tamper-evident-verification.git denied to jmacdonald-ms.
fatal: ... The requested URL returned error: 403
```

Working path (assert the right account in one step, then push):

```bash
$ gh auth switch --user welovejeff && git push origin main
✓ Switched active account for github.com to welovejeff
   336b83d..fdad0cc  main -> main
```

If the second account is not needed on this machine, removing it eliminates the ambiguity entirely:

```bash
gh auth logout --user jmacdonald-ms
```

## Related

- No related docs in `docs/solutions/` at time of writing. The deploy mechanism (Pages builds from `main`, verified via the `pages/builds/latest` API) is the natural companion fact when this recurs.
