// 2026-10-13 激活架构 P1：统一本机身份提供器 + Tab2 全入口预填 单测
// 直接从权威源 offline.js / cloud.js 抽取真身函数（resolveLocalIdentity /
// applyCodeIdentityPrefill / getLocalRegistrationInfo），在 mock DOM/桥/存储沙箱中运行，
// 验证「来源优先级 / 空才填不覆盖 / 缓存 / 无手机号返回 null」契约，无需浏览器或打包 exe。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..', '..');

// 括号配平提取 `function name...{...}` 完整源码
function extractFn(src, marker) {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, '未找到函数: ' + marker);
    const brace = src.indexOf('{', start);
    let depth = 0, i = brace;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

// ---- mock DOM ----
function makeDoc() {
    const els = {};
    return {
        getElementById(id) {
            if (!els[id]) els[id] = { value: '', textContent: '', style: {} };
            return els[id];
        },
        _els: els
    };
}
function makeLocalStorage(init) {
    const m = new Map(Object.entries(init || {}));
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }

// ============================ offline.js ============================
async function loadOffline(env) {
    const src = fs.readFileSync(path.join(ROOT, 'shared/auth-core/offline.js'), 'utf8');
    const fnGet = extractFn(src, 'function getLocalRegistrationInfo()');
    const fnResolve = extractFn(src, 'function resolveLocalIdentity()');
    const fnApply = extractFn(src, 'function applyCodeIdentityPrefill(id)');
    const state = { phone: '', clinicName: '', adminName: '' };
    const factory = new Function(
        'state', 'PHONE_RE', 'document', 'global', 'CONFIG',
        fnGet + '\n' +
        'let __localIdentity = null;\nlet __localIdentityPromise = null;\n' +
        fnResolve + '\n' + fnApply + '\n' +
        'return { resolveLocalIdentity, applyCodeIdentityPrefill };'
    );
    return factory(state, /^1[3-9]\d{9}$/, env.document, env.global, env.CONFIG);
}

console.log('A 组：offline.js resolveLocalIdentity / applyCodeIdentityPrefill');

// A1 registrationInfo 完整 → 直接带出，apply 回填+写 state+更新提示
{
    const doc = makeDoc();
    const globalObj = { localStorage: makeLocalStorage({
        'license:registrationInfo': JSON.stringify({ phone: '13800138000', clinicName: '惠康中医诊所', adminName: '王医生' })
    }) };
    const api = await loadOffline({ document: doc, global: globalObj });
    const id = await api.resolveLocalIdentity();
    ok('A1 registration 来源 phone', id && id.phone === '13800138000' && id.source === 'registration');
    ok('A1 带出 clinic/adminName', id.clinicName === '惠康中医诊所' && id.adminName === '王医生');
    api.applyCodeIdentityPrefill(id);
    ok('A1 回填手机号输入框', doc.getElementById('adminCodePhone').value === '13800138000');
    ok('A1 回填诊所/姓名(隐藏框)', doc.getElementById('adminCodeClinicName').value === '惠康中医诊所' &&
        doc.getElementById('adminCodeAdminName').value === '王医生');
    ok('A1 提示含本机手机号', doc.getElementById('adminCodePhoneHint').textContent.includes('13800138000'));
}

// A2 无 registration、桥账号补全（source=bridge）
{
    const doc = makeDoc();
    let bridgeCalls = 0;
    const globalObj = {
        localStorage: makeLocalStorage({}),
        electronAPI: { activate: { getActivationUsers: async () => { bridgeCalls++;
            return { success: true, clinicName: '桥诊所', users: [{ phone: '13911112222', name: '李医师', password: 'x' }] }; } } }
    };
    const api = await loadOffline({ document: doc, global: globalObj });
    const id = await api.resolveLocalIdentity();
    ok('A2 bridge 补全 phone/name/clinic', id && id.phone === '13911112222' &&
        id.adminName === '李医师' && id.clinicName === '桥诊所' && id.source === 'bridge');
    ok('A2 bridge 实际被调用一次', bridgeCalls === 1);
}

// A3 registration 仅 phone，bridge 补 name/clinic
{
    const doc = makeDoc();
    const globalObj = {
        localStorage: makeLocalStorage({ 'license:registrationInfo': JSON.stringify({ phone: '13700000000' }) }),
        electronAPI: { activate: { getActivationUsers: async () =>
            ({ success: true, clinicName: '补诊所', users: [{ username: '13700000000', name: '赵大夫' }] }) } }
    };
    const api = await loadOffline({ document: doc, global: globalObj });
    const r = await api.resolveLocalIdentity();
    ok('A3 phone 来自 registration', r.phone === '13700000000' && r.source === 'registration');
    ok('A3 name/clinic 由 bridge 补', r.adminName === '赵大夫' && r.clinicName === '补诊所');
}

// A4 apply 空才填，不覆盖用户已输入/已存在 state
{
    const doc = makeDoc();
    doc.getElementById('adminCodePhone').value = '13666666666'; // 用户已手填
    const globalObj = { localStorage: makeLocalStorage({
        'license:registrationInfo': JSON.stringify({ phone: '13800138000', clinicName: '另一诊所', adminName: '另一人' }) }) };
    const api = await loadOffline({ document: doc, global: globalObj });
    const r = await api.resolveLocalIdentity();
    api.applyCodeIdentityPrefill(r);
    ok('A4 不覆盖用户已手填手机号', doc.getElementById('adminCodePhone').value === '13666666666');
}

