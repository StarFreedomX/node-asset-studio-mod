import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const input = process.env.ASSET_STUDIO_TEST_INPUT;
assert.ok(input, "Set ASSET_STUDIO_TEST_INPUT to the res014089 fixture");

test("published package installs offline without lifecycle downloads and runs with no external executable PATH", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "node-asset-package-"));
  try {
    const [pack] = JSON.parse(
      execFileSync(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          temporary,
          "--cache",
          path.join(temporary, "cache"),
        ],
        { encoding: "utf8" },
      ),
    );
    assert.ok(
      pack.files.every(
        (f) => !/\.(dll|exe|dylib|so|node|cs|csproj)$/i.test(f.path),
      ),
      "no native or .NET artifacts",
    );
    assert.ok(
      pack.files.every((f) => !/(^|\/)(bridge|dotnet)(\/|$)/i.test(f.path)),
    );
    for (const name of [
      "dist/vendor/assimp.cjs",
      "dist/vendor/assimp.wasm",
      "dist/licenses/LICENSE-assimp",
      "dist/licenses/LICENSE-assimpjs",
      "dist/licenses/LICENSE-dr_mp3",
      "dist/licenses/LICENSE-libvorbis",
      "dist/licenses/LICENSE-libogg",
      "dist/licenses/LICENSE-vgmstream",
    ])
      assert.ok(pack.files.some((f) => f.path === name));
    const consumer = path.join(temporary, "consumer");
    await mkdir(consumer);
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    // Install scripts are enabled: there must be no postinstall/setup dependency.
    execFileSync(
      "npm",
      [
        "install",
        "--offline",
        "--no-audit",
        "--no-fund",
        "--cache",
        path.join(temporary, "cache"),
        path.join(temporary, pack.filename),
      ],
      { cwd: consumer, encoding: "utf8" },
    );
    if (process.env.ASSET_STUDIO_TEST_LIPSYNC_INPUT) {
      await mkdir(path.join(consumer, "lipsync"));
      for (const [src, dest] of [
        ["star3d/character/head/001_cos_live_default", "head"],
        ["star3d/motions/lipsync/cute", "motion"],
      ])
        await copyFile(
          path.join(process.env.ASSET_STUDIO_TEST_LIPSYNC_INPUT, src),
          path.join(consumer, "lipsync", dest),
        );
    }
    const installed = path.join(consumer, "node_modules", pack.name);
    const manifest = JSON.parse(
      await readFile(path.join(installed, "package.json")),
    );
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
    for (const hook of ["preinstall", "install", "postinstall"])
      assert.equal(manifest.scripts?.[hook], undefined);
    for (const name of [
      "index",
      "transport",
      "worker",
      "engine",
      "texture-engine",
      "texture-worker",
      "texture-pool",
    ]) {
      const code = await readFile(
        path.join(installed, "dist", name + ".js"),
        "utf8",
      );
      assert.ok(
        !/child_process/.test(code),
        "runtime must not spawn a command",
      );
    }
    await copyFile(
      new URL("./helpers/png.mjs", import.meta.url),
      path.join(consumer, "png.mjs"),
    );
    await copyFile(
      new URL("./helpers/serialized.mjs", import.meta.url),
      path.join(consumer, "serialized.mjs"),
    );
    await copyFile(
      new URL("./helpers/audio.mjs", import.meta.url),
      path.join(consumer, "audio.mjs"),
    );
    for (const type of ["mp3", "ogg"])
      await copyFile(
        new URL(`./fixtures/audio/tone.${type}`, import.meta.url),
        path.join(consumer, `tone.${type}`),
      );
    const astcGolden = JSON.parse(
      await readFile(
        new URL("./fixtures/astc-comment-banner-pixels.json", import.meta.url),
      ),
    );
    await writeFile(
      path.join(consumer, "check.mjs"),
      `
      import { readFile, writeFile } from 'node:fs/promises';
      import assert from 'node:assert/strict';
      import { readAssets } from ${JSON.stringify(pack.name)};
      import { createHash } from 'node:crypto';
      import { rgbaPng } from './png.mjs';
      import {serialized,textureArray} from './serialized.mjs';
      import {audioClip,parseWav} from './audio.mjs';
      for (const type of ['mp3','ogg']) {
        const audio=await readAssets(audioClip(await readFile('tone.'+type)),{audioFormat:'wav',log:false});
        const w=parseWav(audio.files[0].data);assert.equal(w.rate,48000);assert.equal(w.channels,2);assert.equal(w.pcm.length,23040);
      }
      const result = await readAssets(await readFile(process.env.FIXTURE), { unityVersion: '2022.3.62f1', log: false });
      assert.equal(result.exportedCount, 4);
      assert.ok(result.files.every(f => Buffer.from(f.data).subarray(0, 8).toString('hex') === '89504e470d0a1a0a'));
      if (process.env.ASTC_FIXTURE) {
        const astc = await readAssets(await readFile(process.env.ASTC_FIXTURE), { unityVersion:'2022.3.62f1', assetType:'tex2d', filterByName:'comment_banner_band4_chapter03', log:false });
        assert.equal(astc.exportedCount,1);
        assert.equal(createHash('sha256').update(rgbaPng(Buffer.from(astc.files[0].data)).data).digest('hex'), ${JSON.stringify(astcGolden.rgbaSha256)});
      }
      if (process.env.SHADER_FIXTURE) {
        const shader = await readAssets(await readFile(process.env.SHADER_FIXTURE), { unityVersion:'2022.3.62f1', log:false });
        assert.equal(shader.exportedCount,13);
        const file=shader.files.find(f=>f.path.endsWith('.shader'));
        assert.match(Buffer.from(file.data).toString(), /OpEntryPoint Vertex/);
        assert.match(Buffer.from(file.data).toString(), /#ifdef VERTEX/);
      }
      const array=await readAssets(serialized([{type:187,data:textureArray({data:Buffer.alloc(32,255)})}]),{log:false});assert.equal(array.files.length,2);assert.deepEqual(array.files.map(f=>f.path),['array_1.png','array_2.png']);
      if(process.env.MODEL_FIXTURE){const model=await readAssets(process.env.MODEL_FIXTURE,{unityVersion:'2022.3.62f1',mode:'animator',log:false});assert.equal(model.exportedCount,1);assert.ok(model.files[0].path.endsWith('.fbx'));assert.equal(Buffer.from(model.files[0].data).subarray(0,20).toString(),'Kaydara FBX Binary  ');}
      if(process.env.LIPSYNC_FIXTURE){const result=await readAssets(process.env.LIPSYNC_FIXTURE,{unityVersion:'2022.3.62f1',mode:'animator',fbxAnimation:'all',log:false});assert.equal(result.exportedCount,1);await writeFile('lipsync.fbx',result.files[0].data);}
      console.log(JSON.stringify({ assets: result.assetCount, pngs: result.files.length }));
    `,
    );
    const emptyPath = path.join(temporary, "empty-path");
    await mkdir(emptyPath);
    const result = JSON.parse(
      execFileSync(process.execPath, [path.join(consumer, "check.mjs")], {
        cwd: consumer,
        env: {
          PATH: emptyPath,
          DOTNET_ROOT: path.join(temporary, "no-dotnet"),
          FIXTURE: path.resolve(input),
          ...(process.env.ASSET_STUDIO_TEST_LIPSYNC_INPUT
            ? { LIPSYNC_FIXTURE: path.join(consumer, "lipsync") }
            : {}),
          ...(process.env.ASSET_STUDIO_TEST_MODEL_INPUT
            ? {
                MODEL_FIXTURE: path.resolve(
                  process.env.ASSET_STUDIO_TEST_MODEL_INPUT,
                  "star3d/character/head/015_cos_live_event_244_013_ur",
                ),
              }
            : {}),
          ...(process.env.ASSET_STUDIO_TEST_SHADER_INPUT
            ? {
                SHADER_FIXTURE: path.resolve(
                  process.env.ASSET_STUDIO_TEST_SHADER_INPUT,
                ),
              }
            : {}),
          ...(process.env.ASSET_STUDIO_TEST_ASTC_INPUT
            ? {
                ASTC_FIXTURE: path.resolve(
                  process.env.ASSET_STUDIO_TEST_ASTC_INPUT,
                ),
              }
            : {}),
        },
        encoding: "utf8",
        timeout: 30000,
      }),
    );
    assert.deepEqual(result, { assets: 4, pngs: 4 });
    if (process.env.ASSET_STUDIO_TEST_LIPSYNC_INPUT) {
      const { readFbx } = await import("./helpers/fbx.mjs");
      const scene = readFbx(await readFile(path.join(consumer, "lipsync.fbx")));
      assert.equal(scene.animations.length, 2);
      assert.ok(
        scene.animations.every(
          (a) => a.tracks.length === 31 && a.duration === 1,
        ),
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
