# Synthetic audio regression fixtures

All signals are generated tones or deterministic bytes, not downloaded game audio.
Tests use checked-in golden PCM and never invoke native executables.

- `tone.mp3`: FFmpeg 9.0.1/libmp3lame, stereo 48 kHz, 5,760 PCM frames, 128 kbit/s. Source: `aevalsrc=0.25*sin(2*PI*440*t)|0.2*sin(2*PI*660*t):s=48000:d=0.12`. `tone-mp3.s16le` is independent FFmpeg decoding.
- `tone.ogg`: same signal encoded with FFmpeg's experimental native `vorbis` encoder. Golden `tone-ogg.s16le` comes from **native Xiph libvorbis 1.3.7**, using `ov_fopen`, `ov_read(..., 0, 2, 1, ...)`, and `ov_clear`. FFmpeg's own decoder differs on this particular stream, so its output is not used as the Vorbis oracle. Native libvorbis, native stb_vorbis and both tested WASM paths agree within one PCM16 unit; the final implementation uses libvorbis.
- `tone-xiph.ogg`: 5,760 stereo PCM frames encoded with the unmodified Xiph libvorbis 1.3.7 `examples/encoder_example.c` (its fixed 44.1 kHz and quality 0.1 settings). `tone-xiph.s16le` is decoded with native `ov_read`, as above.
- `vorbis.fsb`: audio packets of `tone-xiph.ogg`, each with a little-endian 16-bit length, packaged with the independent FSB writer in `tests/helpers/audio.mjs`. Its setup header exactly matches bundled FSB codebook CRC `2559465173`. Declared sample count is 5,760. This exercises packet byte offsets, padded bank data, Ogg CRC and final granule trimming.
- `fadpcm.fsb`: two stereo blocks, 512 frames. Input bytes use uint32 LCG seed `0x12345678`, `state = state * 1664525 + 1013904223`, high byte; each 140-byte block overrides predictor word with `0x76543210` and shifts with `0xfedcba98`. `fadpcm.s16le` is output of the **unmodified native vgmstream `decode_fadpcm`**, called per channel/block, with memory-backed read callbacks. Source revision: `09c9f40caae4747e44b6a993b3d5b654cef4d1f7` (`src/coding/fadpcm_decoder.c`). This covers nonzero prediction, signed shifts and saturation.
- `ima.fsb`: one 72-byte stereo block, 64 frames. Continue the LCG above after 560 bytes. Histories are 7000/-5000, step indices 40/50, reserved bytes zero. Its native reference is FFmpeg's IMA WAV decoder: wrap the same block in WAVE format 17, 48 kHz stereo, blockAlign 72, bits 4, samplesPerBlock 65; retain the first 64 frames because FSB/Xbox IMA omits the final nibble. `ima.s16le` contains these exact frames.

The generic compressed-audio comparisons allow at most 2 PCM16 units to account
for floating-point rounding across architectures. IMA/FADPCM comparisons require
exact bytes. `sha256.json` records the fixture and golden file hashes.

Native Xiph reference sources are release tags libvorbis v1.3.7 and libogg v1.3.5;
compile the source list in `lib/CMakeLists.txt` plus `vorbisfile.c`, with Ogg
`bitwise.c` and `framing.c`. Encoder generation additionally needs `vorbisenc.c`.
Native programs and downloaded sources are developer-only; none enter the package.
