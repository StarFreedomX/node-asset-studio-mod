import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readAssets } from "../dist/index.js";
import { convertModel } from "../dist/fbx.js";
const root = process.env.ASSET_STUDIO_TEST_MODEL_INPUT;
test(
  "Garupa CDN samples: Animator skeletons, embedded textures and splitObjects survive FBX readback",
  { skip: !root },
  async () => {
    for (const [input, mode, expected] of [
      [
        "star3d/character/head/015_cos_live_event_244_013_ur",
        "animator",
        [[3, 0]],
      ],
      [
        "star3d/character/costume/016_cos_collabo_i_1",
        "animator",
        [
          [78, 0],
          [78, 1],
        ],
      ],
      [
        "star3d/props/102_01",
        "splitObjects",
        [
          [0, 1],
          [0, 1],
        ],
      ],
    ]) {
      const result = await readAssets(path.join(root, input), {
        unityVersion: "2022.3.62f1",
        mode,
        log: false,
      });
      assert.equal(result.files.length, expected.length);
      for (const [i, file] of result.files.entries()) {
        assert.match(file.path, /\.fbx$/);
        const [back] = await convertModel(file.data, file.path, "assjson"),
          scene = JSON.parse(Buffer.from(back.data));
        assert.equal(scene.meshes.length, 1);
        assert.equal(scene.meshes[0].bones?.length ?? 0, expected[i][0]);
        assert.equal(scene.textures?.length ?? 0, expected[i][1]);
        assert.ok(scene.meshes[0].faces.length > 0);
      }
    }
  },
);

test(
  "real Humanoid clip fails explicitly; caller-requested scale survives FBX conversion",
  { skip: !root },
  async () => {
    await assert.rejects(
      readAssets(root, {
        unityVersion: "2022.3.62f1",
        mode: "animator",
        fbxAnimation: "all",
        log: false,
      }),
      { code: "UNSUPPORTED_OPERATION" },
    );
    const result = await readAssets(
      path.join(root, "star3d/character/head/015_cos_live_event_244_013_ur"),
      {
        unityVersion: "2022.3.62f1",
        mode: "animator",
        fbxScaleFactor: 2,
        log: false,
      },
    );
    const [back] = await convertModel(
        result.files[0].data,
        "model.fbx",
        "assjson",
      ),
      scene = JSON.parse(Buffer.from(back.data));
    const find = (n) =>
      n.name === "Scale" ? n : (n.children ?? []).map(find).find(Boolean);
    const scale = find(scene.rootnode);
    assert.ok(scale);
    assert.equal(scale.transformation[0], 2);
    assert.equal(scale.transformation[5], 2);
    assert.equal(scale.transformation[10], 2);
  },
);

test(
  "real Kasumi head + both cute lipsync clips export matching named FBX morph tracks",
  { skip: !process.env.ASSET_STUDIO_TEST_LIPSYNC_INPUT },
  async () => {
    const fs = await import("node:fs/promises"),
      os = await import("node:os"),
      { readFbx } = await import("./helpers/fbx.mjs");
    const root = process.env.ASSET_STUDIO_TEST_LIPSYNC_INPUT,
      temp = await fs.mkdtemp(path.join(os.tmpdir(), "asset-lipsync-"));
    try {
      await fs.copyFile(
        path.join(root, "star3d/character/head/001_cos_live_default"),
        path.join(temp, "head"),
      );
      await fs.copyFile(
        path.join(root, "star3d/motions/lipsync/cute"),
        path.join(temp, "motion"),
      );
      const warnings = [];
      const result = await readAssets(temp, {
        unityVersion: "2022.3.62f1",
        mode: "animator",
        fbxAnimation: "all",
        log: false,
        onEvent: (e) => {
          if (e.type === "log" && e.level === "warning")
            warnings.push(e.message);
        },
      });
      assert.deepEqual(warnings, []);
      assert.equal(result.exportedCount, 1);
      const tree = readFbx(result.files[0].data);
      assert.deepEqual(
        tree.animations.map((a) => a.name),
        ["cute_lip_sync_001", "cute_lip_sync_without_voice_001"],
      );
      for (const clip of tree.animations) {
        assert.equal(clip.duration, 1);
        assert.equal(clip.tracks.length, 31);
        const active = clip.tracks.filter((t) => t.values.some((v) => v !== 0));
        assert.equal(active.length, 4);
        assert.ok(active.every((t) => t.times.length === 61));
        const expected = [
          1, 0.5841727256774902, 0.43551746010780334, 0.7089554071426392,
        ];
        for (let i = 0; i < active.length; i++)
          assert.ok(
            Math.abs(Math.max(...active[i].values) - expected[i]) < 1e-6,
          );
      }
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);
