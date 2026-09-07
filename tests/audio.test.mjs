import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { readAssets, createExporter } from "../dist/index.js";
import { audioClip, fsb, parseWav } from "./helpers/audio.mjs";
const read = (b, options = {}, config = {}) =>
  readAssets(audioClip(b, options), { log: false, ...config });
const pcm16 = (values) => {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeInt16LE(v, i * 2));
  return b;
};

test("AudioClip selects FSB subsound, keeps its filename, strips padding and reads inline/companion data", async () => {
  const expected = pcm16([-1000, 2000, -3000]);
  for (const version of [0, 1]) {
    const bank = fsb(
      2,
      [
        { samples: 2, data: pcm16([55, 66]) },
        { samples: 3, data: expected, rateIndex: 10 },
      ],
      { version, names: true, headerPadding: 8 },
    );
    for (const resource of [undefined, { path: "sound.resS", offset: 7 }]) {
      const r = await read(
        bank,
        { index: 1, resource, name: "selected" },
        {
          resourceFiles: resource
            ? { "sound.resS": Buffer.concat([Buffer.alloc(7), bank]) }
            : undefined,
        },
      );
      assert.equal(r.exportedCount, 1);
      assert.equal(r.files[0].path, "selected.wav");
      const w = parseWav(r.files[0].data);
      assert.equal(w.rate, 96000);
      assert.deepEqual(w.pcm, expected);
    }
    await assert.rejects(read(bank, { index: 2 }), /subsoundIndex/);
  }
});

test("FSB PCM8/16/24/32/float WAV preserves sample format, exact frames and channel layout", async () => {
  for (const [format, bits] of [
    [1, 8],
    [2, 16],
    [3, 24],
    [4, 32],
    [5, 32],
  ])
    for (const channels of [1, 2, 6, 8]) {
      const data = Buffer.alloc(
        (3 * channels * bits) / 8,
        format === 5 ? 0 : 17,
      );
      const r = await read(
        fsb(format, [{ data, samples: 3, channels, rateIndex: 0 }]),
      );
      const w = parseWav(r.files[0].data);
      assert.equal(w.channels, channels);
      assert.equal(w.bits, bits);
      assert.equal(w.format, format === 5 ? 3 : 1);
      assert.equal(w.rate, 4000);
      assert.deepEqual(w.pcm, data);
      if (channels === 6) assert.equal(w.mask, 0x3f);
      if (channels === 8) assert.equal(w.mask, 0x63f);
    }
});

test("FSB frequency/channels metadata is respected; malformed headers and resource ranges fail", async () => {
  const rate = Buffer.alloc(4);
  rate.writeUInt32LE(64000);
  const bank = fsb(2, [
    {
      samples: 2,
      data: Buffer.alloc(12),
      metadata: [
        [2, rate],
        [1, Buffer.from([3])],
      ],
    },
  ]);
  const w = parseWav((await read(bank)).files[0].data);
  assert.equal(w.rate, 64000);
  assert.equal(w.channels, 3);
  await assert.rejects(read(bank.subarray(0, -1)), /Truncated/);
  await assert.rejects(
    read(fsb(2, [{ samples: 900, data: Buffer.alloc(32) }])),
    /Truncated/,
  );
  await assert.rejects(
    read(bank, { resource: { path: "missing.resS", offset: 0 } }),
    /resource/i,
  );
  await assert.rejects(read(bank, {}, { maxOutputBytes: 10 }), {
    code: "LIMIT_EXCEEDED",
  });
  await assert.rejects(
    read(fsb(10, [{ samples: 2, data: Buffer.alloc(32) }])),
    { code: "UNSUPPORTED_OPERATION" },
  );
});

test("audioFormat none preserves the complete bank, while default converts supported audio to WAV", async () => {
  for (const format of [2, 10]) {
    const bank = fsb(format, [{ samples: 2, data: pcm16([1, 2]) }]);
    const r = await read(bank, {}, { audioFormat: "none" });
    assert.equal(r.files[0].path, "sound.fsb");
    assert.deepEqual(Buffer.from(r.files[0].data), bank);
  }
  const mp3 = await fs.readFile(
    new URL("./fixtures/audio/tone.mp3", import.meta.url),
  );
  assert.equal((await read(mp3)).files[0].path, "sound.wav");
  const r = await read(
    fsb(2, [{ samples: 2, data: pcm16([1, 2]) }]),
    {},
    { maxOutputBytes: 48 },
  );
  assert.equal(r.files[0].data.length, 48);
});

