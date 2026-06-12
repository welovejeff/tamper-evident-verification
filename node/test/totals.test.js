// Control-totals behavior, including the silent-exclusion detector that names
// numeric-looking columns dropped from numeric_sums because their values are
// thousands-grouped (issue #21), and per-period bucketed totals (spec 1.2).
// We intentionally do NOT coerce grouped numbers (that would diverge from the
// Python canonicalization), so the contract is: such a column stays out of
// numeric_sums AND is surfaced.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  canonicalJsonBytes,
  coerceDecimal,
  decimalToPlainString,
  sumDecimals,
} from "../canonical.js";
import { loadCsv } from "../load.js";
import { UNBUCKETED_KEY, controlTotals, groupedNumericColumns } from "../totals.js";

test("comma-grouped column is excluded from numeric_sums", () => {
  const records = [
    { views: "289,084", duration_sec: "2400" },
    { views: "1,198,372", duration_sec: "1800" },
  ];
  const totals = controlTotals(records);
  // The plain-decimal column sums; the grouped one is absent (the bug's cause).
  assert.equal(totals.numeric_sums.duration_sec, "4200");
  assert.ok(!("views" in totals.numeric_sums));
});

test("groupedNumericColumns names the excluded column with an example", () => {
  const records = [
    { views: "289,084", new_followers: "85,182" },
    { views: "1,198,372", new_followers: "1,001" },
  ];
  const flagged = groupedNumericColumns(records);
  const cols = flagged.map((f) => f.column).sort();
  assert.deepEqual(cols, ["new_followers", "views"]);
  const views = flagged.find((f) => f.column === "views");
  assert.equal(views.example, "289,084");
});

test("space- and nbsp-grouped values are detected", () => {
  const records = [
    { reach: ["1", "198", "372"].join(" ") }, // ASCII spaces
    { reach: ["2", "001", "455"].join("\u00a0") }, // no-break spaces
    { reach: ["3", "114", "900"].join("\u202f") }, // narrow no-break spaces
  ];
  const flagged = groupedNumericColumns(records);
  assert.deepEqual(flagged.map((f) => f.column), ["reach"]);
});

test("genuinely numeric columns are not flagged", () => {
  const records = [
    { spend_usd: "2020283", clicks: "6359340" },
    { spend_usd: "12.5", clicks: "100" },
  ];
  assert.deepEqual(groupedNumericColumns(records), []);
});

test("non-numeric text columns are not flagged", () => {
  const records = [
    { name: "Acme, Inc.", note: "q1, 2026" },
    { name: "Globex", note: "rollup" },
  ];
  assert.deepEqual(groupedNumericColumns(records), []);
});

test("a single grouped outlier below threshold does not flag the column", () => {
  // 1 grouped value out of 10 non-null -> stripping it wouldn't make the
  // column numeric, so there is nothing actionable to surface.
  const records = [];
  for (let i = 0; i < 9; i += 1) records.push({ label: `item-${i}` });
  records.push({ label: "1,234" });
  assert.deepEqual(groupedNumericColumns(records), []);
});

test("once separators are stripped, the column joins numeric_sums", () => {
  // Demonstrates the fix the warning points at: a normalize stage.
  const raw = [{ views: "289,084" }, { views: "1,198,372" }];
  assert.deepEqual(groupedNumericColumns(raw).map((f) => f.column), ["views"]);

  const normalized = raw.map((r) => ({ views: r.views.replace(/,/g, "") }));
  assert.equal(controlTotals(normalized).numeric_sums.views, "1487456");
  assert.deepEqual(groupedNumericColumns(normalized), []);
});

// ---------------------------------------------------------------------------
// Per-period bucketed totals (spec 1.2), mirroring tests/test_period_buckets.py
// ---------------------------------------------------------------------------

const { vectors } = JSON.parse(
  readFileSync(new URL("./vectors.json", import.meta.url), "utf-8")
);

