// ShaderLab conversion follows AssetStudioMod (MIT), with Unity 2021.2+ player variants.
// See vendor/assetstudio/LICENSE. Vulkan disassembly uses bundled SPIRV-Tools WASM.
import { convertSpirvProgram } from "./spirv.js";

const gpuNames = [
  "Unknown",
  "GLLegacy",
  "GLES31AEP",
  "GLES31",
  "GLES3",
  "GLES",
  "GLCore32",
  "GLCore41",
  "GLCore43",
  "DX9VertexSM20",
  "DX9VertexSM30",
  "DX9PixelSM20",
  "DX9PixelSM30",
  "DX10Level9Vertex",
  "DX10Level9Pixel",
  "DX11VertexSM40",
  "DX11VertexSM50",
  "DX11PixelSM40",
  "DX11PixelSM50",
  "DX11GeometrySM40",
  "DX11GeometrySM50",
  "DX11HullSM50",
  "DX11DomainSM50",
  "MetalVS",
  "MetalFS",
  "SPIRV",
  "ConsoleVS",
  "ConsoleFS",
  "ConsoleHS",
  "ConsoleDS",
  "ConsoleGS",
  "RayTracing",
  "PS5NGGC",
];
const header =
  "//////////////////////////////////////////\n//\n// NOTE: This is *not* a valid shader file\n//\n///////////////////////////////////////////\n";
const quote = (s: unknown) => JSON.stringify(String(s ?? ""));
function number(v: number): string {
  if (!Number.isFinite(v)) throw Error("Non-finite shader value");
  for (let p = 1; p <= 9; p++) {
    const n = Number(v.toPrecision(p));
    if (Math.fround(n) === v) return String(n);
  }
  return String(v);
}
const val = (v: any, defaultValue = 0): number => v?.value ?? defaultValue;
const f = (v: any, defaultValue = 0) => number(val(v, defaultValue));

