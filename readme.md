# node-asset-studio-mod-js

Inspect and export Unity assets in Node.js using [unityfs-js 0.2.8](https://github.com/bainiao404/unityfs-js). The runtime is JavaScript and embedded WebAssembly: no .NET, AssetStudio CLI, subprocess, runtime downloads, npm runtime dependencies, or install scripts. Requires Node.js 22+ and ESM.

[中文文档](./readme_CN.md)

## Memory API

```js
import { readFile } from "node:fs/promises";
import { readAssets } from "node-asset-studio-mod-js";

const result = await readAssets(await readFile("/path/to/res014089"), {
  unityVersion: "2022.3.62f1",
  assetType: "tex2d",
  imageFormat: "png",
  timeoutMs: 30_000,
  log: false,
});
for (const { path, data } of result.files) {
  // Uint8Array: send to a response, upload API, or another decoder directly.
  console.log(path, data.byteLength);
}
```

Input accepts a local path (file or recursive directory), Buffer, Uint8Array including offset views, or ArrayBuffer. Memory input creates no temporary files; `readAssets` creates no output files. Caller memory is copied to the Worker and never detached. Results are fully buffered, not an incremental streaming interface. Download URLs in the caller and pass the bytes; worker network access is disabled.

For standalone serialized assets, pass companions with `resourceFiles: { 'name.resS': bytes }`. Path input discovers same-directory `.resS` / `.resource` files; embedded bundle resources are resolved automatically.

## Reuse and control

```js
import { createExporter } from "node-asset-studio-mod-js";

const exporter = createExporter({ unityVersion: "2022.3.62f1", log: false });
const controller = new AbortController();
try {
  const info = await exporter.inspect("/path/to/bundle");
  console.log(info.assets); // pathId is an exact Int64 string
  await exporter.exportAssets("/path/to/bundle", "./output", {
    assetType: "tex2d",
    group: "none",
    filenameFormat: "assetName_pathID",
    signal: controller.signal,
    timeoutMs: 30_000,
    onEvent(event) {
      console.log(event);
    },
  });
} finally {
  await exporter.close();
}
```

One-shot `inspectAssets`, `exportAssets`, and `readAssets` automatically close their workers. An instance accepts one active request (`BUSY` otherwise); use separate instances for concurrent requests, or `maxExportTasks` for texture parallelism within one request. Node Worker structured messages carry results, errors, logs and progress without shell commands or stdout parsing.

Abort, timeout and close terminate the parser and codec workers and wait for all of them to exit before rejecting. After abort/timeout the next request starts a fresh worker. Closing an instance is permanent and idempotent. Already written files are not rolled back; use `readAssets` and save successful results yourself for transactional workflows. The default timeout is 120 seconds; `0` disables it. `workerThreadId` replaces `workerPid`.

Failures reject with `AssetStudioError.code`, including `ABORTED`, `TIMEOUT`, `LIMIT_EXCEEDED`, `UNSUPPORTED_OPTION`, `UNSUPPORTED_OPERATION`, and `ASSET_PROCESSING_ERROR`. Log text does not decide success. `onEvent` receives structured `log` and `progress` events.

## Engine migration and coverage

This replacement does not provide full AssetStudio feature parity.

| Mode / feature     | Behavior                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `info` / `inspect` | Selected asset metadata with exact string PathIDs                                                                       |
| `export`           | Texture2D/Sprite PNG, TextAsset, Font, Mesh OBJ, MonoBehaviour JSON, VideoClip, some AudioClip conversions              |
| `extract`          | Bundle files including companion resources                                                                              |
| `exportRaw`        | Serialized object bytes only; **does not append external resource streams**. Use `extract` for complete bundle contents |
| `dump`             | JSON from embedded TypeTree; fails explicitly if unavailable                                                            |
| `live2d`           | Engine CubismModel exporter; not validated with a project fixture                                                       |
| Images             | `png`, or Texture2D raw texture bytes as `.tex` with `none`                                                             |
| Audio              | JS PCM/Vorbis/MPEG paths; FMOD fallback unavailable. `wav` does not transcode OGG/MP3                                   |

Validated with `res014089`, Unity `2022.3.62f1`: four Texture2D assets produce PNGs whose decoded RGBA pixels exactly match the former .NET exports. Bundle extraction, companion resource round-trip, raw bytes and TypeTree dumps are also tested. Other asset conversions have no real-fixture coverage here and depend on the upstream engine.

Removed: .NET paths and installer, C# bridge, FBX, Animator/splitObjects, Shader/MovieTexture/Texture2DArray conversion, scene grouping, external assemblies, compression overrides, old Live2D/FBX-specific options, and file logging. Unsupported options fail explicitly instead of being ignored. The TypeScript API describes the current supported configuration.

`assetType` accepts one type or an array; `all` means the resource types listed by this API, not every Unity object. Filters support name/container, PathID, text and regex. Text overrides PathID, which overrides name/container filters. Default grouping is `container`; alternatives are `none`, `type`, `containerFull`, `fileName`. Names can use `assetName`, `assetName_pathID`, or `pathID`. Existing files fail unless `overwrite: true`; duplicate names within a request still fail. Asset path traversal and symlink output subdirectories are rejected.

Default budgets: 512 MiB for input plus companions (`maxInputBytes`), 512 MiB for in-memory output or 16 GiB for disk output (`maxOutputBytes`), and 64 × 1024 × 1024 pixels per Texture2D (`maxTexturePixels`). Set positive integers to adjust. These budgets are not hard limits on overall process/WASM memory.

## Development

```sh
pnpm install
pnpm build
pnpm test
ASSET_STUDIO_TEST_INPUT=/path/to/res014089 pnpm test:integration
ASSET_STUDIO_TEST_INPUT=/path/to/res014089 pnpm test:package
npm pack
```

`src/index.ts` exposes the API; `transport.ts` owns worker lifecycle; `worker.ts` carries structured messages; `engine.ts` parses, filters and exports assets. `scripts/build.js` bundles JS/WASM, waits for compression codec startup, disables browser workers and FMOD fallback, and makes upstream parsing errors propagate. Source builds require Node.js and dev dependencies, with no .NET, Rust or Python toolchain.

The real fixture is not committed. `tests/fixtures/res014089-pixels.json` records golden RGBA hashes from the former engine; tests compare pixels rather than PNG encoding bytes. See [third-party notices](./THIRD_PARTY_NOTICES.md).

ASTC RGB/RGBA (4×4, 5×5, 6×6, 8×8, 10×10, 12×12) uses an embedded WASM decoder, without runtime downloads or .NET. Directory `extract` decompresses and writes one bundle at a time without parsing asset objects; `loadedFiles` counts nodes with the serialized-file archive flag in this mode. PNG export releases converted RGBA caches while retaining directory metadata for cross-bundle references.

Container assignment uses half-open preload ranges and the last matching entry. ASTC sources and optional compiler instructions are in [vendor/astc](vendor/astc/README.md); ordinary builds need no C++ compiler.

Texture2D PNG supports `maxExportTasks` (1–64, default 4). Use 1 for the original serial path. Higher values decode and encode in independent Node workers; the parser retains ownership of asset managers and commits outputs in original order with the same path and byte-budget checks. At most that many texture jobs are in flight. More workers use more memory.

```js
const exporter = createExporter({ unityVersion: '2022.3.62f1', maxExportTasks: 4 });
try {
  await exporter.exportAssets('/path/to/bundles', '/path/to/output', { assetType: 'tex2d' });
} finally {
  await exporter.close();
}
```

Codec workers are reused across requests and replaced when concurrency changes. Abort, timeout and close wait for both parser and codec workers to exit. Inspect, archive extraction, raw texture output and other conversions keep their existing paths. Codec workers process only memory, with no filesystem writes or network access.

## Build and publish

Building and running need Node.js 22+; the checked-in WASM decoder needs no .NET or C++ compiler.

```sh
npm install --ignore-scripts
npm run build
npm test
npm pack
# Run after inspecting the generated tarball:
npm publish ./node-asset-studio-mod-js-0.1.0.tgz --access public
```

`npm pack` rebuilds through `prepack`. Use an unused package version for each release. Prefer separate checkouts when building multiple implementations; generated dependencies and runtime files are not switched by Git.
