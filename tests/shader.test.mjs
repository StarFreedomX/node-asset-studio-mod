import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodeSmolv } from "../dist/smolv.js";
import { convertSpirvProgram } from "../dist/spirv.js";
import {
  convertShader,
  decompressShaderBlock,
  parseShaderPrograms,
} from "../dist/shader.js";
const fixture = JSON.parse(
  await readFile(new URL("./fixtures/smol-v.json", import.meta.url)),
);
const smol = Buffer.from(fixture.smolv, "base64"),
  spirv = Buffer.from(fixture.spirv, "base64");
const words = (...values) => {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
  return b;
};
function literal(data) {
  let n = data.length;
  const lengths = [Math.min(n, 15) << 4];
  if (n >= 15) {
    n -= 15;
    while (n >= 255) {
      lengths.push(255);
      n -= 255;
    }
    lengths.push(n);
  }
  return Buffer.concat([Buffer.from(lengths), data]);
}
function subprogram(code, type = 4, version = 202012090) {
  const header = words(
    version,
    type,
    0,
    0,
    0,
    0,
    0,
    ...(version >= 201806140 && version < 202012090 ? [0] : []),
    code.length,
  );
  return Buffer.concat([
    header,
    code,
    Buffer.alloc((4 - (code.length % 4)) % 4),
  ]);
}
const state = {
  rtBlend: [],
  zTest: { value: 4 },
  zWrite: { value: 1 },
  culling: { value: 2 },
  stencilRef: { value: 0 },
  stencilReadMask: { value: 255 },
  stencilWriteMask: { value: 255 },
  stencilOp: { comp: { value: 8 } },
  stencilOpFront: { comp: { value: 8 } },
  stencilOpBack: { comp: { value: 8 } },
  fogColor: {},
  fogMode: "Unknown",
  gpuProgramID: 42,
};
function shader(platform, programType, code, player = true) {
  const program = subprogram(code, programType);
  // Entry 0 holds parameter bytes, entry 1 holds a program in another segment.
  const index = words(2, 0, 4, 1, 4, program.length, 1),
    payload = Buffer.concat([words(0xdeadbeef), program]);
  const blocks = [literal(index), literal(payload)];
  return {
    reader: { version: [2022, 3, 62] },
    platforms: [platform],
    compressedBlob: Buffer.concat(blocks),
    offsets: [[0, blocks[0].length]],
    compressedLengths: [blocks.map((b) => b.length)],
    decompressedLengths: [[index.length, payload.length]],
    parsedForm: {
      name: "Test/Shader",
      propInfo: {
        properties: [
          {
            name: "_Tint",
            description: "Tint",
            attributes: [],
            type: "Color",
            defaultValue: [1, 0, 0, 1],
          },
          {
            name: "_Amount",
            description: "Amount",
            attributes: ["Range"],
            type: "Float",
            defaultValue: [Math.fround(0.1)],
          },
        ],
      },
      subShaders: [
        {
          lod: 100,
          tags: { tags: [{ key: "Queue", value: "Transparent" }] },
          passes: [
            {
              type: "Normal",
              state,
              progVertex: player
                ? {
                    subPrograms: [],
                    playerSubPrograms: [
                      [],
                      [{ blobIndex: 1, gpuProgramType: programType }],
                    ],
                  }
                : { subPrograms: [{ blobIndex: 1, gpuProgramType: "GLES3" }] },
            },
          ],
        },
      ],
      fallbackName: "Diffuse",
      customName: "TestEditor",
    },
  };
}

