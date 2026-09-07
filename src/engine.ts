import { addAnimation } from "./animation.js";
import { buildModel, ObjectResolver } from "./model.js";
import { convertModel } from "./fbx.js";
import { registerExtraTextureFormats } from "./texture-formats.js";
registerExtraTextureFormats();
import {
  Texture2DArray,
  MovieTexture,
  LegacyAnimation,
} from "./asset-parsers.js";
import { textureArrayLayers } from "./texture-array.js";
import { convertTexture } from "./texture-engine.js";
import { registerClass } from "unityfs-js";
registerClass(187, "Texture2DArray", Texture2DArray);
registerClass(152, "MovieTexture", MovieTexture);
registerClass(111, "Animation", LegacyAnimation);

import { convertShader } from "./shader.js";
import type { TextureJob } from "./texture-engine.js";
import { load, type AssetManager, type ObjectInfo } from "unityfs-js";
import { processLive2DModel } from "unityfs-js/exporters/live2dExporter.js";
import fs from "node:fs";
import path from "node:path";
import {
  AssetStudioError,
  AssetTypes,
  type AssetInfo,
  type AssetResult,
  type AssetEvent,
  type AssetInput,
  type ExportAssetsDefaultConfig,
} from "./types.js";

// Internal export for bundled-codec regression tests; not part of the package API.
export { decodeAstcRgba } from "./texture-codecs.js";

