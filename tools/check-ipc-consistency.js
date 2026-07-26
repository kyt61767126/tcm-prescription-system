#!/usr/bin/env node
/**
 * check-ipc-consistency.js - Electron IPC handler 一致性检查工具
 *
 * 目的：防止 preload.js 调用的 IPC 在 main.js 中未注册，导致功能静默失效
 * 原理：解析 preload.js 的 ipcRenderer.invoke/send 调用，对比 main.js 的 ipcMain.handle/on 注册
 *
 * 使用：
 *   node tools/check-ipc-consistency.js
 *   退出码：0=通过，1=发现不匹配
 *
 * 历史背景：
 *   2026-07-26 曾因 preload.js 调用 get-logged-in-user 但 main.js 只注册了 get-current-user，
 *   导致 init() 失败、药物表格和处方历史不显示。本工具用于在打包前发现此类问题。
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// 支持多端 Electron 项目检查（目前仅云端桌面版）
const targets = [
    {
        name: '云端桌面版',
        preload: 'cloud_project/cloud_desktop/electron/preload.js',
        main: 'cloud_project/cloud_desktop/electron/main.js'
    }
];

/**
 * 从文件中提取所有 ipcRenderer.invoke('xxx') 和 ipcRenderer.send('xxx') 调用
 */
function extractPreloadCalls(content) {
    const calls = new Set();
    // 匹配 ipcRenderer.invoke('xxx') 和 ipcRenderer.invoke("xxx")
    const invokeRegex = /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g;
    const sendRegex = /ipcRenderer\.send\(\s*['"]([^'"]+)['"]/g;
    const sendSyncRegex = /ipcRenderer\.sendSync\(\s*['"]([^'"]+)['"]/g;

    let match;
    while ((match = invokeRegex.exec(content)) !== null) calls.add(match[1]);
    while ((match = sendRegex.exec(content)) !== null) calls.add(match[1]);
    while ((match = sendSyncRegex.exec(content)) !== null) calls.add(match[1]);
    return calls;
}

/**
 * 从文件中提取所有 ipcMain.handle('xxx') 和 ipcMain.on('xxx') 注册
 */
function extractMainHandlers(content) {
    const handlers = new Set();
    const handleRegex = /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g;
    const onRegex = /ipcMain\.on\(\s*['"]([^'"]+)['"]/g;

    let match;
    while ((match = handleRegex.exec(content)) !== null) handlers.add(match[1]);
    while ((match = onRegex.exec(content)) !== null) handlers.add(match[1]);
    return handlers;
}

let hasError = false;

for (const target of targets) {
    const preloadPath = path.join(projectRoot, target.preload);
    const mainPath = path.join(projectRoot, target.main);

    if (!fs.existsSync(preloadPath)) {
        console.log(`[SKIP] ${target.name} preload.js 不存在: ${target.preload}`);
        continue;
    }
    if (!fs.existsSync(mainPath)) {
        console.log(`[SKIP] ${target.name} main.js 不存在: ${target.main}`);
        continue;
    }

    const preloadContent = fs.readFileSync(preloadPath, 'utf8');
    const mainContent = fs.readFileSync(mainPath, 'utf8');

    const calls = extractPreloadCalls(preloadContent);
    const handlers = extractMainHandlers(mainContent);

    console.log(`\n[检查] ${target.name}`);
    console.log(`  preload.js 调用的 IPC: ${calls.size} 个`);
    console.log(`  main.js 注册的 handler: ${handlers.size} 个`);

    // 检查 preload 调用但 main 未注册的
    const missing = [];
    for (const call of calls) {
        if (!handlers.has(call)) {
            missing.push(call);
        }
    }

    if (missing.length === 0) {
        console.log(`  [OK] 所有 IPC 调用都有对应的 handler 注册`);
    } else {
        console.log(`  [FAIL] 发现 ${missing.length} 个未注册的 IPC 调用:`);
        missing.forEach(name => {
            console.log(`    - ${name}`);
        });
        hasError = true;
    }

    // 检查 main 注册但 preload 未调用的（冗余 handler，仅提示）
    const unused = [];
    for (const handler of handlers) {
        if (!calls.has(handler)) {
            unused.push(handler);
        }
    }
    if (unused.length > 0) {
        console.log(`  [INFO] ${unused.length} 个冗余 handler（main 注册但 preload 未调用，仅提示）:`);
        unused.slice(0, 10).forEach(name => {
            console.log(`    - ${name}`);
        });
        if (unused.length > 10) console.log(`    ... 等共 ${unused.length} 个`);
    }
}

console.log('');
if (hasError) {
    console.log('[结果] FAIL: 发现 IPC 不匹配，请补全 main.js 中的 handler 注册！');
    console.log('       历史教训：IPC 不匹配会导致功能静默失效（如药物表格不显示、按钮无反应）');
    process.exit(1);
} else {
    console.log('[结果] OK: IPC 一致性检查通过');
    process.exit(0);
}
