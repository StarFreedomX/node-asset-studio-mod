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
    const installed = path.join(consumer, "node_modules/node-asset-studio-mod");
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
    const astcGolden = JSON.parse(
      await readFile(
        new URL("./fixtures/astc-comment-banner-pixels.json", import.meta.url),
      ),
    );
    await writeFile(
      path.join(consumer, "check.mjs"),
      `
      import { readFile } from 'node:fs/promises';
      import assert from 'node:assert/strict';
      import { readAssets } from 'node-asset-studio-mod';
      import { createHash } from 'node:crypto';
      import { rgbaPng } from './png.mjs';
      const result = await readAssets(await readFile(process.env.FIXTURE), { unityVersion: '2022.3.62f1', log: false });
      assert.equal(result.exportedCount, 4);
      assert.ok(result.files.every(f => Buffer.from(f.data).subarray(0, 8).toString('hex') === '89504e470d0a1a0a'));
      if (process.env.ASTC_FIXTURE) {
        const astc = await readAssets(await readFile(process.env.ASTC_FIXTURE), { unityVersion:'2022.3.62f1', assetType:'tex2d', filterByName:'comment_banner_band4_chapter03', log:false });
        assert.equal(astc.exportedCount,1);
        assert.equal(createHash('sha256').update(rgbaPng(Buffer.from(astc.files[0].data)).data).digest('hex'), ${JSON.stringify(astcGolden.rgbaSha256)});
      }
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
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
