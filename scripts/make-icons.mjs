/**
 * Writes the PWA icons as PNGs with no image library: a sage rounded square
 * with a cream "L" drawn from rectangles. Run once; the output is committed.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SAGE = [0x5f, 0x7a, 0x63];
const CREAM = [0xf5, 0xf2, 0xea];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function png(size, pixel) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Sage rounded square (cream outside the radius), cream "L" inside. */
function icon(size, { rounded }) {
  const r = size * 0.22;
  const stem = { x0: size * 0.36, x1: size * 0.46, y0: size * 0.26, y1: size * 0.74 };
  const foot = { x0: size * 0.36, x1: size * 0.66, y0: size * 0.64, y1: size * 0.74 };
  const inside = (x, y, b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
  return png(size, (x, y) => {
    if (rounded) {
      const cx = Math.max(r - x, 0, x - (size - r));
      const cy = Math.max(r - y, 0, y - (size - r));
      if (cx * cx + cy * cy > r * r) return CREAM;
    }
    return inside(x, y, stem) || inside(x, y, foot) ? CREAM : SAGE;
  });
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", icon(192, { rounded: false }));
writeFileSync("public/icons/icon-512.png", icon(512, { rounded: false }));
writeFileSync("public/icons/apple-touch-icon.png", icon(180, { rounded: false }));
console.log("wrote public/icons/{icon-192,icon-512,apple-touch-icon}.png");
