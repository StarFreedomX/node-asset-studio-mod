import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { decodeSmolv } from "./smolv.js";
let toolsPromise: Promise<any> | undefined;
async function disassemble(data: Uint8Array): Promise<string> {
  // Supply embedded package bytes explicitly: Emscripten must never fetch its WASM.
  toolsPromise ??= createRequire(import.meta.url)("./vendor/spirv-tools.cjs")({
    wasmBinary: readFileSync(
      new URL("./vendor/spirv-tools.wasm", import.meta.url),
    ),
  });
  const tools = await toolsPromise;
  const text = tools.dis(
    data,
    tools.SPV_ENV_UNIVERSAL_1_5,
    tools.SPV_BINARY_TO_TEXT_OPTION_INDENT,
  );
  if (!text) throw Error("Unable to disassemble SPIR-V shader");
  return text.replaceAll("\r\n", "\n");
}
export async function convertSpirvProgram(
  input: Uint8Array,
  legacySmolv = false,
): Promise<string> {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length < 4) throw Error("Truncated SPIR-V shader");
  if (b.readUInt32LE(0) === 0x07230203) return disassemble(b);
  if (b.readUInt32LE(0) === 0x534d4f4c)
    return disassemble(decodeSmolv(b, legacySmolv));
  let out = "",
    minimum = b.length;
  // Unity prefixes stage snippets with requirements and (offset, size) pairs.
  for (let p = 4, i = 0; i < 6 && p < minimum; i++, p += 8) {
    if (p + 8 > b.length) throw Error("Truncated Unity SPIR-V snippet table");
    const offset = b.readUInt32LE(p),
      size = b.readUInt32LE(p + 4);
    if (!size) continue;
    if (offset < p + 8 || offset + size > b.length)
      throw Error("Invalid Unity SPIR-V snippet range");
    minimum = Math.min(minimum, offset);
    out += await disassemble(
      decodeSmolv(b.subarray(offset, offset + size), legacySmolv),
    );
  }
  if (!out) throw Error("No SPIR-V snippets in shader");
  return out;
}
