import { audioInfo, audioLimit, wav } from "./audio-wav.js";
import { rebuildVorbis } from "../node_modules/unityfs-js/fsb5/vorbis.js";
import { decodeIma, decodeFadpcm } from "./audio-adpcm.js";
export interface FsbSample {
  data: Buffer;
  channels: number;
  frequency: number;
  samples: number;
  metadata: Record<number, any>;
}
export function parseFsb(
  data: Uint8Array,
  index: number,
): { format: number; flags: number; sample: FsbSample } {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (b.length < 60 || b.toString("ascii", 0, 4) !== "FSB5")
    throw Error("Invalid FSB5 header");
  const version = b.readUInt32LE(4),
    count = b.readUInt32LE(8),
    headers = b.readUInt32LE(12),
    names = b.readUInt32LE(16),
    size = b.readUInt32LE(20),
    format = b.readUInt32LE(24);
  if (version > 1) throw Error("Unsupported FSB5 version " + version);
  const start = version === 0 ? 64 : 60,
    end = start + headers,
    payload = end + names;
  if (payload + size > b.length || count < 1 || count > headers / 8)
    throw Error("Truncated FSB5 header or payload");
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw Error("AudioClip subsoundIndex is outside the FSB bank");
  const samples: (FsbSample & { offset: number })[] = [];
  const rates = [
    4000, 8000, 11000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 96000,
  ];
  let p = start;
  for (let i = 0; i < count; i++) {
    if (p + 8 > end) throw Error("Truncated FSB sample header");
    const raw = b.readBigUInt64LE(p);
    p += 8;
    const s = {
      channels: [1, 2, 6, 8][Number((raw >> 5n) & 3n)],
      frequency: rates[Number((raw >> 1n) & 15n)],
      offset: Number((raw >> 7n) & 0x7ffffffn) * 32,
      samples: Number(raw >> 34n),
      metadata: {} as Record<number, any>,
      data: null as Buffer,
    };
    let next = Number(raw & 1n);
    while (next) {
      if (p + 4 > end) throw Error("Truncated FSB metadata");
      const h = b.readUInt32LE(p),
        length = (h >>> 1) & 0xffffff,
        type = h >>> 25;
      next = h & 1;
      p += 4;
      if (p + length > end) throw Error("Truncated FSB metadata payload");
      const chunk = b.subarray(p, p + length);
      p += length;
      if (s.metadata[type] !== undefined)
        throw Error("Duplicate FSB metadata " + type);
      s.metadata[type] = chunk;
      if (type === 1) {
        if (length !== 1) throw Error("Invalid FSB channels metadata");
        s.channels = chunk[0];
      } else if (type === 2) {
        if (length !== 4) throw Error("Invalid FSB frequency metadata");
        s.frequency = chunk.readUInt32LE();
      } else if (type === 11) {
        if (length < 4) throw Error("Invalid FSB Vorbis metadata");
        s.metadata[type] = {
          crc32: chunk.readUInt32LE(),
          unknown: chunk.subarray(4),
        };
      }
    }
    audioInfo(s.channels, s.frequency);
    if (s.offset > size || (i && s.offset < samples[i - 1].offset))
      throw Error("Invalid FSB sample offset");
    samples.push(s);
  }
  // Name tables start at the declared boundary, not the last parsed sample.
  if (names) {
    if (names < count * 4) throw Error("Truncated FSB name table");
    for (let i = 0; i < count; i++) {
      const offset = b.readUInt32LE(end + i * 4);
      if (
        offset < count * 4 ||
        offset >= names ||
        b.indexOf(0, end + offset) < 0 ||
        b.indexOf(0, end + offset) >= payload
      )
        throw Error("Invalid FSB sample name");
    }
  }
  const sample = samples[index];
  sample.data = b.subarray(
    payload + sample.offset,
    payload + (samples[index + 1]?.offset ?? size),
  );
  return { format, flags: version === 1 ? b.readUInt32LE(32) : 0, sample };
}
export function fsbAudio(
  data: Uint8Array,
  index: number,
  limit: number,
): { data: Uint8Array; type: "wav" | "mp3" | "ogg" } {
  const { sample: s, format, flags } = parseFsb(data, index);
  if (flags && !(format === 2 && flags === 1))
    unsupportedAudio("FSB layout flags " + flags);
  if (format >= 1 && format <= 5) {
    const bits = [0, 8, 16, 24, 32, 32][format],
      size = (s.samples * s.channels * bits) / 8;
    if (size > s.data.length) throw Error("Truncated FSB PCM samples");
    let pcm = s.data.subarray(0, size);
    if (flags & 1) {
      audioLimit(size + (s.channels > 2 ? 68 : 44), limit);
      pcm = Buffer.from(pcm).swap16();
    }
    return {
      data: wav(pcm, s.channels, s.frequency, bits, format === 5, limit),
      type: "wav",
    };
  }
  if (format === 7 || format === 16) {
    audioLimit(s.samples * s.channels * 2 + (s.channels > 2 ? 68 : 44), limit);
    const pcm = format === 7 ? decodeIma(s) : decodeFadpcm(s);
    return {
      data: wav(pcm, s.channels, s.frequency, 16, false, limit),
      type: "wav",
    };
  }
  if (format === 11) {
    if (s.channels > 2) unsupportedAudio("Multistream FSB MPEG");
    audioLimit(s.data.length, limit);
    return { data: fsbMpeg(s.data), type: "mp3" };
  }
  if (format === 15) {
    // FSB packets end at a zero size marker; bank alignment is not audio.
    let p = 0;
    while (p + 2 <= s.data.length) {
      const length = s.data.readUInt16LE(p);
      if (!length) break;
      if (p + 2 + length > s.data.length)
        throw Error("Truncated FSB Vorbis packet");
      p += 2 + length;
    }
    if (!p) throw Error("Empty FSB Vorbis stream");
    const ogg = rebuildVorbis({ ...s, data: s.data.subarray(0, p) });
    audioLimit(ogg.length, limit);
    return { data: ogg, type: "ogg" };
  }
  unsupportedAudio("FSB codec " + format);
}

