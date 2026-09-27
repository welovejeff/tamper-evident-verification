---
title: "Where did my pandas rows go? Catching silent row drops and merge fan-outs"
published: false
description: "Pandas drops rows without raising: NaN filters, merge fan-outs on duplicate keys, silent coercion. The plain-pandas fixes, then a signed receipt per step."
tags: python, pandas, dataengineering, datascience
canonical_url: https://tampersignal.com/blog/where-did-my-pandas-rows-go.html
---

The pipeline ran. No traceback, no warning, a dashboard at the end of it. The revenue tile says 849.69. The export it was built from, summed by hand, comes to 2,010.84. Somewhere between the CSV and the chart, some rows left, a few rows arrived that nobody invited, and pandas mentioned neither.

That is the normal way a pandas pipeline goes wrong. It rarely crashes on bad data. It does exactly what you asked, and what you asked turns out to be slightly different from what you meant. This post walks one small pipeline through the three usual culprits, the fixes that need nothing but pandas, and then a signed receipt at every step, so the next time a number is off you can point at the step that moved it. Every command and every output below was run for this post, on pandas 3.0.6 and Python 3.11.

## Three ways pandas loses rows without raising

**A filter that meets a NaN.** `dropna()` with no arguments drops a row if *any* column is missing, not just the one you had in mind. Boolean masks do the same thing more quietly: NaN is never less than, greater than, or equal to anything, so a row with no discount fails `discount < 0.5` and is gone. Here is `nan_filter.py`:

```python
import pandas as pd

df = pd.DataFrame({
    "order_id": [1, 2, 3, 4],
    "region":   ["US", None, "EU", None],
    "discount": [0.1, None, 0.2, None],
    "amount":   [120.0, 80.5, 45.0, 60.0],
})

kept = df.dropna()                    # meant: drop rows with no amount
print(len(df), "->", len(kept), "rows")

cheap = df[df["discount"] < 0.5]      # meant: drop big discounts
print(len(df), "->", len(cheap), "rows")
```

```text
$ python nan_filter.py
4 -> 2 rows
4 -> 2 rows
```

Half the table, twice. Every amount was present. The rows were only incomplete in columns the next step never reads.

**A merge that fans out.** A left join keeps every left row, which sounds like it cannot change your row count. It can grow it. If the right side has a duplicate key, each matching left row is copied once per match. Customer C2 changed segment and the lookup table kept both rows, so C2's order now counts twice. If you are asking why your pandas merge duplicated rows, this is almost always the answer: duplicate keys on the right. `fanout.py`:

```python
import pandas as pd

orders = pd.DataFrame({
    "order_id":    [1, 2, 3],
    "customer_id": ["C1", "C2", "C3"],
    "amount":      [120.0, 80.5, 45.0],
})
customers = pd.DataFrame({
    "customer_id": ["C1", "C2", "C2", "C3"],   # C2 changed segment; both rows kept
    "segment":     ["ent", "smb", "ent", "smb"],
})

joined = orders.merge(customers, on="customer_id", how="left")
print(len(orders), "->", len(joined), "rows")
print(orders["amount"].sum(), "->", joined["amount"].sum())
```

```text
$ python fanout.py
3 -> 4 rows
245.5 -> 326.0
```

**A dtype coercion.** One value in the export carries a thousands separator, so pandas reads the whole column as text (pandas 3 reports `str`; pandas 2 says `object`). The usual fix, `pd.to_numeric(errors="coerce")`, turns anything it cannot parse into NaN, which is exactly what "coerce" means, and `sum()` skips NaN. The biggest order in the file becomes nothing. `coerce.py`:

```python
import io
import pandas as pd

csv = io.StringIO('order_id,amount\n1,120.00\n2,"1,200.00"\n3,45.00\n')
df = pd.read_csv(csv)
print(df["amount"].dtype)

df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
print(df["amount"].tolist())
print(df["amount"].sum())
```

```text
$ python coerce.py
str
[120.0, nan, 45.0]
165.0
```