// A5 无任何手机号 → resolve null，apply(null) 无副作用
{
    const doc = makeDoc();
    const globalObj = { localStorage: makeLocalStorage({}), electronAPI: { activate: { getActivationUsers: async () =>
        ({ success: true, users: [{ username: 'admin', name: '无名' }] }) } } };
    const api = await loadOffline({ document: doc, global: globalObj, CONFIG: { clinicName: '仅诊所' } });
    const id = await api.resolveLocalIdentity();
    ok('A5 无手机号返回 null', id === null);
    api.applyCodeIdentityPrefill(null);
    ok('A5 apply(null) 不填手机号', doc.getElementById('adminCodePhone').value === '');
}

// A6 resolve 缓存：第二次不重复调桥
{
    const doc = makeDoc();
    let calls = 0;
    const globalObj = { localStorage: makeLocalStorage({}), electronAPI: { activate: { getActivationUsers: async () => { calls++;
        return { success: true, users: [{ phone: '13555555555', name: '缓存' }] }; } } } };
    const api = await loadOffline({ document: doc, global: globalObj });
    await api.resolveLocalIdentity();
    const again = await api.resolveLocalIdentity();
    ok('A6 第二次走缓存(桥仅1次) 且结果一致', calls === 1 && again.phone === '13555555555');
}

// A7 CONFIG.clinicName 末位补诊所（试用到期：有手机号账号无诊所名）
{
    const doc = makeDoc();
    const globalObj = { localStorage: makeLocalStorage({ 'license:registrationInfo': JSON.stringify({ phone: '13444444444' }) }) };
    const api = await loadOffline({ document: doc, global: globalObj, CONFIG: { clinicName: '试用诊所' } });
    const id = await api.resolveLocalIdentity();
    ok('A7 CONFIG 补诊所名', id.phone === '13444444444' && id.clinicName === '试用诊所');
}

// ============================ cloud.js ============================
async function loadCloud(env) {
    const src = fs.readFileSync(path.join(ROOT, 'shared/auth-core/cloud.js'), 'utf8');
    const fnResolve = extractFn(src, 'function resolveLocalIdentity()');
    const fnApply = extractFn(src, 'function applyCodeIdentityPrefill(id)');
    const state = { phone: '', clinicName: '', adminName: '' };
    // currentUser 在沙箱中不声明 → typeof currentUser==='undefined'（模拟无运行时登录态）
    const factory = new Function(
        'state', 'PHONE_RE', 'document', 'StorageAdapter', 'CONFIG',
        'let __localIdentity = null;\nlet __localIdentityPromise = null;\n' +
        fnResolve + '\n' + fnApply + '\n' +
        'return { resolveLocalIdentity, applyCodeIdentityPrefill };'
    );
    return factory(state, /^1[3-9]\d{9}$/, env.document, env.StorageAdapter, env.CONFIG);
}

console.log('B 组：cloud.js resolveLocalIdentity / applyCodeIdentityPrefill');

// B1 auth:currentUser（手机号在 username）带出
{
    const doc = makeDoc();
    const store = { 'auth:currentUser': JSON.stringify({ username: '13800138000', clinicName: '云端诊所', adminName: '云医' }) };
    const StorageAdapter = { getItem: async k => store[k] || null };
    const api = await loadCloud({ document: doc, StorageAdapter, CONFIG: undefined });
    const id = await api.resolveLocalIdentity();
    ok('B1 currentUser(username=手机号) 带出', id && id.phone === '13800138000' &&
        id.clinicName === '云端诊所' && id.adminName === '云医' && id.source === 'currentUser');
    api.applyCodeIdentityPrefill(id);
    ok('B1 回填手机号框', doc.getElementById('adminCodePhone').value === '13800138000');
}

// B2 phone 字段优先于 username；realName 兜底
{
    const doc = makeDoc();
    const store = { 'auth:currentUser': JSON.stringify({ phone: '13911112222', username: 'doctor01', realName: '陈医生' }) };
    const StorageAdapter = { getItem: async k => store[k] || null };
    const api = await loadCloud({ document: doc, StorageAdapter, CONFIG: undefined });
    const id = await api.resolveLocalIdentity();
    ok('B2 取 phone 字段 + realName', id.phone === '13911112222' && id.adminName === '陈医生');
}

// B3 仅 rememberedUsername 为手机号 → 补 phone
{
    const doc = makeDoc();
    const store = { 'auth:rememberedUsername': '13700000000' };
    const StorageAdapter = { getItem: async k => store[k] || null };
    const api = await loadCloud({ document: doc, StorageAdapter, CONFIG: { clinicName: '记忆诊所' } });
    const id = await api.resolveLocalIdentity();
    ok('B3 rememberedUsername 补手机号 + CONFIG 诊所', id && id.phone === '13700000000' &&
        id.source === 'remembered' && id.clinicName === '记忆诊所');
}

// B4 apply 空才填不覆盖
{
    const doc = makeDoc();
    doc.getElementById('adminCodePhone').value = '13666666666';
    const store = { 'auth:currentUser': JSON.stringify({ username: '13800138000' }) };
    const StorageAdapter = { getItem: async k => store[k] || null };
    const api = await loadCloud({ document: doc, StorageAdapter, CONFIG: undefined });
    const id = await api.resolveLocalIdentity();
    api.applyCodeIdentityPrefill(id);
    ok('B4 不覆盖用户已手填手机号', doc.getElementById('adminCodePhone').value === '13666666666');
}

// B5 无登录态/无记忆 → null
{
    const doc = makeDoc();
    const StorageAdapter = { getItem: async () => null };
    const api = await loadCloud({ document: doc, StorageAdapter, CONFIG: undefined });
    const id = await api.resolveLocalIdentity();
    ok('B5 未登录无记忆返回 null', id === null);
}

console.log('\n全部通过：' + passed + ' 断言 ✓');
