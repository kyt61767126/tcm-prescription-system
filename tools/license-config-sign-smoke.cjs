// ============================================================================
//  license-config-sign-smoke.cjs — F2 config users 完整性签名冒烟（2026-09-26）
//
//  加载真实 shared/license/license-manager.js（stub electron，app.getPath 指向
//  临时目录），验证：
//   1) signConfig 产出 usersSignature+configSignature；稳定序列化（键序无关、
//      数组序敏感）；users 任一改动签名必变；
//   2) inspectConfigSignatures：v2 正常放行；篡改密码/role/增删账号/诊所名/
//      签名本身 → 全部 fail-closed；
//   3) v1 旧格式识别→migrate 升级为 v2（迁移须备份证明 users，I1）；
//   4) 删除 usersSignature 的降级攻击不回退 v1，仍 fail-closed；
//   5) users-backup 独立签名四态（v2/legacy/bad/none，I2）；
//   6) usersProvenByBackup 子集证明 + usersListsEqual；
//   7) configUsersProvenAuthentic 闸门矩阵；
//   8) validateLicense 级回归（licenseBinding）：篡改 users/植入 admin 等 →
//      config_tampered；header 漂移/签名缺失但备份可证明 → 自愈成功；
//   9) 试用态 users 来源校验。
//
//  用法：node tools/license-config-sign-smoke.cjs   退出码 0=全过
// ============================================================================
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

let total = 0, failed = 0;
function ok(cond, msg) {
    total++;
    if (cond) return;
    failed++;
    console.error('  ✗ ' + msg);
}

// —— 隔离目录 + electron stub ——
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bnzc-cfgsign-'));
const userDataDir = path.join(tmpRoot, 'userdata');
const exeDir = path.join(tmpRoot, 'exe');
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(exeDir, { recursive: true });

const electronStub = {
    app: {
        getPath(p) {
            if (p === 'userData') return userDataDir;
            if (p === 'exe') return path.join(exeDir, 'fake-exe.exe');
            return tmpRoot;
        }
    },
    // 加载真实 activate.js 所需（模块加载期不解构调用，仅需形状存在）
    BrowserWindow: function () { return {}; },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0) },
    shell: {}
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, ...rest);
};
// 仓库根 package.json 为 "type":"module"，直接 require shared/*.js 会被当 ESM；
// 本测试进程内把 .js 显式按 CJS 编译（electron 已 stub，无其他真实 .js 依赖）。
Module._extensions['.js'] = function (mod, filename) {
    mod._compile(fs.readFileSync(filename, 'utf8'), filename);
};

// 本冒烟锚点走文件路径（与测试临时 userData 同构；禁用凭据 vault，
// 避免真实凭据管理器被写入——真实 vault 链路由 credential-vault-smoke 专测）
process.env.BNZC_VAULT_DISABLED = '1';
const lm = require('../shared/license/license-manager.js');
const activate = require('../app_project/db-offline/desktop/electron/activate.js');
const configPath = path.join(userDataDir, 'config.json');

function writeConfig(cfg) { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8'); }
function readConfig() { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }

function sampleUsers() {
    return [
        { username: 'admin', phone: '13800000000', password: 'pbkdf2_sha256$600000$aa$bb', role: 'admin', name: '管理员' },
        { username: 'user1', phone: '13900000000', password: 'pbkdf2_sha256$600000$cc$dd', role: 'user', name: '医生一' }
    ];
}
function baseConfig() {
    return {
        clinicName: '惠康中医诊所',
        doctorName: '惠医生',
        edition: 'clinic',
        users: sampleUsers()
    };
}

// —— 共享辅助：备份件 / v1 件 / 绑定 license ——
const backupPath = path.join(userDataDir, 'users-backup.json');
const licenseFilePath = path.join(userDataDir, 'license.dat');
const gateFilePath = path.join(userDataDir, 'gate.dat');
const adminAccountPath = path.join(userDataDir, 'admin-account.dat');
function rmBackup() { fs.rmSync(backupPath, { force: true }); }
function writeBackupRaw(obj) { fs.writeFileSync(backupPath, JSON.stringify(obj, null, 2), 'utf8'); }
function readBackupRaw() { return JSON.parse(fs.readFileSync(backupPath, 'utf8')); }
function rmLicense() { fs.rmSync(licenseFilePath, { force: true }); }
function rmGate() { fs.rmSync(gateFilePath, { force: true }); }
const anchorFilePath = path.join(userDataDir, '.license-anchor');
function rmAnchor() { fs.rmSync(anchorFilePath, { force: true }); }
// gen / legacy 退役双锚点一起复位（仅测试用；现实攻击需双删=残留风险）
function resetAnchors() { rmGate(); rmAnchor(); }

function getSignKey() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'license', 'license-manager.js'), 'utf8');
    const mm = src.match(/const CONFIG_SIGN_KEY = '([^']+)'/);
    return mm ? mm[1] : '';
}

