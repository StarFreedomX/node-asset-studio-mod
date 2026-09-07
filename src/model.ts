import { restoreAvatarSkeleton } from "./avatar-skeleton.js";
import { meshTriangles } from "./mesh-layout.js";
import path from "node:path";
import { convertTexture } from "./texture-engine.js";

export class ObjectResolver {
  constructor(readonly files: { file: any; name: string; manager: any }[]) {}
  resolve(owner: any, pointer: any, required = true): any {
    if (!pointer || BigInt(pointer.pathID ?? 0) === 0n) return null;
    const source = owner.assetFile ?? owner.reader?.assetFile;
    let target = source;
    if (pointer.fileID) {
      const external = source.externals?.[pointer.fileID - 1]?.path;
      const matches = this.files.filter(
        (f) =>
          path.posix.basename(f.name.replaceAll("\\", "/")) ===
          path.posix.basename((external ?? "").replaceAll("\\", "/")),
      );
      if (matches.length !== 1) {
        if (required) throw Error("Cannot resolve external asset " + external);
        return null;
      }
      target = matches[0].file;
    }
    const object = target?.getObjectByPathID(BigInt(pointer.pathID));
    if (!object && required)
      throw Error(
        "Missing object reference " + pointer.fileID + ":" + pointer.pathID,
      );
    return object ?? null;
  }
  resource(owner: any, p: string, o: number, s: number) {
    const entry = this.files.find((f) => f.file === owner.assetFile);
    if (!entry) throw Error("Missing resource owner");
    return entry.manager.resolveResource(p, o, s);
  }
  components(go: any) {
    return go.object.components
      .map((p: any) => this.resolve(go, p))
      .filter(Boolean);
  }
  gameObject(owner: any) {
    return owner.className === "GameObject"
      ? owner
      : this.resolve(owner, owner.object.gameObject);
  }
}
export interface MorphChannel {
  name: string;
  start: number;
  weights: number[];
}
export interface MorphBinding {
  node: number;
  defaults: number[];
  channels: MorphChannel[];
}
export function morphWeights(channel: MorphChannel, value: number): number[] {
  const ws = channel.weights,
    result = ws.map(() => 0);
  if (!ws.length) return result;
  if (
    ws.some(
      (v, i) => !Number.isFinite(v) || v <= 0 || (i > 0 && v <= ws[i - 1]),
    )
  )
    throw Error("Invalid progressive blend shape weights");
  if (value <= ws[0] || ws.length === 1) {
    result[0] = value / ws[0];
    return result;
  }
  let i = 1;
  while (i < ws.length - 1 && value > ws[i]) i++;
  const t = (value - ws[i - 1]) / (ws[i] - ws[i - 1]);
  result[i - 1] = 1 - t;
  result[i] = t;
  return result;
}
export class GlbBuilder {
  morphs = new Map<number, MorphBinding[]>();
  renderers = new Map<number, number[]>();
  animationWarnings: string[] = [];
  legacyAnimations: { clip: any; rootPath: string }[] = [];
  document: any = {
    asset: { version: "2.0", generator: "node-asset-studio-mod-js" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    textures: [],
    images: [],
    skins: [],
    animations: [],
    bufferViews: [],
    accessors: [],
    buffers: [{ byteLength: 0 }],
  };
  private buffers: Buffer[] = [];
  private length = 0;
  view(data: Uint8Array) {
    const padding = Buffer.alloc((4 - (this.length % 4)) % 4);
    this.buffers.push(padding);
    this.length += padding.length;
    const index = this.document.bufferViews.length;
    this.document.bufferViews.push({
      buffer: 0,
      byteOffset: this.length,
      byteLength: data.length,
    });
    this.buffers.push(Buffer.from(data));
    this.length += data.length;
    return index;
  }
  accessor(
    values: number[],
    type: string,
    componentType = 5126,
    bounds = false,
  ) {
    const components: Record<string, number> = {
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT4: 16,
      },
      size = componentType === 5123 ? 2 : 4;
    if (
      !values.length ||
      values.length % components[type] ||
      values.some((v) => !Number.isFinite(v))
    )
      throw Error("Invalid model accessor");
    const b = Buffer.alloc(values.length * size);
    values.forEach((v, i) =>
      componentType === 5126
        ? b.writeFloatLE(v, i * size)
        : componentType === 5123
          ? b.writeUInt16LE(v, i * size)
          : b.writeUInt32LE(v, i * size),
    );
    const a: any = {
      bufferView: this.view(b),
      componentType,
      count: values.length / components[type],
      type,
    };
    if (bounds) {
      a.min = Array(components[type]).fill(Infinity);
      a.max = Array(components[type]).fill(-Infinity);
      values.forEach((v, i) => {
        const c = i % components[type];
        a.min[c] = Math.min(a.min[c], v);
        a.max[c] = Math.max(a.max[c], v);
      });
    }
    this.document.accessors.push(a);
    return this.document.accessors.length - 1;
  }
  finish() {
    this.document.buffers[0].byteLength = this.length;
    const doc = { ...this.document };
    for (const key of [
      "meshes",
      "materials",
      "textures",
      "images",
      "skins",
      "animations",
      "bufferViews",
      "accessors",
    ])
      if (!doc[key].length) delete doc[key];
    const json = Buffer.from(JSON.stringify(doc));
    const text = Buffer.concat([
        json,
        Buffer.alloc((4 - (json.length % 4)) % 4, 32),
      ]),
      bin = Buffer.concat([
        ...this.buffers,
        Buffer.alloc((4 - (this.length % 4)) % 4),
      ]);
    const header = Buffer.alloc(12),
      j = Buffer.alloc(8),
      b = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + text.length + bin.length, 8);
    j.writeUInt32LE(text.length);
    j.writeUInt32LE(0x4e4f534a, 4);
    b.writeUInt32LE(bin.length);
    b.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, j, text, b, bin]);
  }
}
export const vector = (v: any, n = 3): number[] =>
  Array.from({ length: n }, (_, i) =>
    Number(
      Array.isArray(v) || ArrayBuffer.isView(v)
        ? v[i]
        : v[["x", "y", "z", "w"][i]],
    ),
  );
