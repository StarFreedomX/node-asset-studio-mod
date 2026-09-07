import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
send({ type: 'ready', protocol: 1, pid: process.pid });
for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    const { id, config } = request;
    switch (config.filterByName) {
        case 'hang':
            send({ type: 'progress', id, phase: 'load', percent: 0 });
            await new Promise(() => { setInterval(() => {}, 1000); });
            break;
        case 'malformed': process.stdout.write('not json\n'); break;
        case 'exit': process.exit(7); break;
        case 'error':
            send({ type: 'error', id, error: { code: 'ASSET_PROCESSING_ERROR', message: 'corrupt asset', details: ['typed error'] } });
            break;
        default: {
            // Intentionally split a UTF-8 character and protocol line across writes.
            const frame = Buffer.from(JSON.stringify({ type: 'log', id, level: 'info', message: '图片 error failed exception are ordinary asset names' }) + '\n');
            const split = frame.indexOf(Buffer.from('图片')) + 1;
            process.stdout.write(frame.subarray(0, split));
            await new Promise(resolve => setTimeout(resolve, 5));
            process.stdout.write(frame.subarray(split));
            send({ type: 'result', id, result: { loadedFiles: 1, assetCount: 1, exportedCount: 0, output: null,
                assets: [{ name: request.input, type: 'Texture2D', pathId: '9047243551543287020',
                    container: '', size: 1, source: String(process.pid) }] } });
        }
    }
}
