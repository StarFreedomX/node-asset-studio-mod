// Optional maintainer command; npm build/pack uses the checked-in embedded WASM.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const emcc = process.env.EMCC ?? "emcc";
const result = spawnSync(
  emcc,
  [
    "vendor/astc/astc.cpp",
    "vendor/astc/bcn.cpp",
    "vendor/astc/pvrtc.cpp",
    "vendor/astc/interface.cpp",
    "-Ivendor/astc",
    "-O3",
    "-std=c++17",
    "-fno-exceptions",
    "-fno-rtti",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sSINGLE_FILE=1",
    "-sENVIRONMENT=node,worker",
    "-sFILESYSTEM=0",
    "-sALLOW_MEMORY_GROWTH=1",
    '-sEXPORTED_FUNCTIONS=["_decode_astc_rgba","_decode_extra_rgba","_malloc","_free"]',
    '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]',
    "-sINCOMING_MODULE_JS_API=[]",
    "-o",
    "vendor/astc/decoder.js",
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