export function decompressShaderBlock(input: Uint8Array, size: number): Buffer {
  if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 ** 2)
    throw Error("Invalid shader block size");
  const out = Buffer.alloc(size);
  let i = 0,
    o = 0;
  const byte = () => {
    if (i >= input.length) throw Error("Truncated shader LZ4 block");
    return input[i++];
  };
  const length = (n: number) => {
    if (n === 15) {
      let x;
      do {
        x = byte();
        n += x;
      } while (x === 255);
    }
    return n;
  };
  while (i < input.length) {
    const token = byte(),
      literal = length(token >> 4);
    if (i + literal > input.length || o + literal > size)
      throw Error("Invalid shader LZ4 literals");
    out.set(input.subarray(i, i + literal), o);
    i += literal;
    o += literal;
    if (i === input.length) break;
    const offset = byte() | (byte() << 8),
      match = length(token & 15) + 4;
    if (!offset || offset > o || o + match > size)
      throw Error("Invalid shader LZ4 match");
    for (let j = 0; j < match; j++) out[o + j] = out[o + j - offset];
    o += match;
  }
  if (o !== size) throw Error("Shader decompressed length mismatch");
  return out;
}
class Reader {
  pos = 0;
  constructor(readonly data: Buffer) {}
  take(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.data.length)
      throw Error("Truncated shader program");
    const b = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  int() {
    return this.take(4).readInt32LE();
  }
  align() {
    this.take((4 - (this.pos % 4)) % 4);
  }
  string() {
    const s = this.take(this.int()).toString("utf8");
    this.align();
    return s;
  }
  count() {
    const n = this.int();
    if (n < 0 || n > this.data.length / 4)
      throw Error("Invalid shader entry count");
    return n;
  }
}
interface SubProgram {
  type: string;
  keywords: string[];
  localKeywords: string[];
  code: Buffer;
}
export function parseShaderPrograms(
  segments: Buffer[],
  segmented: boolean,
): SubProgram[] {
  if (!segments.length) throw Error("Missing shader program segment");
  const r = new Reader(segments[0]),
    n = r.count(),
    entries = [];
  for (let i = 0; i < n; i++)
    entries.push({
      offset: r.int(),
      length: r.int(),
      segment: segmented ? r.int() : 0,
    });
  const programs: SubProgram[] = new Array(n);
  entries.forEach((e, i) =>
    Object.defineProperty(programs, i, {
      configurable: true,
      enumerable: true,
      get() {
        const segment = segments[e.segment];
        if (
          !segment ||
          e.offset < 0 ||
          e.length < 0 ||
          e.offset + e.length > segment.length
        )
          throw Error("Invalid shader subprogram range");
        const b = new Reader(segment.subarray(e.offset, e.offset + e.length));
        const version = b.int(),
          type = gpuNames[b.int()];
        if (!type) throw Error("Unknown shader GPU program type");
        b.take(12);
        if (version >= 201608170) b.take(4);
        const keywords = Array.from({ length: b.count() }, () => b.string());
        const localKeywords =
          version >= 201806140 && version < 202012090
            ? Array.from({ length: b.count() }, () => b.string())
            : [];
        const code = b.take(b.int());
        b.align();
        const result = { type, keywords, localKeywords, code };
        Object.defineProperty(programs, i, {
          value: result,
          enumerable: true,
          configurable: true,
        });
        return result;
      },
    }),
  );
  return programs;
}
async function programText(
  p: SubProgram,
  legacySmolv = false,
): Promise<string> {
  let out = "";
  for (const [prefix, words] of [
    ["Keywords", p.keywords],
    ["Local Keywords", p.localKeywords],
  ] as const)
    if (words.length)
      out += prefix + " { " + words.map((w) => quote(w) + " ").join("") + "}\n";
  let code = "";
  if (p.code.length) {
    if (/^(GL|GLES|Console)/.test(p.type)) code = p.code.toString("utf8");
    else if (/^DX/.test(p.type))
      code = "// shader disassembly not supported on DXBC"; // Same result as upstream AssetStudioMod.
    else if (p.type === "MetalVS" || p.type === "MetalFS") {
      if (p.code.length < 4) throw Error("Truncated Metal shader");
      let offset = 4;
      if (p.code.readUInt32LE(0) === 0xf00dcafe) {
        if (p.code.length < 8) throw Error("Truncated Metal header");
        offset = p.code.readInt32LE(4);
      }
      const end = p.code.indexOf(0, offset);
      if (offset < 0 || end < offset) throw Error("Invalid Metal entry name");
      code = p.code.subarray(end + 1).toString("utf8");
    } else if (p.type === "SPIRV")
      code = await convertSpirvProgram(p.code, legacySmolv);
    else code = "//shader disassembly not supported on " + p.type;
  }
  return out + '"' + code + '"';
}
const platformNames: Record<string, string> = {
  GL: "openGL",
  D3D9: "d3d9",
  Xbox360: "xbox360",
  PS3: "ps3",
  D3D11: "d3d11",
  GLES20: "gles",
  NaCl: "glesdesktop",
  Flash: "flash",
  D3D11_9x: "d3d11_9x",
  GLES3Plus: "gles3",
  PSP2: "psp2",
  PS4: "ps4",
  XboxOne: "xboxone",
  PSM: "psm",
  Metal: "metal",
  OpenGLCore: "glcore",
  N3DS: "n3ds",
  WiiU: "wiiu",
  Vulkan: "vulkan",
  Switch: "switch",
  XboxOneD3D12: "xboxone_d3d12",
  GameCoreXboxOne: "xboxone",
  GameCoreScarlett: "xbox_scarlett",
  PS5: "ps5",
  PS5NGGC: "ps5_nggc",
};
function usable(platform: string, type: string) {
  const known: Record<string, string[]> = {
    GL: ["GLLegacy"],
    GLES20: ["GLES"],
    GLES3Plus: ["GLES31AEP", "GLES31", "GLES3"],
    OpenGLCore: ["GLCore32", "GLCore41", "GLCore43"],
    Metal: ["MetalVS", "MetalFS"],
    Vulkan: ["SPIRV"],
    D3D11_9x: ["DX10Level9Vertex", "DX10Level9Pixel"],
    PS5NGGC: ["PS5NGGC"],
  };
  if (known[platform]) return known[platform].includes(type);
  if (platform === "D3D9") return type.startsWith("DX9");
  if (platform === "D3D11") return type.startsWith("DX11");
  return (
    [
      "Xbox360",
      "PS3",
      "PSP2",
      "PS4",
      "XboxOne",
      "N3DS",
      "WiiU",
      "Switch",
      "XboxOneD3D12",
      "GameCoreXboxOne",
      "GameCoreScarlett",
      "PS5",
    ].includes(platform) && type.startsWith("Console")
  );
}
function tags(t: any, indent: number) {
  return t?.tags?.length
    ? " ".repeat(indent) +
        "Tags { " +
        t.tags
          .map((x: any) => quote(x.key) + " = " + quote(x.value) + " ")
          .join("") +
        "}\n"
    : "";
}
function properties(info: any) {
  let out = "Properties {\n";
  for (const p of info.properties) {
    const v = p.defaultValue;
    let type = p.type,
      def = "";
    if (type === "Range") type = `Range(${number(v[1])}, ${number(v[2])})`;
    if (p.type === "Texture") {
      type = (
        {
          Any: "any",
          Texture2D: "2D",
          Texture3D: "3D",
          Cube: "Cube",
          Texture2DArray: "2DArray",
          CubeArray: "CubeArray",
        } as any
      )[p.defaultTexture.textureDimension];
      if (!type) throw Error("Unknown shader texture dimension");
      def = quote(p.defaultTexture.defaultName) + " { }";
    } else if (p.type === "Color" || p.type === "Vector")
      def = "(" + v.map(number).join(",") + ")";
    else if (["Float", "Range", "Int"].includes(p.type)) def = number(v[0]);
    else throw Error("Unknown shader property type " + p.type);
    out +=
      p.attributes.map((a: string) => "[" + a + "] ").join("") +
      p.name +
      " (" +
      quote(p.description) +
      ", " +
      type +
      ") = " +
      def +
      "\n";
  }
  return out + "}\n";
}
const compare = [
  "Disabled",
  "Never",
  "Less",
  "Equal",
  "LEqual",
  "Greater",
  "NotEqual",
  "GEqual",
  "Always",
];
const stencil = [
  "Keep",
  "Zero",
  "Replace",
  "IncrSat",
  "DecrSat",
  "Invert",
  "IncrWrap",
  "DecrWrap",
];
const blendFactors = [
  "Zero",
  "One",
  "DstColor",
  "SrcColor",
  "OneMinusDstColor",
  "SrcAlpha",
  "OneMinusSrcColor",
  "DstAlpha",
  "OneMinusDstAlpha",
  "SrcAlphaSaturate",
  "OneMinusSrcAlpha",
];
const blendOps = [
  "Add",
  "Sub",
  "RevSub",
  "Min",
  "Max",
  "LogicalClear",
  "LogicalSet",
  "LogicalCopy",
  "LogicalCopyInverted",
  "LogicalNoop",
  "LogicalInvert",
  "LogicalAnd",
  "LogicalNand",
  "LogicalOr",
  "LogicalNor",
  "LogicalXor",
  "LogicalEquiv",
  "LogicalAndReverse",
  "LogicalAndInverted",
  "LogicalOrReverse",
  "LogicalOrInverted",
];
function state(s: any) {
  let out = "";
  if (s.name) out += "  Name " + quote(s.name) + "\n";
  if (s.lod) out += "  LOD " + s.lod + "\n";
  out += tags(s.tags, 2);
  for (const [i, b] of s.rtBlend.entries()) {
    const target = i || s.rtSeparateBlend ? i + " " : "";
    if (
      val(b.sourceBlend) !== 1 ||
      val(b.destinationBlend) !== 0 ||
      val(b.sourceBlendAlpha) !== 1 ||
      val(b.destinationBlendAlpha) !== 0
    ) {
      out +=
        "  Blend " +
        target +
        (blendFactors[val(b.sourceBlend)] ?? "One") +
        " " +
        (blendFactors[val(b.destinationBlend)] ?? "One");
      if (val(b.sourceBlendAlpha) !== 1 || val(b.destinationBlendAlpha) !== 0)
        out +=
          ", " +
          (blendFactors[val(b.sourceBlendAlpha)] ?? "One") +
          " " +
          (blendFactors[val(b.destinationBlendAlpha)] ?? "One");
      out += "\n";
    }
    if (val(b.blendOperation) !== 0 || val(b.blendOperationAlpha) !== 0) {
      out += "  BlendOp " + target + (blendOps[val(b.blendOperation)] ?? "Add");
      if (val(b.blendOperationAlpha) !== 0)
        out += ", " + (blendOps[val(b.blendOperationAlpha)] ?? "Add");
      out += "\n";
    }
    const mask = val(b.colorMask);
    if (mask !== 15)
      out +=
        "  ColorMask " +
        (mask
          ? [
              [2, "R"],
              [4, "G"],
              [8, "B"],
              [1, "A"],
            ]
              .filter(([n]) => mask & (n as number))
              .map(([, c]) => c)
              .join("")
          : "0") +
        " " +
        i +
        "\n";
  }
  if (val(s.alphaToMask) > 0) out += "  AlphaToMask On\n";
  if (s.zClip && val(s.zClip) !== 1) out += "  ZClip Off\n";
  if (val(s.zTest) !== 4)
    out +=
      "  ZTest " +
      (val(s.zTest) === 0 ? "Off" : (compare[val(s.zTest)] ?? "Always")) +
      "\n";
  if (val(s.zWrite) !== 1) out += "  ZWrite Off\n";
  if (val(s.culling) !== 2)
    out += "  Cull " + (["Off", "Front"][val(s.culling)] ?? "Back") + "\n";
  if (val(s.offsetFactor) || val(s.offsetUnits))
    out += "  Offset " + f(s.offsetFactor) + ", " + f(s.offsetUnits) + "\n";
  const stencilChanged = (v: any) =>
    val(v.pass) || val(v.fail) || val(v.zFail) || val(v.comp) !== 8;
  if (
    val(s.stencilRef) ||
    val(s.stencilReadMask) !== 255 ||
    val(s.stencilWriteMask) !== 255 ||
    [s.stencilOp, s.stencilOpFront, s.stencilOpBack].some(stencilChanged)
  ) {
    out += "  Stencil {\n";
    for (const [key, label, def] of [
      ["stencilRef", "Ref", 0],
      ["stencilReadMask", "ReadMask", 255],
      ["stencilWriteMask", "WriteMask", 255],
    ] as const)
      if (val(s[key]) !== def) out += "   " + label + " " + f(s[key]) + "\n";
    for (const [op, suffix] of [
      [s.stencilOp, ""],
      [s.stencilOpFront, "Front"],
      [s.stencilOpBack, "Back"],
    ])
      if (stencilChanged(op))
        out +=
          "   Comp" +
          suffix +
          " " +
          (compare[val(op.comp)] ?? "Always") +
          "\n   Pass" +
          suffix +
          " " +
          (stencil[val(op.pass)] ?? "Keep") +
          "\n   Fail" +
          suffix +
          " " +
          (stencil[val(op.fail)] ?? "Keep") +
          "\n   ZFail" +
          suffix +
          " " +
          (stencil[val(op.zFail)] ?? "Keep") +
          "\n";
    out += "  }\n";
  }
  const color = ["x", "y", "z", "w"].map((k) => val(s.fogColor[k]));
  if (
    s.fogMode !== "Unknown" ||
    color.some(Boolean) ||
    val(s.fogDensity) ||
    val(s.fogStart) ||
    val(s.fogEnd)
  ) {
    out += "  Fog {\n";
    if (s.fogMode !== "Unknown")
      out +=
        "   Mode " +
        (
          {
            Disabled: "Off",
            Linear: "Linear",
            Exponential: "Exp",
            Exponential2: "Exp2",
          } as any
        )[s.fogMode] +
        "\n";
    if (color.some(Boolean))
      out += "   Color (" + color.map(number).join(",") + ")\n";
    if (val(s.fogDensity)) out += "   Density " + f(s.fogDensity) + "\n";
    if (val(s.fogStart) || val(s.fogEnd))
      out += "   Range " + f(s.fogStart) + ", " + f(s.fogEnd) + "\n";
    out += "  }\n";
  }
  if (s.lighting) out += "  Lighting On\n";
  return out + "  GpuProgramID " + s.gpuProgramID + "\n";
}
export async function convertShader(shader: any): Promise<string> {
  const version = shader.reader?.version ?? [];
  if (shader.subProgramBlob) {
    const programs = parseShaderPrograms(
      [decompressShaderBlock(shader.subProgramBlob, shader.decompressedSize)],
      false,
    );
    const text = Buffer.from(shader.script).toString("utf8"),
      parts = [];
    let start = 0;
    for (const match of text.matchAll(/GpuProgramIndex (\d+)/g)) {
      parts.push(text.slice(start, match.index));
      const p = programs[Number(match[1])];
      if (!p) throw Error("Invalid shader blob index");
      parts.push(await programText(p, version[0] < 2021));
      start = match.index! + match[0].length;
    }
    return header + parts.join("") + text.slice(start);
  }
  if (!shader.compressedBlob)
    return header + Buffer.from(shader.script ?? []).toString("utf8");
  const platforms: string[] = shader.platforms;
  const all = platforms.map((_, i) =>
    parseShaderPrograms(
      shader.offsets[i].map((offset: number, j: number) => {
        const length = shader.compressedLengths[i]?.[j],
          size = shader.decompressedLengths[i]?.[j];
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          offset + length > shader.compressedBlob.length
        )
          throw Error("Invalid shader blob range");
        return decompressShaderBlock(
          shader.compressedBlob.subarray(offset, offset + length),
          size,
        );
      }),
      version[0] > 2019 || (version[0] === 2019 && version[1] >= 3),
    ),
  );
  async function programs(p: any): Promise<string> {
    const variants = p.subPrograms?.length
      ? p.subPrograms
      : (p.playerSubPrograms ?? [])
          .flat()
          .map((s: any) => ({
            ...s,
            gpuProgramType: gpuNames[s.gpuProgramType],
          }));
    let out = "";
    const groups = new Map<string, any[]>();
    for (const s of variants) {
      const key = s.blobIndex + ":" + s.gpuProgramType;
      const a = groups.get(key) ?? [];
      a.push(s);
      groups.set(key, a);
    }
    for (const group of groups.values()) {
      const platform = platforms.findIndex((platform) =>
        usable(platform, group[0].gpuProgramType),
      );
      if (platform < 0)
        throw Error(
          "No matching shader platform for " + group[0].gpuProgramType,
        );
      for (const s of group) {
        const p = all[platform][s.blobIndex];
        if (!p) throw Error("Missing shader subprogram " + s.blobIndex);
        const tier =
          group.length > 1
            ? "hw_tier" +
              String(s.shaderHardwareTier ?? 0).padStart(2, "0") +
              " "
            : "";
        out +=
          'SubProgram "' +
          (platformNames[platforms[platform]] ?? "unknown") +
          " " +
          tier +
          '" {\n' +
          (await programText(p, version[0] < 2021)) +
          "\n}\n";
      }
    }
    return out;
  }
  const parsed = shader.parsedForm;
  let out =
    header +
    "Shader " +
    quote(parsed.name) +
    " {\n" +
    properties(parsed.propInfo);
  for (const sub of parsed.subShaders) {
    out += "SubShader {\n";
    if (sub.lod) out += " LOD " + sub.lod + "\n";
    out += tags(sub.tags, 1);
    for (const p of sub.passes) {
      if (p.type === "Use") {
        out += " UsePass " + quote(p.useName) + "\n";
        continue;
      }
      out += p.type === "Grab" ? " GrabPass {\n" : " Pass {\n";
      if (p.type === "Grab") {
        if (p.textureName) out += "  " + quote(p.textureName) + "\n";
      } else {
        out += state(p.state);
        for (const [key, name] of [
          ["progVertex", "vp"],
          ["progFragment", "fp"],
          ["progGeometry", "gp"],
          ["progHull", "hp"],
          ["progDomain", "dp"],
          ["progRayTracing", "rtp"],
        ])
          if (p[key]) {
            const text = await programs(p[key]);
            if (text) out += 'Program "' + name + '" {\n' + text + "}\n";
          }
      }
      out += "}\n";
    }
    out += "}\n";
  }
  if (parsed.fallbackName)
    out += "Fallback " + quote(parsed.fallbackName) + "\n";
  if (parsed.customName)
    out += "CustomEditor " + quote(parsed.customName) + "\n";
  return out + "}";
}
