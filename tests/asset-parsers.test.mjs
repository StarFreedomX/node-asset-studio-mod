import test from "node:test";
import assert from "node:assert/strict";
import { readAssets, inspectAssets } from "../dist/index.js";
import { Writer, serialized, textureArray } from "./helpers/serialized.mjs";
import { rgbaPng } from "./helpers/png.mjs";
const color = (r, g, b) =>
  Buffer.from([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]);
const red = color(255, 0, 0),
  green = color(0, 255, 0);
test("Texture2DArray default all: layers respect mip stride, names and concurrent PNG order", async () => {
  const data = Buffer.concat([
    red,
    Buffer.alloc(4, 7),
    green,
    Buffer.alloc(4, 9),
  ]);
  const input = serialized([
    { type: 187, id: 9007199254740993n, data: textureArray({ data, mips: 2 }) },
  ]);
  assert.equal(
    (await inspectAssets(input, { log: false })).assets[0].name,
    "array",
  );
  for (const maxExportTasks of [1, 2]) {
    const r = await readAssets(input, { log: false, maxExportTasks });
    assert.equal(r.assetCount, 1);
    assert.equal(r.exportedCount, 2);
    assert.deepEqual(
      r.files.map((f) => f.path),
      ["array_1.png", "array_2.png"],
    );
    assert.deepEqual(rgbaPng(Buffer.from(r.files[0].data)).data, red);
    assert.deepEqual(rgbaPng(Buffer.from(r.files[1].data)).data, green);
  }
  const raw = await readAssets(input, {
    imageFormat: "none",
    filenameFormat: "pathID",
    log: false,
  });
  assert.deepEqual(
    raw.files.map((f) => f.path),
    ["9007199254740993_1.tex", "9007199254740993_2.tex"],
  );
  assert.deepEqual(Buffer.from(raw.files[1].data), green);
});
test("Texture2DArray supports legacy layout and companion resources with exact stream offsets", async () => {
  for (const year of [2018, 2022]) {
    const data = Buffer.concat([red, green]),
      bundle = serialized(
        [
          {
            type: 187,
            data: textureArray({
              data,
              version: year,
              stream: { path: "array.resS", offset: 7 },
            }),
          },
        ],
        `${year}.3.0f1`,
      );
    const r = await readAssets(bundle, {
      log: false,
      resourceFiles: { "array.resS": Buffer.concat([Buffer.alloc(7), data]) },
    });
    assert.equal(r.files.length, 2);
    assert.deepEqual(rgbaPng(Buffer.from(r.files[1].data)).data, green);
    await assert.rejects(readAssets(bundle, { log: false }), /resource/i);
  }
});
test("Texture2DArray rejects bad dimensions, missing mip bytes and output budget overflow", async () => {
  for (const options of [{ depth: 0 }, { dataSize: 33 }, { mips: 3 }]) {
    const input = serialized([
      {
        type: 187,
        data: textureArray({ data: Buffer.concat([red, green]), ...options }),
      },
    ]);
    await assert.rejects(readAssets(input, { log: false }));
  }
  const input = serialized([
    { type: 187, data: textureArray({ data: Buffer.concat([red, green]) }) },
  ]);
  await assert.rejects(readAssets(input, { log: false, maxOutputBytes: 1 }), {
    code: "LIMIT_EXCEEDED",
  });
});
test("MovieTexture preserves original OGV bytes and detects truncated movie payload", async () => {
  const ogv = Buffer.from("OggS\x00synthetic-video-payload");
  const b = new Writer()
    .str("clip")
    .i32(0)
    .u8(0)
    .align()
    .u8(1)
    .align()
    .i32(0)
    .i64(0)
    .i32(ogv.length)
    .bytes(ogv)
    .end();
  const input = serialized([{ type: 152, data: b }], "2018.4.0f1");
  const r = await readAssets(input, { log: false });
  assert.equal(r.exportedCount, 1);
  assert.equal(r.files[0].path, "clip.ogv");
  assert.deepEqual(Buffer.from(r.files[0].data), ogv);
  await assert.rejects(
    readAssets(
      serialized([{ type: 152, data: b.subarray(0, -1) }], "2018.4.0f1"),
      { log: false },
    ),
    /Truncated/,
  );
});
