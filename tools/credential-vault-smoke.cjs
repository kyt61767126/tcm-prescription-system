// ============================================================================
//  credential-vault-smoke.cjs — M-2 凭据管理器锚点链路冒烟（2026-09-26）
//
//  加载真实 shared/license/license-manager.js（stub electron，app.getPath 指向
//  临时目录），凭据 Target 前缀用 BNZC_VAULT_TARGET_PREFIX 与真实客户端隔离，
//  验证：
//   1) vaultProbe 健康探测；空态（无凭据无旧文件 → state:null）；
//   2) 统一状态写进 Windows 凭据管理器后字段完整可读（everActivated/lastReject/
//      usersBackupGen/legacy 退役/账号级拒绝标记）；
//   3) getUnifiedGate：gate/anchor 同一对象视图，扁平字段一致；
//   4) ★ 旧双文件（gate.dat + .license-anchor）一次性迁移：gen 取 max、两侧
//      字段并集/拒绝标记并集，迁移后旧文件已删、vault 可读；
//   5) 降级入口：BNZC_VAULT_DISABLED=1 → getVaultPs1Path 空、writeUnifiedState
//      回落文件（在独立子进程验证，避免污染本进程健康缓存）。
//
//  用法：node tools/credential-vault-smoke.cjs   退出码 0=全过
// ============================================================================
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

let total = 0, failed = 0;
function ok(cond, msg) {
    total++;
    if (cond) return;
    failed++;
    console.error('  ✗ ' + msg);
}

// —— 隔离目录 + electron stub ——
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bnzc-vault-'));
const userDataDir = path.join(tmpRoot, 'userdata');
fs.mkdirSync(userDataDir, { recursive: true });
const electronStub = {
    app: {
        getPath(p) {
            if (p === 'userData') return userDataDir;
            if (p === 'exe') return path.join(tmpRoot, 'fake-exe.exe');
            return tmpRoot;
        }
    }
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, ...rest);
};
Module._extensions['.js'] = function (mod, filename) {
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
};

// 凭据 Target 与真实客户端隔离（必须在 require 前设置）
const VAULT_PREFIX = 'BNZC/selftest-vault/';
process.env.BNZC_VAULT_TARGET_PREFIX = VAULT_PREFIX;

const lm = require('../shared/license/license-manager.js');
const mid = lm.getMachineId();
const target = VAULT_PREFIX + mid;
const gatePath = path.join(userDataDir, 'gate.dat');
const anchorPath = path.join(userDataDir, '.license-anchor');

// 直接经 ps1 操作（清空/核验；开发环境 -File 真实执行）
const ps1Path = path.join(__dirname, '..', 'shared', 'credential-vault.ps1');
function psDirect(action) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
        '-Action', action, '-Target', target];
    const out = childProcess.execFileSync(
        process.env.SystemRoot
            ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
            : 'powershell.exe',
        args, { timeout: 15000, windowsHide: true });
    return JSON.parse(String(out).trim().split(/[\r\n]+/).pop());
}

// —— 1. 健康探测 + 起始清理 ——
ok(mid && typeof mid === 'string', 'getMachineId 返回非空: ' + mid);
ok(lm.vaultProbe() === true, 'vaultProbe 凭据子系统可用');
ok(psDirect('delete').ok === true, '起始清理测试凭据');

// —— 2. 空态 ——
let r = lm.readUnifiedState(mid);
ok(r.vault === true && r.state === null, '无凭据无旧文件 → vault 空态');

