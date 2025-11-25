# node-asset-studio-mod

Node.js 封装的 [AssetStudioMod](https://github.com/aelurum/AssetStudio) CLI。

## 环境要求

**需要 .NET 9 Runtime**

- **Windows**: [.NET Desktop Runtime 9.0](https://dotnet.microsoft.com/download/dotnet/9.0)
- **Linux / Mac**: [.NET Runtime 9.0](https://dotnet.microsoft.com/download/dotnet/9.0)

确保在使用此库之前已安装运行时。

---

## 安装

```
# 使用 pnpm
pnpm install node-asset-studio-mod

# 或 npm
npm install node-asset-studio-mod

# 或 yarn
yarn add node-asset-studio-mod
```

> 安装过程中，CLI 二进制文件会根据平台自动下载到 `bin/` 目录。

---

## 使用方法

### 1. 使用默认导出函数

```
import { exportAssets } from "node-asset-studio-mod";

const input = "path/to/assets/9.3.0.180";
const output = "path/to/analysing/9.3.0.180";

await exportAssets(input, output);
```

**默认选项：**

- `mode`: `"export"`
- `log`: `true`
- `group`: `"container"`
- `assetType`: `"all"`
- `filenameFormat`: `"assetName"`
- `imageFormat`: `"png"`
- `audioFormat`: `"wav"`
- `l2dGroupOption`: `"container"`
- `l2dMotionMode`: `"monoBehaviour"`
- `fbxScaleFactor`: `1`
- `fbxBoneSize`: `10`
- `fbxAnimation`: `"auto"`
- `blockinfoComp`: `"auto"`
- `blockComp`: `"auto"`
- `exportAssetList`: `"none"`
- `cliPath`: 会自动从 `bin/` 检测

你可以通过传入配置对象覆盖默认选项：

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

### 2. 使用类实例进行更灵活控制

```
import { AssetExporter } from "node-asset-studio-mod";

const exporter = new AssetExporter({
cliPath: "E:/myproject/bin/AssetStudioModCLI.exe", // 可选
mode: "export",
assetType: ["tex2d", "sprite"],
overwrite: true,
});

await exporter.exportAssets(input, output);
```

- 你可以创建多个实例来使用不同配置。
- `cliPath` 可选，库会自动检测 `bin/` 中的二进制文件。

---

### 3. 资源类型

支持的资源类型（对应 TS `AssetTypes`）：

```
"all", "tex2d", "tex2dArray", "sprite", "textasset", "monobehaviour",
"font", "shader", "movietexture", "audio", "video", "mesh", "animator"
```

**说明：**

- `"all"` 表示导出上面列出的所有类型。
- 你可以使用数组指定多个类型，例如 `["tex2d", "sprite"]`。

---

### 4. 导出模式

支持的模式（对应 TS `ExportMode`）：

```
"extract", "export", "exportRaw", "dump", "info", "live2d", "splitObjects", "animator"
```
