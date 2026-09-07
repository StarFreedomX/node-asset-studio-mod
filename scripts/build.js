import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
await rm(path.join(root, "dist"), { recursive: true, force: true });
const tsc = spawnSync(
  process.execPath,
  [require.resolve("typescript/lib/tsc.js")],
  { cwd: root, stdio: "inherit" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
await build({
  entryPoints: [
    path.join(root, "src/engine.ts"),
    path.join(root, "src/texture-engine.ts"),
  ],
  outdir: path.join(root, "dist"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["./types.js"],
  plugins: [
    {
      name: "unityfs-node-adapter",
      setup(b) {
        b.onLoad({ filter: /unityfs-js[\\/]index\.js$/ }, async (args) => ({
          // The upstream synchronous loader races asynchronous codec startup.
          contents:
            (await readFile(args.path, "utf8")) +
            `
       import { getLz4BlockWASM, getLzmaBlockWASM } from './wasm/wasmDecoders.js';
       import { DecoderManager } from './decoders/DecoderManager.js';
       import { decodeAstcRgba } from ${JSON.stringify(path.join(root, "src/texture-codecs.ts"))};
       for (const block of [4, 5, 6, 8, 10, 12]) {
         for (const channels of ['rgb', 'rgba']) {
           DecoderManager.registerTextureDecoder('astc_' + channels + '_' + block + 'x' + block,
             (data, width, height) => decodeAstcRgba(data, width, height, block));
         }
       }
       if ((await Promise.all([getLz4BlockWASM(), getLzmaBlockWASM()])).some(codec => !codec)) {
         throw new Error('Could not initialize bundled compression codecs');
       }
     `,
          loader: "js",
        }));
        b.onLoad(
          { filter: /unityfs[\\/]bundleFile[\\/]reader\.js$/ },
          async (args) => {
            const contents = await readFile(args.path, "utf8");
            const old = "bundleFile.readers = []";
            if (!contents.includes(old))
              throw Error("Bundle extraction adapter needs review");
            return {
              contents: contents.replace(
                old,
                `bundleFile.assetManager = manager
            if (bundleFile.options.nodeExtractOnly) return
            ${old}`,
              ),
              loader: "js",
            };
          },
        );
        b.onLoad(
          { filter: /unityfs[\\/]classes[\\/]assetBundle\.js$/ },
          async (args) => {
            const contents = (await readFile(args.path, "utf8")).replaceAll(
              "\r\n",
              "\n",
            );
            const start = contents.indexOf(
              "    getContainer = function (objectInfo) {",
            );
            const end = contents.indexOf("\n}\n", start);
            if (start < 0 || end < 0)
              throw Error("AssetBundle container adapter needs review");
            return {
              contents:
                `import { buildContainerMap } from ${JSON.stringify(path.join(root, "src/containers.ts"))};\n` +
                contents.slice(0, start) +
                `
            getContainer(objectInfo) {
              this.containerMap ??= buildContainerMap(this.preloadTable, this.container);
              return this.containerMap.get(objectInfo.pathID);
            }
          ` +
                contents.slice(end),
              loader: "js",
            };
          },
        );
        b.onLoad(
          { filter: /unityfs[\\/]classes[\\/]mesh\.js$/ },
          async (args) => {
            let contents = (await readFile(args.path, "utf8")).replaceAll(
              "\r\n",
              "\n",
            );
            const start = contents.indexOf("function getVertexSize("),
              end = contents.indexOf("function getVertexFormatReader(", start);
            if (start < 0 || end < 0)
              throw Error("Mesh vertex format adapter needs review");
            contents =
              contents.slice(0, start) +
              "const getVertexSize = vertexComponentSize;\n\n" +
              contents.slice(end);
            const external = "await requestExternalData(this.streamData)";
            if (!contents.includes(external))
              throw Error("Mesh resource adapter needs review");
            contents = contents.replace(
              external,
              "this.reader.assetFile.context.resolveResource(this.streamData.path, this.streamData.offset, this.streamData.size)",
            );
            const trianglesStart = contents.indexOf("    getTriangles() {"),
              trianglesEnd = contents.indexOf(
                "    initMSkin()",
                trianglesStart,
              );
            if (trianglesStart < 0 || trianglesEnd < 0)
              throw Error("Mesh triangulation adapter needs review");
            contents =
              contents.slice(0, trianglesStart) +
              "    getTriangles() { this.indices = this.subMeshes.flatMap(sub => meshTriangles(this, sub)); }\n\n" +
              contents.slice(trianglesEnd);
            return {
              contents:
                "import {vertexComponentSize,meshTriangles} from " +
                JSON.stringify(path.join(root, "src/mesh-layout.ts")) +
                ";\n" +
                contents,
              loader: "js",
            };
          },
        );
        b.onLoad(
          { filter: /unityfs[\\/]classes[\\/]animationClip\.js$/ },
          async (args) => {
            let contents = (await readFile(args.path, "utf8")).replaceAll(
              "\r\n",
              "\n",
            );
            const start = contents.indexOf(
                "export class PackedQuaternionVector {",
              ),
              end = contents.indexOf(
                "export class CompressedAnimationCurve {",
                start,
              );
            if (start < 0 || end < 0)
              throw Error("Packed animation adapter needs review");
            contents = contents.slice(0, start) + contents.slice(end);
            const weighted = "if (reader.version[0] > 2018)";
            if (!contents.includes(weighted))
              throw Error("Weighted animation adapter needs review");
            contents = contents.replace(
              weighted,
              "if (reader.version[0] >= 2018)",
            );
            return {
              contents:
                "import {PackedQuaternionVector} from " +
                JSON.stringify(path.join(root, "src/packed-animation.ts")) +
                ";\n" +
                contents,
              loader: "js",
            };
          },
        );
        // Our outer Node Worker provides concurrency; the upstream browser pool is unused.
        b.onResolve({ filter: /\?worker&inline$/ }, () => ({
          path: "browser-worker-disabled",
          namespace: "node-adapter",
        }));
        b.onLoad({ filter: /.*/, namespace: "node-adapter" }, () => ({
          contents: "export default undefined;",
          loader: "js",
        }));
        // FMOD needs a separately licensed external runtime. Keep only the
        // bundled JS PCM/Vorbis/MPEG paths and fail explicitly for its fallback.
        b.onLoad({ filter: /vendor[\\/]fmod[\\/]fmod\.js$/ }, () => ({
          contents: `export default async function () {
            throw Object.assign(new Error('FMOD audio fallback is unavailable'), { code: 'UNSUPPORTED_OPERATION' });
          }`,
          loader: "js",
        }));
        b.onLoad({ filter: /fsb5[\\/]fsb5\.js$/ }, async (args) => {
          const contents = await readFile(args.path, "utf8");
          const old = "return this.getAudioFMOD()";
          if (!contents.includes(old))
            throw Error("unityfs-js audio adapter needs review");
          return {
            contents: contents.replace(
              old,
              `throw Object.assign(new Error('This audio format requires the unavailable FMOD fallback'), { code: 'UNSUPPORTED_OPERATION' })`,
            ),
            loader: "js",
          };
        });
        b.onLoad({ filter: /fsb5[\\/]vorbis\.js$/ }, async (args) => {
          let contents = await readFile(args.path, "utf8");
          // Packet subarrays have nonzero byte offsets inside an FSB payload.
          // Passing .buffer here reads the bank's header instead of the packet.
          contents = contents.replaceAll(
            "new BitReader(packet.buffer)",
            "new BitReader(packet)",
          );
          const old =
            "oggStream.writePacket(packetData, granulepos, false, isEOS, false)";
          if (!contents.includes(old))
            throw Error("FSB Vorbis granule adapter needs review");
          contents = contents.replace(
            old,
            "oggStream.writePacket(packetData, isEOS ? Math.min(granulepos, sample.samples) : granulepos, false, isEOS, false)",
          );
          return { contents, loader: "js" };
        });
        b.onLoad(
          { filter: /unityfs[\\/]assetFile[\\/]model\.js$/ },
          async (args) => {
            let contents = (await readFile(args.path, "utf8")).replaceAll(
              "\r\n",
              "\n",
            );
            const old =
              "console.error(`While parsing type ${this.getClassName()}:`)\n                    console.error(e)\n                    this.cachedObject = {}";
            if (!contents.includes(old))
              throw Error("unityfs-js parser adapter needs review");
            // Upstream otherwise turns malformed objects into empty objects and hides the failure.
            return { contents: contents.replace(old, "throw e"), loader: "js" };
          },
        );
      },
    },
  ],
  logLevel: "warning",
});
await mkdir(path.join(root, "dist/licenses"), { recursive: true });
await copyFile(
  path.join(root, "node_modules/unityfs-js/LICENSE"),
  path.join(root, "dist/licenses/unityfs-js-LICENSE"),
);

await copyFile(
  path.join(root, "vendor/astc/LICENSE"),
  path.join(root, "dist/licenses/astc-LICENSE"),
);
await copyFile(
  path.join(root, "vendor/astc/fp16.h"),
  path.join(root, "dist/licenses/astc-fp16-LICENSE.txt"),
);

await mkdir(path.join(root, "dist/vendor"), { recursive: true });
await copyFile(
  path.join(root, "node_modules/spirv-tools/dist/web/spirv-tools.js"),
  path.join(root, "dist/vendor/spirv-tools.cjs"),
);
await copyFile(
  path.join(root, "node_modules/spirv-tools/dist/web/spirv-tools.wasm"),
  path.join(root, "dist/vendor/spirv-tools.wasm"),
);
await copyFile(
  path.join(root, "node_modules/spirv-tools/LICENSE"),
  path.join(root, "dist/licenses/spirv-tools-LICENSE"),
);
await copyFile(
  path.join(root, "vendor/assetstudio/LICENSE"),
  path.join(root, "dist/licenses/assetstudio-LICENSE"),
);

await copyFile(
  path.join(root, "vendor/smol-v/LICENSE"),
  path.join(root, "dist/licenses/smol-v-LICENSE"),
);
await copyFile(
  path.join(root, "vendor/assimp/assimp.cjs"),
  path.join(root, "dist/vendor/assimp.cjs"),
);
await copyFile(
  path.join(root, "vendor/assimp/assimp.wasm"),
  path.join(root, "dist/vendor/assimp.wasm"),
);
for (const file of ["LICENSE-assimp", "LICENSE-assimpjs"])
  await copyFile(
    path.join(root, "vendor/assimp", file),
    path.join(root, "dist/licenses", file),
  );
for (const file of [
  "LICENSE-dr_mp3",
  "LICENSE-libvorbis",
  "LICENSE-libogg",
  "LICENSE-vgmstream",
])
  await copyFile(
    path.join(root, "vendor/audio", file),
    path.join(root, "dist/licenses", file),
  );
