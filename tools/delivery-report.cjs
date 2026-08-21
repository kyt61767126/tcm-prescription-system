// ============================================================================
// delivery-report.cjs — P4：交付核对单一页纸（自动生成）
//
// 架构目的：杜绝"装了新版还报旧问题"时的人工排查成本。打包成功路径末尾
//   自动生成一页纸报告：版本三元组 + 产物哈希 + 关卡结果 + 安装自检步骤 +
//   各端生效方式 + 排障速查。交付时把这一个文件发给用户/自己照着核对即可。
//
// 数据源（全部现成，不重复造轮子）：
//   - build-meta.json       → 三元组（version / buildTimeLocal / archMarker）
//   - dist\*.exe|*.apk      → 产物清单 + sha256
//   - _backup_asar\real_app.asar（缺则 dist\win-unpacked\resources\app.asar）
//                           → asar 哈希 + Arch 标记 + USER-STORE 标记二进制抽查
//   - smoke-runtime --all   → 实时跑拿数字（构建成功路径上刚跑过，秒级复算）
//
// 用法：
//   node tools/delivery-report.cjs --pkg <项目目录>
//     桌面端项目目录 = 含 build-meta.json + dist\（cloud_desktop / db-offline\desktop）
//     APP 端项目目录 = 根目录含 *.apk（db-offline / db-yunduan）
//   生成：<pkg>\dist\交付核对单_V{version}_{端名}.txt（UTF-8 BOM，记事本直开不乱码）
//
// 失败策略：报告是辅助产物（exe 已过全部铁闸），生成失败仅 WARN + exit 0，
//   绝不阻断交付、绝不删 exe。
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const pkgIdx = args.indexOf('--pkg');
const PKG = pkgIdx >= 0 ? path.resolve(args[pkgIdx + 1]) : process.cwd();

// ── 端类型探测 ──
function detectTarget(pkg) {
    const p = pkg.replace(/\\/g, '/').toLowerCase();
    if (p.indexOf('cloud_desktop') >= 0) return { key: 'cloud_desktop', name: '云端桌面版', kind: 'desktop' };
    if (p.indexOf('db-offline') >= 0 && p.indexOf('desktop') >= 0) return { key: 'offline_desktop', name: '离线桌面版', kind: 'desktop' };
    if (p.indexOf('db-offline') >= 0) return { key: 'offline_app', name: '离线APP', kind: 'apk' };
    if (p.indexOf('db-yunduan') >= 0) return { key: 'cloud_app', name: '云端APP', kind: 'apk' };
    return { key: 'unknown', name: '未知端', kind: 'desktop' };
}

