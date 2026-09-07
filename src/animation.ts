import {
  packedIntegers,
  packedQuaternions,
  slerp,
} from "./packed-animation.js";
import { sampleKeys, curveTimes, eulerQuaternion } from "./animation-curves.js";
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
import {
  vector,
  morphWeights,
  type GlbBuilder,
  type MorphBinding,
  type MorphChannel,
} from "./model.js";
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
function euler(v: number[], order = 4) {
  return quaternion(eulerQuaternion(v, order));
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
  if (
    clip.floatCurves?.some(
      (c: any) =>
        c.classID !== 137 && !(c.classID === 25 && c.attribute === "m_Enabled"),
    ) ||
    clip.pptrCurves?.length
  )
    throw Object.assign(Error("Legacy property animation is not supported"), {
      code: "UNSUPPORTED_OPERATION",
    });
  // All channels share the clip clock; a curve starting late must keep its delay.
  const clipStart =
    clip.muscleClip?.startTime ??
    Math.min(
      0,
      ...[
        "positionCurves",
        "rotationCurves",
        "scaleCurves",
        "eulerCurves",
        "floatCurves",
      ].flatMap((key) =>
        (clip[key] ?? []).map((c: any) => c.curve.curve[0]?.time ?? 0),
      ),
    );
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
  const visibilityTracks: {
    node: number;
    times: number[];
    values: number[];
  }[] = [];
  const visibility = (
    node: number | undefined,
    times: number[],
    values: number[],
  ) => {
    for (const mesh of builder.renderers.get(node ?? -1) ?? [])
      visibilityTracks.push({
        node: mesh,
        times,
        values: values.map((v) => (v > 0 ? 1 : 0)),
      });
  };
  const morphTracks = new Map<
    number,
    {
      morph: MorphBinding;
      curves: Map<
        number,
        { channel: MorphChannel; times: number[]; values: number[] }
      >;
    }
  >();
  function morph(
    node: number | undefined,
    attribute: number | string,
    times: number[],
    values: number[],
  ) {
    const matches = (channel: MorphChannel) =>
      typeof attribute === "number"
        ? crc32(Buffer.from(channel.name)) === attribute ||
          crc32(Buffer.from("blendShape." + channel.name)) === attribute
        : "blendShape." + channel.name === attribute;
    let bindings =
      node !== undefined && node >= 0 ? builder.morphs.get(node) : undefined;
    if (!bindings) {
      const owners = [...builder.morphs.values()].filter((ms) =>
        ms.some((m) => m.channels.some(matches)),
      );
      if (owners.length > 1)
        throw Error("Ambiguous animation morph target " + attribute);
      bindings = owners[0];
    }
    let matched = false;
    for (const binding of bindings ?? []) {
      const matching = binding.channels.filter(matches);
      if (matching.length > 1)
        throw Error("Ambiguous animation morph hash " + attribute);
      const channel = matching[0];
      if (!channel) continue;
      matched = true;
      let track = morphTracks.get(binding.node);
      if (!track) {
        track = { morph: binding, curves: new Map() };
        morphTracks.set(binding.node, track);
      }
      if (track.curves.has(channel.start))
        throw Error("Duplicate blend shape animation channel");
      track.curves.set(channel.start, { channel, times, values });
    }
    if (!matched)
      builder.animationWarnings.push(
        "No blend shape matched " + attribute + " in animation " + clip.name,
      );
  }
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
      const ts = curveTimes(keys, clip.sampleRate || 60),
        start = keys[0].time,
        dim = attribute === 2 ? 4 : 3;
      const values = ts.flatMap((t) => {
        const v = sampleKeys(keys, t, dim);
        return attribute === 4
          ? euler(v, curve.curve.rotationOrder ?? 4)
          : convert(attribute, v);
      });
      emit(
        node,
        attribute === 1
          ? "translation"
          : attribute === 3
            ? "scale"
            : "rotation",
        ts.map((t) => t - clipStart),
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
      (b: any) =>
        !(b.typeID === 25 && b.attribute === 3305885265) &&
        b.typeID !== 137 &&
        (b.typeID !== 4 || ![1, 2, 3, 4].includes(b.attribute)),
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
        binding.typeID === 137 ||
        binding.typeID === 25 ||
        (binding.typeID === 4 &&
          [1, 2, 3, 4].includes(binding.attribute) &&
          node !== undefined &&
          node >= 0)
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
          values.push(
            ...(binding.typeID !== 4 ? v : convert(binding.attribute, v)),
          );
        }
        if (binding.typeID === 25)
          visibility(
            node,
            times.map((t) => t - clipStart),
            values,
          );
        else if (binding.typeID === 137)
          morph(
            node,
            binding.attribute,
            times.map((t) => t - clipStart),
            values,
          );
        else
          emit(
            node!,
            binding.attribute === 1
              ? "translation"
              : binding.attribute === 3
                ? "scale"
                : "rotation",
            times.map((t) => t - clipStart),
            values,
            binding.attribute === 2 || binding.attribute === 4 ? 4 : 3,
          );
      }
      offset += dim;
    }

    if (offset !== stream.length + dense.curveCount + constant.length)
      throw Error("Animation binding/curve count mismatch");
  }
  for (const curve of clip.floatCurves ?? []) {
    const keys = curve.curve.curve;
    if (!keys.length) continue;
    const times = curveTimes(keys, clip.sampleRate || 60),
      start = keys[0].time;
    const values = times.map((t) => sampleKeys(keys, t, 1)[0]);
    if (curve.classID === 25)
      visibility(
        paths.get(curve.path),
        times.map((t) => t - clipStart),
        values,
      );
    else
      morph(
        paths.get(curve.path),
        curve.attribute,
        times.map((t) => t - clipStart),
        values,
      );
  }
  for (const [node, { morph, curves }] of morphTracks) {
    const times = [
        ...new Set([...curves.values()].flatMap((c) => c.times)),
      ].sort((a, b) => a - b),
      values: number[] = [];
    for (const t of times) {
      const weights = [...morph.defaults];
      for (const curve of curves.values()) {
        let i = 0;
        while (i + 1 < curve.times.length && curve.times[i + 1] <= t) i++;
        const j = Math.min(i + 1, curve.times.length - 1),
          u =
            i === j
              ? 0
              : Math.max(
                  0,
                  (t - curve.times[i]) / (curve.times[j] - curve.times[i]),
                );
        const v = curve.values[i] * (1 - u) + curve.values[j] * u;
        weights.splice(
          curve.channel.start,
          curve.channel.weights.length,
          ...morphWeights(curve.channel, v),
        );
      }
      values.push(...weights);
    }
    emit(node, "weights", times, values, 1);
  }
  for (const curve of clip.compressedRotationCurves ?? []) {
    const node = paths.get(curve.path);
    if (node === undefined) continue;
    const deltas = packedIntegers(curve.times),
      quats = packedQuaternions(curve.values);
    if (deltas.length !== quats.length)
      throw Error("Packed animation time/value count mismatch");
    let tick = 0;
    const keys = deltas.map((dt, i) => ({
      time: (tick += dt) * 0.01,
      value: quats[i],
    }));
    if (!keys.length) continue;
    const times = curveTimes(keys, clip.sampleRate || 60),
      values: number[] = [];
    let at = 0;
    for (const t of times) {
      while (at + 1 < keys.length && keys[at + 1].time <= t) at++;
      const a = keys[at],
        b = keys[Math.min(at + 1, keys.length - 1)],
        u = a === b ? 0 : (t - a.time) / (b.time - a.time);
      values.push(...quaternion(slerp(a.value, b.value, u)));
    }
    emit(
      node,
      "rotation",
      times.map((t) => t - clipStart),
      values,
      4,
    );
  }
  let animationName = clip.name ?? "Animation",
    suffix = 2;
  while (g.animations.some((a: any) => a.name === animationName))
    animationName = (clip.name ?? "Animation") + "_" + suffix++;
  if (channels.length || visibilityTracks.length)
    g.animations.push({
      name: animationName,
      samplers,
      channels,
      ...(visibilityTracks.length
        ? { extras: { unityVisibility: visibilityTracks } }
        : {}),
    });
  return channels.length + visibilityTracks.length;
}
