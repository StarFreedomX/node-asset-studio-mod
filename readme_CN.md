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
| `export`           | Texture2D / Texture2DArray / Sprite 转 PNG；Shader 转 ShaderLab 检查文本；TextAsset、Font、Mesh OBJ、MonoBehaviour JSON、MovieTexture OGV、VideoClip、部分 AudioClip 由引擎导出 |
| `extract`          | 解出 Bundle 内部文件，包括伴随资源                                                                             |
| `exportRaw`        | 导出 serialized object 的原始字节，**不附加外部资源流**；完整资源请用 `extract`                                |
| `dump`             | 依赖文件自带 TypeTree，返回 JSON；无 TypeTree 时明确失败                                                       |
| `live2d`           | 调用引擎的 CubismModel 导出器；尚无本项目实测样本                                                              |
| 图片格式           | `png`，或 `none` 导出 Texture2D 原始纹理字节为 `.tex`                                                          |
| 音频               | 引擎的 JS PCM/Vorbis/MPEG 路径；需要 FMOD 的格式不支持，`wav` 不会强制把 OGG/MP3 转成 WAV                      |

用户提供的 `res014089`（Unity `2022.3.62f1`）已实测：4 个 Texture2D，4 张 PNG 与此前 .NET 导出结果的解码 RGBA 像素完全一致；还验证了 Bundle 解包、外部资源回读、TypeTree 和原始字节导出。另已实测 garupa-unpacker 的 10.1.0.240 → 10.1.0.250 全类型迁移：11 个新旧包、7 个资源项全部通过，最终写出 21 个差异文件。Shader、MonoBehaviour、Texture2D 和 TextAsset 均走正常转换，无 `.bin` 兜底。详见 [迁移回归记录](COMPATIBILITY.md)。

已移除 .NET 路径选项、安装器和 C# bridge。场景分组、外部程序集加载、压缩算法覆盖及文件日志不支持。FBX 支持 `fbxAnimation` 和 `fbxScaleFactor`；其他旧 FBX/Live2D 专用选项会明确报错。

`assetType` 可为单值或数组；`all` 选择 API 已列举的资源类型，不代表全部 Unity 对象。过滤支持 `filterByName` / `filterByContainer`、`filterByPathID`、`filterByText` 和 `filterWithRegex`；文本过滤优先于 PathID，PathID 优先于名称/容器。

输出默认按 `container` 分组，另有 `none`、`type`、`containerFull`、`fileName`。命名支持 `assetName`、`assetName_pathID`、`pathID`。已有文件默认报错，`overwrite: true` 允许覆盖；默认 `assetName` 同次导出重名时，后续对象自动追加 PathID，保留所有对象；显式 PathID 命名仍重名时会报错。归档解包重名仍报错。拒绝资源中的路径穿越和输出子目录符号链接。

默认输入及伴随资源预算 `maxInputBytes` 为 512 MiB，输出预算 `maxOutputBytes` 在 `readAssets` 中为 512 MiB、写入目录时为 16 GiB，单张 Texture2D 上限 `maxTexturePixels` 为 64 × 1024 × 1024。可传正整数调整。这些是处理预算，不是整个进程或 WASM 内存的硬上限。

### Shader 导出

默认 `assetType: 'all'` 包含 Shader，也可单独指定 `assetType: 'shader'`。
`readAssets` 返回带 `.shader` 路径的 UTF-8 字节，目录导出使用相同内容。
支持旧脚本、压缩 ShaderLab、Unity 2021.2+ player variants、分段程序，
GLSL/Metal 源码及 Vulkan SMOL-V → SPIR-V 反汇编。Shader 和无名 MonoBehaviour
分别使用 ShaderLab 名称和同文件 MonoScript 类名，支持名称过滤。

和原 AssetStudio 转换语义一致，`.shader` 是供检查的可读文本，不能当成可重新编译的原始 Shader；
DXBC 子程序仍输出原转换器的“不支持反汇编”注释。FBX 的支持范围见下文，不能据一次业务回归宣称所有引擎功能完全等价。

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
npm publish ./node-asset-studio-mod-js-0.1.3.tgz --access public
```

`npm pack` 会通过 `prepack` 重新构建。每次发布应使用尚未发布的版本号。三个实现使用同一 Git 仓库的 worktree 维护，目录和命令见 [worktree 维护说明](WORKTREES.md)。依赖和下载文件由各工作目录分别保存。

## 分支依赖隔离

建议为 CLI、pipe、JS 使用独立 worktree，并在各目录执行 `pnpm install`，避免复用 `node_modules`。Git 切换分支不会清除 pnpm 的 `ignoredBuilds` 状态。依赖构建许可已写入本分支的 `pnpm-workspace.yaml`。本分支明确允许 esbuild 构建脚本。


## 0.1.3：模型、纹理数组和旧视频

```ts
const exporter = createExporter({ unityVersion: '2022.3.62f1', log: false });
try {
  // 输入可为目录、单个 Bundle 路径或已收到的 Buffer。
  const models = await exporter.readAssets('/path/to/bundles', {
    mode: 'animator',
    fbxAnimation: 'auto',
  });
  for (const { path, data } of models.files) {
    // path 保留文件名，data 为 FBX 字节，可直接交给下游或写入对象存储。
  }
  const objects = await exporter.readAssets('/path/to/props', { mode: 'splitObjects' });
} finally {
  await exporter.close();
}
```

- `animator`：按 Animator 导出其 GameObject 下的模型层级；默认 `all` 也包含 Animator。
- `splitObjects`：每个根 GameObject 层级导出一个 FBX，忽略不含网格的根。
- FBX 包含网格、UV、材质、支持的嵌入纹理、骨骼权重和静态 blend shape。普通 Transform 动画支持位置、旋转、缩放及 streamed/dense/constant 曲线，按源采样率烘焙。`auto` 读取 Animator Controller 引用，`all` 尝试同次加载的所有动画，`skip` 明确只导静态模型。
- `fbxScaleFactor` 是附加模型父节点缩放，默认 1。没有仿真 Unity 自定义 Shader、约束或运行时脚本。
- Texture2DArray 每层输出 `名称_1.png`、`名称_2.png` 等文件；读取每层基础 mip，正确跳过其余 mip；`imageFormat: 'none'` 输出各层基础 mip 原始 `.tex`。
- 旧 MovieTexture 原样输出 `.ogv`，不做视频转码；现代 VideoClip 继续使用既有导出路径。Garupa 清单中下载到的视频包实际使用 TextAsset。

**尚未等价的部分**：Humanoid 肌肉重定向、表情动画、旧压缩旋转/属性动画、加权切线及非 ZXY 旧欧拉曲线、需要 FMOD 的音频。
遇到这些动画会报 `UNSUPPORTED_OPERATION`，不会成功返回静态 FBX 冒充完整动画。
没有恢复优化骨架中被剥离的 Transform；缺少骨骼、外部引用或资源时明确失败。
动画支持已用合成曲线读回验证；清单中的真实动画为 Humanoid/表情曲线，不能当作已通过的普通骨骼动画样本。

安装包包含本地 WASM，无安装脚本、运行时下载、.NET、原生可执行文件或子进程。
真实模型回归可设置 `ASSET_STUDIO_TEST_MODEL_INPUT` 为本地缓存目录（其下保留 `star3d/...` 路径），再运行 `pnpm test` 和 `pnpm test:package`。
