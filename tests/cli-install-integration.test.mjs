import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, symlink, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cliLayout, cacheValid } from '../scripts/download-cli.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = process.env.ASSET_STUDIO_TEST_CLI_ARCHIVE;
test('offline installation, repeat install, corruption repair and failed replacement', { skip: !archive }, async t => {
    const project = await mkdtemp(path.join(os.tmpdir(), 'asset-cli-install-'));
    t.after(() => rm(project, { recursive: true, force: true }));
    await mkdir(path.join(project, 'scripts'));
    await writeFile(path.join(project, 'package.json'), '{"type":"module"}');
    for (const name of ['cli-runtime.js', 'download-cli.js'])
        await cp(path.join(root, 'scripts', name), path.join(project, 'scripts', name));
    await symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    const run = (zip, args = []) => spawnSync(process.execPath, ['scripts/download-cli.js', ...args], {
        cwd: project, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, PATH: '', ASSET_STUDIO_DOTNET: '', DOTNET_ROOT: '', DOTNET_ROOT_X64: '', ASSET_STUDIO_CLI_ARCHIVE: zip },
    });
    const layout = cliLayout();
    const destination = path.join(project, 'bin', layout.folder);
    let result = run(archive);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /未找到 .NET 9 x64 Runtime/);
    assert.doesNotMatch(result.stderr, /command not found/);
    assert.equal(await cacheValid(destination, layout), true);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(destination, layout.executable))).mode & 0o777, 0o755);
    const before = await readFile(path.join(destination, '.install.json'), 'utf8');
    result = run('/does-not-exist.zip');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /跳过下载/);
    await writeFile(path.join(destination, layout.executable), 'corrupt');
    result = run(archive);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await cacheValid(destination, layout), true);
    assert.equal(await readFile(path.join(destination, '.install.json'), 'utf8'), before);
    result = run('/does-not-exist.zip', ['--force']);
    assert.notEqual(result.status, 0);
    assert.equal(await cacheValid(destination, layout), true, 'failed install preserves working installation');
});