// 构造 v1 签名 config（无 usersSignature，configSignature 仅覆盖 4 个 header 字段）
function makeV1Config(users, key) {
    const cfg = {
        clinicName: '惠康中医诊所',
        doctorName: '惠医生',
        edition: 'clinic',
        configIssuedAt: '2026-09-01T00:00:00.000Z',
        users: users
    };
    cfg.configSignature = crypto.createHmac('sha256', key)
        .update([cfg.clinicName, cfg.doctorName, cfg.edition, cfg.configIssuedAt].join('|'))
        .digest('hex');
    return cfg;
}

// 构造带 licenseBinding 的合法测试 license（HMAC v3 签名，硬编码密钥；
// 不带 machineId → 机器绑定自动跳过；issuedAt 在 HMAC 日落 2027-03-31 之前）
function makeBindingLicense(overrides) {
    const data = Object.assign({
        user: '测试用户',
        type: 'personal',
        issuedAt: '2026-09-01T00:00:00.000Z',
        expiresAt: '2027-09-01T00:00:00.000Z',
        maxPrescriptions: 99999,
        features: [],
        clinicName: '惠康中医诊所',
        machineId: '',           // v3 兜底验签要求该字段存在；空串 → 机器校验跳过
        licenseBinding: true
    }, overrides);
    data.signature = lm.generateSignatureV3(data);
    return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

// 全新安装一份合法绑定 license（installLicense 自身重签 config+刷新备份）
function freshLicensed() {
    rmLicense();
    rmBackup();
    writeConfig(lm.signConfig(baseConfig()));
    const ir = lm.installLicense(makeBindingLicense());
    ok(ir.success === true, 'installLicense 基线安装成功');
    return ir;
}

// —— 1. signConfig 基本性质 ——
{
    const a = lm.signConfig(baseConfig());
    ok(/^[0-9a-f]{64}$/.test(a.usersSignature), 'signConfig 产出 usersSignature(64hex)');
    ok(/^[0-9a-f]{64}$/.test(a.configSignature), 'signConfig 产出 configSignature(64hex)');
    ok(!!a.configIssuedAt, 'signConfig 补 configIssuedAt');

    // 键序无关（同一 users 不同书写顺序签名一致）
    const reordered = baseConfig();
    reordered.users = reordered.users.map(u => {
        const entries = Object.entries(u);
        entries.reverse();
        return Object.fromEntries(entries);
    });
    const b = lm.signConfig(reordered);
    ok(b.usersSignature === a.usersSignature, 'users 键序不影响 usersSignature');

    // 数组顺序敏感
    const swapped = baseConfig();
    swapped.users = [swapped.users[1], swapped.users[0]];
    const c = lm.signConfig(swapped);
    ok(c.usersSignature !== a.usersSignature, 'users 数组顺序影响签名（顺序是契约的一部分）');

    // users 任一改动签名必变
    const cases = [
        ['改密码', u => { if (u.username === 'admin') u.password = u.password + 'x'; }],
        ['改 role', u => { if (u.username === 'user1') u.role = 'admin'; }],
        ['改用户名', u => { if (u.username === 'user1') u.username = 'user2'; }],
        ['增账号', null],
        ['删账号', null]
    ];
    for (const [label, mut] of cases) {
        const cfg = baseConfig();
        if (label === '增账号') cfg.users.push({ username: 'x', role: 'user' });
        else if (label === '删账号') cfg.users.pop();
        else cfg.users.forEach(mut);
        const s = lm.signConfig(cfg);
        ok(s.usersSignature !== a.usersSignature && s.configSignature !== a.configSignature,
            'users ' + label + ' → 双签名均变化');
    }

    // 无 users / 空 users 也可签名
    const empty = lm.signConfig({ clinicName: 'x', users: [] });
    ok(/^[0-9a-f]{64}$/.test(empty.usersSignature), '空 users 可签名');
    const noUsers = lm.signConfig({ clinicName: 'x' });
    ok(noUsers.usersSignature === empty.usersSignature, '缺省 users 等同空数组签名');
}

// —— 2. stableStringify 直接验证 ——
{
    ok(lm.stableStringify({ b: 1, a: 2 }) === lm.stableStringify({ a: 2, b: 1 }),
        'stableStringify 对象键排序');
    ok(lm.stableStringify([1, 2]) !== lm.stableStringify([2, 1]),
        'stableStringify 数组保序');
    ok(lm.stableStringify({ a: { z: 1, y: 2 } }) === lm.stableStringify({ a: { y: 2, z: 1 } }),
        'stableStringify 嵌套键排序');
}

// —— 3. inspect：v2 正常 + 各类篡改 fail-closed ——
{
    writeConfig(lm.signConfig(baseConfig()));
    let r = lm.inspectConfigSignatures();
    ok(r.ok === true && r.legacy === false, 'v2 合法配置检查通过');

    const tamper = (label, mut) => {
        const cfg = lm.signConfig(baseConfig()); // 每次从合法件起
        mut(cfg);
        writeConfig(cfg);
        const rr = lm.inspectConfigSignatures();
        ok(rr.ok === false, label + ' → fail-closed');
    };
    tamper('篡改密码哈希', c => { c.users[0].password += 'x'; });
    tamper('提权 role', c => { c.users[1].role = 'admin'; });
    tamper('植入账号', c => { c.users.push({ username: 'evil', password: 'x', role: 'admin' }); });
    tamper('删除账号', c => { c.users.pop(); });
    tamper('篡改诊所名', c => { c.clinicName = '盗版诊所'; });
    tamper('篡改签名本身', c => { c.configSignature = 'f'.repeat(64); });
    tamper('usersSignature 非hex', c => { c.usersSignature = 'zz'; });

    // 无签名 config
    fs.writeFileSync(configPath, JSON.stringify({ clinicName: 'x' }), 'utf8');
    ok(lm.inspectConfigSignatures().ok === false, '无 configSignature → fail-closed');

    // config 缺失
    fs.rmSync(configPath, { force: true });
    ok(lm.inspectConfigSignatures().ok === false, 'config 缺失 → fail-closed');

    // ★ 第四轮回归（跨机移植路径A封死验证）：攻击者在自有合法安装上用静态密钥
    //   造出完整自洽的 v2 外壳（users+usersSignature+configSignature 全部静态自洽），
    //   移植到受害者机器后——v2 候选已无静态密钥 → 必须 users_mismatch fail-closed。
    {
        const key = getSignKey();
        const cfg = baseConfig();
        cfg.configIssuedAt = '2026-09-26T00:00:00.000Z';
        cfg.usersSignature = crypto.createHmac('sha256', key)
            .update(lm.stableStringify(cfg.users)).digest('hex');
        cfg.configSignature = crypto.createHmac('sha256', key).update(
            [cfg.clinicName, cfg.doctorName, cfg.edition, cfg.configIssuedAt, cfg.usersSignature].join('|')
        ).digest('hex');
        writeConfig(cfg);
        const r = lm.inspectConfigSignatures();
        ok(r.ok === false && r.reason === 'users_mismatch',
            '静态密钥完整自洽 v2 外壳 → users_mismatch（v2 无静态候选，移植封死）');
    }
}

// —— 4. v1 旧格式识别 → 迁移 v2（迁移须备份证明 users，I1）——
{
    const key = getSignKey();
    ok(!!key, '能从权威源读取 CONFIG_SIGN_KEY（构造 v1 测试件）');

    // 4.1 v1 + legacy 完全匹配备份 → 迁移成功
    rmBackup();
    writeConfig(makeV1Config(sampleUsers(), key));
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    let r = lm.inspectConfigSignatures();
    ok(r.ok === true && r.legacy === true, 'v1+legacy备份：识别为合法待迁移');
    ok(lm.migrateConfigUsersSignature(r) === true, 'v1+匹配备份迁移成功');
    let insp2 = lm.inspectConfigSignatures();
    ok(insp2.ok === true && insp2.legacy === false, '迁移后按 v2 检查通过');
    ok(lm.inspectUsersBackup().trusted === 'v2', '迁移成功后旧备份升级为 v2 签名');

    // 迁移后篡改 users 仍 fail
    const tampered = readConfig();
    tampered.users[0].password += 'x';
    writeConfig(tampered);
    ok(lm.inspectConfigSignatures().ok === false, '迁移后篡改 users 仍 fail-closed');

    // 4.2 v1 + v2 备份，磁盘是备份子集（合法删号，截断保护场景）→ 成功
    // 不删备份：现存 v2 备份（4.1 迁移所写）直接扩集写入，符合真实合法路径；
    // rmBackup 会被"锚点已建立+备份缺失"阻断（该态只可能来自攻击者删件）。
    const threeUsers = sampleUsers().concat([
        { username: 'old2', phone: '13700000000', password: 'p', role: 'user', name: '旧号' }
    ]);
    writeConfig(makeV1Config(sampleUsers(), key));
    lm.backupUserAccounts({ users: threeUsers });
    r = lm.inspectConfigSignatures();
    ok(r.ok === true && r.legacy === true, 'v1+v2备份：识别合法');
    ok(lm.migrateConfigUsersSignature(r) === true, 'v1+磁盘为备份子集(合法删号)迁移成功');

    // 4.3 v1 无备份 → tampered（v1 不覆盖 users，不能放行）
    rmBackup();
    writeConfig(makeV1Config(sampleUsers(), key));
    r = lm.inspectConfigSignatures();
    ok(lm.migrateConfigUsersSignature(r) === 'tampered', 'v1+无备份 → 拒绝迁移');

    // 4.4 v1 + 被篡改的签名备份(bad) → tampered
    rmBackup();
    writeConfig(makeV1Config(sampleUsers(), key));
    // proven 建件（测试造数；锚点已建立时非 proven 补备份会被缺失阻断）
    lm.backupUserAccounts({ users: sampleUsers() }, { proven: true });
    const badRaw = readBackupRaw();
    badRaw.users[0].password += 'x';
    writeBackupRaw(badRaw);
    r = lm.inspectConfigSignatures();
    ok(lm.migrateConfigUsersSignature(r) === 'tampered', 'v1+损坏签名备份 → 拒绝迁移');

    // 4.5 v1 + legacy 备份，但磁盘多出备份无法证明的账号（植入）→ tampered
    rmBackup();
    const diskExtra = sampleUsers().concat([
        { username: 'evil', phone: '13600000000', password: 'x', role: 'admin', name: 'e' }
    ]);
    writeConfig(makeV1Config(diskExtra, key));
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    r = lm.inspectConfigSignatures();
    ok(lm.migrateConfigUsersSignature(r) === 'tampered', 'v1+植入额外账号 → 拒绝迁移');
}

// —— 5. 降级攻击：删 usersSignature 不得回退 v1 放行 ——
{
    const cfg = lm.signConfig(baseConfig());
    delete cfg.usersSignature; // 模拟攻击者删除新签名（configSignature 原样保留）
    writeConfig(cfg);
    const r = lm.inspectConfigSignatures();
    ok(r.ok === false, '删除 usersSignature 的降级攻击不被接受（v2 configSignature 无法过 v1 校验）');
}

// —— 6. 账号来源原语：usersProvenByBackup / usersListsEqual ——
{
    const u = sampleUsers();
    ok(lm.usersProvenByBackup(u, u) === true, 'proven: 完全一致 → true');
    ok(lm.usersProvenByBackup(u.slice(0, 1), u) === true, 'proven: 磁盘是备份子集(合法删号) → true');
    ok(lm.usersProvenByBackup(u, u.slice(0, 1)) === false, 'proven: 磁盘多出账号 → false');
    const modRole = u.map(x => Object.assign({}, x));
    modRole[1].role = 'admin';
    ok(lm.usersProvenByBackup(modRole, u) === false, 'proven: 改 role → false');
    const swapped = [u[1], u[0]];
    ok(lm.usersProvenByBackup(swapped, u) === true, 'proven: 多重集语义，顺序无关');
    const modPwd = u.map(x => Object.assign({}, x));
    modPwd[0].password += 'x';
    ok(lm.usersProvenByBackup(modPwd, u) === false, 'proven: 改密码哈希 → false');
    ok(lm.usersProvenByBackup([], u) === true, 'proven: 空磁盘 → true');
    ok(lm.usersProvenByBackup(u, []) === false, 'proven: 无备份有账号 → false');

    ok(lm.usersListsEqual(u, u) === true, 'equal: 同体 → true');
    ok(lm.usersListsEqual(swapped, u) === false, 'equal: 顺序敏感 → false');
    ok(lm.usersListsEqual(u.map(x => Object.assign({}, x)), u) === true, 'equal: 键序无关深比较');
    ok(lm.usersListsEqual(modRole, u) === false, 'equal: 字段差异 → false');
}

// —— 7. users-backup 独立签名四态（I2）——
{
    rmBackup();
    let b = lm.inspectUsersBackup();
    ok(b.trusted === 'none' && b.users.length === 0, '备份不存在 → none');

    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    b = lm.inspectUsersBackup();
    ok(b.trusted === 'legacy' && b.users.length === 2, '无签名备份 → legacy');

    rmBackup();
    lm.backupUserAccounts({ users: sampleUsers() }, { proven: true });
    b = lm.inspectUsersBackup();
    ok(b.trusted === 'v2' && b.users.length === 2, '签名备份验签通过 → v2');

    const raw = readBackupRaw();
    raw.users[0].password += 'x';
    writeBackupRaw(raw);
    ok(lm.inspectUsersBackup().trusted === 'bad', '签名备份被篡改 → bad（疑投毒）');

    fs.writeFileSync(backupPath, '{broken json', 'utf8');
    ok(lm.inspectUsersBackup().trusted === 'bad', '备份 JSON 损坏 → bad');

    // ★ 第四轮回归（跨机移植路径B/C封死验证）：攻击者自有安装用静态基密钥造的
    //   "合法" v2 备份移植到本机 → 机器绑定验签必失败 → bad（回填/证明链全断）
    rmBackup();
    writeBackupRaw({
        backupAt: '2026-09-26T00:00:00.000Z',
        gen: 9,
        users: sampleUsers(),
        usersSignature: crypto.createHmac('sha256', getSignKey())
            .update('9|' + lm.stableStringify(sampleUsers())).digest('hex')
    });
    ok(lm.inspectUsersBackup().trusted === 'bad', '外来静态签名备份 → bad（签名机器绑定生效）');
    rmBackup();
}

// —— 8. configUsersProvenAuthentic 闸门矩阵 ——
{
    const key = getSignKey();

    // v2 完整件
    writeConfig(lm.signConfig(baseConfig()));
    ok(lm.configUsersProvenAuthentic() === true, 'v2 完整件 → true');

    // v2 users 被改
    let t = readConfig();
    t.users[1].role = 'admin';
    writeConfig(t);
    ok(lm.configUsersProvenAuthentic() === false, 'v2 提权 users → false');

    // v1 + 匹配 v2 新鲜备份（第4节迁移已建立锚点，legacy 永久退出采信）
    rmBackup();
    writeConfig(makeV1Config(sampleUsers(), key));
    lm.backupUserAccounts({ users: sampleUsers() }, { proven: true });
    ok(lm.configUsersProvenAuthentic() === true, 'v1+匹配v2备份 → true');

    // v1 + legacy 备份但锚点已建立 → false（窗口已关，防 v1 件重放+伪造 legacy）
    rmBackup();
    writeConfig(makeV1Config(sampleUsers(), key));
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    ok(lm.configUsersProvenAuthentic() === false, 'v1+legacy备份但锚点已建立 → false');

    // v1 + 无备份
    rmBackup();
    writeConfig(makeV1Config(sampleUsers(), key));
    ok(lm.configUsersProvenAuthentic() === false, 'v1+无备份 → false');

    // v1 + 不匹配备份（植入）
    rmBackup();
    const diskExtra = sampleUsers().concat([
        { username: 'evil', phone: '13600000000', password: 'x', role: 'admin', name: 'e' }
    ]);
    writeConfig(makeV1Config(diskExtra, key));
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    ok(lm.configUsersProvenAuthentic() === false, 'v1+植入账号 → false');

    // 无签名(missing) + legacy 备份 → false（攻击者可自造 missing+legacy，收口）
    rmBackup();
    writeConfig({ clinicName: '惠康中医诊所', users: sampleUsers() });
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    ok(lm.configUsersProvenAuthentic() === false, '无签名+legacy备份 → false（旧洗白入口已封）');

    // 无签名(missing) + 新鲜 v2 备份证明 → true
    rmBackup();
    writeConfig({ clinicName: '惠康中医诊所', users: sampleUsers() });
    lm.backupUserAccounts({ users: sampleUsers() }, { proven: true });
    ok(lm.configUsersProvenAuthentic() === true, '无签名+新鲜v2备份证明 → true');

    // 空 users + 无签名(missing) → true（出厂/首注册态）
    rmBackup();
    writeConfig({ clinicName: 'x', users: [] });
    ok(lm.configUsersProvenAuthentic() === true, '空 users+无签名 → true');

    // 空 users 但 usersSignature 失配(users_mismatch：攻击者删光 users) → false
    const signed = lm.signConfig(baseConfig());
    signed.users = [];
    writeConfig(signed);
    ok(lm.configUsersProvenAuthentic() === false, '空 users 但 users_mismatch（删光账号）→ false');
}

// —— 9. validateLicense 级回归（正式授权 + licenseBinding）——
{
    // 9.0 基线：合法 license + v2 完整 config
    freshLicensed();
    let v = lm.validateLicense();
    ok(v.valid === true && v.type === 'licensed', '合法 license + 完整 v2 config → valid');

    // 9.1 篡改密码哈希 → config_tampered（users_mismatch，禁止自愈洗白）
    freshLicensed();
    let c = readConfig();
    c.users[0].password += 'x';
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '篡改密码哈希 → config_tampered');

    // 9.2 植入 admin → config_tampered
    freshLicensed();
    c = readConfig();
    c.users.push({ username: 'evil', password: 'x', role: 'admin' });
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '植入 admin → config_tampered');

    // 9.3 提权 role → config_tampered
    freshLicensed();
    c = readConfig();
    const target = c.users.find(u => u.role !== 'admin') || c.users[c.users.length - 1];
    target.role = 'admin';
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '提权 role → config_tampered');

    // 9.4 篡改 users 并删备份 → 仍 config_tampered
    freshLicensed();
    c = readConfig();
    c.users[0].password += 'x';
    writeConfig(c);
    rmBackup();
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '篡改 users+删备份 → config_tampered');

    // 9.5 header 漂移（诊所名被改，users 签名仍通过）→ 自愈成功并恢复权威值
    freshLicensed();
    c = readConfig();
    c.clinicName = '盗版诊所';
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === true, 'header 漂移但 users 可信 → 自愈成功');
    ok(readConfig().clinicName === '惠康中医诊所', '自愈后诊所名恢复为 license 权威值');

    // 9.6 删 usersSignature（降级）+ v2 备份能证明 users → 自愈成功
    freshLicensed();
    c = readConfig();
    delete c.usersSignature;
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === true, '删 usersSignature 但备份可证明 users → 自愈重签');
    ok(lm.inspectConfigSignatures().ok === true, '自愈后签名链恢复');

    // 9.7 双签名全删(missing) + 备份能证明 users → 自愈成功
    freshLicensed();
    c = readConfig();
    delete c.configSignature;
    delete c.usersSignature;
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === true, '无签名 config + 备份证明 → 自愈成功');

    // 9.8 无签名 config + 备份无法证明（多出植入账号）→ config_tampered
    freshLicensed();
    c = readConfig();
    delete c.configSignature;
    delete c.usersSignature;
    c.users.push({ username: 'evil', password: 'x', role: 'admin' });
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '无签名+植入账号 → config_tampered');
}

