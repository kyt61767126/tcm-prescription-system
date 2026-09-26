#!/usr/bin/env node
// ============================================================================
//  desktop-user-smoke.cjs — P2 user 域模块功能冒烟（零依赖，stub 主进程协作者）
//
//  用 stub ipcMain/fse/licenseManager/路径函数加载真实 shared/desktop-user-ipc.cjs，
//  覆盖：注册面（云端 2 / 离线 3）、调用帧守卫（主框架/登录窗/子框架）、
//  user:add 校验+写入+查重+role 锁定+PBKDF2、
//  user:change-password 旧密码验证（全局盐/用户名盐/明文）+管理员覆盖、
//  user:rename-username 定位/phone保底/查重/格式门/改名证明/登录窗恢复通道。
//
//  用法: node tools/desktop-user-smoke.cjs
//  退出码: 0 全过；1 有失败
// ============================================================================
'use strict';
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const { createDesktopUserIpc } = require(path.join(ROOT, 'shared', 'desktop-user-ipc.cjs'));

let pass = 0, fail = 0;
function ok(cond, label) {
    if (cond) { pass++; }
    else { fail++; console.error('  [FAIL] ' + label); }
}

const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
const PBKDF2_ITER = 600000;
const STRONG_RE = /^pbkdf2_sha256\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/;

// 与两端 main.js hashPassword 完全同体（PBKDF2-SHA256 慢哈希）
async function hashPassword(password) {
    const saltBuf = crypto.randomBytes(16);
    const dk = crypto.pbkdf2Sync(String(password), saltBuf, PBKDF2_ITER, 32, 'sha256');
    const stored = 'pbkdf2_sha256$' + PBKDF2_ITER + '$' + saltBuf.toString('hex') + '$' + dk.toString('hex');
    return { passwordHash: stored, salt: saltBuf.toString('hex') };
}

// 旧哈希构造（用于测试兼容）
function legacyGlobalHash(pwd) {
    return crypto.createHash('sha256').update(PASSWORD_SALT + pwd).digest('hex');
}
function legacyUserHash(pwd, name) {
    return crypto.createHash('sha256').update(PASSWORD_SALT + ':' + name + pwd).digest('hex');
}

function makeEnv(productClass, overrides) {
    overrides = overrides || {};
    const handlers = {};
    const files = {};
    const signCalls = [];
    const writes = [];
    const CONFIG_PATH = '/writable/config.json';
    const DATA_DIR = '/data';

    const fse = {
        async pathExists(p) { return Object.prototype.hasOwnProperty.call(files, p); },
        async readJson(p) {
            if (overrides.readJsonThrow && overrides.readJsonThrow(p)) throw new Error('read boom: ' + p);
            return JSON.parse(JSON.stringify(files[p]));
        },
        async writeJson(p, obj) {
            writes.push(p);
            files[p] = JSON.parse(JSON.stringify(obj));
        }
    };
    const licenseManager = {
        signConfig(cfg) { signCalls.push(cfg); cfg.__signed = true; },
        // ★ 2026-09-26 I1：三 handler 读后重签闸门（桩默认放行；
        // env.gateResult 可改写为 false 验证阻断）
        configUsersProvenAuthentic() { return env && env.gateResult === false ? false : true; },
        // ★ 第四轮（B-建3）：写盘后 proven 刷备份——desktop-user-ipc 三 handler
        //   均调用 backupUserAccounts(config,{proven:true})，桩需提供否则告警刷屏
        //   且丢失"备份被调用"这层断言面。
        backupUserAccounts(cfg, opts) {
            backupCalls.push({ cfg, proven: !!(opts && opts.proven === true) });
            return true;
        }
    };
    const env = { gateResult: true };
    const backupCalls = [];

    createDesktopUserIpc({
        ipcMain: { handle(ch, fn) { handlers[ch] = fn; } },
        fse, path, licenseManager,
        getWritableConfigPath: () => CONFIG_PATH,
        getDataDirectory: () => DATA_DIR,
        hashPassword,
        productClass
    });

    return { handlers, files, signCalls, backupCalls, writes, CONFIG_PATH, gateState: env };
}

// ---- 调用帧（形状对齐 Electron 35 WebFrameMain：主框架 parent===null） ----
const mainEv = () => ({ senderFrame: { parent: null, url: 'file:///app/index.html' } });
const loginEv = () => ({ senderFrame: { parent: null, url: 'file:///app/login.html' } });
const childEv = () => ({ senderFrame: { parent: {}, url: 'file:///app/index.html' } });
const invoke = async (env, ch, payload, ev) => env.handlers[ch](ev || mainEv(), payload);

