import test from "node:test";
import assert from "node:assert/strict";
import {
  decodePackedPixels,
  decodeSpecialPixels,
} from "../dist/texture-engine.js";
import { decodeExtraBlocks } from "../dist/texture-codecs.js";
import { meshTriangles } from "../dist/mesh-layout.js";
test("packed texture codecs preserve channel order, half floats and 16-bit integers", () => {
  assert.deepEqual(
    [...decodePackedPixels(Uint8Array.of(3, 2, 1, 4), 1, 1, "bgra32")],
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    [...decodePackedPixels(Uint8Array.of(4, 1, 2, 3), 1, 1, "argb32")],
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    [
      ...decodePackedPixels(
        Uint8Array.of(0, 0x3c, 0, 0x38, 0, 0, 0, 0x3c),
        1,
        1,
        "rgbahalf",
      ),
    ],
    [255, 128, 0, 255],
  );
  assert.deepEqual(
    [
      ...decodePackedPixels(
        Uint8Array.of(0xff, 0xff, 0x80, 0x80),
        1,
        1,
        "rg32",
      ),
    ],
    [255, 128, 0, 255],
  );
  assert.throws(
    () => decodePackedPixels(Uint8Array.of(1), 1, 1, "rgba64"),
    /Truncated/,
  );
  assert.deepEqual(
    [...decodeSpecialPixels(Uint8Array.of(16, 128, 235, 128), 2, 1, "yuy2")],
    [0, 0, 0, 255, 255, 255, 255, 255],
  );
});
test("BC4/BC5/BC6 and PVRTC decode offline with bounded block input", async () => {
  const bc4 = Uint8Array.of(255, 0, 0, 0, 0, 0, 0, 0),
    bc5 = Uint8Array.from([...bc4, ...[128, 0, 0, 0, 0, 0, 0, 0]]);
  assert.deepEqual(
    [...(await decodeExtraBlocks(bc4, 1, 1, 4))],
    [255, 0, 0, 255],
  );
  assert.deepEqual(
    [...(await decodeExtraBlocks(bc5, 1, 1, 5))],
    [255, 128, 0, 255],
  );
  for (const [format, w, h] of [
    [6, 4, 4],
    [12, 16, 8],
    [14, 8, 8],
  ]) {
    const result = await decodeExtraBlocks(new Uint8Array(32), w, h, format);
    assert.equal(result.length, w * h * 4);
  }
  await assert.rejects(
    decodeExtraBlocks(new Uint8Array(7), 4, 4, 4),
    /Truncated/,
  );
  await assert.rejects(
    decodeExtraBlocks(new Uint8Array(64), 3, 8, 14),
    /powers of two/,
  );
});
test("triangulation preserves quads, strip winding and baseVertex without changing source counts", () => {
  const mesh = {
    vertices: Array(6),
    use16BitIndices: true,
    indexBuffer: [0, 1, 2, 3],
  };
  const quad = {
    firstByte: 0,
    indexCount: 4,
    baseVertex: 2,
    topology: "Quads",
  };
  assert.deepEqual(meshTriangles(mesh, quad), [2, 3, 4, 2, 4, 5]);
  assert.equal(quad.indexCount, 4);
  assert.deepEqual(
    meshTriangles(mesh, { ...quad, topology: "TriangleStrip" }),
    [2, 3, 4, 4, 3, 5],
  );
  assert.deepEqual(meshTriangles(mesh, quad, true), [4, 3, 2, 5, 4, 2]);
  assert.throws(
    () => meshTriangles(mesh, { ...quad, baseVertex: 3 }),
    /out of range/,
  );
});
