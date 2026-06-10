// Data file loading for the Node side: CSV, TSV, JSON (array of objects),
// and NDJSON. No xlsx in JavaScript; point the Python CLI at spreadsheets.
// Empty CSV cells load as null so the same data hashes identically to its
// xlsx form, mirroring tamper_signal/canonical.py's loaders.

import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { normalizeHeaders } from "./canonical.js";

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, embedded
// newlines and delimiters. Returns an array of string-array rows.
export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    push();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === delimiter) {
      push();
      i += 1;
    } else if (ch === "\r") {
      i += text[i + 1] === "\n" ? 2 : 1;
      endRow();
    } else if (ch === "\n") {
      i += 1;
      endRow();
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

export function loadCsv(path, { delimiter = "," } = {}) {
  const rows = parseCsv(stripBom(readFileSync(path, "utf-8")), delimiter);
  if (!rows.length) return [];
  const headers = normalizeHeaders(rows[0]);
  const records = [];
  for (const raw of rows.slice(1)) {
    if (!raw.length || raw.every((cell) => cell === "")) continue;
    const record = {};
    headers.forEach((header, i) => {
      const cell = raw[i] ?? "";
      record[header] = cell === "" ? null : cell;
    });
    records.push(record);
  }
  return records;
}

export function loadJsonRecords(path) {
  const data = JSON.parse(stripBom(readFileSync(path, "utf-8")));
  if (!Array.isArray(data) || !data.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    throw new Error(`${path}: expected a JSON array of objects (for line-delimited JSON use .ndjson/.jsonl)`);
  }
  return data;
}

export function loadNdjson(path) {
  const records = [];
  stripBom(readFileSync(path, "utf-8"))
    .split("\n")
    .forEach((line, index) => {
      const text = line.trim();
      if (!text) return;
      const item = JSON.parse(text);
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`${path}:${index + 1}: expected a JSON object per line`);
      }
      records.push(item);
    });
  return records;
}

export function loadRecords(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".csv") return loadCsv(path);
  if (ext === ".tsv") return loadCsv(path, { delimiter: "\t" });
  if (ext === ".json") return loadJsonRecords(path);
  if (ext === ".ndjson" || ext === ".jsonl") return loadNdjson(path);
  if (ext === ".xlsx" || ext === ".xlsm") {
    throw new Error(
      `${path}: xlsx is not supported by the JavaScript package; ingest spreadsheets ` +
        "with the Python CLI (pip install tamper-signal), or export to CSV first. " +
        "The semantic hash is identical across formats."
    );
  }
  throw new Error(`Unsupported data file ${path}: expected .csv, .tsv, .json, .ndjson, or .jsonl`);
}
