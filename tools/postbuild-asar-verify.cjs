// ============================================================================
// postbuild-asar-verify.cjs —— 构建后 asar 架构+版本标识硬校验（C 层单一实现）
// 架构目的：杜绝"修复代码未进 asar，用户却拿到空包 exe 以为已修复"
//   （1.2.80 和 1.0.80 第一次重打都因缓存复用/打包异常造成标识缺失）
// 调用: node tools/postbuild-asar-verify.cjs <package.json_dir> [--asar <app.asar_abs_or_rel_path>]
//       传入桌面版 package.json 所在目录，脚本自动读取 package.json build.output
//       → win-unpacked/resources/app.asar → 逐一检查必需标识清单，任何缺失退出码=1，
//       让 npm run build 或 build.bat 返回非零，阻断后续 Setup/NSIS 打包。
//       可选 --asar 参数：直接指定 app.asar 路径（覆盖 package.json 配置，当 builder 自定义 output 时用）
// ============================================================================
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args[0]) { console.error('[postbuild-verify] 缺少参数: <package.json_dir>'); process.exit(2); }

var explicitAsar = null;
for (var i = 0; i < args.length; i++) {
    if (args[i] === '--asar' && args[i+1]) { explicitAsar = args[i+1]; break; }
}

const pkgDir = path.resolve(args[0]);
const pkgPath = path.join(pkgDir, 'package.json');
if (!fs.existsSync(pkgPath)) { console.error('[postbuild-verify] package.json 不存在:', pkgPath); process.exit(2); }

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '';

var appOutDir;
if (explicitAsar) {
    appOutDir = path.isAbsolute(explicitAsar) ? explicitAsar : path.resolve(process.cwd(), explicitAsar);
} else {
    const outputDir = pkg.build && pkg.build.directories && pkg.build.directories.output
        ? pkg.build.directories.output : 'dist';
    appOutDir = path.join(pkgDir, outputDir, 'win-unpacked', 'resources', 'app.asar');
}

if (!fs.existsSync(appOutDir)) {
    console.error('[postbuild-verify] app.asar 不存在:', appOutDir);
    console.error('                  electron-builder 可能未完成打包，或 outputDir 配置不一致。');
    process.exit(1);
}

// ── 架构/修复标识清单：任何一项缺失 = 修复代码未落位 = 阻断产出安装包 ──
const ISO = fs.readFileSync(appOutDir, 'latin1');
const UTF = fs.readFileSync(appOutDir, 'utf8');

var markers = [];

// A. 架构标记（Single-Writer + Edition Lock）
markers.push({ key: 'Single-Writer 按钮写入源', ok: /__applyUserButtons/.test(ISO) });
markers.push({ key: '补丁入口 __patchOldCallers', ok: /__patchOldCallers/.test(ISO) });
markers.push({ key: 'Edition 归一化锁', ok: /__editionLocked/.test(ISO) });
markers.push({ key: 'Edition 拦截 get/set', ok: /__authoritativeEdition/.test(ISO) });

// B. 1.2.81 / 1.0.81 版本标识
markers.push({ key: 'CONFIG.edition 权威就绪 Promise', ok: /__appConfigReady/.test(ISO) });
var _selfHeal = (UTF.match(/竞态自愈/g) || []).length;
markers.push({ key: '角色自愈兜底(x2+)', ok: _selfHeal >= 2, count: _selfHeal });
var _archFallback = (UTF.match(/机构版正向兜底|__healInstitutionBtns/g) || []).length;
markers.push({ key: '机构版正向兜底/按钮自愈(x1+)', ok: _archFallback >= 1, count: _archFallback });
markers.push({ key: '自动登录await权威配置', ok: /自动登录前先等/.test(UTF) });

// C. 版本号（确保 package.json 已写入的版本号真实出现在 asar）
var versionRe = new RegExp(('"version": "' + version + '"').replace(/\./g, '\\.'));
markers.push({ key: 'asar 版本号 ' + version, ok: versionRe.test(ISO), value: version });

