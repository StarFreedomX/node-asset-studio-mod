# node-asset-studio-mod-js

在 Node.js 中检查和导出 Unity 资源。解析引擎已替换为 [unityfs-js 0.2.8](https://github.com/bainiao404/unityfs-js)，运行时仅使用 JavaScript 和随包内嵌的 WebAssembly，不包含 .NET，不启动 AssetStudio CLI，也不下载外部运行时。

要求 Node.js 22+，ESM。发布包没有运行时 npm 依赖或安装脚本。源码构建需要安装开发依赖。

## 直接处理内存数据

```js
import { readFile } from "node:fs/promises";
import { readAssets } from "node-asset-studio-mod-js";

const input = await readFile("/Users/bytedance/Downloads/res014089");
const result = await readAssets(input, {
  unityVersion: "2022.3.62f1",
  assetType: "tex2d",
  imageFormat: "png",
  timeoutMs: 30_000,
  log: false,
});

for (const { path, data } of result.files) {
  // data 是 Uint8Array：可以直接交给 HTTP 响应、上传接口或下游解码器。
  console.log(path, data.byteLength);
}
```

输入支持文件/目录路径、Buffer、Uint8Array（包括非零偏移的切片）和 ArrayBuffer。传入内存数据时不生成临时文件；`readAssets` 返回内存结果，不写输出目录。输入会复制到 Worker，不会转移或分离调用方的 ArrayBuffer。该 API 一次返回完整结果，目前不是增量流式解析。

对于单独的 serialized asset 文件，可通过 `resourceFiles: { 'name.resS': bytes }` 提供伴随资源。路径输入自动加载同目录的 `.resS` / `.resource`；Bundle 内嵌资源自动解析。运行时不访问网络，URL 应由调用方下载为字节后传入。

## 检查、导出和控制生命周期

```js
import { createExporter } from "node-asset-studio-mod-js";

const exporter = createExporter({ unityVersion: "2022.3.62f1", log: false });
const controller = new AbortController();
try {
  const info = await exporter.inspect("/path/to/bundle");
  console.log(info.assets); // pathId 是字符串，保留完整 Int64 精度

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

`inspectAssets`、`exportAssets`、`readAssets` 也提供一次性函数，自动关闭 Worker。重复调用可复用 `createExporter()` 实例。处理通过 Node.js Worker 的结构化消息连接，不执行 shell，不解析控制台文字。`onEvent` 接收 `log` / `progress`，不负责承载结果或错误。

- 每个实例同时接受一个请求；重叠调用返回 `BUSY`；多个独立请求并发使用多个实例，单次请求的纹理并行使用 `maxExportTasks`。
- `AbortSignal`、超时、`close()` 会终止解析 Worker 和所有 codec Worker。拒绝请求前等待所有线程退出；取消/超时后下次请求会新建 Worker，`close()` 后实例永久关闭。
- 取消或失败不回滚已经写出的文件；需要全有或全无时，先用 `readAssets`，由调用方保存成功结果。
- 默认超时 120 秒，`timeoutMs: 0` 关闭超时。`workerThreadId` 用于诊断；已移除 `workerPid`。
- 错误是带 `code` 的 `AssetStudioError`，例如 `ABORTED`、`TIMEOUT`、`LIMIT_EXCEEDED`、`UNSUPPORTED_OPTION`、`UNSUPPORTED_OPERATION`、`ASSET_PROCESSING_ERROR`。普通日志中的 “error” 不会被当成失败。

## 功能范围与迁移

这是替换引擎后的兼容范围，不能视为完整 AssetStudio 的等价实现。

| 功能               | 当前行为                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `info` / `inspect` | 返回选中对象的名称、类型、容器、大小和 PathID                                                                  |
| `export`           | Texture2D / Sprite 转 PNG；TextAsset、Font、Mesh OBJ、MonoBehaviour JSON、VideoClip、部分 AudioClip 由引擎导出 |
| `extract`          | 解出 Bundle 内部文件，包括伴随资源                                                                             |
| `exportRaw`        | 导出 serialized object 的原始字节，**不附加外部资源流**；完整资源请用 `extract`                                |
| `dump`             | 依赖文件自带 TypeTree，返回 JSON；无 TypeTree 时明确失败                                                       |
| `live2d`           | 调用引擎的 CubismModel 导出器；尚无本项目实测样本                                                              |
| 图片格式           | `png`，或 `none` 导出 Texture2D 原始纹理字节为 `.tex`                                                          |
| 音频               | 引擎的 JS PCM/Vorbis/MPEG 路径；需要 FMOD 的格式不支持，`wav` 不会强制把 OGG/MP3 转成 WAV                      |

用户提供的 `res014089`（Unity `2022.3.62f1`）已实测：4 个 Texture2D，4 张 PNG 与此前 .NET 导出结果的解码 RGBA 像素完全一致；还验证了 Bundle 解包、外部资源回读、TypeTree 和原始字节导出。其他类型的转换尚未用真实样本验证，支持情况取决于新引擎。

已移除 .NET 路径选项、安装器和 C# bridge。FBX、Animator、splitObjects、Shader / MovieTexture / Texture2DArray 转换、场景分组、外部程序集加载、压缩算法覆盖、旧 Live2D/FBX 专用选项及文件日志不支持。传入旧选项会报错，不会静默忽略。

`assetType` 可为单值或数组；`all` 选择 API 已列举的资源类型，不代表全部 Unity 对象。过滤支持 `filterByName` / `filterByContainer`、`filterByPathID`、`filterByText` 和 `filterWithRegex`；文本过滤优先于 PathID，PathID 优先于名称/容器。

输出默认按 `container` 分组，另有 `none`、`type`、`containerFull`、`fileName`。命名支持 `assetName`、`assetName_pathID`、`pathID`。已有文件默认报错，`overwrite: true` 允许覆盖；同次导出重名仍报错，建议选用带 PathID 的命名。拒绝资源中的路径穿越和输出子目录符号链接。

默认输入及伴随资源预算 `maxInputBytes` 为 512 MiB，输出预算 `maxOutputBytes` 在 `readAssets` 中为 512 MiB、写入目录时为 16 GiB，单张 Texture2D 上限 `maxTexturePixels` 为 64 × 1024 × 1024。可传正整数调整。这些是处理预算，不是整个进程或 WASM 内存的硬上限。

## 开发与验证

```sh
pnpm install
pnpm build
pnpm test
ASSET_STUDIO_TEST_INPUT=/Users/bytedance/Downloads/res014089 pnpm test:integration
ASSET_STUDIO_TEST_INPUT=/Users/bytedance/Downloads/res014089 pnpm test:package
npm pack
```

源码结构：`src/index.ts` 为公共 API；`transport.ts` 管理 Worker 与请求；`worker.ts` 转发结果和事件；`engine.ts` 负责解析、过滤与导出。`scripts/build.js` 将引擎和内嵌 WASM 打包，等待解压器初始化，关闭浏览器 Worker/FMOD 回退，并让对象解析错误正常向上抛出。构建不需要 .NET、Rust 或 Python。

真实资源不随仓库提交。`tests/fixtures/res014089-pixels.json` 保存旧引擎输出的像素哈希，回归测试比较解码像素而非 PNG 压缩字节。上游和解码器说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

ASTC RGB/RGBA（4×4、5×5、6×6、8×8、10×10、12×12）使用包内 WASM 解码器，不需要网络下载或 .NET。`extract` 对目录逐包解压并写出内部文件，不解析资源对象；返回的 `loadedFiles` 此时按归档的 serialized-file 标记计数。PNG 导出会及时释放已转换纹理的 RGBA 缓存，但为了跨包引用仍会加载整个目录的资源元数据。

容器索引按 preload 的半开区间和最后归属规则建立。ASTC 源码与可复现构建说明见 [vendor/astc](vendor/astc/README.md)；普通构建不需要 C++ 编译器。

Texture2D PNG 支持 `maxExportTasks`（1–64，默认 4）。设为 1 使用原串行路径；大于 1 时，解析线程将纹理字节发送到独立 Node Worker 并行解码及编码，再按原顺序检查预算并写出。不会把整个 AssetManager 复制给每个 Worker。最多保留指定数量的在途纹理；增加并发也会增加内存使用。

```js
const exporter = createExporter({ unityVersion: '2022.3.62f1', maxExportTasks: 4 });
try {
  await exporter.exportAssets('/path/to/bundles', '/path/to/output', { assetType: 'tex2d' });
} finally {
  await exporter.close();
}
```

同一实例会复用 codec Worker；每次请求可覆盖并发数，调整时会清理旧池。取消、超时及 `close()` 会等待解析和 codec Worker 全部退出。`inspect`、`extract`、原始纹理输出和其它资源转换仍使用原有路径，不会为它们创建 codec Worker。codec Worker 只处理内存，不直接写文件或访问网络。

## 构建与发布

构建和运行需要 Node.js 22+；仓库已有 WASM 解码器，不需要 .NET 或 C++ 编译器。

```sh
npm install --ignore-scripts
npm run build
npm test
npm pack
# 检查生成的压缩包后再发布：
npm publish ./node-asset-studio-mod-js-0.1.0.tgz --access public
```

`npm pack` 会通过 `prepack` 重新构建。每次发布应使用尚未发布的版本号。三个实现使用同一 Git 仓库的 worktree 维护，目录和命令见 [worktree 维护说明](WORKTREES.md)。依赖和下载文件由各工作目录分别保存。

## 分支依赖隔离

建议为 CLI、pipe、JS 使用独立 worktree，并在各目录执行 `pnpm install`，避免复用 `node_modules`。Git 切换分支不会清除 pnpm 的 `ignoredBuilds` 状态。依赖构建许可已写入本分支的 `pnpm-workspace.yaml`。本分支明确允许 esbuild 构建脚本。
