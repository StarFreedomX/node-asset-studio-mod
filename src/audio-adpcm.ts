// FSB layouts / FADPCM arithmetic adapted from vgmstream (ISC).
// See vendor/audio/LICENSE-vgmstream and README.md for pinned source references.
import type { FsbSample } from "./audio-fsb.js";
const steps = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];
const changes = [-1, -1, -1, -1, 2, 4, 6, 8];
const clamp = (v: number) => Math.max(-32768, Math.min(32767, v));
export function decodeIma(s: FsbSample): Buffer {
  const { data: b, channels: ch, samples } = s,
    blocks = Math.ceil(samples / 64);
  if (b.length < blocks * 36 * ch) throw Error("Truncated FSB IMA block");
  const out = Buffer.alloc(samples * ch * 2);
  for (let block = 0; block < blocks; block++) {
    const base = block * 36 * ch;
    for (let c = 0; c < ch; c++) {
      let history = b.readInt16LE(base + (ch > 2 ? c * 2 : c * 4));
      let index = b[base + (ch > 2 ? ch * 2 + c * 2 : c * 4 + 2)];
      if (index > 88) throw Error("Invalid IMA step index");
      for (let i = 0; i < Math.min(64, samples - block * 64); i++) {
        if (i) {
          const n = i - 1,
            group = ch > 2 ? 4 : 8;
          const offset =
            base +
            ch * 4 +
            Math.floor(n / group) * (group / 2) * ch +
            c * (group / 2) +
            Math.floor((n % group) / 2);
          const nibble = (b[offset] >>> ((n & 1) * 4)) & 15,
            step = steps[index];
          // Separate shifts preserve the reference IMA integer rounding.
          const delta =
            (step >> 3) +
            (nibble & 1 ? step >> 2 : 0) +
            (nibble & 2 ? step >> 1 : 0) +
            (nibble & 4 ? step : 0);
          history = clamp(history + (nibble & 8 ? -delta : delta));
          index = Math.max(0, Math.min(88, index + changes[nibble & 7]));
        }
        out.writeInt16LE(history, ((block * 64 + i) * ch + c) * 2);
      }
    }
  }
  return out;
}
export function decodeFadpcm(s: FsbSample): Buffer {
  const { data: b, channels: ch, samples } = s,
    blocks = Math.ceil(samples / 256);
  if (b.length < blocks * 140 * ch) throw Error("Truncated FADPCM block");
  const out = Buffer.alloc(samples * ch * 2),
    coefs = [
      [0, 0],
      [60, 0],
      [122, 60],
      [115, 52],
      [98, 55],
      [0, 0],
      [0, 0],
    ];
  for (let block = 0; block < blocks; block++)
    for (let c = 0; c < ch; c++) {
      const base = (block * ch + c) * 140,
        predictors = b.readUInt32LE(base),
        shifts = b.readUInt32LE(base + 4);
      let h1 = b.readInt16LE(base + 8),
        h2 = b.readInt16LE(base + 10);
      for (let i = 0; i < Math.min(256, samples - block * 256); i++) {
        const set = Math.floor(i / 32),
          [a, d] = coefs[((predictors >>> (set * 4)) & 15) % 7];
        const shift = (shifts >>> (set * 4)) & 15;
        const n = (b[base + 12 + Math.floor(i / 2)] >>> ((i & 1) * 4)) & 15;
        const sample = clamp(
          (((n << 28) >> (22 - shift)) - h2 * d + h1 * a) >> 6,
        );
        h2 = h1;
        h1 = sample;
        out.writeInt16LE(sample, ((block * 256 + i) * ch + c) * 2);
      }
    }
  return out;
}