None of these is a pandas bug. Each is documented, reasonable behavior, which is exactly why they are hard to catch: from pandas' point of view, nothing went wrong.

## Catch it with plain pandas first

Before any tool, here is what belongs in every pipeline. The running example from here on is a 13-row export with all three problems in it (two blank regions, one blank amount, one `"1,200.00"`, one customer with no record) and a lookup table where C2 appears twice:

```text
$ cat orders.csv
order_id,customer_id,region,amount
1001,C1,US,120.00
1002,C2,EU,80.50
1003,C3,,45.00
1004,C1,US,"1,200.00"
1005,C4,APAC,60.00
1006,C2,EU,
1007,C5,US,99.99
1008,C3,,15.25
1009,C4,APAC,210.00
1010,C5,US,35.00
1011,C1,EU,72.40
1012,C2,US,18.60
1013,C6,EU,54.10
$ cat customers.csv
customer_id,segment
C1,enterprise
C2,smb
C2,enterprise
C3,smb
C4,enterprise
C5,smb
```

**Log the shape after every step.** The cheapest instrumentation there is, and here it shows both symptoms: rows that left and rows that arrived. `shapes.py`:

```python
import pandas as pd

def log(df, step):
    print(f"{step:<7} {df.shape}")
    return df

orders = pd.read_csv("orders.csv").pipe(log, "read")
orders["amount"] = pd.to_numeric(orders["amount"], errors="coerce")
clean = orders.dropna().pipe(log, "clean")
customers = pd.read_csv("customers.csv")
joined = clean.merge(customers, on="customer_id", how="left").pipe(log, "enrich")
```

```text
$ python shapes.py
read    (13, 4)
clean   (9, 4)
enrich  (11, 5)
```

Thirteen in, nine after cleaning, eleven after a join that should have kept the count flat.

**Assert the invariant you actually mean.** "Drop rows with no amount" is a checkable statement. Count those rows before the filter and assert on the result. `assert_fail.py`:

```python
import pandas as pd

orders = pd.read_csv("orders.csv")
expected = orders["amount"].notna().sum()        # rows that have an amount at all

orders["amount"] = pd.to_numeric(orders["amount"], errors="coerce")
clean = orders.dropna()

assert len(clean) == expected, f"clean kept {len(clean)} rows, expected {expected}"
```

```text
$ python assert_fail.py
Traceback (most recent call last):
...
AssertionError: clean kept 9 rows, expected 12
```

**Make every merge state its cardinality.** `validate="many_to_one"` turns the fan-out into an exception instead of a bigger table. `validate.py`:

```python
import pandas as pd

orders = pd.read_csv("orders.csv")
customers = pd.read_csv("customers.csv")
orders.merge(customers, on="customer_id", how="left", validate="many_to_one")
```

```text
$ python validate.py
Traceback (most recent call last):
...
pandas.errors.MergeError: Merge keys are not unique in right dataset; not a many-to-one merge

Duplicates in right:
 customer_id
         C2 ...
```

Then `indicator=True` tells you how many left rows found no match at all. `indicator.py`:

```python
import pandas as pd

orders = pd.read_csv("orders.csv")
customers = pd.read_csv("customers.csv").drop_duplicates("customer_id", keep="last")
joined = orders.merge(customers, on="customer_id", how="left",
                      validate="many_to_one", indicator=True)
print(joined["_merge"].value_counts())
```

```text
$ python indicator.py
_merge
both          12
left_only      1
right_only     0
Name: count, dtype: int64
```

The `left_only` row is customer C6, who has no record. With `how="left"` the order survives with a blank segment; switch to an inner join and it vanishes without a word. And `keep="last"` is a business decision (it assumes the file is in date order), so make it on purpose.

**Compare column sums across a step.** Row counts miss a coercion that blanks a value without dropping the row. Sums catch it. Parse the separator at read time, drop only what you meant to drop, and check that the total did not move. `invariants.py`:

