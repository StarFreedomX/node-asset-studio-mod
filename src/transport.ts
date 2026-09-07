import { TexturePool } from "./texture-pool.js";
import { Worker } from "node:worker_threads";
import path from "node:path";
import {
  AssetStudioError,
  type AssetInput,
  type AssetEvent,
  type AssetResult,
  type OperationOptions,
} from "./types.js";
interface Pending {
  id: string;
  payload: object;
  resolve: (result: AssetResult) => void;
  reject: (error: Error) => void;
  onEvent?: (event: AssetEvent) => void;
  signal?: AbortSignal;
  abort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  failure?: Error;
  concurrency: number;
}
/** One request per worker. terminate() waits until synchronous worker I/O has stopped. */
export class WorkerTransport {
  private worker?: Worker;
  private pool?: TexturePool;
  private poolCleanup: Promise<void> = Promise.resolve();
  private pending?: Pending;
  private ready = false;
  private disposed = false;
  private sequence = 0;
  private exitPromise?: Promise<void>;
  private readonly workerPath: string | URL;
  constructor(options: OperationOptions) {
    this.workerPath = options.workerPath
      ? path.resolve(options.workerPath)
      : new URL("./worker.js", import.meta.url);
  }
  get threadId(): number | undefined {
    return this.worker?.threadId;
  }
  request(
    method: "inspect" | "export" | "read",
    input: AssetInput,
    output: string | undefined,
    config: Record<string, unknown>,
    options: OperationOptions,
  ): Promise<AssetResult> {
    if (this.disposed)
      return Promise.reject(
        new AssetStudioError("CLOSED", "Exporter is closed"),
      );
    if (this.pending)
      return Promise.reject(
        new AssetStudioError(
          "BUSY",
          "This exporter already has an active request; await it or use another instance",
        ),
      );
    if (options.signal?.aborted)
      return Promise.reject(
        new AssetStudioError("ABORTED", "Operation aborted before starting"),
      );
    const timeout = options.timeoutMs ?? 120000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2147483647)
      return Promise.reject(
        new AssetStudioError(
          "INVALID_CONFIG",
          "timeoutMs must be an integer between 0 and 2147483647",
        ),
      );
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      this.pending = {
        id,
        payload: { id, method, input, output, config },
        concurrency: Number(config.maxExportTasks ?? 4),
        resolve,
        reject,
        onEvent: options.onEvent,
        signal: options.signal,
      };
      if (
        this.pool &&
        (this.pool.size !== this.pending.concurrency || this.pool.closed)
      )
        this.discardPool();
      this.pending.abort = () =>
        this.stop(new AssetStudioError("ABORTED", "Operation aborted"));
      options.signal?.addEventListener("abort", this.pending.abort, {
        once: true,
      });
      if (timeout > 0)
        this.pending.timer = setTimeout(
          () =>
            this.stop(
              new AssetStudioError(
                "TIMEOUT",
                `Operation exceeded ${timeout} ms`,
              ),
            ),
          timeout,
        );
      if (!this.worker) this.start();
      else if (this.ready) this.send();
    });
  }
  private start() {
    let worker: Worker;
    try {
      worker = new Worker(this.workerPath, {
        stdout: true,
        stderr: true,
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      });
    } catch (e) {
      this.finish(
        undefined,
        new AssetStudioError("WORKER_START_FAILED", String(e)),
      );
      return;
    }
    this.worker = worker;
    this.ready = false;
    let stderr = "";
    // Always drain third-party output, regardless of public log settings.
    worker.stdout.on("data", () => {});
    worker.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16384);
    });
    this.exitPromise = new Promise((resolve) =>
      worker.on("exit", async (code) => {
        if (this.worker === worker) {
          this.ready = false;
          if (this.pending && !this.pending.failure)
            this.pending.failure = new AssetStudioError(
              "WORKER_EXIT",
              `Worker exited with code ${code}`,
              stderr ? [stderr] : [],
            );
          this.discardPool();
          await this.poolCleanup;
          this.worker = undefined;
          this.finish(
            undefined,
            this.pending?.failure ??
              new AssetStudioError(
                "WORKER_EXIT",
                `Worker exited with code ${code}`,
                stderr ? [stderr] : [],
              ),
          );
        }
        resolve();
      }),
    );
    worker.on("error", (e) =>
      this.stop(new AssetStudioError("WORKER_ERROR", e.message)),
    );
    worker.on("message", (message) => {
      if (this.worker === worker && !this.pending?.failure)
        this.receive(message);
    });
  }
  private send() {
    if (!this.pending || this.pending.failure) return;
    try {
      this.worker!.postMessage(this.pending.payload);
    } catch (e) {
      this.stop(
        new AssetStudioError(
          "INVALID_CONFIG",
          `Request is not cloneable: ${String(e)}`,
        ),
      );
    }
  }
  private receive(message: any) {
    try {
      if (message?.type === "ready") {
        if (this.ready || message.protocol !== 2)
          throw Error("Unsupported worker protocol");
        this.ready = true;
        this.send();
        return;
      }
      if (!this.pending || message?.id !== this.pending.id)
        throw Error("Unexpected response id");
      if (message.type === "texture-task") {
        void this.dispatchTexture(message);
      } else if (message.type === "result") {
        if (
          !message.result ||
          !Array.isArray(message.result.assets) ||
          typeof message.result.assetCount !== "number"
        )
          throw Error("Invalid result");
        this.finish(message.result);
      } else if (message.type === "error") {
        if (
          typeof message.error?.code !== "string" ||
          typeof message.error?.message !== "string"
        )
          throw Error("Invalid error");
        this.finish(
          undefined,
          new AssetStudioError(
            message.error.code,
            message.error.message,
            message.error.details ?? [],
          ),
        );
      } else if (message.type === "log" || message.type === "progress") {
        try {
          this.pending.onEvent?.(message);
        } catch (e) {
          this.stop(
            new AssetStudioError(
              "CALLBACK_ERROR",
              `onEvent failed: ${String(e)}`,
            ),
          );
        }
      } else throw Error("Unknown message");
    } catch (e) {
      this.stop(
        new AssetStudioError(
          "PROTOCOL_ERROR",
          `Invalid worker response: ${String(e)}`,
        ),
      );
    }
  }
  private discardPool() {
    const pool = this.pool;
    this.pool = undefined;
    if (pool)
      this.poolCleanup = Promise.all([this.poolCleanup, pool.close()]).then(
        () => {},
      );
  }
  private async dispatchTexture(message: any) {
    const pending = this.pending!;
    try {
      await this.poolCleanup;
      if (this.pending !== pending || pending.failure) return;
      if (
        !Number.isInteger(pending.concurrency) ||
        pending.concurrency < 2 ||
        pending.concurrency > 64
      )
        throw new AssetStudioError(
          "PROTOCOL_ERROR",
          "Invalid texture concurrency",
        );
      this.pool ??= new TexturePool(pending.concurrency);
      const data = await this.pool.submit(message.job);
      if (this.pending === pending && !pending.failure)
        this.worker?.postMessage(
          {
            type: "texture-result",
            id: pending.id,
            taskId: message.taskId,
            data,
          },
          [data.buffer as ArrayBuffer],
        );
    } catch (error) {
      if (this.pending === pending && !pending.failure) {
        const e = error as any;
        this.worker?.postMessage({
          type: "texture-result",
          id: pending.id,
          taskId: message.taskId,
          error: {
            code: e.code ?? "ASSET_PROCESSING_ERROR",
            message: e.message,
          },
        });
      }
    }
  }
  private finish(result?: AssetResult, error?: Error) {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    clearTimeout(p.timer);
    if (p.abort) p.signal?.removeEventListener("abort", p.abort);
    if (error) p.reject(error);
    else p.resolve(result!);
  }
  private stop(error: Error) {
    if (this.pending && !this.pending.failure) this.pending.failure = error;
    this.discardPool();
    if (this.worker) void this.worker.terminate();
    else this.finish(undefined, error);
  }
  async close(): Promise<void> {
    this.disposed = true;
    this.stop(new AssetStudioError("CLOSED", "Exporter closed"));
    await this.exitPromise;
    await this.poolCleanup;
  }
}