// —— 10. validateLicense 试用态 users 来源校验 ——
{
    // 完整 v2 config、无 license → 试用放行
    rmLicense();
    rmBackup();
    writeConfig(lm.signConfig(baseConfig()));
    let v = lm.validateLicense();
    ok(v.valid === true && v.type === 'trial', '试用态完整 v2 config → valid');

    // 试用态篡改 users → config_tampered
    rmLicense();
    rmBackup();
    writeConfig(lm.signConfig(baseConfig()));
    const c = readConfig();
    c.users[0].password += 'x';
    writeConfig(c);
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '试用态篡改 users → config_tampered');

    // 出厂空 config（无签名、空 users）首启试用 → 放行
    rmLicense();
    rmBackup();
    writeConfig({ clinicName: 'x', users: [] });
    v = lm.validateLicense();
    ok(v.valid === true && v.type === 'trial', '出厂空 config 首启试用 → valid');
}

// —— 11. 备份毒化链（三审阻断共识）：修复后条件备份语义端到端 ——
{
    const evilUser = { username: 'evil', phone: '13500000000', password: 'x', role: 'admin', name: 'e' };

    // 链A：旧合法 v2 备份存在——毒化失败 → 删签名 → 仍拒绝
    freshLicensed();
    let c = readConfig();
    c.users.push(evilUser); // 签名仍合法 → users_mismatch
    writeConfig(c);
    // 模拟修复后 get-app-config：闸门不过绝不备份
    ok(lm.configUsersProvenAuthentic() === false, '毒化链A①：篡改态闸门 false');
    if (lm.configUsersProvenAuthentic()) lm.backupUserAccounts({ users: readConfig().users });
    let bb = lm.inspectUsersBackup();
    ok(bb.trusted === 'v2' && bb.users.length === 2, '毒化链A②：旧合法备份保留未被毒化');
    // 攻击者删双签名，试图凭"备份证明"
    c = readConfig();
    delete c.configSignature;
    delete c.usersSignature;
    writeConfig(c);
    ok(lm.configUsersProvenAuthentic() === false, '毒化链A③：evil 不在旧备份 → 闸门 false');
    let v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '毒化链A④：validateLicense 拒绝');

    // 链B：无备份变体
    freshLicensed();
    rmBackup();
    c = readConfig();
    c.users.push(evilUser);
    writeConfig(c);
    if (lm.configUsersProvenAuthentic()) lm.backupUserAccounts({ users: readConfig().users });
    ok(lm.inspectUsersBackup().trusted === 'none', '毒化链B①：未证明 users 不写备份');
    c = readConfig();
    delete c.configSignature;
    delete c.usersSignature;
    writeConfig(c);
    ok(lm.configUsersProvenAuthentic() === false, '毒化链B②：missing+无备份 → false');
    v = lm.validateLicense();
    ok(v.valid === false && v.type === 'config_tampered', '毒化链B③：validateLicense 拒绝');
}

