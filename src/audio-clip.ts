import { NamedObject } from "../node_modules/unityfs-js/unityfs/classes/namedObject.js";
import { fsbAudio, unsupportedAudio } from "./audio-fsb.js";
import { compressedWav } from "./audio-codecs.js";
import { audioLimit } from "./audio-wav.js";

/** Unity AudioClip layout, including inline data and pre-5.x .resS offsets. */
export class AudioClip extends NamedObject {
  static exposedAttributes = [
    "name",
    "channels",
    "frequency",
    "bitsPerSample",
    "length",
    "subsoundIndex",
    "source",
    "offset",
    "size",
    "compressionFormat",
  ];
  source = "";
  offset = 0;
  size: number;
  data?: Uint8Array;
  legacyResource = false;
  subsoundIndex = 0;
  channels: number;
  frequency: number;
  bitsPerSample: number;
  length: number;
  compressionFormat: number;
  constructor(reader: any) {
    super(reader);
    if (reader.versionLT(5, 0)) {
      reader.readInt32(); // format
      if (reader.versionLT(2, 6))
        unsupportedAudio("Unity AudioClip before 2.6");
      reader.readInt32();
      reader.readBool();
      reader.readBool();
      reader.align(4);
      if (reader.versionGTE(3, 2)) reader.readInt32(); // stream
      this.size = reader.readInt32();
      if (
        reader.versionGTE(3, 2) &&
        reader.length - reader.offset !== Math.ceil(this.size / 4) * 4
      ) {
        this.offset = reader.readUInt32();
        this.source = ".resS";
        this.legacyResource = true;
      }
    } else {
      reader.readInt32();
      this.channels = reader.readInt32();
      this.frequency = reader.readInt32();
      this.bitsPerSample = reader.readInt32();
      this.length = reader.readFloat32();
      reader.readBool();
      reader.align(4);
      this.subsoundIndex = reader.readInt32();
      reader.readBool();
      reader.readBool();
      reader.readBool();
      reader.align(4);
      this.source = reader.readAlignedString();
      this.offset = Number(reader.readInt64());
      this.size = Number(reader.readInt64());
      this.compressionFormat = reader.readInt32();
    }
    if (
      !Number.isSafeInteger(this.size) ||
      this.size < 0 ||
      !Number.isSafeInteger(this.offset) ||
      this.offset < 0
    )
      throw Error("Invalid AudioClip resource range");
    if (!this.source) {
      if (reader.offset + this.size > reader.length)
        throw Error("Truncated inline AudioClip data");
      this.data = reader.read(this.size);
    }
  }
}
export async function convertAudio(
  obj: AudioClip,
  resolve: (p: string, o: number, s: number) => Uint8Array,
  format: "none" | "wav" | undefined,
  limit: number,
) {
  const data = obj.data ?? resolve(obj.source, obj.offset, obj.size);
  if (!data || data.length !== obj.size)
    throw Error("Missing or truncated AudioClip resource " + obj.source);
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let result: { data: Uint8Array; type: string };
  // Match the original CLI: WAV is the default; none preserves the whole
  // original payload (including an FSB bank), without selecting/re-encoding it.
  if (/^FSB[345]$/.test(b.toString("ascii", 0, 4)) && format === "none") {
    audioLimit(b.length, limit);
    return { data: b, type: "fsb" };
  }
  if (b.toString("ascii", 0, 4) === "FSB5")
    result = fsbAudio(b, obj.subsoundIndex, limit);
  else {
    const type =
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WAVE"
        ? "wav"
        : b.toString("ascii", 0, 4) === "OggS"
          ? "ogg"
          : b[0] === 255 && (b[1] & 0xf6) === 0xf0
            ? "aac"
            : b.toString("ascii", 0, 3) === "ID3" ||
                (b[0] === 255 && (b[1] & 0xe0) === 0xe0)
              ? "mp3"
              : b.toString("ascii", 4, 8) === "ftyp"
                ? "m4a"
                : b.toString("ascii", 0, 4) === "fLaC"
                  ? "flac"
                  : undefined;
    if (!type) unsupportedAudio("Unrecognized AudioClip payload");
    result = { data: b, type };
  }
  if (format !== "none" && result.type !== "wav") {
    if (result.type !== "ogg" && result.type !== "mp3")
      unsupportedAudio(result.type + " to WAV");
    result = {
      data: await compressedWav(
        result.data,
        result.type as "ogg" | "mp3",
        limit,
      ),
      type: "wav",
    };
  }
  audioLimit(result.data.length, limit);
  return result;
}
