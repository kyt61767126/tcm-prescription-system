// ============================================================================
//  analyze-domain-handlers.cjs — Electron 域 IPC 抽取侦察工具
//
//  扫描云/离两份 main.js，按通道前缀提取 ipcMain.handle/on 块（块结束=行首 '});'
//  或 '});' 前的变体），逐通道比对：同构/差异/仅云端/仅离线，并输出各域整块
//  行范围与哈希（改前审计基线）。
//
//  用法：
//    node .trae/skills/electron-domain-extract/scripts/analyze-domain-handlers.cjs
//    node ...analyze-domain-handlers.cjs --prefix license:
//    node ...analyze-domain-handlers.cjs --prefix ''          # 全部 handler
//
//  退出码恒 0（侦察工具）。
// ============================================================================
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const REPO = path.resolve(__dirname, '../../../..');
const FILES = {
    cloud: 'app_project/db-yunduan/cloud_desktop/electron/main.js',
    local: 'app_project/db-offline/desktop/electron/main.js'
};

// 参数
const argOf = (k) => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : undefined;
};
// 默认 license:；--all 扫描全部（PowerShell 下勿传空串，会被吞）
const prefix = process.argv.includes('--all') ? '' : (argOf('--prefix') === undefined ? 'license:' : argOf('--prefix'));

const BLOCK_ENDERS = new Set(['});', '}); ']);

// 提取匹配前缀的所有 handler: {channel,startLine,endLine,text,hash,kind}
function extractHandlers(absFile) {
    const lines = fs.readFileSync(absFile, 'utf8').split('\n');
    const out = [];
    const re = /^ipcMain\.(handle|on)\(['"]([^'"]+)['"]/;
    for (let i = 0;i < lines.length;i++) {
        const m = lines[i].match(re);
        if (!m) continue;
        const channel = m[2];
        if (prefix && !channel.startsWith(prefix)) continue;
        let j = i;
        while (j < lines.length && !BLOCK_ENDERS.has(lines[j])) j++;
        if (j >= lines.length) {
            console.error(`[WARN] 找不到块结束: ${channel} L${i + 1}`);
            continue;
        }
        const text = lines.slice(i, j + 1).join('\n');
        out.push({
            channel,
            kind: m[1],
            startLine: i + 1,
            endLine: j + 1,
            text,
            hash: crypto.createHash('sha256').update(text).digest('hex')
        });
    }
    return out;
}

const data = {};
for (const [k, f] of Object.entries(FILES)) data[k] = extractHandlers(path.join(REPO, f));

const cloudMap = new Map(data.cloud.map(h => [h.channel, h]));
const localMap = new Map(data.local.map(h => [h.channel, h]));
const all = new Set([...cloudMap.keys(), ...localMap.keys()]);

console.log(`前缀=${JSON.stringify(prefix)}  云端 ${data.cloud.length} / 离线 ${data.local.length} / 并集 ${all.size}\n`);

if (all.size === 0) {
    console.log('（无匹配 handler——可能已全部抽出）');
    process.exit(0);
}

for (const ch of [...all].sort()) {
    const c = cloudMap.get(ch);
    const l = localMap.get(ch);
    if (c && l) {
        const same = c.hash === l.hash;
        console.log(`${same ? '同构' : '差异'} ${ch}  云L${c.startLine}-${c.endLine} 离L${l.startLine}-${l.endLine}`);
        if (!same) {
            const cl = c.text.split('\n'), ll = l.text.split('\n');
            const n = Math.max(cl.length, ll.length);
            for (let i = 0;i < n;i++) {
                if (cl[i] !== ll[i]) {
                    console.log(`    @${i + 1}: 云 ${JSON.stringify(cl[i])}`);
                    console.log(`         离 ${JSON.stringify(ll[i])}`);
                }
            }
        }
    } else if (c) {
        console.log(`仅云端 ${ch}  L${c.startLine}-${c.endLine}`);
    } else {
        console.log(`仅离线 ${ch}  L${l.startLine}-${l.endLine}`);
    }
}

// 整块范围（首匹配到末匹配）与哈希
function blockInfo(key) {
    const arr = data[key];
    if (!arr.length) return null;
    const s = Math.min(...arr.map(h => h.startLine));
    const e = Math.max(...arr.map(h => h.endLine));
    const rel = FILES[key];
    const lines = fs.readFileSync(path.join(REPO, rel), 'utf8').split('\n');
    const text = lines.slice(s - 1, e).join('\n');
    return {
        rel, s, e,
        hash: crypto.createHash('sha256').update(text).digest('hex')
    };
}
console.log('\n— 整块范围/哈希（改前基线；多区域域需另行按块记录）—');
for (const key of ['cloud', 'local']) {
    const b = blockInfo(key);
    if (b) console.log(`${key}  ${b.rel} L${b.s}-${b.e}  ${b.hash}`);
}