// —— 3. 统一状态写入/读取 ——
const now = Date.now();
const sample = {
    everActivated: true,
    lastReject: 'LICENSE_REVOKED',
    rejectAt: now,
    lastVerify: now,
    offlineStart: null,
    lastSeenHigh: now,
    usersBackupGen: 3,
    usersLegacyRetired: true,
    accountReject: {
        __arMap: 1,
        '13800000000': { username: '13800000000', state: 'ACCOUNT_REVOKED', at: now }
    }
};
ok(lm.writeUnifiedState(sample, mid) === true, 'writeUnifiedState 写入凭据成功');
r = lm.readUnifiedState(mid);
ok(r.vault === true && !!r.state, 'readUnifiedState 读回状态');
const s = r.state || {};
ok(s.everActivated === true, 'everActivated 持久化');
ok(s.lastReject === 'LICENSE_REVOKED', 'lastReject 持久化');
ok(Number(s.usersBackupGen) === 3, 'usersBackupGen=3 持久化');
ok(s.usersLegacyRetired === true, 'usersLegacyRetired 持久化');
ok(s.offlineStart === null, 'offlineStart=null 持久化');
ok(!!(s.accountReject && s.accountReject['13800000000'] &&
    s.accountReject['13800000000'].state === 'ACCOUNT_REVOKED'),
    '账号级拒绝标记持久化');

// 绕过 JS 缓存直接核验：凭据管理器中确有凭据
const direct = psDirect('read');
ok(direct.found === true && typeof direct.blob === 'string' && direct.blob.length > 0,
    '凭据管理器中实际存在加密凭据');

// —— 4. getUnifiedGate 视图 ——
const u = lm.getUnifiedGate(mid);
ok(u.gate === u.anchor, 'gate/anchor 指向同一状态对象');
ok(u.everActivated === true && u.lastReject === 'LICENSE_REVOKED', '扁平字段与状态一致');
ok(!!(u.accountReject && u.accountReject['13800000000']), '视图 accountReject 可读');

// —— 5. 旧双文件迁移（异内容）——
// 5.1 清空 vault
ok(psDirect('delete').ok === true, '清空 vault 触发迁移前提');
// 5.2 造旧 gate（everActivated + gen 5 + 账号 a）
fs.rmSync(gatePath, { force: true });
fs.rmSync(anchorPath, { force: true });
ok(lm.writeGateState({
    everActivated: true,
    usersBackupGen: 5,
    lastVerify: 1000,
    accountReject: {
        __arMap: 1,
        '13700000000': { username: '13700000000', state: 'ACCOUNT_REVOKED', at: 1000 }
    }
}, mid) === true, '落旧 gate.dat（异内容）');
// 5.3 造旧 anchor（lastReject + gen 7 + 账号 b）
ok(lm.writeAnchorState({
    lastReject: 'NO_LICENSE',
    rejectAt: 2000,
    usersBackupGen: 7,
    accountReject: {
        __arMap: 1,
        '13600000000': { username: '13600000000', state: 'ACCOUNT_REVOKED', at: 2000 }
    }
}, mid) === true, '落旧 .license-anchor（异内容）');
// 5.4 触发迁移
r = lm.readUnifiedState(mid);
ok(r.vault === true && !!r.state, '迁移返回 vault 合并态');
const m = r.state || {};
ok(m.everActivated === true, '迁移：everActivated 来自 gate');
ok(m.lastReject === 'NO_LICENSE', '迁移：lastReject 来自 anchor');
ok(Number(m.usersBackupGen) === 7, '迁移：gen 取两侧 max=7');
ok(Number(m.lastVerify) === 1000, '迁移：lastVerify 来自 gate');
ok(!!(m.accountReject && m.accountReject['13700000000'] && m.accountReject['13600000000']),
    '迁移：两侧账号级拒绝标记并集');
// 5.5 旧文件已清理
ok(fs.existsSync(gatePath) === false, '迁移后 gate.dat 已删除');
ok(fs.existsSync(anchorPath) === false, '迁移后 .license-anchor 已删除');
// 5.6 vault 真实可读（绕过缓存）
const afterMigrate = psDirect('read');
ok(afterMigrate.found === true, '迁移后凭据管理器中存在合并凭据');

