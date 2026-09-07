import { Worker } from "node:worker_threads";
import { AssetStudioError } from "./types.js";
import type { TextureJob } from "./texture-engine.js";
interface Task {
  id: number;
  job: TextureJob;
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
}
interface Slot {
  worker: Worker;
  ready: boolean;
  task?: Task;
  exited: Promise<void>;
}
/** Owned by the caller thread, so stopping an engine also stops all its codecs. */
export class TexturePool {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private sequence = 0;
  closed = false;
  constructor(
    readonly size: number,
    private workerPath: URL = new URL("./texture-worker.js", import.meta.url),
  ) {}
  submit(job: TextureJob): Promise<Uint8Array> {
    if (this.closed)
      return Promise.reject(
        new AssetStudioError("WORKER_EXIT", "Texture pool closed"),
      );
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.sequence, job, resolve, reject });
      this.pump();
    });
  }
  private pump() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.task || !this.queue.length) continue;
      slot.task = this.queue.shift()!;
      try {
        slot.worker.postMessage({ id: slot.task.id, job: slot.task.job }, [
          slot.task.job.data.buffer as ArrayBuffer,
        ]);
      } catch (e) {
        this.fail(e as Error);
        return;
      }
    }
    // One task per worker; the engine limits the number of queued/completed images.
    if (this.queue.length && this.slots.length < this.size) {
      try {
        const worker = new Worker(this.workerPath, {
          execArgv: [],
          stdout: true,
          stderr: true,
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        });
        worker.stdout.on("data", () => {});
        worker.stderr.on("data", () => {});
        const slot: Slot = {
          worker,
          ready: false,
          exited: new Promise((resolve) =>
            worker.once("exit", () => resolve()),
          ),
        };
        this.slots.push(slot);
        worker.on("message", (message) => {
          if (this.closed) return;
          if (message?.ready === true && !slot.ready) {
            slot.ready = true;
            this.pump();
            return;
          }
          const task = slot.task;
          if (
            !task ||
            message?.id !== task.id ||
            (!(message.data instanceof Uint8Array) &&
              typeof message.error !== "string")
          ) {
            this.fail(
              new AssetStudioError(
                "PROTOCOL_ERROR",
                "Invalid texture worker response",
              ),
            );
            return;
          }
          slot.task = undefined;
          if (message.error)
            task.reject(
              new AssetStudioError("ASSET_PROCESSING_ERROR", message.error),
            );
          else task.resolve(message.data);
          this.pump();
        });
        worker.on("error", (e) =>
          this.fail(new AssetStudioError("WORKER_ERROR", e.message)),
        );
        worker.on("exit", (code) => {
          if (!this.closed)
            this.fail(
              new AssetStudioError(
                "WORKER_EXIT",
                `Texture worker exited with code ${code}`,
              ),
            );
        });
      } catch (e) {
        this.fail(e as Error);
      }
    }
  }
  private fail(error: Error) {
    void this.close(error);
  }
  async close(
    error: Error = new AssetStudioError("CLOSED", "Texture pool closed"),
  ) {
    if (!this.closed) {
      this.closed = true;
      for (const task of this.queue.splice(0)) task.reject(error);
      for (const slot of this.slots) {
        slot.task?.reject(error);
        slot.task = undefined;
        void slot.worker.terminate();
      }
    }
    await Promise.all(this.slots.map((slot) => slot.exited));
  }
}
