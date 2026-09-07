import fs from "node:fs";
import path from "node:path";
import { WorkerTransport } from "./transport.js";
import {
  AssetStudioError,
  type AssetInput,
  type AssetResult,
  type AssetReadResult,
  type OperationOptions,
} from "./types.js";
export * from "./types.js";

export const engineCapabilities = Object.freeze({
  engine: "unityfs-js",
  version: "0.2.8",
  runtime: "node+wasm",
  modes: [
    "info",
    "export",
    "exportRaw",
    "dump",
    "extract",
    "live2d",
    "animator",
    "splitObjects",
  ] as const,
  imageFormats: ["png", "none"] as const,
  unsupported: [
    "Humanoid muscle animation retargeting",
    "Legacy property animation other than blend shapes and Renderer.enabled",
    "Additional platform audio codecs (GCADPCM, VAG/HEVAG, XMA, AAC, ATRAC9, CELT, Opus)",
  ] as const,
});

export class AssetExporter {
  private readonly transport: WorkerTransport;
  private readonly defaultConfig: OperationOptions;
  constructor(config: OperationOptions = {}) {
    for (const key of ["cliPath", "dotnetPath", "bridgePath"])
      if (key in config)
        throw new AssetStudioError(
          "UNSUPPORTED_OPTION",
          `${key} was removed; this library now runs entirely in Node.js/WASM`,
        );
    this.defaultConfig = {
      mode: "export",
      log: true,
      group: "container",
      assetType: "all",
      ...config,
    };
    this.transport = new WorkerTransport(config);
  }
  get workerThreadId(): number | undefined {
    return this.transport.threadId;
  }
  inspect(
    input: AssetInput,
    options: OperationOptions = {},
  ): Promise<AssetResult> {
    return this.run("inspect", input, undefined, options);
  }
  exportAssets(
    input: AssetInput,
    output: string,
    options: OperationOptions = {},
  ): Promise<AssetResult> {
    return this.run("export", input, output, options);
  }
  /** Returns exported bytes without creating input or output files. */
  readAssets(
    input: AssetInput,
    options: OperationOptions = {},
  ): Promise<AssetReadResult> {
    return this.run(
      "read",
      input,
      undefined,
      options,
    ) as Promise<AssetReadResult>;
  }
  private async run(
    method: "inspect" | "export" | "read",
    input: AssetInput,
    output: string | undefined,
    options: OperationOptions,
  ): Promise<AssetResult> {
    if (typeof input === "string") {
      if (!input)
        throw new AssetStudioError("INVALID_INPUT", "Missing input path");
      if (!fs.existsSync(input))
        throw new AssetStudioError(
          "INPUT_NOT_FOUND",
          `Input does not exist: ${input}`,
        );
      input = path.resolve(input);
    } else if (
      !(input instanceof Uint8Array) &&
      !(input instanceof ArrayBuffer)
    )
      throw new AssetStudioError(
        "INVALID_INPUT",
        "Input must be a local path, Buffer, Uint8Array or ArrayBuffer",
      );
    if (method === "export" && !output)
      throw new AssetStudioError("INVALID_INPUT", "Missing output path");
    if (options.workerPath)
      throw new AssetStudioError(
        "INVALID_CONFIG",
        "Set workerPath in the constructor",
      );
    const { log, onEvent, signal, timeoutMs, workerPath, ...config } = {
      ...this.defaultConfig,
      ...options,
    };
    return this.transport.request(
      method,
      input,
      output ? path.resolve(output) : undefined,
      config,
      {
        signal,
        timeoutMs,
        onEvent(event) {
          if (onEvent) onEvent(event);
          else if (log && event.type === "log")
            process.stderr.write(`[${event.level}] ${event.message}\n`);
        },
      },
    );
  }
  close(): Promise<void> {
    return this.transport.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
export const createExporter = (config?: OperationOptions) =>
  new AssetExporter(config);
export async function exportAssets(
  input: AssetInput,
  output: string,
  config?: OperationOptions,
): Promise<AssetResult> {
  const exporter = new AssetExporter(config);
  try {
    return await exporter.exportAssets(input, output);
  } finally {
    await exporter.close();
  }
}
export async function inspectAssets(
  input: AssetInput,
  config?: OperationOptions,
): Promise<AssetResult> {
  const exporter = new AssetExporter(config);
  try {
    return await exporter.inspect(input);
  } finally {
    await exporter.close();
  }
}
export async function readAssets(
  input: AssetInput,
  config?: OperationOptions,
): Promise<AssetReadResult> {
  const exporter = new AssetExporter(config);
  try {
    return await exporter.readAssets(input);
  } finally {
    await exporter.close();
  }
}