// —— 6. 降级入口（独立子进程：env 禁用 vault → 写文件可读回）——
{
    const child = `
const Module = require('module');
const path = require('path'), fs = require('fs');
const electronStub = { app: { getPath(p) {
    if (p === 'userData') return ${JSON.stringify(userDataDir)};
    if (p === 'exe') return ${JSON.stringify(path.join(tmpRoot, 'fake-exe.exe'))};
    return ${JSON.stringify(tmpRoot)};
}}};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, ...rest);
};
Module._extensions['.js'] = function (mod, filename) {
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
};
process.env.BNZC_VAULT_DISABLED = '1';
process.env.BNZC_VAULT_TARGET_PREFIX = ${JSON.stringify(VAULT_PREFIX)};
const lm = require(${JSON.stringify(path.join(__dirname, '..', 'shared', 'license', 'license-manager.js'))});
const mid = lm.getMachineId();
const r = lm.readUnifiedState(mid);
if (r.vault !== false) { console.log('CHILD:FAIL vault should be disabled'); process.exit(2); }
// 写一份文件态并读回
fs.rmSync(path.join(${JSON.stringify(userDataDir)}, 'gate.dat'), { force: true });
fs.rmSync(path.join(${JSON.stringify(userDataDir)}, '.license-anchor'), { force: true });
lm.writeUnifiedState({ usersBackupGen: 9, everActivated: true }, mid);
const r2 = lm.readUnifiedState(mid);
if (!r2.state || Number(r2.state.usersBackupGen) !== 9) { console.log('CHILD:FAIL file fallback read'); process.exit(3); }
console.log('CHILD:OK');
`;
    const co = childProcess.execFileSync(process.execPath, ['-e', child],
        { timeout: 60000, windowsHide: true });
    ok(String(co).trim() === 'CHILD:OK', '降级：vault 禁用时回落文件双写且可读');
}

// 子进程（禁用 vault）落一份指定文件态，供主进程做对账/迁移测试
function childWriteFileState(stateObj) {
    const child = `
const Module = require('module');
const path = require('path'), fs = require('fs');
const electronStub = { app: { getPath(p) {
    if (p === 'userData') return ${JSON.stringify(userDataDir)};
    if (p === 'exe') return ${JSON.stringify(path.join(tmpRoot, 'fake-exe.exe'))};
    return ${JSON.stringify(tmpRoot)};
}}};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, ...rest);
};
Module._extensions['.js'] = function (mod, filename) {
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
};
process.env.BNZC_VAULT_DISABLED = '1';
process.env.BNZC_VAULT_TARGET_PREFIX = ${JSON.stringify(VAULT_PREFIX)};
const lm = require(${JSON.stringify(path.join(__dirname, '..', 'shared', 'license', 'license-manager.js'))});
fs.rmSync(path.join(${JSON.stringify(userDataDir)}, 'gate.dat'), { force: true });
fs.rmSync(path.join(${JSON.stringify(userDataDir)}, '.license-anchor'), { force: true });
lm.writeUnifiedState(${JSON.stringify(stateObj)}, lm.getMachineId());
console.log('CHILD:WROTE');
`;
    const co = childProcess.execFileSync(process.execPath, ['-e', child],
        { timeout: 60000, windowsHide: true });
    ok(String(co).trim() === 'CHILD:WROTE', '子进程文件态落盘');
}

