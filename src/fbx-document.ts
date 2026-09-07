import { inflateSync } from "node:zlib";
export interface FbxNode {
  name: string;
  properties: Buffer[];
  children: FbxNode[];
  terminal: boolean;
}
export interface FbxDocument {
  nodes: FbxNode[];
  footer: Buffer;
}
const scalarSizes: Record<string, number> = {
  Y: 2,
  C: 1,
  I: 4,
  F: 4,
  D: 8,
  L: 8,
};
export function parseFbx(input: Uint8Array): FbxDocument {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (
    b.length < 52 ||
    b.toString("ascii", 0, 20) !== "Kaydara FBX Binary  " ||
    b.readUInt32LE(23) !== 7500
  )
    throw Error("Expected binary FBX 7.5");
  let nodeCount = 0;
  function node(at: number, limit: number, depth: number): [FbxNode, number] {
    if (depth > 100 || ++nodeCount > 1e6 || at + 25 > limit)
      throw Error("Invalid FBX nesting");
    const end = Number(b.readBigUInt64LE(at)),
      count = Number(b.readBigUInt64LE(at + 8)),
      size = Number(b.readBigUInt64LE(at + 16)),
      nameSize = b[at + 24];
    let p = at + 25;
    const name = b.toString("utf8", p, p + nameSize);
    p += nameSize;
    const propsEnd = p + size;
    if (
      !Number.isSafeInteger(end) ||
      end <= at ||
      end > limit ||
      !Number.isSafeInteger(size) ||
      propsEnd > end ||
      count > size
    )
      throw Error("Invalid FBX bounds");
    const properties: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const start = p,
        type = String.fromCharCode(b[p++]);
      if (scalarSizes[type]) p += scalarSizes[type];
      else if (type === "S" || type === "R") {
        if (p + 4 > propsEnd) throw Error("Truncated FBX property");
        p += 4 + b.readUInt32LE(p);
      } else if ("fdlibc".includes(type)) {
        if (p + 12 > propsEnd) throw Error("Truncated FBX array");
        p += 12 + b.readUInt32LE(p + 8);
      } else throw Error("Unknown FBX property " + type);
      if (p > propsEnd) throw Error("Truncated FBX property");
      properties.push(Buffer.from(b.subarray(start, p)));
    }
    if (p !== propsEnd) throw Error("FBX property count mismatch");
    const children: FbxNode[] = [];
    let terminal = false;
    while (p < end) {
      if (p + 25 === end && b.subarray(p, end).every((v) => v === 0)) {
        terminal = true;
        p = end;
        break;
      }
      const [child, next] = node(p, end, depth + 1);
      children.push(child);
      p = next;
    }
    return [{ name, properties, children, terminal }, end];
  }
  const nodes: FbxNode[] = [];
  let p = 27;
  while (p + 25 <= b.length && b.readBigUInt64LE(p) !== 0n) {
    const [n, next] = node(p, b.length, 0);
    nodes.push(n);
    p = next;
  }
  if (p + 25 > b.length || !b.subarray(p, p + 25).every((v) => v === 0))
    throw Error("Missing FBX terminator");
  return { nodes, footer: Buffer.from(b.subarray(p + 25)) };
}
export function writeFbx(doc: FbxDocument): Buffer {
  function node(n: FbxNode, at: number): Buffer {
    const name = Buffer.from(n.name),
      properties = Buffer.concat(n.properties),
      header = Buffer.alloc(25);
    if (name.length > 255) throw Error("FBX node name too long");
    let end = at + 25 + name.length + properties.length;
    const children = [];
    for (const child of n.children) {
      const data = node(child, end);
      children.push(data);
      end += data.length;
    }
    const terminal =
      n.terminal || n.children.length > 0 ? Buffer.alloc(25) : Buffer.alloc(0);
    end += terminal.length;
    header.writeBigUInt64LE(BigInt(end));
    header.writeBigUInt64LE(BigInt(n.properties.length), 8);
    header.writeBigUInt64LE(BigInt(properties.length), 16);
    header[24] = name.length;
    return Buffer.concat([header, name, properties, ...children, terminal]);
  }
  const header = Buffer.alloc(27);
  header.write("Kaydara FBX Binary  \0\x1a\0", "binary");
  header.writeUInt32LE(7500, 23);
  const parts: Buffer[] = [header];
  let at = 27;
  for (const n of doc.nodes) {
    const data = node(n, at);
    parts.push(data);
    at += data.length;
  }
  parts.push(Buffer.alloc(25));
  // Assimp's FBX footer ends with version + 120 reserved bytes + 16-byte magic.
  const versionAt = doc.footer.length - 140;
  if (versionAt >= 16 && doc.footer.readUInt32LE(versionAt) === 7500) {
    const padding = (16 - ((at + 25 + 16) % 16)) % 16;
    parts.push(
      doc.footer.subarray(0, 16),
      Buffer.alloc(padding + 4),
      doc.footer.subarray(versionAt),
    );
  } else parts.push(doc.footer);
  return Buffer.concat(parts);
}
export function value(p: Buffer): any {
  const t = String.fromCharCode(p[0]);
  if (t === "S") return p.toString("utf8", 5, 5 + p.readUInt32LE(1));
  if (t === "R") return p.subarray(5);
  if (t === "L") return p.readBigInt64LE(1);
  if (t === "I") return p.readInt32LE(1);
  if (t === "Y") return p.readInt16LE(1);
  if (t === "C") return !!p[1];
  if (t === "F") return p.readFloatLE(1);
  if (t === "D") return p.readDoubleLE(1);
  const size: Record<string, number> = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };
  if (!size[t]) throw Error("Unsupported FBX value");
  const count = p.readUInt32LE(1),
    encoding = p.readUInt32LE(5),
    required = count * size[t];
  if (required > 256 * 1024 * 1024) throw Error("FBX array too large");
  const bytes =
    encoding === 0
      ? p.subarray(13)
      : encoding === 1
        ? inflateSync(p.subarray(13), { maxOutputLength: required })
        : null;
  if (!bytes || bytes.length !== required) throw Error("Invalid FBX array");
  return Array.from({ length: count }, (_, i) =>
    t === "f"
      ? bytes.readFloatLE(i * 4)
      : t === "d"
        ? bytes.readDoubleLE(i * 8)
        : t === "l"
          ? bytes.readBigInt64LE(i * 8)
          : t === "i"
            ? bytes.readInt32LE(i * 4)
            : bytes[i],
  );
}
export function prop(type: string, v: any): Buffer {
  if (type === "S") {
    const s = Buffer.from(v),
      b = Buffer.alloc(5);
    b[0] = 83;
    b.writeUInt32LE(s.length, 1);
    return Buffer.concat([b, s]);
  }
  if (type === "L" || type === "D" || type === "I") {
    const b = Buffer.alloc(1 + scalarSizes[type]);
    b[0] = type.charCodeAt(0);
    if (type === "L") b.writeBigInt64LE(BigInt(v), 1);
    else if (type === "D") b.writeDoubleLE(v, 1);
    else b.writeInt32LE(v, 1);
    return b;
  }
  const size = type === "l" ? 8 : 4,
    b = Buffer.alloc(13 + v.length * size);
  b[0] = type.charCodeAt(0);
  b.writeUInt32LE(v.length, 1);
  b.writeUInt32LE(v.length * size, 9);
  v.forEach((x: any, i: number) =>
    type === "l"
      ? b.writeBigInt64LE(BigInt(x), 13 + i * 8)
      : type === "f"
        ? b.writeFloatLE(x, 13 + i * 4)
        : b.writeInt32LE(x, 13 + i * 4),
  );
  return b;
}
export const fbxNode = (
  name: string,
  properties: Buffer[] = [],
  children: FbxNode[] = [],
): FbxNode => ({ name, properties, children, terminal: children.length > 0 });
