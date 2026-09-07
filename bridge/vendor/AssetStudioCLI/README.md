These export helpers are vendored from aelurum/AssetStudioMod v0.19.0:
https://github.com/aelurum/AssetStudioMod/tree/v0.19.0/AssetStudioCLI

Copyright Perfare and aelurum; distributed under the accompanying MIT LICENSE.
Only Studio.cs, Exporter.cs, ParallelExporter.cs and Components/*.cs are used.
The original executable entry point, argument parser and console logger are not included.
The bridge links the official portable release's AssetStudio and utility DLLs directly.

Local changes to Studio.cs: expose export counts and progress callbacks, and clear all
static collections/export caches between requests. Typed settings live in ../../Options.cs.
AssetItem.cs qualifies AssetStudio.Object to disambiguate .NET implicit imports.

ParallelExporter.cs uses ../../DecodedTexture.cs to keep a decoded pixel buffer alive
through encoding without copying it into a second image buffer. Switch textures retain
the upstream conversion path. PNG compression can be overridden per request, and image
overwrites truncate the destination to avoid trailing bytes from an older encoding.
The bridge coalesces export progress by percentage and avoids nested image parallelism.
../../SharedResourceReaders.cs rebinds inline resources to their serialized file's
shared reader before export; upstream locks individual ObjectReaders that can share
one stream, allowing concurrent seek/read races without this normalization.