test("SMOL-V 1 and 0 decode to independent upstream encoder reference, including grouped decorations and compact shuffle", () => {
  assert.deepEqual(decodeSmolv(smol), spirv);
  const versionZero = Buffer.from(smol);
  versionZero.writeUInt32LE(0x10000, 4);
  assert.deepEqual(decodeSmolv(versionZero), spirv);
  // Unity 2017–2020 used the pre-zero encoding (unsigned decoration ID delta).
  const old = Buffer.concat([
    words(0x534d4f4c, 0x10000, 0, 10, 0, 32),
    Buffer.from([0, 5, 0]),
  ]);
  assert.deepEqual(
    decodeSmolv(old, true),
    Buffer.concat([words(0x07230203, 0x10000, 0, 10, 0), words(0x30047, 5, 0)]),
  );
});
test("SMOL-V rejects truncated, oversized, unknown-version and malformed payloads", () => {
  for (const n of [0, 4, 23, smol.length - 1])
    assert.throws(() => decodeSmolv(smol.subarray(0, n)));
  for (const [offset, value] of [
    [0, 0],
    [4, 0x02010000],
    [20, 0xffffffff],
    [20, 24],
  ]) {
    const b = Buffer.from(smol);
    b.writeUInt32LE(value, offset);
    assert.throws(() => decodeSmolv(b));
  }
  const invalid = Buffer.concat([
    words(0x534d4f4c, 0x01010000, 0, 1, 0, 24),
    Buffer.from([255, 255, 255, 255, 255]),
  ]);
  assert.throws(() => decodeSmolv(invalid), /overflow/);
});
test("SPIR-V disassembles direct bytes, SMOL-V and Unity snippet tables with bundled WASM", async () => {
  const table = Buffer.concat([
    words(0, 52, smol.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    smol,
  ]);
  for (const input of [spirv, smol, table]) {
    const text = await convertSpirvProgram(input);
    assert.match(text, /OpEntryPoint Vertex/);
    assert.match(text, /OpMemberDecorate %\d+ 2 Offset 32/);
    assert.match(text, /OpVectorShuffle/);
  }
  const invalid = Buffer.from(table);
  invalid.writeUInt32LE(table.length, 4);
  await assert.rejects(convertSpirvProgram(invalid), /range/);
  await assert.rejects(
    convertSpirvProgram(words(0, 0, 0)),
    /Truncated|No SPIR-V/,
  );
});
test("shader LZ4 handles overlap and rejects corrupt offsets, truncated input and size mismatches", () => {
  assert.equal(
    decompressShaderBlock(Buffer.from([0x15, 65, 1, 0]), 10).toString(),
    "AAAAAAAAAA",
  );
  const bytes = Buffer.alloc(600, 65);
  assert.deepEqual(decompressShaderBlock(literal(bytes), bytes.length), bytes);
  for (const [data, size] of [
    [Buffer.from([0x10]), 1],
    [Buffer.from([0, 0, 0]), 4],
    [Buffer.from([0x15, 65, 1, 0]), 9],
    [Buffer.from([0x10, 65]), 2],
  ])
    assert.throws(() => decompressShaderBlock(data, size));
});
test("ShaderLab exports modern player variants, segmented blobs, render state and GLSL source without parsing parameter entries", async () => {
  for (const player of [true, false]) {
    const text = await convertShader(
      shader(
        "GLES3Plus",
        4,
        Buffer.from("#ifdef VERTEX\nvoid main() {}\n#endif"),
        player,
      ),
    );
    assert.match(text, /Shader "Test\/Shader"/);
    assert.match(text, /_Tint \("Tint", Color\) = \(1,0,0,1\)/);
    assert.match(text, /_Amount \("Amount", Float\) = 0.1\n/);
    assert.match(text, /SubProgram "gles3 /);
    assert.match(text, /void main\(\)/);
    assert.match(text, /Fallback "Diffuse"/);
    assert.match(text, /CustomEditor "TestEditor"/);
    assert.doesNotMatch(text, /undefined|NaN/);
  }
  const s = shader("Vulkan", 25, smol);
  assert.match(await convertShader(s), /OpEntryPoint Vertex/);
  s.parsedForm.subShaders[0].passes[0].progVertex.playerSubPrograms[1][0].blobIndex = 999;
  await assert.rejects(convertShader(s), /Missing shader subprogram/);
  assert.throws(
    () => parseShaderPrograms([words(1, -1, 10)], false)[0],
    /range/,
  );
});
test("legacy ShaderLab GPU index replacement, Metal source and DXBC match original exporter semantics", async () => {
  const p = subprogram(Buffer.from("legacy glsl"), 4, 201608170),
    blob = Buffer.concat([words(1, 12, p.length), p]);
  const text = await convertShader({
    reader: { version: [5, 4] },
    script: Buffer.from('Shader "Legacy" { GpuProgramIndex 0 }'),
    subProgramBlob: literal(blob),
    decompressedSize: blob.length,
  });
  assert.match(text, /"legacy glsl"/);
  assert.doesNotMatch(text, /GpuProgramIndex/);
  const metal = Buffer.concat([
    words(0xf00dcafe, 8),
    Buffer.from("main\0vertex float4 main() {}"),
  ]);
  assert.match(
    await convertShader(shader("Metal", 23, metal)),
    /vertex float4 main\(\)/,
  );
  assert.match(
    await convertShader(shader("D3D11", 15, Buffer.from("DXBC"))),
    /disassembly not supported on DXBC/,
  );
  assert.match(
    await convertShader({ script: Buffer.from('Shader "Old" {}') }),
    /Shader "Old"/,
  );
});
