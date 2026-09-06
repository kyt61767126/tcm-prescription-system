// ★ 2026-09-06 机构版桌面探针·场景2：模拟旧版残留（edition=personal 的已激活机器）
// 构造 = probe-prepare-inst 后手动把 edition 改回 personal 重签（模拟 1.0.203 装码产物）
// 用法：node e2e\probe-prepare-legacy.cjs <目标userData目录>
const path = require('path');
const fs = require('fs');
const Module = require('module');

const TARGET = path.resolve(process.argv[2] || path.join(__dirname, 'probe-ud-legacy'));
const SRC = path.resolve(process.argv[3] || path.join(__dirname, 'probe-ud'));

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

// 复用场景1的构造（装码 → clinic），再把 edition 改回 personal 模拟旧版残留
if (!fs.existsSync(path.join(SRC, 'license.dat'))) {
    console.log('PREPARE-FAIL: 源目录无 license.dat，请先跑 probe-prepare-inst.cjs ' + SRC);
    process.exit(1);
}

if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });
fs.copyFileSync(path.join(SRC, 'license.dat'), path.join(TARGET, 'license.dat'));
fs.copyFileSync(path.join(SRC, 'config.json'), path.join(TARGET, 'config.json'));

const licenseManager = require(path.resolve(__dirname, '..', 'electron', 'license-manager.js'));
const cfgPath = path.join(TARGET, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.edition = 'personal';  // ★ 模拟 1.0.203 装码后残留
licenseManager.signConfig(cfg);
if (!cfg.configSignature) { console.log('PREPARE-FAIL: signConfig 失败'); process.exit(1); }
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
console.log('PREPARE-LEGACY config.edition=' + cfg.edition + '（模拟旧版残留）license.dat 已复制');
console.log('PREPARE-LEGACY-PASS');
