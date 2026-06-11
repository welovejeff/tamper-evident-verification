// Control-totals behavior, including the silent-exclusion detector that names
// numeric-looking columns dropped from numeric_sums because their values are
// thousands-grouped (issue #21). We intentionally do NOT coerce grouped
// numbers (that would diverge from the Python canonicalization), so the
// contract is: such a column stays out of numeric_sums AND is surfaced.

import assert from "node:assert/strict";
import { test } from "node:test";

import { controlTotals, groupedNumericColumns } from "../totals.js";

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
