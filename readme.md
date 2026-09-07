# node-asset-studio-mod-bridge

A controlled Node.js / TypeScript pipe API for [AssetStudioMod](https://github.com/aelurum/AssetStudioMod).

[简体中文](readme_CN.md)

Node.js exchanges versioned JSON Lines with a persistent .NET bridge over stdin/stdout. The bridge links AssetStudio DLLs and calls loading, parsing and export methods directly. It does not launch AssetStudioModCLI or parse console text to determine success.

This is an isolated worker process, not an in-process .NET binding. Input is currently a local file/directory path; exported files go to disk. The pipe carries requests, metadata, progress and errors, not resource bytes.

## Setup

Requires Node.js 22+ (ESM) and .NET 9 Runtime. Building from source requires .NET 9 SDK:

```bash
pnpm install
pnpm run build
```

Source postinstall downloads the pinned official v0.19.0 portable archive, checks SHA-256 and builds the bridge. Published packages include the portable bridge and upstream native libraries, so consumers only need Runtime. `prepack` builds both TypeScript and the bridge.

Use `ASSET_STUDIO_DOTNET` to select the build SDK. The scripts also check `bin/dotnet/dotnet`, `DOTNET_ROOT` and PATH. No system runtime is automatically installed. Run `npm run setup:bridge` to rebuild dependencies, or set `ASSET_STUDIO_ARCHIVE` to a local official portable ZIP for offline setup.

Native support depends on the .NET process OS/architecture. Tested on macOS arm64 and x64 .NET on Apple Silicon; other platforms need validation.

## Usage

One-shot helpers always close their worker:

```js
import { inspectAssets, exportAssets } from 'node-asset-studio-mod-bridge';

const input = '/absolute/path/to/res014089';
const info = await inspectAssets(input, { unityVersion: '2022.3.62f1' });
console.log(info.assets);

const result = await exportAssets(input, '/absolute/path/to/output', {
  unityVersion: '2022.3.62f1',
  assetType: ['tex2d', 'sprite', 'textasset'],
  imageFormat: 'png',
});
console.log(result.exportedCount);
```

Reuse a connection and control cancellation:

```js
import { createExporter } from 'node-asset-studio-mod-bridge';

const exporter = createExporter({ unityVersion: '2022.3.62f1', log: false });
const controller = new AbortController();
try {
  await exporter.inspect('/absolute/path/to/res014089');
  await exporter.exportAssets('/absolute/path/to/res014089', '/absolute/path/to/output', {
    signal: controller.signal,
    timeoutMs: 30_000,
    onEvent(event) { console.log(event); },
  });
  // A UI cancel button can call controller.abort() while the request is active.
} finally {
  await exporter.close();
}
```

One request per instance: overlapping calls reject with `BUSY`. Separate instances can run concurrently. Sequential requests reuse the worker and clear upstream state between operations. Always close an instance when finished (`Symbol.asyncDispose` is also supported); one-shot helpers handle this automatically.

Abort/timeout terminates that worker and waits for exit before rejecting. The next request starts a fresh worker, with no automatic retry of failed operations. `close()` permanently closes the instance. Cancellation/failure can leave partially written files; no rollback is performed. Default timeout is 120 seconds including startup; `0` disables it.

`onEvent` receives typed `log` and `progress` events. If it throws, the operation stops with `CALLBACK_ERROR`. Without a callback, `log: true` writes logs to stderr. `log: false` never disables error detection.

Asset export progress is coalesced to increasing integer percentages (at most 101 notifications per export). Each notification includes the latest completed count; successful completion reports 100%. Do not rely on receiving one event per file.

## Results and errors

Methods return `{ loadedFiles, assetCount, exportedCount, output, assets }`. Each asset contains `{ name, type, pathId, container, size, source }`. `pathId` is a string to preserve Int64 precision. `assetCount` counts selected exportable assets, not every Unity object. Exported asset/object counts may differ from output file counts. `info` returns count 0 and output null; Live2D returns exportedCount null; `extract` reports extracted files with an empty asset list.

`AssetStudioError` contains `code`, `message`, `details`. Codes include `INPUT_NOT_FOUND`, `INVALID_CONFIG`, `ASSET_PROCESSING_ERROR`, `ABORTED`, `TIMEOUT`, `BUSY`, `CLOSED`, `BRIDGE_NOT_FOUND`, `BRIDGE_START_FAILED`, `BRIDGE_EXIT`, `PIPE_ERROR`, `PROTOCOL_ERROR`, `CALLBACK_ERROR`.

Empty/invalid Unity input and upstream Error-level diagnostics reject explicitly, regardless of logging settings or process exit status. Error details retain at most 100 entries; a response frame is limited to approximately 64 MiB.

## Options and migration

See `src/types.ts` for the full typed API. Existing export/group/image/audio/filter/Unity/Live2D/FBX options are retained, including `filenameFormat`. The shortcut now supports a third config argument; instance methods support per-call overrides.

Modes: `extract`, `export`, `exportRaw`, `dump`, `info`, `live2d`, `splitObjects`, `animator`. Live2D/model modes select supporting object types according to upstream requirements.

For Texture2D, Texture2DArray and Sprite PNG export, `pngCompressionLevel: 1` selects faster lossless compression at the cost of larger files. The range is 0–9; omit it to keep upstream PNG settings. This option does not change texture decoding, pixels or the settings of other image formats, and does not affect Live2D/model export. It can be overridden per request and resets to the instance default on the next call.

Texture2D export wraps its decoded buffer directly until encoding finishes, avoiding an extra full-image copy. Switch textures retain upstream cropping behavior. ImageSharp internal parallelism is limited to one when multiple assets are exported concurrently; `maxExportTasks` continues to control asset-level parallelism.

Inline textures, array layers and audio resources share one reader per serialized file before parallel export. This makes the upstream reader lock protect the shared stream and prevents concurrent seeks from reading another resource's bytes.

Asset types: `all`, `tex2d`, `tex2dArray`, `sprite`, `textasset`, `monobehaviour`, `font`, `shader`, `movietexture`, `audio`, `video`, `mesh`, `animator`.

Breaking changes:

- `cliPath` is rejected; set constructor `bridgePath` / `dotnetPath` for a custom DLL/runtime.
- `logOutput: 'file' | 'both'` is rejected; route logs through `onEvent` instead.
- Results are structured rather than void. Reusable instances require `close()`.
- Filter precedence follows upstream: text > path ID > name/container combination. Regex strings are not split on commas.

## Tests

```bash
npm test
npm run test:bridge # .NET SDK: shared-stream concurrency regression
ASSET_STUDIO_TEST_INPUT=/absolute/path/to/res014089 npm run test:integration
node scripts/export-assets.js /absolute/path/to/res014089 /absolute/path/to/output 2022.3.62f1
```

Integration checks the fixture's four textures, PNG dimensions and decompressed data, state reset, literal paths, overwrite failures, cancellation, timeout and concurrent instances. Set `ASSET_STUDIO_TEST_UNITY_VERSION` to override the default 2022.3.62f1. The fixture is not committed, and test outputs are temporary.

Upstream source/license and local changes: `bridge/vendor/AssetStudioCLI/README.md`.

## Build and publish

Requires .NET 9 SDK to build the bridge; consumers only need .NET 9 Runtime.

```sh
npm install --ignore-scripts
npm run setup:bridge
npm run build
npm test
npm pack
# Run after inspecting the generated tarball:
npm publish ./node-asset-studio-mod-bridge-0.1.0.tgz --access public
```

`npm pack` rebuilds through `prepack`. Use an unused package version for each release. Prefer separate checkouts when building multiple implementations; generated dependencies and runtime files are not switched by Git.

## Separate branch dependencies

Use a separate worktree for CLI, pipe and JS and run `pnpm install` in each directory. Avoid sharing `node_modules`: switching Git branches does not clear pnpm’s `ignoredBuilds` state. Dependency build permissions are recorded in this branch’s `pnpm-workspace.yaml`. This branch requires no dependency build scripts; its own postinstall still runs normally.
