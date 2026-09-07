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
以上是 0.1.2 的 Shader 回归范围；0.1.3 新增的模型等能力见下文，仍不能表述为整个引擎功能完全等价。
音频解析不在这批样本中；ACB/HCA 后处理仍由调用项目负责。


# 0.1.3 扩展回归（2026-09-07）

样本按用户提供的 Release 10.1.0.230 Android AssetBundleInfo 清单选择并下载。
Unity 版本覆盖参数为 `2022.3.62f1`。真实游戏数据及临时检查输出保持忽略，不随 Git/npm 发布。

| 清单资源 | 模式 | FBX 数量 | 每个 FBX 骨骼数 | 每个 FBX 嵌入纹理数 |
| --- | --- | ---: | --- | --- |
| star3d/character/head/015_cos_live_event_244_013_ur | animator | 1 | 3 | 0 |
| star3d/character/costume/016_cos_collabo_i_1 | animator | 2 | 78、78 | 0、1 |
| star3d/props/102_01 | splitObjects | 2 | 0、0 | 1、1 |

每个 FBX 均由 FBX 导入器重新读回，校验网格、骨骼和嵌入纹理。
头部与服装包有多个独立层级，不属于所选 Animator 的其他根节点不会混入该 FBX。

发现并修复：Unity 2019+ 顶点格式编号变化导致的骨骼索引步长错误；四边形第二个三角形重复；
baseVertex 遗漏；读取流式 Mesh 时错误走浏览器资源路径；FBX 根节点丢失；
转换器把动画关键帧毫秒当成秒，导致动画只剩起始帧。
合成动画验证关键帧时间与位移末值，合成模型覆盖权重、UV、变换、静态 blend shape，
而不是只断言文件存在。

清单中另下载了 `star3d/motions/characterunique/ch015/001`（Humanoid 肌肉曲线）
和 `star3d/motions/lipsync/cute`（表情曲线）。这两类动画尚未实现，明确报
`UNSUPPORTED_OPERATION`；不将它们计为动画转换成功。
`fbxAnimation: 'skip'` 可在调用方明确选择后只导出静态模型。

未在这批真实资源中发现 Texture2DArray/MovieTexture；使用独立构造的 Unity 序列化文件，
验证 2018/2022 数组布局、mip 步长、伴随流偏移、串并行 PNG、文件名、预算及损坏输入，
以及旧 MovieTexture OGV 字节保留。下载的视频样本实际是 TextAsset。
新增 BC4/5/6H、PVRTC、半精度/浮点和整数纹理路径有合成解码与边界测试；
不把合成用例表述为这些格式均经过真实游戏资源验证。

41 项单元/真实模型测试通过；res014089、卡池 Shader 集成及离线安装包测试通过。
安装包在空 PATH 和无效 DOTNET_ROOT 下导出 PNG、Shader、Texture2DArray 和真实模型 FBX。
原业务 diff 240→250 通过 `scripts/test-garupa-migration.mjs` 重跑：11 个输入、7/7 成功、21 个最终差异文件，零警告、零兜底。

仍缺少 Humanoid 重定向、表情动画、旧压缩旋转/属性动画、加权切线及非 ZXY 旧欧拉曲线、优化骨架还原及部分 FMOD 音频。
这次增加了可用的转换能力，尚未达到原引擎全功能等价。

# 0.1.4 动画与骨架补全（2026-09-07）

新增实现：

- Blend shape 的旧 FloatCurve 和现代 streamed/dense/constant 动画绑定，兼容带/不带 `blendShape.` 前缀的 CRC32；多通道共同采样，渐进帧权重插值。
- 补写 Assimp 遗漏的 FBX 表情 AnimationStack / Layer / Curve 及连接，保留静态权重；重算二进制节点偏移和尾部对齐。
- Renderer.enabled → FBX Visibility 阶跃曲线。
- 旧加权 Bezier/Hermite 切线、六种欧拉旋转顺序、PackedQuatVector 解码与旋转导出。
- 修复 PackedQuatVector 错读额外四字节、Unity 2018 加权关键帧错位、各曲线单独归零造成起始延迟丢失的问题。
- 旧 Animation 组件自动收集绑定动画；同名片段独立命名。完全不匹配时失败，单个表情目标缺失时警告。
- 优化骨架根据 Avatar 默认姿势和 TOS 还原，通过骨骼名称哈希绑定；仅存一个骨骼索引的顶点恢复隐含的单位权重。

## 真实表情动画

继续从用户清单下载 `star3d/character/head/001_cos_live_default`（3,431,633 字节），
和已有的 `star3d/motions/lipsync/cute` 放在同一输入目录，以 `mode: animator, fbxAnimation: all` 导出。
使用 **Three.js 0.180.0 FBXLoader**，独立于写出用的 Assimp，读取完整 FBX；仅关闭图片加载，避免测试依赖浏览器 DOM/网络。

| 动画 | 时长 | 表情轨道 | 有变化的嘴型轨道 | 每条轨道采样 |
| --- | ---: | ---: | ---: | ---: |
| cute_lip_sync_001 | 1 秒 | 31 | 4 | 61 |
| cute_lip_sync_without_voice_001 | 1 秒 | 31 | 4 | 61 |

四条变化轨道的峰值分别约为 1、0.584173、0.435517、0.708955；其余轨道保留常量，导出无缺失目标警告。
FBX 还包含可见性轨道；Three.js 的 FBX 动画读取器不处理 Visibility，因此可见性另用节点连接、数值和阶跃标志回归验证，不宣称做过可见性播放验证。

旧压缩旋转、加权曲线、渐进表情帧、优化骨架恢复采用合成回归；未声称真实样本覆盖所有这些格式。
原真实模型、Shader、纹理数组和损坏输入回归保持。离线 npm 安装包在空 PATH、无效 DOTNET_ROOT 下也导出这两段唇形动画，再由独立读取器验证。

最终验证：54 项单元与真实模型/唇形测试通过；res014089、Shader 集成与离线安装包检查通过。
未提供本轮可选 ASTC 外部样本，该项集成测试跳过；内置 ASTC 合成回归仍通过。
原项目 diff 240→250 再次通过：11 个输入，7/7 资源项成功，21 个最终差异文件，零警告、零兜底。

## 剩余范围

Humanoid 样本的 Avatar 中可以读取 Human 骨架、关节轴、限制及映射，但肌肉曲线到关节姿态的完整重定向仍未实现。
`star3d/motions/characterunique/ch015/001` 仍明确报 `UNSUPPORTED_OPERATION`，没有替换成近似或静态成功结果。
其他旧属性动画和 FMOD 依赖音频也仍有限制。本轮不宣称全引擎等价。

```sh
ASSET_STUDIO_TEST_MODEL_INPUT=/path/to/model-cache \
ASSET_STUDIO_TEST_LIPSYNC_INPUT=/path/to/model-cache pnpm test

ASSET_STUDIO_TEST_INPUT=/Users/bytedance/Downloads/res014089 \
ASSET_STUDIO_TEST_SHADER_INPUT=/path/to/gacha1937 \
ASSET_STUDIO_TEST_MODEL_INPUT=/path/to/model-cache \
ASSET_STUDIO_TEST_LIPSYNC_INPUT=/path/to/model-cache pnpm test:package
```