// —— 12. 单调 gen 双锚点：旧件重放拒绝 + legacy sticky 退役（直接测原语） ——
{
    resetAnchors();
    rmBackup();
    lm.backupUserAccounts({ users: sampleUsers() });
    const g1 = readBackupRaw();
    ok(g1.gen === 1, '锚点缺失时首份备份 gen=1');
    let inspected = lm.inspectUsersBackup();
    ok(inspected.trusted === 'v2' && lm.backupGenFresh(inspected) === true, 'gen1 件新鲜');

    lm.backupUserAccounts({ users: sampleUsers() });
    ok(readBackupRaw().gen === 2, 'gen 单调递增=2');

    // 单删 gate.dat：gen 高水位仍在二级锚点，备份继续推进而非重置
    rmGate();
    lm.backupUserAccounts({ users: sampleUsers() });
    ok(readBackupRaw().gen === 3, '单删 gate：高水位 gen 不失效（gen2+1）');

    // 重放 gen1 旧件（签名合法、内容旧）→ 不新鲜
    writeBackupRaw(g1);
    inspected = lm.inspectUsersBackup();
    ok(inspected.trusted === 'v2', 'gen1 旧件签名仍合法');
    ok(lm.backupGenFresh(inspected) === false, '旧 gen 重放 → 不新鲜（防密码/角色回滚）');
    ok(lm.getFillableUsers().length === 0, '回填拒绝旧 gen 件');

    // 外改 gen 字段（签名覆盖 gen）→ bad
    const bumped = g1;
    bumped.gen = 99;
    writeBackupRaw(bumped);
    ok(lm.inspectUsersBackup().trusted === 'bad', 'gen 被签名绑定，外改 → bad');

    // 删备份 + 非 proven：gen 锚点已建立 → 拒绝覆写（防删备份竞态洗白）
    rmBackup();
    ok(lm.backupUserAccounts({ users: sampleUsers() }) === false, '锚点已建立但备份缺失 → 非 proven 拒绝');
    ok(lm.inspectUsersBackup().trusted === 'none', '拒绝后不落任何备份');

    // 锚点存在 → legacy 一律不可用
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    ok(lm.legacyBackupUsable(lm.inspectUsersBackup()) === false, '锚点建立后 legacy 不可用');

    // sticky：单删 gate，二级锚点仍持退役标记 → legacy 仍不可用
    rmGate();
    ok(lm.legacyBackupUsable(lm.inspectUsersBackup()) === false, '单删 gate：退役标记 sticky，legacy 仍不可用');

    // 双锚点同删（残留风险：需同时控制两个目录）：窗口内 legacy 可用；
    // 未来 backupAt / 缺 backupAt 仍不可用
    resetAnchors();
    writeBackupRaw({ backupAt: '2026-09-01T00:00:00.000Z', users: sampleUsers() });
    ok(lm.legacyBackupUsable(lm.inspectUsersBackup()) === true, '双锚点同删+窗口内 legacy → 可用（残留风险）');
    writeBackupRaw({ backupAt: '2028-01-01T00:00:00.000Z', users: sampleUsers() });
    resetAnchors();
    ok(lm.legacyBackupUsable(lm.inspectUsersBackup()) === false, '晚于日落的 legacy → 不可用');
    writeBackupRaw({ users: sampleUsers() });
    resetAnchors();
    ok(lm.legacyBackupUsable(lm.inspectUsersBackup()) === false, '缺 backupAt 的 legacy → 不可用');
}

