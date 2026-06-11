// Control totals: the Node port of tamper_signal/totals.py. Hashes say
// "broken"; totals say "how broken". Numeric sums use exact decimal math
// (BigInt) and serialize through the same quantizer as cell normalization.

import {
  coerceDecimal,
  decimalToPlainString,
  normalizeCell,
  normalizeHeader,
  sumDecimals,
} from "./canonical.js";

const TYPE_THRESHOLD = 0.9;

function columnsOf(records) {
  const columns = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      const name = normalizeHeader(key);
      if (!seen.has(name)) {
        seen.add(name);
        columns.push(name);
      }
    }
  }
  return columns;
}

export function controlTotals(records) {
  const columns = columnsOf(records);
  const normRecords = records.map((record) => {
    const out = {};
    for (const [k, v] of Object.entries(record)) out[normalizeHeader(k)] = v;
    return out;
  });

  const nullCounts = {};
  const numericSums = {};
  const dateRanges = {};

  for (const column of columns) {
    const nonNull = [];
    let nulls = 0;
    for (const record of normRecords) {
      const value = record[column] ?? null;
      if (normalizeCell(value) === null) nulls += 1;
      else nonNull.push(value);
    }
    if (nulls > 0) nullCounts[column] = nulls;
    if (!nonNull.length) continue;

    const decimals = nonNull.map(coerceDecimal).filter((d) => d !== null);
    if (decimals.length / nonNull.length >= TYPE_THRESHOLD) {
      numericSums[column] = decimalToPlainString(sumDecimals(decimals));
      continue;
    }

    // Date detection is a type check on real Date instances, mirroring the
    // Python rule that date-shaped strings stay strings.
    const isoValues = [];
    for (const value of nonNull) {
      if (value instanceof Date) {
        const normalized = normalizeCell(value);
        if (typeof normalized === "string") isoValues.push(normalized);
      }
    }
    if (isoValues.length && isoValues.length / nonNull.length >= TYPE_THRESHOLD) {
      isoValues.sort();
      dateRanges[column] = { min: isoValues[0], max: isoValues[isoValues.length - 1] };
    }
  }

  return {
    row_count: records.length,
    column_count: columns.length,
    numeric_sums: numericSums,
    date_ranges: dateRanges,
    null_counts: nullCounts,
  };
}

// Thousands-grouped numbers ("289,084", "1,198,372", "1 198 372") are an
// extremely common export shape, but they don't parse as plain decimals, so
// coerceDecimal rejects them and their column never reaches numeric_sums. The
// failure is silent: a data-receipt-column on such a column looks wired but can
// never flag a change. We deliberately do NOT coerce them -- that would diverge
// from the Python canonicalization (breaking cross-stack verification) and
// reintroduce the locale ambiguity ("1,234" = 1234 or 1.234?) the canonical
// format rejects. Instead we name them so the author can add a normalize step.
// Separator class: comma, space, no-break space (U+00A0), narrow no-break
// space (U+202F) -- the grouping characters real-world exports emit.
const GROUPED_NUMERIC_RE = /^[+-]?\d{1,3}([,\u0020\u00a0\u202f]\d{3})+(\.\d+)?$/;

// Columns excluded from numeric_sums that would become numeric if grouping
// separators were stripped. Pure; reuses TYPE_THRESHOLD so a hit here means
// "strip the separators and this column joins numeric_sums." Returns
// [{ column, example }] (example: a representative grouped value, for messages).
export function groupedNumericColumns(records) {
  const columns = columnsOf(records);
  const normRecords = records.map((record) => {
    const out = {};
    for (const [k, v] of Object.entries(record)) out[normalizeHeader(k)] = v;
    return out;
  });

  const flagged = [];
  for (const column of columns) {
    const nonNull = [];
    for (const record of normRecords) {
      const value = record[column] ?? null;
      if (normalizeCell(value) !== null) nonNull.push(value);
    }
    if (!nonNull.length) continue;

    const coercible = nonNull.filter((v) => coerceDecimal(v) !== null).length;
    // Already numeric (in numeric_sums): nothing to surface.
    if (coercible / nonNull.length >= TYPE_THRESHOLD) continue;

    let grouped = 0;
    let example = null;
    for (const value of nonNull) {
      if (typeof value !== "string" || coerceDecimal(value) !== null) continue;
      if (GROUPED_NUMERIC_RE.test(value.trim())) {
        grouped += 1;
        if (example === null) example = value.trim();
      }
    }
    // Flag only if stripping separators would push the column over the numeric
    // threshold -- i.e. fixing the data actually re-enables flagging.
    if (grouped > 0 && (coercible + grouped) / nonNull.length >= TYPE_THRESHOLD) {
      flagged.push({ column, example });
    }
  }
  return flagged;
}

const sortedUnion = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

// Human-legible lines describing only what changed, mirroring totals_delta
// (including the computed numeric diff, which badge.js omits).
export function totalsDelta(upstream, downstream) {
  const lines = [];
  const upRows = upstream.row_count ?? 0;
  const downRows = downstream.row_count ?? 0;
  if (upRows !== downRows) {
    const d = downRows - upRows;
    lines.push(`row_count ${upRows} -> ${downRows} (${d >= 0 ? "+" : ""}${d})`);
  }
  const upCols = upstream.column_count ?? 0;
  const downCols = downstream.column_count ?? 0;
  if (upCols !== downCols) {
    const d = downCols - upCols;
    lines.push(`column_count ${upCols} -> ${downCols} (${d >= 0 ? "+" : ""}${d})`);
  }
  const us = upstream.numeric_sums ?? {};
  const ds = downstream.numeric_sums ?? {};
  for (const column of sortedUnion(us, ds)) {
    const before = us[column];
    const after = ds[column];
    if (before === after) continue;
    if (before !== undefined && after !== undefined) {
      const beforeDec = coerceDecimal(before);
      const afterDec = coerceDecimal(after);
      if (beforeDec && afterDec) {
        const diff = sumDecimals([afterDec, { v: -beforeDec.v, exp: beforeDec.exp }]);
        lines.push(`${column} ${before} -> ${after} (${decimalToPlainString(diff)})`);
      } else {
        // Sums in receipt JSON are attacker-controlled; report without a diff.
        lines.push(`${column} ${before} -> ${after}`);
      }
    } else if (after === undefined) {
      lines.push(`${column} ${before} -> (removed)`);
    } else {
      lines.push(`${column} (added) -> ${after}`);
    }
  }
  const un = upstream.null_counts ?? {};
  const dn = downstream.null_counts ?? {};
  for (const column of sortedUnion(un, dn)) {
    const before = un[column] ?? 0;
    const after = dn[column] ?? 0;
    if (before !== after) {
      const d = after - before;
      lines.push(`null_counts[${column}] ${before} -> ${after} (${d >= 0 ? "+" : ""}${d})`);
    }
  }
  return lines;
}
