/**
 * JavaScript 代码混淆工具
 *
 * 功能：在打包分发前，对 shared/*.js 分发目录中的文件进行混淆
 * 用法：node tools/obfuscate.js
 *
 * 混淆策略：
 * - 字符串数组化 + RC4 加密
 * - 控制流平坦化
 * - 死代码注入
 * - 变量名混淆
 * - 对象键名转换
 *
 * 注意：
 * - shared/ 源文件不混淆（开发调试用）
 * - 仅混淆各分发目录中的 .js 文件
 * - 混淆后文件不可读，请确保打包前已测试通过
 */

const fs = require('fs');
const path = require('path');

// 混淆配置（平衡安全性与性能）
const OBFUSCATOR_CONFIG = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.75,
    identifierNamesGenerator: 'hexadecimal',
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    // 保留注释中的版权信息
    reserveStrings: ['Copyright', '版权所有', '惠康'],
    // 不混淆的标识符（保持API兼容）
    reservedNames: [
        'AuthCore', 'Permission', 'DBG', 'PrintUtils',
        'MedicineDict', 'DbAdapter', 'PerfUtils',
        'PrescriptionCore', 'PatientArchive',
        'window', 'document', 'localStorage', 'sessionStorage',
        'console', 'fetch', 'Promise', 'IndexedDB',
        'require', 'module', 'exports', 'process',
        'crypto', 'TextEncoder', 'URL', 'Date',
        'JSON', 'Object', 'Array', 'String', 'Number',
        'Boolean', 'Error', 'Map', 'Set', 'Math',
        'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent',
        'decodeURIComponent', 'setTimeout', 'setInterval',
        'clearTimeout', 'clearInterval', 'requestAnimationFrame',
        'cancelAnimationFrame', 'IntersectionObserver', 'MutationObserver',
        'indexedDB', 'openDatabase', 'navigator', 'location',
        'history', 'screen', 'alert', 'confirm', 'prompt',
        'capacitor', 'Capacitor', 'electronAPI', 'ipcRenderer',
        'androidAppExit', 'AndroidAppExit'
    ]
};

// 需要混淆的模块文件名
const MODULE_FILES = [
    'auth-core.js',
    'permission.js',
    'debug-logger.js',
    'print-utils.js',
    'medicine-dict.js',
    'db-adapter.js',
    'performance-utils.js',
    'prescription-core.js',
    'patient-archive.js'
];

// 分发目录（相对于项目根目录）
const DISTRIBUTION_DIRS = [
    'public',
    'public/electron',
    'cloud_project/cloud_desktop',
    'cloud_project/cloud_desktop/electron',
    'offline_project/db-bendi',
    'offline_project/db-bendi/electron',
    'offline_project/db-dingzhi',
    'offline_project/db-dingzhi/electron',
    'offline_project/db-geren',
    'offline_project/db-geren/electron',
    'offline_project/db-bendi/android/app/src/main/assets/public',
    'offline_project/db-dingzhi/android/app/src/main/assets/public',
    'offline_project/db-geren/android/app/src/main/assets/public'
];

// 额外需要混淆的文件（各目录中的 login.js, main.js, preload.js）
const EXTRA_FILES = {
    'public/electron': ['login.js'],
    'cloud_project/cloud_desktop/electron': ['login.js'],
    'offline_project/db-bendi/electron': ['login.js'],
    'offline_project/db-dingzhi/electron': ['login.js'],
    'offline_project/db-geren/electron': ['login.js']
};

/**
 * 动态加载 javascript-obfuscator
 */
function loadObfuscator() {
    try {
        // 尝试从项目 node_modules 加载
        const projectPath = path.resolve(__dirname, '..');
        const obfuscatorPath = path.join(projectPath, 'node_modules', 'javascript-obfuscator');
        if (fs.existsSync(obfuscatorPath)) {
            return require(obfuscatorPath);
        }
        // 尝试全局加载
        return require('javascript-obfuscator');
    } catch (e) {
        console.error('\n[ERROR] javascript-obfuscator 未安装');
        console.error('请先执行: npm install --save-dev javascript-obfuscator\n');
        process.exit(1);
    }
}

