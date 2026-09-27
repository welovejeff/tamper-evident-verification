# Contributing to Tamper Signal

Thanks for looking. Issues, fixes, docs, and ideas are all welcome, and small PRs are the easiest to land. Starter tasks carry the [good first issue](https://github.com/welovejeff/tamper-evident-verification/labels/good%20first%20issue) label.

## Set up

Python 3.11+ and Node 18.17+.

```bash
git clone https://github.com/welovejeff/tamper-evident-verification
cd tamper-evident-verification
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest          # Python suite
npm test        # Node suite (no install step: the package has no runtime dependencies)
tamper-signal demo --no-serve   # the whole story end to end on sample data
```

CI runs both suites on Linux, macOS, and Windows, so keep paths and line endings portable.

## Where things live

`AGENTS.md` ends with a repo map. The short version:

| Path | What it is |
|---|---|
| `tamper_signal/` | Python package and CLI |
| `node/` | JavaScript package and CLI (same chains, byte for byte) |
| `badge/` | Browser surfaces: `light.js` (the status light), `room.js` (the Signal Room), `badge.js` (the shared verifier) |
| `tests/`, `node/test/` | Test suites, including cross-stack golden vectors under `tests/fixtures/` |
| `docs/`, `blog/`, `index.html`, `demo.html` | The tampersignal.com site (GitHub Pages) |

## Rules that keep the project honest

1. **Both stacks produce identical chains.** A change to canonicalization, hashing, receipts, or verification lands in Python and Node together, with a golden-vector test proving they agree.
2. **The browser assets ship twice.** `tamper_signal/static/` must stay byte-identical to `badge/`. After editing a surface: `cp badge/{badge,light,element,table,console,room}.js tamper_signal/static/` (a test fails on drift).
3. **Copy follows `docs/MESSAGING.md`.** Tamper Signal proves continuity, not correctness: "It can't tell you the data is right, but it can prove nobody changed it." Never write that it ensures accuracy or guarantees anything, keep the three verdict lines verbatim, and skip em dashes in README and UI copy.
4. **Never commit key material.** `keys/` and `*.key` are gitignored; keep it that way in tests and examples too.

## Pull requests

- One change per PR, with a test when behavior changes.
- Run `pytest` and `npm test` before pushing.
- Describe what changed and why in plain words; link the issue if there is one.

## Reporting a problem

Open an issue with what you ran, what you expected, and what happened. For a verification result you think is wrong, include the output of `tamper-signal verify <chain.json> --json` (receipts are safe to share; never share `keys/signing.key`).
