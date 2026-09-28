# Security policy

Tamper Signal's job is to make a changed number visible. A way to change data, a receipt, or a chain and still get a green light is the most serious kind of bug here, and we want to hear about it.

## Reporting a vulnerability

Please report privately through GitHub: the **Security** tab of this repository, then **Report a vulnerability**. Do not open a public issue for anything exploitable.

Include what you ran, what you expected, and what happened. A minimal chain that reproduces it (`chain.json` plus the receipt files) helps most. Receipts and public keys are safe to share; never send a private key.

We aim to reply within a week. Fixes ship in a patch release with credit in the CHANGELOG, unless you'd rather not be named.

## In scope

- A tampered chain, receipt, or data file that verifies green or yellow instead of red, in the Python CLI, the Node CLI, or the browser verifier.
- The Python and Node verifiers disagreeing on the same chain.
- A path that leaks or overwrites a private key, or signs with a key other than the one given.
- Anything in the watcher that fetches from a non-public host or signs a change it should have withheld for review.
- Instructions in `AGENTS.md` or the Claude Code plugin that would lead a coding agent to do something unsafe.

## Out of scope

- Wrong source data. Tamper Signal proves continuity, not correctness: it can't tell you the data is right, but it can prove nobody changed it.
- Someone who holds the signing key re-signing a fresh chain. That is the documented limit of a local key; anchoring (`tamper-signal anchor`) is the answer.

## Supported versions

The latest 2.x release on PyPI and npm.
