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
import { exportAssets } from "node-asset-studio-mod";

await exportAssets(input, output, {
assetType: ["tex2d", "sprite", "textasset"],
overwrite: true,
imageFormat: "png",
logLevel: "info",
});
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
