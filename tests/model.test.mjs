import test from "node:test";
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

test("unsupported muscle and morph animation bindings fail explicitly instead of exporting a static success", async () => {
  for (const typeID of [95, 137]) {
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
