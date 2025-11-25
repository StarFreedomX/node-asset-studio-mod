// scripts/download-cli.js
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, exec } from 'child_process';
import { fileURLToPath } from 'url';
import unzipper from 'unzipper';
import { URL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, '../bin');
const zipPath = path.join(binDir, 'cli.zip');

async function checkDotnet() {
    try {
        const out = execSync('dotnet --list-runtimes').toString();
        if (out.includes('Microsoft.NETCore.App 9.')) {
            console.log('✔ 已检测到 .NET 9 Runtime');
            return true;
        }
    } catch {}
    console.log(`
⚠ 检测到未安装 .NET 9 Runtime
Windows (.NET Desktop): https://dotnet.microsoft.com/download/dotnet/9.0
Linux/macOS (.NET Runtime): https://dotnet.microsoft.com/download/dotnet/9.0
`);
    return false;
}

function getDownloadURL() {
    const base = 'https://github.com/aelurum/AssetStudio/releases/download/v0.19.0';

    switch (os.platform()) {
        case 'win32':
            return `${base}/AssetStudioModCLI_net9_win64.zip`;
        case 'darwin':
            return `${base}/AssetStudioModCLI_net9_osx.zip`;
        case 'linux':
            return `${base}/AssetStudioModCLI_net9_linux64.zip`;
    }
    throw new Error('Unsupported platform');
}

function mirrorURLs(url) {
    const u = new URL(url);
    return [
        `https://ghproxy.net/${url}`,
        `https://download.fastgit.org${u.pathname}`,
        `https://github.com.cnpmjs.org${u.pathname}`
    ];
}

function download(url) {
    return new Promise((resolve, reject) => {
        console.log('Downloading:', url);

        https.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(download(res.headers.location)); // 处理302跳转
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            fs.mkdirSync(binDir, { recursive: true });
            const file = fs.createWriteStream(zipPath);

            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error', reject);
        }).on('error', reject);
    });
}

async function extract() {
    console.log('Extracting...');
    await fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: binDir }))
        .promise();
}

async function main() {
    await checkDotnet();

    const url = getDownloadURL();
    const urls = [...mirrorURLs(url), url];

    for (const u of urls) {
        try {
            console.log('尝试下载:', u);
            await download(u);
            console.log('✔ 下载成功:', u);
            await extract();
            console.log('AssetStudioModCLI 下载完成');
            fs.unlinkSync(zipPath);
            console.log('已清理临时文件 cli.zip');
            return;
        } catch (err) {
            console.log(`✘ 失败: ${u}`);
            console.log(err.message);
        }
    }

    console.error('所有下载方式均失败，请手动下载');
    process.exit(1);
}

main();