const position = (v: any) => {
  const a = vector(v);
  a[0] *= -1;
  return a;
};
const rotation = (v: any) => {
  const a = vector(v, 4);
  a[1] *= -1;
  a[2] *= -1;
  return a;
};
export async function buildModel(
  root: any,
  resolver: ObjectResolver,
  maxPixels: number,
  includeLegacyAnimations = true,
): Promise<{
  builder: GlbBuilder;
  transforms: Map<any, number>;
  paths: Map<string, number>;
}> {
  const builder = new GlbBuilder(),
    g = builder.document,
    transforms = new Map<any, number>(),
    paths = new Map<string, number>(),
    renderers: { info: any; node: number }[] = [],
    visiting = new Set<any>();
  const go = resolver.gameObject(root);
  if (!go) throw Error("Animator has no GameObject");
  const rootTransform = resolver
    .components(go)
    .find(
      (o: any) =>
        o.className === "Transform" || o.className === "RectTransform",
    );
  if (!rootTransform) throw Error("GameObject has no Transform");
  function visit(t: any, parentPath: string, isRoot = false): number {
    if (visiting.has(t)) throw Error("Transform hierarchy contains a cycle");
    if (transforms.has(t)) throw Error("Transform has multiple parents");
    if (transforms.size >= 100000)
      throw Error("Transform hierarchy exceeds limit");
    visiting.add(t);
    const obj = t.object,
      gameObject = resolver.gameObject(t),
      name = gameObject?.object.name ?? "Transform",
      index = g.nodes.length,
      current = isRoot ? "" : parentPath ? parentPath + "/" + name : name;
    transforms.set(t, index);
    if (paths.has(current)) throw Error("Ambiguous Transform path " + current);
    paths.set(current, index);
    const node: any = {
      name,
      translation: position(obj.localPosition),
      rotation: rotation(obj.localRotation),
      scale: vector(obj.localScale),
    };
    g.nodes.push(node);
    for (const component of resolver.components(gameObject))
      if (["SkinnedMeshRenderer", "MeshRenderer"].includes(component.className))
        renderers.push({ info: component, node: index });
    for (const component of resolver.components(gameObject))
      if (includeLegacyAnimations && component.className === "Animation") {
        const seen = new Set<any>();
        for (const pointer of [
          component.object.animation,
          ...(component.object.animations ?? []),
        ]) {
          const clip = resolver.resolve(component, pointer);
          if (clip && !seen.has(clip)) {
            seen.add(clip);
            builder.legacyAnimations.push({ clip, rootPath: current });
          }
        }
      }
    const children = obj.children.map((p: any) =>
      visit(resolver.resolve(t, p), current),
    );
    if (children.length) node.children = children;
    visiting.delete(t);
    return index;
  }
  const modelRoot = visit(rootTransform, "", true);
  g.scenes[0].nodes.push(g.nodes.length);
  g.nodes.push({ name: "Scene", children: [modelRoot] });
  let avatarBones = new Map<number, number>();
  if (
    root.className === "Animator" &&
    root.object.hasTransformHierarchy === false
  ) {
    const avatar = resolver.resolve(root, root.object.avatar);
    if (!avatar) throw Error("Optimized Animator requires its Avatar");
    avatarBones = restoreAvatarSkeleton(builder, paths, avatar.object);
  }
  // Assimp resolves animation channels and bones by name. Keep node names unique.
  const usedNames = new Set<string>();
  function uniqueName(name: string) {
    const base = name;
    let suffix = 2;
    while (usedNames.has(name)) name = base + "_" + suffix++;
    usedNames.add(name);
    return name;
  }
  for (const node of g.nodes) node.name = uniqueName(node.name);
  const materialMap = new Map<any, number>(),
    textureMap = new Map<any, number>();
  async function material(info: any): Promise<number> {
    if (materialMap.has(info)) return materialMap.get(info)!;
    const obj = info?.object,
      props = obj?.savedProperties,
      m: any = {
        name: obj?.name ?? "Material",
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
      };
    const color = props?.colors.find((p: any) =>
      ["_Color", "_BaseColor"].includes(p.key),
    )?.value;
    if (color)
      m.pbrMetallicRoughness.baseColorFactor = ["r", "g", "b", "a"].map((k) =>
        Math.max(0, Math.min(1, color[k])),
      );
    for (const [keys, target] of [
      [["_MainTex", "_BaseMap"], "base"],
      [["_BumpMap"], "normal"],
      [["_EmissionMap"], "emission"],
    ] as const) {
      const env = props?.texEnvs.find((p: any) =>
        (keys as readonly string[]).includes(p.key),
      );
      if (!env) continue;
      const texture = resolver.resolve(info, env.value.texture);
      if (!texture) continue;
      if (texture.className !== "Texture2D")
        throw Error("Unsupported model texture " + texture.className);
      let index = textureMap.get(texture);
      if (index === undefined) {
        const t = texture.object;
        if (t.width * t.height > maxPixels)
          throw Error("Model texture exceeds maxTexturePixels");
        const data = t.data?.length
          ? t.data
          : resolver.resource(
              texture,
              t.streamData.path,
              t.streamData.offset,
              t.streamData.size,
            );
        const png = await convertTexture({
          data,
          width: t.width,
          height: t.height,
          format: t.textureFormat,
          version: t._version,
        });
        const image = g.images.length;
        g.images.push({
          name: t.name,
          mimeType: "image/png",
          bufferView: builder.view(png),
        });
        index = g.textures.length;
        g.textures.push({ source: image });
        textureMap.set(texture, index);
      }
      if (target === "base")
        m.pbrMetallicRoughness.baseColorTexture = { index };
      else if (target === "normal") m.normalTexture = { index };
      else {
        m.emissiveTexture = { index };
        m.emissiveFactor = [1, 1, 1];
      }
    }
    if (
      (props?.floats.find((p: any) => p.key === "_Mode")?.value ?? 0) > 0 ||
      (m.pbrMetallicRoughness.baseColorFactor?.[3] ?? 1) < 1
    )
      m.alphaMode = "BLEND";
    const index = g.materials.length;
    g.materials.push(m);
    materialMap.set(info, index);
    return index;
  }
  for (const { info, node } of renderers) {
    const renderer = info.object,
      meshInfo =
        info.className === "SkinnedMeshRenderer"
          ? resolver.resolve(info, renderer.mesh)
          : (() => {
              const filter = resolver
                .components(resolver.gameObject(info))
                .find((o: any) => o.className === "MeshFilter");
              return filter
                ? resolver.resolve(filter, filter.object.mesh)
                : null;
            })();
    if (!meshInfo) continue;
    const mesh = meshInfo.object;
    if (!mesh._has_processed) await mesh.process();
    const count = mesh.vertices?.length;
    if (!count) throw Error("Mesh has no vertices");
    const attributes: any = {
      POSITION: builder.accessor(
        mesh.vertices.flatMap(position),
        "VEC3",
        5126,
        true,
      ),
    };
    if (mesh.normals?.length === count)
      attributes.NORMAL = builder.accessor(
        mesh.normals.flatMap(position),
        "VEC3",
      );
    if (mesh.tangents?.length === count)
      attributes.TANGENT = builder.accessor(
        mesh.tangents.flatMap((v: any) => {
          const a = vector(v, 4);
          a[0] *= -1;
          a[3] *= -1;
          return a;
        }),
        "VEC4",
      );
    for (let i = 0; i < 8; i++) {
      const uv = mesh["uv" + i];
      if (uv?.length === count)
        attributes["TEXCOORD_" + i] = builder.accessor(
          uv.flatMap((v: any) => {
            const a = vector(v, 2);
            return [a[0], 1 - a[1]];
          }),
          "VEC2",
        );
    }
    if (mesh.colors?.length === count)
      attributes.COLOR_0 = builder.accessor(
        mesh.colors.flatMap((v: any) => vector(v, 4)),
        "VEC4",
      );
    let skin: number | undefined;
    if (
      renderer.bones?.length ||
      (info.className === "SkinnedMeshRenderer" && mesh.bindPose?.length)
    ) {
      if (
        (renderer.bones?.length &&
          mesh.bindPose?.length !== renderer.bones.length) ||
        mesh.skin?.length !== count
      )
        throw Error("Mesh bone/weight count mismatch");
      const joints = mesh.bindPose.map((_: any, bi: number) => {
        const pointer = renderer.bones?.[bi];
        if (pointer && BigInt(pointer.pathID ?? 0) !== 0n) {
          const t = resolver.resolve(info, pointer),
            node = transforms.get(t);
          if (node === undefined)
            throw Error("Bone is outside exported hierarchy");
          return node;
        }
        const node = avatarBones.get(mesh.boneNameHashes?.[bi]);
        if (node === undefined)
          throw Error("Missing Avatar bone mapping for bind pose " + bi);
        return node;
      });
      const weights: number[] = [],
        ids: number[] = [];
      for (const v of mesh.skin) {
        let sum = 0;
        for (let j = 0; j < 4; j++) {
          if (!Number.isFinite(v.weight[j]) || v.weight[j] < 0)
            throw Error("Invalid bone weight");
          sum += v.weight[j];
        }
        // Unity's one-influence layout stores only the bone index; its weight is implicit.
        if (
          !sum &&
          mesh.vertexData?.channels?.[12]?.dimension === 0 &&
          mesh.vertexData?.channels?.[13]?.dimension === 1
        ) {
          v.weight[0] = 1;
          sum = 1;
        }
        if (!sum) throw Error("Vertex has no bone weights");
        for (let j = 0; j < 4; j++) {
          const id = v.boneIndex[j];
          if (
            v.weight[j] &&
            (!Number.isInteger(id) || id < 0 || id >= joints.length)
          )
            throw Error("Bone index out of range");
          weights.push(v.weight[j] / sum);
          ids.push(v.weight[j] ? id : 0);
        }
      }
      attributes.JOINTS_0 = builder.accessor(ids, "VEC4", 5123);
      attributes.WEIGHTS_0 = builder.accessor(weights, "VEC4");
      const matrices = mesh.bindPose.flatMap((m: any) =>
        Array.from({ length: 16 }, (_, i) => {
          const row = i % 4,
            col = Math.floor(i / 4);
          return (
            m.values[row * 4 + col] *
            ((row === 0 ? -1 : 1) * (col === 0 ? -1 : 1))
          );
        }),
      );
      skin = g.skins.length;
      g.skins.push({
        joints,
        inverseBindMatrices: builder.accessor(matrices, "MAT4"),
      });
    }
    const targets: any[] = [],
      targetNames: string[] = [],
      morphChannels: MorphChannel[] = [],
      weights: number[] = [];
    for (const [channelIndex, channel] of (
      mesh.shapes?.channels ?? []
    ).entries()) {
      const binding = {
        name: channel.name,
        start: targets.length,
        weights:
          mesh.shapes.fullWeights?.slice(
            channel.frameIndex,
            channel.frameIndex + channel.frameCount,
          ) ??
          Array.from({ length: channel.frameCount }, (_, i) => (i + 1) * 100),
      };
      morphChannels.push(binding);
      weights.push(
        ...morphWeights(
          binding,
          renderer.blendShapeWeights?.[channelIndex] ?? 0,
        ),
      );
      // Export every in-between frame as an explicit target instead of discarding it.
      for (let frame = 0; frame < channel.frameCount; frame++) {
        const shape = mesh.shapes.shapes[channel.frameIndex + frame];
        if (!shape) throw Error("Missing blend shape frame");
        const delta = Array(count * 3).fill(0);
        for (const v of mesh.shapes.vertices.slice(
          shape.firstVertex,
          shape.firstVertex + shape.vertexCount,
        )) {
          if (v.index >= count) throw Error("Blend shape index out of range");
          position(v.vertex).forEach((n, i) => (delta[v.index * 3 + i] = n));
        }
        const target: any = { POSITION: builder.accessor(delta, "VEC3") };
        for (const [key, flag, attribute] of [
          ["normal", "hasNormals", "NORMAL"],
          ["tangent", "hasTangents", "TANGENT"],
        ])
          if (shape[flag] && attributes[attribute] !== undefined) {
            const ds = Array(count * 3).fill(0);
            for (const v of mesh.shapes.vertices.slice(
              shape.firstVertex,
              shape.firstVertex + shape.vertexCount,
            ))
              position(v[key]).forEach((n, i) => (ds[v.index * 3 + i] = n));
            target[attribute] = builder.accessor(ds, "VEC3");
          }
        targets.push(target);
        targetNames.push(
          channel.name + (channel.frameCount > 1 ? "_" + frame : ""),
        );
      }
    }
    const primitives = [];
    for (const [i, sub] of mesh.subMeshes.entries()) {
      const indices = meshTriangles(mesh, sub, true);
      if (!indices.length) continue;
      primitives.push({
        attributes,
        indices: builder.accessor(indices, "SCALAR", 5125),
        material: await material(
          resolver.resolve(info, renderer.materials?.[i]),
        ),
        ...(targets.length ? { targets } : {}),
        mode: 4,
      });
    }
    if (!primitives.length) throw Error("Mesh has no polygons");
    const meshIndex = g.meshes.length;
    g.meshes.push({
      name: mesh.name,
      primitives,
      ...(targets.length ? { weights, extras: { targetNames } } : {}),
    });
    // Multiple renderers on a Transform remain separate child mesh nodes.
    const meshNode = g.nodes.length;
    g.nodes.push({
      name: uniqueName(mesh.name),
      mesh: meshIndex,
      extras: { unityVisibility: renderer.enabled === false ? 0 : 1 },
      ...(skin !== undefined ? { skin } : {}),
    });
    (g.nodes[node].children ??= []).push(meshNode);
    builder.renderers.set(node, [
      ...(builder.renderers.get(node) ?? []),
      meshNode,
    ]);
    if (targets.length) {
      const bindings = builder.morphs.get(node) ?? [];
      bindings.push({
        node: meshNode,
        defaults: weights,
        channels: morphChannels,
      });
      builder.morphs.set(node, bindings);
    }
  }
  return { builder, transforms, paths };
}
