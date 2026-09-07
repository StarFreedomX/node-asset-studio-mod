/** Unity changed vertex format numbering in 2019 (removed the Color alias). */
export function vertexComponentSize(format: number, version: number[]): number {
  const table =
    version[0] < 2017
      ? [4, 2, 1, 1, 4]
      : version[0] < 2019
        ? [4, 2, 1, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4]
        : [4, 2, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4];
  const size = table[format];
  if (!size) throw Error("Unknown vertex component format " + format);
  return size;
}

/** Triangulate without changing the serialized submesh's index count. */
export function meshTriangles(mesh: any, sub: any, reflect = false): number[] {
  const first = sub.firstByte / (mesh.use16BitIndices ? 2 : 4),
    count = sub.indexCount,
    base = sub.baseVertex ?? 0,
    result: number[] = [];
  if (
    !Number.isInteger(first) ||
    first < 0 ||
    !Number.isInteger(count) ||
    count < 0 ||
    first + count > mesh.indexBuffer.length
  )
    throw Error("Invalid mesh index range");
  const index = (i: number) => {
    const v = mesh.indexBuffer[first + i] + base;
    if (!Number.isInteger(v) || v < 0 || v >= mesh.vertices.length)
      throw Error("Mesh index out of range");
    return v;
  };
  const tri = (a: number, b: number, c: number) =>
    result.push(
      ...(reflect
        ? [index(c), index(b), index(a)]
        : [index(a), index(b), index(c)]),
    );
  if (sub.topology === "Triangles") {
    if (count % 3) throw Error("Invalid triangle count");
    for (let i = 0; i < count; i += 3) tri(i, i + 1, i + 2);
  } else if (sub.topology === "Quads") {
    if (count % 4) throw Error("Invalid quad count");
    for (let i = 0; i < count; i += 4) {
      tri(i, i + 1, i + 2);
      tri(i, i + 2, i + 3);
    }
  } else if (sub.topology === "TriangleStrip" || mesh._version?.[0] < 4) {
    for (let i = 0; i < count - 2; i++) {
      if (new Set([index(i), index(i + 1), index(i + 2)]).size < 3) continue;
      i % 2 ? tri(i + 1, i, i + 2) : tri(i, i + 1, i + 2);
    }
  } else throw Error("Unsupported mesh topology " + sub.topology);
  return result;
}
