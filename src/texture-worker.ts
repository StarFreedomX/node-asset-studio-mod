import { parentPort } from "node:worker_threads";
if (!parentPort) throw Error("Texture codec must run in a Worker");
globalThis.fetch = async () => {
  throw Error("Runtime network access is disabled");
};
const { convertTexture } = await import("./texture-engine.js");
parentPort.on("message", async ({ id, job }) => {
  try {
    const data = await convertTexture(job);
    parentPort!.postMessage({ id, data }, [data.buffer as ArrayBuffer]);
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: String((error as Error).message ?? error),
    });
  }
});
parentPort.postMessage({ ready: true });
