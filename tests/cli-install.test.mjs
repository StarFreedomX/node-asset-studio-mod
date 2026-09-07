import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { cacheValid, cliLayout } from '../scripts/download-cli.js';
import { findDotnet, cliEnvironment } from '../scripts/cli-runtime.js';

const runtimeOutput = 'Microsoft.NETCore.App 9.0.19 [/runtime/shared/Microsoft.NETCore.App]\n';

test('runtime discovery falls back past missing, old and incompatible runtimes', () => {
    const calls = [];
    const run = (executable, args, options) => {
        calls.push([executable, args[0]]);
        assert.equal(options.shell, false);
        assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
        if (executable === '/explicit/dotnet') return { error: new Error('ENOENT') };
        if (executable === '/project/bin/dotnet/dotnet') return { status: 0, stdout: runtimeOutput.replace('9.0.19', '8.0.1') };
        return { status: 0, stdout: args[0] === '--list-runtimes' ? runtimeOutput :
            `Host:\n  Architecture: ${executable === '/arm/dotnet' ? 'arm64' : 'x64'}\n` };
    };
    const runtime = findDotnet({ root: '/project', platform: 'linux', env: {
        ASSET_STUDIO_DOTNET: '/explicit/dotnet', DOTNET_ROOT_X64: '/arm', DOTNET_ROOT: '/good',
    }, run });
    assert.deepEqual(runtime, { executable: '/good/dotnet', version: '9.0.19', root: '/runtime' });
    assert.deepEqual(calls.map(c => c[0]), ['/explicit/dotnet', '/project/bin/dotnet/dotnet', '/arm/dotnet', '/arm/dotnet', '/good/dotnet', '/good/dotnet']);
});

test('no compatible runtime returns null without invoking a shell', () => {
    assert.equal(findDotnet({ env: {}, run: (_exe, _args, options) => {
        assert.equal(options.shell, false);
        return { status: 1, stderr: 'not installed' };
    } }), null);
});

test('child environment selects detected x64 runtime without mutating caller', () => {
    const env = { PATH: '/original', DOTNET_ROOT: '/old' };
    const result = cliEnvironment({ root: '/runtime' }, env);
    assert.equal(result.DOTNET_ROOT, '/runtime');
    assert.equal(result.DOTNET_ROOT_X64, '/runtime');
    assert.equal(result.PATH, '/runtime' + path.delimiter + '/original');
    assert.deepEqual(env, { PATH: '/original', DOTNET_ROOT: '/old' });
    assert.deepEqual(cliEnvironment(null, env), env);
});

test('cache rejects corruption, missing files, extra files and mismatched releases', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'asset-cli-cache-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const layout = cliLayout();
    const files = { [layout.executable]: 'exe', 'native/library': 'lib' };
    await mkdir(path.join(directory, 'native'));
    const saved = { release: '0.19.0', url: layout.url, files: {} };
    for (const [name, contents] of Object.entries(files)) {
        await writeFile(path.join(directory, name), contents);
        saved.files[name] = { size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') };
    }
    const marker = path.join(directory, '.install.json');
    const save = () => writeFile(marker, JSON.stringify(saved));
    assert.equal(await cacheValid(directory, layout), false);
    await save();
    assert.equal(await cacheValid(directory, layout), true);
    await writeFile(path.join(directory, layout.executable), 'bad'); // Same length still fails.
    assert.equal(await cacheValid(directory, layout), false);
    await writeFile(path.join(directory, layout.executable), 'exe');
    await rm(path.join(directory, 'native/library'));
    assert.equal(await cacheValid(directory, layout), false);
    await writeFile(path.join(directory, 'native/library'), 'lib');
    await writeFile(path.join(directory, 'extra'), 'extra');
    assert.equal(await cacheValid(directory, layout), false);
    await rm(path.join(directory, 'extra'));
    saved.release = '0.18.0'; await save();
    assert.equal(await cacheValid(directory, layout), false);
    saved.release = '0.19.0'; saved.url = 'https://wrong.example'; await save();
    assert.equal(await cacheValid(directory, layout), false);
    await writeFile(marker, 'broken json');
    assert.equal(await cacheValid(directory, layout), false);
});
