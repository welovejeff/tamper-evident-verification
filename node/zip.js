// Minimal store-only (no compression) ZIP writer. Pure JS, zero dependencies,
// usable in both Node and the browser. Entry bytes are stored verbatim: a
// verified bundle carries chain.json plus receipt files whose bytes are
// committed by chain.json's receipt_hashes, so any transform (compression,
// re-encoding, line-ending rewrite) would verify as a broken chain. Store-only
// keeps the bytes exact.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

// Fixed 1980-01-01 timestamp keeps the zip deterministic (same inputs -> same
// bytes), which matters for reproducible bundles and stable tests.
const DOS_TIME = 0;
const DOS_DATE = 0x21; // (year 1980 << 9) | (month 1 << 5) | day 1

/**
 * Build a store-only zip from `entries` ([{ name, bytes: Uint8Array }]).
 * Returns the zip as a Uint8Array. Names use forward slashes; callers pass the
 * exact in-archive path. Bytes are stored uncompressed and unmodified.
 */
export function makeStoredZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(bytes);
    const size = bytes.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0, true); // general purpose flags
    local.setUint16(8, 0, true); // method 0 = store
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length
    const localHeader = new Uint8Array(local.buffer);
    parts.push(localHeader, nameBytes, bytes);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central directory header signature
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed to extract
    cd.setUint16(8, 0, true); // flags
    cd.setUint16(10, 0, true); // method 0 = store
    cd.setUint16(12, DOS_TIME, true);
    cd.setUint16(14, DOS_DATE, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true); // extra length
    cd.setUint16(32, 0, true); // comment length
    cd.setUint16(34, 0, true); // disk number start
    cd.setUint16(36, 0, true); // internal attributes
    cd.setUint32(38, 0, true); // external attributes
    cd.setUint32(42, offset, true); // relative offset of local header
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += localHeader.length + nameBytes.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central directory signature
  eocd.setUint16(4, 0, true); // number of this disk
  eocd.setUint16(6, 0, true); // disk with central directory
  eocd.setUint16(8, entries.length, true); // entries on this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true); // comment length

  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const c of all) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
