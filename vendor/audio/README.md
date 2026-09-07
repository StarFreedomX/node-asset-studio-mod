# Embedded audio decoder

- `dr_mp3.h`: unmodified dr_libs revision `dfe8377631000664666519fdb83da193fd8037f4` (MIT No Attribution; embedded minimp3 CC0 notice retained).
- `vorbis/`: decoder sources/headers from Xiph libvorbis v1.3.7 (BSD-3-Clause).
- `ogg/`: bitwise/framing sources from Xiph libogg v1.3.5 (BSD-3-Clause).
- `ogg/include/ogg/config_types.h` is our fixed-width WASM type configuration. Other upstream C/H files are unchanged.
- `interface.c`: local memory callbacks and bounded PCM16 decoder interface. MP3 and Ogg use no files. Every decoder and allocation is released after use.
- `decoder.js`: Emscripten 4.0.15 glue with embedded WASM. See `provenance.json` for sources and hashes.

Ordinary build/pack uses the checked-in decoder and never compiles or downloads it.
Maintainers can reproduce it with `EMCC=/path/to/emcc npm run build:audio`.

`src/audio-adpcm.ts` adapts FSB IMA layouts and FADPCM integer arithmetic from
vgmstream revision `09c9f40caae4747e44b6a993b3d5b654cef4d1f7`, specifically
`src/coding/ima_decoder.c` and `fadpcm_decoder.c` (ISC; `LICENSE-vgmstream`).
The bounded FSB parser follows `src/meta/fsb5.c`. Unity AudioClip layout follows
AssetStudioMod v0.19.0 (MIT; existing AssetStudio license).

The build ships all four audio licenses in `dist/licenses`. No FMOD code, native
shared library or executable is added to the runtime.
