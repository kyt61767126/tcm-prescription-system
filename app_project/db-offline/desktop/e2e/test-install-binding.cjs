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

// 清理
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
