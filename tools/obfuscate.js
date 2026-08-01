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

// 混淆配置（增强反编译难度，平衡安全性与运行时稳定性）
//
// 配置策略（2026-07-30 增强混淆强度）：
// 在 2026-07-19 恢复轻量级混淆的基础上，选择性增强不影响运行时行为的选项：
//   ✅ compact: true              - 压缩为一行，难以阅读
//   ✅ identifierNamesGenerator    - 变量名混淆为 _0x... 形式
//   ✅ stringArray                 - 启用：字符串数组化（base64 编码）
//      使用 base64 编码规避历史 RC4 解码问题（commit 5bcb0ad 启用 stringArray+RC4
//      后桌面版登入失败，根因是 RC4 运行时解码在 Electron 环境下失败）。
//      base64 不依赖运行时解码密钥，在 Electron/WebView 环境下稳定。
//      'SHA-256'/'PBKDF2'/'PASSWORD_SALT' 等关键字符串被数组化后仍可正确还原。
//   ✅ disableConsoleOutput         - 禁用 console 输出，增加反调试难度
//   ✅ selfDefending                - 防格式化，抵抗 beautifier 还原
//   ❌ controlFlowFlattening       - 禁用：破坏关键函数运行时行为
//   ❌ deadCodeInjection            - 禁用：影响性能，容易触发问题
//   ❌ transformObjectKeys          - 禁用：破坏对象访问
//   ❌ unicodeEscapeSequence        - 禁用：破坏 unicode 字符
//   ❌ renameGlobals                - 禁用：避免全局变量冲突
// 详见《public/云端版开发规范.md》第七节
const OBFUSCATOR_CONFIG = {
    compact: true,
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0,
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0,
    // ★禁用 stringArray（2026-07-31 修复用户管理按钮不显示问题）
    // 原因：javascript-obfuscator 的 stringArray base64 解码函数内部使用 charAt，
    //       在 Electron 桌面端环境下运行时抛出
    //       "Cannot read properties of undefined (reading 'charAt')" 错误，
    //       导致 permission.js 的 shouldShowUserManage 等函数失效，
    //       管理员登录后"用户管理"按钮不显示。
    //       历史上 auth-core.js/login.js 因同样原因被移出 MODULE_FILES，
    //       但 permission.js 仍在列表中，混淆后导致本问题。
    // 方案：禁用 stringArray，保留 identifierNamesGenerator 等其他混淆配置。
    //       安全性影响可接受（变量名仍被混淆，代码仍被压缩）。
    stringArray: false,
    stringArrayEncoding: [],
    stringArrayThreshold: 0,
    // 字符串数组包装：stringArray 禁用后无效，保留默认值
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: false,
    identifierNamesGenerator: 'mangled',
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    // 不重命名全局变量，避免全局引用冲突
    renameGlobals: false,
    // 禁用 console 输出，增加反调试难度
    disableConsoleOutput: true,
    // 防格式化：抵抗代码 beautifier 还原（依赖 compact: true）
    selfDefending: true,
    // 保留注释中的版权信息
    reserveStrings: ['Copyright', '版权所有', '惠康'],
    // 仅保留 HTML 内联事件直接调用的标识符（防御性保护）
    // renameGlobals=false 已保证全局变量不被重命名，此处仅作防御性保留。
    // 其余内部函数（hashPassword/generateSignatureV3 等）均可被混淆。
    reservedNames: [
        'startSearch', 'handleSearchKey', 'handleLogin',
        'savePrescription', 'loadData'
    ]
};

// 需要混淆的模块文件名
// ★关键修复：不混淆 auth-core.js（与 login.js 同样原因）
// 原因：javascript-obfuscator 的 stringArray base64 解码函数内部使用 charAt，
//       在 Electron 桌面端环境下运行时抛出
//       "Cannot read properties of undefined (reading 'charAt')" 错误，
//       导致 auth-core.js 加载失败、AuthCore 未定义，连锁导致登录异常和
//       用户管理等功能不可用。
// 安全性影响：auth-core.js 不含核心安全资产（密码哈希值存于 config.json/
//             localStorage，SHA-256 是公开算法），安全性损失可接受。
const MODULE_FILES = [
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
    'app_project/db-yunduan/cloud_desktop',
    'app_project/db-yunduan/cloud_desktop/electron',
    'app_project/db-yunduan/cloud_desktop_geren',
    'app_project/db-yunduan/cloud_desktop_geren/electron',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public',
    'app_project/db-yunduan/cloud_app/app/src/main/assets',
    'app_project/db-offline/desktop',
    'app_project/db-offline/desktop/electron',
    'app_project/db-offline/desktop_geren',
    'app_project/db-offline/desktop_geren/electron',
    'app_project/db-offline/app/app/src/main/assets/public',
    'app_project/db-offline/app_geren/app/src/main/assets/public'
];

// 按 target 分组（用于 --target=dingzhi 等参数，只处理对应版本，大幅加速打包）
const TARGET_DIRS = {
    dingzhi: [
        'app_project/db-offline/desktop',
        'app_project/db-offline/desktop/electron',
        'app_project/db-offline/app/app/src/main/assets/public'
    ],
    geren: [
        'app_project/db-offline/desktop_geren',
        'app_project/db-offline/desktop_geren/electron',
        'app_project/db-offline/app_geren/app/src/main/assets/public'
    ],
    cloud: [
        'public',
        'public/electron',
        'app_project/db-yunduan/cloud_desktop',
        'app_project/db-yunduan/cloud_desktop/electron',
        'app_project/db-yunduan/cloud_desktop_geren',
        'app_project/db-yunduan/cloud_desktop_geren/electron',
        'app_project/db-yunduan/cloud_app/app/src/main/assets/public',
        'app_project/db-yunduan/cloud_app/app/src/main/assets'
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
    'app_project/db-yunduan/cloud_app/app/src/main/assets': ['video-recorder-inject.js']
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

// 解析参数：支持 --target=dingzhi|geren|cloud|all 和 restore
// 用法示例:
//   node tools/obfuscate.js                          # 混淆全部（默认）
//   node tools/obfuscate.js --target=dingzhi         # 仅混淆 dingzhi
//   node tools/obfuscate.js restore                  # 还原全部
//   node tools/obfuscate.js restore --target=dingzhi # 仅还原 dingzhi
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
