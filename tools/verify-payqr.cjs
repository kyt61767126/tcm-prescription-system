#!/usr/bin/env node
// ============================================================================
//  verify-payqr.cjs — 收款码防替代 CI 校验（零依赖，Node 内置 crypto）
//
//  用法：node tools/verify-payqr.cjs（GitHub Actions: .github/workflows/verify-payqr.yml 自动执行）
//
//  校验内容：
//    1) public/images 与 site-official/images 的收款码 PNG 哈希与信任基线一致
//    2) 两份 download.html 内嵌的运行时校验哈希（PAY_QR_PINS）与信任基线一致
//       （防止只换图片不改 HTML 哈希、或只改一处 HTML 造成镜像漂移）
//
//  ★ 更换收款码的标准流程：
//    ① 新图片先用本地 jsQR 管线解码验证指向官方域名
//       （qr.alipay.com / payapp.wechatpay.cn，工具在 tools/_tmp/qrcrop/，不入库）
//    ② 计算新图 SHA-256（PowerShell: Get-FileHash -Algorithm SHA256）
//    ③ 同步更新哈希，共 3 处文件 4 个位置：
//       public/download.html 与 site-official/download.html 的 PAY_QR_PINS、
//       本文件下方 PINS
//    ④ 提交推送，确认 CI verify-payqr 绿灯
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ★ 信任基线（与两份 download.html 内嵌 PAY_QR_PINS 保持一致）
const PINS = {
    alipay: 'C7CE3852C83C822FD4452E7F1B1E9F36642699BA50766B94EB008397150CBA18',
    wechat: 'BB002EACDA8AF6FB88FC3EBC9C76B101DB644CA9F0D04772660087210F649EF8'
};

function sha256Upper(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

const root = path.resolve(__dirname, '..');
let failed = false;

// 1) 图片文件哈希校验（两个站点目录）
for (const site of ['public', 'site-official']) {
    for (const key of Object.keys(PINS)) {
        const file = path.join(root, site, 'images', 'pay-' + key + '.png');
        if (!fs.existsSync(file)) {
            console.error('[FAIL] 缺失文件: ' + file);
            failed = true;
            continue;
        }
        const hash = sha256Upper(file);
        if (hash !== PINS[key]) {
            console.error('[FAIL] 哈希不匹配: ' + file);
            console.error('       期望: ' + PINS[key]);
            console.error('       实际: ' + hash);
            failed = true;
        } else {
            console.log('[OK] ' + file);
        }
    }
}

// 2) HTML 内嵌运行时哈希一致性校验
for (const site of ['public', 'site-official']) {
    const htmlPath = path.join(root, site, 'download.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    for (const key of Object.keys(PINS)) {
        if (!html.includes(PINS[key])) {
            console.error('[FAIL] ' + site + '/download.html 缺少 ' + key + ' 的运行时校验哈希（PAY_QR_PINS）');
            failed = true;
        } else {
            console.log('[OK] ' + site + '/download.html 内嵌 ' + key + ' 哈希一致');
        }
    }
}

if (failed) {
    console.error('\n收款码完整性校验失败！如为有意更换收款码，请按 verify-payqr.cjs 头部注释的标准流程操作。');
    process.exit(1);
}
console.log('\n收款码完整性校验全部通过。');
