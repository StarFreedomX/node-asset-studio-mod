import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

/** Platform CLI archives are x64. Keep detection and child-process environment in one place. */
export function findDotnet({ root = projectRoot, env = process.env, platform = process.platform, run = spawnSync } = {}) {
    const name = platform === 'win32' ? 'dotnet.exe' : 'dotnet';
    const candidates = [env.ASSET_STUDIO_DOTNET, path.join(root, 'bin/dotnet', name),
        env.DOTNET_ROOT_X64 && path.join(env.DOTNET_ROOT_X64, name),
        env.DOTNET_ROOT && path.join(env.DOTNET_ROOT, name), name].filter(Boolean);
    for (const executable of new Set(candidates)) {
        const options = { encoding: 'utf8', shell: false, timeout: 10000,
            env: { ...env, DOTNET_CLI_UI_LANGUAGE: 'en-US' }, stdio: ['ignore', 'pipe', 'pipe'] };
        const result = run(executable, ['--list-runtimes'], options);
        if (result.error || result.status !== 0) continue;
        const match = /^Microsoft\.NETCore\.App (9\.\d+\.\d+[^ ]*) \[(.+)\]\s*$/m.exec(result.stdout);
        if (!match) continue;
        const info = run(executable, ['--info'], options);
        if (info.error || info.status !== 0 || !/^\s*Architecture:\s*x64\s*$/m.test(info.stdout)) continue;
        return { executable, version: match[1], root: path.dirname(path.dirname(match[2])) };
    }
    return null;
}

export function cliEnvironment(runtime = findDotnet(), env = process.env) {
    if (!runtime) return { ...env };
    return { ...env, DOTNET_ROOT: runtime.root, DOTNET_ROOT_X64: runtime.root,
        PATH: runtime.root + path.delimiter + (env.PATH ?? '') };
}
