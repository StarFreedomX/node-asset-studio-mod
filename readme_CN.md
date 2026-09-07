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
- `cliPath`: 会自动从 `bin/` 检测

你可以通过传入配置对象覆盖默认选项：

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

## 安装缓存与本地运行时

CLI 安装成功后会记录 `.install.json`。后续安装校验版本和各文件的 SHA-256，文件完整时跳过下载；旧安装首次通过版本探测后会补写记录。缺失或损坏时重新下载，下载或解压失败会保留原安装。

安装检测和实际调用共用运行时选择：`ASSET_STUDIO_DOTNET`（dotnet 可执行文件路径）、包目录 `bin/dotnet/`、`DOTNET_ROOT_X64`、`DOTNET_ROOT`，最后查找 PATH。官方平台 CLI 是 x64，需要 **.NET 9 x64 Runtime**；Apple Silicon 上仅安装 ARM64 Runtime 不够。下载 CLI 不会安装 .NET。

```sh
# 在源码目录强制重新安装 CLI
pnpm setup:cli
# 使用本地官方压缩包离线安装
ASSET_STUDIO_CLI_ARCHIVE=/absolute/path/AssetStudioModCLI_net9_mac64.zip pnpm setup:cli
# 指定现有运行时，安装和调用时均可使用
ASSET_STUDIO_DOTNET=/absolute/path/dotnet pnpm install
```

`pnpm-workspace.yaml` 为本分支声明无需依赖构建脚本。若复用其他分支的旧 `node_modules`，应移走后重新安装；已有的 `ignoredBuilds` 状态不会随 Git 切换清除。建议为 `pipe`、`js` 使用独立 worktree，各自执行 `pnpm install`；JS 分支单独允许 esbuild 的构建脚本。

测试使用 `pnpm test`。设置 `ASSET_STUDIO_TEST_CLI_ARCHIVE` 为当前平台的官方 ZIP，可额外验证离线安装、缓存命中、损坏修复和安装失败回退。

## 构建与发布

发布后的 CLI 适配器在安装时下载对应平台的程序，运行需要 .NET 9 Runtime。

```sh
npm install --ignore-scripts
npm run build
npm pack
# 检查生成的压缩包后再发布：
npm publish ./node-asset-studio-mod-1.0.5.tgz --access public
```

`npm pack` 会通过 `prepack` 重新构建。每次发布应使用尚未发布的版本号。多个实现建议使用独立检出目录：Git 切换分支不会切换已安装依赖和下载的运行时文件。
