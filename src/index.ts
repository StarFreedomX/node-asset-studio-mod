import { spawn } from "child_process";
import path from "path";
import fs from "node:fs";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const cliArgMap: Record<string, string | [string, boolean?]> = {
    overwrite: "-r",
    logLevel: "--log-level",
    logOutput: "--log-output",
    imageFormat: "--image-format",
    audioFormat: "--audio-format",
    l2dGroupOption: "--l2d-group-option",
    l2dMotionMode: "--l2d-motion-mode",
    l2dSearchByFilename: "--l2d-search-by-filename",
    l2dForceBezier: "--l2d-force-bezier",
    fbxScaleFactor: "--fbx-scale-factor",
    fbxBoneSize: "--fbx-bone-size",
    fbxAnimation: "--fbx-animation",
    fbxUVsAsDiffuse: "--fbx-uvs-as-diffuse",
    filterByName: "--filter-by-name",
    filterByContainer: "--filter-by-container",
    filterByPathID: "--filter-by-pathid",
    filterByText: "--filter-by-text",
    filterWithRegex: "--filter-with-regex",
    blockinfoComp: "--blockinfo-comp",
    blockComp: "--block-comp",
    maxExportTasks: "--max-export-tasks",
    exportAssetList: "--export-asset-list",
    assemblyFolder: "--assembly-folder",
    unityVersion: "--unity-version",
    decompressToDisk: "--decompress-to-disk",
    notRestoreExtension: "--not-restore-extension",
    ignoreTypetree: "--ignore-typetree",
    loadAll: "--load-all",
};

export type AssetType = typeof AssetTypes[number];

export interface ExportAssetsDefaultConfig {
    mode?: ExportMode;
    cliPath?: string;
    log?: boolean;
    assetType?: AssetType | AssetType[];
    group?: "none" | "type" | "container" | "containerFull" | "fileName" | "sceneHierarchy";
    filenameFormat?: "assetName" | "assetName_pathID" | "pathID";
    overwrite?: boolean;
    logLevel?: "verbose" | "debug" | "info" | "warning" | "error";
    logOutput?: "console" | "file" | "both";
    imageFormat?: "none" | "jpg" | "png" | "bmp" | "tga" | "webp";
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

export class AssetExporter {
    private defaultConfig: ExportAssetsDefaultConfig;

    constructor(defaultConfig: ExportAssetsDefaultConfig = {}) {
        this.defaultConfig = {
            mode: "export",
            log: true,
            group: "container",
            assetType: "all",
            ...defaultConfig,
        };
    }

    private getDefaultCliPath() {
        const base = path.resolve(__dirname, "../bin");

        // 遍历 bin 下的所有子目录
        const subdirs = fs.readdirSync(base, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => path.join(base, d.name));

        for (const dir of subdirs) {
            const exe = os.platform() === "win32"
                ? path.join(dir, "AssetStudioModCLI.exe")
                : path.join(dir, "AssetStudioModCLI");

            if (fs.existsSync(exe)) return exe;
        }

        return null;
    }


    async exportAssets(input: string, output: string): Promise<void> {
        const cfg = this.defaultConfig;
        const useLog = cfg.log ?? true;

        if (!input) throw new Error("missing input path");
        if (!output) throw new Error("missing output path");
        if (!fs.existsSync(input)) throw new Error(`input not exist: ${input}`);
        if (!fs.existsSync(output)) fs.mkdirSync(output, { recursive: true });

        let cliPath = cfg.cliPath || this.getDefaultCliPath();
        if (!cliPath) throw new Error("Cannot find AssetStudioModCLI，please run `pnpm install` or check the folder /bin");

        let types = "all";
        if (cfg.assetType) {
            types = Array.isArray(cfg.assetType) ? cfg.assetType.join(",") : cfg.assetType;
            types.split(",").forEach((t) => {
                if (!AssetTypes.includes(t as AssetType)) throw new Error(`unsupported type: ${t}`);
            });
        }

        const args: string[] = [
            wrapPath(input),
            "-m", cfg.mode!,
            "-t", types,
            "-g", cfg.group!,
            "-o", wrapPath(output),
        ];

        // 自动生成 args
        for (const [key, cliName] of Object.entries(cliArgMap)) {
            const val = (cfg as any)[key];
            if (val === undefined || val === false) continue;
            if (typeof cliName === "string") {
                // 布尔参数或有值参数
                if (typeof val === "boolean") args.push(cliName);
                else args.push(cliName, val.toString());
            } else {
                // tuple
                args.push(cliName[0], val.toString());
            }
        }

        if (useLog) console.log("exec:", cliPath, args.join(" "));

        await new Promise<void>((resolve, reject) => {
            const proc = spawn(cliPath, args, { shell: true, windowsHide: true });
            if (useLog) {
                proc.stdout.on("data", (d) =>
                    process.stdout.write(d.toString()));
                proc.stderr.on("data", (d) =>
                    process.stderr.write(d.toString()));
            }
            proc.on("error", reject);
            proc.on("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`AssetStudio CLI exit code: ${code}`));
                }
            });
        });

    }
}

function wrapPath(p: string) {
    const resolved = path.resolve(p);
    return `"${resolved}"`;
}

// 默认快捷导出
const defaultExporter = new AssetExporter();
export const exportAssets = defaultExporter.exportAssets.bind(defaultExporter);
export const createExporter = (config?: ExportAssetsDefaultConfig) => new AssetExporter(config);
