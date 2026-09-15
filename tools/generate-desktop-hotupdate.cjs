#!/usr/bin/env node
// ============================================================================
//  generate-desktop-hotupdate.cjs - 桌面端静默热更新包生成器（带 Ed25519 签名）
//
//  【背景】2026-09-14 重建热更新（旧版 22343bc5 于 08-17 因「无验签的裸远程
//  代码加载」被整体移除）。新版三道安全门禁：
//    1. version.json 的 Ed25519 签名（私钥本机签发，客户端内置公钥验签）
//    2. 每文件独立 SHA256 哈希门禁（下载后校验 + 启动时全量复验）
//    3. 任何一关失败 → 自动回退 asar 打包版（asar 永不改动，fuse/完整性链
//       门禁全部保持有效）
//
//  【产物】public/hot-update/desktop/<channel>/ 下散文件 + version.json：
//    - 逐文件清单下载（放弃 zip）：零解压依赖、天然增量（只拉 sha256 变化
//      的文件）、每文件独立校验
//    - config.json 绝不进热包（含密码哈希+配置签名），主进程启动时从 asar
//      复制模板到热目录（等价原同步 XHR 行为）
//
//  【用法】
//    node tools/generate-desktop-hotupdate.cjs -c cloud   # 云桌面（源：public/）
//    node tools/generate-desktop-hotupdate.cjs -c local   # 离线桌面（源：db-offline/desktop/）
//    node tools/generate-desktop-hotupdate.cjs -c cloud -n 2   # 同日第 2 版
//
//  【发布】产物在 public/ 下，随 Git push 由 Cloudflare Pages 自动部署；
//  客户端（update-manager.cjs checkHotUpdate）启动后台静默拉取，下次启动生效。
//
//  【私钥】tools/secrets/LICENSE_SIGN_ED25519_PRIVATE_KEY.pem（gitignore 不入库；
//  与 license v7 签发同一信任根，公钥常量内置于 shared/update-manager.cjs）
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PRIVATE_KEY_PATH = path.join(ROOT, 'tools', 'secrets', 'LICENSE_SIGN_ED25519_PRIVATE_KEY.pem');

// 热包文件清单（相对各自权威源根目录；index.html 引用的全部本地 JS +
// StockCore.loadXlsxLib 双候选链的 xlsx 库。config.json 蓄意排除——见头部注释）
const CHANNELS = {
    cloud: {
        srcDir: path.join(ROOT, 'public'),
        files: [
            'index.html',
            'auth-core.js', 'permission.js', 'normalize-config.js',
            'debug-logger.js', 'print-utils.js', 'medicine-dict.js', 'symptom-dict.js',
            'cloud-api.js', 'performance-utils.js', 'prescription-core.js',
            'stock-core.js', 'security-guard.js',
            'electron/video-recorder.js',
            'xlsx.full.min.js'
        ],
        appVersion: require(path.join(ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'package.json')).version
    },
    local: {
        srcDir: path.join(ROOT, 'app_project', 'db-offline', 'desktop'),
        files: [
            'index.html',
            'auth-core.js', 'permission.js', 'normalize-config.js',
            'debug-logger.js', 'print-utils.js', 'medicine-dict.js', 'symptom-dict.js',
            'performance-utils.js', 'prescription-core.js',
            'stock-core.js', 'security-guard.js',
            'electron/video-recorder.js',
            'vendor/xlsx.full.min.js'
        ],
        appVersion: require(path.join(ROOT, 'app_project', 'db-offline', 'desktop', 'package.json')).version
    }
};

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------
function sha256File(fp) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = fs.createReadStream(fp);
        s.on('data', (d) => h.update(d));
        s.on('end', () => resolve(h.digest('hex')));
        s.on('error', reject);
    });
}

// 规范化签名消息（与客户端 shared/update-manager.cjs buildHotSignMessage 完全一致）
function buildSignMessage(channel, hotVersion, signedAt, files) {
    const parts = files.map((f) => f.name + ':' + f.sha256 + ':' + f.size);
    return 'desktop-hotupdate-v1|' + channel + '|' + hotVersion + '|' + signedAt + '|' + parts.join('|');
}