// —— 13. ensureLocalActivationUser（hashOf 提升修复 + 闸门） ——
{
    rmGate();
    rmBackup();
    writeConfig({ clinicName: 'x', users: [] });
    let r = lm.ensureLocalActivationUser('13800000000', '');
    ok(r.success === true && r.existed === false, '空 config 补绑成功（hashOf 不再 ReferenceError）');
    const disk = readConfig();
    ok(disk.users.length === 1 && disk.users[0].username === '13800000000'
        && disk.users[0].role === 'admin', '补绑账号已落盘');
    const expectPwd = crypto.createHash('sha256').update('bnzc_prescription_salt_v1admin').digest('hex');
    ok(disk.users[0].password === expectPwd && /^[0-9a-f]{64}$/.test(disk.configSignature),
        '密码=旧全局盐哈希，config 已签名');
    ok(lm.inspectUsersBackup().trusted === 'v2', '补绑成功后备份已刷新为 v2');

    r = lm.ensureLocalActivationUser('13800000000', 'newpassword123');
    ok(r.success === true && r.existed === true, '同号再调：幂等 existed=true');
    ok(readConfig().users[0].password === expectPwd, '幂等调用不覆盖密码');

    r = lm.ensureLocalActivationUser('123', '');
    ok(r.success === false, '手机号格式错 → 失败');

    rmGate();
    rmBackup();
    writeConfig({ clinicName: 'x', users: sampleUsers() });
    r = lm.ensureLocalActivationUser('13700000000', '');
    ok(r.success === false && /篡改/.test(r.error || ''), '未证明 users 态建号 → 拒绝（防洗白）');
}

