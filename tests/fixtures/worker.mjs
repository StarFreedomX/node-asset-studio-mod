import { parentPort, threadId } from "node:worker_threads";
const send = (value) => parentPort.postMessage(value);
send({ type: "ready", protocol: 2, threadId });
parentPort.on("message", (request) => {
  if (request.type === "texture-result") {
    send({ type: "progress", id: request.id, phase: "parse", percent: 100 });
    return;
  }
  const { id, config } = request;
  switch (config.filterByName) {
    case "texture-hang":
      send({
        type: "texture-task",
        id,
        taskId: 1,
        job: {
          data: Uint8Array.of(255, 0, 0, 255),
          width: 1,
          height: 1,
          format: "rgba32",
          version: [2022, 3, 62],
        },
      });
      break;
    case "hang":
      send({ type: "progress", id, phase: "load", percent: 0 });
      break;
    case "malformed":
      send("invalid protocol");
      break;
    case "exit":
      process.exit(7);
      break;
    case "error":
      send({
        type: "error",
        id,
        error: {
          code: "ASSET_PROCESSING_ERROR",
          message: "corrupt asset",
          details: ["typed error"],
        },
      });
      break;
    default:
      send({
        type: "log",
        id,
        level: "info",
        message: "图片 error failed exception are ordinary asset names",
      });
      send({
        type: "result",
        id,
        result: {
          loadedFiles: 1,
          assetCount: 1,
          exportedCount: 0,
          output: null,
          assets: [
            {
              name: request.input,
              type: "Texture2D",
              pathId: "9047243551543287020",
              container: "",
              size: 1,
              source: String(threadId),
            },
          ],
        },
      });
  }
});
