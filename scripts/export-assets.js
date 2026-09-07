import { exportAssets } from '../dist/index.js';

const [input, output, unityVersion] = process.argv.slice(2);
if (!input || !output) {
    console.error('Usage: node scripts/export-assets.js <input file/folder> <output folder> [unity version]');
    process.exitCode = 1;
} else {
    try {
        const result = await exportAssets(input, output, {
            assetType: ['tex2d', 'sprite', 'textasset'],
            imageFormat: 'png',
            ...(unityVersion ? { unityVersion } : {}),
        });
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error.code ?? 'ERROR', error.message);
        if (error.details?.length) console.error(error.details.join('\n'));
        process.exitCode = 1;
    }
}
