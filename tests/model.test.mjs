import test from "node:test";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import assert from "node:assert/strict";
import { buildModel, ObjectResolver } from "../dist/model.js";
import { convertModel } from "../dist/fbx.js";
import {
  addAnimation,
  crc32,
  streamedCurves,
  evaluateCurve,
} from "../dist/animation.js";
import { vertexComponentSize } from "../dist/mesh-layout.js";
import { Writer } from "./helpers/serialized.mjs";
function scene() {
  const file = {
    objects: [],
    getObjectByPathID(id) {
      return this.objects.find((o) => o.pathID === id);
    },
  };
  const make = (id, className, object) => {
    const info = { pathID: BigInt(id), className, object, assetFile: file };
    file.objects.push(info);
    return info;
  };
  const ptr = (n) => ({ fileID: 0, pathID: BigInt(n) });
  const go = make(1, "GameObject", {
    name: "Model",
    components: [ptr(2), ptr(3)],
  });
  make(2, "Transform", {
    gameObject: ptr(1),
    localPosition: { x: 2, y: 3, z: 4 },
    localRotation: { x: 0, y: 0, z: 0, w: 1 },
    localScale: { x: 1, y: 1, z: 1 },
    children: [],
    father: ptr(0),
  });
  make(3, "SkinnedMeshRenderer", {
    gameObject: ptr(1),
    mesh: ptr(4),
    bones: [ptr(2)],
    materials: [],
  });
  make(4, "Mesh", {
    name: "Triangle",
    _has_processed: true,
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    normals: [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ],
    uv0: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    use16BitIndices: true,
    indexBuffer: [0, 1, 2],
    subMeshes: [
      { firstByte: 0, indexCount: 3, topology: "Triangles", baseVertex: 0 },
    ],
    bindPose: [{ values: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    skin: Array.from({ length: 3 }, () => ({
      weight: [1, 0, 0, 0],
      boneIndex: [0, 0, 0, 0],
    })),
  });
  return {
    go,
    file,
    resolver: new ObjectResolver([{ file, name: "CAB-test", manager: {} }]),
  };
}
const findNode = (node, name) =>
  node.name === name
    ? node
    : (node.children ?? []).map((n) => findNode(n, name)).find(Boolean);
test("model exports real FBX geometry, UVs, bone weights, transforms and animation; independent FBX importer reads them back", async () => {
  const { go, resolver } = scene(),
    { builder, paths } = await buildModel(go, resolver, 1024);
  const zero = { x: 0, y: 0, z: 0 };
  assert.equal(
    addAnimation(builder, paths, {
      name: "Move",
      sampleRate: 2,
      positionCurves: [
        {
          path: "",
          curve: {
            curve: [
              {
                time: 0,
                value: zero,
                inSlope: zero,
                outSlope: { x: 1, y: 0, z: 0 },
              },
              {
                time: 1,
                value: { x: 1, y: 0, z: 0 },
                inSlope: { x: 1, y: 0, z: 0 },
                outSlope: zero,
              },
            ],
          },
        },
      ],
    }),
    1,
  );
  const [fbx] = await convertModel(builder.finish(), "model.glb");
  assert.equal(fbx.path, "model.fbx");
  assert.equal(
    Buffer.from(fbx.data).subarray(0, 20).toString(),
    "Kaydara FBX Binary  ",
  );
  const [roundtrip] = await convertModel(fbx.data, "model.fbx", "assjson"),
    j = JSON.parse(Buffer.from(roundtrip.data));
  assert.equal(j.meshes.length, 1);
  assert.equal(j.meshes[0].faces.length, 1);
  assert.equal(j.meshes[0].bones.length, 1);
  assert.equal(j.meshes[0].bones[0].weights.length, 3);
  assert.equal(j.animations.length, 1);
  assert.equal(j.animations[0].channels.length, 1);
  const keys = j.animations[0].channels[0].positionkeys;
  assert.deepEqual(keys[0][1], [0, 0, 0]);
  assert.deepEqual(keys.at(-1)[1], [-1, 0, 0]);
  assert.ok(findNode(j.rootnode, "Model"));
});
test("resolver respects file-local IDs, resolves declared externals, and rejects ambiguous/missing references", () => {
  const { go, file, resolver } = scene();
  const other = {
    objects: [],
    getObjectByPathID: () => ({ object: { name: "external" } }),
  };
  file.externals = [{ path: "archive:/x/CAB-other" }];
  resolver.files.push({ file: other, name: "CAB-other", manager: {} });
  assert.equal(resolver.resolve(go, { fileID: 0, pathID: 1n }), go);
  assert.equal(
    resolver.resolve(go, { fileID: 1, pathID: 1n }).object.name,
    "external",
  );
  assert.throws(
    () => resolver.resolve(go, { fileID: 0, pathID: 999n }),
    /Missing/,
  );
  resolver.files.push({ file: other, name: "CAB-other", manager: {} });
  assert.throws(
    () => resolver.resolve(go, { fileID: 1, pathID: 1n }),
    /external/,
  );
});
test("model rejects invalid bone indices and cyclic hierarchies", async () => {
  let x = scene();
  x.file.objects[3].object.skin[0].boneIndex[0] = 2;
  await assert.rejects(buildModel(x.go, x.resolver, 1024), /Bone index/);
  x = scene();
  x.file.objects[1].object.children = [{ fileID: 0, pathID: 2n }];
  await assert.rejects(buildModel(x.go, x.resolver, 1024), /cycle/);
});
test("2019 vertex formats use 32-bit bone indices, preserving stream stride and pre-2019 format numbering", () => {
  assert.equal(vertexComponentSize(10, [2022, 3]), 4);
  assert.equal(vertexComponentSize(10, [2018, 4]), 2);
  assert.equal(vertexComponentSize(4, [2022, 3]), 2);
  assert.equal(vertexComponentSize(4, [2018, 4]), 1);
  assert.throws(() => vertexComponentSize(99, [2022, 3]));
});
test("streamed animation decodes value and derivative separately, evaluates cubic polynomial and rejects corrupt data", () => {
  const b = new Writer()
    .float(0)
    .i32(1)
    .i32(0)
    .float(1)
    .float(2)
    .float(3)
    .float(4)
    .end();
  const curves = streamedCurves(b, 1);
  assert.equal(curves[0][0].value, 4);
  assert.equal(evaluateCurve(curves[0], 2), 26);
  assert.throws(() => streamedCurves(b.subarray(0, -1), 1), /Truncated/);
  assert.throws(() => streamedCurves(b, 0), /range/);
});
test("dense and constant Transform bindings export animated channels rather than losing optimized curves", async () => {
  const { go, resolver } = scene(),
    { builder, paths } = await buildModel(go, resolver, 1024);
  const clip = {
    name: "Dense",
    sampleRate: 1,
    nodeBindings: [{ typeID: 4, attribute: 1, path: 0 }],
    muscleClip: {
      startTime: 0,
      stopTime: 1,
      clip: {
        streamedClip: { curveCount: 0, data: { data: new Uint8Array() } },
        denseClip: {
          frameCount: 2,
          curveCount: 3,
          sampleRate: 1,
          beginTime: 0,
          samples: [0, 0, 0, 2, 3, 4],
        },
        constantClip: { data: [] },
      },
    },
  };
  assert.equal(addAnimation(builder, paths, clip), 1);
  const [fbx] = await convertModel(builder.finish(), "dense.glb");
  const [back] = await convertModel(fbx.data, "dense.fbx", "assjson");
  const j = JSON.parse(Buffer.from(back.data));
  assert.deepEqual(
    j.animations[0].channels[0].positionkeys.at(-1)[1],
    [-2, 3, 4],
  );
});
test("FBX preserves blend shape geometry", async () => {
  const x = scene(),
    mesh = x.file.objects[3].object;
  mesh.shapes = {
    channels: [{ name: "Smile", frameCount: 1, frameIndex: 0 }],
    shapes: [{ firstVertex: 0, vertexCount: 1 }],
    vertices: [{ index: 0, vertex: { x: 1, y: 0, z: 0 } }],
  };
  const { builder } = await buildModel(x.go, x.resolver, 1024);
  const [fbx] = await convertModel(builder.finish(), "shape.glb", "fbxa");
  assert.match(Buffer.from(fbx.data).toString(), /BlendShape/);
});

test("unsupported muscle animation bindings fail explicitly instead of exporting a static success", async () => {
  for (const typeID of [95]) {
    const { go, resolver } = scene(),
      { builder, paths } = await buildModel(go, resolver, 1024);
    const clip = {
      name: "Unsupported",
      sampleRate: 1,
      nodeBindings: [{ typeID, attribute: 0, path: 0 }],
      muscleClip: {
        startTime: 0,
        stopTime: 1,
        clip: {
          streamedClip: { curveCount: 0, data: { data: new Uint8Array() } },
          denseClip: {
            frameCount: 2,
            curveCount: 1,
            sampleRate: 1,
            beginTime: 0,
            samples: [0, 100],
          },
          constantClip: { data: [] },
        },
      },
    };
    assert.throws(() => addAnimation(builder, paths, clip), {
      code: "UNSUPPORTED_OPERATION",
    });
    assert.equal(builder.document.animations.length, 0);
  }
});

test("Unity path CRC32 and animation sample rate validation", async () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const { go, resolver } = scene(),
    { builder, paths } = await buildModel(go, resolver, 1024);
  for (const sampleRate of [-1, NaN, Infinity])
    assert.throws(
      () => addAnimation(builder, paths, { sampleRate }),
      /sample rate/,
    );
});
test("FBX morph animation survives the independent importer with exact weights and key times", async () => {
  const x = scene(),
    mesh = x.file.objects[3].object;
  mesh.shapes = {
    channels: [{ name: "Smile", frameCount: 1, frameIndex: 0 }],
    shapes: [{ firstVertex: 0, vertexCount: 1 }],
    fullWeights: [100],
    vertices: [{ index: 0, vertex: { x: 1, y: 0, z: 0 } }],
  };
  const { builder } = await buildModel(x.go, x.resolver, 1024),
    g = builder.document,
    node = g.nodes.findIndex((n) => n.mesh === 0);
  assert.equal(
    addAnimation(builder, new Map([["", 0]]), {
      name: "Smile",
      sampleRate: 2,
      nodeBindings: [
        {
          typeID: 137,
          attribute: crc32(Buffer.from("blendShape.Smile")),
          path: 0,
        },
      ],
      muscleClip: {
        startTime: 0,
        stopTime: 1,
        clip: {
          streamedClip: { curveCount: 0, data: { data: new Uint8Array() } },
          denseClip: {
            frameCount: 3,
            curveCount: 1,
            sampleRate: 2,
            beginTime: 0,
            samples: [0, 25, 100],
          },
          constantClip: { data: [] },
        },
      },
    }),
    1,
  );
  const [fbx] = await convertModel(builder.finish(), "morph.glb");
  const tree = new FBXLoader().parse(Uint8Array.from(fbx.data).buffer, "");
  assert.equal(tree.animations.length, 1);
  const track = tree.animations[0].tracks.find((t) =>
    t.name.includes("morphTargetInfluences"),
  );
  assert.ok(track);
  assert.deepEqual([...track.times], [0, 0.5, 1]);
  assert.deepEqual([...track.values], [0, 0.25, 1]);
});
test("optimized Animator restores stripped bones from Avatar default pose and binds by hash", async () => {
  const x = scene(),
    file = x.file;
  file.objects[2].object.bones = [];
  file.objects[3].object.boneNameHashes = [123];
  const avatar = {
    pathID: 5n,
    className: "Avatar",
    assetFile: file,
    object: {
      tos: [
        { key: 0, value: "" },
        { key: 123, value: "Restored" },
      ],
      avatar: {
        avatarSkeleton: {
          id: [0, 123],
          nodes: [{ parentID: -1 }, { parentID: 0 }],
        },
        defaultPose: {
          transforms: [
            {
              t: { x: 0, y: 0, z: 0 },
              q: { x: 0, y: 0, z: 0, w: 1 },
              s: { x: 1, y: 1, z: 1 },
            },
            {
              t: { x: 0, y: 2, z: 0 },
              q: { x: 0, y: 0, z: 0, w: 1 },
              s: { x: 1, y: 1, z: 1 },
            },
          ],
        },
      },
    },
  };
  file.objects.push(avatar);
  const animator = {
    className: "Animator",
    assetFile: file,
    object: {
      gameObject: { fileID: 0, pathID: 1n },
      avatar: { fileID: 0, pathID: 5n },
      hasTransformHierarchy: false,
    },
  };
  const { builder, paths } = await buildModel(animator, x.resolver, 1024);
  assert.ok(paths.has("Restored"));
  const [fbx] = await convertModel(builder.finish(), "optimized.glb");
  const tree = new FBXLoader().parse(Uint8Array.from(fbx.data).buffer, "");
  const bone = tree.getObjectByName("Restored");
  assert.ok(bone.isBone);
  assert.equal(bone.position.y, 2);
  let skin;
  tree.traverse((n) => {
    if (n.isSkinnedMesh) skin = n;
  });
  assert.equal(skin.skeleton.bones[0].name, "Restored");
  assert.equal(skin.geometry.attributes.skinWeight.getX(0), 1);
  avatar.object.avatar.avatarSkeleton.nodes[1].parentID = 1;
  await assert.rejects(buildModel(animator, x.resolver, 1024), /parent-first/);
});
test("implicit single-bone weights and packed rotation keys produce an animated skinned FBX", async () => {
  const x = scene(),
    mesh = x.file.objects[3].object;
  mesh.vertexData = {
    channels: Array.from({ length: 14 }, (_, i) => ({
      dimension: i === 13 ? 1 : 0,
    })),
  };
  for (const v of mesh.skin) v.weight = [0, 0, 0, 0];
  const { builder, paths } = await buildModel(x.go, x.resolver, 1024);
  const pack = (entries) => {
    const out = Buffer.alloc(4);
    let at = 0;
    for (const [v, bits] of entries)
      for (let i = 0; i < bits; i++, at++)
        out[at >>> 3] |= (Math.floor(v / 2 ** i) & 1) << (at & 7);
    return out;
  };
  const identity = pack([
      [3, 3],
      [256, 9],
      [512, 10],
      [512, 10],
    ]),
    turn = pack([
      [2, 3],
      [512, 10],
      [512, 10],
      [256, 9],
    ]);
  assert.equal(
    addAnimation(builder, paths, {
      name: "Packed",
      sampleRate: 2,
      compressedRotationCurves: [
        {
          path: "",
          times: { length: 2, bitSize: 8, data: Uint8Array.of(0, 100) },
          values: { length: 2, data: Buffer.concat([identity, turn]) },
        },
      ],
    }),
    1,
  );
  const [fbx] = await convertModel(builder.finish(), "packed.glb");
  const tree = new FBXLoader().parse(Uint8Array.from(fbx.data).buffer, "");
  const track = tree.animations[0].tracks.find(
    (t) => t.name === "Model.quaternion",
  );
  assert.ok(track);
  assert.equal(track.times.at(-1), 1);
  assert.ok(Math.abs(track.values.at(-2)) > 0.99);
});
test("legacy morph curves combine simultaneous channels, progressive frames and weighted tangents", async () => {
  const x = scene(),
    mesh = x.file.objects[3].object;
  mesh.shapes = {
    channels: [
      { name: "Smile", frameCount: 2, frameIndex: 0 },
      { name: "Blink", frameCount: 1, frameIndex: 2 },
    ],
    shapes: Array.from({ length: 3 }, () => ({
      firstVertex: 0,
      vertexCount: 1,
    })),
    fullWeights: [50, 100, 100],
    vertices: [{ index: 0, vertex: { x: 1, y: 0, z: 0 } }],
  };
  const { builder, paths } = await buildModel(x.go, x.resolver, 1024);
  assert.equal(
    addAnimation(builder, paths, {
      name: "Face",
      sampleRate: 3.2,
      floatCurves: [
        {
          classID: 137,
          attribute: "blendShape.Smile",
          path: "",
          curve: {
            curve: [
              {
                time: 0,
                value: 0,
                outSlope: 200,
                weightedMode: 2,
                outWeight: 0.1,
              },
              {
                time: 1,
                value: 100,
                inSlope: 0,
                weightedMode: 1,
                inWeight: 0.6,
              },
            ],
          },
        },
        {
          classID: 137,
          attribute: "blendShape.Blink",
          path: "",
          curve: {
            curve: [
              { time: 0, value: 25, outSlope: 0 },
              { time: 1, value: 25, inSlope: 0 },
            ],
          },
        },
      ],
    }),
    1,
  );
  const [fbx] = await convertModel(builder.finish(), "face.glb");
  const tree = new FBXLoader().parse(Uint8Array.from(fbx.data).buffer, "");
  const tracks = tree.animations[0].tracks;
  assert.equal(tracks.length, 3);
  assert.ok(Math.abs(tracks[0].values[1] - 0.85) < 1e-6);
  assert.ok(Math.abs(tracks[1].values[1] - 0.15) < 1e-6);
  assert.ok(tracks[2].values.every((v) => v === 0.25));
});
test("late-starting legacy curves preserve the common clip clock and duplicate clip names remain distinct", async () => {
  const { go, resolver } = scene(),
    { builder, paths } = await buildModel(go, resolver, 1024),
    zero = { x: 0, y: 0, z: 0 };
  const clip = {
    name: "Delayed",
    sampleRate: 2,
    positionCurves: [
      {
        path: "",
        curve: {
          curve: [
            { time: 0.5, value: zero, inSlope: zero, outSlope: zero },
            {
              time: 1,
              value: { x: 2, y: 0, z: 0 },
              inSlope: zero,
              outSlope: zero,
            },
          ],
        },
      },
    ],
  };
  addAnimation(builder, paths, clip);
  addAnimation(builder, paths, clip);
  const [fbx] = await convertModel(builder.finish(), "delay.glb");
  const tree = new FBXLoader().parse(Uint8Array.from(fbx.data).buffer, "");
  assert.deepEqual(
    tree.animations.map((a) => a.name),
    ["Delayed", "Delayed_2"],
  );
  const track = tree.animations[0].tracks.find(
    (t) => t.name === "Model.position",
  );
  assert.equal(track.times[0], 0.5);
  assert.equal(track.times.at(-1), 1);
});
test("Renderer.enabled becomes stepped FBX Visibility curves, preserving static defaults", async () => {
  const { go, resolver } = scene(),
    { builder, paths } = await buildModel(go, resolver, 1024);
  assert.equal(
    addAnimation(builder, paths, {
      name: "Visible",
      sampleRate: 1,
      nodeBindings: [{ typeID: 25, attribute: 3305885265, path: 0 }],
      muscleClip: {
        startTime: 0,
        stopTime: 1,
        clip: {
          streamedClip: { curveCount: 0, data: { data: new Uint8Array() } },
          denseClip: {
            curveCount: 1,
            frameCount: 2,
            sampleRate: 1,
            beginTime: 0,
            samples: [1, 0],
          },
          constantClip: { data: [] },
        },
      },
    }),
    1,
  );
  const [fbx] = await convertModel(builder.finish(), "visible.glb");
  const { parseFbx, value } = await import("../dist/fbx-document.js");
  const doc = parseFbx(fbx.data),
    objects = doc.nodes.find((n) => n.name === "Objects").children,
    links = doc.nodes.find((n) => n.name === "Connections").children;
  const visibility = links.find(
    (n) => n.properties.length === 4 && value(n.properties[3]) === "Visibility",
  );
  assert.ok(visibility);
  const curve = objects.find((n) => n.name === "AnimationCurve");
  assert.deepEqual(
    value(curve.children.find((n) => n.name === "KeyValueFloat").properties[0]),
    [1, 0],
  );
  assert.deepEqual(
    value(curve.children.find((n) => n.name === "KeyAttrFlags").properties[0]),
    [2],
  );
  assert.equal(fbx.data.length % 16, 0);
});
test("legacy Animation components collect their bound clips once; skip does not require missing animation references", async () => {
  const x = scene(),
    clip = {
      className: "AnimationClip",
      pathID: 5n,
      assetFile: x.file,
      object: { name: "Legacy" },
    };
  x.file.objects.push(clip);
  const pointer = { fileID: 0, pathID: 5n };
  x.file.objects.push({
    className: "Animation",
    pathID: 6n,
    assetFile: x.file,
    object: { animation: pointer, animations: [pointer] },
  });
  x.go.object.components.push({ fileID: 0, pathID: 6n });
  const { builder } = await buildModel(x.go, x.resolver, 1024);
  assert.equal(builder.legacyAnimations.length, 1);
  assert.equal(builder.legacyAnimations[0].clip, clip);
  assert.equal(builder.legacyAnimations[0].rootPath, "");
  x.file.objects[5].object.animation = { fileID: 0, pathID: 999n };
  await assert.rejects(buildModel(x.go, x.resolver, 1024), /Missing/);
  assert.equal(
    (await buildModel(x.go, x.resolver, 1024, false)).builder.legacyAnimations
      .length,
    0,
  );
});
