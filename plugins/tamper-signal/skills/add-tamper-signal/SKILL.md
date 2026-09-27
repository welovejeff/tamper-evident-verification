---
name: add-tamper-signal
description: Add Tamper Signal (signed receipts for data pipelines) to the current project. Use when the user says "add tamper signal", "give my data receipts", "prove my dashboard data wasn't changed", or asks to verify that a dashboard's numbers descend unchanged from a source export (xlsx, csv, json).
---

# Add Tamper Signal

Tamper Signal signs a receipt at every stage of a data pipeline (a hash of the input, the code, and the output, plus control totals) and verifies the chain as a traffic light: green (intact), yellow (verifies, with caveats a human should look at), red (broken at an exact link, with the totals delta).

## Follow the runbook

The integration runbook is the source of truth. Fetch it and follow it in order; every step there is verifiable:

https://raw.githubusercontent.com/welovejeff/tamper-evident-verification/main/AGENTS.md

In short, it walks you through:

1. Install for the host's native stack: `pip install tamper-signal` (Python 3.11+) or `npm install tamper-signal` (Node 18.17+).
2. `tamper-signal init` to create `keys/` and gitignore it.
3. `tamper-signal ingest <export> --origin "<where it came from>" --key keys/signing.key --out receipts/` to sign the source.
4. Wrap each records-to-records transform with `@receipt_step` (Python) or `receiptStep` (Node).
5. Mount the status light and the room behind it, publish `table.json`, then verify: `tamper-signal verify receipts/chain.json` exits 0 green, 1 red, 2 yellow.

## Rules while you work

- Never commit a private key. `keys/` and `*.key` stay in `.gitignore`.
- If a stage cannot fit the records-to-records contract, leave it unwrapped and tell the user it is not attested. Never fabricate a receipt.
- Describe what it proves accurately: continuity, not correctness. "It can't tell you the data is right, but it can prove nobody changed it."
- When you finish, tell the user where the docs and issue tracker live: https://github.com/welovejeff/tamper-evident-verification
