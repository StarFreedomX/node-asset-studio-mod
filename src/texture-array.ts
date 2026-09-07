import { graphicsFormats } from "./graphics-formats.js";
import type { TextureJob } from "./texture-engine.js";

export function textureLevelSize(
  format: string,
  width: number,
  height: number,
): number {
  const bpp: Record<string, number> = {
    R8: 1,
    Alpha8: 1,
    RG16: 2,
    R16: 2,
    RGB565: 2,
    ARGB4444: 2,
    RGBA4444: 2,
    RGB24: 3,
    BGR24: 3,
    RGBA32: 4,
    ARGB32: 4,
    BGRA32: 4,
    RG32: 4,
    RGB48: 6,
    RGBA64: 8,
    RHalf: 2,
    RGHalf: 4,
    RGBHalf: 6,
    RGBAHalf: 8,
    RFloat: 4,
    RGFloat: 8,
    RGBFloat: 12,
    RGBAFloat: 16,
    RGB9e5Float: 4,
    YUY2: 2,
  };
  if (bpp[format]) return width * height * bpp[format];
  const astc = format.match(/ASTC_RGBA_(\d+)x(\d+)/);
  if (astc)
    return (
      Math.ceil(width / Number(astc[1])) *
      Math.ceil(height / Number(astc[2])) *
      16
    );
  if (/PVRTC_.*2$/.test(format))
    return (Math.max(width, 16) * Math.max(height, 8)) / 4;
  if (/PVRTC_.*4$/.test(format))
    return (Math.max(width, 8) * Math.max(height, 8)) / 2;
  if (
    [
      "DXT1",
      "BC4",
      "ETC_RGB4",
      "ETC2_RGB",
      "ETC2_RGBA1",
      "EAC_R",
      "EAC_R_SIGNED",
    ].includes(format)
  )
    return Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
  if (
    [
      "DXT3",
      "DXT5",
      "BC5",
      "BC6H",
      "BC7",
      "ETC2_RGBA8",
      "EAC_RG",
      "EAC_RG_SIGNED",
    ].includes(format)
  )
    return Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
  throw Error("Unknown texture layout " + format);
}
export function textureArrayLayers(
  texture: any,
  resolve: (p: string, o: number, s: number) => Uint8Array,
  maxPixels: number,
): TextureJob[] {
  const { width, height, depth, mipCount, dataSize } = texture;
  if (
    ![width, height, depth, mipCount].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    width * height > maxPixels ||
    depth > 65536 ||
    mipCount > 32
  )
    throw Object.assign(
      Error("Invalid or excessive texture array dimensions"),
      { code: "LIMIT_EXCEEDED" },
    );
  const format = graphicsFormats[texture.format];
  if (!format)
    throw Object.assign(Error("Unsupported GraphicsFormat " + texture.format), {
      code: "UNSUPPORTED_OPERATION",
    });
  const data = texture.data?.length
    ? texture.data
    : texture.streamData
      ? resolve(
          texture.streamData.path,
          texture.streamData.offset,
          texture.streamData.size,
        )
      : null;
  if (!data) throw Error("Missing texture array resource data");
  if (
    !Number.isSafeInteger(dataSize) ||
    dataSize <= 0 ||
    dataSize % depth ||
    data.length < dataSize
  )
    throw Error("Invalid texture array data size");
  const stride = dataSize / depth,
    baseSize = textureLevelSize(format, width, height);
  let required = 0;
  for (let i = 0; i < mipCount; i++)
    required += textureLevelSize(
      format,
      Math.max(1, Math.floor(width / 2 ** i)),
      Math.max(1, Math.floor(height / 2 ** i)),
    );
  if (stride < required) throw Error("Truncated texture array mip chain");
  return Array.from({ length: depth }, (_, i) => ({
    data: data.subarray(i * stride, i * stride + baseSize),
    width,
    height,
    format,
    version: texture.reader.version,
  }));
}
