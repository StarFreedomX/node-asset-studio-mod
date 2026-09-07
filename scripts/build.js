import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
// dist is ignored by Git and may contain another branch's engine artifacts.
rmSync(path.join(root, 'dist'), { recursive: true, force: true });
const result = spawnSync(process.execPath, [require.resolve('typescript/lib/tsc.js')], {
    cwd: root, stdio: 'inherit', shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