function main() {
    const argv = process.argv.slice(2);
    let channel = '';
    let seq = 1;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-c') channel = String(argv[i + 1] || '').toLowerCase();
        if (argv[i] === '-n') seq = Math.max(1, parseInt(argv[i + 1], 10) || 1);
    }
    if (!CHANNELS[channel]) {
        console.error('用法: node tools/generate-desktop-hotupdate.cjs -c cloud|local [-n 同日序号]');
        process.exit(1);
    }
    const conf = CHANNELS[channel];

    if (!fs.existsSync(PRIVATE_KEY_PATH)) {
        console.error('[HotUpdateGen] 私钥缺失: ' + PRIVATE_KEY_PATH);
        console.error('  私钥不入库（gitignore）。请从 Cloudflare Secrets / 离线备份恢复后重试。');
        process.exit(1);
    }

    // 1. 逐文件哈希
    // ★ 2026-09-15 P0 行尾铁律（对齐 generate-app-hotupdate.cjs）：文本文件
    //   CRLF→LF 归一化后再哈希/写产物。根因实锤：源文件（sync 链 PREPEND 头等）
    //   含 CRLF 时，本工具按磁盘 CRLF 字节算哈希，git 入库 eol=lf 剥 CR →
    //   线上部署字节 ≠ version.json 清单哈希 → 客户端逐文件 SHA256 门禁
    //   fail-closed 拒收整包（2026-09-14-1 起桌面双渠道所有热包从未送达，
    //   线上实查 manifest=3bd52aa6 vs 部署=057f22e0）。归一化后：
    //   磁盘产物 == git 入库 == 线上部署 == version.json 四方一致。
    const isText = (n) => /\.(js|html|json)$/i.test(n);
    const normalizeLf = (buf) => /\r\n/.test(buf.toString('latin1'))
        ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buf;
    const files = [];
    const fileBufs = new Map();
    for (const name of conf.files) {
        const fp = path.join(conf.srcDir, name);
        if (!fs.existsSync(fp)) {
            console.error('[HotUpdateGen] 源文件缺失: ' + name + '（' + fp + '）');
            process.exit(1);
        }
        let buf = fs.readFileSync(fp);
        if (isText(name)) buf = normalizeLf(buf);
        fileBufs.set(name, buf);
        files.push({ name: name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length });
    }

    // 2. 版本号：YYYY.MM.DD-N（N 为同日序号）
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const hotVersion = now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate()) + '-' + seq;
    const signedAt = Date.now();

    // 3. Ed25519 签名（与 license v7 同一信任根/私钥）
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    const msg = buildSignMessage(channel, hotVersion, signedAt, files);
    const signature = crypto.sign(null, Buffer.from(msg, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');

    // 4. 输出散文件到 public/hot-update/desktop/<channel>/
    const outDir = path.join(ROOT, 'public', 'hot-update', 'desktop', channel);
    fs.mkdirSync(outDir, { recursive: true });
    // 清理旧产物（保证目录与清单严格一致，不留孤儿文件）
    for (const ent of fs.readdirSync(outDir)) {
        fs.rmSync(path.join(outDir, ent), { recursive: true, force: true });
    }
    for (const name of conf.files) {
        const dst = path.join(outDir, name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, fileBufs.get(name)); // 写归一化字节（非 copyFileSync 原样拷贝）
    }

    // ★ 2026-09-15 回读复验：产物落盘后重新读取并校验哈希（防 fs 写入异常
    //   造成「清单哈希 ≠ 磁盘产物」——客户端下载的正是磁盘产物字节）
    for (const f of files) {
        const rb = fs.readFileSync(path.join(outDir, f.name));
        const rbHash = crypto.createHash('sha256').update(rb).digest('hex');
        if (rb.length !== f.size || rbHash !== f.sha256) {
            console.error('[HotUpdateGen] 回读复验失败: ' + f.name + '（磁盘产物与清单不一致）');
            process.exit(1);
        }
    }

    // 5. version.json（manifest 与签名一体：客户端下载后验签，热目录副本供启动复验）
    const version = {
        format: 1,
        channel: channel,
        hotVersion: hotVersion,
        appVersion: conf.appVersion,   // 信息字段：生成时的桌面 app 版本（非门禁）
        files: files,
        signedAt: signedAt,
        signature: signature
    };
    fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(version, null, 2));

    const totalKB = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024);
    console.log('[HotUpdateGen] 渠道=' + channel + ' 热版本=' + hotVersion + '（app ' + conf.appVersion + '）');
    console.log('[HotUpdateGen] 文件 ' + files.length + ' 个，合计 ' + totalKB + ' KB → ' + path.relative(ROOT, outDir));
    console.log('[HotUpdateGen] 签名=' + signature.slice(0, 24) + '…（Ed25519）');
    console.log('[HotUpdateGen] 发布：git add public/hot-update/desktop/' + channel + ' && git push（Cloudflare Pages 自动部署）');
}

main();