async function main() {
    // ===== A. 注册面 =====
    {
        const cloud = makeEnv('cloud');
        const keys = Object.keys(cloud.handlers).sort();
        ok(JSON.stringify(keys) === JSON.stringify(['user:add', 'user:change-password']),
            '云端仅注册 2 个通用通道（无 rename）: ' + JSON.stringify(keys));

        const local = makeEnv('offline');
        const lkeys = Object.keys(local.handlers).sort();
        ok(JSON.stringify(lkeys) === JSON.stringify(['user:add', 'user:change-password', 'user:rename-username']),
            '离线注册 3 个通道: ' + JSON.stringify(lkeys));
    }

    // ===== B. user:add =====
    {
        const env = makeEnv('cloud');
        let r = await invoke(env, 'user:add', {});
        ok(r.success === false && r.error === '缺少用户名或密码', 'add: 缺字段拦截');

        r = await invoke(env, 'user:add', { username: 'user1', password: 'short1' });
        ok(r.success === false && r.error === '密码至少8位', 'add: 短密码拦截');

        r = await invoke(env, 'user:add', { username: 'user1', password: 'abcdefgh' });
        ok(r.success === false && r.error === '密码必须同时包含字母和数字', 'add: 弱密码拦截');

        r = await invoke(env, 'user:add', { username: '1userabc', password: 'Passw0rd1' });
        ok(r.success === false && r.error.indexOf('用户名需为4-20位') === 0, 'add: 用户名格式拦截');

        // 即使 payload 伪造 role，服务端锁定 admin
        r = await invoke(env, 'user:add', { username: 'admin1', password: 'Passw0rd1', name: '张医生', role: 'superadmin' });
        ok(r.success === true, 'add: 合法输入成功');
        const cfg = env.files[env.CONFIG_PATH];
        ok(cfg && Array.isArray(cfg.users) && cfg.users.length === 1, 'add: config.users 写入 1 条');
        const u = cfg.users[0];
        ok(u.username === 'admin1' && u.name === '张医生', 'add: 用户名/姓名正确');
        ok(u.role === 'admin', 'add: role 服务端锁定 admin（payload role 被忽略）');
        ok(STRONG_RE.test(u.password) && u.password === u.passwordHash && u.salt.length === 32,
            'add: PBKDF2 强哈希格式 + 双字段一致 + 随机盐');
        ok(!!u.createdAt && !!u.updatedAt, 'add: 时间戳落位');
        ok(u.password !== 'Passw0rd1', 'add: 明文不落盘');
        ok(env.signCalls.length === 1, 'add: signConfig 被调用');
        // ★ 第四轮（B-建3）：写盘后 proven 刷备份断言
        ok(env.backupCalls.length === 1 && env.backupCalls[0].proven === true,
            'add: 写盘后 backupUserAccounts(proven:true) 被调用');

        r = await invoke(env, 'user:add', { username: 'admin1', password: 'Passw0rd1' });
        ok(r.success === false && r.error === '用户名已存在', 'add: 重复用户名拦截');

        // 子框架拒绝
        r = await invoke(env, 'user:add', { username: 'admin2', password: 'Passw0rd1' }, childEv());
        ok(r.success === false && r.error === '拒绝非主框架调用', 'add: 子框架调用拒绝');
    }

    // ===== C. user:change-password =====
    {
        const env = makeEnv('cloud');
        let r = await invoke(env, 'user:change-password', { username: '', newPassword: '' });
        ok(r.success === false && r.error === '缺少用户名或新密码', 'pw: 缺字段拦截');

        r = await invoke(env, 'user:change-password', { username: 'admin1', newPassword: 'abcdefgh' });
        ok(r.success === false && r.error === '请输入原密码', 'pw: 缺旧密码拦截');

        r = await invoke(env, 'user:change-password', { username: 'admin1', oldPassword: 'x', newPassword: 'abcdefgh' });
        ok(r.success === false && r.error === '密码必须同时包含字母和数字', 'pw: 弱密码拦截');

        // C3 config.json：旧密码正确（全局盐哈希账户）→ 强哈希落盘
        env.files[env.CONFIG_PATH] = { users: [{ username: 'admin1', password: legacyGlobalHash('OldPwd12'), salt: PASSWORD_SALT }] };
        r = await invoke(env, 'user:change-password', { username: 'admin1', oldPassword: 'OldPwd12', newPassword: 'NewPass99' });
        ok(r.success === true, 'pw: 全局盐账户旧密码正确 → 成功');
        const u = env.files[env.CONFIG_PATH].users[0];
        ok(STRONG_RE.test(u.password) && u.password === u.passwordHash, 'pw: 新密码 PBKDF2 强哈希');
        ok(!!u.updatedAt && env.signCalls.length === 1, 'pw: updatedAt + signConfig');

        // C3b 旧密码错误
        r = await invoke(env, 'user:change-password', { username: 'admin1', oldPassword: 'WrongPwd9', newPassword: 'NewPass99' });
        ok(r.success === false && r.error === '原密码错误', 'pw: 旧密码错误拒绝');

        // C3c 用户名盐增强哈希账户
        const envU = makeEnv('cloud');
        envU.files[envU.CONFIG_PATH] = { users: [{ username: 'user_salt1', password: legacyUserHash('UserPwd12', 'user_salt1') }] };
        r = await invoke(envU, 'user:change-password', { username: 'user_salt1', oldPassword: 'UserPwd12', newPassword: 'NewPass99' });
        ok(r.success === true && STRONG_RE.test(envU.files[envU.CONFIG_PATH].users[0].password),
            'pw: 用户名盐增强哈希账户兼容通过');

        // C3d 历史明文账户
        const envP = makeEnv('cloud');
        envP.files[envP.CONFIG_PATH] = { users: [{ username: 'plain1', password: 'PlainPwd1' }] };
        r = await invoke(envP, 'user:change-password', { username: 'plain1', oldPassword: 'PlainPwd1', newPassword: 'NewPass99' });
        ok(r.success === true, 'pw: 历史明文账户兼容通过');

        // C4 管理员覆盖：管理员改普通用户密码（旧密码位填管理员密码）
        const envA = makeEnv('cloud');
        envA.files[envA.CONFIG_PATH] = { users: [
            { username: 'boss1', role: 'admin', password: legacyGlobalHash('BossPwd12') },
            { username: 'staff1', role: 'user', password: legacyGlobalHash('StaffPwd1') }
        ] };
        r = await invoke(envA, 'user:change-password', { username: 'staff1', oldPassword: 'BossPwd12', newPassword: 'StaffNew9' });
        ok(r.success === true && STRONG_RE.test(envA.files[envA.CONFIG_PATH].users[1].password),
            'pw: 管理员凭自身密码可改普通用户密码');
        // 非管理员不能覆盖
        r = await invoke(envA, 'user:change-password', { username: 'boss1', oldPassword: 'StaffNew9', newPassword: 'HackPwd99' });
        ok(r.success === false && r.error === '原密码错误', 'pw: 普通用户密码不能作为管理员改密凭证');

        // C5 用户不存在
        const env3 = makeEnv('cloud');
        r = await invoke(env3, 'user:change-password', { username: 'ghost1', oldPassword: 'x1234567', newPassword: 'GhostPwd1' });
        ok(r.success === false && r.error === '用户不存在', 'pw: 用户不存在');

        // C6 子框架
        r = await invoke(env, 'user:change-password',
            { username: 'admin1', oldPassword: 'NewPass99', newPassword: 'OtherPw99' }, childEv());
        ok(r.success === false, 'pw: 子框架调用拒绝');

        // C7 读异常
        const env4 = makeEnv('cloud', { readJsonThrow: () => true });
        env4.files[env4.CONFIG_PATH] = { users: [] };
        r = await invoke(env4, 'user:change-password', { username: 'admin1', oldPassword: 'OldPwd12', newPassword: 'NewPass99' });
        ok(r.success === false && String(r.error).indexOf('read boom') !== -1, 'pw: 异常返回 false 且带原因');
    }

    // ===== D. user:rename-username（离线）=====
    {
        const env = makeEnv('offline');
        let r = await invoke(env, 'user:rename-username', {});
        ok(r.success === false && r.error === '缺少原账号', 'rename: 缺原账号拦截');

        r = await invoke(env, 'user:rename-username', { oldUsername: 'oldname1' });
        ok(r.success === false && r.error === '缺少新用户名或新密码', 'rename: 无新值拦截');

        // D1 登录窗框架：密码同步成功（忘记密码恢复/登录慢哈希升级通道）
        env.files[env.CONFIG_PATH] = { users: [{ username: 'oldname1', password: legacyGlobalHash('AnyPwd12') }] };
        r = await invoke(env, 'user:rename-username',
            { oldUsername: 'oldname1', newPassword: 'RecoverP9' }, loginEv());
        ok(r.success === true && r.synced === true, 'rename: 登录窗密码同步成功');
        ok(STRONG_RE.test(env.files[env.CONFIG_PATH].users[0].password), 'rename: 同步密码落 PBKDF2');

        // D1b 登录窗框架禁止改名
        r = await invoke(env, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: 'newname1' }, loginEv());
        ok(r.success === false && r.error === '登录窗口不允许修改用户名', 'rename: 登录窗改名拒绝');

        // D1c hash 伪造：主窗 URL 带 #login.html 不得被判为登录窗（审查阻断项回归）
        const forgedEv = { senderFrame: { parent: null, url: 'file:///app/index.html#login.html' } };
        r = await invoke(env, 'user:rename-username',
            { oldUsername: 'oldname1', newPassword: 'Hacked99' }, forgedEv);
        ok(r.success === false && r.error === '需要验证原密码或管理员密码',
            'rename: index.html#login.html hash 伪造不绕过证明');
        const forgedEv2 = { senderFrame: { parent: null, url: 'file:///app/index.html?x=login.html' } };
        r = await invoke(env, 'user:rename-username',
            { oldUsername: 'oldname1', newPassword: 'Hacked99' }, forgedEv2);
        ok(r.success === false, 'rename: ?x=login.html query 伪造不绕过证明');
        // 真实登录窗 pathname + query 仍应识别
        const realQEv = { senderFrame: { parent: null, url: 'file:///app/login.html?from=logout' } };
        r = await invoke(env, 'user:rename-username',
            { oldUsername: 'oldname1', newPassword: 'RecoverP9' }, realQEv);
        ok(r.success === true, 'rename: 真实 login.html pathname（带query）仍走恢复通道');

        // D2 主窗改名无证明 → 拒绝
        const env2 = makeEnv('offline');
        env2.files[env2.CONFIG_PATH] = { users: [{ username: 'oldname1', password: legacyGlobalHash('OldPwd12') }] };
        r = await invoke(env2, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === false && r.error === '需要验证原密码或管理员密码', 'rename: 无证明改名拒绝');

        // D3 主窗凭旧密码改名成功
        r = await invoke(env2, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: 'newname1', oldPassword: 'OldPwd12' });
        const u3 = env2.files[env2.CONFIG_PATH].users[0];
        ok(r.synced === true && u3.username === 'newname1' && !!u3.updatedAt && env2.signCalls.length === 1,
            'rename: 旧密码验证通过改名成功（时间戳/签名）');

        // D4 手机号定位 + phone 保底
        const env4 = makeEnv('offline');
        env4.files[env4.CONFIG_PATH] = { users: [{ username: '13800001111', password: legacyUserHash('MobPwd12', '13800001111') }] };
        r = await invoke(env4, 'user:rename-username',
            { oldUsername: '13800001111', newUsername: 'mobuser1', oldPassword: 'MobPwd12' });
        const u4 = env4.files[env4.CONFIG_PATH].users[0];
        ok(r.synced === true && u4.phone === '13800001111' && u4.username === 'mobuser1',
            'rename: 手机号定位 + phone 保底落位');

        // D5 查重（username / phone 分别覆盖）
        const env5 = makeEnv('offline');
        env5.files[env5.CONFIG_PATH] = { users: [
            { username: 'oldname1', password: legacyGlobalHash('OldPwd12') },
            { username: 'taken1', role: 'user', password: legacyGlobalHash('x') }
        ] };
        r = await invoke(env5, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: 'taken1', oldPassword: 'OldPwd12' });
        ok(r.success === false && r.error === '该用户名已被占用', 'rename: username 占用拒绝');

        env5.files[env5.CONFIG_PATH].users[1] =
            { username: 'real2', phone: '13900000000', password: legacyGlobalHash('x') };
        r = await invoke(env5, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: '13900000000', oldPassword: 'OldPwd12' });
        ok(r.success === false, 'rename: 他人 phone 占用拒绝');

        // D6 格式门（中文/手机号格式/过短）
        r = await invoke(env5, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: '中文名', oldPassword: 'OldPwd12' });
        ok(r.success === false && r.error === '用户名格式不合法', 'rename: 中文名拒绝');
        r = await invoke(env5, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: '13700000000', oldPassword: 'OldPwd12' });
        ok(r.success === false, 'rename: 手机号格式新用户名拒绝');
        r = await invoke(env5, 'user:rename-username',
            { oldUsername: 'oldname1', newUsername: 'a', oldPassword: 'OldPwd12' });
        ok(r.success === false, 'rename: 过短用户名拒绝');

        // D7 管理员证明：改名+改密
        const env7 = makeEnv('offline');
        env7.files[env7.CONFIG_PATH] = { users: [
            { username: 'boss1', role: 'admin', password: legacyGlobalHash('BossPwd12') },
            { username: 'staff1', role: 'user', password: legacyGlobalHash('StaffPwd1') }
        ] };
        r = await invoke(env7, 'user:rename-username', {
            oldUsername: 'staff1', newUsername: 'staffnew1',
            newPassword: 'StaffNew9', adminPassword: 'BossPwd12'
        });
        const su = env7.files[env7.CONFIG_PATH].users[1];
        ok(r.synced === true && su.username === 'staffnew1' && STRONG_RE.test(su.password),
            'rename: 管理员证明通过 → 改名+改密成功');

        // D8 无账户/无 config → synced:false
        const env8 = makeEnv('offline');
        env8.files[env8.CONFIG_PATH] = { users: [{ username: 'xx' }] };
        r = await invoke(env8, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === true && r.synced === false, 'rename: 无账户 no-op synced:false');

        const env9 = makeEnv('offline');
        r = await invoke(env9, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === true && r.synced === false, 'rename: 无 config 文件 synced:false');

        // D9 子框架拒绝
        r = await invoke(env2, 'user:rename-username',
            { oldUsername: 'newname1', newUsername: 'x2' }, childEv());
        ok(r.success === false, 'rename: 子框架调用拒绝');

        // D10 异常
        const env10 = makeEnv('offline', { readJsonThrow: () => true });
        env10.files[env10.CONFIG_PATH] = { users: [] };
        r = await invoke(env10, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === false && String(r.error).indexOf('read boom') !== -1, 'rename: 异常返回 false 且带原因');
    }

    // ===== E. 配置完整性闸门（F2 I-1/I-2 阻断回归）：三 handler 篡改态一律中止 =====
    {
        const blockText = '检测到本地配置被篡改';

        // E1 add：先验证参数、读后闸门，不写不签
        let env = makeEnv('cloud');
        env.gateState.gateResult = false;
        let r = await invoke(env, 'user:add', { username: 'addx1234', password: 'Passw0rd1' });
        ok(r.success === false && r.error.indexOf(blockText) !== -1, '闸门 add: 篡改态中止');
        ok(env.signCalls.length === 0 && env.writes.length === 0, '闸门 add: 不签名不写盘');

        // E2 change-password
        env = makeEnv('cloud');
        env.files[env.CONFIG_PATH] = { users: [{ username: 'admin1', password: legacyGlobalHash('OldPwd12') }] };
        env.gateState.gateResult = false;
        r = await invoke(env, 'user:change-password',
            { username: 'admin1', oldPassword: 'OldPwd12', newPassword: 'NewPass99' });
        ok(r.success === false && r.error.indexOf(blockText) !== -1, '闸门 pw: 篡改态中止');
        ok(env.signCalls.length === 0 && env.writes.length === 0, '闸门 pw: 不签名不写盘');

        // E3 rename：登录窗密码同步分支也须被闸门覆盖（闸门在分支选择前）
        env = makeEnv('offline');
        env.files[env.CONFIG_PATH] = { users: [{ username: 'oldname1', password: legacyGlobalHash('AnyPwd12') }] };
        env.gateState.gateResult = false;
        r = await invoke(env, 'user:rename-username',
            { oldUsername: 'oldname1', newPassword: 'RecoverP9' }, loginEv());
        ok(r.success === false && r.error.indexOf(blockText) !== -1, '闸门 rename: 登录窗同步分支也中止');
        ok(env.signCalls.length === 0 && env.writes.length === 0, '闸门 rename: 不签名不写盘');
    }

    console.log('');
    console.log('[desktop-user-smoke] 结果: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' 通过 ✓' : ' 有失败 ✗'));
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
