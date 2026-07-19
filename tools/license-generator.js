// ============================================================================
//  license-generator.js — 授权文件生成工具（命令行）
//  用法：
//    node tools/license-generator.js --user "张三" --expire "2027-07-20" --type "pro"
//    node tools/license-generator.js --user "李四" --expire "2027-12-31" --type "personal"
//    node tools/license-generator.js --user "王五" --days 365 --type "pro"
//
//  输出：
//    1. 在当前目录生成 license.dat 文件
//    2. 同时输出激活码（base64 字符串），可发给用户
//    3. 用户将 license.dat 放到 exe 同级目录即可激活
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ★ 必须与 license-manager.js 中的密钥保持一致
const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--user') opts.user = args[++i];
        else if (args[i] === '--expire') opts.expire = args[++i];
        else if (args[i] === '--days') opts.days = parseInt(args[++i], 10);
        else if (args[i] === '--type') opts.type = args[++i];
        else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
        else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
授权文件生成工具

用法：
  node tools/license-generator.js --user "用户名" --expire "2027-07-20" --type "pro"
  node tools/license-generator.js --user "用户名" --days 365 --type "personal"

参数：
  --user     用户名（必填）
  --expire   到期日期 YYYY-MM-DD（与 --days 二选一）
  --days     有效天数（与 --expire 二选一）
  --type     授权类型：trial / personal / pro（默认 personal）
  --output   输出文件路径（默认 ./license.dat）

示例：
  node tools/license-generator.js --user "张三" --days 365 --type "pro"
`);
            process.exit(0);
        }
    }
    return opts;
}

// 生成 HMAC 签名
function generateSignature(data) {
    const content = [data.user, data.type, data.issuedAt, data.expiresAt].join('|');
    return crypto.createHmac('sha256', LICENSE_HMAC_KEY).update(content).digest('hex');
}

// 主函数
function main() {
    const opts = parseArgs();

    if (!opts.user) {
        console.error('[错误] 缺少必填参数 --user');
        process.exit(1);
    }

    // 计算到期时间
    let expiresAt;
    if (opts.expire) {
        expiresAt = new Date(opts.expire + 'T23:59:59+08:00');  // 北京时间当天 23:59:59
    } else if (opts.days) {
        expiresAt = new Date(Date.now() + opts.days * 24 * 60 * 60 * 1000);
    } else {
        console.error('[错误] 必须指定 --expire 或 --days');
        process.exit(1);
    }

    if (isNaN(expiresAt.getTime())) {
        console.error('[错误] 到期时间格式无效');
        process.exit(1);
    }

    const type = opts.type || 'personal';
    if (!['trial', 'personal', 'pro'].includes(type)) {
        console.error('[错误] --type 必须是 trial / personal / pro');
        process.exit(1);
    }

    // 生成 license 数据
    const data = {
        user: opts.user,
        type: type,
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString()
    };
    data.signature = generateSignature(data);

    // 编码为 base64
    const json = JSON.stringify(data, null, 2);
    const base64 = Buffer.from(json, 'utf8').toString('base64');

    // 输出到文件
    const outputPath = opts.output || './license.dat';
    fs.writeFileSync(outputPath, base64, 'utf8');

    console.log('========================================');
    console.log('  授权文件生成成功');
    console.log('========================================');
    console.log(`  用户名：${data.user}`);
    console.log(`  类  型：${data.type}`);
    console.log(`  签发日：${data.issuedAt}`);
    console.log(`  到期日：${data.expiresAt}`);
    console.log(`  有效期：${Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))} 天`);
    console.log('----------------------------------------');
    console.log(`  文件路径：${path.resolve(outputPath)}`);
    console.log('========================================');
    console.log('');
    console.log('使用方法：');
    console.log('  1. 将 license.dat 文件放到 exe 同级目录');
    console.log('  2. 重启软件即可激活');
    console.log('');
    console.log('激活码（可发给用户，让其保存为 license.dat）：');
    console.log('----------------------------------------');
    console.log(base64);
    console.log('----------------------------------------');
}

main();
