import fs from 'node:fs';
import path from 'node:path';
import { BridgeTransport } from './transport.js';
import { AssetStudioError, type AssetResult, type OperationOptions } from './types.js';
export * from './types.js';

export class AssetExporter {
    private readonly transport: BridgeTransport;
    private readonly defaultConfig: OperationOptions;

    constructor(config: OperationOptions = {}) {
        if (config.cliPath) throw new AssetStudioError('INVALID_CONFIG', 'cliPath is no longer supported; use bridgePath for a custom bridge DLL');
        this.defaultConfig = { mode: 'export', log: true, group: 'container', assetType: 'all', ...config };
        this.transport = new BridgeTransport(config);
    }

    /** Process id for diagnostics. The same worker is reused until cancelled or closed. */
    get workerPid(): number | undefined { return this.transport.pid; }

    inspect(input: string, options: OperationOptions = {}): Promise<AssetResult> {
        return this.run('inspect', input, undefined, options);
    }

    exportAssets(input: string, output: string, options: OperationOptions = {}): Promise<AssetResult> {
        return this.run('export', input, output, options);
    }

    private async run(method: 'inspect' | 'export', input: string, output: string | undefined,
        options: OperationOptions): Promise<AssetResult> {
        if (!input) throw new AssetStudioError('INVALID_INPUT', 'Missing input path');
        if (!fs.existsSync(input)) throw new AssetStudioError('INPUT_NOT_FOUND', `Input does not exist: ${input}`);
        if (method === 'export' && !output) throw new AssetStudioError('INVALID_INPUT', 'Missing output path');
        if (options.cliPath || options.dotnetPath || options.bridgePath)
            throw new AssetStudioError('INVALID_CONFIG', 'Set bridgePath and dotnetPath when constructing the exporter');
        const merged = { ...this.defaultConfig, ...options };
        const { log, onEvent, signal, timeoutMs, cliPath, dotnetPath, bridgePath, ...config } = merged;
        return this.transport.request(method, path.resolve(input), output ? path.resolve(output) : undefined, config, {
            signal, timeoutMs,
            onEvent(event) {
                if (onEvent) onEvent(event);
                else if (log && event.type === 'log') process.stderr.write(`[${event.level}] ${event.message}\n`);
            },
        });
    }

    /** Stops the worker, waits for exit, and permanently closes this instance. */
    close(): Promise<void> { return this.transport.close(); }
    [Symbol.asyncDispose](): Promise<void> { return this.close(); }
}

export const createExporter = (config?: OperationOptions): AssetExporter => new AssetExporter(config);

/** One-shot convenience function: always closes its worker, including on failure. */
export async function exportAssets(input: string, output: string, config?: OperationOptions): Promise<AssetResult> {
    const exporter = new AssetExporter(config);
    try { return await exporter.exportAssets(input, output); }
    finally { await exporter.close(); }
}

export async function inspectAssets(input: string, config?: OperationOptions): Promise<AssetResult> {
    const exporter = new AssetExporter(config);
    try { return await exporter.inspect(input); }
    finally { await exporter.close(); }
}
