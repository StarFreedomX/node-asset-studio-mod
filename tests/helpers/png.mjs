import { inflateSync } from "node:zlib";
import assert from "node:assert/strict";
export function rgbaPng(png) {
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6);
  assert.equal(png[28], 0);
  const chunks = [];
  for (let p = 8; p < png.length; ) {
    const size = png.readUInt32BE(p);
    if (png.toString("ascii", p + 4, p + 8) === "IDAT")
      chunks.push(png.subarray(p + 8, p + 8 + size));
    p += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * 4,
    out = Buffer.alloc(stride * height);
  assert.equal(raw.length, (stride + 1) * height);
  function paeth(a, b, c) {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1),
      f = raw[base];
    assert.ok(f <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x,
        a = x >= 4 ? out[i - 4] : 0,
        b = y ? out[i - stride] : 0,
        c = y && x >= 4 ? out[i - stride - 4] : 0;
      out[i] =
        (raw[base + 1 + x] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][f]) &
        255;
    }
  }
  return { width, height, data: out };
}
