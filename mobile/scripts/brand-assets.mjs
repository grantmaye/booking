// Reproducible raster app icons from the Chairside angular monogram geometry.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
const ink = [23, 25, 22],
  acid = [219, 255, 0];
const points = [
  [46, 13],
  [24, 13],
  [13, 24],
  [13, 51],
  [50, 51],
  [50, 32],
  [32, 32],
  [32, 32],
  [50, 32],
  [50, 24],
  [24, 24],
  [24, 40],
  [42, 40],
  [42, 43],
  [21, 43],
  [21, 28],
  [28, 21],
  [46, 21],
];
function inside(x, y) {
  let yes = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, sum]);
}
function png(size, transparent = false) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = ((x / size) * 64 - 32) / (transparent ? 0.68 : 1) + 32,
        cy = ((y / size) * 64 - 32) / (transparent ? 0.68 : 1) + 32;
      const mark = inside(cx, cy);
      const at = y * (size * 4 + 1) + 1 + x * 4;
      raw.set(mark ? ink : acid, at);
      raw[at + 3] = mark || !transparent ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const [name, size, transparent] of [
  ["icon.png", 1024, false],
  ["adaptive-icon.png", 1024, true],
  ["splash-icon.png", 512, true],
  ["favicon.png", 64, false],
])
  writeFileSync(
    new URL("../assets/" + name, import.meta.url),
    png(size, transparent),
  );
