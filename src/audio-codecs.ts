import createAudioModule from "../vendor/audio/decoder.js";
import { audioInfo, audioLimit, wav } from "./audio-wav.js";
let decoder: Promise<any> | undefined;

/** Decode in bounded blocks. No subprocess, filesystem, or external codec download. */
export async function compressedWav(
  data: Uint8Array,
  type: "mp3" | "ogg",
  limit: number,
) {
  const ogg = type === "ogg" ? validateOgg(data) : undefined;
  if (ogg)
    audioLimit(
      ogg.samples * ogg.channels * 2 + (ogg.channels > 2 ? 68 : 44),
      limit,
    );
  if (data.length > 0x7fffffff)
    throw Error("Compressed audio exceeds WASM input range");
  const m = await (decoder ??= createAudioModule());
  let input = 0,
    output = 0,
    handle = 0;
  try {
    input = m._malloc(data.length);
    if (!input) throw Error("Could not allocate compressed audio");
    m.HEAPU8.set(data, input);
    handle = m._audio_open(input, data.length, type === "mp3" ? 1 : 2);
    if (!handle) throw Error("Invalid or unsupported " + type + " audio");
    const channels = m._audio_channels(handle),
      rate = m._audio_rate(handle),
      frames = 4096;
    audioInfo(channels, rate);
    const order = ogg
      ? {
          1: [0],
          2: [0, 1],
          3: [0, 2, 1],
          4: [0, 1, 2, 3],
          5: [0, 2, 1, 3, 4],
          6: [0, 2, 1, 5, 3, 4],
          7: [0, 2, 1, 6, 5, 3, 4],
          8: [0, 2, 1, 7, 5, 6, 3, 4],
        }[channels]
      : undefined;
    if (ogg && !order)
      throw Object.assign(
        Error("Vorbis channel layout above 8 channels is not supported"),
        { code: "UNSUPPORTED_OPERATION" },
      );
    if (ogg && (channels !== ogg.channels || rate !== ogg.rate))
      throw Error("Vorbis header mismatch");
    output = m._malloc(frames * channels * 2);
    if (!output) throw Error("Could not allocate decoded audio");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const count = m._audio_read(handle, output, frames);
      if (count < 0 || count > frames)
        throw Error("Corrupt " + type + " audio");
      if (!count) break;
      const bytes = count * channels * 2;
      size += bytes;
      audioLimit(size + (channels > 2 ? 68 : 44), limit);
      const chunk = Buffer.from(m.HEAPU8.slice(output, output + bytes));
      if (order && channels > 2) {
        const frame = new Int16Array(channels);
        for (let i = 0; i < count; i++) {
          for (let c = 0; c < channels; c++)
            frame[c] = chunk.readInt16LE((i * channels + c) * 2);
          for (let c = 0; c < channels; c++)
            chunk.writeInt16LE(frame[order[c]], (i * channels + c) * 2);
        }
      }
      chunks.push(chunk);
    }
    if (!size) throw Error("Empty decoded audio");
    if (ogg && size !== ogg.samples * channels * 2)
      throw Error("Vorbis decoded sample count does not match its end marker");
    return wav(Buffer.concat(chunks), channels, rate, 16, false, limit);
  } finally {
    if (handle) m._audio_close(handle);
    if (output) m._free(output);
    if (input) m._free(input);
  }
}

// Reject truncated pages, chained streams, and CRC corruption before libvorbis
// can treat a damaged stream as a successful short decode.
export function validateOgg(data: Uint8Array) {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let p = 0,
    serial: number | undefined,
    sequence = 0,
    eos = false,
    channels = 0,
    rate = 0,
    samples = 0;
  const pages: number[] = [];
  while (p < b.length) {
    if (
      eos ||
      p + 27 > b.length ||
      b.toString("ascii", p, p + 4) !== "OggS" ||
      b[p + 4] !== 0
    )
      throw Error("Invalid or chained Ogg stream");
    const n = b[p + 26],
      header = p + 27 + n;
    if (header > b.length) throw Error("Truncated Ogg page");
    let end = header;
    for (let i = p + 27; i < header; i++) end += b[i];
    if (end > b.length) throw Error("Truncated Ogg packet");
    if (p === 0) {
      if (
        end - header < 30 ||
        b[header] !== 1 ||
        b.toString("ascii", header + 1, header + 7) !== "vorbis"
      )
        throw Object.assign(Error("Ogg payload is not Vorbis"), {
          code: "UNSUPPORTED_OPERATION",
        });
      channels = b[header + 11];
      rate = b.readUInt32LE(header + 12);
      audioInfo(channels, rate);
    }
    const s = b.readUInt32LE(p + 14);
    if (serial !== undefined && serial !== s)
      throw Error("Multiplexed Ogg is not supported");
    if (b.readUInt32LE(p + 18) !== sequence++ || (p === 0 && !(b[p + 5] & 2)))
      throw Error("Invalid Ogg page sequence");
    serial = s;
    let crc = 0;
    for (let i = p; i < end; i++) {
      crc ^= (i >= p + 22 && i < p + 26 ? 0 : b[i]) << 24;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
    }
    if (crc >>> 0 !== b.readUInt32LE(p + 22))
      throw Error("Ogg checksum mismatch");
    eos = !!(b[p + 5] & 4);
    if (eos) {
      samples = Number(b.readBigUInt64LE(p + 6));
      if (!Number.isSafeInteger(samples))
        throw Error("Invalid Ogg sample count");
    }
    p = end;
    pages.push(end);
  }
  if (!eos) throw Error("Missing Ogg end-of-stream page");
  return { pages, channels, rate, samples };
}
