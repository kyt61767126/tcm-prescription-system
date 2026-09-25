#!/usr/bin/env node
// ============================================================================
//  desktop-user-smoke.cjs — P2 user 域模块功能冒烟（零依赖，stub 主进程协作者）
//
//  用 stub ipcMain/fse/licenseManager/路径函数加载真实 shared/desktop-user-ipc.cjs，
//  覆盖：注册面（云端 2 / 离线 3）、user:add 校验+写入+查重、
//  user:change-password 配置路径/本地回退/用户不存在/异常、
//  user:rename-username 用户名定位/手机号定位/phone 保底/带密码/无账户/无文件/异常。
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

// 与 main.js hashPassword 完全同体（常量盐 + sha256）
async function hashPassword(password) {
    const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
    const data = Buffer.from(PASSWORD_SALT + password, 'utf8');
    return {
        passwordHash: crypto.createHash('sha256').update(data).digest('hex'),
        salt: PASSWORD_SALT
    };
}

function makeEnv(productClass, overrides) {
    overrides = overrides || {};
    const handlers = {};
    const files = {};
    const signCalls = [];
    const writes = [];
    const CONFIG_PATH = '/writable/config.json';
    const DATA_DIR = '/data';
    const USERS_PATH = path.join(DATA_DIR, 'systemUsers.json');

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
        signConfig(cfg) { signCalls.push(cfg); cfg.__signed = true; }
    };

    createDesktopUserIpc({
        ipcMain: { handle(ch, fn) { handlers[ch] = fn; } },
        fse, path, licenseManager,
        getWritableConfigPath: () => CONFIG_PATH,
        getDataDirectory: () => DATA_DIR,
        hashPassword,
        productClass
    });

    return { handlers, files, signCalls, writes, CONFIG_PATH, USERS_PATH };
}

