import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createExporter } from "../dist/index.js";

// A plain UnityFS archive assembled independently of the library's serializer.
// Its serialized node intentionally is not parseable: extract must not parse it.
function archive(name, flags = 4) {
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const u64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    return b;
  };
  const data = Buffer.from("opaque internal file contents");
  const metadata = Buffer.concat([
    Buffer.alloc(16),
    u32(1),
    u32(data.length),
    u32(data.length),
    Buffer.alloc(2),
    u32(1),
    u64(0),
    u64(data.length),
    u32(flags),
    Buffer.from(name + "\0"),
  ]);
  const prefix = Buffer.concat([
    Buffer.from("UnityFS\0"),
    u32(6),
    Buffer.from("5.x.x\0" + "2022.3.62f1\0"),
  ]);
  return {
    data,
    bytes: Buffer.concat([
      prefix,
      u64(prefix.length + 20 + metadata.length + data.length),
      u32(metadata.length),
      u32(metadata.length),
      u32(0x40),
      metadata,
      data,
    ]),
  };
}

test("directory extract visits nested bundles once, bypasses object parsing and preserves bytes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-directory-"));
  const ex = createExporter({ mode: "extract", log: false });
  try {
    await fs.mkdir(path.join(dir, "input/nested"), { recursive: true });
    const first = archive("CAB-first"),
      second = archive("CAB-second.resS", 0);
    await fs.writeFile(path.join(dir, "input/a"), first.bytes);
    await fs.writeFile(path.join(dir, "input/nested/b"), second.bytes);
    const events = [];
    const r = await ex.exportAssets(
      path.join(dir, "input"),
      path.join(dir, "output"),
      { onEvent: (e) => events.push(e) },
    );
    assert.equal(r.exportedCount, 2);
    assert.equal(r.loadedFiles, 1);
    assert.equal(r.assetCount, 0);
    assert.deepEqual(
      await fs.readFile(path.join(dir, "output/CAB-first")),
      first.data,
    );
    assert.deepEqual(
      await fs.readFile(path.join(dir, "output/CAB-second.resS")),
      second.data,
    );
    const progress = events.filter(
      (e) => e.type === "progress" && e.phase === "extract",
    );
    assert.deepEqual(
      progress.map((e) => [e.completed, e.total]),
      [
        [1, 2],
        [2, 2],
      ],
    );
    await assert.rejects(
      ex.readAssets(path.join(dir, "input"), { maxOutputBytes: 1 }),
      { code: "LIMIT_EXCEEDED" },
    );
    const memory = await ex.readAssets(path.join(dir, "input"));
    assert.equal(memory.files.length, 2);
    assert.deepEqual(Buffer.from(memory.files[0].data), first.data);
  } finally {
    await ex.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("extract still rejects traversal and duplicate paths across directory bundles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-invalid-"));
  const ex = createExporter({ mode: "extract", log: false });
  try {
    await assert.rejects(ex.readAssets(archive("../outside").bytes), {
      code: "UNSAFE_PATH",
    });
    const bundle = archive("duplicate").bytes;
    await fs.writeFile(path.join(dir, "a"), bundle);
    await fs.writeFile(path.join(dir, "b"), bundle);
    await assert.rejects(ex.readAssets(dir), /Duplicate output name/);
    assert.equal((await ex.readAssets(bundle)).exportedCount, 1);
  } finally {
    await ex.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
