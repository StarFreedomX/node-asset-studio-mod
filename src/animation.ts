// Avoid node:zlib.crc32, which is absent in early Node 22 releases.
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  return c >>> 0;
});
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const v of data) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
import { vector, type GlbBuilder } from "./model.js";
import { PPtr } from "../node_modules/unityfs-js/unityfs/classes/pptr.js";
export interface CurveKey {
  time: number;
  value: number;
  coefficients?: number[];
}
/** StreamedClip values use coefficient[3], not coefficient[2] (the derivative). */
export function streamedCurves(
  data: Uint8Array,
  curveCount: number,
): CurveKey[][] {
  if (!Number.isSafeInteger(curveCount) || curveCount < 0 || curveCount > 1e6)
    throw Error("Invalid streamed curve count");
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    curves: CurveKey[][] = Array.from({ length: curveCount }, () => []);
  let p = 0;
  while (p < b.length) {
    if (p + 8 > b.length) throw Error("Truncated streamed animation frame");
    const time = b.readFloatLE(p),
      count = b.readUInt32LE(p + 4);
    p += 8;
    if (count > (b.length - p) / 20)
      throw Error("Truncated streamed animation keys");
    for (let i = 0; i < count; i++) {
      const index = b.readUInt32LE(p),
        c = Array.from({ length: 4 }, (_, j) => b.readFloatLE(p + 4 + j * 4));
      p += 20;
      if (index >= curveCount) throw Error("Streamed curve index out of range");
      curves[index].push({ time, value: c[3], coefficients: c });
    }
  }
  return curves;
}
export function evaluateCurve(keys: CurveKey[], time: number): number {
  if (!keys.length) throw Error("Empty animation curve");
  let low = 0,
    high = keys.length;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (keys[mid].time <= time) low = mid;
    else high = mid;
  }
  const key = keys[low];
  if (!key.coefficients) return key.value;
  // Unity sentinel frames initialise values and do not define an extrapolation polynomial.
  const t = key.time < -1e30 || time < key.time ? 0 : time - key.time,
    c = key.coefficients;
  return ((c[0] * t + c[1]) * t + c[2]) * t + c[3];
}
function bindings(clip: any): any[] {
  if (clip.nodeBindings) return clip.nodeBindings;
  const reader = clip.reader;
  if (!reader?.versionGTE(4, 3)) return [];
  const pos = reader.offset;
  try {
    const count = reader.readInt32();
    if (count < 0 || count > (reader.length - reader.offset) / 20)
      throw Error("Invalid animation binding count");
    const result = [];
    for (let i = 0; i < count; i++) {
      const path = reader.readUInt32(),
        attribute = reader.readUInt32();
      new PPtr(reader);
      const typeID = reader.versionGTE(5, 6)
        ? reader.readInt32()
        : reader.readUInt16();
      const customType = reader.readUInt8(),
        isPPtrCurve = reader.readUInt8();
      if (reader.versionGTE(2022, 1)) reader.readUInt8();
      if (reader.versionGTE(2022, 2)) reader.readUInt8();
      reader.align(4);
      result.push({ path, attribute, typeID, customType, isPPtrCurve });
    }
    clip.nodeBindings = result;
    return result;
  } finally {
    reader.offset = pos;
  }
}
function quaternion(v: number[]) {
  const n = Math.hypot(...v);
  if (!n) throw Error("Zero animation quaternion");
  return [v[0] / n, -v[1] / n, -v[2] / n, v[3] / n];
}
function euler(v: number[]) {
  const [x, y, z] = v.map((n) => (n * Math.PI) / 360),
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  return quaternion([
    cy * sx * cz + sy * cx * sz,
    sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz,
    cy * cx * cz + sy * sx * sz,
  ]);
}
export function addAnimation(
  builder: GlbBuilder,
  paths: Map<string, number>,
  clip: any,
): number {
  if (
    clip.sampleRate !== undefined &&
    (!Number.isFinite(clip.sampleRate) || clip.sampleRate <= 0)
  )
    throw Error("Invalid animation sample rate");
  if (clip.floatCurves?.length || clip.pptrCurves?.length)
    throw Object.assign(Error("Legacy property animation is not supported"), {
      code: "UNSUPPORTED_OPERATION",
    });
  const g = builder.document,
    channels: any[] = [],
    samplers: any[] = [],
    hashes = new Map<number, number>();
  for (const [path, node] of paths) {
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const h = crc32(Buffer.from(parts.slice(i).join("/")));
      if (hashes.has(h) && hashes.get(h) !== node) hashes.set(h, -1);
      else if (!hashes.has(h)) hashes.set(h, node);
    }
  }
  hashes.set(0, paths.get("")!);
  const emit = (
    node: number,
    path: string,
    times: number[],
    values: number[],
    components: number,
  ) => {
    if (!times.length) return;
    samplers.push({
      input: builder.accessor(times, "SCALAR", 5126, true),
      output: builder.accessor(
        values,
        path === "weights" ? "SCALAR" : components === 4 ? "VEC4" : "VEC3",
      ),
      interpolation: "LINEAR",
    });
    channels.push({ sampler: samplers.length - 1, target: { node, path } });
  };
  const convert = (attribute: number, v: number[]) =>
    attribute === 1
      ? [-v[0], v[1], v[2]]
      : attribute === 2
        ? quaternion(v)
        : attribute === 4
          ? euler(v)
          : v;
  const legacy = [
    ["positionCurves", 1],
    ["rotationCurves", 2],
    ["scaleCurves", 3],
    ["eulerCurves", 4],
  ] as const;
  for (const [key, attribute] of legacy)
    for (const curve of clip[key] ?? []) {
      const node = paths.get(curve.path);
      if (node === undefined) continue;
      const keys = curve.curve.curve;
      if (!keys.length) continue;
      if (keys.some((k: any) => k.weightedMode))
        throw Object.assign(
          Error("Weighted legacy animation tangents are not supported"),
          { code: "UNSUPPORTED_OPERATION" },
        );
      if (
        attribute === 4 &&
        curve.curve.rotationOrder !== undefined &&
        curve.curve.rotationOrder !== 4
      )
        throw Object.assign(Error("Unsupported legacy Euler rotation order"), {
          code: "UNSUPPORTED_OPERATION",
        });
      // Bake cubic Hermite curves at the source clip's sample rate, retaining key times.
      const rate = clip.sampleRate || 60,
        start = keys[0].time,
        end = keys.at(-1).time,
        times = new Set<number>(keys.map((k: any) => k.time));
      if ((end - start) * rate > 1e6)
        throw Error("Animation exceeds sample limit");
      for (let t = start; t < end; t += 1 / rate) times.add(t);
      const ts = [...times].sort((a, b) => a - b),
        dim = attribute === 2 ? 4 : 3;
      let index = 0;
      const values: number[] = [];
      for (const t of ts) {
        while (index + 1 < keys.length && keys[index + 1].time < t) index++;
        const a = keys[index],
          b = keys[Math.min(index + 1, keys.length - 1)],
          dt = b.time - a.time,
          u = dt ? (t - a.time) / dt : 0;
        const av = vector(a.value, dim),
          bv = vector(b.value, dim),
          as = vector(a.outSlope, dim),
          bs = vector(b.inSlope, dim);
        const v = av.map((v, i) =>
          !Number.isFinite(as[i]) || !Number.isFinite(bs[i])
            ? v
            : (2 * u ** 3 - 3 * u * u + 1) * v +
              (u ** 3 - 2 * u * u + u) * dt * as[i] +
              (-2 * u ** 3 + 3 * u * u) * bv[i] +
              (u ** 3 - u * u) * dt * bs[i],
        );
        values.push(...convert(attribute, v));
      }
      emit(
        node,
        attribute === 1
          ? "translation"
          : attribute === 3
            ? "scale"
            : "rotation",
        ts.map((t) => t - start),
        values,
        attribute === 2 || attribute === 4 ? 4 : 3,
      );
    }
  const muscle = clip.muscleClip;
  if (muscle?.clip) {
    const source = muscle.clip,
      streamed = source.streamedClip,
      dense = source.denseClip,
      constant = source.constantClip?.data ?? [];
    const stream = streamedCurves(streamed.data.data, streamed.curveCount),
      all = bindings(clip),
      start = muscle.startTime,
      end = muscle.stopTime,
      rate = clip.sampleRate || dense.sampleRate || 60;
    const count = Math.ceil((end - start) * rate) + 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 1e6)
      throw Error("Invalid animation sample count");
    const unsupported = all.filter(
      (b: any) => b.typeID !== 4 || ![1, 2, 3, 4].includes(b.attribute),
    );
    if (unsupported.length)
      throw Object.assign(
        Error(
          "Animation " +
            clip.name +
            " contains unsupported bindings: " +
            [
              ...new Set(
                unsupported.map((b: any) =>
                  b.typeID === 95
                    ? "Humanoid muscle"
                    : b.typeID === 137
                      ? "blend shape"
                      : "type " + b.typeID + " attribute " + b.attribute,
                ),
              ),
            ].join(", "),
        ),
        { code: "UNSUPPORTED_OPERATION" },
      );
    const times = Array.from({ length: count }, (_, i) =>
      Math.min(end, start + i / rate),
    );
    let offset = 0;
    for (const binding of all) {
      const dim =
          binding.typeID === 4
            ? binding.attribute === 2
              ? 4
              : [1, 3, 4].includes(binding.attribute)
                ? 3
                : 1
            : 1,
        node = hashes.get(binding.path);
      if (
        binding.typeID === 4 &&
        [1, 2, 3, 4].includes(binding.attribute) &&
        node !== undefined &&
        node >= 0
      ) {
        const values: number[] = [];
        for (const time of times) {
          const v = [];
          for (let i = 0; i < dim; i++) {
            const index = offset + i;
            if (index < stream.length)
              v.push(evaluateCurve(stream[index], time));
            else if (index < stream.length + dense.curveCount) {
              const c = index - stream.length,
                f = Math.max(
                  0,
                  Math.min(
                    dense.frameCount - 1,
                    (time - dense.beginTime) * dense.sampleRate,
                  ),
                ),
                a = Math.floor(f),
                b = Math.min(a + 1, dense.frameCount - 1),
                u = f - a;
              v.push(
                dense.samples[a * dense.curveCount + c] * (1 - u) +
                  dense.samples[b * dense.curveCount + c] * u,
              );
            } else {
              const value = constant[index - stream.length - dense.curveCount];
              if (value === undefined)
                throw Error("Missing constant animation curve");
              v.push(value);
            }
          }
          values.push(...convert(binding.attribute, v));
        }
        emit(
          node,
          binding.attribute === 1
            ? "translation"
            : binding.attribute === 3
              ? "scale"
              : "rotation",
          times.map((t) => t - start),
          values,
          binding.attribute === 2 || binding.attribute === 4 ? 4 : 3,
        );
      }
      offset += dim;
    }

    if (offset !== stream.length + dense.curveCount + constant.length)
      throw Error("Animation binding/curve count mismatch");
  }
  if (clip.compressedRotationCurves?.length)
    throw Object.assign(
      Error("Packed legacy rotation curves require decompression"),
      { code: "UNSUPPORTED_OPERATION" },
    );
  if (channels.length)
    g.animations.push({ name: clip.name, samplers, channels });
  return channels.length;
}
