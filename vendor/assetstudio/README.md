# Shader converter provenance

`src/shader.ts` adapts the ShaderLab conversion and GPU subprogram reader from
[AssetStudioMod v0.19.0](https://github.com/aelurum/AssetStudio/tree/v0.19.0),
`AssetStudioUtility/ShaderConverter.cs`. The upstream MIT license is retained.

The TypeScript implementation additionally reads Unity 2021.2+ player
subprogram metadata, lazily distinguishes program entries from parameter
entries, checks compressed blob ranges, and disassembles Vulkan programs with
bundled SPIRV-Tools WASM. The resulting `.shader` is a readable ShaderLab
inspection export; like the original converter, it is not a re-compilable
reconstruction of the original shader source. DXBC retains upstream's explicit
unsupported-disassembly comment.
