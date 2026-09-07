# node-asset-studio-mod-bridge

通过可控管道调用 [AssetStudioMod](https://github.com/aelurum/AssetStudioMod) 的 Node.js / TypeScript 库。

Node.js 与常驻 .NET 桥接进程通过 stdin/stdout 交换 JSON Lines 消息。桥接进程直接链接 AssetStudio 的 DLL，调用资源加载、解析和导出方法；**不启动 AssetStudioModCLI，不拼接业务命令行，不解析日志文字判断成功与否**。

这仍然是进程间调用，不是把 .NET 嵌入 Node.js。输入目前是本地文件/目录路径，转换结果写入指定目录；管道传输请求、资源元数据、进度和错误，不传输资源文件字节。

## 安装与构建

- Node.js 22 或更新版本，ESM。
- 运行需要 .NET 9 Runtime；从源码构建桥接层需要 .NET 9 SDK。
- 底层原生解码库必须支持 .NET 进程的系统和架构；本项目在 Apple Silicon 上实测 macOS arm64 和 x64 .NET。其他平台仍需实测。

从源码运行：

```bash
pnpm install
pnpm run build
```

`postinstall` 下载并校验固定版本 v0.19.0 的官方 portable 包，然后编译桥接层。源码构建可通过 `ASSET_STUDIO_DOTNET` 指定 SDK 的 `dotnet` 路径；也会自动查找项目内 `bin/dotnet/dotnet`、`DOTNET_ROOT` 和 PATH。

已发布的 npm 包包含编译好的桥接层和上游原生依赖，使用者只需要 Runtime。发布前 `prepack` 会执行完整构建。没有任何步骤自动安装或修改系统 .NET。

手动准备或重新构建：

```bash
npm run setup:bridge
npm run build
```

离线安装可将 `ASSET_STUDIO_ARCHIVE` 设为官方 `AssetStudioModCLI_net9_portable.zip` 的本地路径，仍会验证 SHA-256。`bin/` 下的 SDK、上游缓存、测试资源与导出结果不会整体打进 npm 包，仅包含 `bin/bridge/`。

## 一次性调用

快捷函数自动关闭桥接进程，包括失败或取消时：

```js
import { inspectAssets, exportAssets } from 'node-asset-studio-mod-bridge';

const input = '/absolute/path/to/res014089';
const info = await inspectAssets(input, { unityVersion: '2022.3.62f1' });
console.log(info.assets);

const result = await exportAssets(input, '/absolute/path/to/output', {
  unityVersion: '2022.3.62f1',
  assetType: ['tex2d', 'sprite', 'textasset'],
  imageFormat: 'png',
  group: 'container',
});
console.log(result.exportedCount);
```

## 复用连接与控制生命周期

```js
import { createExporter } from 'node-asset-studio-mod-bridge';

const exporter = createExporter({ unityVersion: '2022.3.62f1', log: false });
const controller = new AbortController();
try {
  const info = await exporter.inspect('/absolute/path/to/res014089');
  console.log(info.assetCount, exporter.workerPid);

  // 界面“取消”按钮可调用 controller.abort()。
  const result = await exporter.exportAssets(
    '/absolute/path/to/res014089', '/absolute/path/to/output',
    {
      signal: controller.signal,
      timeoutMs: 30_000,
      onEvent(event) {
        if (event.type === 'progress') console.log(event.phase, event.percent);
        if (event.type === 'log') console.log(event.level, event.message);
      },
    },
  );
  console.log(result);
} finally {
  await exporter.close();
}
```

- 同一实例连续调用复用同一桥接进程，每次请求完成前清理上游静态状态和文件句柄。
- 同一实例同时发起请求会拒绝并返回 `BUSY`；需要并行时创建多个实例。
- `AbortSignal` 或超时会杀掉该实例的桥接进程，**等待进程退出后**才拒绝 Promise。下一次调用会重新启动进程，不自动重试失败请求。
- `close()` 等待进程退出，并永久关闭该实例；也支持 `Symbol.asyncDispose`。实例持有活动管道，使用完必须关闭。
- 默认超时 120 秒，包含进程启动时间；`timeoutMs: 0` 禁用超时。
- 取消或导出失败可能留下已写入的部分文件，不会回滚或删除它们。
- `onEvent` 接收结构化日志与进度；没有回调且 `log: true` 时，日志写入 Node.js stderr。`log: false` 不会影响错误检测。回调抛异常会终止当前请求并返回 `CALLBACK_ERROR`。
- 资源导出进度按递增的整数百分比合并，每次导出最多 101 条；事件携带当时的完成数量，全部成功时报告 100%。调用方不应依赖每个文件都有一条进度事件。

## 返回值与错误

`inspect()` / `inspectAssets()` / `exportAssets()` 返回：

```ts
interface AssetResult {
  loadedFiles: number;
  assetCount: number;
  exportedCount: number | null; // info 为 0；Live2D 暂无汇总计数，返回 null
  output: string | null;
  assets: {
    name: string;
    type: string;
    pathId: string; // 原生 Int64，使用字符串避免 JS 精度丢失
    container: string;
    size: number;
    source: string;
  }[];
}
```

`assetCount` 表示当前类型/名称过滤后的可导出资源数，并非文件中所有 Unity 对象数。`exportedCount` 是资源/对象计数，不保证等于文件数。`extract` 模式的加载与资源列表为空，计数表示解包文件数。

失败抛出 `AssetStudioError`，包含 `code`、`message`、`details`。常见 code：`INPUT_NOT_FOUND`、`INVALID_CONFIG`、`ASSET_PROCESSING_ERROR`、`ABORTED`、`TIMEOUT`、`BUSY`、`CLOSED`、`BRIDGE_NOT_FOUND`、`BRIDGE_START_FAILED`、`BRIDGE_EXIT`、`PIPE_ERROR`、`PROTOCOL_ERROR`、`CALLBACK_ERROR`。

无法加载任何 Unity 文件会失败。上游通过 Error 级别日志报告的加载/转换失败也会变为结构化错误，不会因进程退出码为 0 而被当成成功。错误 details 最多保留 100 条；单条管道响应限制约 64 MiB。

## 配置与迁移

保留 `AssetExporter`、`createExporter` 和快捷函数 `exportAssets`。现在快捷函数真正支持第三个配置参数；实例方法也支持每次调用覆盖配置。

常用选项：`mode`、`assetType`、`group`、`filenameFormat`、`overwrite`、`imageFormat`、`audioFormat`、`unityVersion`、`filterByName`、`filterByContainer`、`filterByPathID`、`filterByText`、`filterWithRegex`、`maxExportTasks`。完整类型见 `src/types.ts`。

模式：`extract`、`export`、`exportRaw`、`dump`、`info`、`live2d`、`splitObjects`、`animator`。Live2D/模型模式按上游要求加载辅助对象，类型选择由模式决定。

Texture2D、Texture2DArray、Sprite 导出 PNG 时可设 `pngCompressionLevel: 1`，用更大的文件换取更快的无损压缩。范围为 0–9，省略时保留上游 PNG 默认设置；不改变纹理解码及像素，也不影响其他图片格式或 Live2D/模型导出。可逐次请求覆盖，下一次调用会恢复实例默认值。

Texture2D 导出直接复用解码缓冲区直到编码完成，省去一次整图复制；Switch 纹理保留上游裁剪路径。多资源并行导出时，将 ImageSharp 图片内部并行限制为 1，资源间的并行数仍由 `maxExportTasks` 控制。

并行导出前，同一序列化文件内的内嵌纹理、纹理数组层和音频统一使用同一个 Reader，让上游的 Reader 锁真正保护共享文件流，避免并发 seek 时读到其他资源的字节。`npm run test:bridge` 使用 .NET SDK 验证这一共享流并发场景。

资源类型：`all`、`tex2d`、`tex2dArray`、`sprite`、`textasset`、`monobehaviour`、`font`、`shader`、`movietexture`、`audio`、`video`、`mesh`、`animator`。

迁移注意：

- `cliPath` 不再支持，会明确报错；可在构造器中设置 `bridgePath`（自定义桥接 DLL）和 `dotnetPath`。
- `logOutput: 'file' | 'both'` 不再支持，请使用 `onEvent` 自行保存日志。
- 返回值由 `void` 改为结构化结果；实例使用完要 `await close()`，快捷函数自动关闭。
- 多个筛选字段沿用上游优先级：`filterByText` > `filterByPathID` > 名称与 container 组合。正则作为完整字符串传输，逗号不会拆开正则表达式。

## 验证

```bash
npm test
ASSET_STUDIO_TEST_INPUT=/absolute/path/to/res014089 npm run test:integration
node scripts/export-assets.js /absolute/path/to/res014089 /absolute/path/to/output 2022.3.62f1
```

集成用例使用 Unity `2022.3.62f1`（可通过 `ASSET_STUDIO_TEST_UNITY_VERSION` 覆盖），验证 res014089 的 4 张贴图、PNG 解压数据与尺寸、连续调用、筛选复位、特殊字符路径、覆盖失败、取消、超时及多实例并行。样本不复制进仓库，测试输出在临时目录中自动清理。

底层 AssetStudio 和导出辅助代码来自上游 v0.19.0；来源、许可证和本地修改见 `bridge/vendor/AssetStudioCLI/README.md`。

## 构建与发布

构建桥接层需要 .NET 9 SDK；使用者只需要 .NET 9 Runtime。

```sh
npm install --ignore-scripts
npm run setup:bridge
npm run build
npm test
npm pack
# 检查生成的压缩包后再发布：
npm publish ./node-asset-studio-mod-bridge-0.1.0.tgz --access public
```

`npm pack` 会通过 `prepack` 重新构建。每次发布应使用尚未发布的版本号。多个实现建议使用独立检出目录：Git 切换分支不会切换已安装依赖和下载的运行时文件。

## 分支依赖隔离

建议为 CLI、pipe、JS 使用独立 worktree，并在各目录执行 `pnpm install`，避免复用 `node_modules`。Git 切换分支不会清除 pnpm 的 `ignoredBuilds` 状态。依赖构建许可已写入本分支的 `pnpm-workspace.yaml`。本分支不需要依赖构建脚本；项目自身的 postinstall 仍会正常执行。