test("FSB PCM16 big-endian flag is converted to little-endian WAV and unknown layouts fail", async () => {
  const expected = pcm16([-32768, 12345, 32767]);
  const bank = fsb(2, [{ samples: 3, data: Buffer.from(expected).swap16() }]);
  bank.writeUInt32LE(1, 32);
  assert.deepEqual(parseWav((await read(bank)).files[0].data).pcm, expected);
  bank.writeUInt32LE(4, 32);
  await assert.rejects(read(bank), { code: "UNSUPPORTED_OPERATION" });
});

test("Unity 4.x inline AudioClip preserves a real WAV byte-for-byte", async () => {
  const modern = await read(
    fsb(2, [{ samples: 4, data: pcm16([5, 10, 15, 20]) }]),
  );
  const r = await read(Buffer.from(modern.files[0].data), {
    version: "4.7.2f1",
  });
  assert.deepEqual(r.files[0].data, modern.files[0].data);
});

test("Unity 4.x streamed audio resolves the owning assets filename and resource offset", async () => {
  const bank = fsb(2, [{ samples: 4, data: pcm16([1, 2, 3, 4]) }]);
  const dir = await fs.mkdtemp(path.join(tmpdir(), "asset-audio-"));
  try {
    const input = path.join(dir, "legacy.assets");
    await fs.writeFile(
      input,
      audioClip(bank, { version: "4.7.2f1", resource: { offset: 9 } }),
    );
    await fs.writeFile(input + ".resS", Buffer.concat([Buffer.alloc(9), bank]));
    const r = await readAssets(input, { log: false });
    assert.deepEqual(parseWav(r.files[0].data).pcm, pcm16([1, 2, 3, 4]));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("FSB MPEG selects the requested stream and converts using the same WAV path", async () => {
  const data = await fs.readFile(
    new URL("./fixtures/audio/tone.mp3", import.meta.url),
  );
  const bank = fsb(11, [{ samples: 5760, channels: 2, data }]);
  const r = await read(bank, {}, { audioFormat: "wav" });
  const expected = await fs.readFile(
    new URL("./fixtures/audio/tone-mp3.s16le", import.meta.url),
  );
  const decoded = parseWav(r.files[0].data).pcm;
  assert.equal(decoded.length, expected.length);
  for (let i = 0; i < decoded.length; i += 2)
    assert.ok(Math.abs(decoded.readInt16LE(i) - expected.readInt16LE(i)) <= 2);
});

test("FSB Vorbis rebuilds a known codebook, ignores bank padding and preserves the final granule", async () => {
  const bank = await fs.readFile(
    new URL("./fixtures/audio/vorbis.fsb", import.meta.url),
  );
  const expected = await fs.readFile(
    new URL("./fixtures/audio/tone-xiph.s16le", import.meta.url),
  );
  const r = await read(bank);
  const w = parseWav(r.files[0].data);
  assert.equal(w.rate, 44100);
  assert.equal(w.pcm.length, expected.length);
  for (let i = 0; i < expected.length; i += 2)
    assert.ok(Math.abs(w.pcm.readInt16LE(i) - expected.readInt16LE(i)) <= 2);
  const bad = Buffer.from(bank);
  bad.writeUInt32LE(0, 72);
  await assert.rejects(read(bad), /setup header.*not found/i);
});

test("FSB IMA mono/stereo/6/8 channels use correct headers, nibble interleave and final sample count", async () => {
  for (const channels of [1, 2, 6, 8]) {
    const block = Buffer.alloc(36 * channels);
    for (let c = 0; c < channels; c++) {
      block.writeInt16LE(c * 100, channels > 2 ? c * 2 : c * 4);
      const group = channels > 2 ? 2 : 4;
      for (let k = 0; k < 32 / group; k++)
        block.fill(
          0x11,
          4 * channels + k * group * channels + c * group,
          4 * channels + k * group * channels + (c + 1) * group,
        );
    }
    const r = await read(fsb(7, [{ samples: 63, channels, data: block }])),
      w = parseWav(r.files[0].data);
    assert.equal(w.pcm.length, 63 * channels * 2);
    for (let i = 0; i < 63; i++)
      for (let c = 0; c < channels; c++)
        assert.equal(w.pcm.readInt16LE((i * channels + c) * 2), c * 100 + i);
    block[channels > 2 ? channels * 2 : 2] = 89;
    await assert.rejects(
      read(fsb(7, [{ samples: 63, channels, data: block }])),
      /step index/,
    );
  }
});

test("FADPCM reconstructs signed nibbles, interleaved channels and partial final blocks", async () => {
  const block = Buffer.alloc(140 * 2);
  block.fill(0x21, 12, 140);
  block.fill(0xef, 152);
  const r = await read(fsb(16, [{ samples: 255, channels: 2, data: block }])),
    w = parseWav(r.files[0].data);
  for (let i = 0; i < 255; i++) {
    assert.equal(w.pcm.readInt16LE(i * 4), i % 2 ? 2 : 1);
    assert.equal(w.pcm.readInt16LE(i * 4 + 2), i % 2 ? -2 : -1);
  }
  await assert.rejects(
    read(fsb(16, [{ samples: 512, channels: 2, data: block }])),
    /Truncated/,
  );
});

for (const codec of ["ima", "fadpcm"])
  test(`${codec} nonzero predictors and saturation agree byte-for-byte with native reference decoder`, async () => {
    const data = await fs.readFile(
      new URL(`./fixtures/audio/${codec}.fsb`, import.meta.url),
    );
    const expected = await fs.readFile(
      new URL(`./fixtures/audio/${codec}.s16le`, import.meta.url),
    );
    const result = await read(data);
    assert.deepEqual(parseWav(result.files[0].data).pcm, expected);
  });

for (const [file, type, golden] of [
  ["tone.mp3", "mp3", "tone-mp3"],
  ["tone.ogg", "ogg", "tone-ogg"],
  ["tone-xiph.ogg", "ogg", "tone-xiph"],
])
  test(`${file} to WAV agrees with native reference PCM`, async () => {
    const data = await fs.readFile(
      new URL(`./fixtures/audio/${file}`, import.meta.url),
    );
    const expected = await fs.readFile(
      new URL(`./fixtures/audio/${golden}.s16le`, import.meta.url),
    );
    const original = await read(data, {}, { audioFormat: "none" });
    assert.equal(original.files[0].path, `sound.${type}`);
    assert.deepEqual(Buffer.from(original.files[0].data), data);
    const r = await read(data, {}, { audioFormat: "wav" }),
      w = parseWav(r.files[0].data);
    assert.equal(w.channels, 2);
    assert.equal(w.rate, golden === "tone-xiph" ? 44100 : 48000);
    assert.equal(w.bits, 16);
    assert.equal(w.pcm.length, expected.length);
    let max = 0;
    for (let i = 0; i < w.pcm.length; i += 2)
      max = Math.max(
        max,
        Math.abs(w.pcm.readInt16LE(i) - expected.readInt16LE(i)),
      );
    assert.ok(max <= 2, `Decoder error ${max} exceeds 2 PCM16 units`);
    await assert.rejects(
      read(data, {}, { audioFormat: "wav", maxOutputBytes: 100 }),
      { code: "LIMIT_EXCEEDED" },
    );
  });

test("Audio decoder failure releases WASM state so the same worker can decode again", async () => {
  const data = await fs.readFile(
    new URL("./fixtures/audio/tone.ogg", import.meta.url),
  );
  const exporter = createExporter({ log: false });
  try {
    const mp3 = await fs.readFile(
      new URL("./fixtures/audio/tone.mp3", import.meta.url),
    );
    // MP3 length is discovered while decoding, so this fails after WASM allocation.
    await assert.rejects(
      exporter.readAssets(audioClip(mp3), {
        audioFormat: "wav",
        maxOutputBytes: 100,
      }),
      { code: "LIMIT_EXCEEDED" },
    );
    await assert.rejects(
      exporter.readAssets(audioClip(data), {
        audioFormat: "wav",
        maxOutputBytes: 100,
      }),
      { code: "LIMIT_EXCEEDED" },
    );
    await assert.rejects(
      exporter.readAssets(audioClip(data.subarray(0, -1)), {
        audioFormat: "wav",
      }),
      /Truncated/,
    );
    const bad = Buffer.from(data);
    bad[bad.length - 1] ^= 1;
    await assert.rejects(
      exporter.readAssets(audioClip(bad), { audioFormat: "wav" }),
      /checksum/,
    );
    const r = await exporter.readAssets(audioClip(data), {
      audioFormat: "wav",
    });
    assert.ok(parseWav(r.files[0].data).pcm.length > 1000);
  } finally {
    await exporter.close();
  }
});

test("Independent exporter workers convert overlapping MP3 and Vorbis requests", async () => {
  const results = await Promise.all(
    ["mp3", "ogg", "mp3"].map(async (type) => {
      const data = await fs.readFile(
        new URL(`./fixtures/audio/tone.${type}`, import.meta.url),
      );
      return read(data, {}, { audioFormat: "wav" });
    }),
  );
  assert.deepEqual(
    results.map((r) => parseWav(r.files[0].data).pcm.length),
    [23040, 23040, 23040],
  );
});
