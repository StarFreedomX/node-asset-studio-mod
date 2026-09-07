import {
  parseFbx,
  writeFbx,
  value,
  prop,
  fbxNode as N,
  type FbxNode,
} from "./fbx-document.js";
const s = (v: string) => prop("S", v),
  l = (v: bigint | number) => prop("L", v),
  i = (v: number) => prop("I", v),
  d = (v: number) => prop("D", v);
const id = (n: FbxNode) => value(n.properties[0]) as bigint;
const label = (n: FbxNode) => String(value(n.properties[1])).split("\0")[0];
const ticks = (t: number) => BigInt(Math.round(t * 46186158000));
function glb(input: Uint8Array) {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength),
    len = b.readUInt32LE(12);
  return {
    g: JSON.parse(b.toString("utf8", 20, 20 + len)),
    bin: b.subarray(28 + len),
  };
}
/** Assimp exports shape geometry but drops aiMeshMorphAnim. Restore its FBX connections. */
export function completeMorphExport(
  fbx: Uint8Array,
  input: Uint8Array,
): Uint8Array {
  const { g, bin } = glb(input);
  if (
    !g.meshes?.some((m: any) => m.weights?.length) &&
    !g.nodes.some((n: any) => n.extras?.unityVisibility !== undefined)
  )
    return fbx;
  const doc = parseFbx(fbx),
    objects = doc.nodes.find((n) => n.name === "Objects")!,
    connections = doc.nodes.find((n) => n.name === "Connections")!;
  if (!objects || !connections)
    throw Error("Missing FBX objects or connections");
  let next =
    objects.children.reduce((a, n) => (id(n) > a ? id(n) : a), 0n) + 1n;
  const newID = () => next++;
  const byID = new Map(objects.children.map((n) => [id(n), n]));
  const children = (parent: bigint) =>
    connections.children
      .filter(
        (c) =>
          value(c.properties[0]) === "OO" && value(c.properties[2]) === parent,
      )
      .map((c) => byID.get(value(c.properties[1])))
      .filter((n): n is FbxNode => !!n);
  const link = (child: bigint, parent: bigint, property?: string) =>
    connections.children.push(
      N("C", [
        s(property ? "OP" : "OO"),
        l(child),
        l(parent),
        ...(property ? [s(property)] : []),
      ]),
    );
  const add = (n: FbxNode) => {
    objects.children.push(n);
    byID.set(id(n), n);
    return id(n);
  };
  const P = (name: string, type: string, v: Buffer, animated = false) =>
    N("P", [
      s(name),
      s(type),
      s(type === "KTime" ? "Time" : ""),
      s(animated ? "A" : ""),
      v,
    ]);
  const modelFor = (index: number) => {
    const matches = objects.children.filter(
      (n) => n.name === "Model" && label(n) === g.nodes[index].name,
    );
    if (matches.length !== 1)
      throw Error("Ambiguous FBX model " + g.nodes[index].name);
    return matches[0];
  };
  for (const [index, node] of g.nodes.entries())
    if (node.extras?.unityVisibility !== undefined) {
      const model = modelFor(index),
        properties = model.children.find((n) => n.name === "Properties70");
      if (properties) {
        let p = properties.children.find(
          (n) => value(n.properties[0]) === "Visibility",
        );
        if (!p) {
          p = P(
            "Visibility",
            "Visibility",
            d(node.extras.unityVisibility),
            true,
          );
          properties.children.push(p);
        } else
          p.properties[p.properties.length - 1] = d(
            node.extras.unityVisibility,
          );
      }
    }
  const mapping = new Map<number, FbxNode[][]>();
  for (const [index, node] of g.nodes.entries()) {
    const mesh = g.meshes?.[node.mesh];
    if (!mesh?.weights?.length) continue;
    const models = objects.children.filter(
      (n) => n.name === "Model" && label(n) === node.name,
    );
    if (models.length !== 1)
      throw Error("Ambiguous FBX morph model " + node.name);
    const channels: FbxNode[] = [];
    function visit(n: FbxNode, seen = new Set<bigint>()) {
      if (seen.has(id(n))) throw Error("Cyclic FBX mesh connections");
      seen.add(id(n));
      for (const c of children(id(n))) {
        if (c.name === "Model") visit(c, seen);
        else if (c.name === "Geometry" && value(c.properties[2]) === "Mesh")
          for (const shape of children(id(c)))
            if (
              shape.name === "Deformer" &&
              value(shape.properties[2]) === "BlendShape"
            )
              channels.push(
                ...children(id(shape)).filter(
                  (n) =>
                    n.name === "Deformer" &&
                    value(n.properties[2]) === "BlendShapeChannel",
                ),
              );
      }
      seen.delete(id(n));
    }
    visit(models[0]);
    const targets = mesh.extras?.targetNames;
    if (!targets || targets.length !== mesh.weights.length)
      throw Error("Missing morph target names");
    const mapped = targets.map((name: string) => {
      const found = channels.filter((c) => label(c) === name);
      if (!found.length) throw Error("Missing exported shape " + name);
      return found;
    });
    mapping.set(index, mapped);
    for (let t = 0; t < mapped.length; t++)
      for (const channel of mapped[t]) {
        const weight = (node.weights ?? mesh.weights)[t] * 100;
        const scalar = channel.children.find((n) => n.name === "DeformPercent");
        if (scalar) scalar.properties = [d(weight)];
        const properties = channel.children.find(
          (n) => n.name === "Properties70",
        );
        if (properties) {
          const p = properties.children.find(
            (n) => value(n.properties[0]) === "DeformPercent",
          );
          if (p) p.properties[p.properties.length - 1] = d(weight);
        }
      }
  }
  const accessor = (index: number): number[] => {
    const a = g.accessors[index],
      v = g.bufferViews[a.bufferView];
    if (
      a.componentType !== 5126 ||
      a.type !== "SCALAR" ||
      a.sparse ||
      v.byteStride
    )
      throw Error("Unexpected morph accessor");
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    if (start < 0 || start + a.count * 4 > bin.length)
      throw Error("Truncated morph accessor");
    return Array.from({ length: a.count }, (_, i) =>
      bin.readFloatLE(start + i * 4),
    );
  };
  for (const [ai, animation] of (g.animations ?? []).entries()) {
    const tracks = animation.channels.filter(
        (c: any) => c.target.path === "weights",
      ),
      visibility = animation.extras?.unityVisibility ?? [];
    if (!tracks.length && !visibility.length) continue;
    const name = animation.name ?? "animation_" + ai;
    let stack = objects.children.find(
      (n) => n.name === "AnimationStack" && label(n) === name,
    );
    const stop = Math.max(
      0,
      ...animation.samplers.map((p: any) => accessor(p.input).at(-1) ?? 0),
      ...visibility.map((v: any) => v.times.at(-1) ?? 0),
    );
    if (!stack) {
      stack = N(
        "AnimationStack",
        [l(newID()), s(name + "\0\x01AnimStack"), s("")],
        [
          N(
            "Properties70",
            [],
            [
              P("LocalStart", "KTime", l(0)),
              P("LocalStop", "KTime", l(ticks(stop))),
              P("ReferenceStart", "KTime", l(0)),
              P("ReferenceStop", "KTime", l(ticks(stop))),
            ],
          ),
        ],
      );
      add(stack);
    }
    const properties = stack.children.find((n) => n.name === "Properties70");
    if (properties)
      for (const name of ["LocalStop", "ReferenceStop"]) {
        const p = properties.children.find(
          (n) => value(n.properties[0]) === name,
        );
        if (p) p.properties[p.properties.length - 1] = l(ticks(stop));
      }
    let layer = children(id(stack)).find((n) => n.name === "AnimationLayer");
    if (!layer) {
      layer = N("AnimationLayer", [
        l(newID()),
        s("Morphs\0\x01AnimLayer"),
        s(""),
      ]);
      add(layer);
      link(id(layer), id(stack));
    }
    for (const track of visibility) {
      const model = modelFor(track.node),
        values = track.values;
      const curveNode = add(
        N(
          "AnimationCurveNode",
          [l(newID()), s("Visibility\0\x01AnimCurveNode"), s("")],
          [
            N(
              "Properties70",
              [],
              [P("d|Visibility", "Number", d(values[0]), true)],
            ),
          ],
        ),
      );
      const curve = add(
        N(
          "AnimationCurve",
          [l(newID()), s("\0\x01AnimCurve"), s("")],
          [
            N("Default", [d(values[0])]),
            N("KeyVer", [i(4008)]),
            N("KeyTime", [prop("l", track.times.map(ticks))]),
            N("KeyValueFloat", [prop("f", values)]),
            N("KeyAttrFlags", [prop("i", [2])]),
            N("KeyAttrDataFloat", [prop("f", [0, 0, 0, 0])]),
            N("KeyAttrRefCount", [prop("i", [values.length])]),
          ],
        ),
      );
      link(curveNode, id(layer));
      link(curveNode, id(model), "Visibility");
      link(curve, curveNode, "d|Visibility");
    }
    for (const track of tracks) {
      const targets = mapping.get(track.target.node);
      if (!targets) throw Error("Missing morph target node");
      const sampler = animation.samplers[track.sampler];
      if (sampler.interpolation !== "LINEAR")
        throw Error("Morph export requires baked linear curves");
      const times = accessor(sampler.input),
        values = accessor(sampler.output);
      if (values.length !== times.length * targets.length)
        throw Error("Morph sample count mismatch");
      for (let target = 0; target < targets.length; target++)
        for (const channel of targets[target]) {
          const weights = times.map(
            (_: number, k: number) => values[k * targets.length + target] * 100,
          );
          if (weights.some((v) => !Number.isFinite(v)))
            throw Error("Invalid morph weight");
          const curveNode = add(
            N(
              "AnimationCurveNode",
              [l(newID()), s("DeformPercent\0\x01AnimCurveNode"), s("")],
              [
                N(
                  "Properties70",
                  [],
                  [P("d|DeformPercent", "Number", d(weights[0]), true)],
                ),
              ],
            ),
          );
          const curve = add(
            N(
              "AnimationCurve",
              [l(newID()), s("\0\x01AnimCurve"), s("")],
              [
                N("Default", [d(weights[0])]),
                N("KeyVer", [i(4008)]),
                N("KeyTime", [prop("l", times.map(ticks))]),
                N("KeyValueFloat", [prop("f", weights)]),
                N("KeyAttrFlags", [prop("i", [4])]),
                N("KeyAttrDataFloat", [prop("f", [0, 0, 0, 0])]),
                N("KeyAttrRefCount", [prop("i", [times.length])]),
              ],
            ),
          );
          link(curveNode, id(layer));
          link(curveNode, id(channel), "DeformPercent");
          link(curve, curveNode, "d|DeformPercent");
        }
    }
  }
  // Update definition counts for newly added stacks/layers/curves.
  const definitions = doc.nodes.find((n) => n.name === "Definitions");
  if (definitions) {
    const counts = new Map<string, number>();
    for (const o of objects.children)
      counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
    for (const [type, count] of counts) {
      let entry = definitions.children.find(
        (n) => n.name === "ObjectType" && value(n.properties[0]) === type,
      );
      if (!entry) {
        entry = N("ObjectType", [s(type)]);
        definitions.children.push(entry);
      }
      let c = entry.children.find((n) => n.name === "Count");
      if (!c) {
        c = N("Count");
        entry.children.push(c);
      }
      c.properties = [i(count)];
    }
    const count = definitions.children.find((n) => n.name === "Count");
    if (count) count.properties = [i(objects.children.length)];
  }
  return writeFbx(doc);
}
