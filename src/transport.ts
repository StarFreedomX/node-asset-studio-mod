import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { AssetStudioError, type AssetEvent, type AssetResult, type OperationOptions } from './types.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const maxFrameChars = 64 * 1024 * 1024;

interface Pending {
    id: string;
    payload: string;
    resolve: (value: AssetResult) => void;
    reject: (error: Error) => void;
    onEvent?: (event: AssetEvent) => void;
    signal?: AbortSignal;
    abort?: () => void;
    timer?: ReturnType<typeof setTimeout>;
    failure?: Error;
}

/** Single-flight JSONL transport. Cancellation kills only this worker and waits for exit. */
export class BridgeTransport {
    private child?: ChildProcessWithoutNullStreams;
    private pending?: Pending;
    private ready = false;
    private disposed = false;
    private sequence = 0;
    private exitPromise?: Promise<void>;
    private readonly dotnetPath: string;
    private readonly bridgePath: string;

    constructor(options: OperationOptions) {
        const executable = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
        const local = path.join(root, 'bin/dotnet', executable);
        this.dotnetPath = options.dotnetPath ?? (existsSync(local) ? local :
            process.env.DOTNET_ROOT ? path.join(process.env.DOTNET_ROOT, executable) : executable);
        this.bridgePath = path.resolve(options.bridgePath ?? path.join(root, 'bin/bridge/AssetStudioBridge.dll'));
    }

    get pid(): number | undefined { return this.child?.pid; }

    request(method: 'inspect' | 'export', input: string, output: string | undefined,
        config: Record<string, unknown>, options: OperationOptions): Promise<AssetResult> {
        if (this.disposed) return Promise.reject(new AssetStudioError('CLOSED', 'Exporter is closed'));
        if (this.pending) return Promise.reject(new AssetStudioError('BUSY', 'This exporter already has an active request; await it or use another instance'));
        if (options.signal?.aborted) return Promise.reject(new AssetStudioError('ABORTED', 'Operation aborted before starting'));
        const timeout = options.timeoutMs ?? 120_000;
        if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 2_147_483_647)
            return Promise.reject(new AssetStudioError('INVALID_CONFIG', 'timeoutMs must be an integer between 0 and 2147483647'));
        if (!existsSync(this.bridgePath)) return Promise.reject(new AssetStudioError('BRIDGE_NOT_FOUND', 'Run npm run setup:bridge to build AssetStudioBridge.dll'));
        const id = String(++this.sequence);
        const payload = JSON.stringify({ id, method, input, output, config }) + '\n';
        return new Promise((resolve, reject) => {
            this.pending = { id, payload, resolve, reject, onEvent: options.onEvent, signal: options.signal };
            this.pending.abort = () => this.stop(new AssetStudioError('ABORTED', 'Operation aborted'));
            options.signal?.addEventListener('abort', this.pending.abort, { once: true });
            if (timeout > 0) this.pending.timer = setTimeout(() =>
                this.stop(new AssetStudioError('TIMEOUT', `Operation exceeded ${timeout} ms`)), timeout);
            if (!this.child) this.start();
            else if (this.ready) this.send();
        });
    }

    private start(): void {
        let child: ChildProcessWithoutNullStreams;
        try {
            child = spawn(this.dotnetPath, [this.bridgePath], {
                shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (error) {
            this.finish(undefined, new AssetStudioError('BRIDGE_START_FAILED', String(error)));
            return;
        }
        this.child = child;
        this.ready = false;
        let stderr = '';
        let buffer = '';
        const decoder = new StringDecoder('utf8');
        this.exitPromise = new Promise(resolve => {
            child.on('close', (code, signal) => {
                if (this.child === child) {
                    this.child = undefined;
                    this.ready = false;
                    this.finish(undefined, this.pending?.failure ?? new AssetStudioError(
                        'BRIDGE_EXIT', `Bridge exited (code=${code}, signal=${signal})`, stderr ? [stderr] : []));
                }
                resolve();
            });
        });
        child.on('error', error => this.stop(new AssetStudioError('BRIDGE_START_FAILED', error.message)));
        child.stdin.on('error', error => this.stop(new AssetStudioError('PIPE_ERROR', error.message)));
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16_384); });
        child.stdout.on('data', chunk => {
            if (this.child !== child || this.pending?.failure) return;
            buffer += decoder.write(chunk);
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                if (newline > maxFrameChars) { this.stop(new AssetStudioError('PROTOCOL_ERROR', 'Bridge response exceeded 64 MiB')); return; }
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                this.receive(line);
                if (this.pending?.failure) return;
            }
            if (buffer.length > maxFrameChars) this.stop(new AssetStudioError('PROTOCOL_ERROR', 'Bridge response exceeded 64 MiB'));
        });
    }

    private send(): void {
        if (!this.pending || this.pending.failure) return;
        this.child!.stdin.write(this.pending.payload, error => {
            if (error) this.stop(new AssetStudioError('PIPE_ERROR', error.message));
        });
    }

    private receive(line: string): void {
        try {
            const message = JSON.parse(line);
            if (message.type === 'ready') {
                if (this.ready || message.protocol !== 1) throw new Error('Unsupported bridge protocol');
                this.ready = true;
                this.send();
                return;
            }
            const pending = this.pending;
            if (!pending || message.id !== pending.id) throw new Error('Unexpected response id');
            if (message.type === 'result') {
                if (!message.result || !Array.isArray(message.result.assets) || typeof message.result.assetCount !== 'number')
                    throw new Error('Invalid result');
                this.finish(message.result);
            } else if (message.type === 'error') {
                if (typeof message.error?.code !== 'string' || typeof message.error.message !== 'string') throw new Error('Invalid error');
                this.finish(undefined, new AssetStudioError(message.error.code, message.error.message, message.error.details ?? []));
            } else if (message.type === 'log' || message.type === 'progress') {
                try { pending.onEvent?.(message); }
                catch (error) { this.stop(new AssetStudioError('CALLBACK_ERROR', `onEvent failed: ${String(error)}`)); }
            } else throw new Error('Unknown message type');
        } catch (error) {
            this.stop(new AssetStudioError('PROTOCOL_ERROR', `Invalid bridge response: ${String(error)}`));
        }
    }

    private finish(result?: AssetResult, error?: Error): void {
        const pending = this.pending;
        if (!pending) return;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (pending.abort) pending.signal?.removeEventListener('abort', pending.abort);
        if (error) pending.reject(error);
        else pending.resolve(result!);
    }

    private stop(error: Error): void {
        if (this.pending && !this.pending.failure) this.pending.failure = error;
        if (this.child) this.child.kill('SIGKILL');
        else this.finish(undefined, error);
        // Rejection occurs on close, after the process and its stdio are gone.
    }

    async close(): Promise<void> {
        this.disposed = true;
        this.stop(new AssetStudioError('CLOSED', 'Exporter closed'));
        await this.exitPromise;
    }
}