// D. 云端产品标识（若产品是云端机构版，锚点误伤保护必须存在）
if (/云|cloud/i.test(pkg.name || '')) {
    markers.push({ key: '云端锚点误伤保护 _isCloudProd', ok: /_isCloudProd|anyCloudHint|isCloudProduct/.test(ISO) });
    // D2. Arch 2.24（2026-08-21 上午）4 条修复标识
    markers.push({ key: 'Arch 2.24 anyCloudHint 云端无APP_MODE判', ok: /anyCloudHint/.test(ISO) });
    markers.push({ key: 'Arch 2.24 _roleSaysAdmin 存储管理员豁免', ok: /_roleSaysAdmin/.test(ISO) });
    markers.push({ key: 'Arch 2.24 _mustNotDowngrade 永不打user', ok: /_mustNotDowngrade/.test(ISO) });
    // D3. Arch 2.25（2026-08-21 真根因修复）3 条标识
    //     _normalizeEdition = Permission 归一化 institution/standard/中文标签→规范key
    //     （激活写入 edition='institution'，isInstitutional() 精确表不认 → 按钮判标准版真根因）
    //     Arch 2.25 水印 = 按钮可观测版本（悬停 tooltip 出现即新包生效）
    var _d3_1 = /_normalizeEdition/.test(ISO);
    var _d3_2 = /Arch 2\.25/.test(ISO);
    var _d3_3 = /instAdminAssert/.test(ISO);
    markers.push({ key: 'Arch 2.25 _normalizeEdition 别名归一化', ok: _d3_1 });
    markers.push({ key: 'Arch 2.25 水印(按钮title含Arch2.25)', ok: _d3_2 });
    markers.push({ key: 'Arch 2.25 instAdminAssert 机构管理员断言', ok: _d3_3 });
    markers.push({ key: 'Arch 2.25 云端真根因修复 3 项(ALL)', ok: _d3_1 && _d3_2 && _d3_3 });
}

var fail = 0;
console.log('');
console.log('┌──────────────────────────────────────────────────────────────┐');
console.log('│   POSTBUILD-ASAR-VERIFY: 架构+修复标识硬校验                 │');
console.log('│   版本: ' + version + '                                            │');
console.log('└──────────────────────────────────────────────────────────────┘');
console.log('');
markers.forEach(function (m) {
    if (m.ok) {
        var extra = m.count !== undefined ? (' (' + m.count + 'x)') : (m.value ? ' (' + m.value + ')' : '');
        console.log('[PASS] ' + m.key + extra);
    } else {
        fail++;
        console.log('[FAIL] ' + m.key + ' —— !! 修复代码未落位，阻断构建 !!');
    }
});
console.log('');

if (fail > 0) {
    console.error('[postbuild-verify] FAIL ' + fail + ' 项。已阻止生成 Setup exe。请检查：');
    console.error('  · build.files 列表是否包含 button-manager.js / edition-lock.js？');
    console.error('  · 新版本修复代码是否在 shared/permission.js auth-core.js 中同步完毕？');
    console.error('  · 重打前是否 Remove-Item dist_new（asar 缓存复用会复用旧包！）');
    // ★★★ Arch 2.25 红线强制：electron-builder 已产出的 Setup exe 一律删除，
    //   杜绝"校验失败但 exe 还在 dist 里被拿去安装"（1.2.88 事故：验证 FAIL 6 项，
    //   用户仍装上了无 Arch 2.24 修复的旧 asar 包）。失败构建 = 不可交付。
    try {
        // appOutDir = <output>/win-unpacked/resources/app.asar → output 根 = 上三级
        var outputRoot = path.dirname(path.dirname(path.dirname(appOutDir)));
        var quarantined = [];
        fs.readdirSync(outputRoot).forEach(function (f) {
            if (/\.exe$/i.test(f)) {
                try {
                    var fp = path.join(outputRoot, f);
                    fs.unlinkSync(fp);
                    quarantined.push(f);
                } catch (e) { /* exe 被占用（可能正在安装）→ 无法删除，仅提示 */ }
            }
        });
        if (quarantined.length > 0) {
            console.error('  ★ 红线：已删除不可交付的 exe → ' + quarantined.join(' | '));
        } else {
            console.error('  ★ 红线：output 根目录无 exe（或被占用无法删除，请手动删除后再重打包）');
        }
    } catch (e) {
        console.error('  ★ 红线删除 exe 失败（忽略）:', e.message || e);
    }
    process.exit(1);
}

console.log('[postbuild-verify] ALL PASS。允许继续生成 Setup exe ✓');
process.exit(0);
