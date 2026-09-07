These export helpers are vendored from aelurum/AssetStudioMod v0.19.0:
https://github.com/aelurum/AssetStudioMod/tree/v0.19.0/AssetStudioCLI

Copyright Perfare and aelurum; distributed under the accompanying MIT LICENSE.
Only Studio.cs, Exporter.cs, ParallelExporter.cs and Components/*.cs are used.
The original executable entry point, argument parser and console logger are not included.
The bridge links the official portable release's AssetStudio and utility DLLs directly.

Local changes to Studio.cs: expose export counts and progress callbacks, and clear all
static collections/export caches between requests. Typed settings live in ../../Options.cs.
AssetItem.cs qualifies AssetStudio.Object to disambiguate .NET implicit imports.
