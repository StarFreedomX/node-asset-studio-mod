# Third-party notices

This distribution bundles unityfs-js 0.2.8 (https://github.com/bainiao404/unityfs-js), including its JavaScript and embedded WASM codecs. The bundled dependency is pinned as a build dependency and its MIT license is also copied to dist/licenses/unityfs-js-LICENSE.

Local adaptations: wait for LZ4/LZMA initialization, disable the browser texture worker import, propagate object parser errors, disable the external FMOD fallback, add ASTC decoder registration, and bypass object parsing for archive extraction. FMOD code and its external wasm runtime are not bundled.

## unityfs-js — MIT

MIT License

Copyright (c) 2026 bainiao404

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## LZ4 codec — BSD-2-Clause

Copyright (C) 2018 Raymond Hill

BSD-2-Clause License (http://www.opensource.org/licenses/bsd-license.php)

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the following disclaimer
   in the documentation and/or other materials provided with the
   distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Source: https://github.com/gorhill/lz4-wasm

## fpng — public domain / Unlicense

This is free and unencumbered software released into the public domain.

    Anyone is free to copy, modify, publish, use, compile, sell, or
    distribute this software, either in source code form or as a compiled
    binary, for any purpose, commercial or non-commercial, and by any
    means.

    In jurisdictions that recognize copyright laws, the author or authors
    of this software dedicate any and all copyright interest in the
    software to the public domain. We make this dedication for the benefit
    of the public at large and to the detriment of our heirs and
    successors. We intend this dedication to be an overt act of
    relinquishment in perpetuity of all present and future rights to this
    software under copyright law.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
    EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
    OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
    ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
    OTHER DEALINGS IN THE SOFTWARE.

    For more information, please refer to <http://unlicense.org/>

    Richard Geldreich, Jr.
    12/30/2021

## Upstream decoder provenance

The unityfs-js distribution also includes Crunch/Unity Crunch, BC7 and texture2ddecoder implementations, LZMA and FSB5/Vorbis reconstruction code. Upstream credits and reference sources:

- https://github.com/BinomialLLC/crunch
- https://github.com/Unity-Technologies/crunch/tree/unity
- https://github.com/Alexander-Holm/bc7-decoder
- https://github.com/bjornharrtell/texture2ddecoder-wasm
- https://github.com/mikalv/python-fsb5
- https://github.com/Perfare/UnityLive2DExtractor
- https://github.com/mos9527/UnityPyLive2DExtractor

These references do not add a .NET or Python runtime dependency: the distributed implementation executes in JavaScript/WebAssembly. Original attribution comments retained by the bundler remain in dist/engine.js or its accompanying legal-comments file.

## ASTC decoder — MIT

Source: https://github.com/K0lb3/texture2ddecoder/tree/3ebc3b758bd6b1a3108b50148f7998ee34f058c6/src/Texture2DDecoder

ASTC implementation originates in Ishotihadus/mikunyan. The vendored sources and revision are in vendor/astc; an added C interface copies whole buffers and converts BGRA to RGBA. Emscripten 4.0.15 compiles the embedded WASM. Compiler and C++ sources are not required at runtime.

MIT License

Copyright (c) 2020 K0lb3

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

FP16 license (also distributed in dist/licenses/astc-fp16-LICENSE.txt):

 FP16_H */

/*
 *
 * License Information
 *
 * FP16 library is derived from https://github.com/Maratyszcza/FP16.
 * The library is licensed under the MIT License shown below.
 *
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2017 Facebook Inc.
 * Copyright (c) 2017 Georgia Institute of Technology
 * Copyright 2019 Google LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *

## ShaderLab conversion — MIT

`src/shader.ts` adapts `AssetStudioUtility/ShaderConverter.cs` from
[AssetStudioMod v0.19.0](https://github.com/aelurum/AssetStudio/tree/v0.19.0),
with Unity 2021.2+ player variants and bounds-checked lazy subprogram reading.
The license is in `vendor/assetstudio/LICENSE` and distributed as
`dist/licenses/assetstudio-LICENSE`.

## SMOL-V — MIT

`src/smolv.ts` adapts the decoder and opcode table from
[aras-p/smol-v revision 9dd54c379ac29fa148cb1b829bb939ba7381d8f4](https://github.com/aras-p/smol-v/tree/9dd54c379ac29fa148cb1b829bb939ba7381d8f4).
We select the upstream MIT option. The full license is distributed as
`dist/licenses/smol-v-LICENSE`; source provenance and test fixture generation
are documented in `vendor/smol-v/README.md`.

## SPIRV-Tools WebAssembly — Apache-2.0

Vulkan shader disassembly uses `spirv-tools@20.4.1`, the WASM build from
[SPIRV-Tools.js](https://github.com/pjoe/SPIRV-Tools.js) of
[Khronos SPIRV-Tools](https://github.com/KhronosGroup/SPIRV-Tools).
The unmodified JavaScript glue and WASM are included in `dist/vendor`;
`dist/licenses/spirv-tools-LICENSE` contains its Apache-2.0 license.
Our adapter supplies local WASM bytes explicitly, with no runtime download.

## FBX model conversion — Assimp / assimpjs

The unmodified WASM and glue from [repalash/assimpjs](https://github.com/repalash/assimpjs/tree/cf1dce885402a2f96c3e029fd5384b5008b43543)
are bundled locally. Assimp is BSD-3-Clause and assimpjs is MIT;
full licenses ship as `dist/licenses/LICENSE-assimp` and `LICENSE-assimpjs`.
Pinned hashes, Assimp source revision and adaptation notes are in `vendor/assimp`.

The vendored MIT texture decoder also includes BC4/5/6H and PVRTC sources from
the same pinned texture2ddecoder revision listed above. Format layouts and Unity
object semantics are adapted from AssetStudioMod v0.19.0 (MIT); no C# runtime is used.