// —— 7. vault↔文件对账：vault 旧态 + 降级期文件新态 → 合并写回、文件清理 ——
{
    psDirect('delete');
    fs.rmSync(gatePath, { force: true });
    fs.rmSync(anchorPath, { force: true });
    ok(lm.writeUnifiedState({ everActivated: true, usersBackupGen: 4 }, mid),
        '对账前提：vault 落旧态 gen4');
    childWriteFileState({ everActivated: true, usersBackupGen: 6,
        lastReject: 'LICENSE_REVOKED', rejectAt: 5000, lastVerify: 5000 });
    const r = lm.readUnifiedState(mid);
    ok(r.vault === true && !!r.state, '对账：返回 vault 合并态');
    ok(Number(r.state.usersBackupGen) === 6, '对账：gen 取 max=6');
    ok(r.state.lastReject === 'LICENSE_REVOKED', '对账：文件态新拒绝标记并入');
    ok(fs.existsSync(gatePath) === false && fs.existsSync(anchorPath) === false,
        '对账成功后旧文件已删');
    ok(psDirect('read').found === true, '对账：合并态真实落进凭据管理器');
}

// —— 8. 迁移写 vault 失败（blob 超限）→ 保留旧文件、按文件态使用，下次重试 ——
{
    psDirect('delete');
    const bigReject = { __arMap: 1 };
    for (let i = 1; i <= 40; i++) {
        const ph = '139' + String(i).padStart(8, '0');
        bigReject[ph] = { username: ph, state: 'ACCOUNT_REVOKED', at: i };
    }
    childWriteFileState({ everActivated: true, usersBackupGen: 8, accountReject: bigReject });
    const before = fs.existsSync(gatePath) && fs.existsSync(anchorPath);
    const r = lm.readUnifiedState(mid);
    ok(before && r.vault === false && !!r.state, '超大件：vault 写失败 → 回落文件态');
    ok(Number(r.state.usersBackupGen) === 8, '超大件：文件态字段可用');
    ok(fs.existsSync(gatePath) === true && fs.existsSync(anchorPath) === true,
        '★ 迁移失败不得删旧文件（杜绝静默全损）');
}

// —— 9. vault 凭据损坏且无文件 → uncertain（视图 fail-closed，不重置宽限）——
{
    psDirect('delete');
    fs.rmSync(gatePath, { force: true });
    fs.rmSync(anchorPath, { force: true });
    // 直接写入垃圾 blob（非任何有效加密格式）
    childProcess.execFileSync(
        process.env.SystemRoot
            ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
            : 'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
         '-Action', 'write', '-Target', target, '-Value', 'garbage-blob-not-encrypted'],
        { timeout: 15000, windowsHide: true });
    lm.invalidateUnifiedCache();
    const u = lm.getUnifiedGate(mid);
    ok(u.uncertain === true, '损坏凭据+无文件 → 视图 uncertain');
    ok(u.lastReject === null && u.everActivated === false, '损坏态不伪造任何业务字段');
}

// —— 10. 对账 null 清除：LICENSED 当次 vault 写失败只落文件，旧拒绝不得复活 ——
{
    psDirect('delete');
    fs.rmSync(gatePath, { force: true });
    fs.rmSync(anchorPath, { force: true });
    ok(lm.writeUnifiedState({
        everActivated: true, lastReject: 'LICENSE_REVOKED',
        rejectAt: 1000, lastVerify: 1000, offlineStart: 1000
    }, mid), '对账前提：vault 持旧拒绝态');
    childWriteFileState({
        everActivated: true, lastReject: null,
        rejectAt: null, lastVerify: 9000, offlineStart: null
    });
    lm.invalidateUnifiedCache();
    const r = lm.readUnifiedState(mid);
    ok(r.vault === true && Number(r.state.lastVerify) === 9000,
        'null清除：权威侧为较晚 verify 的文件态');
    ok(r.state.lastReject === null, 'null清除：旧拒绝标记不复活');
    ok(r.state.offlineStart === null, 'null清除：旧宽限起点不复活');
    ok(fs.existsSync(gatePath) === false && fs.existsSync(anchorPath) === false,
        'null清除对账成功后文件已删');
}

