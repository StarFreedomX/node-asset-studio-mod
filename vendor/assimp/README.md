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
