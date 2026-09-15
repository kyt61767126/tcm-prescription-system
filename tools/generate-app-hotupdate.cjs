#!/usr/bin/env node
// ============================================================================
//  generate-app-hotupdate.cjs - 离线APP 静默热更新包生成器（Phase 2b）
//
//  【消费端】HotUpdateManager.java（Phase 2a）——三道门禁 fail-closed：
//    ① Ed25519 验签（license v7 同一信任根，公钥常量内置 Java 侧）
//    ② 逐文件 SHA-256（下载校验 + 启动 resolveEntry 全量复验）
//    ③ minAppCode 硬门禁（热包 JS 依赖 AndroidNative 桥接口，旧 APK 装新热包
//       会调到不存在的桥方法 → localAppCode < minAppCode 转 APK 整包通道）
//
//  ★★ license 链绝不进清单铁律 ★★（只热 UI/业务层，敏感层留 APK 权威）：
//    security-guard.js   —— 前端反调试/降级防护留 APK（业务代码零依赖
//                           window.SecurityGuard，热版页面 404 无副作用；APK 原生
//                           SecurityGuard/NativeGuard 防篡改链不受影响）
//    license/*           —— license-manager.js 是 P1-9 代码完整性校验对象
//                           （LicenseManager.verifyJsIntegrity 基线键控 versionCode，
//                           校验 assets 副本）；APP 授权权威在 Java LicenseManager，
//                           JS 侧 license/*.js 不被 index.html 引用
//    calculate-hash.js   —— Node 打包工具非运行时
//    config.json         —— 含密码哈希 + configSignature 绝不热更（MainActivity
//                           热入口生效时从 assets 复制模板到热目录，运行时权威
//                           仍是 Java config.json 权威层——对齐桌面 desktop-windows.cjs
//                           从 asar 复制模板先例）
//    cordova*.js / build-time.js / build-meta.json / afterPack.js / cloud-api.js /
//    button-manager.js / edition-lock.js / electron/* —— 离线 APP 页面不引用或
//    APK/构建绑定（build-meta 由 MainActivity injectAppVersionSSOT 注入权威版本）
//
//  【产物】public/hot-update/app-local/（散文件 + version.json，与
//    HotUpdateManager.HOT_UPDATE_BASE_URL 逐字对应）：逐文件清单下载 = 天然增量
//    （客户端只拉 sha256 变化的文件），同日重发加 -n 2。
//
//  【用法】
//    node tools/generate-app-hotupdate.cjs                 # minAppCode 继承上一包（无则取 build.gradle）
//    node tools/generate-app-hotupdate.cjs -n 2            # 同日第 2 版
//    node tools/generate-app-hotupdate.cjs -m 284          # 指定最低 APK versionCode（含新桥依赖时才抬升）
//    node tools/generate-app-hotupdate.cjs -o <dir>        # 输出根目录覆盖（测试用）
//
//  【发布】产物在 public/ 下随 git push 由 Cloudflare Pages 自动部署；客户端
//    startHotUpdateCheck 启动 2s 后静默拉取 → 原子 swap → 下次启动生效（淡绿横幅）。
//    ⚠️ 仅当「含 Phase 2a 热更客户端的 APK」发布后热包才有消费者——先打 APK 再发首版热包。
//
//  【协议】签名消息与 Java HotUpdateManager.buildSignMessage 逐字符一致（铁律：
//    改一处必改另一处，同 tools/gen-hotupdate-test-fixture.cjs）：
//    'app-hotupdate-v1|app-local|<hotVersion>|<signedAt>|name:sha256:size|...'
//
//  【私钥】tools/secrets/LICENSE_SIGN_ED25519_PRIVATE_KEY.pem（gitignore 不入库；
//    与 license v7 / 桌面热更同一信任根。轮换时三处同步公钥常量 + 重跑 fixture）
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PRIVATE_KEY_PATH = path.join(ROOT, 'tools', 'secrets', 'LICENSE_SIGN_ED25519_PRIVATE_KEY.pem');
const SRC_DIR = path.join(ROOT, 'app_project', 'db-offline', 'app', 'app', 'src', 'main', 'assets', 'public');
const BUILD_GRADLE = path.join(ROOT, 'app_project', 'db-offline', 'app', 'app', 'build.gradle');

