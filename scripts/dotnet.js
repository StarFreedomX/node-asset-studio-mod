import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const executable = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
const local = path.join(root, 'bin/dotnet', executable);
export const dotnet = process.env.ASSET_STUDIO_DOTNET ?? (existsSync(local) ? local :
    process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, executable) : executable);
export const dotnetEnv = {
    ...process.env,
    DOTNET_CLI_HOME: path.join(root, 'bin/dotnet-home'),
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
};
