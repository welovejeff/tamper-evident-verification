---
title: "Your AI dashboard doesn't match the export: five checks against the source data"
published: false
description: "An AI assistant built your dashboard from an export and a number looks off. Five checks against the source data, then receipts for every refresh."
tags: ai, dataanalytics, python, productivity
canonical_url: https://tampersignal.com/blog/check-your-ai-dashboard-numbers.html
---

You gave an AI assistant (Claude Code, Cursor, Lovable, ChatGPT) a CSV export and asked for a dashboard. Minutes later there it was: a revenue tile, a chart by channel, a tidy layout. Then you notice the revenue doesn't match what you remember from the store admin. Not wildly off. Just off.

The export has 48,000 rows, so "re-check it by hand" is not a plan. Asking the assistant "is this right?" isn't one either: it will reread its own code, and it may well tell you it looks fine.

What works is a set of five checks that compare the dashboard to the export, each aimed at one way numbers go missing or get counted twice. Each works in a spreadsheet, with a few lines of pandas for files too big to scroll. Every snippet below ran on a small sample for this post (pandas 3.0.6, Python 3.11), and the output is pasted as it came out (a `...` line marks a trim).

## The sample

A store's orders export, `export.csv`: 20 orders from May 2026, one row per order. A small lookup table, `products.csv`, maps each product code to a category. An AI-written script, `build.py`, combines them into `dashboard_data.csv`, the file the dashboard reads. You don't need to read the script to run the checks.

```text
$ head -5 export.csv
order_id,created_at,channel,sku,total
1001,2026-05-01 02:14:00,tiktok,TEE-BLK,38.00
1002,2026-05-01 03:40:00,meta,MUG-WHT,24.50
1003,2026-05-01 15:05:00,tiktok,HOOD-GRY,72.00
1004,2026-05-03 11:22:00,email,BUNDLE-XL,"1,250.00"
$ cat products.csv
sku,category
TEE-BLK,apparel
MUG-WHT,home
HOOD-GRY,apparel
CAP-NVY,accessories
CAP-NVY,hats
BUNDLE-XL,bundles
$ python build.py
wrote dashboard_data.csv: 17 rows, total 1,094.50
```

No errors, and the revenue tile says 1,094.50. Is that right?

## 1. Count rows in and rows out

Start with the plainest number there is: how many rows went in, and how many does the dashboard summarize? In a spreadsheet, `=COUNTA(A:A)` minus one for the header, on each file. If the dashboard has an "orders" tile, that is the number to compare. In pandas, `rows.py` also lists the orders that went missing:

```python
import pandas as pd

export = pd.read_csv("export.csv", thousands=",")
dash = pd.read_csv("dashboard_data.csv")

print("export rows:   ", len(export))
print("dashboard rows:", len(dash))

missing = sorted(set(export["order_id"]) - set(dash["order_id"]))
print(export[export["order_id"].isin(missing)])
```

```text
$ python rows.py
export rows:    20
dashboard rows: 17
    order_id           created_at channel      sku  total
0       1001  2026-05-01 02:14:00  tiktok  TEE-BLK   38.0
1       1002  2026-05-01 03:40:00    meta  MUG-WHT   24.5
11      1012  2026-05-17 16:15:00     NaN  TEE-BLK   38.0
16      1017  2026-05-27 21:18:00     NaN  MUG-WHT   49.0
```

Twenty in, seventeen out. Two of the missing orders have a blank channel: the script used `dropna()`, which throws out any row with any empty cell, not just the cells you care about. The other two are the first orders of May 1; hold that thought for step 4. And check the arithmetic: four orders missing but only three rows fewer, so something also added a row. That is step 5.

**Catches:** dropped and added rows. **Misses:** a row that is still there with the wrong value, and drops that duplicates happen to cancel out.

## 2. Total every metric on screen

For each number the dashboard shows (revenue, spend, clicks, sessions), total that column in both files. In a spreadsheet, `=SUM()` on each. In pandas, `totals.py`:

