// ============================================================================
// pre-build-check.js — 打包前安全完整性验证
//
// 用途：在 build.bat 打包前运行，自动检查 index.html 引用的所有 JS 文件
//       是否都在 package.json 的 build.files 列表中，防止打包后缺失关键脚本
//
// 背景：2026-07-25 发现 security-guard.js 未打包进 exe 的严重安全漏洞，
//       原因是 index.html 引用了但 package.json files 列表遗漏。
//       本脚本防止类似问题再次发生。
//
// 用法：node tools/pre-build-check.js <项目目录>
//   例如：node tools/pre-build-check.js app_project/db-offline/desktop
//   退出码：0=通过，1=发现缺失
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

function main() {
    const targetDir = process.argv[2];
    if (!targetDir) {
        console.error('[ERROR] Usage: node pre-build-check.js <project-dir>');
        console.error('  Example: node pre-build-check.js app_project/db-offline/desktop');
        process.exit(1);
    }

    const absDir = path.resolve(targetDir);
    if (!fs.existsSync(absDir)) {
        console.error(`[ERROR] Directory not found: ${absDir}`);
        process.exit(1);
    }

    const indexPath = path.join(absDir, 'index.html');
    const pkgPath = path.join(absDir, 'package.json');

    if (!fs.existsSync(indexPath)) {
        console.error(`[ERROR] index.html not found: ${indexPath}`);
        process.exit(1);
    }
    if (!fs.existsSync(pkgPath)) {
        console.error(`[ERROR] package.json not found: ${pkgPath}`);
        process.exit(1);
    }

    console.log('====================================');
    console.log('  Pre-build Security Integrity Check');
    console.log('====================================');
    console.log(`Project dir: ${absDir}`);
    console.log('');

    // 1. 解析 index.html 中所有 <script src="xxx.js"> 引用
    const html = fs.readFileSync(indexPath, 'utf8');
    const scriptRegex = /<script\s+[^>]*src=["']([^"']+\.js)["'][^>]*>/gi;
    const referencedFiles = new Set();
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        // 只检查本地文件（不含 http://、https://、// 开头）
        const src = match[1];
        if (!src.startsWith('http') && !src.startsWith('//') && !src.startsWith('file://')) {
            referencedFiles.add(src);
        }
    }

    console.log(`[1/3] index.html referenced local JS files (${referencedFiles.size}):`);
    for (const f of referencedFiles) {
        console.log(`       - ${f}`);
    }
    console.log('');

    // 2. 解析 package.json 的 build.files 列表
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const filesList = (pkg.build && pkg.build.files) || [];
    const fileListPatterns = new Set(filesList);

    console.log(`[2/3] package.json build.files list (${filesList.length} items):`);
    for (const f of filesList) {
        console.log(`       - ${f}`);
    }
    console.log('');

    // 3. 检查每个引用的 JS 文件是否被 files 列表覆盖
    // files 列表可能包含通配符（如 electron/**/*），需要匹配
    function isCovered(filePath, patterns) {
        for (const pattern of patterns) {
            if (pattern === filePath) return true;
            // 处理通配符
            if (pattern.endsWith('/**/*')) {
                const prefix = pattern.slice(0, -4);
                if (filePath.startsWith(prefix)) return true;
            }
            if (pattern.endsWith('/*')) {
                const prefix = pattern.slice(0, -1);
                if (filePath.startsWith(prefix) && !filePath.slice(prefix.length).includes('/')) return true;
            }
            if (pattern === '**/*') return true;
        }
        return false;
    }

    const missing = [];
    const present = [];
    for (const ref of referencedFiles) {
        if (isCovered(ref, fileListPatterns)) {
            present.push(ref);
        } else {
            missing.push(ref);
        }
    }

    console.log('[3/3] Integrity check results:');
    if (present.length > 0) {
        console.log(`  [OK] Covered (${present.length}):`);
        for (const f of present) {
            console.log(`       - ${f}`);
        }
    }

    if (missing.length > 0) {
        console.log('');
        console.log(`  [FAIL] Missing files (${missing.length}):`);
        for (const f of missing) {
            console.log(`       - ${f}`);
        }
        console.log('');
        console.log('====================================');
        console.log('  [CRITICAL] Missing files detected! exe will lack these scripts after build!');
        console.log('  Add missing files to package.json build.files list');
        console.log('====================================');
        process.exit(1);
    }

    console.log('');
    console.log('====================================');
    console.log('  [PASS] All JS files covered, safe to build');
    console.log('====================================');

    // ★★★ 2026-08-18 【举一反三防旧包】打包前版本标签身份校验
    //   背景：云端桌面上次被打成"惠康中医-标准版"标签——index.html 由离线/标准版模板复制后
    //         身份硬编码未全量更新，残留 window.EDITION='personal'、window.PRODUCT_NAME='惠康中医-本地'。
    //   本质：打包只反映"打包那一刻"工作区源码（prepare-win-unpacked 按 build.files 原样打进 app.asar），
    //         若 index.html 身份标识与打包目标不符，产出的 exe 就是错误/旧内容。
    //   措施：打包前强制校验身份，不符即 FAIL 中止，杜绝旧/错误包再次产出。
    //   原则：宁可漏检不可误报——仅在「确定矛盾」时 FAIL（离线身份硬编码出现在云端目标，或反之）。
    {
        const normTarget = absDir.replace(/\\/g, '/');
        const isCloud = normTarget.includes('db-yunduan');
        const htmlTitle = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
        const hasOfflineProd = /window\.PRODUCT_NAME\s*=\s*'惠康中医-本地'/.test(html);
        const hasCloudProd = /window\.PRODUCT_NAME\s*=\s*'惠康中医-云端'/.test(html);
        const hasCloudConfig = /productName:\s*'惠康中医-云端'/.test(html);
        const appModeMatch = html.match(/window\.APP_MODE\s*=\s*'([^']+)'/);
        const appMode = appModeMatch ? appModeMatch[1] : '';
        const editionErrors = [];

        if (isCloud) {
            // 云端桌面：绝不能残留离线"本地"身份
            if (hasOfflineProd) editionErrors.push('发现离线身份硬编码 window.PRODUCT_NAME=惠康中医-本地（云端桌面必须为 惠康中医-云端）');
            if (!hasCloudProd && !hasCloudConfig) editionErrors.push('缺少云端产品名（window.PRODUCT_NAME=惠康中医-云端 或 CONFIG.productName=惠康中医-云端）');
            if (appMode && appMode !== 'cloud') editionErrors.push('window.APP_MODE 不是 cloud（当前=' + appMode + '），云端桌面必须为 cloud');
            // 仅当 title 含裸版本标签（标准版/机构版）但缺「云端」前缀时判 FAIL（如旧bug"惠康中医-标准版"）；
            // 通用标题（如"惠康中医诊所管理系统"）不误报
            if (/标准版|机构版/.test(htmlTitle) && htmlTitle.indexOf('云端') < 0) editionErrors.push('<title> 含版式标签但缺「云端」前缀（当前="' + htmlTitle + '"），应如 惠康中医-云端标准版/机构版');
        } else {
            // 离线桌面：身份必须为 惠康中医-本地 / 离线
            if (hasCloudProd) editionErrors.push('发现云端身份硬编码 window.PRODUCT_NAME=惠康中医-云端（离线桌面必须为 惠康中医-本地）');
            if (!hasOfflineProd) editionErrors.push('缺少离线产品名 hardcode（window.PRODUCT_NAME=惠康中医-本地）');
            if (appMode && appMode !== 'offline') editionErrors.push('window.APP_MODE 不是 offline（当前=' + appMode + '），离线桌面必须为 offline');
        }

        if (editionErrors.length > 0) {
            console.log('');
            console.log('====================================');
            console.log('  [FAIL] 打包前版本标签身份校验失败！产出必为旧/错误包!');
            for (const e of editionErrors) console.log('       - ' + e);
            console.log('  请修正 ' + path.basename(indexPath) + ' 的版本身份标识后再打包');
            console.log('====================================');
            process.exit(1);
        } else {
            console.log('');
            console.log('====================================');
            console.log('  [PASS] 打包前版本标签身份校验通过（' + (isCloud ? '云端' : '离线') + ' 桌面）');
            console.log('====================================');
        }
    }

    // ★新增：IPC 一致性检查（按目标端选择对应项目）
    // ★ 第三轮打包优化 S1：原无条件调用只检查云端，导致离线打包被云端 IPC 状态误伤，
    //   且离线自身 IPC 从未被检查。现根据项目目录判定目标端，只检查对应端。
    //   历史教训：2026-07-26 曾因 IPC 不匹配导致药物表格和处方历史不显示
    try {
        const { execSync } = require('child_process');
        console.log('');
        console.log('====================================');
        console.log('  IPC consistency check');
        console.log('====================================');
        const checkIpcScript = path.join(__dirname, 'check-ipc-consistency.js');
        const normDir = absDir.replace(/\\/g, '/');
        const ipcTarget = normDir.includes('db-yunduan') ? 'cloud' : 'offline';
        execSync('node "' + checkIpcScript + '" --target=' + ipcTarget, { stdio: 'inherit' });
        console.log(`  [OK] IPC consistency check passed (${ipcTarget})`);
    } catch (e) {
        // check-ipc-consistency.js 退出码 1 表示发现不匹配
        console.log('');
        console.log('====================================');
        console.log('  [FAIL] IPC consistency check failed! Add missing handler registrations in main.js');
        console.log('====================================');
        process.exit(1);
    }

    process.exit(0);
}

main();
