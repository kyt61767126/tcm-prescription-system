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
// 注意：控制流平坦化、死代码注入、对象键名转换等会改变函数运行时行为
// 导致 hashPassword/verifyPassword 等关键函数在混淆后行为异常
//
// 配置策略（2026-07-19 恢复轻量级混淆 + 修复桌面版登入失败）：
// 之前用户多次反馈"继续降低安全确保好用"，于 2026-07-19 完全关闭所有混淆。
// 第6轮修复 db-adapter.js 版本冲突（commit aee66f3）后，根因消除，软件恢复正常。
// 经用户同意恢复"不影响运行时行为"的轻量级混淆，仅增加反编译难度：
//   ✅ compact: true              - 压缩为一行，难以阅读
//   ✅ identifierNamesGenerator    - 变量名混淆为 _0x... 形式
//   ❌ stringArray                 - 禁用：RC4 解码在 Electron 桌面端可能失败
//      （历史问题：commit 5bcb0ad 启用 stringArray+RC4 后桌面版登入失败，
//       网页版正常。根因是 'SHA-256'/'PBKDF2'/'PASSWORD_SALT' 等关键字符串
//       被 stringArray 化后 RC4 解码失败，导致 crypto.subtle.digest 调用异常）
//   ❌ controlFlowFlattening       - 禁用：破坏关键函数运行时行为
//   ❌ deadCodeInjection           - 禁用：影响性能，容易触发问题
//   ❌ transformObjectKeys         - 禁用：破坏对象访问
//   ❌ unicodeEscapeSequence       - 禁用：破坏 unicode 字符
// 详见《public/云端版开发规范.md》第七节
const OBFUSCATOR_CONFIG = {
    compact: true,
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0,
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0,
    // ★关键修复：禁用 stringArray + RC4 编码
    // 原因：RC4 解码在 Electron 桌面端环境下可能失败，导致关键字符串
    //       （'SHA-256'、'PBKDF2'、'bnzc_prescription_salt_v1'、'XORv1:'）
    //       返回错误值，crypto.subtle.digest 调用失败，密码验证失败
    // 表现：桌面版登入失败（密码正确），网页版正常（网页版未混淆）
    stringArray: false,
    stringArrayEncoding: [],
    stringArrayThreshold: 0,
    identifierNamesGenerator: 'mangled',
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
    'patient-archive.js',
    'security-guard.js'
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

// 额外需要混淆的文件
// ★关键修复：移除所有 electron/login.js（commit 5bcb0ad 启用混淆后桌面版登入失败）
// 原因：login.js 中的 simpleDecrypt 使用 atob/escape/decodeURIComponent 等
//       编码敏感函数，混淆后行为异常；且 login.js 优先委托 AuthCore.hashPassword，
//       核心算法已在 auth-core.js 中，login.js 不含核心安全资产
// 影响：login.js 不再被混淆（保持明文），可被反编译读取登录流程，
//       但密码哈希值存于 config.json/localStorage，不在 login.js 中，安全性损失可接受
const EXTRA_FILES = {
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
 *
 * P0-A3 修复：处理 .bak 残留导致二次打包失败的 bug
 * - 旧逻辑：仅在 .bak 不存在时备份。若上次打包被 Ctrl+C 中断，.bak 残留而
 *   源文件已是混淆状态，下次打包会跳过备份，导致 restore 还原的是混淆版本
 * - 新逻辑：每次混淆前先校验 .bak 与当前文件内容是否一致：
 *   - 一致：原始状态，正常备份并混淆
 *   - 不一致：上次未还原，自动 restore 一次再混淆
 */
function obfuscateFile(filePath, config) {
    const code = fs.readFileSync(filePath, 'utf8');
    if (!code.trim()) {
        console.log(`  [SKIP] 空文件: ${filePath}`);
        return false;
    }
    const bakPath = filePath + '.bak';

    // 校验 .bak 残留状态
    let sourceCode = code;
    if (fs.existsSync(bakPath)) {
        const bakContent = fs.readFileSync(bakPath, 'utf8');
        if (bakContent !== code) {
            // 当前文件与备份不一致，可能是上次打包未还原
            console.log(`  [WARN] .bak 残留且文件已变化，自动还原后再混淆: ${path.basename(filePath)}`);
            fs.copyFileSync(bakPath, filePath);
            sourceCode = bakContent;
        }
        // .bak 存在且与当前一致：原始状态，无需重新备份
    } else {
        // 首次备份
        fs.writeFileSync(bakPath, code, 'utf8');
    }

    try {
        const result = JavaScriptObfuscator.obfuscate(sourceCode, config);
        fs.writeFileSync(filePath, result.getObfuscatedCode(), 'utf8');
        return true;
    } catch (e) {
        console.error(`  [FAIL] ${filePath}: ${e.message}`);
        // 混淆失败时还原原始内容，避免污染开发环境
        if (fs.existsSync(bakPath)) {
            try { fs.copyFileSync(bakPath, filePath); } catch (_) {}
        }
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
    const allFiles = [];
    for (const dir of DISTRIBUTION_DIRS) {
        const absDir = path.join(projectRoot, dir);
        if (!fs.existsSync(absDir)) continue;

        // 还原模块文件
        for (const modFile of MODULE_FILES) {
            const filePath = path.join(absDir, modFile);
            if (fs.existsSync(filePath + '.bak')) {
                allFiles.push({ dir, file: modFile, filePath });
                if (restoreFile(filePath)) {
                    console.log(`  [OK] ${dir}/${modFile}`);
                    successCount++;
                } else {
                    failCount++;
                }
            }
        }

        // 还原额外文件
        const extras = EXTRA_FILES[dir] || [];
        for (const extraFile of extras) {
            const filePath = path.join(absDir, extraFile);
            if (fs.existsSync(filePath + '.bak')) {
                allFiles.push({ dir, file: extraFile, filePath });
                if (restoreFile(filePath)) {
                    console.log(`  [OK] ${dir}/${extraFile}`);
                    successCount++;
                } else {
                    failCount++;
                }
            }
        }
    }
    console.log(`\n还原完成: ${successCount} 个文件已恢复`);

    // ★ 稳定性修复：restore 后必须校验 .bak 已全部清理
    // 修复前问题：restoreFile 在文件被占用/权限不足时 unlink 失败，.bak 残留但脚本静默退出
    //           下次打包 obfuscateFile 会因 .bak 存在触发"上次未还原"误判，使用错误的源码
    // 修复后：restore 末尾扫描所有处理过的文件，若 .bak 仍存在则明确告警并返回退出码 2
    const residualBaks = [];
    for (const item of allFiles) {
        if (fs.existsSync(item.filePath + '.bak')) {
            residualBaks.push(`${item.dir}/${item.file}`);
        }
    }
    if (residualBaks.length > 0) {
        console.log(`\n[WARN] 发现 ${residualBaks.length} 个 .bak 残留文件：`);
        residualBaks.forEach(f => console.log(`  - ${f}`));
        console.log('\n可能原因：文件被占用 / 权限不足 / restoreFile 失败');
        console.log('建议：手动删除上述 .bak 文件后重新执行 restore');
        process.exit(2);
    } else {
        console.log('[OK] .bak 残留检查通过，无残留文件');
    }
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
