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
