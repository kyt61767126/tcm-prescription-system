// ★ 2026-09-06 装码即绑定版本——installLicense 逻辑验证（离线桌面机构版【用户管理】错显修复）
// 原理：require.cache 预注入 mock electron → 加载真实 license-manager.js →
//   用模块自身 generateSignatureV3 构造自洽 HMAC license（无 v5/v6/v7、无 masterKey，
//   verifySignature 走硬编码密钥 fallback 分支，与服务端默认密钥路径一致）
//   → 驱动 installLicense → 断言 config.json 的 edition/角色绑定结果。
// 用法：node e2e\test-install-binding.cjs
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-bind-test-'));

// ---- mock electron ----
const fakeApp = {
    getPath: (name) => {
        if (name === 'userData') return TMP;
        if (name === 'exe') return path.join(TMP, 'fake-exe.exe');
        return TMP;
    },
    getName: () => 'tcm-prescription',
    isPackaged: false,
    isReady: () => true,
    on: () => {},
};
const fakeElectron = { app: fakeApp, ipcMain: { handle: () => {} }, dialog: {}, BrowserWindow: function () {} };
const electronResolved = Module.createRequire(path.resolve('node_modules', 'noop.js'));
const ElectronPath = 'electron';
// 注入 require.cache：'electron' 解析到我们的 fake
const m = new Module('electron', null);
m.filename = ElectronPath;
m.loaded = true;
m.exports = fakeElectron;
require.cache[ElectronPath] = m;
// 真实模块用 require('electron') 相对解析——补 Module._resolveFilename 钩子
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'electron') return ElectronPath;
    return origResolve.call(this, request, ...args);
};

const licenseManager = require(path.resolve(__dirname, '..', 'electron', 'license-manager.js'));

const MID = 'TEST-MACHINE-ID-BIND-001';
const NOW = new Date().toISOString();
const EXP = new Date(Date.now() + 365 * 86400000).toISOString();

function makeLicense(type) {
    // 对齐服务端 buildLicenseData 生产格式：绑定激活码带 clinicName/machineId/licenseBinding
    //（licenseBinding 默认 'clinic+user+machine'，verifySignature v3 分支要求其 truthy）
    const data = {
        user: type === 'pro' ? '张三丰中医诊断' : '测试诊所',
        type: type,
        issuedAt: NOW,
        expiresAt: EXP,
        maxPrescriptions: type === 'pro' ? 999999 : 200,
        features: type === 'pro' ? ['all', 'user_management'] : ['basic'],
        clinicName: type === 'pro' ? '张三丰中医诊断' : '测试诊所',
        machineId: MID,
        licenseBinding: 'clinic+user+machine',
    };
    data.signature = licenseManager.generateSignatureV3(data);
    return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { console.log('  PASS ' + name); pass++; }
    else { console.log('  FAIL ' + name + (detail ? ' —— ' + detail : '')); fail++; }
}

function readConfig() {
    return JSON.parse(fs.readFileSync(path.join(TMP, 'config.json'), 'utf8'));
}

// ============================================================================
console.log('[用例A] 机构版 license(type=pro) 装码 → config.edition=clinic + admin 保留');
{
    // 模拟出厂/注册态：edition=personal，注册账户 role=admin（register-local-user 产物）
    fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
        clinicName: '出厂诊所', doctorName: '出厂医师', edition: 'personal', productName: '惠康中医-本地',
        users: [{ username: '13398628299', password: 'x', role: 'admin', name: '张三丰' }],
    }, null, 2), 'utf8');

    const inst = licenseManager.installLicense(makeLicense('pro'), {
        machineId: MID,
        clinicName: '张三丰中医诊断',
        doctorName: '张三丰',
        phone: '13398628299',
        password: 'admin',
        edition: 'pro',
    });
    check('A1 installLicense 成功', inst && inst.success === true, inst && inst.error);
    const cfg = readConfig();
    check('A2 config.edition 已绑定为 clinic（机构版）', cfg.edition === 'clinic', '实际=' + cfg.edition);
    const u = (cfg.users || []).find(x => x.username === '13398628299');
    check('A3 管理员角色保留 admin', u && u.role === 'admin', '实际=' + (u && u.role));
    check('A4 config 已签名', !!cfg.configSignature);
}

