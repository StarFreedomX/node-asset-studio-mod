import createAstcModule from "../vendor/astc/decoder.js";
let decoder: Promise<any> | undefined;

/** The WASM interface returns RGBA; Unity's PNG encoder flips rows. */
export async function decodeAstcRgba(
  data: Uint8Array,
  width: number,
  height: number,
  block: number,
): Promise<Uint8Array> {
  if (
    ![4, 5, 6, 8, 10, 12].includes(block) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height * 4) ||
    width * height * 4 > 0x7fffffff
  )
    throw new Error("Invalid ASTC dimensions or block size");
  const required = Math.ceil(width / block) * Math.ceil(height / block) * 16;
  if (data.byteLength < required)
    throw new Error("Truncated ASTC texture data");
  const module = await (decoder ??= createAstcModule());
  const outputSize = width * height * 4;
  const input = module._malloc(required + 16); // Padding for decoder block lookahead.
  let output = 0;
  try {
    if (!input) throw new Error("Could not allocate ASTC input");
    output = module._malloc(outputSize);
    if (!output) throw new Error("Could not allocate ASTC output");
    // Obtain the current heap view after allocation, which can grow memory.
    module.HEAPU8.set(data.subarray(0, required), input);
    module.HEAPU8.fill(0, input + required, input + required + 16);
    if (!module._decode_astc_rgba(input, width, height, block, output))
      throw new Error("ASTC decoding failed");
    return module.HEAPU8.slice(output, output + outputSize);
  } finally {
    if (output) module._free(output);
    if (input) module._free(input);
  }
}
