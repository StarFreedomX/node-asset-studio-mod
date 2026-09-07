import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { dotnet, dotnetEnv, root } from './dotnet.js';
const result = spawnSync(dotnet, ['run', '--project', path.join(root, 'tests/bridge/SharedResourceReadersTests.csproj'), '-c', 'Release'], {
    stdio: 'inherit', env: dotnetEnv, shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
