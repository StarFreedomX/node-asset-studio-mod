// Optional consumer regression; requires that project's dependencies and downloaded bundles.
// The library itself is packed and installed offline into a fresh directory.
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const key of ["GARUPA_PROJECT", "GARUPA_DIFF", "GARUPA_BUNDLE_INPUT"])
  assert.ok(process.env[key], `Set ${key}`);
const project = path.resolve(process.env.GARUPA_PROJECT),
  diff = path.resolve(process.env.GARUPA_DIFF),
  input = path.resolve(process.env.GARUPA_BUNDLE_INPUT);
const require = createRequire(path.join(project, "package.json"));
const temporary = await fs.mkdtemp(path.join(tmpdir(), "garupa-migration-"));
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
      { cwd: root, encoding: "utf8" },
    ),
  );
  await fs.writeFile(
    path.join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
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
    { cwd: temporary, encoding: "utf8" },
  );
  const library = path.join(
    temporary,
    "node_modules",
    pack.name,
    "dist/index.js",
  );
  await build({
    entryPoints: [path.join(project, "src/getAssets.ts")],
    outfile: path.join(temporary, "getAssets.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfig: path.join(project, "tsconfig.json"),
    plugins: [
      {
        name: "installed-library",
        setup(b) {
          b.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.path === pack.name)
              return { path: library, external: true };
            if (args.path.startsWith("@/"))
              return {
                path: path
                  .join(project, "src", args.path.slice(2))
                  .replace(/\.js$/, ".ts"),
              };
            return { path: require.resolve(args.path), external: true };
          });
        },
      },
    ],
  });
  const output = path.join(temporary, "output");
  await fs.mkdir(output);
  await fs.copyFile(
    path.join(project, "AssetBundleInfoUrl.json"),
    path.join(output, "AssetBundleInfoUrl.json"),
  );
  const config = {
    axios: require.resolve("axios"),
    input,
    output,
    diff,
    package: pack.name + "@" + pack.version,
  };
  await fs.writeFile(
    path.join(temporary, "config.json"),
    JSON.stringify(config),
  );
  await fs.writeFile(path.join(temporary, "run.mjs"), `(${run.toString()})();`);
  const emptyPath = path.join(temporary, "empty-path");
  await fs.mkdir(emptyPath);
  execFileSync(process.execPath, [path.join(temporary, "run.mjs")], {
    cwd: temporary,
    env: {
      ...process.env,
      UNITY_VERSION: process.env.UNITY_VERSION ?? "2022.3.62f1",
      ASSET_PIPELINE_CONCURRENCY: "4",
      PATH: emptyPath,
      DOTNET_ROOT: path.join(temporary, "no-dotnet"),
    },
    stdio: "inherit",
    timeout: 120000,
  });
  if (process.env.GARUPA_REPORT)
    await fs.copyFile(
      path.join(temporary, "report.json"),
      path.resolve(process.env.GARUPA_REPORT),
    );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

async function run() {
  const fs = await import("node:fs/promises"),
    path = await import("node:path"),
    assert = (await import("node:assert/strict")).default;
  const config = JSON.parse(await fs.readFile("config.json"));
  const axios = (await import(config.axios)).default;
  const diff = JSON.parse(await fs.readFile(config.diff));
  const requests = [];
  // Replay the exact network bytes through the consumer's HTTP adapter; no network timing claim.
  axios.defaults.adapter = async (request) => {
    const match = new URL(request.url).pathname.match(
      /^\/Release\/(\d+\.\d+\.\d+\.\d+)_[^/]+\/Android\/(.+)$/,
    );
    assert.ok(match, request.url);
    assert.ok(!match[2].split("/").includes(".."));
    const data = await fs.readFile(path.join(config.input, match[1], match[2]));
    requests.push(request.url);
    return {
      data,
      status: 200,
      statusText: "OK",
      headers: {},
      config: request,
    };
  };
  const warnings = [];
  console.warn = (...args) => {
    warnings.push(args.join(" "));
    throw Error("Unexpected consumer warning/fallback: " + args.join(" "));
  };
  const { downloadDiffAssets } = await import("./getAssets.mjs");
  const result = await downloadDiffAssets(config.output, config.diff);
  assert.equal(result.total, diff.new.length + diff.change.length);
  assert.equal(result.failed, 0);
  assert.equal(requests.length, diff.new.length + 2 * diff.change.length);
  assert.equal(warnings.length, 0);
  const entries = await fs.readdir(result.output, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(result.output, path.join(e.parentPath, e.name)));
  if (diff.new.includes("gacha/screen/gacha1937")) {
    assert.equal(files.filter((f) => f.endsWith(".shader")).length, 1);
    const shader = await fs.readFile(
      path.join(
        result.output,
        files.find((f) => f.endsWith(".shader")),
      ),
      "utf8",
    );
    assert.match(shader, /OpEntryPoint/);
    assert.match(shader, /#ifdef VERTEX/);
    assert.equal(files.filter((f) => f.endsWith(".bin")).length, 0);
    assert.equal(files.length, 21);
  }
  const report = {
    package: config.package,
    inputs: requests.length,
    warnings,
    files,
    result,
  };
  await fs.writeFile("report.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      package: config.package,
      total: result.total,
      failed: result.failed,
      inputs: requests.length,
      files: files.length,
    }),
  );
}
