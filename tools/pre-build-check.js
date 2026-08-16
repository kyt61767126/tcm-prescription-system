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
