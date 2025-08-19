## Tamper‑Evident AI Proof Verification

An interactive, zero-dependency web demo (plus a Python console demo) that shows how to generate and verify tamper‑evident proof tags for AI/computation outputs. Start with a visual primer on the Luhn check digit, then step into an advanced demo that proves data integrity, algorithm integrity, output validity, and proof self‑consistency — all with SHA‑256 hashes.

### What this project includes
- **Intro walkthrough**: `intro.html` explains the Luhn algorithm visually to build intuition for integrity checks.
- **Advanced web demo**: `index.html` + `script.js` generate a proof tag and detect any tampering with the data, the algorithm, or the proof itself.
- **Minimal server**: `server.js` serves static files and defaults to the intro page.
- **Python console demo**: `app.py` mirrors the same proof generation and verification logic using only the Python standard library.

## Quick start (Web demo)
Prerequisites: Node.js 18+ (ES modules enabled).

```bash
npm run dev
```

Open the intro in your browser: [http://localhost:3000](http://localhost:3000)

From the intro, click “Go to Advanced Demo” to open `index.html`. Then:
1. Click “Process Data with AI” to compute averages and final output
2. Inspect the generated proof tag
3. Click “Verify Integrity” (should pass)
4. Use the “Simulate Data Tampering” or “Simulate Proof Tampering” buttons and verify again to see failures

## Python console demo (optional)
Prerequisites: Python 3.8+

```bash
python3 app.py
```

You’ll see the same phases (generation, verification, and tampering simulations) in your terminal with a formatted table and results.

## How it works
The advanced demo creates a proof tag that captures the integrity of three things:
- **Input data**: SHA‑256 of the CSV‑like canonical string of the input table
- **Algorithm ("equation")**: SHA‑256 of the algorithm’s source code string
- **Final output**: The numeric result computed from the processed data

The proof tag is then self‑hashed to become tamper‑evident as a whole.

Example proof tag shape:

```json
{
  "input_data_hash": "<sha256>",
  "equation_hash": "<sha256>",
  "final_output": 205.30,
  "proof_tag_hash": "<sha256 of the object above>"
}
```

Verification recomputes all hashes and the final output and compares them to the proof tag. Any modification breaks one or more checks.

## Project structure
- `server.js` — tiny static server (defaults route `/` to `intro.html`)
- `package.json` — Node ESM config with `dev` script
- `intro.html`, `intro.css`, `intro.js` — visual Luhn primer
- `index.html`, `style.css`, `script.js` — advanced tamper‑evident demo
- `app.py` — Python console version of the demo
- `index.js` — simple Node hello file (not used by the demo)

## Implementation notes
- **Cryptography**: uses SHA‑256
  - Browser: Web Crypto API (`crypto.subtle.digest`)
  - Python: `hashlib.sha256`
- **Privacy**: only hashes are stored in the proof tag; original data never leaves the page
- **Dependencies**: none for the web demo; the server is Node’s built‑in `http` module

## Troubleshooting
- If the server doesn’t start, ensure you’re on Node 18+ and run the command from the repo root.
- You can also open `intro.html` or `index.html` directly in a browser without the server. The server simply provides a convenient default route.

## Roadmap ideas
- Pluggable algorithms beyond the average/sum example
- Export/import proof tags and datasets
- Optional anchoring of proof hashes to external ledgers

tamper-evident-verification
