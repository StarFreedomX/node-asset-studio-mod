import { parentPort, threadId } from "node:worker_threads";
import { format } from "node:util";
import { AssetStudioError, type AssetEvent } from "./types.js";
if (!parentPort) throw Error("This module must run inside a Node.js worker");
let emit: ((event: AssetEvent) => void) | undefined;
let activeId: string | undefined;
const levels = ["verbose", "debug", "info", "warning", "error"];
let minimum = "info";
for (const [method, level] of Object.entries({
  log: "info",
  info: "info",
  debug: "debug",
  warn: "warning",
  error: "error",
})) {
  console[method] = (...args: unknown[]) => {
    if (activeId && levels.indexOf(level) >= levels.indexOf(minimum))
      emit?.({
        type: "log",
        id: activeId,
        level: level as any,
        message: format(...args),
      });
  };
}
// All codecs are bundled. Asset paths must never cause hidden HTTP requests.
globalThis.fetch = async () => {
  throw new AssetStudioError(
    "NETWORK_DISABLED",
    "Runtime network access is disabled; provide resourceFiles instead",
  );
};
let taskSequence = 0;
const textureTasks = new Map<
  number,
  { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }
>();
const { execute } = await import("./engine.js");
parentPort.on("message", async (request) => {
  if (request.type === "texture-result") {
    const task = textureTasks.get(request.taskId);
    if (task && request.id === activeId) {
      textureTasks.delete(request.taskId);
      if (request.error)
        task.reject(
          new AssetStudioError(request.error.code, request.error.message),
        );
      else task.resolve(request.data);
    }
    return;
  }
  if (activeId) {
    parentPort!.postMessage({
      type: "error",
      id: request.id,
      error: { code: "BUSY", message: "Worker is busy" },
    });
    return;
  }
  activeId = request.id;
  minimum = request.config?.logLevel ?? "info";
  emit = (e) => parentPort!.postMessage(e);
  let response: object;
  try {
    response = {
      type: "result",
      id: request.id,
      result: await execute(
        request,
        emit,
        (job) =>
          new Promise((resolve, reject) => {
            const taskId = ++taskSequence;
            textureTasks.set(taskId, { resolve, reject });
            parentPort!.postMessage(
              { type: "texture-task", id: activeId, taskId, job },
              [job.data.buffer as ArrayBuffer],
            );
          }),
      ),
    };
  } catch (error) {
    const e = error as any;
    response = {
      type: "error",
      id: request.id,
      error: {
        code:
          e.code && typeof e.code === "string" && !e.code.startsWith("E")
            ? e.code
            : "ASSET_PROCESSING_ERROR",
        message: e.message ?? String(e),
        details: e.details ?? [],
      },
    };
  } finally {
    activeId = undefined;
    emit = undefined;
  }
  parentPort!.postMessage(response);
});
parentPort.postMessage({ type: "ready", protocol: 2, threadId });