// {"__date__": "..."} markers become Date instances (midnight UTC); a
// {"__datetime__": "..."} marker carries a real timestamp. Same revival rule
// as canonical.test.js.
function decode(records) {
  return records.map((record) => {
    const out = {};
    for (const [key, value] of Object.entries(record)) {
      if (value !== null && typeof value === "object" && "__date__" in value) {
        out[key] = new Date(`${value.__date__}T00:00:00Z`);
      } else if (value !== null && typeof value === "object" && "__datetime__" in value) {
        out[key] = new Date(value.__datetime__);
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

const bucketVectors = vectors.filter((v) => "period_buckets" in v);

test("vectors.json carries the three bucket vectors", () => {
  assert.equal(bucketVectors.length, 3);
});

for (const vector of bucketVectors) {
  test(`bucket vector: ${vector.name}`, () => {
    const totals = controlTotals(decode(vector.records));
    assert.equal(totals.bucket_column, vector.bucket_column);
    assert.deepEqual(totals.period_buckets, vector.period_buckets);
    // Byte identity under canonical JSON: the cross-language contract.
    assert.equal(
      canonicalJsonBytes(totals.period_buckets).toString("utf-8"),
      canonicalJsonBytes(vector.period_buckets).toString("utf-8")
    );
  });
}

function datedRecords() {
  return [
    { day: new Date("2026-05-01T00:00:00Z"), amount: 10.5, label: "a" },
    { day: new Date("2026-05-01T00:00:00Z"), amount: 4.5, label: "b" },
    { day: new Date("2026-05-02T00:00:00Z"), amount: 20, label: null },
    { day: new Date("2026-05-03T00:00:00Z"), amount: 3, label: "c" },
  ];
}

test("typed Dates and ISO strings bucket identically", () => {
  const typed = controlTotals(datedRecords());
  const strings = controlTotals([
    { day: "2026-05-01", amount: 10.5, label: "a" },
    { day: "2026-05-01", amount: 4.5, label: "b" },
    { day: "2026-05-02", amount: 20, label: null },
    { day: "2026-05-03", amount: 3, label: "c" },
  ]);
  assert.equal(typed.bucket_column, "day");
  assert.equal(strings.bucket_column, "day");
  assert.deepEqual(typed.period_buckets, strings.period_buckets);
  assert.deepEqual(typed.period_buckets["2026-05-01"], {
    row_count: 2,
    numeric_sums: { amount: "15" },
    null_counts: {},
  });
  assert.deepEqual(typed.period_buckets["2026-05-02"].null_counts, { label: 1 });
});

test("date column under the 90% threshold produces no buckets", () => {
  const records = [];
  for (let i = 0; i < 8; i += 1) {
    records.push({ day: new Date("2026-05-01T00:00:00Z"), amount: i });
  }
  records.push({ day: "yesterday", amount: 8 });
  records.push({ day: "soon", amount: 9 });
  const totals = controlTotals(records); // 8/10 = 80% < 90%
  assert.ok(!("bucket_column" in totals));
  assert.ok(!("period_buckets" in totals));
});

test("two qualifying columns need an explicit choice", () => {
  const records = [
    { created: "2026-05-01", settled: "2026-05-03", amount: 1 },
    { created: "2026-05-02", settled: "2026-05-03", amount: 2 },
  ];
  const ambiguous = controlTotals(records);
  assert.ok(!("period_buckets" in ambiguous));

  const explicit = controlTotals(records, { bucketColumn: "created" });
  assert.equal(explicit.bucket_column, "created");
  assert.deepEqual(Object.keys(explicit.period_buckets).sort(), ["2026-05-01", "2026-05-02"]);

  // The override is normalized like any header.
  assert.equal(
    controlTotals(records, { bucketColumn: "  Created " }).bucket_column,
    "created"
  );

  assert.throws(
    () => controlTotals(records, { bucketColumn: "amount" }),
    /does not qualify/
  );
});

test("no date-shaped column yields no buckets", () => {
  const records = [
    { campaign: "a", spend: "10.50", clicks: 3 },
    { campaign: "b", spend: "4", clicks: 7 },
  ];
  const totals = controlTotals(records);
  assert.ok(!("bucket_column" in totals));
  assert.ok(!("period_buckets" in totals));
});

test("bare date, midnight datetime, and aware offsets share UTC-day buckets", () => {
  const records = [
    { day: new Date("2026-05-02T00:00:00Z"), amount: 1 },
    { day: "2026-05-02 00:00", amount: 2 }, // ISO string midnight
    { day: "2026-05-02T00:00:00Z", amount: 3 }, // explicit UTC midnight
    // 01:30 at +02:00 is 2026-05-01T23:30Z, the previous UTC day.
    { day: "2026-05-02T01:30:00+02:00", amount: 4 },
  ];
  const buckets = controlTotals(records).period_buckets;
  assert.deepEqual(buckets, {
    "2026-05-01": { row_count: 1, numeric_sums: { amount: "4" }, null_counts: {} },
    "2026-05-02": { row_count: 3, numeric_sums: { amount: "6" }, null_counts: {} },
  });
});

test("null and unparseable rows land in _unbucketed", () => {
  const records = [];
  for (let i = 0; i < 18; i += 1) {
    records.push({ day: new Date("2026-05-01T00:00:00Z"), amount: 1 });
  }
  // A second dated day so the column spans a real period axis (>= 2 distinct
  // bucket dates), which the auto-selection guard requires.
  records.push({ day: new Date("2026-05-02T00:00:00Z"), amount: 1 });
  records.push({ day: "2026-13-05", amount: 2 }); // shaped, not a real date
  records.push({ day: null, amount: 3 });
  const totals = controlTotals(records); // 19/20 non-null date-shaped: qualifies
  assert.equal(totals.bucket_column, "day");
  const unbucketed = totals.period_buckets[UNBUCKETED_KEY];
  assert.equal(unbucketed.row_count, 2);
  assert.deepEqual(unbucketed.numeric_sums, { amount: "5" });
  assert.deepEqual(unbucketed.null_counts, { day: 1 });
});

test("bucket totals sum to whole-table totals", () => {
  const records = datedRecords();
  records.push({ day: null, amount: "7.25", label: "" });
  const totals = controlTotals(records);
  const buckets = Object.values(totals.period_buckets);

  const rows = buckets.reduce((acc, b) => acc + b.row_count, 0);
  assert.equal(rows, totals.row_count);
  for (const [column, tableSum] of Object.entries(totals.numeric_sums)) {
    const parts = buckets.map((b) => coerceDecimal(b.numeric_sums[column]));
    assert.equal(decimalToPlainString(sumDecimals(parts)), tableSum);
  }
  for (const [column, tableNulls] of Object.entries(totals.null_counts)) {
    const parts = buckets.reduce((acc, b) => acc + (b.null_counts[column] ?? 0), 0);
    assert.equal(parts, tableNulls);
  }
});

test("loadCsv with ISO dates buckets identically to the matching vector", () => {
  const vector = vectors.find(
    (v) => v.name === "bucketing: same data as ISO strings matches typed dates"
  );
  const dir = mkdtempSync(join(tmpdir(), "ts-buckets-"));
  try {
    const path = join(dir, "data.csv");
    writeFileSync(
      path,
      "day,amount,category\n" +
        "2026-05-01,10.50,a\n" +
        "2026-05-01,5,b\n" +
        "2026-05-02,20,\n" +
        ",1,c\n"
    );
    const totals = controlTotals(loadCsv(path));
    assert.equal(totals.bucket_column, vector.bucket_column);
    assert.deepEqual(totals.period_buckets, vector.period_buckets);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
