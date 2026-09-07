import { DecoderManager } from "../node_modules/unityfs-js/decoders/DecoderManager.js";
import { decodeExtraBlocks } from "./texture-codecs.js";
const layouts: Record<string, [number, number, string]> = {
  r8: [1, 1, "uint"],
  rg16: [2, 1, "uint"],
  r16: [1, 2, "uint"],
  rg32: [2, 2, "uint"],
  rgb48: [3, 2, "uint"],
  rgba64: [4, 2, "uint"],
  rhalf: [1, 2, "float"],
  rghalf: [2, 2, "float"],
  rgbhalf: [3, 2, "float"],
  rgbahalf: [4, 2, "float"],
  rfloat: [1, 4, "float"],
  rgfloat: [2, 4, "float"],
  rgbfloat: [3, 4, "float"],
  rgbafloat: [4, 4, "float"],
  bgra32: [4, 1, "bgra"],
  argb32: [4, 1, "argb"],
  bgr24: [3, 1, "bgr"],
};
function half(v: number) {
  const sign = v & 0x8000 ? -1 : 1,
    e = (v >>> 10) & 31,
    f = v & 1023;
  return (
    sign *
    (e === 0
      ? f * 2 ** -24
      : e === 31
        ? f
          ? NaN
          : Infinity
        : (1 + f / 1024) * 2 ** (e - 15))
  );
}
export function decodePackedPixels(
  data: Uint8Array,
  width: number,
  height: number,
  format: string,
): Uint8Array {
  const layout = layouts[format];
  if (!layout) throw Error("Unsupported packed format " + format);
  const [channels, size, type] = layout,
    n = width * height,
    required = n * channels * size;
  if (
    !Number.isSafeInteger(n) ||
    n <= 0 ||
    n * 4 > 0x7fffffff ||
    data.length < required
  )
    throw Error("Truncated or excessive packed texture");
  const b = new DataView(data.buffer, data.byteOffset, data.byteLength),
    out = new Uint8Array(n * 4);
  const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  for (let i = 0; i < n; i++) {
    out[i * 4 + 3] = 255;
    for (let j = 0; j < channels; j++) {
      const offset = (i * channels + j) * size;
      const value =
        size === 1
          ? b.getUint8(offset)
          : type === "uint"
            ? Math.round(b.getUint16(offset, true) / 257)
            : byte(
                size === 2
                  ? half(b.getUint16(offset, true))
                  : b.getFloat32(offset, true),
              );
      const c =
        type === "bgra" || type === "bgr"
          ? j === 0
            ? 2
            : j === 2
              ? 0
              : j
          : type === "argb"
            ? (j + 3) % 4
            : j;
      out[i * 4 + c] = value;
    }
  }
  return out;
}
export function decodeSpecialPixels(
  data: Uint8Array,
  width: number,
  height: number,
  format: string,
) {
  const required = width * height * (format === "yuy2" ? 2 : 4);
  if (
    !Number.isSafeInteger(required) ||
    required <= 0 ||
    data.length < required ||
    (format === "yuy2" && width % 2)
  )
    throw Error("Invalid packed texture dimensions or length");
  const out = new Uint8Array(width * height * 4),
    view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  if (format === "rgb9e5float") {
    for (let i = 0; i < width * height; i++) {
      const n = view.getUint32(i * 4, true),
        scale = 2 ** ((n >>> 27) - 24) * 255;
      out[i * 4] = clamp((n & 511) * scale);
      out[i * 4 + 1] = clamp(((n >>> 9) & 511) * scale);
      out[i * 4 + 2] = clamp(((n >>> 18) & 511) * scale);
      out[i * 4 + 3] = 255;
    }
  } else
    for (let p = 0, o = 0; p < required; p += 4) {
      const d = data[p + 1] - 128,
        e = data[p + 3] - 128;
      for (const y of [data[p], data[p + 2]]) {
        const c = y - 16;
        out[o++] = clamp((298 * c + 409 * e + 128) >> 8);
        out[o++] = clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
        out[o++] = clamp((298 * c + 516 * d + 128) >> 8);
        out[o++] = 255;
      }
    }
  return out;
}
export function registerExtraTextureFormats() {
  for (const f of ["rgb9e5float", "yuy2"])
    DecoderManager.registerTextureDecoder(f, (d, w, h) =>
      decodeSpecialPixels(d, w, h, f),
    );
  for (const format of Object.keys(layouts))
    DecoderManager.registerTextureDecoder(format, (d, w, h) =>
      decodePackedPixels(d, w, h, format),
    );
  for (const [format, id] of Object.entries({
    bc4: 4,
    bc5: 5,
    bc6h: 6,
    pvrtc_rgb2: 12,
    pvrtc_rgba2: 12,
    pvrtc_rgb4: 14,
    pvrtc_rgba4: 14,
  }))
    DecoderManager.registerTextureDecoder(format, async (d, w, h) => {
      const rgba = await decodeExtraBlocks(d, w, h, id);
      if (format.startsWith("pvrtc_rgb") && !format.startsWith("pvrtc_rgba"))
        for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      return rgba;
    });
}
