# node-asset-studio-mod

Node.js wrapper for [AssetStudioMod](https://github.com/aelurum/AssetStudio) CLI.

other language:
* [简体中文](readme_CN.md)

## Environment

**.NET 9 Runtime required**

- **Windows**: [.NET Desktop Runtime 9.0](https://dotnet.microsoft.com/download/dotnet/9.0)
- **Linux / Mac**: [.NET Runtime 9.0](https://dotnet.microsoft.com/download/dotnet/9.0)

Ensure the runtime is installed before using this library.

---

## Installation

```
# using pnpm
pnpm install node-asset-studio-mod

# or npm
npm install node-asset-studio-mod

# or yarn
yarn add node-asset-studio-mod
```

> During installation, the CLI binary will be downloaded automatically into `bin/` according to your platform.

---

## Usage

### 1. Using the default exporter function

```
import { exportAssets } from "node-asset-studio-mod";

const input = "path/to/assets/9.3.0.180";
const output = "path/to/analysing/9.3.0.180";

await exportAssets(input, output);
```

**Default options:**

- `mode`: `"export"`
- `log`: `true`
- `group`: `"container"`
- `assetType`: `"all"`
- `cliPath`: automatically detected from `bin/`

You can override options by passing a config object:

```
import { createExporter } from "node-asset-studio-mod";

const exporter = createExporter({
assetType: ["tex2d", "sprite", "textasset"],
overwrite: true,
imageFormat: "png",
logLevel: "info",
});
await exporter.exportAssets(input, output);
```

---

### 2. Using class instance for more control

```
import { AssetExporter } from "node-asset-studio-mod";

const exporter = new AssetExporter({
cliPath: "E:/myproject/bin/AssetStudioModCLI.exe", // optional
mode: "export",
assetType: ["tex2d", "sprite"],
overwrite: true,
});

await exporter.exportAssets(input, output);
```

- You can create multiple instances with different configurations.
- `cliPath` is optional; the library will automatically detect the binary in `bin/`.

---

### 3. Asset Types

The supported asset types (matching TS `AssetTypes`) are:

```
"all", "tex2d", "tex2dArray", "sprite", "textasset", "monobehaviour",
"font", "shader", "movietexture", "audio", "video", "mesh", "animator"
```

**Notes:**

- `"all"` exports all types listed above.
- You can specify multiple types using an array, e.g., `["tex2d", "sprite"]`.

---

### 4. Export Modes

Supported modes (matching TS `ExportMode`):

```
"extract", "export", "exportRaw", "dump", "info", "live2d", "splitObjects", "animator"
```

## Installation cache and local runtime

Successful installs record `.install.json`. Subsequent installs verify the release and every file's SHA-256 and skip the download when intact. Legacy installations are adopted after a version probe. Missing or damaged files trigger a reinstall; download or extraction failures preserve the previous installation.

Installation checks and API calls share runtime discovery: `ASSET_STUDIO_DOTNET` (path to the dotnet executable), the package's `bin/dotnet/`, `DOTNET_ROOT_X64`, `DOTNET_ROOT`, then PATH. Official platform CLIs are x64 and require **.NET 9 x64 Runtime**. ARM64 Runtime alone on Apple Silicon is insufficient. Downloading the CLI does not install .NET.

```sh
# Force reinstall from the source checkout
pnpm setup:cli
# Install using a local official archive
ASSET_STUDIO_CLI_ARCHIVE=/absolute/path/AssetStudioModCLI_net9_mac64.zip pnpm setup:cli
# Select an existing runtime for installation or API calls
ASSET_STUDIO_DOTNET=/absolute/path/dotnet pnpm install
```

This branch's `pnpm-workspace.yaml` declares no dependency build scripts. Move aside stale `node_modules` before reinstalling if it was used by another branch: Git does not clear pnpm's `ignoredBuilds` state. Prefer separate worktrees for `pipe` and `js`, each with its own `pnpm install`. The JS branch explicitly allows esbuild's build script.

Run `pnpm test`. Set `ASSET_STUDIO_TEST_CLI_ARCHIVE` to the current platform's official ZIP to additionally test offline installation, cache hits, corruption repair and preservation after failed installs.

## Build and publish

The published CLI adapter downloads its platform binary on installation and requires .NET 9 Runtime.

```sh
npm install --ignore-scripts
npm run build
npm pack
# Run after inspecting the generated tarball:
npm publish ./node-asset-studio-mod-1.0.5.tgz --access public
```

`npm pack` rebuilds through `prepack`. Use an unused package version for each release. Maintain the three implementations as worktrees of one Git repository; see [worktree maintenance](WORKTREES.md). Dependencies and runtime files belong to each working directory.
