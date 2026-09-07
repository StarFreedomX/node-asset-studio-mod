import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { createExporter, inspectAssets, readAssets } from "../dist/index.js";

const input = process.env.ASSET_STUDIO_TEST_INPUT;
assert.ok(
  input,
  "Set ASSET_STUDIO_TEST_INPUT to the res014089 fixture (it is not committed)",
);
const config = {
  unityVersion: process.env.ASSET_STUDIO_TEST_UNITY_VERSION ?? "2022.3.62f1",
  log: false,
  timeoutMs: 30000,
};

test("res014089: inspect, filter/reset, same-worker PNG export, filenameFormat and literal paths", async () => {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "assetstudio-integration-"),
  );
  const exporter = createExporter(config);
  try {
    const trickyInput = path.join(
      temporary,
      '中文 error; $(echo injected) "quoted".bundle',
    );
    await copyFile(input, trickyInput);
    const info = await exporter.inspect(trickyInput);
    assert.equal(info.loadedFiles, 1);
    assert.equal(info.assetCount, 4);
    assert.ok(info.assets.every((a) => a.type === "Texture2D"));
    assert.ok(info.assets.some((a) => a.pathId === "9047243551543287020"));
    const pid = exporter.workerThreadId;
    const filtered = await exporter.inspect(trickyInput, {
      filterByName: "normal",
    });
    assert.equal(filtered.assetCount, 2);
    const reset = await exporter.inspect(trickyInput);
    assert.equal(reset.assetCount, 4);
    assert.equal(exporter.workerThreadId, pid);
    const events = [];
    const out = path.join(temporary, 'output; $literal "quotes" 中文');
    const result = await exporter.exportAssets(trickyInput, out, {
      assetType: "tex2d",
      imageFormat: "png",
      group: "none",
      filenameFormat: "pathID",
      onEvent: (e) => events.push(e),
    });
    assert.equal(result.exportedCount, 4);
    assert.equal(exporter.workerThreadId, pid);
    assert.ok(
      events.some((e) => e.type === "progress" && e.phase === "export"),
    );
    const files = await readdir(out);
    assert.equal(files.length, 4);
    for (const asset of info.assets) {
      const png = await readFile(path.join(out, asset.pathId + ".png"));
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const width = png.readUInt32BE(16),
        height = png.readUInt32BE(20);
      assert.deepEqual(
        [width, height],
        asset.name.startsWith("card") ? [1334, 1002] : [1024, 1024],
      );
      assert.equal(png[24], 8); // eight-bit RGBA
      assert.equal(png[25], 6);
      const idat = [];
      let end = false;
      for (let offset = 8; offset < png.length; ) {
        const size = png.readUInt32BE(offset),
          type = png.toString("ascii", offset + 4, offset + 8);
        if (type === "IDAT")
          idat.push(png.subarray(offset + 8, offset + 8 + size));
        if (type === "IEND") end = true;
        offset += 12 + size;
      }
      assert.ok(end);
      assert.equal(
        inflateSync(Buffer.concat(idat)).length,
        height * (1 + width * 4),
      );
    }
    // Existing files are explicit typed failures, even when logs are disabled.
    await assert.rejects(
      exporter.exportAssets(trickyInput, out, {
        group: "none",
        filenameFormat: "pathID",
      }),
      { code: "ASSET_PROCESSING_ERROR" },
    );
    assert.equal(
      (
        await exporter.exportAssets(trickyInput, out, {
          group: "none",
          filenameFormat: "pathID",
          overwrite: true,
        })
      ).exportedCount,
      4,
    );
    const empty = path.join(temporary, "empty");
    await mkdir(empty);
    await assert.rejects(exporter.inspect(empty), {
      code: "ASSET_PROCESSING_ERROR",
    });
    await assert.rejects(exporter.inspect(input, { group: "unknown" }), {
      code: "INVALID_CONFIG",
    });
    await assert.rejects(exporter.inspect(input, { maxOutputBytes: "oops" }), {
      code: "INVALID_CONFIG",
    });
    await assert.rejects(exporter.inspect(input, { misspelledOption: true }), {
      code: "UNSUPPORTED_OPTION",
    });
    await assert.rejects(exporter.inspect(input, { unityVersion: "2022.3" }), {
      code: "INVALID_CONFIG",
    });
    assert.equal((await exporter.inspect(input)).assetCount, 4);
  } finally {
    await exporter.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test("res014089: active cancellation, timeout and fresh worker recovery", async () => {
  const exporter = createExporter(config);
  const controller = new AbortController();
  try {
    await assert.rejects(
      exporter.inspect(input, {
        signal: controller.signal,
        onEvent(e) {
          if (e.type === "progress" && e.phase === "load") controller.abort();
        },
      }),
      { code: "ABORTED" },
    );
    assert.equal(exporter.workerThreadId, undefined);
    await assert.rejects(exporter.inspect(input, { timeoutMs: 1 }), {
      code: "TIMEOUT",
    });
    assert.equal(exporter.workerThreadId, undefined);
    assert.equal((await exporter.inspect(input)).assetCount, 4);
  } finally {
    await exporter.close();
  }
});

test("res014089: separate instances can process concurrently with isolated filters", async () => {
  const [a, b] = await Promise.all([
    inspectAssets(input, { ...config, filterByName: "normal" }),
    inspectAssets(input, { ...config, filterByName: "after_training" }),
  ]);
  assert.equal(a.assetCount, 2);
  assert.equal(b.assetCount, 2);
  assert.ok(a.assets.every((x) => x.name.endsWith("normal")));
  assert.ok(b.assets.every((x) => x.name.endsWith("after_training")));
});

// Golden hashes were captured from the previous AssetStudio/.NET PNG exports.
// Compare decoded pixels: PNG compression and metadata can differ by encoder.
const golden = JSON.parse(
  await readFile(new URL("./fixtures/res014089-pixels.json", import.meta.url)),
);
const { rgbaPng } = await import("./helpers/png.mjs");
const { createHash } = await import("node:crypto");
function checkPixels(files) {
  assert.equal(files.length, 4);
  for (const file of files) {
    const expected = golden[path.basename(file.path)];
    assert.ok(expected, file.path);
    const decoded = rgbaPng(Buffer.from(file.data));
    assert.deepEqual(
      [decoded.width, decoded.height],
      [expected.width, expected.height],
    );
    assert.equal(
      createHash("sha256").update(decoded.data).digest("hex"),
      expected.rgbaSha256,
    );
  }
}

test("res014089: Buffer, sliced Uint8Array and ArrayBuffer input return pixel-identical memory PNGs", async () => {
  const source = await readFile(input);
  const padded = new Uint8Array(source.length + 37);
  padded.set(source, 19);
  const view = padded.subarray(19, 19 + source.length);
  const exporter = createExporter(config);
  try {
    for (const bytes of [source, view, Uint8Array.from(source).buffer]) {
      const result = await exporter.readAssets(bytes);
      assert.equal(result.output, null);
      assert.equal(result.exportedCount, 4);
      checkPixels(result.files);
      assert.ok(bytes.byteLength > 0, "caller memory must not be detached");
    }
    assert.deepEqual(
      source,
      await readFile(input),
      "source must not be modified",
    );
    assert.deepEqual(Buffer.from(view), source);
  } finally {
    await exporter.close();
  }
});

test("res014089: extract and companion resources round-trip; raw and TypeTree remain accessible", async () => {
  const extracted = await readAssets(input, { ...config, mode: "extract" });
  assert.equal(extracted.files.length, 2);
  const serialized = extracted.files.find((f) => !f.path.endsWith(".resS"));
  const resource = extracted.files.find((f) => f.path.endsWith(".resS"));
  const converted = await readAssets(serialized.data, {
    ...config,
    resourceFiles: { [resource.path]: resource.data },
  });
  checkPixels(converted.files);
  const raw = await readAssets(input, {
    ...config,
    mode: "exportRaw",
    group: "none",
  });
  assert.deepEqual(
    raw.files.map((f) => f.data.length),
    [224, 224, 216, 216],
  );
  const dump = await readAssets(input, { ...config, mode: "dump" });
  assert.equal(dump.files.length, 4);
  for (const f of dump.files)
    assert.equal(typeof JSON.parse(Buffer.from(f.data).toString()), "object");
  const texture = await readAssets(input, { ...config, imageFormat: "none" });
  assert.equal(texture.files.length, 4);
  assert.ok(
    texture.files.every(
      (f) => f.path.endsWith(".tex") && f.data.length > 4000000,
    ),
  );
});

test("res014089: limits and removed engine options fail explicitly and allow recovery", async () => {
  const exporter = createExporter(config);
  try {
    for (const limit of [
      { maxInputBytes: 1 },
      { maxOutputBytes: 1 },
      { maxTexturePixels: 1 },
    ]) {
      await assert.rejects(exporter.readAssets(input, limit), {
        code: "LIMIT_EXCEEDED",
      });
    }
    for (const options of [{ fbxScaleFactor: 1 }, { dotnetPath: "/missing" }]) {
      await assert.rejects(exporter.inspect(input, options), {
        code: "UNSUPPORTED_OPTION",
      });
    }
    await assert.rejects(exporter.readAssets(input, { mode: "animator" }), {
      code: "INVALID_CONFIG",
    });
    await assert.rejects(exporter.readAssets(input, { imageFormat: "jpg" }), {
      code: "INVALID_CONFIG",
    });
    await assert.rejects(exporter.readAssets(new Uint8Array([1, 2, 3])), {
      code: "ASSET_PROCESSING_ERROR",
    });
    assert.equal((await exporter.inspect(input)).assetCount, 4);
  } finally {
    await exporter.close();
  }
});

test(
  "ASTC 6x6: non-block-aligned stream texture matches .NET pixels through Buffer and path APIs",
  { skip: !process.env.ASSET_STUDIO_TEST_ASTC_INPUT },
  async () => {
    const astcInput = process.env.ASSET_STUDIO_TEST_ASTC_INPUT;
    const expected = JSON.parse(
      await readFile(
        new URL("./fixtures/astc-comment-banner-pixels.json", import.meta.url),
      ),
    );
    for (const source of [astcInput, await readFile(astcInput)]) {
      const r = await readAssets(source, {
        ...config,
        assetType: "tex2d",
        filterByName: "comment_banner_band4_chapter03",
      });
      assert.equal(r.exportedCount, 1);
      const png = rgbaPng(Buffer.from(r.files[0].data));
      assert.deepEqual(
        [png.width, png.height],
        [expected.width, expected.height],
      );
      assert.equal(
        createHash("sha256").update(png.data).digest("hex"),
        expected.rgbaSha256,
      );
    }
  },
);

test("parallel PNG matches serial bytes/order, supports per-request resizing and limits", async () => {
  const ex = createExporter({ ...config, maxExportTasks: 1 });
  try {
    const serial = await ex.readAssets(input);
    for (const maxExportTasks of [2, 4, 1]) {
      const result = await ex.readAssets(input, { maxExportTasks });
      assert.deepEqual(
        result.files.map((f) => f.path),
        serial.files.map((f) => f.path),
      );
      for (let i = 0; i < result.files.length; i++)
        assert.deepEqual(result.files[i].data, serial.files[i].data);
    }
    for (const maxExportTasks of [0, 65, 1.5])
      await assert.rejects(ex.readAssets(input, { maxExportTasks }), {
        code: "INVALID_CONFIG",
      });
    await assert.rejects(
      ex.readAssets(input, { maxExportTasks: 4, maxOutputBytes: 1 }),
      { code: "LIMIT_EXCEEDED" },
    );
    assert.equal(
      (await ex.readAssets(input, { maxExportTasks: 2 })).exportedCount,
      4,
    );
  } finally {
    await ex.close();
  }
});
test("aborting parallel export waits for parser and codec workers to stop, then recovers", async () => {
  const ex = createExporter({ ...config, maxExportTasks: 2 });
  const controller = new AbortController();
  let pool;
  try {
    await assert.rejects(
      ex.readAssets(input, {
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === "progress" && e.phase === "export") {
            pool = ex.transport.pool;
            controller.abort();
          }
        },
      }),
      { code: "ABORTED" },
    );
    assert.ok(pool?.closed);
    assert.ok(pool.slots.every((s) => s.worker.threadId === -1));
    assert.equal(ex.workerThreadId, undefined);
    assert.equal((await ex.readAssets(input)).exportedCount, 4);
  } finally {
    await ex.close();
  }
});

