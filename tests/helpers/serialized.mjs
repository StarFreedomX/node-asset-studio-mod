// Independent Unity serialized-file v17 fixture writer (no TypeTree, little endian).
export class Writer {
  chunks = [];
  length = 0;
  bytes(b) {
    this.chunks.push(Buffer.from(b));
    this.length += b.length;
    return this;
  }
  u8(n) {
    return this.bytes(Buffer.from([n]));
  }
  i16(n) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(n);
    return this.bytes(b);
  }
  i32(n) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    return this.bytes(b);
  }
  i64(n) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(n));
    return this.bytes(b);
  }
  float(n) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(n);
    return this.bytes(b);
  }
  align(n = 4) {
    return this.bytes(Buffer.alloc((n - (this.length % n)) % n));
  }
  str(s) {
    const b = Buffer.from(s);
    return this.i32(b.length).bytes(b).align();
  }
  end() {
    return Buffer.concat(this.chunks);
  }
}
export function serialized(objects, version = "2022.3.62f1") {
  const classes = [...new Set(objects.map((o) => o.type))],
    meta = new Writer(),
    payload = new Writer();
  meta
    .bytes(Buffer.from(version + "\0"))
    .i32(13)
    .u8(0)
    .i32(classes.length);
  for (const type of classes) {
    meta.i32(type).u8(0).i16(-1);
    if (type === 114) meta.bytes(Buffer.alloc(16));
    meta.bytes(Buffer.alloc(16));
  }
  meta.i32(objects.length);
  for (const [i, obj] of objects.entries()) {
    payload.align(8);
    meta
      .align()
      .i64(obj.id ?? i + 1)
      .i32(payload.length)
      .i32(obj.data.length)
      .i32(classes.indexOf(obj.type));
    payload.bytes(obj.data);
  }
  meta.i32(0).i32(0).u8(0);
  const offset = 20 + meta.length,
    header = Buffer.alloc(20);
  [meta.length, offset + payload.length, 17, offset, 0].forEach((n, i) =>
    header.writeUInt32BE(n, i * 4),
  );
  return Buffer.concat([header, meta.end(), payload.end()]);
}
export function textureArray({
  data,
  version = 2022,
  width = 2,
  height = 2,
  depth = 2,
  format = 8,
  mips = 1,
  dataSize = data.length,
  stream,
} = {}) {
  const b = new Writer().str("array");
  if (version >= 2017) {
    b.i32(0).u8(0);
    if (version >= 2020) b.u8(0);
    b.align();
  }
  if (version >= 2019) b.i32(0).i32(format);
  b.i32(width).i32(height).i32(depth);
  if (version < 2019) b.i32(format);
  b.i32(mips).i32(dataSize).i32(0).i32(1).float(0).i32(0);
  if (version >= 2017) b.i32(0).i32(0);
  if (version < 2019) b.i32(0);
  if (version >= 2020) b.i32(0);
  b.u8(1)
    .align()
    .i32(stream ? 0 : data.length);
  if (stream) {
    if (version >= 2020) b.i64(stream.offset ?? 0);
    else b.i32(stream.offset ?? 0);
    b.i32(stream.size ?? dataSize).str(stream.path);
  } else b.bytes(data);
  return b.end();
}