const CHANNEL = 'app-local';                 // 与 HotUpdateManager.CHANNEL 一致
const SIGN_PREFIX = 'app-hotupdate-v1';      // 与 HotUpdateManager.SIGN_PREFIX 一致
const OUT_SUBDIR = path.join('public', 'hot-update', 'app-local');

// ---- Java 端门禁常量镜像（generate-app-hotupdate 自检用，防生成「客户端必拒收」的包）----
const MAX_FILES = 50;                        // HotUpdateManager.MAX_FILES
const MAX_FILE_BYTES = 20 * 1048576;         // HotUpdateManager.MAX_FILE_BYTES
const SAFE_NAME_RE = /^[A-Za-z0-9_./-]+$/;   // HotUpdateManager.SAFE_NAME_RE
const HOT_VERSION_RE = /^\d{4}\.\d{2}\.\d{2}-\d+$/;

// ---- 热包文件清单（assets/public 权威源；index.html 全部运行时 script 引用 +
//      loadXlsxLibrary 动态加载的 vendor/xlsx。敏感层排除见头部铁律注释）----
const FILES = [
    'index.html',                            // resolveEntry 硬性入口（清单必备）
    'auth-core.js',                          // 登录/会话核心（页面 script 引用，不进热包=登录废）
    'permission.js',
    'normalize-config.js',
    'debug-logger.js',
    'print-utils.js',
    'medicine-dict.js',
    'symptom-dict.js',
    'performance-utils.js',
    'prescription-core.js',
    'stock-core.js',
    'vendor/xlsx.full.min.js'                // loadXlsxLibrary() 按需加载（Excel 导入）
];

// 绝不进清单（工具级硬断言：清单与排除表若有交集立即报错，防手滑加回）
const FORBIDDEN = [
    'security-guard.js', 'calculate-hash.js', 'config.json',
    'cordova.js', 'cordova_plugins.js', 'build-time.js', 'build-meta.json',
    'afterPack.js', 'cloud-api.js', 'button-manager.js', 'edition-lock.js',
    'license/license-manager.js', 'license/feature-guard.js', 'license/prescription-counter.js',
    'electron/video-recorder.js'
];

// 签名消息构造（与 HotUpdateManager.buildSignMessage / gen-hotupdate-test-fixture.cjs 逐字符一致）
function buildSignMessage(channel, hotVersion, signedAt, files) {
    const parts = files.map((f) => f.name + ':' + f.sha256 + ':' + f.size);
    return SIGN_PREFIX + '|' + channel + '|' + hotVersion + '|' + signedAt + '|' + parts.join('|');
}

// 读 build.gradle versionCode（minAppCode 兜底——本热包要求的最低 APK versionCode）
function readVersionCode() {
    const text = fs.readFileSync(BUILD_GRADLE, 'utf8');
    const m = text.match(/versionCode\s+(\d+)/);
    if (!m) {
        console.error('[AppHotGen] build.gradle 未找到 versionCode');
        process.exit(1);
    }
    return parseInt(m[1], 10);
}

// ★ 2026-09-15 防呆：未显式传 -m 时继承上一包 minAppCode（而非读 build.gradle）。
//   根因实锤：重打 APK 后 build.gradle 已 bump，裸跑工具默认读新 versionCode →
//   minAppCode 被静默抬升 → 288-291 装机全部转整包通道收不到热包（-11~-15 事故，
//   铁律「打完 APK 再发热包必须 -m 288 钉住」只靠人记已实际复发一次）。
//   继承策略：首次发无上一包 → 读 build.gradle（首发 APK 与热包同步，语义正确）；
//   后续默认继承（上一包的 minAppCode 是当时审定的安全值）；显式 -m 仍可覆盖。
function readPrevMinAppCode(outRoot) {
    try {
        const prev = JSON.parse(fs.readFileSync(path.join(outRoot, OUT_SUBDIR, 'version.json'), 'utf8'));
        if (prev && typeof prev.minAppCode === 'number' && prev.minAppCode >= 1) return prev.minAppCode;
    } catch (_) { /* 无上一包 */ }
    return 0;
}

function fail(msg) {
    console.error('[AppHotGen][FAIL] ' + msg);
    process.exit(1);
}

