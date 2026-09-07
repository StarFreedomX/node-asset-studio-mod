# Assimp WebAssembly

Pinned prebuilt `dist/assimpjs.js` (renamed `assimp.cjs`) and
`dist/assimpjs.wasm` from the repalash/assimpjs fork. See provenance.json for
source revisions and SHA-256 hashes. This fork enables FBX export; the
similarly named npm package is not a substitute. Files are unmodified.

The maintainer can reproduce the upstream build using the pinned checkout's
Emscripten/CMake scripts. Normal package builds copy these checked-in artifacts;
users require neither a compiler nor native Assimp, .NET or an FBX SDK.

`src/fbx.ts` supplies WASM bytes from disk and owns all Embind handles. It also
corrects the pinned exporter's glTF millisecond key times in FBX 7.5.0 output.
The model bridge supplies a scene parent because Assimp omits the scene root
when exporting FBX. Tests read exported files back to check geometry, weights
and nonzero animation key times, rather than checking only file creation.

Assimp is BSD-3-Clause; assimpjs glue is MIT. Both licenses ship in dist/licenses.

Since 0.1.4, `src/fbx-morph.ts` fills in morph animation and renderer Visibility
tracks omitted by the pinned Assimp exporter. `src/fbx-document.ts` rewrites
binary node offsets and footer padding. Connections follow the pinned Assimp
FBX importer's `ProcessMorphAnimDatas` and standard FBX property animation.
Three.js FBXLoader is used only during tests for independent morph/rotation
readback; it is not bundled in the published runtime. Its FBX reader does not
animate Visibility, which has a separate structural regression.
