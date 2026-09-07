import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createExporter, inspectAssets } from '../dist/index.js';

const input = fileURLToPath(new URL('../package.json', import.meta.url));
const bridgePath = fileURLToPath(new URL('./fixtures/bridge.mjs', import.meta.url));
const config = { dotnetPath: process.execPath, bridgePath, log: false, timeoutMs: 5000 };

test('structured protocol preserves UTF-8 and int64 IDs; log words do not decide success', async () => {
    const events = [];
    const result = await inspectAssets(input, { ...config, onEvent: e => events.push(e) });
    assert.equal(result.assets[0].pathId, '9047243551543287020');
    assert.equal(events[0].message, '图片 error failed exception are ordinary asset names');
});

test('sequential operations reuse the worker; typed failure does not poison next request', async () => {
    const exporter = createExporter(config);
    try {
        await exporter.inspect(input);
        const pid = exporter.workerPid;
        await assert.rejects(exporter.inspect(input, { filterByName: 'error' }), { code: 'ASSET_PROCESSING_ERROR', details: ['typed error'] });
        await exporter.inspect(input);
        assert.equal(exporter.workerPid, pid);
    } finally { await exporter.close(); }
    assert.equal(exporter.workerPid, undefined);
    await assert.rejects(exporter.inspect(input), { code: 'CLOSED' });
});

test('abort rejects only after worker exit, and next operation starts a new worker', async () => {
    const exporter = createExporter(config);
    const controller = new AbortController();
    let oldPid;
    try {
        await assert.rejects(exporter.inspect(input, { filterByName: 'hang', signal: controller.signal,
            onEvent() { oldPid = exporter.workerPid; controller.abort(); } }), { name: 'AbortError', code: 'ABORTED' });
        assert.equal(exporter.workerPid, undefined);
        await exporter.inspect(input);
        assert.notEqual(exporter.workerPid, oldPid);
    } finally { await exporter.close(); }
});

test('timeout and concurrent request handling are explicit', async () => {
    const exporter = createExporter(config);
    try {
        const active = assert.rejects(exporter.inspect(input, { filterByName: 'hang', timeoutMs: 150 }), { code: 'TIMEOUT' });
        await assert.rejects(exporter.inspect(input), { code: 'BUSY' });
        await active;
        assert.equal(exporter.workerPid, undefined);
        await exporter.inspect(input);
    } finally { await exporter.close(); }
});

test('close stops an active operation and is idempotent', async () => {
    const exporter = createExporter(config);
    const active = assert.rejects(exporter.inspect(input, { filterByName: 'hang' }), { code: 'CLOSED' });
    await exporter.close();
    await active;
    await exporter.close();
    assert.equal(exporter.workerPid, undefined);
});

test('malformed response, crash and callback exception stop the worker without hanging', async () => {
    for (const [filterByName, code] of [['malformed', 'PROTOCOL_ERROR'], ['exit', 'BRIDGE_EXIT']]) {
        const exporter = createExporter(config);
        try {
            await assert.rejects(exporter.inspect(input, { filterByName: filterByName }), { code });
            assert.equal(exporter.workerPid, undefined);
        } finally { await exporter.close(); }
    }
    await assert.rejects(inspectAssets(input, { ...config, onEvent() { throw Error('consumer failure'); } }), { code: 'CALLBACK_ERROR' });
});

test('missing runtime, invalid timeout and pre-aborted signal produce actionable errors', async () => {
    await assert.rejects(inspectAssets(input, { ...config, dotnetPath: '/nonexistent-assetstudio/dotnet' }), { code: 'BRIDGE_START_FAILED' });
    await assert.rejects(inspectAssets(input, { ...config, timeoutMs: -1 }), { code: 'INVALID_CONFIG' });
    const controller = new AbortController();
    controller.abort();
    const exporter = createExporter(config);
    try {
        await assert.rejects(exporter.inspect(input, { signal: controller.signal }), { code: 'ABORTED' });
        assert.equal(exporter.workerPid, undefined);
    } finally { await exporter.close(); }
});
