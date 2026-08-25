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

    // ★★★ 2026-08-18 【规范执行三原则：build.files 同步自动化·原则二/三】
    //   build.files 既是该桌面工程打包内容的唯一权威源(原则一)，也必须"可自证"。
    //   新增方向校验：每条 build.files 条目在磁盘上能否解析到文件，防止拼写/路径错、
    //   或新增脚本漏加进 files 却又不被 index.html 引用(仅 main.js 注入)而静默缺包。
    //   原则三(分级·宁漏检不可误报)：条目解析不到 → 仅 [WARN]，不阻断(可能为构建时生成/模板)。
    {
        console.log('');
        console.log('====================================');
        console.log('  build.files 磁盘存在性校验 (WARN级)');
        console.log('====================================');

        function globExists(base, glob) {
            // 递归收集 base 下所有文件相对路径(以 / 分隔)
            const files = [];
            function walk(dir) {
                let entries = [];
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
                for (const ent of entries) {
                    const full = path.join(dir, ent.name);
                    if (ent.isDirectory()) { walk(full); } else { files.push(path.relative(base, full).replace(/\\/g, '/')); }
                }
            }
            walk(base);

            // 通配转正则(支持 **、*)。** 表示零或多个路径段，* 表示单段任意名。
            // ★ 2026-08-26 修复：旧实现按段拼接时，'**' 后跟的字面量段会带上 '/' 前缀，
            //   且 '**' 自带结尾 '/'——两处分隔符叠加/缺失，导致 '**/node_modules/x/**/*'
            //   生成的正则永远匹配不到任何相对路径（better-sqlite3/fs-extra 误报"无命中"）。
            //   正确语义（与 electron-builder/minimatch 对齐）：
            //     '**/x'  匹配 'x' 和 'a/x'；'a/**/b' 匹配 'a/b' 和 'a/x/b'；'a/**' 匹配 'a/...'。
            //   实现要点：'**'（非末段）生成 '(?:[^/]+/)*' 并吞掉其右侧 '/' 分隔符，
            //   因此其后一段不再补 '/'；其余段间正常补 '/'。
            function globToRegexSrc(g) {
                const parts = g.split('/');
                let re = '^';
                let prevDouble = false;
                for (let i = 0; i < parts.length; i++) {
                    const p = parts[i];
                    if (p === '**') {
                        const isLast = (i === parts.length - 1);
                        if (isLast) {
                            re += (i > 0 ? '/' : '') + '.*';
                        } else {
                            if (i > 0 && !prevDouble) re += '/';
                            re += '(?:[^/]+/)*';
                        }
                        prevDouble = !isLast;
                    } else {
                        if (i > 0 && !prevDouble) re += '/';
                        re += (p === '*') ? '[^/]*' : p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                        prevDouble = false;
                    }
                }
                return re + '$';
            }
            const re = globToRegexSrc(glob);
            return files.filter(function (r) { return new RegExp(re).test(r); });
        }

        const missingEntries = [];
        const checkedPatterns = [];
        const rawFiles = (pkg.build && pkg.build.files) || [];
        // 排除规则(以 ! 开头)表示"从打包中剔除"，无需磁盘存在性校验
        const positives = rawFiles.filter(f => !f.startsWith('!'));
        // 每个顶层模式：若条目是文件则直检；若目录/通配则 glob 解析
        for (const gl of positives) {
            if (gl.includes('*')) {
                const hits = globExists(absDir, gl);
                checkedPatterns.push({ gl, count: hits.length });
                if (hits.length === 0) missingEntries.push(gl);
            } else {
                const target = path.join(absDir, gl.split('/').join(path.sep));
                checkedPatterns.push({ gl, count: fs.existsSync(target) ? 1 : 0 });
                if (!fs.existsSync(target)) missingEntries.push(gl);
            }
        }

        for (const c of checkedPatterns) {
            console.log(`       ${c.gl}  ->  ${c.count === 0 ? '无命中' : c.count + (c.count === 1 ? ' 项' : ' 项')}`);
        }
        if (missingEntries.length > 0) {
            console.log('');
            console.log('  [WARN] 以下 build.files 条目在磁盘上无命中，请核对是否拼写错误或被构建时生成：');
            for (const m of missingEntries) console.log('       - ' + m);
            console.log('  (WARN 不阻断发布；若确为遗漏脚本请补入 files 再打包)');
        } else {
            console.log('  [OK] 所有 build.files 条目均有磁盘命中');
        }
    }

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