function main() {
    // ---- 参数 ----
    const argv = process.argv.slice(2);
    let seq = 1, minAppCode = 0, outRoot = ROOT;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-n') seq = Math.max(1, parseInt(argv[i + 1], 10) || 1);
        if (argv[i] === '-m') minAppCode = parseInt(argv[i + 1], 10) || 0;
        if (argv[i] === '-o') outRoot = path.resolve(argv[i + 1] || '.');
    }
    if (!minAppCode) {
        // 防呆默认：继承上一包 → 无上一包才读 build.gradle（详见 readPrevMinAppCode 注释）
        const prev = readPrevMinAppCode(outRoot);
        minAppCode = prev || readVersionCode();
        console.log('[AppHotGen] 未传 -m：minAppCode ' + (prev ? '继承上一包=' + prev : '取 build.gradle=' + minAppCode) + '（显式 -m 可覆盖；抬升须确认热包含新桥依赖）');
    }

    // ---- 前置校验 ----
    const overlap = FILES.filter((f) => FORBIDDEN.indexOf(f) >= 0);
    if (overlap.length) fail('清单与排除表冲突（license 链铁律）: ' + overlap.join(', '));
    if (minAppCode < 1) fail('minAppCode 非法: ' + minAppCode);
    if (!fs.existsSync(PRIVATE_KEY_PATH)) {
        console.error('[AppHotGen] 私钥缺失: ' + PRIVATE_KEY_PATH);
        console.error('  私钥不入库（gitignore）。请从 Cloudflare Secrets / 离线备份恢复后重试。');
        process.exit(1);
    }

    // ---- 1. 逐文件哈希（源：APK 打包源 assets/public）----
    // ★ 行尾铁律：文本文件（.js/.html/.json）CRLF→LF 规范化后再哈希/写产物。
    //   原因：git 入库时 CRLF 会被 eol 策略转 LF，线上部署的是 LF 字节——
    //   若按磁盘 CRLF 算哈希，version.json 与线上内容指纹不一致 → 客户端
    //   下载后逐文件 SHA256 校验必失败（fail-closed 拒收整包）。
    //   规范化后：磁盘产物 == git 入库 == 线上部署 == version.json 四方一致。
    const isText = (n) => /\.(js|html|json)$/i.test(n);
    const normalizeLf = (buf) => /\r\n/.test(buf.toString('latin1'))
        ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buf;
    const files = [];
    const fileBufs = new Map();
    for (const name of FILES) {
        if (!SAFE_NAME_RE.test(name) || name.includes('..') || name.startsWith('/')) {
            fail('文件名不满足 Java 白名单: ' + name);
        }
        const fp = path.join(SRC_DIR, name);
        if (!fs.existsSync(fp)) fail('源文件缺失: ' + name + '（' + fp + '）');
        let buf = fs.readFileSync(fp);
        if (isText(name)) buf = normalizeLf(buf);
        if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
            fail('文件大小越界（1B..20MB）: ' + name + ' = ' + buf.length);
        }
        fileBufs.set(name, buf);
        files.push({ name: name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length });
    }
    if (files.length === 0 || files.length > MAX_FILES) fail('文件数越界（1..' + MAX_FILES + '）: ' + files.length);
    if (!files.some((f) => f.name === 'index.html')) fail('index.html 必须在清单（resolveEntry 入口）');

    // ---- 2. 版本号 YYYY.MM.DD-N（与桌面热更同格式；N 为同日序号）----
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const hotVersion = now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate()) + '-' + seq;
    if (!HOT_VERSION_RE.test(hotVersion)) fail('hotVersion 格式非法: ' + hotVersion);
    const signedAt = Date.now();

    // ---- 3. Ed25519 签名（license v7 同一信任根/私钥）----
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    const msg = buildSignMessage(CHANNEL, hotVersion, signedAt, files);
    const signature = crypto.sign(null, Buffer.from(msg, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');

    // ---- 4. 输出散文件（清空重建，目录与清单严格一致，不留孤儿文件）----
    const outDir = path.join(outRoot, OUT_SUBDIR);
    fs.mkdirSync(outDir, { recursive: true });
    for (const ent of fs.readdirSync(outDir)) {
        fs.rmSync(path.join(outDir, ent), { recursive: true, force: true });
    }
    for (const name of FILES) {
        const dst = path.join(outDir, name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, fileBufs.get(name));   // LF 规范化后字节（与哈希一致）
    }

    // ---- 5. version.json（manifest 与签名一体：客户端下载验签，热目录副本供启动复验）----
    const version = {
        format: 1,
        channel: CHANNEL,
        hotVersion: hotVersion,
        minAppCode: minAppCode,              // 硬门禁：客户端 localAppCode < minAppCode → 转整包通道
        appVersion: '1.0.0',                 // 信息字段（versionName 软著恒 1.0.0）
        files: files,
        signedAt: signedAt,
        signature: signature
    };
    fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(version, null, 2));

    // ---- 6. 自检①：Node 公钥自验签名（防密钥对不一致）----
    const PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIsLN/+7riDHGQj8GAJBeU9kuSGXgVEiUYqvTlrbP2rw=
-----END PUBLIC KEY-----`;
    if (!crypto.verify(null, Buffer.from(msg, 'utf8'), crypto.createPublicKey(PUB_PEM), Buffer.from(signature, 'base64'))) {
        fail('签名自验失败（私钥与 Java 公钥常量不匹配）');
    }

    // ---- 6. 自检②：产物落盘后回读复验（磁盘写入正确性 + 逐文件哈希）----
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'version.json'), 'utf8'));
    for (const f of written.files) {
        const buf = fs.readFileSync(path.join(outDir, f.name));
        if (buf.length !== f.size || crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) {
            fail('产物回读复验失败: ' + f.name);
        }
    }

    // ---- 6. 自检③：模拟 Java verifyManifest 全门禁（格式/渠道/正则/白名单/验签）----
    (function simulateJavaVerify(m) {
        if (m.format !== 1) fail('自检: format != 1');
        if (m.channel !== CHANNEL) fail('自检: channel 不匹配');
        if (!HOT_VERSION_RE.test(m.hotVersion)) fail('自检: hotVersion 格式');
        if (!(m.signedAt > 0)) fail('自检: signedAt');
        if (!m.signature || m.signature.length > 200) fail('自检: signature');
        if (!Array.isArray(m.files) || m.files.length === 0 || m.files.length > MAX_FILES) fail('自检: files 数');
        for (const f of m.files) {
            if (!SAFE_NAME_RE.test(f.name) || f.name.includes('..') || f.name.startsWith('/')) fail('自检: 白名单 ' + f.name);
            if (!/^[0-9a-f]{64}$/.test(f.sha256)) fail('自检: sha256 格式 ' + f.name);
            if (!(f.size > 0 && f.size <= MAX_FILE_BYTES)) fail('自检: size ' + f.name);
        }
        const m2 = buildSignMessage(m.channel, m.hotVersion, m.signedAt, m.files);
        if (!crypto.verify(null, Buffer.from(m2, 'utf8'), crypto.createPublicKey(PUB_PEM), Buffer.from(m.signature, 'base64'))) {
            fail('自检: 模拟 Java 验签不通过');
        }
    })(written);

    // ---- 7. 敏感文件变更提示（auth-core.js 涉登录/桥协议，变更须评估 minAppCode）----
    let prev = null;
    const prevPath = path.join(ROOT, OUT_SUBDIR, 'version.json');
    if (fs.existsSync(prevPath)) {
        try { prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')); } catch (e) { prev = null; }
    }
    if (prev && Array.isArray(prev.files)) {
        const prevHash = {};
        for (const f of prev.files) prevHash[f.name] = f.sha256;
        const changed = files.filter((f) => prevHash[f.name] && prevHash[f.name] !== f.sha256).map((f) => f.name);
        if (changed.includes('auth-core.js')) {
            console.warn('[AppHotGen][WARN] auth-core.js 变更进入热包：登录/桥协议相关——若调用新版 AndroidNative 桥接口，');
            console.warn('  必须将 -m 提升到含该桥的新 APK versionCode（否则旧 APK 收包后运行时故障）。');
        }
    }

    const totalKB = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024);
    console.log('[AppHotGen] 渠道=' + CHANNEL + ' 热版本=' + hotVersion + '（minAppCode ' + minAppCode + '）');
    console.log('[AppHotGen] 文件 ' + files.length + ' 个，合计 ' + totalKB + ' KB → ' + path.relative(ROOT, outDir));
    console.log('[AppHotGen] 签名=' + signature.slice(0, 24) + '…（Ed25519 自验+回读复验+模拟 Java 门禁全通过）');
    if (outRoot === ROOT) {
        console.log('[AppHotGen] 发布：git add public/hot-update/app-local && git push（Cloudflare Pages 自动部署）');
        console.log('[AppHotGen] 前提：含 Phase 2a 热更客户端的 APK（versionCode ≥ ' + minAppCode + '）已发布');
    } else {
        console.log('[AppHotGen] 测试输出（未入 public/，不随部署生效）: ' + outDir);
    }
}

main();
