// ============================================================================
//  license-generator.js — 授权文件生成工具 v2（命令行，支持版本分级）
//  用法：
//    node tools/license-generator.js --user "张三" --expire "2027-07-20" --type "pro"
//    node tools/license-generator.js --user "李四" --days 365 --type "personal"
//    node tools/license-generator.js --user "王五" --days 30 --type "trial"
//    node tools/license-generator.js --user "赵六" --days 365 --type "pro" --features "backup,sync,multi-device"
//
//  v2 新增：
//    - 支持 --type 决定 maxPrescriptions/features 默认值
//    - 可用 --max-prescriptions N 覆盖默认处方数量限制
//    - 可用 --features "a,b,c" 覆盖默认功能列表
//
//  输出：
//    1. 在指定目录生成 license.dat 文件
//    2. 同时输出激活码（base64 字符串），可发给用户
//    3. 用户将 license.dat 放到 exe 同级目录即可激活
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ★ 必须与 license-manager.js 中的密钥保持一致
const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';

// ★ v2: 版本类型默认配置（必须与 license-manager.js 中 LICENSE_TYPE_CONFIG 一致）
const LICENSE_TYPE_CONFIG = {
    trial: {
        maxPrescriptions: 30,
        features: []
    },
    personal: {
        maxPrescriptions: 0,  // 0 = 无限
        features: ['backup']
    },
    pro: {
        maxPrescriptions: 0,
        features: ['backup', 'sync', 'multi-device', 'priority-support']
    }
};

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--user') opts.user = args[++i];
        else if (args[i] === '--expire') opts.expire = args[++i];
        else if (args[i] === '--days') opts.days = parseInt(args[++i], 10);
        else if (args[i] === '--type') opts.type = args[++i];
        else if (args[i] === '--max-prescriptions') opts.maxPrescriptions = parseInt(args[++i], 10);
        else if (args[i] === '--features') opts.features = args[++i];
        else if (args[i] === '--output' || args[i] === '-o') opts.output = args[++i];
        else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
授权文件生成工具 v2（支持版本分级）

用法：
  node tools/license-generator.js --user "用户名" --expire "2027-07-20" --type "pro"
  node tools/license-generator.js --user "用户名" --days 365 --type "personal"
  node tools/license-generator.js --user "用户名" --days 30 --type "trial"

参数：
  --user              用户名（必填）
  --expire            到期日期 YYYY-MM-DD（与 --days 二选一）
  --days              有效天数（与 --expire 二选一）
  --type              授权类型：trial / personal / pro（默认 personal）
  --max-prescriptions 处方数量限制（覆盖默认值，0=无限，试用版默认30）
  --features          功能列表，逗号分隔（覆盖默认值，如 "backup,sync"）
  --output, -o        输出文件路径（默认 ./license.dat）

版本类型默认配置：
  trial    : 30 张/月处方，无高级功能
  personal : 无限处方，支持数据备份
  pro      : 无限处方，支持备份+同步+多设备+优先支持

示例：
  # 生成专业版授权（1年）
  node tools/license-generator.js --user "张三" --days 365 --type "pro"

  # 生成个人版授权（到 2027-12-31）
  node tools/license-generator.js --user "李四" --expire "2027-12-31" --type "personal"

  # 生成自定义处方限制的授权
  node tools/license-generator.js --user "王五" --days 365 --type "personal" --max-prescriptions 100
`);
            process.exit(0);
        }
    }
    return opts;
}

// v2 生成 HMAC 签名（含 maxPrescriptions/features，与 license-manager.js 一致）
function generateSignature(data) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : ''
    ].join('|');
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

    // v2: 根据类型获取默认配置，允许命令行参数覆盖
    const config = LICENSE_TYPE_CONFIG[type];
    const maxPrescriptions = opts.maxPrescriptions !== undefined ? opts.maxPrescriptions : config.maxPrescriptions;
    const features = opts.features ? opts.features.split(',').map(s => s.trim()).filter(s => s) : config.features;

    // 生成 license 数据
    const data = {
        user: opts.user,
        type: type,
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        maxPrescriptions: maxPrescriptions,
        features: features
    };
    data.signature = generateSignature(data);

    // 编码为 base64
    const json = JSON.stringify(data, null, 2);
    const base64 = Buffer.from(json, 'utf8').toString('base64');

    // 输出到文件
    const outputPath = opts.output || './license.dat';
    fs.writeFileSync(outputPath, base64, 'utf8');

    // v2: 版本类型中文名
    const typeNames = { trial: '试用版', personal: '个人版', pro: '专业版' };
    const featuresDisplay = features.length > 0 ? features.join(', ') : '（无）';
    const maxDisplay = maxPrescriptions === 0 ? '无限' : maxPrescriptions + ' 张/月';

    console.log('========================================');
    console.log('  授权文件生成成功 v2');
    console.log('========================================');
    console.log(`  用户名：${data.user}`);
    console.log(`  类  型：${data.type}（${typeNames[type]}）`);
    console.log(`  签发日：${data.issuedAt}`);
    console.log(`  到期日：${data.expiresAt}`);
    console.log(`  有效期：${Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))} 天`);
    console.log(`  处方限制：${maxDisplay}`);
    console.log(`  功能列表：${featuresDisplay}`);
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
