export const AssetTypes = [
  "all",
  "tex2d",
  "tex2dArray",
  "sprite",
  "textasset",
  "monobehaviour",
  "font",
  "shader",
  "movietexture",
  "audio",
  "video",
  "mesh",
  "animator",
] as const;

export type ExportMode =
  | "extract"
  | "export"
  | "exportRaw"
  | "dump"
  | "info"
  | "live2d";

export type AssetType = (typeof AssetTypes)[number];

export interface ExportAssetsDefaultConfig {
  mode?: ExportMode;
  /** Custom Node.js worker module; normally omitted. */
  workerPath?: string;
  /** Default request timeout including startup; 0 disables it. */
  timeoutMs?: number;
  /** Input and companion resource budget; default 512 MiB. */
  maxInputBytes?: number;
  /** Exported byte budget; default 512 MiB for readAssets, 16 GiB for disk export. */
  maxOutputBytes?: number;
  /** Maximum pixels per Texture2D; default 64 million. */
  maxTexturePixels?: number;
  /** Texture2D PNG codec workers, 1–64; 1 uses the serial engine. Default 4. */
  maxExportTasks?: number;
  /** Companion .resS/.resource bytes, useful with in-memory input. */
  resourceFiles?: Record<string, Uint8Array>;
  log?: boolean;
  assetType?: AssetType | AssetType[];
  group?: "none" | "type" | "container" | "containerFull" | "fileName";
  filenameFormat?: "assetName" | "assetName_pathID" | "pathID";
  overwrite?: boolean;
  logLevel?: "verbose" | "debug" | "info" | "warning" | "error";
  logOutput?: "console";
  imageFormat?: "none" | "png";
  audioFormat?: "none" | "wav";
  filterByName?: string;
  filterByContainer?: string;
  filterByPathID?: string;
  filterByText?: string;
  filterWithRegex?: boolean;
  unityVersion?: string;
  notRestoreExtension?: boolean;
}

export interface AssetInfo {
  name: string;
  type: string;
  /** Int64 encoded as a string to avoid JavaScript precision loss. */
  pathId: string;
  container: string;
  size: number;
  source: string;
}

export interface AssetResult {
  loadedFiles: number;
  assetCount: number;
  exportedCount: number;
  output: string | null;
  assets: AssetInfo[];
}

export type AssetEvent =
  | {
      type: "log";
      id: string;
      level: "verbose" | "debug" | "info" | "warning" | "error";
      message: string;
    }
  | {
      type: "progress";
      id: string;
      phase: "load" | "parse" | "export" | "extract";
      percent: number;
      completed?: number;
      total?: number;
    };

export interface OperationOptions extends ExportAssetsDefaultConfig {
  signal?: AbortSignal;
  onEvent?: (event: AssetEvent) => void;
}

export class AssetStudioError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = code === "ABORTED" ? "AbortError" : "AssetStudioError";
  }
}

/** Buffers are copied to the worker; caller-owned memory is never detached. */
export type AssetInput = string | Uint8Array | ArrayBuffer;
export interface AssetFileData {
  path: string;
  data: Uint8Array;
}
export interface AssetReadResult extends AssetResult {
  files: AssetFileData[];
}