// —— 13B. 复审A高危#1/#5：config 损坏 + 备份完好 → 补绑回填不丢账号 ——
{
    resetAnchors();
    rmBackup();
    // 合法 v2 主件 2 账号 + 同内容备份（gen=1）
    writeConfig(lm.signConfig(baseConfig()));
    lm.backupUserAccounts({ users: sampleUsers() });
    ok(lm.inspectUsersBackup().trusted === 'v2', '13B① 备份就绪 v2');

    // 复审A#1：主件磁盘损坏 → 补绑第 3 号 → 回填 2 账号必须保留（修复前：
    // primaryReadOk=false 把回填件清空 → 0 账号建号 → proven 覆写备份=双端丢号）
    fs.writeFileSync(configPath, '{broken json!!', 'utf8');
    let r = lm.ensureLocalActivationUser('13600000000', '');
    ok(r.success === true && r.existed === false, '13B② 损坏态补绑第3号成功');
    let disk = readConfig();
    ok(disk.users.length === 3, '13B③ 回填 2 账号未丢失（共3号，实际' + disk.users.length + '）');
    ok(disk.users.some(u => u.username === 'admin')
        && disk.users.some(u => u.username === 'user1')
        && disk.users.some(u => u.username === '13600000000'), '13B④ admin/user1/新号 三号齐全');
    ok(lm.inspectConfigSignatures().ok === true, '13B⑤ 补绑后主件 v2 验签通过');

    // 复审A#5：再次损坏 + 幂等命中（账号在回填件）→ 顺带重签修复损坏 config
    fs.writeFileSync(configPath, '{broken again', 'utf8');
    r = lm.ensureLocalActivationUser('13600000000', '');
    ok(r.success === true && r.existed === true, '13B⑥ 幂等命中 existed=true');
    disk = readConfig();
    ok(disk.users.length === 3 && lm.inspectConfigSignatures().ok === true,
        '13B⑦ 幂等命中已顺带重签修复损坏 config');

    resetAnchors();
    rmBackup();
}