```python
import pandas as pd

export = pd.read_csv("export.csv", thousands=",")
dash = pd.read_csv("dashboard_data.csv")
print(f"export total:    {export['total'].sum():,.2f}")
print(f"dashboard total: {dash['total'].sum():,.2f}")

raw = pd.read_csv("export.csv")          # same file, no thousands=","
print("total column read as:", raw["total"].dtype)
print(f"sum after coercing:  {pd.to_numeric(raw['total'], errors='coerce').sum():,.2f}")
```

```text
$ python totals.py
export total:    2,465.00
dashboard total: 1,094.50
total column read as: str
sum after coercing:  1,215.00
```

The gap is 1,370.50, and most of it is one order. The export writes it as `"1,250.00"`, with a thousands separator. Read without being told about the comma, the whole column arrives as text (`str`), and the common fix, `pd.to_numeric(errors="coerce")`, turns anything it can't parse into a blank. The script then filled blanks with zero: the month's biggest order became 0.00, and nothing raised an error.

Spreadsheets do their own version: `SUM` silently skips a number stored as text. To test for it, compare `=COUNT()` (real numbers only) with `=COUNTA()` (anything non-empty) over the same cells, header excluded. If they differ, some of your "numbers" are text.

**Catches:** values that vanished or changed. **Misses:** which rows did it.

## 3. Follow a few rows end to end

Totals say how much is off. Specific rows say why. Pick a handful on purpose: the first row, the last, the biggest, and one from the middle. Find each one in both files (Ctrl+F on the order ID works). `spot.py`:

```python
import pandas as pd

export = pd.read_csv("export.csv", thousands=",")
dash = pd.read_csv("dashboard_data.csv")

for oid in [1001, 1004, 1011, 1020]:     # first, biggest, a middle one, last
    before = export.loc[export["order_id"] == oid, "total"].tolist()
    after = dash.loc[dash["order_id"] == oid, "total"].tolist()
    print(oid, before, "->", after)
```

```text
$ python spot.py
1001 [38.0] -> []
1004 [1250.0] -> [0.0]
1011 [144.0] -> [144.0]
1020 [24.5] -> [24.5]
```

Two of four are fine. The first order of the month is gone, and the biggest one is there with a total of 0.0. Four lookups turned "revenue looks low" into two specific problems. This is also how to talk to your assistant: "order 1004 is 1,250 in the export and 0 in the dashboard" gets a much better fix than "the revenue is wrong."

**Catches:** what the problem actually is, row by row. **Misses:** anything in rows you didn't pick.

## 4. Check the first and last day

Date bugs live at the edges. Compare the earliest and latest timestamp in both files; in a spreadsheet, sort by date and look at the top and bottom rows. `dates.py`:

```python
import pandas as pd

export = pd.read_csv("export.csv")
dash = pd.read_csv("dashboard_data.csv")
print("export:   ", export["created_at"].min(), "to", export["created_at"].max())
print("dashboard:", dash["created_at"].min(), "to", dash["created_at"].max())
```

```text
$ python dates.py
export:    2026-05-01 02:14:00 to 2026-05-31 22:30:00
dashboard: 2026-05-01 11:05 to 2026-05-31 18:30
```

The last order moved from 22:30 to 18:30: this export stamps times in UTC, and the script converted them to New York time (four hours behind in May), then kept only May. The two orders placed before 04:00 UTC on May 1 became April 30 evening orders and dropped out. Those are the two missing orders from step 1.

Neither clock is wrong. An ad account or a store may report days in its own timezone while the export uses UTC, so pick one clock for everything you compare, over the same window. If this export was pulled on UTC days, the last four hours of May 31 in New York are stamped June 1 and are not in the file at all; no fix inside the dashboard brings them back.

**Catches:** rows sliding across the start or end of the range, and daily numbers that disagree with the platform's own report.

## 5. Look for repeated keys in lookups

When a dashboard combines two files (orders plus a product list, ad spend plus a campaign list), it matches rows on a shared key. If the lookup has the same key twice, every matching row is copied once per match, and counts and sums go up. In a spreadsheet, a helper column with `=COUNTIF(A:A, A2)>1` in the lookup table flags repeats. `dupes.py`:

