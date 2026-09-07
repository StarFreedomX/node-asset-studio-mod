import https from 'node:https';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, rename, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import unzipper from 'unzipper';
import { root } from './dotnet.js';
import { installBuild } from './build-bridge.js';

const url = 'https://github.com/aelurum/AssetStudioMod/releases/download/v0.19.0/AssetStudioModCLI_net9_portable.zip';
const sha256 = '4ee4befc2316885dcb4c2dc0a07c01967a6fba23fdfd1b44e0285799de6ac662';
const libraryDir = path.join(root, 'bin/assetstudio');

async function download(url, destination, redirects = 0) {
    if (redirects > 5) throw new Error('Too many download redirects');
    const response = await new Promise((resolve, reject) => {
        const request = https.get(url, resolve).on('error', reject);
        request.setTimeout(30_000, () => request.destroy(new Error('Download timed out')));
    });
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url);
        if (next.protocol !== 'https:') throw new Error('Only HTTPS downloads are supported');
        return download(next.href, destination, redirects + 1);
    }
    if (response.statusCode !== 200) { response.resume(); throw new Error(`Download failed: HTTP ${response.statusCode}`); }
    await pipeline(response, createWriteStream(destination));
}

async function main() {
    // Published packages contain the portable bridge; consumers only need .NET 9 Runtime.
    if (!process.argv.includes('--force') && existsSync(path.join(root, 'bin/bridge/AssetStudioBridge.dll'))) return;
    let cached = false;
    try { cached = (await readFile(path.join(libraryDir, '.sha256'), 'utf8')).trim() === sha256; } catch {}
    if (!cached) {
        await mkdir(path.join(root, 'bin'), { recursive: true });
        const temporary = await mkdtemp(path.join(root, 'bin/setup-'));
        try {
            const archive = process.env.ASSET_STUDIO_ARCHIVE ?? path.join(temporary, 'portable.zip');
            if (!process.env.ASSET_STUDIO_ARCHIVE) {
                console.log('Downloading official AssetStudioMod v0.19.0 libraries...');
                await download(url, archive);
            }
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(archive)) hash.update(chunk);
            if (hash.digest('hex') !== sha256) throw new Error('AssetStudio archive SHA-256 mismatch');
            const unpacked = path.join(temporary, 'unpacked');
            await createReadStream(archive).pipe(unzipper.Extract({ path: unpacked })).promise();
            await writeFile(path.join(unpacked, '.sha256'), sha256 + '\n');
            await rm(libraryDir, { recursive: true, force: true });
            await rename(unpacked, libraryDir);
        } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    await installBuild();
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
