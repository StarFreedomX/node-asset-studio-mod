import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createExporter, inspectAssets } from '../dist/index.js';

const input = process.env.ASSET_STUDIO_TEST_INPUT;
assert.ok(input, 'Set ASSET_STUDIO_TEST_INPUT to the res014089 fixture (it is not committed)');
const config = { unityVersion: process.env.ASSET_STUDIO_TEST_UNITY_VERSION ?? '2022.3.62f1', log: false, timeoutMs: 30000,
    ...(process.env.ASSET_STUDIO_TEST_DOTNET ? { dotnetPath: process.env.ASSET_STUDIO_TEST_DOTNET } : {}),
};
// Encoded PNG hashes from the pinned upstream bridge, before buffer ownership optimizations.
const expectedPngHashes = JSON.parse(await readFile(new URL('./fixtures/res014089-png.json', import.meta.url)));
function pngScanlines(png) {
    const idat = [];
    for (let offset = 8; offset < png.length;) {
        const size = png.readUInt32BE(offset);
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + size));
        offset += size + 12;
    }
    return inflateSync(Buffer.concat(idat));
}

test('res014089: inspect, filter/reset, same-worker PNG export, filenameFormat and literal paths', async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), 'assetstudio-integration-'));
    const exporter = createExporter(config);
    try {
        const trickyInput = path.join(temporary, '中文 error; $(echo injected) "quoted".bundle');
        await copyFile(input, trickyInput);
        const info = await exporter.inspect(trickyInput);
        assert.equal(info.loadedFiles, 1);
        assert.equal(info.assetCount, 4);
        assert.ok(info.assets.every(a => a.type === 'Texture2D'));
        assert.ok(info.assets.some(a => a.pathId === '9047243551543287020'));
        const pid = exporter.workerPid;
        const filtered = await exporter.inspect(trickyInput, { filterByName: 'normal' });
        assert.equal(filtered.assetCount, 2);
        const reset = await exporter.inspect(trickyInput);
        assert.equal(reset.assetCount, 4);
        assert.equal(exporter.workerPid, pid);
        const events = [];
        const out = path.join(temporary, 'output; $literal "quotes" 中文');
        const result = await exporter.exportAssets(trickyInput, out, {
            assetType: 'tex2d', imageFormat: 'png', group: 'none', filenameFormat: 'pathID', onEvent: e => events.push(e),
        });
        assert.equal(result.exportedCount, 4);
        assert.equal(exporter.workerPid, pid);
        assert.ok(events.some(e => e.type === 'progress' && e.phase === 'export'));
        const progress = events.filter(e => e.type === 'progress' && e.phase === 'export' && e.completed !== undefined);
        assert.ok(progress.length > 0 && progress.length <= 101);
        assert.equal(progress.at(-1).percent, 100);
        assert.equal(progress.at(-1).completed, 4);
        assert.ok(progress.every((e, i) => i === 0 || e.percent > progress[i - 1].percent));
        const files = await readdir(out);
        assert.equal(files.length, 4);
        const baselineScanlines = new Map();
        for (const asset of info.assets) {
            const png = await readFile(path.join(out, asset.pathId + '.png'));
            assert.equal(createHash('sha256').update(png).digest('hex'), expectedPngHashes[asset.pathId + '.png']);
            assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
            assert.deepEqual([width, height], asset.name.startsWith('card') ? [1334, 1002] : [1024, 1024]);
            assert.equal(png[24], 8); // eight-bit RGBA
            assert.equal(png[25], 6);
            const idat = [];
            let end = false;
            for (let offset = 8; offset < png.length;) {
                const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
                if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + size));
                if (type === 'IEND') end = true;
                offset += 12 + size;
            }
            assert.ok(end);
            assert.equal(inflateSync(Buffer.concat(idat)).length, height * (1 + width * 4));
            baselineScanlines.set(asset.pathId + '.png', pngScanlines(png));
        }
        // Existing files are explicit typed failures, even when logs are disabled.
        await assert.rejects(exporter.exportAssets(trickyInput, out, { group: 'none', filenameFormat: 'pathID' }), { code: 'ASSET_PROCESSING_ERROR' });
        assert.equal((await exporter.exportAssets(trickyInput, out, { group: 'none', filenameFormat: 'pathID', overwrite: true })).exportedCount, 4);
        for (const pngCompressionLevel of [0, 1, 9]) {
            await exporter.exportAssets(trickyInput, out, { group: 'none', filenameFormat: 'pathID', overwrite: true, pngCompressionLevel });
            for (const [name, expected] of baselineScanlines) {
                assert.deepEqual(pngScanlines(await readFile(path.join(out, name))), expected);
            }
        }
        // Defaults reset after compression overrides; overwrite must truncate older, larger files.
        // Reuse the process/pool after a failed write, switching between serial and parallel encoding.
        for (const maxExportTasks of [1, 2]) {
            await exporter.exportAssets(trickyInput, out, { group: 'none', filenameFormat: 'pathID', overwrite: true, maxExportTasks });
            for (const [name, expected] of Object.entries(expectedPngHashes)) {
                assert.equal(createHash('sha256').update(await readFile(path.join(out, name))).digest('hex'), expected);
            }
        }
        const empty = path.join(temporary, 'empty');
        await mkdir(empty);
        await assert.rejects(exporter.inspect(empty), { code: 'ASSET_PROCESSING_ERROR' });
        await assert.rejects(exporter.inspect(input, { group: 'unknown' }), { code: 'INVALID_CONFIG' });
        await assert.rejects(exporter.inspect(input, { maxExportTasks: 'oops' }), { code: 'INVALID_CONFIG' });
        for (const pngCompressionLevel of [-1, 10, 1.5, 'fast']) {
            await assert.rejects(exporter.inspect(input, { pngCompressionLevel }), { code: 'INVALID_CONFIG' });
        }
        await assert.rejects(exporter.inspect(input, { misspelledOption: true }), { code: 'INVALID_CONFIG' });
        await assert.rejects(exporter.inspect(input, { unityVersion: '2022.3' }), { code: 'INVALID_CONFIG' });
        assert.equal((await exporter.inspect(input)).assetCount, 4);
    } finally { await exporter.close(); await rm(temporary, { recursive: true, force: true }); }
});

test('res014089: active cancellation, timeout and fresh worker recovery', async () => {
    const exporter = createExporter(config);
    const controller = new AbortController();
    try {
        await assert.rejects(exporter.inspect(input, { signal: controller.signal,
            onEvent(e) { if (e.type === 'progress' && e.phase === 'load') controller.abort(); } }), { code: 'ABORTED' });
        assert.equal(exporter.workerPid, undefined);
        await assert.rejects(exporter.inspect(input, { timeoutMs: 1 }), { code: 'TIMEOUT' });
        assert.equal(exporter.workerPid, undefined);
        assert.equal((await exporter.inspect(input)).assetCount, 4);
    } finally { await exporter.close(); }
});

test('res014089: separate instances can process concurrently with isolated filters', async () => {
    const [a, b] = await Promise.all([
        inspectAssets(input, { ...config, filterByName: 'normal' }),
        inspectAssets(input, { ...config, filterByName: 'after_training' }),
    ]);
    assert.equal(a.assetCount, 2);
    assert.equal(b.assetCount, 2);
    assert.ok(a.assets.every(x => x.name.endsWith('normal')));
    assert.ok(b.assets.every(x => x.name.endsWith('after_training')));
});
