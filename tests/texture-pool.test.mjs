import test from "node:test";
import assert from "node:assert/strict";
import { TexturePool } from "../dist/texture-pool.js";
const worker = new URL("./fixtures/texture-worker.mjs", import.meta.url);
const job = (n, counts, delay = 60) => ({
  data: Uint8Array.of(n),
  counts,
  delay,
});
test("codec pool runs CPU tasks on bounded independent workers, preserving task identity", async () => {
  const pool = new TexturePool(3, worker),
    counts = new SharedArrayBuffer(12);
  try {
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) => pool.submit(job(i, counts))),
    );
    assert.deepEqual(
      results.map((a) => a[0]),
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.equal(Atomics.load(new Int32Array(counts), 1), 3);
    assert.equal(pool.slots.length, 3);
  } finally {
    await pool.close();
  }
  assert.ok(pool.slots.every((s) => s.worker.threadId === -1));
});
test("pool close rejects queued and active tasks and waits for every worker exit", async () => {
  const pool = new TexturePool(2, worker),
    counts = new SharedArrayBuffer(12);
  const finished = Promise.allSettled(
    Array.from({ length: 6 }, (_, i) => pool.submit(job(i, counts, 10000))),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  await pool.close();
  assert.ok((await finished).every((r) => r.status === "rejected"));
  assert.ok(pool.slots.every((s) => s.worker.threadId === -1));
});
test("codec crash and malformed reply reject the whole queue without hanging", async () => {
  for (const n of [255, 254]) {
    const pool = new TexturePool(2, worker),
      counts = new SharedArrayBuffer(12);
    const settled = await Promise.allSettled([
      pool.submit(job(n, counts)),
      pool.submit(job(2, counts, 10000)),
      pool.submit(job(3, counts)),
    ]);
    assert.ok(settled.every((r) => r.status === "rejected"));
    await pool.close();
    assert.ok(pool.slots.every((s) => s.worker.threadId === -1));
  }
});
