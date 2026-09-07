import { registerExtraTextureFormats } from "./texture-formats.js";
registerExtraTextureFormats();
import { DecoderManager } from "../node_modules/unityfs-js/decoders/DecoderManager.js";
import { rgbaToPng } from "../node_modules/unityfs-js/unityfs/classes/texture2d/reader.js";
import { decodeAstcRgba } from "./texture-codecs.js";
export interface TextureJob {
  data: Uint8Array;
  width: number;
  height: number;
  format: string;
  version: number[];
}
for (const block of [4, 5, 6, 8, 10, 12])
  for (const channels of ["rgb", "rgba"])
    DecoderManager.registerTextureDecoder(
      `astc_${channels}_${block}x${block}`,
      (data, width, height) => decodeAstcRgba(data, width, height, block),
    );
export async function convertTexture(job: TextureJob): Promise<Uint8Array> {
  const rgba = await DecoderManager.decodeTexture(
    job.data,
    job.width,
    job.height,
    job.format,
    { worker: false, version: job.version },
  );
  if (!rgba) throw Error("Texture decoder returned no pixels");
  const png = await rgbaToPng({
    rgbaData: rgba,
    width: job.width,
    height: job.height,
    encoder: "wasm",
    type: "uint8Array",
  });
  return Uint8Array.from(png.raw);
}

export { decodePackedPixels, decodeSpecialPixels } from "./texture-formats.js";