console.log('[用例B] 标准版 license(type=personal) 装码 → edition=personal + admin 降级 user');
{
    fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
        clinicName: '出厂诊所', doctorName: '出厂医师', edition: 'personal', productName: '惠康中医-本地',
        users: [{ username: '13800000000', password: 'x', role: 'admin', name: '测试医师' }],
    }, null, 2), 'utf8');
    // 残留机构版 edition 场景（曾激活过机构版后换标准码）
    const cfg0 = readConfig(); cfg0.edition = 'clinic'; fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify(cfg0, null, 2));

    const inst = licenseManager.installLicense(makeLicense('personal'), {
        machineId: MID, clinicName: '测试诊所', doctorName: '测试医师', phone: '13800000000', password: 'admin', edition: 'personal',
    });
    check('B1 installLicense 成功', inst && inst.success === true, inst && inst.error);
    const cfg = readConfig();
    check('B2 config.edition 已绑定为 personal（标准版）', cfg.edition === 'personal', '实际=' + cfg.edition);
    const u = (cfg.users || []).find(x => x.username === '13800000000');
    check('B3 admin 已降级 user（标准版单用户规范）', u && u.role === 'user', '实际=' + (u && u.role));
}

console.log('[用例C] 幂等：机构版重装同码 → edition 保持 clinic 不炸');
{
    const inst = licenseManager.installLicense(makeLicense('pro'), {
        machineId: MID, clinicName: '张三丰中医诊断', doctorName: '张三丰', phone: '13398628299', password: 'admin', edition: 'pro',
    });
    check('C1 重装成功', inst && inst.success === true, inst && inst.error);
    const cfg = readConfig();
    check('C2 edition 仍为 clinic', cfg.edition === 'clinic', '实际=' + cfg.edition);
}

console.log('[用例D] enforceEditionBinding 包装行为不回归（读盘→校正→写盘）');
{
    const r = licenseManager.enforceEditionBinding();
    check('D1 返回 success', r && r.success === true, JSON.stringify(r));
    const cfg = readConfig();
    check('D2 edition 保持 clinic（license=pro）', cfg.edition === 'clinic', '实际=' + cfg.edition);
}

console.log('[用例E] 2026-09-07 存量自愈核心 applyEditionBindingToConfig（get-app-config 每次读配置时调用）');
{
    // E1 旧版本激活残留：license=pro + config.edition=personal → 上调 clinic
    const lic = { user: '存量诊所', type: 'pro', issuedAt: NOW, expiresAt: EXP,
        clinicName: '存量诊所', machineId: MID, licenseBinding: 'clinic+user+machine' };
    lic.signature = licenseManager.generateSignatureV3(lic);
    const cfg1 = { edition: 'personal', appMode: 'offline', users: [{ username: '13900000001', password: 'x', role: 'admin' }] };
    const r1 = licenseManager.applyEditionBindingToConfig(lic, cfg1);
    check('E1 旧版残留上调 clinic（applied+corrected）', r1 && r1.applied === true && r1.corrected === true && cfg1.edition === 'clinic',
        JSON.stringify(r1) + ' edition=' + cfg1.edition);

    // E2 幂等：已是 clinic → corrected=false 不重复写盘
    const r2 = licenseManager.applyEditionBindingToConfig(lic, cfg1);
    check('E2 幂等（corrected=false）', r2 && r2.applied === true && r2.corrected === false, JSON.stringify(r2));

    // E3 全员 user 的机构版 → 首个用户提升 admin（防管理入口锁死）
    const cfg3 = { edition: 'personal', appMode: 'offline', users: [{ username: '13900000002', password: 'x', role: 'user' }] };
    licenseManager.applyEditionBindingToConfig(lic, cfg3);
    check('E3 无 admin 时首个用户提升 admin', cfg3.users[0].role === 'admin', '实际=' + cfg3.users[0].role);

    // E4 伪造 license（验签失败）→ skip 不校正（防提权）
    const bad = { user: '伪', type: 'pro', licenseBinding: 'clinic+user+machine' };
    bad.signature = 'deadbeef' + 'x'.repeat(56);
    const cfg4 = { edition: 'personal', appMode: 'offline', users: [] };
    const r4 = licenseManager.applyEditionBindingToConfig(bad, cfg4);
    check('E4 验签失败 skip=signature（不提权）', r4 && r4.skip === 'signature' && cfg4.edition === 'personal', JSON.stringify(r4));
}

// 清理
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
