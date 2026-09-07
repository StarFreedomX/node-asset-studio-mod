import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
let module: Promise<any> | undefined;
/** Memory-only Assimp conversion. The WASM and glue ship inside the package. */
export async function convertModel(
  data: Uint8Array,
  name: string,
  format: "fbx" | "fbxa" | "assjson" = "fbx",
): Promise<{ path: string; data: Uint8Array }[]> {
  const a = await (module ??= createRequire(import.meta.url)(
    "./vendor/assimp.cjs",
  )({
    wasmBinary: readFileSync(new URL("./vendor/assimp.wasm", import.meta.url)),
  }));
  const list = new a.FileList();
  let result: any;
  try {
    list.AddFile(name, data);
    result = a.ConvertFileList(list, format);
    if (!result.IsSuccess() || !result.FileCount())
      throw Error("Model conversion failed: " + result.GetErrorCode());
    const files = [];
    for (let i = 0; i < result.FileCount(); i++) {
      const f = result.GetFile(i);
      try {
        files.push({
          path:
            i === 0
              ? path.parse(name).name +
                (format === "assjson" ? ".json" : ".fbx")
              : f.GetPath(),
          data:
            /\.glb$/i.test(name) && format !== "assjson"
              ? fixGltfKeyTimes(Uint8Array.from(f.GetContent()), format)
              : Uint8Array.from(f.GetContent()),
        });
      } finally {
        f.delete();
      }
    }
    return files;
  } finally {
    result?.delete();
    list.delete();
  }
}

/** The pinned Assimp FBX exporter writes glTF millisecond ticks as seconds.
 * Keep stack durations intact; correct only AnimationCurve/KeyTime arrays.
 * This adapter is deliberately restricted to our GLB input and pinned writer.
 */
function fixGltfKeyTimes(data: Uint8Array, format: string): Uint8Array {
  if (format === "fbxa")
    return Buffer.from(
      Buffer.from(data)
        .toString()
        .replace(
          /(KeyTime:\s*\*\d+\s*\{\s*a:\s*)([\d,\s-]+)(\s*\})/g,
          (_m, p, values, s) =>
            p +
            values
              .trim()
              .split(",")
              .map((v: string) => (BigInt(v.trim()) / 1000n).toString())
              .join(",") +
            s,
        ),
    );
  const b = Buffer.from(data);
  if (b.readUInt32LE(23) !== 7500)
    throw Error("FBX time adapter requires writer version 7500");
  function walk(start: number, end: number, parent = "") {
    let p = start;
    while (p + 25 <= end) {
      const next = Number(b.readBigUInt64LE(p));
      if (next === 0) break;
      const properties = Number(b.readBigUInt64LE(p + 8)),
        length = Number(b.readBigUInt64LE(p + 16)),
        nameLength = b[p + 24],
        name = b.toString("utf8", p + 25, p + 25 + nameLength),
        value = p + 25 + nameLength;
      if (next <= p || next > end || value + length > next)
        throw Error("Invalid FBX node bounds");
      if (parent === "AnimationCurve" && name === "KeyTime") {
        if (
          properties !== 1 ||
          b[value] !== 108 ||
          b.readUInt32LE(value + 5) !== 0
        )
          throw Error("Unexpected FBX key-time encoding");
        const count = b.readUInt32LE(value + 1);
        if (length !== 13 + count * 8)
          throw Error("Invalid FBX key-time length");
        for (let i = 0; i < count; i++) {
          const at = value + 13 + i * 8;
          b.writeBigInt64LE(b.readBigInt64LE(at) / 1000n, at);
        }
      }
      walk(value + length, next, name);
      p = next;
    }
  }
  walk(27, b.length);
  return b;
}
