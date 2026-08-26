/**
 * authcore-pilot.js — auth-core.js 受控混淆试点（P2-2）
 *
 * 用法：node tools/authcore-pilot.js
 *
 * 背景：auth-core.js 目前是"明文红线"（tools/obfuscate.js 的 MODULE_FILES 有意排除），
 *       历史因旧版 obfuscator stringArray charAt bug 导致登录异常。现为解除红线积累数据：
 *       每次运行都对【内存副本】做混淆 + 功能回归，原版与混淆版结果必须逐项一致。
 *
 * 流程：
 *   1. 读取 shared/auth-core/offline.js 与 shared/auth-core/cloud.js 源码
 *   2. 用与 tools/obfuscate.js 完全相同的混淆配置，混淆【内存中的副本】
 *      （★ 永不触碰 shared/ 与任何分发目录，正式包不受影响）
 *   3. 在 Node VM 沙箱中分别加载原版 / 混淆版，运行功能回归套件：
 *      - 登录：login() + createSingleUserAdapter（成功/密码错/用户不存在）
 *      - 改密原语：hashPassword / hashPasswordWithUser / verifyPassword（哈希+明文兼容）
 *      - 激活链路：setMasterKey 派生盐（masterKey 注入后哈希必须变化）
 *      - 备份：encryptUsers / decryptUsers 往返、encryptPassword / decryptPassword 往返
 *      - 记住用户名：saveRememberedUser / loadRememberedUsers / clearRememberedUsers
 *      - 校验：validateUsername（全角转半角/危险字符）、validatePasswordStrength
 *   4. 原版 vs 混淆版结果逐项 JSON 比对，全部一致 = PASS
 *   5. 结果追加到 tools/authcore-pilot-results.json（时间/commit/明细，积累数据）
 *
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL（可接入 CI / 定期人工跑）
 *
 * ★ 与正式包的关系：本脚本只是试点验证，不改变打包行为。
 *   将来解除"明文红线"时，需先在内部版本完成【登录/改密/激活/备份】真机全功能回归，
 *   并参考本脚本积累的多次 PASS 记录。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_FILE = path.join(__dirname, 'authcore-pilot-results.json');

// ============================================================================
// 混淆配置 —— 必须与 tools/obfuscate.js 的 OBFUSCATOR_CONFIG 保持一致！
// （obfuscate.js 为可执行脚本无法 require，此处为受控副本；改配置时两处同步）
// ============================================================================
const OBFUSCATOR_CONFIG = {
    compact: true,
    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0,
    deadCodeInjection: false,
    deadCodeInjectionThreshold: 0,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.5,
    stringArrayCallsTransform: true,
    stringArrayShuffle: true,
    stringArrayRotate: true,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersCount: 2,
    identifierNamesGenerator: 'mangled',
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    numbersToExpressions: true,
    renameGlobals: false,
    disableConsoleOutput: true,
    debugProtection: true,
    debugProtectionInterval: 0,
    selfDefending: true,
    reserveStrings: ['Copyright', '版权所有', '惠康'],
    reservedNames: [
        'startSearch', 'handleSearchKey', 'handleLogin',
        'savePrescription', 'loadData'
    ]
};

// ============================================================================
// 浏览器沙箱构造（auth-core 为渲染进程脚本，需要 window/localStorage/crypto 等）
// ============================================================================
function createSandbox() {
    const mem = () => {
        const m = new Map();
        return {
            getItem: (k) => (m.has(k) ? m.get(k) : null),
            setItem: (k, v) => { m.set(k, String(v)); },
            removeItem: (k) => { m.delete(k); },
            clear: () => { m.clear(); },
            key: (i) => [...m.keys()][i] || null,
            get length() { return m.size; }
        };
    };
    const sandbox = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        localStorage: mem(),
        sessionStorage: mem(),
        location: {
            protocol: 'file:',
            hostname: 'localhost',
            href: 'file:///C:/app/index.html',
            search: ''
        },
        navigator: { language: 'zh-CN', userAgent: 'Mozilla/5.0 (sandbox)' },
        document: {
            readyState: 'complete',
            addEventListener() {},
            removeEventListener() {},
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => []
        },
        setTimeout: () => 0,
        clearTimeout() {},
        setInterval: () => 0,
        clearInterval() {},
        crypto: globalThis.crypto,          // Node 18+ webcrypto（crypto.subtle 可用）
        TextEncoder: globalThis.TextEncoder,
        TextDecoder: globalThis.TextDecoder,
        btoa: globalThis.btoa,
        atob: globalThis.atob,
        escape: globalThis.escape,
        unescape: globalThis.unescape,
        fetch: async () => { throw new Error('sandbox-offline'); },
        Date,
        Promise,
        JSON,
        Math,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        Map,
        Set,
        Uint8Array,
        Uint32Array
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    return sandbox;
}

// 在沙箱中加载 auth-core 源码，返回 window.AuthCore
function loadAuthCore(code) {
    const sandbox = createSandbox();
    const ctx = vm.createContext(sandbox);
    const script = new vm.Script(code, { filename: 'auth-core.js' });
    script.runInContext(ctx);
    if (!sandbox.AuthCore || typeof sandbox.AuthCore !== 'object') {
        throw new Error('加载后 window.AuthCore 不可用');
    }
    return sandbox.AuthCore;
}

// ============================================================================
// 功能回归套件：对给定 AuthCore 实例运行，返回 [{ name, result }]（result 可 JSON 序列化）
// 所有测试必须确定性（不含时间戳/随机数），保证原版与混淆版可比对。
// ============================================================================
async function runSuite(AuthCore) {
    const out = [];
    const push = (name, result) => out.push({ name, result });

    const PWD = 'Admin123456!';
    const USER = '张三';
    const SAMPLE_USERS = [
        { username: '张三', clinicName: '惠康诊所', role: 'admin' },
        { username: '李四', clinicName: '惠康诊所', role: 'user' }
    ];

    // —— 登录/改密原语 ——
    const h1 = await AuthCore.hashPassword(PWD);
    push('hashPassword_basic', { len: h1.length, isHex: /^[a-f0-9]{64}$/.test(h1), val: h1 });
    const h2 = await AuthCore.hashPasswordWithUser(PWD, USER);
    push('hashPasswordWithUser_differs', { val: h2, differs: h2 !== h1 });
    push('verifyPassword_ok', await AuthCore.verifyPassword(PWD, h1));
    push('verifyPassword_ok_enhanced', await AuthCore.verifyPassword(PWD, h2, USER));
    push('verifyPassword_wrong', await AuthCore.verifyPassword('WrongPass9', h1));
    push('verifyPassword_plaintext_legacy', await AuthCore.verifyPassword(PWD, PWD));
    push('isPasswordHashed_true', AuthCore.isPasswordHashed(h1));
    push('isPasswordHashed_false', AuthCore.isPasswordHashed('not-a-hash'));

    // —— 激活链路：masterKey 派生盐 ——
    AuthCore.setMasterKey('pilot-master-key-001');
    const hMk = await AuthCore.hashPassword(PWD);
    push('masterKey_derived_salt_changes_hash', { val: hMk, changed: hMk !== h1 });
    push('masterKey_verify_with_derived', await AuthCore.verifyPassword(PWD, hMk));
    AuthCore.setMasterKey(null);
    const hBack = await AuthCore.hashPassword(PWD);
    push('masterKey_reset_restores_hash', hBack === h1);

    // —— 备份：encryptUsers / decryptUsers 往返（含中文） ——
    const encU = await AuthCore.encryptUsers(SAMPLE_USERS);
    const decU = await AuthCore.decryptUsers(encU);
    push('encryptUsers_prefix', typeof encU === 'string' ? encU.split(':')[0] : String(encU));
    push('decryptUsers_roundtrip', JSON.stringify(decU) === JSON.stringify(SAMPLE_USERS));

    // —— 备份：encryptPassword / decryptPassword 往返（含中文+特殊字符） ——
    const encP = await AuthCore.encryptPassword('P@ss中文123!#');
    const decP = await AuthCore.decryptPassword(encP);
    push('encryptPassword_prefix', typeof encP === 'string' ? encP.split(':')[0] : String(encP));
    push('decryptPassword_roundtrip', decP);

    // —— 校验：用户名规则 ——
    if (typeof AuthCore.validateUsername === 'function') {
        const v1 = AuthCore.validateUsername('张三');
        const v2 = AuthCore.validateUsername('A;drop table');   // 危险字符
        const v3 = AuthCore.validateUsername('ＡＢＣ');          // 全角 → 半角
        const v4 = AuthCore.validateUsername('');
        push('validateUsername_normal', JSON.stringify(v1));
        push('validateUsername_dangerous_rejected', JSON.stringify(v2));
        push('validateUsername_fullwidth_normalized', JSON.stringify(v3));
        push('validateUsername_empty_rejected', JSON.stringify(v4));
    }

    // —— 校验：密码强度 ——
    if (typeof AuthCore.validatePasswordStrength === 'function') {
        const s = AuthCore.validatePasswordStrength('Abcdefg123456');
        push('validatePasswordStrength', JSON.stringify({ score: s.score, label: s.label, errors: s.errors }));
    }

    // —— 记住用户名 ——
    if (typeof AuthCore.saveRememberedUser === 'function') {
        await AuthCore.saveRememberedUser(USER);
        await AuthCore.saveRememberedUser('李四');
        const list = await AuthCore.loadRememberedUsers();
        push('rememberedUsers_list', JSON.stringify(list));
        if (typeof AuthCore.clearRememberedUsers === 'function') {
            await AuthCore.clearRememberedUsers();
            const list2 = await AuthCore.loadRememberedUsers();
            push('rememberedUsers_cleared', JSON.stringify(list2));
        }
    }

    // —— 登录调度：login() + createSingleUserAdapter ——
    if (typeof AuthCore.login === 'function' && typeof AuthCore.createSingleUserAdapter === 'function') {
        const hashed = await AuthCore.hashPasswordWithUser(PWD, USER);
        const userObj = { username: USER, clinicName: '惠康诊所', password: hashed, role: 'admin' };
        const adapter = AuthCore.createSingleUserAdapter(userObj);

        const ok = await AuthCore.login(USER, PWD, { adapter: adapter });
        push('login_success', { success: !!ok.success, user: ok.user ? ok.user.username : null });

        const bad = await AuthCore.login(USER, 'WrongPass9', { adapter: adapter });
        push('login_wrong_password', { success: !!bad.success, error: bad.error || '' });

        const none = await AuthCore.login('王五', PWD, { adapter: adapter });
        push('login_unknown_user', { success: !!none.success, error: none.error || '' });

        const empty = await AuthCore.login('', '', { adapter: adapter });
        push('login_empty_input', { success: !!empty.success, error: empty.error || '' });
    }

    // —— 离线登录缓存（离线版特有；cloud 版自动跳过） ——
    if (typeof AuthCore.cacheOfflineLogin === 'function' && typeof AuthCore.tryOfflineLogin === 'function') {
        const cached = await AuthCore.cacheOfflineLogin(USER, PWD, { username: USER, clinicName: '惠康诊所' });
        const offOk = await AuthCore.tryOfflineLogin(USER, PWD);
        const offBad = await AuthCore.tryOfflineLogin(USER, 'WrongPass9');
        push('offlineLogin_cache_and_try', {
            cached: cached === true,
            ok: offOk && offOk.success === true,
            wrongPwdRejected: !offBad || offBad.success !== true
        });
    }

    return out;
}

// ============================================================================
// 主流程
// ============================================================================
async function main() {
    const nodeCrypto = globalThis.crypto;
    if (!nodeCrypto || !nodeCrypto.subtle) {
        console.error('[FAIL] 当前 Node 无 webcrypto（需 Node 18+）');
        process.exit(1);
    }

    let JavaScriptObfuscator;
    try {
        const p = path.join(ROOT, 'node_modules', 'javascript-obfuscator');
        JavaScriptObfuscator = fs.existsSync(p) ? require(p) : require('javascript-obfuscator');
    } catch (e) {
        console.error('[FAIL] javascript-obfuscator 未安装：npm install --save-dev javascript-obfuscator');
        process.exit(1);
    }

    const variants = [
        { name: 'offline', file: path.join(ROOT, 'shared', 'auth-core', 'offline.js') },
        { name: 'cloud', file: path.join(ROOT, 'shared', 'auth-core', 'cloud.js') }
    ];

    let commit = 'unknown';
    try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch (_) {}

    const report = {
        time: new Date().toISOString(),
        commit: commit,
        obfuscatorConfig: 'same-as-tools/obfuscate.js',
        variants: [],
        pass: true
    };

    console.log('================================================================');
    console.log(' auth-core.js 受控混淆试点（P2-2）—— 原版 vs 混淆版 功能回归');
    console.log(' commit: ' + commit);
    console.log('================================================================');

    for (const v of variants) {
        if (!fs.existsSync(v.file)) {
            console.log('[SKIP] ' + v.name + '：源文件不存在 ' + v.file);
            continue;
        }
        const source = fs.readFileSync(v.file, 'utf8');
        const t0 = Date.now();

        // 1) 原版跑套件
        const origResults = await runSuite(loadAuthCore(source));

        // 2) 混淆内存副本（与 obfuscate.js 相同的 IIFE 包裹方式）
        let obfCode;
        try {
            const obf = JavaScriptObfuscator.obfuscate(source, OBFUSCATOR_CONFIG);
            obfCode = '(function(){\n' + obf.getObfuscatedCode() + '\n})();';
        } catch (e) {
            report.variants.push({ variant: v.name, error: 'obfuscate failed: ' + e.message });
            report.pass = false;
            console.log('[FAIL] ' + v.name + ' 混淆阶段失败: ' + e.message);
            continue;
        }

        // 3) 混淆版跑同一套件
        let obfResults;
        try {
            obfResults = await runSuite(loadAuthCore(obfCode));
        } catch (e) {
            report.variants.push({ variant: v.name, error: 'load/run obfuscated failed: ' + e.message });
            report.pass = false;
            console.log('[FAIL] ' + v.name + ' 混淆版加载/运行失败: ' + e.message);
            continue;
        }

        // 4) 逐项比对
        const diffs = [];
        const len = Math.max(origResults.length, obfResults.length);
        for (let i = 0; i < len; i++) {
            const a = origResults[i], b = obfResults[i];
            if (!a || !b || a.name !== b.name || JSON.stringify(a.result) !== JSON.stringify(b.result)) {
                diffs.push({
                    check: a ? a.name : (b ? b.name : '?'),
                    original: a ? a.result : '(missing)',
                    obfuscated: b ? b.result : '(missing)'
                });
            }
        }

        const variantPass = diffs.length === 0;
        if (!variantPass) report.pass = false;
        report.variants.push({
            variant: v.name,
            checks: origResults.length,
            diffs: diffs.length,
            elapsedMs: Date.now() - t0,
            pass: variantPass,
            diffDetail: diffs
        });

        console.log('');
        console.log('[' + (variantPass ? 'PASS' : 'FAIL') + '] ' + v.name +
            '：' + origResults.length + ' 项检查，' + diffs.length + ' 项不一致，耗时 ' + (Date.now() - t0) + 'ms');
        for (const d of diffs) {
            console.log('    · ' + d.check);
            console.log('      原版:   ' + JSON.stringify(d.original).substring(0, 160));
            console.log('      混淆版: ' + JSON.stringify(d.obfuscated).substring(0, 160));
        }
    }

    // 5) 追加结果记录（积累数据，供解除"明文红线"决策参考）
    try {
        let history = [];
        if (fs.existsSync(RESULTS_FILE)) {
            history = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
            if (!Array.isArray(history)) history = [];
        }
        history.push(report);
        // 只保留最近 100 次记录
        if (history.length > 100) history = history.slice(-100);
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(history, null, 2), 'utf8');
        console.log('');
        console.log('结果已追加到 ' + path.relative(ROOT, RESULTS_FILE) +
            '（历史 ' + history.length + ' 次，累计 PASS ' +
            history.filter(r => r.pass).length + ' 次）');
    } catch (e) {
        console.warn('[WARN] 结果记录写入失败: ' + e.message);
    }

    console.log('');
    console.log('================================================================');
    console.log(' 总体结果：' + (report.pass ? 'PASS（原版与混淆版行为完全一致）' : 'FAIL（存在行为差异，禁止解除明文红线）'));
    console.log(' ★ 本试点不改变正式打包行为（auth-core.js 正式包仍保持明文）');
    console.log('================================================================');
    process.exit(report.pass ? 0 : 1);
}

main().catch(e => {
    console.error('[FAIL] 试点脚本异常:', e);
    process.exit(1);
});
