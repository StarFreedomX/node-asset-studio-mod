import https from 'node:https';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, chmod, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import { findDotnet, cliEnvironment } from './cli-runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = '0.19.0';

export function cliLayout(platform = process.platform) {
    const target = { win32: 'win64', darwin: 'mac64', linux: 'linux64' }[platform];
    if (!target) throw new Error(`Unsupported platform: ${platform}`);
    const folder = `AssetStudioModCLI_net9_${target}`;
    return { folder, executable: platform === 'win32' ? 'AssetStudioModCLI.exe' : 'AssetStudioModCLI',
        url: `https://github.com/aelurum/AssetStudioMod/releases/download/v${release}/${folder}.zip` };
}

async function manifest(directory) {
    const files = {};
    async function visit(dir, prefix = '') {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const relative = prefix + entry.name;
            if (entry.isDirectory()) await visit(path.join(dir, entry.name), relative + '/');
            else if (entry.isFile() && relative !== '.install.json') {
                const data = await readFile(path.join(dir, entry.name));
                files[relative] = { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
            }
        }
    }
    await visit(directory);
    return files;
}

export async function cacheValid(directory, layout) {
    try {
        const saved = JSON.parse(await readFile(path.join(directory, '.install.json'), 'utf8'));
        if (saved.release !== release || saved.url !== layout.url || !saved.files?.[layout.executable]?.size) return false;
        // Verify every installed file, including native libraries, before skipping a download.
        const actual = await manifest(directory);
        const names = Object.keys(saved.files);
        return names.length === Object.keys(actual).length && names.every(name =>
            actual[name]?.size === saved.files[name].size && actual[name]?.sha256 === saved.files[name].sha256);
    } catch { return false; }
}

async function saveManifest(directory, layout) {
    const files = await manifest(directory);
    if (!files[layout.executable]?.size) throw new Error('Archive does not contain the CLI executable');
    await writeFile(path.join(directory, '.install.json'), JSON.stringify({ release, url: layout.url, files }, null, 2) + '\n');
}

async function makeExecutable(directory, layout) {
    if (process.platform !== 'win32') await chmod(path.join(directory, layout.executable), 0o755);
}

async function adoptLegacy(directory, layout, runtime) {
    // Older installers did not write a manifest. Verify the executable's reported version once.
    if (!runtime || fs.existsSync(path.join(directory, '.install.json'))) return false;
    try {
        if (!(await stat(path.join(directory, layout.executable))).size) return false;
        await makeExecutable(directory, layout);
        const result = spawnSync(path.join(directory, layout.executable), ['--help'], {
            encoding: 'utf8', shell: false, timeout: 10000, env: cliEnvironment(runtime),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (result.error || result.status !== 0 || !/AssetStudioMod v0\.19\.0(?:\.0)?(?:\s|$)/m.test(result.stdout + result.stderr)) return false;
        await saveManifest(directory, layout);
        return true;
    } catch { return false; }
}

async function download(url, destination, redirects = 0) {
    if (redirects > 5) throw new Error('Too many redirects');
    const response = await new Promise((resolve, reject) => {
        const request = https.get(url, resolve).on('error', reject);
        request.setTimeout(30000, () => request.destroy(new Error('Download timed out')));
    });
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url);
        if (next.protocol !== 'https:') throw new Error('Only HTTPS redirects are supported');
        return download(next.href, destination, redirects + 1);
    }
    if (response.statusCode !== 200) { response.resume(); throw new Error(`HTTP ${response.statusCode}`); }
    await pipeline(response, fs.createWriteStream(destination));
}

export async function installCli({ force = false, archive = process.env.ASSET_STUDIO_CLI_ARCHIVE } = {}) {
    const layout = cliLayout();
    const bin = path.join(root, 'bin');
    const destination = path.join(bin, layout.folder);
    const runtime = findDotnet();
    if (runtime) console.log(`✔ 已检测到 .NET ${runtime.version} x64 Runtime: ${runtime.executable}`);
    else console.warn('⚠ 未找到 .NET 9 x64 Runtime。可设置 ASSET_STUDIO_DOTNET、DOTNET_ROOT_X64、DOTNET_ROOT，或放入 bin/dotnet/。下载 CLI 不会安装 .NET。');
    if (!force && (await cacheValid(destination, layout) || await adoptLegacy(destination, layout, runtime))) {
        await makeExecutable(destination, layout);
        console.log(`✔ CLI v${release} 已就绪，跳过下载`);
        return;
    }
    await mkdir(bin, { recursive: true });
    const temporary = await mkdtemp(path.join(bin, 'cli-setup-'));
    try {
        const zip = archive ? path.resolve(archive) : path.join(temporary, 'cli.zip');
        if (!archive) {
            const upstream = new URL(layout.url);
            const urls = [layout.url, `https://ghproxy.net/${layout.url}`,
                `https://download.fastgit.org${upstream.pathname}`, `https://github.com.cnpmjs.org${upstream.pathname}`];
            let downloaded = false;
            for (const url of urls) {
                try {
                    console.log(`Downloading: ${url}`);
                    await download(url, zip);
                    downloaded = true;
                    break;
                } catch (error) { console.warn(`下载失败: ${error.message}`); }
            }
            if (!downloaded) throw new Error('所有下载方式均失败；可使用 ASSET_STUDIO_CLI_ARCHIVE 指定本地压缩包');
        }
        const unpacked = path.join(temporary, 'unpacked');
        await pipeline(fs.createReadStream(zip), unzipper.Extract({ path: unpacked }));
        const prepared = path.join(unpacked, layout.folder);
        await makeExecutable(prepared, layout);
        await saveManifest(prepared, layout);
        // Do not replace an existing installation until extraction and validation succeed.
        const backup = path.join(temporary, 'previous');
        const hadPrevious = fs.existsSync(destination);
        if (hadPrevious) await rename(destination, backup);
        try { await rename(prepared, destination); }
        catch (error) { if (hadPrevious) await rename(backup, destination); throw error; }
        console.log(`✔ CLI v${release} 安装完成`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    installCli({ force: process.argv.includes('--force') }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