const invoke = async (env, ch, payload) => env.handlers[ch]({}, payload);
const HASH64 = /^[0-9a-f]{64}$/;

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

        r = await invoke(env, 'user:add', { username: 'admin1', password: 'Passw0rd1', name: '张医生' });
        ok(r.success === true, 'add: 合法输入成功');
        const cfg = env.files[env.CONFIG_PATH];
        ok(cfg && Array.isArray(cfg.users) && cfg.users.length === 1, 'add: config.users 写入 1 条');
        const u = cfg.users[0];
        ok(u.username === 'admin1' && u.name === '张医生' && u.role === 'admin', 'add: 字段/默认角色正确');
        ok(u.password === u.passwordHash && HASH64.test(u.passwordHash), 'add: 密码哈希 64hex 且双字段一致');
        ok(u.salt === 'bnzc_prescription_salt_v1' && !!u.createdAt && !!u.updatedAt, 'add: 盐/时间戳落位');
        ok(u.password !== 'Passw0rd1', 'add: 明文不落盘');
        ok(env.signCalls.length === 1, 'add: signConfig 被调用');

        r = await invoke(env, 'user:add', { username: 'admin1', password: 'Passw0rd1' });
        ok(r.success === false && r.error === '用户名已存在', 'add: 重复用户名拦截');
    }

    // ===== C. user:change-password =====
    {
        const env = makeEnv('cloud');
        let r = await invoke(env, 'user:change-password', { username: '', newPassword: '' });
        ok(r.success === false && r.error === '缺少用户名或新密码', 'pw: 缺字段拦截');

        r = await invoke(env, 'user:change-password', { username: 'admin1', newPassword: 'abcdefgh' });
        ok(r.success === false && r.error === '密码必须同时包含字母和数字', 'pw: 弱密码拦截');

        // C3 config.json 主路径
        env.files[env.CONFIG_PATH] = { users: [{ username: 'admin1', passwordHash: 'oldhash', salt: 'oldsalt' }] };
        r = await invoke(env, 'user:change-password', { username: 'admin1', newPassword: 'NewPass99' });
        ok(r.success === true, 'pw: config 路径成功');
        const u = env.files[env.CONFIG_PATH].users[0];
        ok(HASH64.test(u.passwordHash) && u.passwordHash !== 'oldhash' && u.password === u.passwordHash,
            'pw: config 用户密码三字段更新');
        ok(!!u.updatedAt && env.signCalls.length === 1, 'pw: updatedAt + signConfig');

        // C4 systemUsers.json 回退路径
        const env2 = makeEnv('cloud');
        env2.files[env2.USERS_PATH] = [{ username: 'local1', passwordHash: 'oldhash' }];
        r = await invoke(env2, 'user:change-password', { username: 'local1', newPassword: 'LocalPwd9' });
        ok(r.success === true, 'pw: 本地回退路径成功');
        const lu = env2.files[env2.USERS_PATH][0];
        ok(HASH64.test(lu.passwordHash) && lu.passwordHash !== 'oldhash', 'pw: 本地用户密码更新');
        ok(env2.signCalls.length === 0, 'pw: 回退路径不签 config');

        // C5 两源皆无
        const env3 = makeEnv('cloud');
        r = await invoke(env3, 'user:change-password', { username: 'ghost1', newPassword: 'GhostPwd1' });
        ok(r.success === false && r.error === '用户不存在', 'pw: 用户不存在');

        // C6 读异常
        const env4 = makeEnv('cloud', { readJsonThrow: () => true });
        env4.files[env4.CONFIG_PATH] = { users: [] };
        r = await invoke(env4, 'user:change-password', { username: 'admin1', newPassword: 'NewPass99' });
        ok(r.success === false && String(r.error).indexOf('read boom') !== -1, 'pw: 异常返回 false 且带原因');
    }

    // ===== D. user:rename-username（离线）=====
    {
        const env = makeEnv('offline');
        env.files[env.CONFIG_PATH] = { users: [{ username: 'oldname1', passwordHash: 'h', salt: 's' }] };
        let r = await invoke(env, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === true && r.synced === true, 'rename: 用户名定位同步成功');
        const u = env.files[env.CONFIG_PATH].users[0];
        ok(u.username === 'newname1' && !!u.updatedAt && env.signCalls.length === 1, 'rename: 新用户名/时间戳/签名');

        // D2 phone 定位
        const env2 = makeEnv('offline');
        env2.files[env2.CONFIG_PATH] = { users: [{ username: 'realname1', phone: '13800000000', passwordHash: 'h' }] };
        r = await invoke(env2, 'user:rename-username', { oldUsername: '13800000000', newUsername: 'newlog1' });
        ok(r.synced === true && env2.files[env2.CONFIG_PATH].users[0].username === 'newlog1',
            'rename: 手机号定位成功');

        // D3 phone 保底
        const env3 = makeEnv('offline');
        env3.files[env3.CONFIG_PATH] = { users: [{ username: '13800001111' }] };
        r = await invoke(env3, 'user:rename-username', { oldUsername: '13800001111', newUsername: 'mobuser1' });
        const u3 = env3.files[env3.CONFIG_PATH].users[0];
        ok(r.synced === true && u3.phone === '13800001111' && u3.username === 'mobuser1',
            'rename: 手机号用户名 phone 保底落位');

        // D4 同时带新密码
        const env4 = makeEnv('offline');
        env4.files[env4.CONFIG_PATH] = { users: [{ username: 'oldname1', passwordHash: 'h', salt: 's' }] };
        r = await invoke(env4, 'user:rename-username', {
            oldUsername: 'oldname1', newUsername: 'newname1', newPassword: 'RenewPwd9'
        });
        const u4 = env4.files[env4.CONFIG_PATH].users[0];
        ok(r.synced === true && HASH64.test(u4.passwordHash) && u4.passwordHash !== 'h' && u4.password === u4.passwordHash,
            'rename: 携带的新密码已哈希写入');

        // D5 config 无该账户
        const env5 = makeEnv('offline');
        env5.files[env5.CONFIG_PATH] = { users: [{ username: 'xx' }] };
        r = await invoke(env5, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === true && r.synced === false, 'rename: 无账户 no-op synced:false');

        // D6 config 文件不存在
        const env6 = makeEnv('offline');
        r = await invoke(env6, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === true && r.synced === false, 'rename: 无 config 文件 synced:false');

        // D7 异常
        const env7 = makeEnv('offline', { readJsonThrow: () => true });
        env7.files[env7.CONFIG_PATH] = { users: [] };
        r = await invoke(env7, 'user:rename-username', { oldUsername: 'oldname1', newUsername: 'newname1' });
        ok(r.success === false && String(r.error).indexOf('read boom') !== -1, 'rename: 异常返回 false 且带原因');
    }

    console.log('');
    console.log('[desktop-user-smoke] 结果: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' 通过 ✓' : ' 有失败 ✗'));
    process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