```python
import pandas as pd

raw = pd.read_csv("orders.csv", thousands=",")    # "1,200.00" parses as 1200.0
clean = raw.dropna(subset=["amount"])             # drop only rows with no amount

before, after = raw["amount"].sum(), clean["amount"].sum()
print(f"{len(raw)} -> {len(clean)} rows, amount {before:.2f} -> {after:.2f}")
assert abs(before - after) < 0.005, "the filter moved the total"
```

```text
$ python invariants.py
13 -> 12 rows, amount 2010.84 -> 2010.84
```

That is the right answer: twelve rows, 2,010.84. Do all of this. It is free, it lives next to the code, and it catches real bugs. It has two limits. It only catches what you thought to assert. And it only runs inside the pipeline: once `dashboard.csv` is on disk, nothing in that script notices when someone opens it in a spreadsheet and fixes a number.

## Give every step a receipt

This is the gap [Tamper Signal](https://tampersignal.com/) fills. It is a small MIT-licensed library that makes each pipeline stage sign a receipt: a hash of the data in, a hash of the stage's code, a hash of the data out, and human-legible control totals (row count, numeric sums, null counts). Receipts link into a chain, and one command re-checks the whole chain. After `pip install tamper-signal`, scaffold a keypair and pin the source export:

```text
$ tamper-signal init
  - keys: generated keys/signing.key and keys/signing.pub
  - .gitignore: added keys/, *.key
  - receipts: created receipts/
...
$ tamper-signal ingest orders.csv --origin "orders export, September 2026" --key keys/signing.key --out receipts/
Ingested orders.csv
  evidence_hash 099e753e36301c1ffdcc6aed58a05ff5b3ad9187361e932b3c502c830318601d
  semantic_hash 55ead377b3981ebbed0b2cb62c7a9499cfe95b19242dcb0e1c3ae569e22934a4
  rows 13, columns 4
  source manifest -> receipts/000_source.json
```

Then wrap each stage. `@receipt_step` takes a function that accepts and returns a DataFrame (or a list of dicts). The frame is hashed as records and passed to your function untouched. Before your code runs, the wrapper verifies the chain so far and refuses if its input is not what the previous stage signed. Here is `pipeline.py`, which is the buggy pipeline from above, bugs intact:

```python
import sys
import pandas as pd
from tamper_signal import receipt_step

CHAIN = dict(chain_dir="receipts/", key_path="keys/signing.key")

@receipt_step(**CHAIN)
def clean(df):
    df = df.copy()
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
    return df.dropna()                    # meant: drop rows with no amount

@receipt_step(**CHAIN)
def enrich(df):
    customers = pd.read_csv("customers.csv")
    return df.merge(customers, on="customer_id", how="left")

if sys.argv[1] == "clean":
    out = clean(pd.read_csv("orders.csv"))
    out.to_csv("clean.csv", index=False)
else:
    out = enrich(pd.read_csv("clean.csv"))
    out.to_csv("dashboard.csv", index=False)
print(f"{sys.argv[1]}: {len(out)} rows, amount {out['amount'].sum():.2f}")
```

```text
$ python pipeline.py clean
clean: 9 rows, amount 750.59
$ python pipeline.py enrich
enrich: 11 rows, amount 849.69
```

Nothing raised, same as before. But each step left a receipt, and the receipts are plain JSON. One line of control totals per receipt:

```text
$ jq -c '.control_totals // .output_control_totals | {row_count, numeric_sums, null_counts}' receipts/000_source.json receipts/001_clean.json receipts/002_enrich.json
{"row_count":13,"numeric_sums":{"order_id":"13091","amount":"810.84"},"null_counts":{"region":2,"amount":1}}
{"row_count":9,"numeric_sums":{"order_id":"9070","amount":"750.59"},"null_counts":{}}
{"row_count":11,"numeric_sums":{"order_id":"11084","amount":"849.69"},"null_counts":{"segment":1}}
```

Read it top to bottom and the whole story is there. Thirteen rows in, nine after `clean`, eleven after `enrich`. `clean` cleared both blank regions and the blank amount: that accounts for three of the four missing rows, and the fourth is order 1004, the `"1,200.00"` that coercion turned into NaN. `enrich` added two rows and a column to an input that had no reason to grow, which is a fan-out, plus one blank segment, which is C6.

One honest wrinkle: the source's amount sum is 810.84, not 2,010.84. Control totals sum plain decimals only, so `"1,200.00"` was text to the receipt too, the same way it was text to `to_numeric`. The receipt shows the row leaving, not the money. If your export has grouped numbers, parse them inside a wrapped stage so the next receipt carries the real total. Inside, not before: hand the first stage `pd.read_csv("orders.csv", thousands=",")` and it refuses, because that frame is no longer the file you ingested.

## Green, then yellow when you ask

```text
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub
✓ CHAIN INTACT: 3 receipts, 2 transforms, final row_count 11
```

Exit 0. The light is green, the data is clean. That holds in the narrow sense the tool means: every signature checks and every link matches. Filters are supposed to move totals, so plain `verify` does not flag movement. `--warn-drift` does, for pipelines expected to preserve totals, and it names every link that moved:

```text
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --warn-drift
⚠ CHAIN VERIFIES, WITH CAVEATS: 3 receipts, 2 transforms, final row_count 11
  - totals drift at link 0 -> 1 (clean): row_count 13 -> 9 (-4), amount 810.84 -> 750.59 (-60.25), order_id 13091 -> 9070 (-4021), null_counts[amount] 1 -> 0 (-1), null_counts[region] 2 -> 0 (-2)
  - totals drift at link 1 -> 2 (enrich): row_count 9 -> 11 (+2), column_count 4 -> 5 (+1), amount 750.59 -> 849.69 (99.1), order_id 9070 -> 11084 (2014), null_counts[segment] 0 -> 1 (+1)
  A human should look.
```

Exit 2. The light is yellow, a human should look. Those two lines are the diff you would have written by hand: `clean` dropped four rows and every null in two columns, `enrich` added two rows and 99.1 in amount, which is C2's two orders counted twice.

## Red: someone edits the output

`--data` checks the file the dashboard actually reads against the final receipt. On the file the pipeline wrote, it is green:

```text
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --data dashboard.csv
✓ CHAIN INTACT: 3 receipts, 2 transforms, final row_count 11
```

Now someone opens `dashboard.csv` and "fixes" order 1009 from 210.0 to 2100.0:

```text
$ sed -i 's/^1009,C4,APAC,210.0,/1009,C4,APAC,2100.0,/' dashboard.csv
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --data dashboard.csv
✗ DATA MISMATCH against final receipt (enrich)
  expected output hash 864d...7b
  found    data hash   b77b...a5
  Control totals delta vs receipt: amount 849.69 -> 2739.69 (1890)
```

Exit 1, red. The chain itself still verifies. What failed is the claim that this file is what the last stage produced, and the report says by how much: amount is 1,890 higher than what `enrich` signed.

## Edits between stages do not get signed

The sneakier edit happens in the middle. The pipeline writes `clean.csv`, and before `enrich` runs, someone notices the $1,200 order is missing and pastes it back in by hand. It is even a correction. Restart the run from the source (re-ingesting resets the chain) and try it:

```text
$ tamper-signal ingest orders.csv --origin "orders export, September 2026" --key keys/signing.key --out receipts/
Ingested orders.csv
  evidence_hash 099e753e36301c1ffdcc6aed58a05ff5b3ad9187361e932b3c502c830318601d
  semantic_hash 55ead377b3981ebbed0b2cb62c7a9499cfe95b19242dcb0e1c3ae569e22934a4
  rows 13, columns 4
  source manifest -> receipts/000_source.json
$ python pipeline.py clean
clean: 9 rows, amount 750.59
$ echo "1004,C1,US,1200.0" >> clean.csv
$ python pipeline.py enrich
Traceback (most recent call last):
...
tamper_signal.wrapper.ChainTailMismatch: Input data does not match the chain tail output hash.
  chain tail output: 7999a2ce55fc800f58457a95a59fe73e91f73af8713a8116d2cb3de017818d7f
  provided input:    762db39c9decef858d1fe110cc9f9650ffff22c7bbd1a7f1c49ff89c385f843a
Refusing to append a receipt for data that did not come from the previous stage.
```

`enrich` refuses to run. The wrapper hashed its input, compared it to what `clean` signed, and found a different file. The wrapper cannot tell a fix from a fudge, and it does not try. The right move is the boring one: correct `clean` (a `subset` on `dropna`, the separator parsed) and re-run from ingest, so the correction gets a receipt of its own.

## How this compares

Asserts and `validate=` are free and precise, and they only know what you told them. [Pandera](https://pandera.readthedocs.io/) and [Great Expectations](https://greatexpectations.io/) check data against rules you write (types, nullability, ranges, uniqueness, row counts); they are the right tool when you know what correct looks like and want to enforce it. [dframe-trace](https://github.com/vimalnakrani08/dframe-trace) goes the other way: you declare no rules; turn on its autopatch (or wrap steps in its decorator) and it records a structural snapshot (row count, columns, dtypes, per-column null counts) for each pandas or polars operation it traces, and afterwards you ask it where rows were lost or nulls appeared. It is the closest tool to this post's question. Its README is upfront that boolean-mask filters like `df[df.x > 0]` are not auto-traced (the loss still shows up in the next recorded step's row delta), and it records structure, not values, in memory for that run. Receipts sit at a different boundary: one per wrapped stage, values summarized as totals, everything signed, so the record outlives the run.

| Approach | Rules written first | Spots a drop you didn't predict | Spots edits after the run | Judges whether values are right |
| --- | --- | --- | --- | --- |
| Asserts and merge validate | yes | only the ones you wrote | no | against your asserts |
| Pandera | yes, a schema | if a check covers it | only rule-breaking ones, if re-run | against your schema |
| Great Expectations | yes, a suite | if an expectation covers it | only rule-breaking ones, if re-run | against your expectations |
| dframe-trace | no | yes, for traced operations | no | no |
| Signed receipts | no, one decorator per stage | yes, per wrapped stage | yes, with `verify --data` | no, continuity only |

These stack. Asserts inside the stages, a schema where you know the rules, receipts at the stage boundaries.

## Honest limitations

- **Continuity, not correctness.** It can't tell you the data is right, but it can prove nobody changed it. If the export is wrong, the chain verifies wrong numbers.
- **A wrapped step with wrong logic still gets signed.** The buggy `clean` above earned a perfectly valid receipt. What you get is visibility: its totals are in the receipt, and `--warn-drift` flags the movement. Deciding the movement is a bug is still your job.
- **Only wrapped stages are attested.** Code outside a wrapped function is not covered. A lookup file a stage reads on the side (`customers.csv` here) is not pinned by its own hash; its effect only shows up in the stage's output totals.
- **The key holder can re-sign.** Anyone with `keys/signing.key` can produce a fresh, internally consistent chain. When that matters (an audit, a dispute), optional Sigstore anchoring records that this exact chain existed at a logged time.

So: log your shapes, assert what you mean, make every merge declare its cardinality. Then, if you want the answer to "why did my DataFrame lose rows?" to still be on disk next week, give each step a receipt and let the totals say where the rows went.

## Try it

The [live demo](https://tampersignal.com/demo.html) runs every surface on a real receipt chain in your browser, no install. To try it on your own pipeline, `pip install tamper-signal` (or `npm install tamper-signal` for JavaScript pipelines) and start with the commands above. Source, issues, and the agent runbook live at [github.com/welovejeff/tamper-evident-verification](https://github.com/welovejeff/tamper-evident-verification). If it's useful, a star helps other people find it.

*Rows in, rows out, and a receipt for the difference.*
