# 0.1.2 迁移回归（2026-09-07）

验证目标：`garupa-unpacker` 的 `diff_10.1.0.240_to_10.1.0.250.json`。
Unity 版本 `2022.3.62f1`，Node.js `24.19.0`，macOS ARM64。

## 本次修复

- Shader 转换接入默认 `all` 和 `shader` 类型选择，内存和目录 API 均导出带文件名的 `.shader` 文本。
- ShaderLab 属性、渲染状态、各 Pass、GLSL/Metal 源码和 Vulkan SPIR-V 反汇编。
- Unity 2021.2+ player subprogram 元数据、分段程序、程序表与参数表混排。
- SMOL-V 编码 0、1 及旧 Unity 的 pre-zero 格式；校验压缩、偏移、长度和解码输出边界。
- Shader 使用解析后的名称；无名 MonoBehaviour 使用同文件 MonoScript 的类名。
- 默认按名称导出时，同次出现重名对象会为后续对象追加 PathID，不再使整包失败。

## 真实业务结果

资源包从对应版本的官方 CDN 下载，完整原始字节保存在本地测试缓存。
测试先 `npm pack`，再向临时项目 **离线 npm install**，运行时清空 PATH、指向不存在的 DOTNET_ROOT。
使用原项目 `src/getAssets.ts` 及其内存处理模块，通过构建解析将库依赖指向这个已安装包。
HTTP adapter 回放下载到的原始资源，业务解包、后处理、比较、分阶段落盘代码照常执行。
任何警告（包括不支持类型时的 `.bin` 兜底）都会使测试失败。
原项目的源码、依赖及正式输出目录均未修改。

| 资源项 | 240 导出文件 | 250 导出文件 | 最终写出 |
| --- | ---: | ---: | ---: |
| gacha/screen/gacha1937 | — | 13 | 13 |
| graphicalinfo/info_stage_challenge_185 | — | 2 | 2 |
| stage_challenge_185 | — | 2 | 2 |
| exchange/images | 165 | 166 | 1 |
| homebanner | 2,015 | 2,016 | 1 |
| thumb/degree | 1,508 | 1,509 | 1 |
| thumb/exchangeicon | 156 | 157 | 1 |

**7/7 资源项成功，11 个输入包，7,709 个中间导出文件，最终 21 个差异文件；零失败，零兜底。**
卡池包的 13 个文件为 8 个 MonoBehaviour JSON、4 张 PNG 和 1 个 Shader；Shader 同时包含 GLSL 与 Vulkan 程序。
这不是网络速度测试：HTTP 响应来自缓存，不能将运行耗时当成实际下载性能。

## 回归测试

- 单元测试：独立上游编码器产生的合成 SMOL-V 参考数据、损坏输入、ShaderLab、旧脚本、Metal、Vulkan、分段数据。
- 真实 Shader 的 4 个 Vulkan 片段，JS 解码结果与上游 C++ 解码器逐字节一致。
- `res014089` 和 ASTC 样本的像素仍与原 .NET 导出一致。
- 卡池默认全类型的 Buffer/路径输入、内存/目录输出、串行/并行结果一致；名称过滤和原始导出也覆盖。
- npm 安装包在空 PATH 下导出 PNG 和 Shader，无安装下载、外部可执行程序或 .NET 文件。

```sh
pnpm install
pnpm build
pnpm test
ASSET_STUDIO_TEST_INPUT=/Users/bytedance/Downloads/res014089 \
ASSET_STUDIO_TEST_SHADER_INPUT=/path/to/gacha1937 \
pnpm test:integration
ASSET_STUDIO_TEST_INPUT=/Users/bytedance/Downloads/res014089 \
ASSET_STUDIO_TEST_SHADER_INPUT=/path/to/gacha1937 \
pnpm test:package

# 缓存目录格式：<input>/<version>/<bundle name>，例如 input/10.1.0.250/gacha/screen/gacha1937。
# 项目依赖需已安装；该命令只向临时项目安装待验证的库。
GARUPA_PROJECT=/path/to/garupa-unpacker \
GARUPA_DIFF=/path/to/diff_10.1.0.240_to_10.1.0.250.json \
GARUPA_BUNDLE_INPUT=/path/to/input \
node scripts/test-garupa-migration.mjs
```

真实游戏数据不提交。合成 SMOL-V 参考数据及来源记录位于 `tests/fixtures/smol-v.json`。

## 已知范围

本次确认了该项目实际用到的 Shader、MonoBehaviour、Texture2D、TextAsset 迁移流程。
`.shader` 沿用原转换器的检查文本语义，并非可重新编译的原始 Shader；DXBC 仍保留原转换器“不支持反汇编”的说明。
FBX/Animator、MovieTexture、Texture2DArray 转换等尚未实现，不能把本次业务通过表述为整个 AssetStudio 引擎功能完全等价。
音频解析不在这批样本中；ACB/HCA 后处理仍由调用项目负责。
