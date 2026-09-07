import { Writer, serialized } from "./serialized.mjs";
export function audioClip(
  data,
  { index = 0, resource, version = "2022.3.62f1", name = "sound" } = {},
) {
  const w = new Writer().str(name);
  if (Number(version.split(".")[0]) < 5) {
    w.i32(0).i32(20).u8(0).u8(0).align().i32(0).i32(data.length);
    if (resource) w.i32(resource.offset ?? 0);
    else w.bytes(data).align();
  } else {
    w.i32(0)
      .i32(2)
      .i32(48000)
      .i32(16)
      .float(0.1)
      .u8(0)
      .align()
      .i32(index)
      .u8(1)
      .u8(0)
      .u8(0)
      .align()
      .str(resource?.path ?? "")
      .i64(resource?.offset ?? 0)
      .i64(data.length)
      .i32(0);
    if (!resource) w.bytes(data);
  }
  return serialized([{ type: 83, data: w.end() }], version);
}
/** Independent FSB5 writer with explicit bit fields and 32-byte bank alignment. */
export function fsb(
  format,
  entries,
  { version = 1, names = false, headerPadding = 0 } = {},
) {
  const h = Buffer.alloc(version === 0 ? 64 : 60),
    headers = [],
    chunks = [];
  let offset = 0;
  for (const s of entries) {
    const extra = s.metadata ?? [];
    const channelMode = { 1: 0, 2: 1, 6: 2, 8: 3 }[s.channels ?? 1];
    const raw =
      BigInt(s.samples) * 2n ** 34n +
      BigInt(offset / 32) * 128n +
      BigInt(channelMode) * 32n +
      BigInt(s.rateIndex ?? 9) * 2n +
      BigInt(!!extra.length);
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(raw);
    headers.push(b);
    extra.forEach(([type, data], i) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(
        (type * 2 ** 25 + data.length * 2 + (i + 1 < extra.length ? 1 : 0)) >>>
          0,
      );
      headers.push(b, data);
    });
    const size = Math.ceil(s.data.length / 32) * 32;
    chunks.push(s.data, Buffer.alloc(size - s.data.length));
    offset += size;
  }
  const hs = Buffer.concat([...headers, Buffer.alloc(headerPadding)]),
    nt = new Writer();
  if (names) {
    for (let i = 0; i < entries.length; i++) nt.i32(entries.length * 4 + i * 2);
    entries.forEach((_, i) => nt.bytes(Buffer.from([65 + i, 0])));
  }
  h.write("FSB5");
  [version, entries.length, hs.length, nt.length, offset, format].forEach(
    (v, i) => h.writeUInt32LE(v, 4 + i * 4),
  );
  return Buffer.concat([h, hs, nt.end(), ...chunks]);
}
export function parseWav(data) {
  const b = Buffer.from(data),
    result = {};
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE" ||
    b.readUInt32LE(4) !== b.length - 8
  )
    throw Error("Invalid WAV");
  for (let p = 12; p + 8 <= b.length; ) {
    const type = b.toString("ascii", p, p + 4),
      size = b.readUInt32LE(p + 4);
    if (p + 8 + size > b.length) throw Error("Truncated WAV");
    const v = b.subarray(p + 8, p + 8 + size);
    if (type === "fmt ") {
      result.format = v.readUInt16LE();
      result.channels = v.readUInt16LE(2);
      result.rate = v.readUInt32LE(4);
      result.bits = v.readUInt16LE(14);
      if (result.format === 65534) {
        result.mask = v.readUInt32LE(20);
        result.format = v.readUInt16LE(24);
      }
    } else if (type === "data") result.pcm = v;
    p += 8 + size + (size & 1);
  }
  return result;
}
