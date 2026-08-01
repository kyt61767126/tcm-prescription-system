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
//   例如：node tools/pre-build-check.js app_project/db-offline/desktop_geren
//   退出码：0=通过，1=发现缺失
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

function main() {
    const targetDir = process.argv[2];
    if (!targetDir) {
        console.error('[ERROR] 用法: node pre-build-check.js <项目目录>');
        console.error('  例如: node pre-build-check.js app_project/db-offline/desktop_geren');
        process.exit(1);
    }

    const absDir = path.resolve(targetDir);
    if (!fs.existsSync(absDir)) {
        console.error(`[ERROR] 目录不存在: ${absDir}`);
        process.exit(1);
    }

    const indexPath = path.join(absDir, 'index.html');
    const pkgPath = path.join(absDir, 'package.json');

    if (!fs.existsSync(indexPath)) {
        console.error(`[ERROR] index.html 不存在: ${indexPath}`);
        process.exit(1);
    }
    if (!fs.existsSync(pkgPath)) {
        console.error(`[ERROR] package.json 不存在: ${pkgPath}`);
        process.exit(1);
    }

    console.log('====================================');
    console.log('  打包前安全完整性验证');
    console.log('====================================');
    console.log(`项目目录: ${absDir}`);
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

    console.log(`[1/3] index.html 引用的本地 JS 文件 (${referencedFiles.size} 个):`);
    for (const f of referencedFiles) {
        console.log(`       - ${f}`);
    }
    console.log('');

    // 2. 解析 package.json 的 build.files 列表
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const filesList = (pkg.build && pkg.build.files) || [];
    const fileListPatterns = new Set(filesList);

    console.log(`[2/3] package.json build.files 列表 (${filesList.length} 项):`);
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

    console.log('[3/3] 完整性检查结果:');
    if (present.length > 0) {
        console.log(`  [OK] 已覆盖 (${present.length} 个):`);
        for (const f of present) {
            console.log(`       - ${f}`);
        }
    }

    if (missing.length > 0) {
        console.log('');
        console.log(`  [FAIL] 缺失文件 (${missing.length} 个):`);
        for (const f of missing) {
            console.log(`       - ${f}`);
        }
        console.log('');
        console.log('====================================');
        console.log('  [严重] 发现缺失文件！打包后 exe 将缺少这些脚本！'); 
        console.log('  请在 package.json 的 build.files 列表中添加缺失的文件');
        console.log('====================================');
        process.exit(1);
    }

    console.log('');
    console.log('====================================');
    console.log('  [PASS] 所有 JS 文件均已覆盖，可以安全打包');
    console.log('====================================');

    // ★新增：IPC 一致性检查（仅云端桌面版）
    // 防止 preload.js 调用的 IPC 在 main.js 中未注册，导致功能静默失效
    // 历史教训：2026-07-26 曾因 IPC 不匹配导致药物表格和处方历史不显示
    try {
        const { execSync } = require('child_process');
        console.log('');
        console.log('====================================');
        console.log('  IPC 一致性检查（云端桌面版）');
        console.log('====================================');
        const checkIpcScript = path.join(__dirname, 'check-ipc-consistency.js');
        execSync('node "' + checkIpcScript + '"' , { stdio: 'inherit' });
    } catch (e) {
        // check-ipc-consistency.js 退出码 1 表示发现不匹配
        console.log('');
        console.log('====================================');
        console.log('  [FAIL] IPC 一致性检查未通过！请补全 main.js 中的 handler 注册');
        console.log('====================================');
        process.exit(1);
    }

    process.exit(0);
}

main();