test(
  "gacha1937: default all exports Shader and duplicate MonoBehaviours through memory, disk and parallel codecs",
  { skip: !process.env.ASSET_STUDIO_TEST_SHADER_INPUT },
  async () => {
    const fixture = process.env.ASSET_STUDIO_TEST_SHADER_INPUT;
    const exporter = createExporter(config),
      temp = await mkdtemp(path.join(tmpdir(), "asset-shader-"));
    try {
      const serial = await exporter.readAssets(await readFile(fixture), {
        maxExportTasks: 1,
      });
      assert.equal(serial.exportedCount, 13);
      assert.equal(new Set(serial.files.map((f) => f.path)).size, 13);
      assert.equal(
        serial.assets.filter((a) => a.type === "MonoBehaviour").length,
        8,
      );
      assert.ok(
        serial.assets
          .filter((a) => a.type === "MonoBehaviour")
          .every((a) => a.name !== "<empty>"),
      );
      assert.ok(
        serial.files.some((f) => /UITexture @-?\d+\.json$/.test(f.path)),
      );
      const shader = serial.files.find((f) => f.path.endsWith(".shader"));
      assert.ok(shader.path.endsWith("/Unlit_Transparent Colored.shader"));
      const text = Buffer.from(shader.data).toString();
      assert.match(text, /Shader "Unlit\/Transparent Colored"/);
      assert.match(text, /#ifdef VERTEX/);
      assert.match(text, /OpEntryPoint Vertex/);
      assert.match(text, /OpEntryPoint Fragment/);
      assert.doesNotMatch(text, /undefined|NaN|not supported/);
      const parallel = await exporter.readAssets(fixture, {
        maxExportTasks: 4,
      });
      assert.deepEqual(parallel.files, serial.files);
      const disk = await exporter.exportAssets(fixture, temp, {
        maxExportTasks: 1,
      });
      assert.equal(disk.exportedCount, 13);
      for (const f of serial.files)
        assert.deepEqual(
          await readFile(path.join(temp, f.path)),
          Buffer.from(f.data),
        );
      const only = await exporter.readAssets(fixture, {
        assetType: "shader",
        filterByName: "Unlit/Transparent Colored",
        filenameFormat: "pathID",
      });
      assert.equal(only.exportedCount, 1);
      assert.deepEqual(only.files[0].data, shader.data);
      const raw = await exporter.readAssets(fixture, {
        assetType: "shader",
        mode: "exportRaw",
      });
      assert.equal(raw.exportedCount, 1);
      assert.notDeepEqual(raw.files[0].data, shader.data);
    } finally {
      await exporter.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
