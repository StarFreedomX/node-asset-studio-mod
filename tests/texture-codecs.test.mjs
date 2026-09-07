import test from "node:test";
import assert from "node:assert/strict";
import { decodeAstcRgba } from "../dist/engine.js";

// ASTC LDR void-extent block: constant RGBA16, deliberately different R/B
// and non-opaque alpha. Independent of proprietary game fixtures.
const block = Uint8Array.of(
  0xfc,
  0xfd,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0xff,
  0x11,
  0x11,
  0x55,
  0x55,
  0xcc,
  0xcc,
  0x88,
  0x88,
);
test("bundled ASTC: all block sizes, RGBA channels, alpha and cropped edge blocks, offline", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("Unexpected runtime download");
  };
  try {
    for (const size of [4, 5, 6, 8, 10, 12]) {
      const width = size + 1,
        height = size - 1;
      const input = new Uint8Array(32);
      input.set(block);
      input.set(block, 16);
      const rgba = await decodeAstcRgba(input, width, height, size);
      assert.equal(rgba.length, width * height * 4);
      for (let i = 0; i < rgba.length; i += 4)
        assert.deepEqual(
          [...rgba.subarray(i, i + 4)],
          [0x11, 0x55, 0xcc, 0x88],
        );
    }
  } finally {
    globalThis.fetch = fetch;
  }
});
test("ASTC rejects truncated blocks and invalid dimensions before entering WASM", async () => {
  await assert.rejects(decodeAstcRgba(block, 7, 7, 6), /Truncated/);
  for (const args of [
    [0, 2, 6],
    [2.5, 2, 6],
    [2, 2, 7],
    [2 ** 30, 2 ** 30, 6],
  ])
    await assert.rejects(decodeAstcRgba(block, ...args), /Invalid/);
});