/**
 * 混淆单个 JS 文件
 */
function obfuscateFile(filePath, config) {
    const code = fs.readFileSync(filePath, 'utf8');
    if (!code.trim()) {
        console.log(`  [SKIP] 空文件: ${filePath}`);
        return false;
    }
    try {
        const result = JavaScriptObfuscator.obfuscate(code, config);
        // 备份原文件（仅首次）
        const bakPath = filePath + '.bak';
        if (!fs.existsSync(bakPath)) {
            fs.writeFileSync(bakPath, code, 'utf8');
        }
        fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
        return true;
    } catch (e) {
        console.error(`  [FAIL] ${filePath}: ${e.message}`);
        return false;
    }
}

/**
 * 还原混淆（从 .bak 恢复）
 */
function restoreFile(filePath) {
    const bakPath = filePath + '.bak';
    if (fs.existsSync(bakPath)) {
        fs.copyFileSync(bakPath, filePath);
        fs.unlinkSync(bakPath);
        return true;
    }
    return false;
}

// 主逻辑
const JavaScriptObfuscator = loadObfuscator();
const projectRoot = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'obfuscate'; // obfuscate | restore

let successCount = 0;
let failCount = 0;
let skipCount = 0;

console.log(`\n========================================`);
console.log(`  JS 代码混淆工具 (${mode})`);
console.log(`========================================\n`);

if (mode === 'restore') {
    // 还原模式：从 .bak 恢复所有文件
    console.log('正在还原原始文件...\n');
    for (const dir of DISTRIBUTION_DIRS) {
        const absDir = path.join(projectRoot, dir);
        if (!fs.existsSync(absDir)) continue;

        // 还原模块文件
        for (const modFile of MODULE_FILES) {
            const filePath = path.join(absDir, modFile);
            if (fs.existsSync(filePath + '.bak')) {
                if (restoreFile(filePath)) {
                    console.log(`  [OK] ${dir}/${modFile}`);
                    successCount++;
                }
            }
        }

        // 还原额外文件
        const extras = EXTRA_FILES[dir] || [];
        for (const extraFile of extras) {
            const filePath = path.join(absDir, extraFile);
            if (fs.existsSync(filePath + '.bak')) {
                if (restoreFile(filePath)) {
                    console.log(`  [OK] ${dir}/${extraFile}`);
                    successCount++;
                }
            }
        }
    }
    console.log(`\n还原完成: ${successCount} 个文件已恢复`);
} else {
    // 混淆模式
    console.log('正在混淆分发目录中的 JS 文件...\n');

    for (const dir of DISTRIBUTION_DIRS) {
        const absDir = path.join(projectRoot, dir);
        if (!fs.existsSync(absDir)) {
            continue;
        }

        console.log(`目录: ${dir}`);

        // 混淆模块文件
        for (const modFile of MODULE_FILES) {
            const filePath = path.join(absDir, modFile);
            if (fs.existsSync(filePath)) {
                if (obfuscateFile(filePath, OBFUSCATOR_CONFIG)) {
                    console.log(`  [OK] ${modFile}`);
                    successCount++;
                } else {
                    failCount++;
                }
            } else {
                skipCount++;
            }
        }

        // 混淆额外文件
        const extras = EXTRA_FILES[dir] || [];
        for (const extraFile of extras) {
            const filePath = path.join(absDir, extraFile);
            if (fs.existsSync(filePath)) {
                if (obfuscateFile(filePath, OBFUSCATOR_CONFIG)) {
                    console.log(`  [OK] ${extraFile}`);
                    successCount++;
                } else {
                    failCount++;
                }
            }
        }
        console.log('');
    }

    console.log(`========================================`);
    console.log(`  混淆完成`);
    console.log(`  成功: ${successCount}  失败: ${failCount}  跳过: ${skipCount}`);
    console.log(`========================================`);
    console.log(`\n注意:`);
    console.log(`  1. 原始文件已备份为 .bak，可用 "node tools/obfuscate.js restore" 还原`);
    console.log(`  2. 混淆后请测试功能是否正常`);
    console.log(`  3. 打包分发后，记得执行 restore 还原开发环境\n`);
}
