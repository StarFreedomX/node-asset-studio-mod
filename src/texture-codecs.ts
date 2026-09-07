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

export async function decodeExtraBlocks(
  data: Uint8Array,
  width: number,
  height: number,
  format: number,
): Promise<Uint8Array> {
  const pvrtc = format === 12 || format === 14;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height * 4 > 0x7fffffff
  )
    throw Error("Invalid block texture dimensions");
  if (pvrtc && (width & (width - 1) || height & (height - 1)))
    throw Error("PVRTC dimensions must be powers of two");
  const w = pvrtc ? Math.max(width, format === 12 ? 16 : 8) : width,
    h = pvrtc ? Math.max(height, 8) : height;
  const required = pvrtc
    ? (w * h) / (format === 12 ? 4 : 2)
    : Math.ceil(w / 4) * Math.ceil(h / 4) * (format === 4 ? 8 : 16);
  if (data.length < required) throw Error("Truncated block texture");
  const module = await (decoder ??= createAstcModule());
  let input = 0,
    output = 0;
  try {
    input = module._malloc(required + 16);
    output = module._malloc(w * h * 4);
    if (!input || !output) throw Error("Texture allocation failed");
    module.HEAPU8.set(data.subarray(0, required), input);
    module.HEAPU8.fill(0, input + required, input + required + 16);
    if (!module._decode_extra_rgba(input, w, h, format, output))
      throw Error("Block texture decoding failed");
    const result = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      result.set(
        module.HEAPU8.subarray(
          output + y * w * 4,
          output + y * w * 4 + width * 4,
        ),
        y * width * 4,
      );
    return result;
  } finally {
    if (output) module._free(output);
    if (input) module._free(input);
  }
}