/** FSB pads MPEG frames to four bytes and the last subsound to 32 bytes.
 * Remove container padding using frame lengths; trimming zero bytes would
 * also remove valid audio bits at the end of a frame. */
function fsbMpeg(b: Buffer): Buffer {
  const parts: Buffer[] = [];
  let p = 0;
  if (b.toString("ascii", 0, 3) === "ID3") {
    if (b.length < 10 || b.subarray(6, 10).some((v) => v > 127))
      throw Error("Invalid MPEG ID3 header");
    p =
      10 +
      (b[6] * 0x200000 + b[7] * 0x4000 + b[8] * 128 + b[9]) +
      (b[5] & 16 ? 10 : 0);
    if (p > b.length) throw Error("Truncated MPEG ID3 tag");
    parts.push(b.subarray(0, p));
  }
  const sync = (offset: number) =>
    offset + 4 <= b.length &&
    b[offset] === 255 &&
    (b[offset + 1] & 0xe0) === 0xe0;
  let frames = 0;
  while (p < b.length) {
    if (b.length - p <= 31 && b.subarray(p).every((v) => v === 0)) break;
    if (!sync(p)) {
      const aligned = Math.ceil(p / 4) * 4;
      if (
        aligned > p &&
        b.subarray(p, aligned).every((v) => v === 0) &&
        sync(aligned)
      )
        p = aligned;
      else throw Error("Invalid FSB MPEG frame boundary");
    }
    const version = (b[p + 1] >>> 3) & 3,
      layer = (b[p + 1] >>> 1) & 3;
    if (version === 1 || layer !== 1)
      unsupportedAudio("FSB MPEG layer/version");
    const rateIndex = (b[p + 2] >>> 2) & 3,
      bitrateIndex = b[p + 2] >>> 4;
    const bitrates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const bitrate = bitrates[bitrateIndex],
      rate =
        [44100, 48000, 32000][rateIndex] /
        (version === 3 ? 1 : version === 2 ? 2 : 4);
    if (!bitrate || !rate) unsupportedAudio("FSB MPEG free/reserved bitrate");
    const length =
      Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / rate) +
      ((b[p + 2] >>> 1) & 1);
    if (p + length > b.length) throw Error("Truncated FSB MPEG frame");
    parts.push(b.subarray(p, p + length));
    p += length;
    frames++;
  }
  if (!frames) throw Error("Empty FSB MPEG stream");
  return Buffer.concat(parts);
}
export function unsupportedAudio(type: string): never {
  throw Object.assign(
    Error(type + " conversion is not supported by the JS audio decoder"),
    { code: "UNSUPPORTED_OPERATION" },
  );
}
