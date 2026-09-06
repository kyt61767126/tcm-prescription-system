// ★ 2026-09-06 机构版桌面端到端探针·第1步：构造「已激活机构版」userData
// 用真实 license-manager.installLicense 在目标目录落盘：
//   出厂 config.json(personal) + 机构版 license(type=pro) 装码 → 期望 edition=clinic
// machineId=getMachineId()（本机真实硬件指纹，Node 与 exe 同机同实现 → 一致）
// 用法：node e2e\probe-prepare-inst.cjs <目标userData目录>
const path = require('path');
const fs = require('fs');
const Module = require('module');

const TARGET = path.resolve(process.argv[2] || path.join(__dirname, 'probe-ud'));
if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

// ---- mock electron ----
const fakeApp = {
    getPath: (name) => (name === 'exe' ? path.join(TARGET, 'fake-exe.exe') : TARGET),
    getName: () => 'tcm-prescription',
    isPackaged: false, isReady: () => true, on: () => {},
};
const m = new Module('electron', null);
m.filename = 'electron'; m.loaded = true;
m.exports = { app: fakeApp, ipcMain: { handle: () => {} }, dialog: {}, BrowserWindow: function () {} };
require.cache['electron'] = m;
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'electron') return 'electron';
    return origResolve.call(this, request, ...args);
};

const licenseManager = require(path.resolve(__dirname, '..', 'electron', 'license-manager.js'));
const MID = licenseManager.getMachineId();
const NOW = new Date().toISOString();
const EXP = new Date(Date.now() + 365 * 86400000).toISOString();

// 对齐服务端 buildLicenseData 生产格式（licenseBinding truthy → v3 验签分支）
const data = {
    user: '张三丰', type: 'pro',
    issuedAt: NOW, expiresAt: EXP,
    maxPrescriptions: 999999, features: ['all', 'user_management'],
    clinicName: '张三丰中医诊断',
    machineId: MID, licenseBinding: 'clinic+user+machine',
};
data.signature = licenseManager.generateSignatureV3(data);
const licenseB64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');

// 出厂 config（edition=personal + 出厂 admin/user）→ 装码
fs.writeFileSync(path.join(TARGET, 'config.json'), JSON.stringify({
    clinicName: '本能堂中医诊所', doctorName: '本能堂', edition: 'personal', productName: '惠康中医-本地',
    users: [{ username: 'admin', password: 'x', name: '管理员', role: 'user' }],
}, null, 2), 'utf8');

const inst = licenseManager.installLicense(licenseB64, {
    clinicName: '张三丰中医诊断', doctorName: '张三丰',
    phone: '13900000001', password: 'test123456', edition: 'pro',
});
if (!inst || !inst.success) { console.log('PREPARE-FAIL: installLicense ' + (inst && inst.error)); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(path.join(TARGET, 'config.json'), 'utf8'));
console.log('PREPARE machineId=' + MID);
console.log('PREPARE config.edition=' + cfg.edition + '（期望 clinic）');
console.log('PREPARE users=' + cfg.users.map(u => u.username + ':' + u.role).join(','));
console.log('PREPARE license.dat=' + fs.existsSync(path.join(TARGET, 'license.dat')));
if (cfg.edition !== 'clinic') { console.log('PREPARE-FAIL: edition 未绑定 clinic'); process.exit(1); }
console.log('PREPARE-PASS');