type Config = ExportAssetsDefaultConfig;
export interface EngineRequest {
  id: string;
  method: "inspect" | "export" | "read";
  input: AssetInput;
  output?: string;
  config: Config;
}
const classes: Record<string, string> = {
  tex2d: "Texture2D",
  tex2dArray: "Texture2DArray",
  sprite: "Sprite",
  textasset: "TextAsset",
  monobehaviour: "MonoBehaviour",
  font: "Font",
  shader: "Shader",
  movietexture: "MovieTexture",
  audio: "AudioClip",
  video: "VideoClip",
  mesh: "Mesh",
  animator: "Animator",
};
const exportClasses = new Set([
  "Shader",
  "Texture2DArray",
  "MovieTexture",
  "Animator",
  "Texture2D",
  "Sprite",
  "TextAsset",
  "MonoBehaviour",
  "Font",
  "AudioClip",
  "Mesh",
  "VideoClip",
]);
const options = new Set([
  "mode",
  "assetType",
  "group",
  "filenameFormat",
  "overwrite",
  "imageFormat",
  "audioFormat",
  "unityVersion",
  "filterByName",
  "filterByContainer",
  "filterByPathID",
  "filterByText",
  "filterWithRegex",
  "logLevel",
  "logOutput",
  "notRestoreExtension",
  "maxInputBytes",
  "maxOutputBytes",
  "maxTexturePixels",
  "maxExportTasks",
  "resourceFiles",
  "fbxAnimation",
  "fbxScaleFactor",
]);
function fail(code: string, message: string): never {
  throw new AssetStudioError(code, message);
}
function validate(c: Config) {
  for (const k of Object.keys(c))
    if (!options.has(k))
      fail(
        "UNSUPPORTED_OPTION",
        `Option ${k} is not supported by the JavaScript engine`,
      );
  const oneOf = (key: string, value: unknown, values: unknown[]) => {
    if (value !== undefined && !values.includes(value))
      fail("INVALID_CONFIG", `Unsupported ${key}: ${String(value)}`);
  };
  oneOf("mode", c.mode, [
    "info",
    "export",
    "exportRaw",
    "dump",
    "extract",
    "live2d",
    "animator",
    "splitObjects",
  ]);
  oneOf("group", c.group, [
    "none",
    "type",
    "container",
    "containerFull",
    "fileName",
  ]);
  oneOf("filenameFormat", c.filenameFormat, [
    "assetName",
    "assetName_pathID",
    "pathID",
  ]);
  oneOf("imageFormat", c.imageFormat, ["png", "none"]);
  oneOf("audioFormat", c.audioFormat, ["none", "wav"]);
  oneOf("fbxAnimation", c.fbxAnimation, ["auto", "skip", "all"]);
  if (
    c.fbxScaleFactor !== undefined &&
    (typeof c.fbxScaleFactor !== "number" ||
      !Number.isFinite(c.fbxScaleFactor) ||
      c.fbxScaleFactor <= 0)
  )
    fail("INVALID_CONFIG", "fbxScaleFactor must be positive");
  oneOf("logLevel", c.logLevel, [
    "verbose",
    "debug",
    "info",
    "warning",
    "error",
  ]);
  oneOf("logOutput", c.logOutput, ["console"]);
  for (const key of ["overwrite", "filterWithRegex", "notRestoreExtension"])
    if (c[key] !== undefined && typeof c[key] !== "boolean")
      fail("INVALID_CONFIG", `${key} must be boolean`);
  for (const key of [
    "filterByName",
    "filterByContainer",
    "filterByPathID",
    "filterByText",
  ])
    if (c[key] !== undefined && typeof c[key] !== "string")
      fail("INVALID_CONFIG", `${key} must be a string`);
  if (
    c.unityVersion !== undefined &&
    (typeof c.unityVersion !== "string" ||
      !/^\d+\.\d+\.\d+[abfp]\d+(?:\w*)$/.test(c.unityVersion))
  )
    fail(
      "INVALID_CONFIG",
      "unityVersion must be a full version such as 2022.3.62f1",
    );
  if (
    c.maxExportTasks !== undefined &&
    (!Number.isInteger(c.maxExportTasks) ||
      c.maxExportTasks < 1 ||
      c.maxExportTasks > 64)
  )
    fail(
      "INVALID_CONFIG",
      "maxExportTasks must be an integer between 1 and 64",
    );
  const types = Array.isArray(c.assetType)
    ? c.assetType
    : [c.assetType ?? "all"];
  if (
    !types.length ||
    types.some((t) => !AssetTypes.includes(t)) ||
    (types.includes("all") && types.length > 1)
  )
    fail("INVALID_CONFIG", "Invalid assetType selection");
  for (const key of ["maxInputBytes", "maxOutputBytes", "maxTexturePixels"])
    if (c[key] !== undefined && (!Number.isSafeInteger(c[key]) || c[key] <= 0))
      fail("INVALID_CONFIG", `${key} must be a positive safe integer`);
  if (
    c.resourceFiles !== undefined &&
    (c.resourceFiles === null ||
      typeof c.resourceFiles !== "object" ||
      Object.values(c.resourceFiles).some((v) => !(v instanceof Uint8Array)))
  )
    fail(
      "INVALID_CONFIG",
      "resourceFiles must map filenames to Uint8Array values",
    );
}
function json(value: unknown): Buffer {
  return Buffer.from(
    JSON.stringify(
      value,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
}
function bytes(value: unknown): Buffer {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array)
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  fail("ASSET_PROCESSING_ERROR", "Exporter did not return binary data");
}
function relative(value: string): string {
  if (!value || path.isAbsolute(value) || /^[a-zA-Z]:/.test(value))
    fail("UNSAFE_PATH", `Invalid asset output path: ${value}`);
  const parts = value.replaceAll("\\", "/").split("/");
  if (parts.some((p) => p === ".." || p === "." || !p || p.includes("\0")))
    fail("UNSAFE_PATH", `Unsafe asset output path: ${value}`);
  return parts.join("/");
}
function name(value: string): string {
  const result = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "");
  return result && result !== "." && result !== ".." ? result : "unnamed";
}
function safeWrite(
  root: string,
  relativePath: string,
  data: Buffer,
  overwrite: boolean,
) {
  // Resolve the caller-selected root (macOS /var and /tmp are symlinks), then
  // reject symlink components introduced by asset-controlled relative paths.
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const target = path.join(root, relative(relativePath));
  const parts = path
    .relative(root, path.dirname(target))
    .split(path.sep)
    .filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink())
        fail("UNSAFE_PATH", `Symlink output directory: ${current}`);
    } else fs.mkdirSync(current);
  }
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    (overwrite ? fs.constants.O_TRUNC : fs.constants.O_EXCL) |
    (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(target, flags);
  try {
    fs.writeFileSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
}
function match(info: AssetInfo, c: Config): boolean {
  const test = (value: string, filter: string) =>
    c.filterWithRegex
      ? new RegExp(filter, "i").test(value)
      : filter
          .split(/[,;]/)
          .some((f) => value.toLowerCase().includes(f.toLowerCase()));
  if (c.filterByText)
    return (
      test(info.name, c.filterByText) || test(info.container, c.filterByText)
    );
  if (c.filterByPathID)
    return c.filterByPathID.split(/[,;]/).some((f) => info.pathId.includes(f));
  return (
    (!c.filterByName || test(info.name, c.filterByName)) &&
    (!c.filterByContainer || test(info.container, c.filterByContainer))
  );
}
function outputName(info: AssetInfo, ext: string, c: Config) {
  const file =
    c.filenameFormat === "pathID"
      ? info.pathId
      : c.filenameFormat === "assetName_pathID"
        ? `${info.name} @${info.pathId}`
        : info.name;
  let dir = "";
  if (c.group === "type") dir = info.type;
  else if (c.group === "fileName") dir = name(info.source) + "_export";
  else if (c.group !== "none" && info.container) {
    dir = path.posix.dirname(info.container);
    if (dir === ".") dir = "";
    if (c.group === "containerFull")
      dir = path.posix.join(dir, path.posix.parse(info.container).name);
  }
  return relative((dir ? dir + "/" : "") + name(file) + ext);
}

export async function execute(
  request: EngineRequest,
  emit: (event: AssetEvent) => void,
  encodeTexture?: (job: TextureJob) => Promise<Uint8Array>,
): Promise<AssetResult> {
  const { id, config: c } = request;
  validate(c);
  const mode = request.method === "inspect" ? "info" : (c.mode ?? "export");
  const maxInput = c.maxInputBytes ?? 512 * 1024 * 1024,
    maxOutput =
      c.maxOutputBytes ??
      (request.method === "read" ? 512 * 1024 * 1024 : 16 * 1024 * 1024 * 1024),
    maxPixels = c.maxTexturePixels ?? 64 * 1024 * 1024;
  let inputBytes = 0,
    outputBytes = 0,
    exportedCount = 0,
    extractedSerializedFiles = 0;
  const managers: AssetManager[] = [],
    sources = new Map<ObjectInfo, string>(),
    assets: AssetInfo[] = [],
    files: { path: string; data: Uint8Array }[] = [],
    written = new Set<string>();
  const progress = (
    phase: "load" | "parse" | "export" | "extract",
    completed: number,
    total: number,
  ) =>
    emit({
      type: "progress",
      id,
      phase,
      completed,
      total,
      percent: total ? Math.floor((completed * 100) / total) : 100,
    });
  const charge = (n: number) => {
    inputBytes += n;
    if (inputBytes > maxInput)
      fail(
        "LIMIT_EXCEEDED",
        "Input and companion resources exceed maxInputBytes",
      );
  };
  const read = (p: string) => {
    const stat = fs.statSync(p);
    if (!stat.isFile()) fail("INVALID_INPUT", `Not a file: ${p}`);
    charge(stat.size);
    return fs.readFileSync(p);
  };
  const emitFile = (p: string, value: unknown) => {
    const data = bytes(value);
    p = relative(p);
    outputBytes += data.length;
    if (outputBytes > maxOutput)
      fail("LIMIT_EXCEEDED", "Output exceeds maxOutputBytes");
    if (written.has(p))
      fail(
        "ASSET_PROCESSING_ERROR",
        `Duplicate output name ${p}; use filenameFormat: assetName_pathID`,
      );
    written.add(p);
    if (request.method === "read")
      files.push({ path: p, data: Uint8Array.from(data) });
    else safeWrite(request.output!, p, data, c.overwrite ?? false);
  };
  const emitAssetFile = (info: AssetInfo, extension: string, data: unknown) => {
    let target = outputName(info, extension, c);
    // Preserve all same-name objects in default exports, as the original exporter does.
    // Explicit PathID naming and archive entry collisions still fail rather than overwrite.
    if (
      written.has(target) &&
      (!c.filenameFormat || c.filenameFormat === "assetName")
    )
      target = outputName(info, extension, {
        ...c,
        filenameFormat: "assetName_pathID",
      });
    emitFile(target, data);
  };
  const pendingTextures = new Map<
    number,
    Promise<{ data?: Uint8Array; error?: unknown }>
  >();
  try {
    const inputs: { name: string; data?: Uint8Array; file?: string }[] = [];
    if (typeof request.input === "string") {
      const walk = (p: string) => {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink())
          fail("INVALID_INPUT", `Symlink input is not supported: ${p}`);
        if (st.isDirectory()) {
          for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f));
        } else if (st.isFile() && !/\.(resS|resource)$/i.test(p)) {
          inputs.push({ name: path.basename(p), file: p });
          if (inputs.length > 10000)
            fail("LIMIT_EXCEEDED", "Input contains too many files");
        }
      };
      walk(request.input);
    } else
      inputs.push({
        name: "memory.bundle",
        data:
          request.input instanceof ArrayBuffer
            ? new Uint8Array(request.input)
            : request.input,
      });
    progress("load", 0, inputs.length);
    for (let i = 0; i < inputs.length; i++) {
      const item = inputs[i],
        data = item.file ? read(item.file) : item.data!;
      if (!item.file) charge(data.byteLength);
      // load() upstream ignores byteOffset on Uint8Array; supply an exact ArrayBuffer.
      const m = await load(
        data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer,
        {
          unityRevision: c.unityVersion,
          nodeExtractOnly: mode === "extract",
        } as any,
      );
      if (mode === "extract" && m) {
        // Extraction only needs archive nodes: avoid parsing objects and retain
        // at most one bundle, even when the caller passes an entire directory.
        try {
          const nodes = m.bundleFile?.files;
          if (!nodes?.length)
            fail("UNSUPPORTED_OPERATION", "extract requires a Unity bundle");
          for (const n of nodes) {
            emitFile(n.node.path, n.data);
            exportedCount++;
            if (n.node.flags & 4) extractedSerializedFiles++;
          }
        } finally {
          m.dispose();
        }
        progress("extract", i + 1, inputs.length);
        continue;
      }
      if (!m || !m.assetFiles?.length) {
        m?.dispose();
        fail(
          "ASSET_PROCESSING_ERROR",
          `No Unity serialized files could be loaded from ${item.name}`,
        );
      }
      managers.push(m);
      for (const [key, value] of Object.entries(c.resourceFiles ?? {})) {
        charge(value.byteLength);
        m.registerResourceFile(key, value);
      }
      // Discover only same-directory companion resources; resource paths never trigger network requests.
      if (item.file)
        for (const filename of fs
          .readdirSync(path.dirname(item.file))
          .filter((f) => /\.(resS|resource)$/i.test(f)))
          m.registerResourceFile(
            filename,
            read(path.join(path.dirname(item.file), filename)),
          );
      for (const o of m.getObjectInfos())
        sources.set(
          o,
          m.bundleFile?.files?.find((f) => f.assetFile === o.assetFile)?.node
            ?.path ?? item.name,
        );
      progress("load", i + 1, inputs.length);
    }
    if (!inputs.length)
      fail(
        "ASSET_PROCESSING_ERROR",
        "No Unity serialized files could be loaded",
      );
    if (mode !== "extract") {
      const resolver = new ObjectResolver(
        managers.flatMap((m: any) =>
          m.assetFiles.map((file: any) => ({
            file,
            manager: m,
            name: sources.get(file.objects[0]) ?? "",
          })),
        ),
      );
      const requested = Array.isArray(c.assetType)
        ? c.assetType
        : [c.assetType ?? "all"];
      const selectedClasses =
        mode === "animator"
          ? ["Animator"]
          : mode === "splitObjects"
            ? ["GameObject"]
            : requested.includes("all")
              ? Object.values(classes)
              : requested.map((t) => classes[t]);
      const selected: {
        manager: AssetManager;
        object: ObjectInfo;
        info: AssetInfo;
      }[] = [];
      for (const m of managers)
        for (const o of m.getObjectInfos())
          if (selectedClasses.includes(o.className)) {
            if (mode === "splitObjects") {
              const t = resolver
                .components(o)
                .find(
                  (x: any) =>
                    x.className === "Transform" ||
                    x.className === "RectTransform",
                );
              if (!t || BigInt(t.object.father?.pathID ?? 0) !== 0n) continue;
            }
            const object = o.object; // Patched upstream getter throws instead of replacing failed objects with {}.
            const container = m.getContainer(o) as any;
            // Match AssetStudio's names without invoking upstream's browser-only PPtr resolver.
            let assetName = o.name;
            if (o.className === "Shader")
              assetName = object.parsedForm?.name || object.name || assetName;
            else if (
              o.className === "MonoBehaviour" &&
              !object.name &&
              object.script?.fileID === 0
            ) {
              const script = o.assetFile?.getObjectByPathID(
                object.script.pathID,
              );
              if (script?.className === "MonoScript")
                assetName = script.object.className || assetName;
            }
            if (o.className === "Animator")
              assetName = resolver.gameObject(o)?.object.name || assetName;
            const streamSize = Number(object?.streamData?.size ?? 0);
            const info: AssetInfo = {
              name: assetName,
              type: o.className,
              pathId: o.pathID.toString(),
              container: container?.key ?? "",
              size: o.size + streamSize,
              source: sources.get(o)!,
            };
            if (match(info, c)) {
              assets.push(info);
              selected.push({ manager: m, object: o, info });
            }
          }
      const concurrency = c.maxExportTasks ?? 4;
      const textureIndices =
        mode === "export" &&
        c.imageFormat !== "none" &&
        concurrency > 1 &&
        encodeTexture
          ? selected.flatMap((s, i) => (s.info.type === "Texture2D" ? [i] : []))
          : [];
      let nextTexture = 0;
      const scheduleTexture = () => {
        const index = textureIndices[nextTexture++];
        if (index === undefined) return;
        // Capture errors as values immediately; later failures cannot reject unobserved.
        const task = (async () => {
          const { manager: m, object: o, info } = selected[index],
            obj = o.object;
          if (
            !Number.isSafeInteger(obj.width) ||
            !Number.isSafeInteger(obj.height) ||
            obj.width <= 0 ||
            obj.height <= 0 ||
            obj.width * obj.height > maxPixels
          )
            fail(
              "LIMIT_EXCEEDED",
              `Invalid or excessive texture dimensions: ${info.name}`,
            );
          const data = obj.data?.length
            ? obj.data
            : obj.streamData
              ? m.resolveResource(
                  obj.streamData.path,
                  obj.streamData.offset,
                  obj.streamData.size,
                )
              : null;
          if (!data)
            fail(
              "ASSET_PROCESSING_ERROR",
              `Missing texture data: ${info.name}`,
            );
          return {
            data: await encodeTexture!({
              data: Uint8Array.from(data),
              width: obj.width,
              height: obj.height,
              format: obj.textureFormat,
              version: obj._version,
            }),
          };
        })().catch((error) => ({ error }));
        pendingTextures.set(index, task);
      };
      for (let n = 0; n < Math.min(concurrency, textureIndices.length); n++)
        scheduleTexture();
      progress("parse", selected.length, selected.length);
      if (mode !== "info")
        for (let i = 0; i < selected.length; i++) {
          const { manager: m, object: o, info } = selected[i];
          if (pendingTextures.has(i)) {
            const result = await pendingTextures.get(i)!;
            pendingTextures.delete(i);
            if (result.error) throw result.error;
            emitAssetFile(info, ".png", result.data);
            exportedCount++;
            progress("export", i + 1, selected.length);
            scheduleTexture();
            continue;
          }
          if (mode === "live2d") {
            if (o.className !== "MonoBehaviour") continue;
            const script = o.object.script;
            if (
              !script ||
              m.getObjectInfoByPathId(BigInt(script.pathID))?.object
                ?.className !== "CubismModel"
            )
              continue;
            const model = await processLive2DModel(o, m);
            for (const [p, data] of Object.entries(model.files))
              emitFile(relative(name(model.name) + "/" + p), data);
          } else if (mode === "exportRaw")
            emitAssetFile(info, ".bin", o.serialize());
          else if (mode === "dump") {
            const tree = o.assetFile!.getObjectUsingTreeJSON(o);
            if (tree === null || tree === undefined)
              fail("UNSUPPORTED_OPERATION", `No TypeTree for ${info.name}`);
            emitAssetFile(info, ".json", json(tree));
          } else {
            if (!exportClasses.has(info.type) && mode !== "splitObjects")
              fail(
                "UNSUPPORTED_OPERATION",
                `Conversion of ${info.type} is not supported; use exportRaw or dump`,
              );
            const obj = o.object;
            if (info.type === "Animator" || mode === "splitObjects") {
              const model = await buildModel(
                o,
                resolver,
                maxPixels,
                c.fbxAnimation !== "skip",
              );
              if (
                mode === "splitObjects" &&
                !model.builder.document.meshes.length
              )
                continue;
              const clips = new Set<any>();
              const collect = (
                controller: any,
                seen = new Set<any>(),
                overrides = new Map<any, any>(),
              ) => {
                if (!controller) return;
                if (seen.has(controller))
                  throw Error("Animator controller cycle");
                seen.add(controller);
                const value = controller.object;
                if (controller.className === "AnimatorOverrideController") {
                  for (const pair of value.clips) {
                    const original = resolver.resolve(
                        controller,
                        pair.originalClip,
                      ),
                      replacement = resolver.resolve(
                        controller,
                        pair.overrideClip,
                      );
                    if (original && replacement && !overrides.has(original))
                      overrides.set(original, replacement);
                  }
                  collect(
                    resolver.resolve(controller, value.controller),
                    seen,
                    overrides,
                  );
                } else
                  for (const p of value.animationClips ?? []) {
                    const clip = resolver.resolve(controller, p);
                    if (clip) clips.add(overrides.get(clip) ?? clip);
                  }
                seen.delete(controller);
              };
              if (c.fbxAnimation === "all") {
                for (const manager of managers)
                  for (const info of manager.getObjectInfos())
                    if (info.className === "AnimationClip") clips.add(info);
              } else if (
                c.fbxAnimation !== "skip" &&
                o.className === "Animator"
              )
                collect(resolver.resolve(o, o.object.controller));
              let animatedChannels = 0;
              for (const clip of clips) {
                const count = addAnimation(
                  model.builder,
                  model.paths,
                  clip.object,
                );
                animatedChannels += count;
                if (!count)
                  emit({
                    type: "log",
                    id,
                    level: "warning",
                    message:
                      "No animation bindings matched " +
                      clip.object.name +
                      " in " +
                      info.name,
                  });
              }
              if (c.fbxAnimation !== "all" && c.fbxAnimation !== "skip")
                for (const bound of model.builder.legacyAnimations) {
                  const paths = new Map(
                    [...model.paths]
                      .filter(
                        ([p]) =>
                          p === bound.rootPath ||
                          p.startsWith(bound.rootPath + "/") ||
                          bound.rootPath === "",
                      )
                      .map(
                        ([p, n]) =>
                          [
                            bound.rootPath === ""
                              ? p
                              : p === bound.rootPath
                                ? ""
                                : p.slice(bound.rootPath.length + 1),
                            n,
                          ] as [string, number],
                      ),
                  );
                  animatedChannels += addAnimation(
                    model.builder,
                    paths,
                    bound.clip.object,
                  );
                }
              for (const message of model.builder.animationWarnings)
                emit({ type: "log", id, level: "warning", message });
              if (
                (clips.size ||
                  (c.fbxAnimation !== "skip" &&
                    model.builder.legacyAnimations.length)) &&
                !animatedChannels
              )
                fail(
                  "UNSUPPORTED_OPERATION",
                  "No animation bindings matched this model; provide the matching model or explicitly choose fbxAnimation: skip",
                );
              if (c.fbxScaleFactor !== undefined) {
                const nodes = model.builder.document.nodes,
                  root = nodes.length;
                nodes.push({
                  name: "Scale",
                  scale: [c.fbxScaleFactor, c.fbxScaleFactor, c.fbxScaleFactor],
                  children:
                    nodes[model.builder.document.scenes[0].nodes[0]].children,
                });
                nodes[model.builder.document.scenes[0].nodes[0]].children = [
                  root,
                ];
              }
              const converted = await convertModel(
                model.builder.finish(),
                name(info.name) + ".glb",
              );
              for (const file of converted) {
                if (file.path.endsWith(".fbx"))
                  emitAssetFile(info, ".fbx", file.data);
                else
                  emitFile(
                    relative(name(info.name) + "/" + file.path),
                    file.data,
                  );
              }
              exportedCount++;
              progress("export", i + 1, selected.length);
              continue;
            }
            if (info.type === "Texture2DArray") {
              const layers = textureArrayLayers(
                obj,
                (p, o, s) => m.resolveResource(p, o, s),
                maxPixels,
              );
              const count = c.imageFormat === "none" ? 1 : concurrency;
              for (let start = 0; start < layers.length; start += count) {
                const batch = await Promise.all(
                  layers.slice(start, start + count).map((layer) =>
                    c.imageFormat === "none"
                      ? layer.data
                      : encodeTexture && count > 1
                        ? encodeTexture({
                            ...layer,
                            data: Uint8Array.from(layer.data),
                          })
                        : convertTexture(layer),
                  ),
                );
                for (let j = 0; j < batch.length; j++) {
                  const layer = start + j + 1;
                  emitAssetFile(
                    {
                      ...info,
                      name: info.name + "_" + layer,
                      pathId:
                        c.filenameFormat === "pathID"
                          ? info.pathId + "_" + layer
                          : info.pathId,
                    },
                    c.imageFormat === "none" ? ".tex" : ".png",
                    batch[j],
                  );
                  exportedCount++;
                }
              }
              progress("export", i + 1, selected.length);
              continue;
            }
            if (info.type === "Texture2D") {
              if (
                !Number.isSafeInteger(obj.width) ||
                !Number.isSafeInteger(obj.height) ||
                obj.width <= 0 ||
                obj.height <= 0 ||
                obj.width * obj.height > maxPixels
              )
                fail(
                  "LIMIT_EXCEEDED",
                  `Invalid or excessive texture dimensions: ${info.name}`,
                );
              if (c.imageFormat === "none") {
                const data = obj.data?.length
                  ? obj.data
                  : obj.streamData
                    ? m.resolveResource(
                        obj.streamData.path,
                        obj.streamData.offset,
                        obj.streamData.size,
                      )
                    : null;
                if (!data)
                  fail(
                    "ASSET_PROCESSING_ERROR",
                    `Missing texture data: ${info.name}`,
                  );
                emitAssetFile(info, ".tex", data);
                exportedCount++;
                progress("export", i + 1, selected.length);
                continue;
              }
            }
            let data: unknown, extension: string;
            if (info.type === "MovieTexture") {
              data = obj.movieData;
              extension = ".ogv";
            } else if (info.type === "Shader") {
              data = Buffer.from(await convertShader(obj));
              extension = ".shader";
            } else if (info.type === "TextAsset") {
              data = obj.data;
              extension = c.notRestoreExtension
                ? ".txt"
                : path.posix.extname(info.container) || ".txt";
            } else if (info.type === "Font") {
              data = obj.fontData;
              extension =
                bytes(data).subarray(0, 4).toString() === "OTTO"
                  ? ".otf"
                  : ".ttf";
            } else if (info.type === "VideoClip") {
              const r = obj.externalResources;
              data = m.resolveResource(r.source, r.offset, r.size);
              extension = path.extname(obj.originalPath) || ".mp4";
            } else {
              const result = await m.exportFile(o, {
                type: "arrayBuffer",
                worker: false,
                encoder: "wasm",
              });
              if (!result || result.error)
                fail(
                  "ASSET_PROCESSING_ERROR",
                  result?.error ?? `Could not export ${info.name}`,
                );
              if (result.isFolder) {
                for (const [p, data] of Object.entries(result.files))
                  emitFile(relative(name(result.name) + "/" + p), data);
                exportedCount++;
                continue;
              }
              data = result.data?.raw;
              extension =
                info.type === "Texture2D" || info.type === "Sprite"
                  ? ".png"
                  : info.type === "Mesh"
                    ? ".obj"
                    : info.type === "MonoBehaviour"
                      ? ".json"
                      : "." + (result.fileType ?? "bin");
              if (
                info.type === "AudioClip" &&
                c.audioFormat === "wav" &&
                extension !== ".wav"
              )
                fail(
                  "UNSUPPORTED_OPERATION",
                  `Audio decoder produced ${extension}, not WAV`,
                );
            }
            if (!bytes(data).length)
              fail(
                "ASSET_PROCESSING_ERROR",
                `Empty exported data: ${info.name}`,
              );
            emitAssetFile(info, extension, data);
            // Other objects can decode again if they reference this texture.
            // Keeping every decoded bitmap makes directory exports grow unbounded.
            if (info.type === "Texture2D") obj.cachedRaw = null;
          }
          exportedCount++;
          progress("export", i + 1, selected.length);
        }
    }
    return {
      loadedFiles:
        extractedSerializedFiles +
        managers.reduce((n, m) => n + m.assetFiles.length, 0),
      assetCount: assets.length,
      exportedCount,
      output:
        request.method === "export" && mode !== "info" ? request.output! : null,
      assets,
      ...(request.method === "read" ? { files } : {}),
    };
  } finally {
    await Promise.allSettled(pendingTextures.values());
    for (const m of managers) m.dispose();
  }
}
