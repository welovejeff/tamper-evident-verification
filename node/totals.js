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
