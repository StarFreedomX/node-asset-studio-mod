import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createExporter, inspectAssets } from "../dist/index.js";

const input = fileURLToPath(new URL("../package.json", import.meta.url));
const workerPath = fileURLToPath(
  new URL("./fixtures/worker.mjs", import.meta.url),
);
const config = { workerPath, log: false, timeoutMs: 5000 };

test("structured protocol preserves UTF-8 and int64 IDs; log words do not decide success", async () => {
  const events = [];
  const result = await inspectAssets(input, {
    ...config,
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.assets[0].pathId, "9047243551543287020");
  assert.equal(
    events[0].message,
    "图片 error failed exception are ordinary asset names",
  );
});

test("sequential operations reuse the worker; typed failure does not poison next request", async () => {
  const exporter = createExporter(config);
  try {
    await exporter.inspect(input);
    const pid = exporter.workerThreadId;
    await assert.rejects(exporter.inspect(input, { filterByName: "error" }), {
      code: "ASSET_PROCESSING_ERROR",
      details: ["typed error"],
    });
    await exporter.inspect(input);
    assert.equal(exporter.workerThreadId, pid);
  } finally {
    await exporter.close();
  }
  assert.equal(exporter.workerThreadId, undefined);
  await assert.rejects(exporter.inspect(input), { code: "CLOSED" });
});

test("abort rejects only after worker termination, and next operation starts a new worker", async () => {
  const exporter = createExporter(config);
  const controller = new AbortController();
  let oldPid;
  try {
    await assert.rejects(
      exporter.inspect(input, {
        filterByName: "hang",
        signal: controller.signal,
        onEvent() {
          oldPid = exporter.workerThreadId;
          controller.abort();
        },
      }),
      { name: "AbortError", code: "ABORTED" },
    );
    assert.equal(exporter.workerThreadId, undefined);
    await exporter.inspect(input);
    assert.notEqual(exporter.workerThreadId, oldPid);
  } finally {
    await exporter.close();
  }
});

test("timeout and concurrent request handling are explicit", async () => {
  const exporter = createExporter(config);
  try {
    const active = assert.rejects(
      exporter.inspect(input, { filterByName: "hang", timeoutMs: 150 }),
      { code: "TIMEOUT" },
    );
    await assert.rejects(exporter.inspect(input), { code: "BUSY" });
    await active;
    assert.equal(exporter.workerThreadId, undefined);
    await exporter.inspect(input);
  } finally {
    await exporter.close();
  }
});

test("close stops an active operation and is idempotent", async () => {
  const exporter = createExporter(config);
  const active = assert.rejects(
    exporter.inspect(input, { filterByName: "hang" }),
    { code: "CLOSED" },
  );
  await exporter.close();
  await active;
  await exporter.close();
  assert.equal(exporter.workerThreadId, undefined);
});

test("malformed response, crash and callback exception stop the worker without hanging", async () => {
  for (const [filterByName, code] of [
    ["malformed", "PROTOCOL_ERROR"],
    ["exit", "WORKER_EXIT"],
  ]) {
    const exporter = createExporter(config);
    try {
      await assert.rejects(
        exporter.inspect(input, { filterByName: filterByName }),
        { code },
      );
      assert.equal(exporter.workerThreadId, undefined);
    } finally {
      await exporter.close();
    }
  }
  await assert.rejects(
    inspectAssets(input, {
      ...config,
      onEvent() {
        throw Error("consumer failure");
      },
    }),
    { code: "CALLBACK_ERROR" },
  );
});

test("missing worker module, invalid timeout and pre-aborted signal produce actionable errors", async () => {
  await assert.rejects(
    inspectAssets(input, {
      ...config,
      workerPath: "/nonexistent-assetstudio/worker.mjs",
    }),
    { code: "WORKER_ERROR" },
  );
  await assert.rejects(inspectAssets(input, { ...config, timeoutMs: -1 }), {
    code: "INVALID_CONFIG",
  });
  const controller = new AbortController();
  controller.abort();
  const exporter = createExporter(config);
  try {
    await assert.rejects(
      exporter.inspect(input, { signal: controller.signal }),
      { code: "ABORTED" },
    );
    assert.equal(exporter.workerThreadId, undefined);
  } finally {
    await exporter.close();
  }
});

test("timeout, close and callback failure also await codec worker termination", async () => {
  for (const code of ["TIMEOUT", "CLOSED", "CALLBACK_ERROR"]) {
    const ex = createExporter({ ...config, maxExportTasks: 2 });
    let pool;
    try {
      await assert.rejects(
        ex.inspect(input, {
          filterByName: "texture-hang",
          timeoutMs: 500,
          onEvent: (e) => {
            if (e.type === "progress" && e.phase === "parse") {
              pool = ex.transport.pool;
              if (code === "CLOSED") void ex.close();
              if (code === "CALLBACK_ERROR") throw Error("callback failure");
            }
          },
        }),
        { code },
      );
      assert.ok(pool?.closed);
      assert.ok(pool.slots.every((s) => s.worker.threadId === -1));
      assert.equal(ex.workerThreadId, undefined);
    } finally {
      await ex.close();
    }
  }
});