function sha256(p) {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function fmtSize(n) {
    if (n > 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtTime(t) {
    const d = new Date(t);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── 收集产物（桌面=dist\*.exe；APP=根目录\*.apk） ──
function collectArtifacts(target) {
    const out = [];
    const dirs = target.kind === 'apk' ? [PKG] : [path.join(PKG, 'dist'), path.join(PKG, 'dist', 'win-unpacked')];
    const ext = target.kind === 'apk' ? '.apk' : '.exe';
    for (const d of dirs) {
        try {
            for (const f of fs.readdirSync(d)) {
                if (!f.toLowerCase().endsWith(ext)) continue;
                if (target.kind === 'desktop' && path.dirname(path.join(d, f)) !== path.join(PKG, 'dist')) continue; // 只取 dist 顶层，win-unpacked 里的免哈希（同 asar 源）
                const fp = path.join(d, f);
                const st = fs.statSync(fp);
                if (st.isDirectory()) continue;
                out.push({ name: f, path: fp, size: st.size, mtime: st.mtimeMs });
            }
        } catch (_) { /* 目录不存在跳过 */ }
    }
    // win-unpacked 主 exe 单独列（不重复哈希大 exe？桌面三件套都要哈希，直接全哈）
    return out;
}

// ── 主流程 ──
function buildReport() {
    const target = detectTarget(PKG);
    const lines = [];
    const W = (s) => lines.push(s);

    // 1. 三元组
    let meta = null;
    const metaPath = path.join(PKG, 'build-meta.json');
    if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
    }

    W('╔══════════════════════════════════════════════════════════════════╗');
    W('║                 交付核对单（DELIVERY CHECKLIST）                   ║');
    W('╚══════════════════════════════════════════════════════════════════╝');
    W('');
    W(`端类型      : ${target.name}（${target.key}）`);
    if (meta) {
        W(`产品 / 版本 : ${meta.productName}  V${meta.version}`);
        W(`构建时间    : ${meta.buildTimeLocal || meta.buildTime}`);
        W(`架构水印    : ${meta.archMarker}`);
        W('');
        W(`★ 版本自证三元组（登录页底部核对）：V${meta.version} | Build ${meta.buildTimeLocal || ''} | ${meta.archMarker}`);
    } else {
        W('⚠ 未找到 build-meta.json（三元组缺失，手工核对版本）');
    }
    W('');

    // 2. 产物清单 + 哈希
    const arts = collectArtifacts(target);
    W('── 产物清单 ──────────────────────────────────────────────────────');
    if (!arts.length) {
        W('  ⚠ 未发现产物（' + (target.kind === 'apk' ? '*.apk' : 'dist\\*.exe') + '）——本报告可能生成于打包前');
    }
    for (const a of arts) {
        W(`  ${a.name}`);
        W(`    大小 ${fmtSize(a.size)}  |  修改 ${fmtTime(a.mtime)}`);
        try { W(`    sha256 ${sha256(a.path)}`); } catch (e) { W(`    sha256 计算失败: ${e.message}`); }
    }
    W('');

    // 3. asar 校验（桌面端专属）
    if (target.kind === 'desktop') {
        const candidates = [
            path.join(PKG, '_backup_asar', 'real_app.asar'),
            path.join(PKG, 'dist', 'win-unpacked', 'resources', 'app.asar'),
        ];
        const asarPath = candidates.find(p => fs.existsSync(p));
        W('── 真 asar 校验（独立抽查，不信任单一工具）──────────────────────');
        if (asarPath) {
            const buf = fs.readFileSync(asarPath).toString('latin1');
            W(`  asar 路径 : ${path.relative(PKG, asarPath)}`);
            W(`  sha256    : ${sha256(asarPath)}`);
            W(`  ${meta && buf.includes(String(meta.version)) ? '✓' : '✗'} asar 内含版本号 ${meta ? meta.version : '?'}`);
            W(`  ${meta && buf.includes(meta.archMarker || 'Arch') ? '✓' : '✗'} asar 内含 ${meta ? meta.archMarker : 'Arch'} 水印`);
            W(`  ${buf.includes('USER-STORE') ? '✓' : '✗'} asar 内含 USER-STORE 标记块（UserStore 权威源已进包）`);
        } else {
            W('  ⚠ 未找到 asar（_backup_asar 与 win-unpacked 均无）');
        }
        W('');
    }

    // 4. 冒烟实时数字（复算，秒级）
    W('── 运行时冒烟（本次实时复算）─────────────────────────────────────');
    let smokeLine = '  （未执行）';
    try {
        const smoke = require('./smoke-runtime.cjs');
        const r = smoke.runAll();
        smokeLine = `  ${r.pass}/${r.total} ${r.fail ? '!!FAIL!!' : '✓'}（7 表面 + login 旁路）`;
    } catch (e) { smokeLine = '  复算异常: ' + e.message; }
    W(smokeLine);
    W('');

    // 5. 关卡清单（build.bat 走到报告生成这步 = 以下全部已通过，红线未过根本到不了这里）
    if (target.kind === 'apk') {
        W('── 本次构建已通过的关卡（APP 严格打包流程）─────────────────────');
        W('  ① 预编译（assets 同步 shared 权威源标记块/文件）');
        W('  ② 非严格打包 + 严格模式打包（Java 层混淆 + 签名校验）');
        W('  ③ APK 签名哈希硬校验');
        W('  ④ 源级冒烟 134 用例（本报告实时复算，见上）');
    } else {
        W('── 本次构建已通过的关卡（走到报告生成 = 全部通过，任一失败会红线删 exe）──');
        W('  铁闸1  副本一致性（shared 权威源 vs 各端副本哈希）');
        W('  铁闸2  prepare-win-unpacked 内嵌校验（Arch 标识 + 版本精确匹配）');
        W('  铁闸3  .bnzc PE 区段完整性嵌入 + verify match:true');
        W('  铁闸4  真 asar 安全备份（_backup_asar，防 consolidation 误删）');
        W('  铁闸5  asar 覆盖 + FINAL GATE（final-verify 全项）');
        W('  铁闸8b 登录窗口旁路检测（login.js 委托 UserStore）');
        W('  铁闸8c 全表面冒烟 134 用例（7 html + login）');
        W('  e2e   端到端 3 用例（真实 exe 点击级回归）');
    }
    W('');

    // 6. 安装自检三步（给用户）
    W('── 安装自检三步（装完 30 秒核对，杜绝假包/旧进程误判）──────────────');
    W('  ① 装新版前：任务管理器搜"惠康"杀光旧进程（旧进程锁文件+残留窗口会造成');
    W('     "装了新版还是旧行为"假象）；');
    W('  ② 装完登录页底部核对三元组：' + (meta ? `V${meta.version} | Build ${meta.buildTimeLocal || ''} | ${meta.archMarker}` : 'V? | Build ? | Arch ?'));
    W('     对不上 = 装到缓存旧包，删掉重下；');
    W('  ③ 云端桌面版额外一步：悬停【用户管理】按钮看 tooltip 水印（' + (meta ? meta.archMarker : 'Arch') + '）再次确认。');
    W('');

    // 7. 各端生效方式速查
    W('── 各端生效方式速查 ───────────────────────────────────────────────');
    W('  云端网页版 / 云端APP   : 推 GitHub 自动部署，在线即时生效，无需重打 APK');
    W('  云端桌面版             : 重新 build.bat 打包 exe，重装后重新登录一次');
    W('  离线桌面版             : 重新 build.bat 打包 exe');
    W('  离线APP                : 重打 惠康中医-本地.apk 并重装');
    W('  纯后端 functions       : 推 GitHub 自动部署即生效');
    W('');

    // 8. 排障速查
    W('── 排障速查 ───────────────────────────────────────────────────────');
    W('  症状"装了新版还报旧问题"：');
    W('    → 先看三元组。对不上=假包或旧进程（Get-Process *惠康* 杀光重装），');
    W('      对得上才继续查代码（此时必有新代码 alert 兜底信息）。');
    W('  症状"登录窗口读不到账号/密码"：');
    W('    → 铁闸8b 已保证 login.js 委托 UserStore，先核对装的版本含本报告版本号。');
    W('');

    W(`报告生成时间 : ${fmtTime(Date.now())}`);
    W(`生成器       : tools/delivery-report.cjs（P4 自动化，随构建产出）`);
    return { lines: lines.join('\r\n'), target, meta, arts };
}

if (require.main === module) {
    try {
        const r = buildReport();
        const outDir = r.target.kind === 'apk' ? PKG : path.join(PKG, 'dist');
        const ver = r.meta ? '_V' + r.meta.version : '';
        const outFile = path.join(outDir, `交付核对单${ver}_${r.target.name}.txt`);
        try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
        // UTF-8 with BOM：Windows 记事本直开中文不乱码
        fs.writeFileSync(outFile, '\uFEFF' + r.lines, 'utf8');
        console.log(`[REPORT] 交付核对单已生成: ${outFile}`);
        console.log(`[REPORT] ${r.arts.length} 个产物已记录（${r.target.name}）`);
    } catch (e) {
        // 报告是辅助产物，失败仅 WARN，绝不阻断交付
        console.warn('[REPORT][WARN] 生成失败（不影响交付，产物已过全部铁闸）: ' + (e && e.message ? e.message : String(e)));
        process.exit(0);
    }
}

module.exports = { buildReport };
