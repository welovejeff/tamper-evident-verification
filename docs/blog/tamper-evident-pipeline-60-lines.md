---
title: "A tamper-evident data pipeline in 60 lines of Python: hash chains and signed receipts"
published: false
description: "A hash chain for data integrity in Python: sha256 per stage, an Ed25519 signature per receipt, a verify() that finds the broken link. Then where the toy breaks."
tags: python, security, dataengineering, cryptography
canonical_url: https://tampersignal.com/blog/tamper-evident-pipeline-60-lines.html
---

Here is a small idea that does a lot of work. Every stage of a data pipeline hashes the file it read and the file it wrote, signs those two hashes, and appends the result to a list. Each stage's input hash has to equal the previous stage's output hash, so the list is a hash chain: change a file between two stages and the chain breaks at exactly that link. Give someone the list and a public key and they can check the whole run without taking your word for it.

This post builds it in 60 lines of Python, runs it, and then breaks it five ways, because the toy is the fastest way to see which parts of signing data pipeline outputs are actually hard. The last part shows how [Tamper Signal](https://tampersignal.com/), a small MIT-licensed library, handles each one. Every command and output below was run for this post (Python 3.11, cryptography 50.0.1, pandas 3.0.6, tamper-signal 2.1.0).

## Sixty lines

Three rules. A receipt records a stage's name and the sha256 of its input and output files. An Ed25519 signature means nobody can change those hashes without the key. And receipt N's input must equal receipt N-1's output, so a file swapped between stages breaks a link. Here is `chain.py`, with a two-stage pipeline included (drop orders with no amount, then sum revenue per region):

```python
# chain.py: a tamper-evident pipeline, from scratch
import csv, hashlib, json, sys
from pathlib import Path
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519

def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def signing_key():
    if not Path("signing.key").exists():            # first run: make a keypair
        key = ed25519.Ed25519PrivateKey.generate()
        Path("signing.key").write_bytes(key.private_bytes_raw())
        Path("signing.pub").write_bytes(key.public_key().public_bytes_raw())
    return ed25519.Ed25519PrivateKey.from_private_bytes(Path("signing.key").read_bytes())

def body(r):                                        # the exact bytes we sign
    return json.dumps([r["stage"], r["input"], r["output"]]).encode()

def run_stage(name, fn, src, dst, log="receipts.json"):
    with open(src, newline="") as f:
        rows = fn(list(csv.DictReader(f)))
    with open(dst, "w", newline="") as f:
        csv.writer(f).writerows([rows[0].keys(), *(r.values() for r in rows)])
    receipt = {"stage": name, "input": sha256(src), "output": sha256(dst)}
    receipt["sig"] = signing_key().sign(body(receipt)).hex()
    chain = json.loads(Path(log).read_text()) if Path(log).exists() else []
    Path(log).write_text(json.dumps(chain + [receipt], indent=2) + "\n")
    return f"{name}: signed {dst}"

def verify(log="receipts.json"):
    pub = ed25519.Ed25519PublicKey.from_public_bytes(Path("signing.pub").read_bytes())
    chain = json.loads(Path(log).read_text())
    for i, r in enumerate(chain):
        try:
            pub.verify(bytes.fromhex(r["sig"]), body(r))
        except InvalidSignature:
            return f"BROKEN: bad signature on receipt {i} ({r['stage']})"
        if i > 0 and r["input"] != chain[i - 1]["output"]:
            return (f"BROKEN at link {i - 1} -> {i} ({r['stage']}): input "
                    f"{r['input'][:12]} != previous output {chain[i - 1]['output'][:12]}")
    return f"OK: {len(chain)} receipts, every signature valid, every link matches"

def clean(rows):                                    # drop orders with no amount
    return [r for r in rows if r["amount"].strip()]

def totals(rows):                                   # revenue per region
    sums = {}
    for r in rows:
        sums[r["region"]] = sums.get(r["region"], 0) + float(r["amount"])
    return [{"region": k, "amount": round(v, 2)} for k, v in sorted(sums.items())]

STAGES = {"clean": (clean, "orders.csv", "clean.csv"),
          "totals": (totals, "clean.csv", "totals.csv")}

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "clean":
        Path("receipts.json").unlink(missing_ok=True)   # first stage: fresh chain
    print(verify(*sys.argv[2:]) if cmd == "verify" else run_stage(cmd, *STAGES[cmd]))
```

`body()` signs exactly three fields, so there is no ambiguity about which bytes the signature covers. The first receipt's input hash is the raw export's fingerprint, which pins the source. And `verify()` checks each signature before its link, because a link only counts if the receipt holding it is genuine.

## Run it

Eight orders, two with no amount:

```text
$ wc -l chain.py
60 chain.py
$ cat orders.csv
order_id,region,amount
1001,US,120.00
1002,EU,80.50
1003,US,
1004,APAC,210.00
1005,EU,45.25
1006,US,99.99
1007,APAC,60.00
1008,EU,
$ python chain.py clean
clean: signed clean.csv
$ python chain.py totals
totals: signed totals.csv
$ cat receipts.json
[
  {
    "stage": "clean",
    "input": "a092ffa15fd2981e7f34d9ce7fbff18e2d3eb5a1c8becfa171a3977cc52cdeac",
    "output": "b6015924d065d9ad63e0a2fff8b5c34cac7ac673d7e90748b0651d1f73f85fd3",
    "sig": "bfa410207d6c8dd436c0c7b0fa05021175d75d116f927dedf8284969a4fca37463e11cb9c7b11cc4153bcc683b3d1e764ab18b6dbdbe7cc0a713acfa567d300a"
  },
  {
    "stage": "totals",
    "input": "b6015924d065d9ad63e0a2fff8b5c34cac7ac673d7e90748b0651d1f73f85fd3",
    "output": "4c80e21b1f7d564c6eaf522d9579d56b5fea6a0c4acdcd303d1f61c1a990e26e",
    "sig": "d1d8c63d239df4812d845bf913f03ade70f49f81504b5e4c8ee937e5ae56aa9447497a1fb2d39a65753a873254ac3dd53f55faa9f5c5632037a1b5e159d4e704"
  }
]
$ python chain.py verify
OK: 2 receipts, every signature valid, every link matches
$ cat totals.csv
region,amount
APAC,270.0
EU,125.75
US,219.99
```

You can see the chain by eye: `totals`'s input is `clean`'s output, `b6015924`. Now the edit this exists to catch. Someone opens `clean.csv` between the stages and turns order 1004's 210.00 into 2100.00. A typo, or not. `totals` runs without complaint, because nothing in it asks where its input came from:

```text
$ python chain.py clean
clean: signed clean.csv
$ sed -i 's/^1004,APAC,210.00/1004,APAC,2100.00/' clean.csv
$ python chain.py totals
totals: signed totals.csv
$ python chain.py verify
BROKEN at link 0 -> 1 (totals): input 0555a68d86ea != previous output b6015924d065
```

The file `totals` read is not the file `clean` wrote, and `verify()` names the exact link. Sixty lines, and the core idea works. Now the ways it doesn't.

## Where the toy breaks

**Same rows, different bytes.** The hashes cover file bytes, and bytes are not data. Here someone loads `clean.csv` into a notebook to look at it and saves it back. pandas rewrites 120.00 as 120.0 and switches the line endings from `\r\n` to `\n`. No value changes:

```text
$ python chain.py clean
clean: signed clean.csv
$ python -c "print(open('clean.csv', 'rb').readlines()[:3])"
[b'order_id,region,amount\r\n', b'1001,US,120.00\r\n', b'1002,EU,80.50\r\n']
$ python -c "import pandas as pd; pd.read_csv('clean.csv').to_csv('clean.csv', index=False)"
$ python -c "print(open('clean.csv', 'rb').readlines()[:3])"
[b'order_id,region,amount\n', b'1001,US,120.0\n', b'1002,EU,80.5\n']
$ python chain.py totals
totals: signed totals.csv
$ cat totals.csv
region,amount
APAC,270.0
EU,125.75
US,219.99
$ python chain.py verify
BROKEN at link 0 -> 1 (totals): input d3036425e43f != previous output b6015924d065
```

Identical totals, and the same BROKEN the real edit got. Reordered columns, different quoting, a spreadsheet re-save, or the same rows as JSON instead of CSV all change the bytes too. A check that goes red on harmless re-saves teaches people to ignore it, and then it misses the edit that mattered.

**A mismatch, not a measurement.** Look at what the tampered run printed: two 12-character hex prefixes. One cent or a million dollars? One row or all of them? A hash can only say "different." The toy also exits 0 either way, so a CI job would wave it through.

**Which key, and for how long?** The toy believes whatever `signing.pub` sits in the folder. Rotate the key (it leaked, someone left, it is January) and every older chain goes red:

```text
$ python chain.py clean && python chain.py totals
clean: signed clean.csv
totals: signed totals.csv
$ cp receipts.json last-week.json
$ rm signing.key signing.pub
$ python chain.py clean && python chain.py totals
clean: signed clean.csv
totals: signed totals.csv
$ python chain.py verify
OK: 2 receipts, every signature valid, every link matches
$ python chain.py verify last-week.json
BROKEN: bad signature on receipt 0 (clean)
```

Look at the first `verify` too. The new chain is OK for the only reason the toy ever says OK: the key in the folder signed it. Anyone who can write to that folder can generate a key, rerun the pipeline on numbers they prefer, and get the same OK.

**The stage you forgot to wrap.** Only work that goes through `run_stage` gets a receipt. Whatever happens after `totals` (the copy into the dashboard, or someone "fixing" a number in `totals.csv`) never does:

```text
$ sed -i 's/^EU,125.75/EU,1257.5/' totals.csv
$ cat totals.csv
region,amount
APAC,270.0
EU,1257.5
US,219.99
$ python chain.py verify
OK: 2 receipts, every signature valid, every link matches
```

Still OK, because `verify()` never looks at the file the dashboard reads. The middle is soft too: in the tampered run, `totals` signed a receipt for input nobody had vouched for, and nothing objected until someone ran `verify()`.

**Verifying somewhere else.** Checking a chain takes `chain.py`, Python, the `cryptography` package, and a copy of `signing.pub` you have a reason to believe. The analyst looking at the dashboard has a browser. The client you send the numbers to has neither your repo nor your virtualenv.

## The same pipeline, with Tamper Signal

Tamper Signal keeps the mechanism (sha256, Ed25519, each input hash matching the previous output hash) and works on the edges. After `pip install tamper-signal`, scaffold a keypair and pin the export:

```text
$ tamper-signal init
  - keys: generated keys/signing.key and keys/signing.pub
  - .gitignore: added keys/, *.key
  - receipts: created receipts/
...
$ tamper-signal ingest orders.csv --origin "orders export, September 2026" --key keys/signing.key --out receipts/
Ingested orders.csv
  evidence_hash a092ffa15fd2981e7f34d9ce7fbff18e2d3eb5a1c8becfa171a3977cc52cdeac
  semantic_hash f683569a81bef0b442df526f35884a3e4154294d227a297c676331710aa269f0
  rows 8, columns 3
  source manifest -> receipts/000_source.json
```

The `evidence_hash`, `a092ffa1`, is the value the toy recorded as `clean`'s input: same bytes, same sha256. It stays on the source receipt as the original file's fingerprint. The `semantic_hash` beside it is what links compare, and it fixes the first problem. Next, the same two stages, wrapped. `@receipt_step` verifies the chain so far, checks that its input descends from the chain tail, runs your function (a list of dicts or a DataFrame in and out), and signs a receipt. Here is `pipeline.py`:

```python
# pipeline.py: the same two stages, wrapped
import csv, sys
from tamper_signal import receipt_step

CHAIN = dict(chain_dir="receipts/", key_path="keys/signing.key")

def read(path):                      # a blank cell is null, as it was at ingest
    with open(path, newline="") as f:
        return [{k: v or None for k, v in r.items()} for r in csv.DictReader(f)]

def write(path, rows):
    with open(path, "w", newline="") as f:
        csv.writer(f).writerows([rows[0].keys(), *(r.values() for r in rows)])

@receipt_step(**CHAIN)
def clean(rows):                     # drop orders with no amount
    return [r for r in rows if r["amount"]]

@receipt_step(**CHAIN)
def totals(rows):                    # revenue per region
    sums = {}
    for r in rows:
        sums[r["region"]] = sums.get(r["region"], 0) + float(r["amount"])
    return [{"region": k, "amount": round(v, 2)} for k, v in sorted(sums.items())]

if sys.argv[1] == "clean":
    write("clean.csv", clean(read("orders.csv")))
    print("clean: signed clean.csv")
else:
    write("totals.csv", totals(read("clean.csv")))
    print("totals: signed totals.csv")
```

Then the run, including the same pandas re-save that broke the toy. `--data` checks the file the dashboard actually reads against the final receipt:

```text
$ python pipeline.py clean
clean: signed clean.csv
$ python -c "import pandas as pd; pd.read_csv('clean.csv').to_csv('clean.csv', index=False)"
$ python pipeline.py totals
totals: signed totals.csv
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --data totals.csv
✓ CHAIN INTACT: 3 receipts, 2 transforms, final row_count 3
```

Exit 0. The light is green, the data is clean. Here is the receipt `totals` signed:

```text
$ cat receipts/002_totals.json
{
  "kind": "transform_receipt",
  "spec_version": "1.2",
  "created_at": "2026-09-27T18:52:02Z",
  "transform": {
    "name": "totals",
    "code_hash": "06f26e56c51ed87116145aa3305090266588f5953f62fcb3d7d1213a71d9ba71",
    "code_file": "pipeline.py"
  },
  "input_semantic_hash": "a808b65d500156dedbdc322ae8250f014d8afd351196e02deebbfdc15c437a94",
  "output_semantic_hash": "03100d98218365f596bb09bfb7c2cb698775f990038cd383dd1f0e15501bfe77",
  "output_control_totals": {
    "row_count": 3,
    "column_count": 2,
    "numeric_sums": {
      "amount": "615.74"
    },
    "date_ranges": {},
    "null_counts": {}
  },
  "signature": {
    "alg": "ed25519",
    "key_fingerprint": "47942061f61409fa",
    "value": "993055e77e5f3d54a7dd5d174e0f3d864cedda385a22802f47d6f86020d180db68da76704244e2ae27e65c066cc9a9c8b99d11cfe3cad93bea59fff04513e400"
  }
}
```

Beside the two hashes: a hash of the stage's source code, and control totals (row count, column count, numeric sums, date ranges, null counts), all under the signature. Now the last-mile edit the toy called OK:

```text
$ sed -i 's/^EU,125.75/EU,1257.5/' totals.csv
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --data totals.csv
✗ DATA MISMATCH against final receipt (totals)
  expected output hash 0310...77
  found    data hash   62b4...55
  Control totals delta vs receipt: amount 615.74 -> 1747.49 (1131.75)
```

Exit 1. The light is red, the chain is broken. The receipts themselves still verify; the link that failed is the last one, from `totals` to the file the dashboard reads, and the report says by how much: 1,131.75 in `amount`.

## The five problems, one at a time

**Same rows, different bytes: a semantic hash.** Links compare a hash of the canonicalized content instead of the file. Headers are normalized and sorted, rows are sorted (row order is not part of integrity), numbers become plain decimals so 120.00, 120.0 and 120 are one value, and reading a file turns an empty cell into null. That is why the re-save passed. It crosses formats, too:

```text
$ python -c "import pandas as pd; pd.read_csv('orders.csv').to_json('orders.json', orient='records')"
$ tamper-signal ingest orders.json --origin "the same rows, as JSON" --key keys/signing.key --out json-receipts/
Ingested orders.json
  evidence_hash 4d491eec503ae75c125cabbb05901ab38ab4335d487f788a46e27d45b87450f9
  semantic_hash f683569a81bef0b442df526f35884a3e4154294d227a297c676331710aa269f0
  rows 8, columns 3
  source manifest -> json-receipts/000_source.json
```

Different bytes, different evidence hash, the same semantic hash as the CSV. Two costs: numeric-looking text canonicalizes to its number (`"030"` equals `30`), and an empty string is not a null, which is why `read()` in `pipeline.py` maps blank cells to `None`, as ingest does.

**How much moved: control totals.** Hashes say "broken." Totals say "how broken." Because every receipt carries signed totals, a failure prints the delta instead of two hex prefixes, as in the red run above. For pipelines that are supposed to preserve totals, `--warn-drift` flags any control-totals movement between links as a yellow caveat. And the exit code is the light: 0 green, 1 red, 2 yellow.

**Which key: name the one you trust, and `--pub` repeats.** `chain.json` carries the public key it was signed with, and with no `--pub`, `verify` trusts that embedded key, which is the toy's folder problem again. Pass `--pub` and trust is explicit: verify against only a new key and the chain is yellow, not green. List both, and a chain signed before the rotation stays green:

```text
$ tamper-signal keygen --out newkeys/
Public key written to newkeys/signing.pub
Private key written to newkeys/signing.key. Do not commit it.
$ tamper-signal verify receipts/chain.json --pub newkeys/signing.pub
⚠ CHAIN VERIFIES, WITH CAVEATS: 3 receipts, 2 transforms, final row_count 3
  - unrecognized signing key: 3 receipt(s) (source, clean, totals) verify under the chain's embedded key 47942061f61409fa, not any of the 1 trusted key(s) (ba41def2dd903b8a)
  A human should look.
$ tamper-signal verify receipts/chain.json --pub newkeys/signing.pub --pub keys/signing.pub
✓ CHAIN INTACT: 3 receipts, 2 transforms, final row_count 3
```

Exit 2, then 0. The light is yellow, a human should look. That yellow is the answer to the toy's folder problem: a chain someone re-signed with a key of their own is internally consistent, and it still does not verify under the key you name.

**Unwrapped stages: the wrapper refuses, and `--data` covers the last mile.** Here is the between-stages edit that the toy happily signed:

```text
$ tamper-signal ingest orders.csv --origin "orders export, September 2026" --key keys/signing.key --out receipts/
Ingested orders.csv
  evidence_hash a092ffa15fd2981e7f34d9ce7fbff18e2d3eb5a1c8becfa171a3977cc52cdeac
  semantic_hash f683569a81bef0b442df526f35884a3e4154294d227a297c676331710aa269f0
  rows 8, columns 3
  source manifest -> receipts/000_source.json
$ python pipeline.py clean
clean: signed clean.csv
$ sed -i 's/^1004,APAC,210.00/1004,APAC,2100.00/' clean.csv
$ python pipeline.py totals
Traceback (most recent call last):
...
tamper_signal.wrapper.ChainTailMismatch: Input data does not match the chain tail output hash.
  chain tail output: a808b65d500156dedbdc322ae8250f014d8afd351196e02deebbfdc15c437a94
  provided input:    71b4391514e71f4bc7cf75f4162155bae3565180ad5a3ff6afe2c01b872b9af7
Refusing to append a receipt for data that did not come from the previous stage.
```

`totals` never ran. The wrapper hashed its input, compared it with what `clean` signed, and refused, so the edit cannot earn a receipt. The fix is the boring one: change `clean` and re-run from ingest (which resets the chain to the source, as above). The last mile is `verify --data`, which you saw go red. Code outside a wrapped function is still not attested; the wrapper can only refuse at the boundaries it sits on.

**Somewhere else: in a browser, or offline.** Receipts are plain JSON and `chain.json` embeds its public key, so checking a chain does not need your pipeline. In a web page, the status light re-checks every signature and hash link in the viewer's browser with Web Crypto's Ed25519, and, once `tamper-signal export` publishes the table, the room behind it re-hashes it against the final receipt, so the rows on screen are the attested rows (served over HTTP, not from `file://`). For someone offline, `tamper-signal export --bundle` writes a zip of the data file, `chain.json`, and its receipts, and `tamper-signal verify`, with `--pub` for the key they already trust, gives them the same light on their machine.

**And the key holder: anchoring.** One gap survives all of this: whoever holds the private key can sign a fresh, internally consistent chain. When that matters (an audit, a dispute), `pip install "tamper-signal[anchor]"` and `tamper-signal anchor` record `chain.json` in the public Sigstore transparency log. Since `chain.json` lists the sha256 of every receipt file, `verify --anchor` then proves this exact chain, receipts included, existed at the logged time under the recorded identity. It is optional, and it proves nothing more than that.

| Problem | The 60-line toy | Tamper Signal |
| --- | --- | --- |
| Same rows, re-saved | red, same as a real edit | semantic hash links; evidence hash keeps the raw bytes |
| How much moved | two hex prefixes, exit 0 | signed control totals and the delta; exit 0, 1, or 2 |
| Key rotation and trust | old chains go red; any key in the folder says OK | `--pub` repeats; an untrusted signer is yellow |
| Unwrapped stages | signs tampered input; final file unchecked | refuses input that does not descend from the tail; `--data` checks the final file |
| Verifying elsewhere | needs your code and your venv | in-browser verifier; offline bundle |
| Key holder re-signs | undetectable | optional Sigstore anchoring |

## Honest limits

- **Continuity, not correctness.** It can't tell you the data is right, but it can prove nobody changed it. If the export is wrong, the chain verifies wrong numbers, and a wrapped stage with a bug in it earns a perfectly valid receipt. The totals make the bug visible; deciding it is a bug is still your job.
- **The key holder can re-sign.** Day to day, the local keypair is the root of trust. Anchoring covers the runs you anchor, not the ones you didn't.
- **Only wrapped stages are attested.** A stage that cannot fit the records-in, records-out contract stays unwrapped, and the honest move is to say so rather than pretend it has a receipt.

Write the toy once. It teaches you that hashing and signing are the easy 60 lines, and the work is in the edges: what counts as the same data, how far a number moved, which key you meant, and who can check without your laptop.

## Try it

The [live demo](https://tampersignal.com/demo.html) runs every surface on a real receipt chain in your browser, no install. To try it on your own pipeline, `pip install tamper-signal` (or `npm install tamper-signal` for JavaScript pipelines) and start with the commands above. Source, issues, and the agent runbook live at [github.com/welovejeff/tamper-evident-verification](https://github.com/welovejeff/tamper-evident-verification). If it's useful, a star helps other people find it.

## Related reading

- [How Tamper Signal compares](https://tampersignal.com/docs/compare.html): rules catch what you predicted; receipts catch what changed. Where signed receipts sit next to dbt tests, Great Expectations, Pandera, and in-toto.
- [Where did my pandas rows go?](https://tampersignal.com/blog/where-did-my-pandas-rows-go.html): silent row drops and merge fan-outs in pandas, the plain-pandas fixes, and a signed receipt per step that shows where the rows went.

*Hash the data, sign the hashes, link the receipts. Then handle the edges.*