// —— 14. admin-account.dat 完整性签名（安全审查 #3） ——
{
    function writeAdminRaw(obj) { fs.writeFileSync(adminAccountPath, JSON.stringify(obj), 'utf8'); }
    fs.rmSync(adminAccountPath, { force: true });
    ok(activate.loadAdminAccountPhone() === '', 'admin-account 无文件 → 空串');

    writeAdminRaw({ phone: '13800000000', edition: '', savedAt: '2026-09-01T00:00:00.000Z' });
    ok(activate.loadAdminAccountPhone() === '', '无签名旧件 → 忽略（防覆写注入管理员）');

    activate.saveAdminAccountPhone('13800000000', 'clinic');
    ok(activate.loadAdminAccountPhone() === '13800000000', '签名件 save/load 往返成功');
    const raw = JSON.parse(fs.readFileSync(adminAccountPath, 'utf8'));
    ok(/^[0-9a-f]{64}$/.test(raw.signature), '文件含 64hex 签名');

    raw.phone = '13700000000';
    writeAdminRaw(raw);
    ok(activate.loadAdminAccountPhone() === '', '篡改手机号 → 忽略');

    const last = raw.signature.slice(-1);
    raw.phone = '13800000000';
    raw.signature = raw.signature.slice(0, -1) + (last === 'a' ? 'b' : 'a');
    writeAdminRaw(raw);
    ok(activate.loadAdminAccountPhone() === '', '篡改签名 → 忽略');
}

// —— 收尾 ——
Module._load = origLoad;
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('\n[LICENSE-CONFIG-SIGN-SMOKE] 结果: ' + (total - failed) + '/' + total +
    (failed ? ' ✗' : ' ✓'));
process.exit(failed ? 1 : 0);