```python
import pandas as pd

products = pd.read_csv("products.csv")
dash = pd.read_csv("dashboard_data.csv")

print(products[products["sku"].duplicated(keep=False)])
print("orders counted more than once:", dash["order_id"].duplicated().sum())
```

```text
$ python dupes.py
       sku     category
3  CAP-NVY  accessories
4  CAP-NVY         hats
orders counted more than once: 1
```

Someone recategorized the navy cap and the old row stayed, so order 1009 is in the dashboard twice, once as "accessories" and once as "hats". That is the extra row from step 1.

**Catches:** double counting from joins. **Misses:** a lookup that is wrong but has no repeats.

Add it up and the whole gap is explained: 1,250.00 zeroed, 62.50 from the two orders that slid into April, 87.00 from the two blank-channel orders, minus 29.00 counted twice. That is 1,370.50, to the cent. Five checks, and none of them required reading the AI's code.

## The checklist works once. Your dashboard refreshes every week.

Next Monday there is a new export. The assistant tweaks the script, someone fixes a cell by hand, and last week's checks prove nothing about this week. You can re-run them every time, or the pipeline can write down what it did, every time, in a form nobody can quietly change.

That is what [Tamper Signal](https://tampersignal.com/) does. Each step signs a receipt: a fingerprint of the data that went in, the code that ran, and the data that came out, plus plain control totals (row count, column sums, blank counts). Receipts link into a chain, and one command re-checks the whole chain against the file your dashboard actually reads. The answer is a status light: green if the chain is intact, yellow if a human should look, red if it broke, with the exact link and how far the totals moved.

You don't have to wire it up yourself. Paste this into your AI assistant:

```text
Add Tamper Signal to this project. Follow https://raw.githubusercontent.com/welovejeff/tamper-evident-verification/main/AGENTS.md
```

In Claude Code you can install the plugin instead: `/plugin marketplace add welovejeff/tamper-evident-verification`, then `/plugin install tamper-signal@welovejeff`. Either way, the assistant does roughly the following (plus a small status light, if your dashboard is a web page). Here it is by hand on the sample, after `pip install tamper-signal`: a signing key, then a fingerprint of the export.

```text
$ tamper-signal init
  - keys: generated keys/signing.key and keys/signing.pub
  - .gitignore: added keys/, *.key
  - receipts: created receipts/
...
$ tamper-signal ingest export.csv --origin "store orders export, May 2026" --key keys/signing.key --out receipts/
Ingested export.csv
  evidence_hash 28651ad5690837d31e2405acc4893bad111ec2a538ca700af1ef61a43fbdc6e4
  semantic_hash 3d0653bd69c9f67d0273272590d88706d25974ee4b56cd9bdbf6007a59b17f76
  rows 20, columns 5
  source manifest -> receipts/000_source.json
```

Then the AI's `build.py` gets two new lines, an import and a decorator. Nothing else changes, bugs included:

```python
import pandas as pd
from tamper_signal import receipt_step

@receipt_step(chain_dir="receipts/", key_path="keys/signing.key")
def build(df):
    df = df.copy()
    df["total"] = pd.to_numeric(df["total"], errors="coerce").fillna(0)
    df = df.dropna()
    df = df.merge(pd.read_csv("products.csv"), on="sku", how="left")
    when = pd.to_datetime(df["created_at"]).dt.tz_localize("UTC").dt.tz_convert("America/New_York")
    df["created_at"] = when.dt.strftime("%Y-%m-%d %H:%M")
    return df[when.dt.month == 5]

out = build(pd.read_csv("export.csv"))
out.to_csv("dashboard_data.csv", index=False)
print(f"wrote dashboard_data.csv: {len(out)} rows, total {out['total'].sum():,.2f}")
```

```text
$ python build.py
wrote dashboard_data.csv: 17 rows, total 1,094.50
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --data dashboard_data.csv
✓ CHAIN INTACT: 2 receipts, 1 transforms, final row_count 17
$ echo $?
0
```

Exit code 0. The light is green, the data is clean.

## Red: the well-meaning hand edit

Now say you ran the checklist, found order 1004 at 0.0, and fixed it in `dashboard_data.csv` by hand (GNU `sed` here; any text editor does the same):

```text
$ sed -i 's/^1004,\(.*\),0\.0,bundles$/1004,\1,1250.0,bundles/' dashboard_data.csv
$ grep ^1004 dashboard_data.csv
1004,2026-05-03 07:22,email,BUNDLE-XL,1250.0,bundles
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --data dashboard_data.csv
✗ DATA MISMATCH against final receipt (build)
  expected output hash c28d...ff
  found    data hash   8407...41
  Control totals delta vs receipt: total 1094.5 -> 2344.5 (1250)
$ echo $?
1
```

The light is red, the chain is broken. The file no longer matches what the signed build produced, and the report says by how much: `total` is 1,250 higher than the receipt. Your edit was a correction, and it turns the light red anyway, on purpose: the tool can't tell a fix from a fudge. The fix that keeps the light green is the boring one. Correct the script (parse the separator, stop dropping blank-channel rows, dedupe the lookup, pick one clock) and re-run from ingest, so the correction gets its own receipt.

## What this does not do

It can't tell you the data is right, but it can prove nobody changed it. Tamper Signal proves continuity, not correctness. Green means the file behind the dashboard descends from the export through the signed steps, with nothing changed in between. It says nothing about whether the AI's aggregation logic is right: the build above has four problems and a perfectly valid receipt.

What a receipt does give you is something to look at. Each one carries its totals, and `--warn-drift` prints how they moved at every step:

```text
$ tamper-signal verify receipts/chain.json --pub keys/signing.pub --warn-drift
⚠ CHAIN VERIFIES, WITH CAVEATS: 2 receipts, 1 transforms, final row_count 17
  - totals drift at link 0 -> 1 (build): row_count 20 -> 17 (-3), column_count 5 -> 6 (+1), order_id 20210 -> 17187 (-3023), total 1215 -> 1094.5 (-120.5), null_counts[channel] 2 -> 0 (-2)
  A human should look.
$ echo $?
2
```

The light is yellow, a human should look. Twenty rows in, seventeen out, blank channels from 2 to 0: the same questions the checklist asks, printed on every run that passes the flag. One wrinkle: the source total reads 1215, not 2,465. Control totals only sum plain decimals, so `"1,250.00"` is text to the receipt too. If your exports use thousands separators, have the assistant strip them inside a signed step so the next receipt carries the real total.

Two more limits. Only wrapped steps are covered: if part of the build runs outside a wrapped function, or happens by hand, nothing attests that part. A receipt covers the data handed to the function, the function's code, and its output; a file the step opens on its own (`products.csv` here) gets no fingerprint of its own. And if the export itself is wrong, the chain faithfully verifies wrong numbers.

So: count the rows, total the columns, follow a few rows, check the edges, look for repeated keys. Do it by hand once, today. If the dashboard is going to refresh every week, give it receipts. You can see every surface running on a real chain in the [live demo](https://tampersignal.com/demo.html), and [the comparison page](https://tampersignal.com/docs/compare.html) covers where receipts fit next to rule-based checks like Great Expectations and Pandera.

## Try it

The [live demo](https://tampersignal.com/demo.html) runs every surface on a real receipt chain in your browser, no install. To try it on your own dashboard, paste the prompt above into your AI assistant, or run `pip install tamper-signal` (or `npm install tamper-signal` for JavaScript pipelines) and start with the commands above. Source, issues, and the agent runbook live at [github.com/welovejeff/tamper-evident-verification](https://github.com/welovejeff/tamper-evident-verification). If it's useful, a star helps other people find it.

Related reading: [Where did my pandas rows go?](https://tampersignal.com/blog/where-did-my-pandas-rows-go.html) covers the same silent drops, coercions, and merge fan-outs from the pandas side, and [the comparison page](https://tampersignal.com/docs/compare.html) lays out how receipts relate to dbt tests, Great Expectations, Pandera, in-toto, and Sigstore.

*Check it once by hand. Let the receipts check every refresh.*
