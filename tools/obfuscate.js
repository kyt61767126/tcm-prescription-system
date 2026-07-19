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
// 注意：控制流平坦化、死代码注入、字符串数组等会改变函数运行时行为
// 导致 hashPassword/verifyPassword 等关键函数在混淆后行为异常
// 为保证软件正常使用，已大幅降低混淆强度
const OBFUSCATOR_CONFIG = {
    compact: true,
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0,
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0,
    stringArray: false,
    stringArrayEncoding: [],
    stringArrayThreshold: 0,
    identifierNamesGenerator: 'hexadecimal',
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    // 保留 console 输出，便于调试和错误排查
    disableConsoleOutput: false,
    // 保留注释中的版权信息
    reserveStrings: ['Copyright', '版权所有', '惠康'],
    // 不混淆的标识符（仅保留被内联 HTML 事件处理直接调用的业务函数名）
    reservedNames: [
        // 用户管理（内联 onclick 调用）
        'handleEditUser', 'confirmEditUser', 'handleDeleteUser',
        'handleAddUser', 'handleViewUserPrescriptions',
        'getUsers', 'saveUsers', 'renderUserList',
        // 权限检查（内联调用）
        'isAdmin', 'isClinicAdmin', 'isPlatformAdmin', 'isDoctor',
        'currentUser', 'filterPrescriptionsByPermission',
        // 处方操作（内联调用）
        'renderHistoryList', 'savePrescription', 'printPrescription',
        'clearPrescription', 'loadHistory', 'deleteHistory',
        // 媒体操作（内联调用）
        'openRecordingOverlay', 'openPhotoOverlay',
        'viewMediaFiles', 'mediaViewerNav', 'renderMediaViewerSingle',
        'loadMediaSingleFile', '__openSysPlayer',
        // 药品管理（内联调用）
        'selectMedicine', 'selectPatientName', 'selectFormula',
        'closeMedicineEditModal', 'saveMedicineEdit',
        // 药品导入（内联调用）
        'cancelImportMethod', 'executeImportMethod',
        'confirmFormula', 'confirmMedicine', 'confirmImportMedicines',
        // 密码哈希（内联调用）
        'hashPassword',
        // 搜索框事件处理（内联 onfocus/onblur/onkeyup/onkeydown/onkeypress/oninput）
        'startSearch', 'tryHideSearch', 'handleSearchKey',
        'handleSearchKeyDown', 'handleSearchKeyPress', 'handleInput'
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

// 全部分发目录（相对于项目根目录）
const ALL_DISTRIBUTION_DIRS = [
    'public',
    'public/electron',
    'cloud_project/cloud_desktop',
    'cloud_project/cloud_desktop/electron',
    'cloud_project/cloud_app/app/src/main/assets/public',
    'cloud_project/cloud_app/app/src/main/assets',
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

// 按 target 分组（用于 --target=bendi 等参数，只处理对应版本，大幅加速打包）
const TARGET_DIRS = {
    bendi: [
        'offline_project/db-bendi',
        'offline_project/db-bendi/electron',
        'offline_project/db-bendi/android/app/src/main/assets/public'
    ],
    dingzhi: [
        'offline_project/db-dingzhi',
        'offline_project/db-dingzhi/electron',
        'offline_project/db-dingzhi/android/app/src/main/assets/public'
    ],
    geren: [
        'offline_project/db-geren',
        'offline_project/db-geren/electron',
        'offline_project/db-geren/android/app/src/main/assets/public'
    ],
    cloud: [
        'public',
        'public/electron',
        'cloud_project/cloud_desktop',
        'cloud_project/cloud_desktop/electron',
        'cloud_project/cloud_app/app/src/main/assets/public',
        'cloud_project/cloud_app/app/src/main/assets'
    ],
    all: ALL_DISTRIBUTION_DIRS
};

// 额外需要混淆的文件（各目录中的 login.js，仅离线版 electron 子目录存在）
const EXTRA_FILES = {
    'offline_project/db-bendi/electron': ['login.js'],
    'offline_project/db-dingzhi/electron': ['login.js'],
    'offline_project/db-geren/electron': ['login.js'],
    'cloud_project/cloud_app/app/src/main/assets': ['video-recorder-inject.js']
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
    if (!fs.existsSync(bakPath)) {
        return false;
    }
    try {
        fs.copyFileSync(bakPath, filePath);
        fs.unlinkSync(bakPath);
        return true;
    } catch (e) {
        console.error(`  [WARN] 还原失败 ${filePath}: ${e.message}`);
        return false;
    }
}

// 主逻辑
const JavaScriptObfuscator = loadObfuscator();
const projectRoot = path.resolve(__dirname, '..');

// 解析参数：支持 --target=bendi|dingzhi|geren|cloud|all 和 restore
// 用法示例:
//   node tools/obfuscate.js                          # 混淆全部（默认）
//   node tools/obfuscate.js --target=bendi           # 仅混淆 bendi
//   node tools/obfuscate.js restore                  # 还原全部
//   node tools/obfuscate.js restore --target=bendi   # 仅还原 bendi
const argv = process.argv.slice(2);
const mode = argv.includes('restore') ? 'restore' : 'obfuscate';
const targetArg = argv.find(a => a.startsWith('--target='));
const targetName = targetArg ? targetArg.split('=')[1] : 'all';
const targetLabel = targetName === 'all' ? '全部' : `仅 ${targetName}`;
const DISTRIBUTION_DIRS = (TARGET_DIRS[targetName] || TARGET_DIRS.all);

let successCount = 0;
let failCount = 0;
let skipCount = 0;

console.log(`\n========================================`);
console.log(`  JS 代码混淆工具 (${mode}) [${targetLabel}]`);
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
    // 先统计待处理文件总数，用于显示进度
    let totalFiles = 0;
    for (const dir of DISTRIBUTION_DIRS) {
        const absDir = path.join(projectRoot, dir);
        if (!fs.existsSync(absDir)) continue;
        for (const modFile of MODULE_FILES) {
            if (fs.existsSync(path.join(absDir, modFile))) totalFiles++;
        }
        for (const extraFile of (EXTRA_FILES[dir] || [])) {
            if (fs.existsSync(path.join(absDir, extraFile))) totalFiles++;
        }
    }
    console.log(`正在混淆分发目录中的 JS 文件（共 ${totalFiles} 个，预计 1-${Math.max(1, Math.ceil(totalFiles / 10))} 分钟）...\n`);

    let processed = 0;
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
                processed++;
                process.stdout.write(`  [${processed}/${totalFiles}] ${modFile} ... `);
                if (obfuscateFile(filePath, OBFUSCATOR_CONFIG)) {
                    console.log(`OK`);
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
                processed++;
                process.stdout.write(`  [${processed}/${totalFiles}] ${extraFile} ... `);
                if (obfuscateFile(filePath, OBFUSCATOR_CONFIG)) {
                    console.log(`OK`);
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
    console.log(`  1. 原始文件已备份为 .bak，可用 "node tools/obfuscate.js restore --target=${targetName}" 还原`);
    console.log(`  2. 混淆后请测试功能是否正常`);
    console.log(`  3. 打包分发后，记得执行 restore 还原开发环境\n`);
}
