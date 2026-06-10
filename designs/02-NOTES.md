# Direction 02 — The Verification Console (devtools-for-data)

## Rationale
- The inline badge answers "is it fine?"; this window answers "where, exactly, and by how much?"
  It is the instrument panel you pop open the moment the light is anything but green.
- The lamp is the room's traffic light: 58px, glowing, readable from across the room. Motion is
  state-coded — slow 4s breathing when green, brisk when yellow, a sharp double-blink alarm when red.
  Calm when green, surgical when red.
- The pipeline is the mental model developers already have (source → clean.py → report.py → dashboard),
  so verification results are pinned to topology, not buried in a table. Hash chips on each node show
  out-of-N == in-of-N+1; a verified link literally carries the hash it proved.
- RED severs the link geometrically (angled stubs + ⚡) and pins a break card *at the break* with
  expected/found chips and the control-totals delta (rows −22 · views −24,889) — same numbers as the
  Proof animation, so marketing and product tell one story.
- YELLOW is deliberately not "green with an asterisk": coverage gap renders as a dashed amber link and
  a ghost node ("no receipt emitted"), unknown key as an amber sig line. Caveats are located, not listed.
- The event log mirrors the CLI verifier's output line-for-line, teaching the CLI for free.
- All hashes derive from the same fakeHash/shortHash as theme.ts, so chips match the animations.

## When devs open this window vs. the inline light
- Inline light (direction 1): ambient, always-on, for dashboard *viewers*. Zero cognitive cost.
- This console: opened by the dashboard *builder* when (a) the light went yellow/red, (b) they're
  wiring receipts into a new pipeline stage and want to watch coverage fill in, or (c) they need to
  show an auditor/stakeholder the chain of custody. It's devtools: nobody keeps it open in production,
  everybody trusts it in a dispute.

## Serving it: Node vs Python hosts
- The console is a static page + the chain's receipt JSON; verification re-runs in-browser via
  WebCrypto Ed25519 (exactly what badge/badge.js already does — this UI sits on that verifier).
- Node host: `tamperSignal.mount(app)` adds `GET /__receipts` (console HTML) and `GET /__receipts/chain.json`;
  the inline badge calls `window.open('/__receipts', 'receipts', 'width=900,height=700')`.
- Python host: same route via a Flask/FastAPI blueprint or `python -m tamper_signal.console` (stdlib
  http.server beside receipts/ — mirrors how badge.html fetches `../receipts/chain.json` today).
- Static fallback: file:// or any static host works since verification is client-side; live "re-verify"
  then re-fetches receipts rather than re-running transforms.

## Open questions
- Live updates: should the console subscribe (SSE/WebSocket) so the lamp flips the moment a pipeline
  rerun lands, or is on-demand re-verify enough for v1?
- Longer chains: >6 nodes needs horizontal scroll + a minimap, or collapsing verified spans ("✓ ×4").
- Should clicking the break card offer a one-click "copy repro" (verify command + expected/found)?
- Trusted keyring UX: where does a dev mark an unknown key as trusted, and is that action itself signed?
- Does the dashboard (window 1) get a postMessage channel so its inline light and this console never
  disagree about state?
