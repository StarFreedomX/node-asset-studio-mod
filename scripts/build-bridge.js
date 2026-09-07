import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { dotnet, dotnetEnv, root } from './dotnet.js';

export function buildBridge() {
    const sdk = spawnSync(dotnet, ['--list-sdks'], { encoding: 'utf8', env: dotnetEnv, shell: false });
    if (sdk.error || sdk.status !== 0 || !/^9\./m.test(sdk.stdout ?? ''))
        throw new Error('.NET 9 SDK is required to build the bridge. Install it or set ASSET_STUDIO_DOTNET to its dotnet executable.');
    if (!existsSync(path.join(root, 'bin/assetstudio/AssetStudioModCLI_net9_portable/AssetStudio.dll')))
        throw new Error('Missing AssetStudio DLLs. Run npm run setup:bridge first.');
    const staging = path.join(root, 'bin/bridge-staging');
    rmSync(staging, { recursive: true, force: true });
    const result = spawnSync(dotnet, ['publish', path.join(root, 'bridge/AssetStudioBridge.csproj'),
        '-c', 'Release', '-o', staging, '--nologo'], { stdio: 'inherit', env: dotnetEnv, shell: false });
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Bridge build failed (${result.status})`);
    return staging;
}

export async function installBuild() {
    const { rename } = await import('node:fs/promises');
    const staging = buildBridge();
    const destination = path.join(root, 'bin/bridge');
    rmSync(destination, { recursive: true, force: true });
    await rename(staging, destination);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts/build-bridge.js')) {
    installBuild().catch(error => { console.error(error.message); process.exitCode = 1; });
}
