const component = (v: any, i: number, n: number) =>
  n === 1
    ? Number(v)
    : Number(
        Array.isArray(v) || ArrayBuffer.isView(v)
          ? v[i]
          : v[["x", "y", "z", "w"][i]],
      );
/** Evaluate Unity Hermite / weighted Bezier tangents in source time. */
export function sampleKeys(
  keys: any[],
  time: number,
  dimensions: number,
): number[] {
  if (!keys.length) throw Error("Empty animation curve");
  let at = 0;
  while (at + 1 < keys.length && keys[at + 1].time <= time) at++;
  const a = keys[at],
    b = keys[Math.min(at + 1, keys.length - 1)],
    dt = b.time - a.time;
  if (time <= keys[0].time)
    return Array.from({ length: dimensions }, (_, i) =>
      component(keys[0].value, i, dimensions),
    );
  if (!dt)
    return Array.from({ length: dimensions }, (_, i) =>
      component(a.value, i, dimensions),
    );
  const x = (time - a.time) / dt,
    bezier = (t: number, p: number, q: number) =>
      3 * (1 - t) ** 2 * t * p + 3 * (1 - t) * t * t * q + t ** 3;
  return Array.from({ length: dimensions }, (_, i) => {
    const av = component(a.value, i, dimensions),
      bv = component(b.value, i, dimensions),
      as = component(a.outSlope, i, dimensions),
      bs = component(b.inSlope, i, dimensions);
    if (!Number.isFinite(as) || !Number.isFinite(bs)) return av;
    const out =
        a.weightedMode & 2 ? component(a.outWeight, i, dimensions) : 1 / 3,
      inside =
        b.weightedMode & 1 ? component(b.inWeight, i, dimensions) : 1 / 3;
    if (
      !Number.isFinite(out) ||
      !Number.isFinite(inside) ||
      out < 0 ||
      out > 1 ||
      inside < 0 ||
      inside > 1
    )
      throw Error("Invalid animation tangent weight");
    let t = x;
    if (out !== 1 / 3 || inside !== 1 / 3) {
      let lo = 0,
        hi = 1;
      for (let k = 0; k < 45; k++) {
        t = (lo + hi) / 2;
        if (bezier(t, out, 1 - inside) < x) lo = t;
        else hi = t;
      }
      t = (lo + hi) / 2;
    }
    const u = 1 - t;
    return (
      u * u * u * av +
      3 * u * u * t * (av + out * dt * as) +
      3 * u * t * t * (bv - inside * dt * bs) +
      t * t * t * bv
    );
  });
}
export function curveTimes(keys: any[], rate: number): number[] {
  if (!keys.length) return [];
  const start = keys[0].time,
    end = keys.at(-1).time,
    count = Math.ceil((end - start) * rate) + 1;
  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 1e6 ||
    keys.some(
      (k, i) =>
        !Number.isFinite(k.time) || (i > 0 && k.time < keys[i - 1].time),
    )
  )
    throw Error("Invalid animation key times or sample count");
  return [
    ...new Set([
      ...keys.map((k) => k.time),
      ...Array.from({ length: count }, (_, i) =>
        Math.min(end, start + i / rate),
      ),
    ]),
  ].sort((a, b) => a - b);
}
export function eulerQuaternion(v: number[], order = 4): number[] {
  const orders = ["XYZ", "XZY", "YZX", "YXZ", "ZXY", "ZYX"];
  if (!orders[order]) throw Error("Unknown Unity Euler rotation order");
  let q = [0, 0, 0, 1];
  for (const axis of orders[order]) {
    const i = "XYZ".indexOf(axis),
      angle = (v[i] * Math.PI) / 360,
      r = [0, 0, 0, Math.cos(angle)];
    r[i] = Math.sin(angle);
    const [x, y, z, w] = q,
      [a, b, c, d] = r;
    q = [
      d * x + a * w + b * z - c * y,
      d * y - a * z + b * w + c * x,
      d * z + a * y - b * x + c * w,
      d * w - a * x - b * y - c * z,
    ];
  }
  return q;
}
