#!/usr/bin/env node
// ============================================================================
//  detach-cross-product-test.cjs — 跨端共存：单设备可同时绑离线码+云端码（2026-10-23）
//
//  对象：functions/api/license/_lib/license-core.js 的 detachDeviceFromOtherLicenses
//  方法：动态 import 真实模块，传入 stub KV（Map 存储 license 记录），
//        断言解绑结果在【同 productClass 内】执行、跨 productClass 保留。
// ============================================================================
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('  [PASS] ' + name); }
    else { fail++; console.error('  [FAIL] ' + name + (extra ? '  [' + extra + ']' : '')); }
}

// ---- stub KV：license 记录存 license:{code}，支持 list 全扫 ----
function makeKv(records) {
    const store = new Map();
    for (const r of records) store.set('license:' + r.code, JSON.stringify(r));
    store.set('system:license_index', JSON.stringify(records.map(r => r.code)));
    return {
        store,
        async get(key, type) {
            const v = store.get(key);
            if (v === undefined) return null;
            return type === 'json' ? JSON.parse(v) : v;
        },
        async put(key, value) { store.set(key, typeof value === 'string' ? value : JSON.stringify(value)); },
        async delete(key) { store.delete(key); },
        async list({ prefix } = {}) {
            const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
            return { keys: keys.map(k => ({ name: k })) };
        }
    };
}

function rec(code, productClass, machineIds) {
    return {
        code,
        productClass: productClass || null,
        devices: machineIds.map(m => ({ machineId: m, activatedAt: '2026-10-23T00:00:00.000Z' }))
    };
}

function hasDevice(kv, code, mid) {
    const r = JSON.parse(kv.store.get('license:' + code) || 'null');
    return r && Array.isArray(r.devices) && r.devices.some(d => d && d.machineId === mid);
}

(async () => {
    const core = await import(pathToFileURL(path.join(__dirname, '..', 'functions', 'api', 'license', '_lib', 'license-core.js')).href);
    const { detachDeviceFromOtherLicenses } = core;
    const MID = 'device-AAA-001';

    // T1：同 productClass（cloud vs cloud）→ 他码被解绑
    {
        const kv = makeKv([rec('CLOUD-A', 'cloud', [MID]), rec('CLOUD-B', 'cloud', [MID])]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'CLOUD-A', MID);
        t('T1 同端 cloud 目标解绑他 cloud 码', detached.includes('CLOUD-B'), 'detached=' + detached.join(','));
        t('T1 CLOUD-B 设备已移除', !hasDevice(kv, 'CLOUD-B', MID));
        t('T1 CLOUD-A 设备保留', hasDevice(kv, 'CLOUD-A', MID));
    }

    // T2：跨端（cloud 目标 vs offline 他码）→ 他码保留
    {
        const kv = makeKv([rec('CLOUD-A', 'cloud', [MID]), rec('OFF-A', 'offline', [MID])]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'CLOUD-A', MID);
        t('T2 跨端 cloud 目标不解绑 offline 他码', detached.length === 0, 'detached=' + detached.join(','));
        t('T2 OFF-A 设备保留', hasDevice(kv, 'OFF-A', MID));
    }

    // T3：反向（offline 目标 vs cloud 他码）→ 他码保留
    {
        const kv = makeKv([rec('OFF-A', 'offline', [MID]), rec('CLOUD-A', 'cloud', [MID])]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'OFF-A', MID);
        t('T3 跨端 offline 目标不解绑 cloud 他码', detached.length === 0, 'detached=' + detached.join(','));
        t('T3 CLOUD-A 设备保留', hasDevice(kv, 'CLOUD-A', MID));
    }

    // T4：历史裸码目标（无 productClass）→ 旧行为全部解绑
    {
        const kv = makeKv([rec('BARE-A', null, [MID]), rec('CLOUD-B', 'cloud', [MID]), rec('OFF-B', 'offline', [MID])]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'BARE-A', MID);
        t('T4 裸码目标解绑所有他码', detached.includes('CLOUD-B') && detached.includes('OFF-B'), 'detached=' + detached.join(','));
    }

    // T5：他码无 productClass、目标有 → 他码被解绑（历史残留清理）
    {
        const kv = makeKv([rec('CLOUD-A', 'cloud', [MID]), rec('BARE-B', null, [MID])]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'CLOUD-A', MID);
        t('T5 目标有端/他码无端 → 他码解绑', detached.includes('BARE-B'), 'detached=' + detached.join(','));
    }

    // T6：同设备三码（cloud 目标 + cloud 他 + offline 他）→ 只解绑 cloud 他码
    {
        const kv = makeKv([
            rec('CLOUD-TARGET', 'cloud', [MID]),
            rec('CLOUD-OTHER', 'cloud', [MID]),
            rec('OFF-OTHER', 'offline', [MID])
        ]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'CLOUD-TARGET', MID);
        t('T6 只解绑同端 cloud 他码', detached.includes('CLOUD-OTHER') && !detached.includes('OFF-OTHER'), 'detached=' + detached.join(','));
        t('T6 offline 他码设备保留', hasDevice(kv, 'OFF-OTHER', MID));
    }

    // T7：local 别称归一（历史 offline 码存 'local'）
    {
        const kv = makeKv([rec('OFF-A', 'local', [MID]), rec('CLOUD-A', 'cloud', [MID])]);
        const detached = await detachDeviceFromOtherLicenses(kv, 'OFF-A', MID);
        t('T7 local 别称归一为 offline，跨端保留', detached.length === 0, 'detached=' + detached.join(','));
    }

    console.log('\n' + (fail === 0 ? `ALL PASS (${pass})` : `FAILURES: ${fail}/${pass + fail}`));
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
