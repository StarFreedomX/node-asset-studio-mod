// Layouts follow AssetStudioMod v0.19.0 (MIT); see vendor/assetstudio/LICENSE.
import { Texture } from "../node_modules/unityfs-js/unityfs/classes/texture.js";
import { PPtr } from "../node_modules/unityfs-js/unityfs/classes/pptr.js";
import {
  StreamingInfo,
  GLTextureSettings,
} from "../node_modules/unityfs-js/unityfs/classes/texture2d/model.js";

function take(reader: any, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    reader.offset + length > reader.length
  )
    throw Error("Truncated asset payload");
  return reader.read(length);
}
export class Texture2DArray extends Texture {
  static exposedAttributes = [
    "name",
    "width",
    "height",
    "depth",
    "format",
    "mipCount",
    "dataSize",
    "streamData",
  ];
  width: number;
  height: number;
  depth: number;
  format: number;
  mipCount: number;
  dataSize: number;
  colorSpace: number;
  textureSettings: any;
  streamData: any;
  data: Uint8Array;
  constructor(reader: any) {
    super(reader);
    if (reader.versionGTE(2019, 0)) {
      this.colorSpace = reader.readInt32();
      this.format = reader.readInt32();
    }
    this.width = reader.readInt32();
    this.height = reader.readInt32();
    this.depth = reader.readInt32();
    if (reader.versionLT(2019, 0)) this.format = reader.readInt32();
    this.mipCount = reader.readInt32();
    if (reader.versionGTE(2023, 2)) reader.readInt32(); // mips stripped
    this.dataSize = reader.readUInt32();
    this.textureSettings = new GLTextureSettings(reader);
    if (reader.versionLT(2019, 0)) this.colorSpace = reader.readInt32();
    if (reader.versionGTE(2020, 2)) reader.readInt32(); // usage mode
    reader.readBool(); // is readable
    if (reader.versionGTE(2023, 3)) {
      reader.readBool();
      reader.align(4);
      reader.readAlignedString();
    } else reader.align(4);
    const length = reader.readInt32();
    if (length === 0 && reader.versionGTE(5, 6))
      this.streamData = new StreamingInfo(reader);
    this.data = take(reader, length);
  }
}
export class MovieTexture extends Texture {
  static exposedAttributes = ["name", "loop", "audioClip"];
  loop: boolean;
  audioClip: any;
  movieData: Uint8Array;
  constructor(reader: any) {
    super(reader);
    if (reader.versionGTE(2019, 3))
      throw Error(
        "MovieTexture payload was removed in Unity 2019.3; use VideoClip",
      );
    this.loop = reader.readBool();
    reader.align(4);
    this.audioClip = new PPtr(reader);
    this.movieData = take(reader, reader.readInt32());
  }
}
