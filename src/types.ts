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
    | "live2d"
    | "splitObjects"
    | "animator";

export type AssetType = typeof AssetTypes[number];

export interface ExportAssetsDefaultConfig {
    mode?: ExportMode;
    /** @deprecated The CLI backend has been removed. Use bridgePath for a custom bridge DLL. */
    cliPath?: string;
    /** Path to the .NET host. Defaults to bin/dotnet/dotnet, DOTNET_ROOT/dotnet, or PATH. */
    dotnetPath?: string;
    /** Path to AssetStudioBridge.dll. */
    bridgePath?: string;
    /** Default operation timeout, including startup; 0 disables it. Default: 120000. */
    timeoutMs?: number;
    log?: boolean;
    assetType?: AssetType | AssetType[];
    group?: "none" | "type" | "container" | "containerFull" | "fileName" | "sceneHierarchy";
    filenameFormat?: "assetName" | "assetName_pathID" | "pathID";
    overwrite?: boolean;
    logLevel?: "verbose" | "debug" | "info" | "warning" | "error";
    logOutput?: "console" | "file" | "both";
    imageFormat?: "none" | "jpg" | "png" | "bmp" | "tga" | "webp";
    /** 0–9 for Texture2D/Texture2DArray/Sprite PNG exports. Lower is faster/larger; omitted keeps upstream settings. */
    pngCompressionLevel?: number;
    audioFormat?: "none" | "wav";
    l2dGroupOption?: "container" | "fileName" | "modelName";
    l2dMotionMode?: "monoBehaviour" | "animationClip";
    l2dSearchByFilename?: boolean;
    l2dForceBezier?: boolean;
    fbxScaleFactor?: number;
    fbxBoneSize?: number;
    fbxAnimation?: "auto" | "skip" | "all";
    fbxUVsAsDiffuse?: boolean;
    filterByName?: string;
    filterByContainer?: string;
    filterByPathID?: string;
    filterByText?: string;
    filterWithRegex?: boolean;
    blockinfoComp?: "auto" | "zstd" | "oodle" | "lz4" | "lzma";
    blockComp?: "auto" | "zstd" | "oodle" | "lz4" | "lzma";
    maxExportTasks?: number;
    exportAssetList?: "none" | "xml";
    assemblyFolder?: string;
    unityVersion?: string;
    decompressToDisk?: boolean;
    notRestoreExtension?: boolean;
    ignoreTypetree?: boolean;
    loadAll?: boolean;
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
    /** null for Live2D, whose output consists of multiple files per model. */
    exportedCount: number | null;
    output: string | null;
    assets: AssetInfo[];
}

export type AssetEvent =
    | { type: "log"; id: string; level: "verbose" | "debug" | "info" | "warning" | "error"; message: string }
    | { type: "progress"; id: string; phase: "load" | "parse" | "export" | "extract"; percent: number; completed?: number; total?: number };

export interface OperationOptions extends ExportAssetsDefaultConfig {
    signal?: AbortSignal;
    onEvent?: (event: AssetEvent) => void;
}

export class AssetStudioError extends Error {
    constructor(public readonly code: string, message: string, public readonly details: string[] = []) {
        super(message);
        this.name = code === "ABORTED" ? "AbortError" : "AssetStudioError";
    }
}
