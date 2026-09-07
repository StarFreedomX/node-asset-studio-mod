/** Unity PackedQuatVector has no bit-size byte (unlike PackedIntVector). */
export class PackedQuaternionVector {
  static exposedAttributes = ["length"];
  length: number;
  data: Uint8Array;
  constructor(reader: any) {
    this.length = reader.readUInt32();
    const size = reader.readUInt32();
    this.data = reader.read(size);
    reader.align(4);
    if (
      this.length > 1e6 ||
      this.data.length !== size ||
      this.length * 4 > size
    )
      throw Error("Truncated packed quaternions");
  }
}
function bitReader(data: Uint8Array) {
  let position = 0;
  return (bits: number) => {
    if (
      !Number.isInteger(bits) ||
      bits < 0 ||
      bits > 32 ||
      position + bits > data.length * 8
    )
      throw Error("Truncated packed animation");
    let value = 0;
    for (let i = 0; i < bits; i++, position++)
      value += ((data[position >>> 3] >>> (position & 7)) & 1) * 2 ** i;
    return value;
  };
}
export function packedIntegers(v: {
  length: number;
  bitSize: number;
  data: Uint8Array;
}): number[] {
  if (!Number.isSafeInteger(v.length) || v.length < 0 || v.length > 1e6)
    throw Error("Invalid packed integer count");
  const read = bitReader(v.data);
  return Array.from({ length: v.length }, () => read(v.bitSize));
}
export function packedQuaternions(v: {
  length: number;
  data: Uint8Array;
}): number[][] {
  if (!Number.isSafeInteger(v.length) || v.length < 0 || v.length > 1e6)
    throw Error("Invalid packed quaternion count");
  const read = bitReader(v.data);
  return Array.from({ length: v.length }, () => {
    const flags = read(3),
      missing = flags & 3,
      q = [0, 0, 0, 0];
    let sum = 0;
    for (let i = 0; i < 4; i++)
      if (i !== missing) {
        const bits = i === (missing + 1) % 4 ? 9 : 10;
        q[i] = read(bits) / (0.5 * (2 ** bits - 1)) - 1;
        sum += q[i] ** 2;
      }
    if (sum > 1.01) throw Error("Invalid packed quaternion");
    q[missing] = Math.sqrt(Math.max(0, 1 - sum)) * (flags & 4 ? -1 : 1);
    return q;
  });
}
export function slerp(a: number[], b: number[], t: number): number[] {
  let dot = a.reduce((v, x, i) => v + x * b[i], 0);
  if (dot < 0) {
    b = b.map((v) => -v);
    dot = -dot;
  }
  if (dot > 0.9995) {
    const q = a.map((v, i) => v + (b[i] - v) * t),
      length = Math.hypot(...q);
    return q.map((v) => v / length);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot))),
    sin = Math.sin(theta);
  return a.map(
    (v, i) =>
      (v * Math.sin((1 - t) * theta) + b[i] * Math.sin(t * theta)) / sin,
  );
}
