// Control totals: the Node port of tamper_signal/totals.py. Hashes say
// "broken"; totals say "how broken". Numeric sums use exact decimal math
// (BigInt) and serialize through the same quantizer as cell normalization.

import {
  codePointCompare,
  coerceDecimal,
  decimalToPlainString,
  normalizeCell,
  normalizeHeader,
  sumDecimals,
} from "./canonical.js";

const TYPE_THRESHOLD = 0.9;

// ISO shapes recognized for BUCKETING ONLY (period_buckets). Canonicalization
// (canonical.js) is untouched: a date-shaped string still canonicalizes as a
// string, so semantic hashes do not move. The shapes are strict, mirroring
// tamper_signal/totals.py:
//   date:     YYYY-MM-DD
//   datetime: YYYY-MM-DD then "T" or " ", HH:MM, optional :SS, optional .fff,
//             optional "Z" or +HH:MM/-HH:MM offset.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:(Z)|([+-])(\d{2}):(\d{2}))?$/;

// Bucket key for rows whose bucket-column value is null or unparseable.
export const UNBUCKETED_KEY = "_unbucketed";

// Calendar validation mirroring Python's date.fromisoformat: real months,
// real days (leap years included), year >= 1.
function isRealDate(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

// Canonical UTC day key (YYYY-MM-DD) for a normalized cell, or null.
//
// Typed Dates arrive already normalized by normalizeCell, which applies
// canonical.js rules: UTC formatting and midnight collapse to the bare date.
// Date-shaped strings (which stay strings under canonicalization) are parsed
// here under the SAME rules: naive datetimes are assumed UTC, aware ones
// convert to UTC, and the key is the date component after that normalization.
// Strings that match a shape but do not parse as a real date (e.g. month 13)
// return null, mirroring Python's ValueError path.
function bucketKeyFor(normalized) {
  if (typeof normalized !== "string") return null;
  if (ISO_DATE_RE.test(normalized)) {
    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(5, 7));
    const day = Number(normalized.slice(8, 10));
    return isRealDate(year, month, day) ? normalized : null;
  }
  const m = ISO_DATETIME_RE.exec(normalized);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (!isRealDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (m[8] !== undefined) {
    const offHour = Number(m[9]);
    const offMinute = Number(m[10]);
    // Python's timezone rejects offsets of 24 hours or more.
    if (offHour > 23 || offMinute > 59) return null;
    offsetMinutes = (m[8] === "-" ? -1 : 1) * (offHour * 60 + offMinute);
  }
  // Build the instant via a scaffold leap year so years below 100 are not
  // remapped by Date.UTC, then shift to UTC by subtracting the offset.
  const instant = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  instant.setUTCFullYear(year);
  const utc = new Date(instant.getTime() - offsetMinutes * 60000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

// Normalize record keys once and capture first-seen column order. Shared by
// controlTotals and groupedNumericColumns so the two can never disagree on what
// a "column" is or how its cells are addressed.
function normalizedRecords(records) {
  const columns = [];
  const seen = new Set();
  const normRecords = records.map((record) => {
    const out = {};
    for (const [key, value] of Object.entries(record)) {
      const name = normalizeHeader(key);
      out[name] = value;
      if (!seen.has(name)) {
        seen.add(name);
        columns.push(name);
      }
    }
    return out;
  });
  return { columns, normRecords };
}

// Aggregate per-UTC-day buckets keyed off bucketColumn, mirroring Python's
// _period_buckets. Column classification happened ONCE on the whole table
// (the caller passes numericColumns from it), so per-bucket numeric_sums
// always sum to the whole-table sums. Rows whose bucket value is null or
// unparseable land under UNBUCKETED_KEY. All sums stay exact decimals
// ({v, exp} BigInt pairs) until serialization.
function periodBuckets(normRecords, bucketColumn, columns, numericColumns) {
  const rowCounts = new Map();
  const sums = new Map();
  const nulls = new Map();

  for (const record of normRecords) {
    let key = bucketKeyFor(normalizeCell(record[bucketColumn] ?? null));
    if (key === null) key = UNBUCKETED_KEY;
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
    if (!sums.has(key)) {
      sums.set(key, new Map(numericColumns.map((c) => [c, { v: 0n, exp: 0 }])));
      nulls.set(key, {});
    }
    const bucketSums = sums.get(key);
    const bucketNulls = nulls.get(key);
    for (const column of numericColumns) {
      const d = coerceDecimal(record[column] ?? null);
      if (d !== null) bucketSums.set(column, sumDecimals([bucketSums.get(column), d]));
    }
    for (const column of columns) {
      if (normalizeCell(record[column] ?? null) === null) {
        bucketNulls[column] = (bucketNulls[column] ?? 0) + 1;
      }
    }
  }

  const out = {};
  for (const key of [...rowCounts.keys()].sort(codePointCompare)) {
    const numericSums = {};
    for (const column of numericColumns) {
      numericSums[column] = decimalToPlainString(sums.get(key).get(column));
    }
    out[key] = {
      row_count: rowCounts.get(key),
      numeric_sums: numericSums,
      null_counts: nulls.get(key),
    };
  }
  return out;
}

export function controlTotals(records, { bucketColumn = null } = {}) {
  const { columns, normRecords } = normalizedRecords(records);

  const nullCounts = {};
  const numericSums = {};
  const dateRanges = {};
  const bucketCandidates = [];

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

    // Bucket-column detection (bucketing only; canonicalization untouched):
    // typed Dates and ISO-shaped date strings both count.
    const dateShaped = nonNull.filter((v) => bucketKeyFor(normalizeCell(v)) !== null).length;
    if (dateShaped / nonNull.length >= TYPE_THRESHOLD) bucketCandidates.push(column);

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

  const totals = {
    row_count: records.length,
    column_count: columns.length,
    numeric_sums: numericSums,
    date_ranges: dateRanges,
    null_counts: nullCounts,
  };

  // Resolve the bucket column, mirroring Python's control_totals: an explicit
  // override must qualify (throw otherwise); without one, exactly one
  // qualifying column buckets automatically; with several or none, no buckets.
  let resolved = null;
  if (bucketColumn !== null && bucketColumn !== undefined) {
    resolved = normalizeHeader(bucketColumn);
    if (!bucketCandidates.includes(resolved)) {
      throw new Error(
        `bucket column '${resolved}' does not qualify: fewer than 90% of ` +
          "its non-null values are dates or ISO-shaped date strings"
      );
    }
  } else if (bucketCandidates.length === 1) {
    resolved = bucketCandidates[0];
  }

  if (resolved !== null) {
    totals.bucket_column = resolved;
    totals.period_buckets = periodBuckets(normRecords, resolved, columns, Object.keys(numericSums));
  }

  return totals;
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
  const { columns, normRecords } = normalizedRecords(records);

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
