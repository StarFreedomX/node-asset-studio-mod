export function audioLimit(size: number, limit: number) {
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > Math.min(limit, 0x7fffffff)
  )
    throw Object.assign(Error("Audio output exceeds maxOutputBytes"), {
      code: "LIMIT_EXCEEDED",
    });
}
export function audioInfo(channels: number, rate: number) {
  if (
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > 32 ||
    !Number.isInteger(rate) ||
    rate < 1 ||
    rate > 384000
  )
    throw Error("Invalid audio channel count or sample rate");
}
/** PCM is already interleaved and little endian; RIFF chunks include even-byte padding. */
export function wav(
  pcm: Uint8Array,
  channels: number,
  rate: number,
  bits: number,
  float: boolean,
  limit: number,
) {
  audioInfo(channels, rate);
  if (
    ![8, 16, 24, 32].includes(bits) ||
    (float && bits !== 32) ||
    pcm.length % ((channels * bits) / 8)
  )
    throw Error("Invalid PCM frame size");
  // WAVEFORMATEXTENSIBLE preserves multichannel layout and >16-bit precision.
  const extended = channels > 2 || bits > 16,
    fmtSize = extended ? 40 : 16;
  const factSize = float ? 12 : 0,
    start = 12 + 8 + fmtSize + factSize + 8;
  audioLimit(start + pcm.length + (pcm.length & 1), limit);
  const b = Buffer.alloc(start + pcm.length + (pcm.length & 1));
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(fmtSize, 16);
  b.writeUInt16LE(extended ? 0xfffe : float ? 3 : 1, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE((rate * channels * bits) / 8, 28);
  b.writeUInt16LE((channels * bits) / 8, 32);
  b.writeUInt16LE(bits, 34);
  if (extended) {
    b.writeUInt16LE(22, 36);
    b.writeUInt16LE(bits, 38);
    // FSB multichannel order: FL, FR, FC, LFE, BL, BR, SL, SR.
    const masks = {
      1: 4,
      2: 3,
      3: 7,
      4: 0x33,
      5: 0x37,
      6: 0x3f,
      7: 0x70f,
      8: 0x63f,
    };
    b.writeUInt32LE(masks[channels] ?? 0, 40);
    Buffer.from([
      float ? 3 : 1,
      0,
      0,
      0,
      0,
      0,
      16,
      0,
      128,
      0,
      0,
      170,
      0,
      56,
      155,
      113,
    ]).copy(b, 44);
  }
  if (float) {
    b.write("fact", start - 20);
    b.writeUInt32LE(4, start - 16);
    b.writeUInt32LE(pcm.length / ((channels * bits) / 8), start - 12);
  }
  b.write("data", start - 8);
  b.writeUInt32LE(pcm.length, start - 4);
  b.set(pcm, start);
  return b;
}