// —— 11. 多 target 级联（X1）：扫描全部候选 target 合并，旧 target 的更新拒绝不得被遮蔽 ——
{
    const variants = lm.getMidVariants();
    const alt = variants.find(v => v !== mid);
    const altTarget = VAULT_PREFIX + alt;
    const psTgt = (action, tgt) => {
        const out = childProcess.execFileSync(
            process.env.SystemRoot
                ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
                : 'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
             '-Action', action, '-Target', tgt],
            { timeout: 15000, windowsHide: true });
        return JSON.parse(String(out).trim().split(/[\r\n]+/).pop());
    };
    try { psTgt('delete', target); } catch (e) { }
    try { psTgt('delete', altTarget); } catch (e) { }
    fs.rmSync(gatePath, { force: true });
    fs.rmSync(anchorPath, { force: true });
    if (alt) {
        ok(lm.writeVaultState({ usersBackupGen: 1, lastVerify: 1000 }, mid),
            '级联前提：primary target 持旧态');
        ok(lm.writeVaultState({
            usersBackupGen: 2, lastVerify: 9000,
            lastReject: 'NO_LICENSE', rejectAt: 9000,
            accountReject: { __arMap: 1, victim: { username: 'victim', state: 'ACCOUNT_REVOKED', at: 9000 } }
        }, alt), '级联前提：旧 mid target 持更新拒绝');
        lm.invalidateUnifiedCache();
        const r = lm.readUnifiedState(mid);
        ok(r.vault === true && Number(r.state.lastVerify) === 9000,
            '级联：合并态取全部 target 中较晚 verify=9000');
        ok(r.state.lastReject === 'NO_LICENSE', '级联：旧 target 更新拒绝不被遮蔽');
        ok(!!r.state.accountReject && !!r.state.accountReject.victim, '级联：账号级墓碑并入');
        const altRead = psTgt('read', altTarget);
        ok(altRead.found === false, '级联：合并完成后旧 target 已清理');
    } else {
        console.log('  （本机仅单一 mid 候选，跳过 X1 级联场景）');
    }
}

// —— 12. 墓碑语义（R4-1）：merge 保守并集不得凭 verify 差异删墓碑；合法清除只走显式通道 ——
{
    psDirect('delete');
    fs.rmSync(gatePath, { force: true });
    fs.rmSync(anchorPath, { force: true });
    ok(lm.writeVaultState({
        lastVerify: 1000,
        accountReject: { __arMap: 1, victim: { username: 'victim', state: 'ACCOUNT_REVOKED', at: 1000 } }
    }, mid), '墓碑语义前提：vault 持合法墓碑');
    // 文件态由启动读缺口建立（verify 更晚但从未加载过该键）——不得当清除
    childWriteFileState({ lastVerify: 9000 });
    lm.invalidateUnifiedCache();
    const r = lm.readUnifiedState(mid);
    ok(r.vault === true && Number(r.state.lastVerify) === 9000,
        '墓碑语义：权威侧为较晚 verify 的文件态');
    ok(!!r.state.accountReject && !!r.state.accountReject.victim,
        '保守并集：权威侧缺键但无清除血统，合法墓碑不被误删');

    // 合法清除通道（模拟本人在线 LICENSED：内存态删键 + persist 全量落 vault）
    delete r.state.accountReject.victim;
    r.state.lastVerify = 9001;
    ok(lm.writeUnifiedState(r.state, mid), '显式清除：清除态全量写 vault');
    lm.invalidateUnifiedCache();
    const r2 = lm.readUnifiedState(mid);
    ok(!r2.state.accountReject || !r2.state.accountReject.victim,
        '显式清除：本人在线 LICENSED 后墓碑真实移除');
}

// —— 清理：测试凭据 + 降级文件 ——
try { psDirect('delete'); } catch (e) { /* 忽略 */ }
try { fs.rmSync(gatePath, { force: true }); fs.rmSync(anchorPath, { force: true }); } catch (e) { /* 忽略 */ }

console.log('\n结果: ' + (total - failed) + '/' + total + (failed ? ' 有失败' : ' 通过'));
process.exit(failed ? 1 : 0);
