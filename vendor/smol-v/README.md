# SMOL-V decoder provenance

`src/smolv.ts` ports the opcode table and decoder from
[aras-p/smol-v](https://github.com/aras-p/smol-v/tree/9dd54c379ac29fa148cb1b829bb939ba7381d8f4),
`source/smolv.cpp`, revision `9dd54c379ac29fa148cb1b829bb939ba7381d8f4`.
We select the MIT license option; the complete upstream license is retained here.

The TypeScript port adds bounds checks and a 64 MiB decoded-program limit.
It supports encoding versions 0 and 1, plus the pre-zero Unity 2017–2020
variant selected by the enclosing Unity version. The opcode table uses the
upstream column order: result, type, relative IDs, variable-length remainder.
Version 0 knows opcodes through ModuleProcessed (330); version 1 through
GroupNonUniformQuadSwap (366).

`tests/fixtures/smol-v.json` contains an original synthetic assembly, assembled
by SPIRV-Tools 20.4.1 and compressed by the pinned upstream C++ encoder. The
unit test compares every decoded byte to that independent encoder's input.
No game resource or C++ compiler is required to run the tests or the package.
