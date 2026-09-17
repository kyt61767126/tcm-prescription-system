#!/usr/bin/env node
// ============================================================================
//  scan-undefined-consts.cjs — functions/ 服务端未定义常量静态扫描（第十二道门）
//
//  背景（2026-09-17 P0 实锤，commit f147bdcb）：admin-submit.js 3 处使用
//  KV_ADMIN_REQ_INDEX 但未 import —— ReferenceError 是运行时错误，
//  node --check 语法检查完全查不出 → 全新手机号激活申请必 500，
//  管理员激活通道对新客户静默损坏数月（历史成功记录走官网订单路径未踩中）。
//
//  原理：剥掉字符串/模板串/注释后，扫描所有非属性位置的 KV_* 大写常量标识符
//  （本项目 KV key 常量命名惯例），逐一核对是否在本文件定义
//  （const/let/var，含 export const）或命名导入（import { X [as Y] }）。
//  注意：`export { X } from './y'` 不在本模块作用域引入 X（用了照样炸），
//  故 re-export-from 形式不算定义。
//
//  局限（已知可接受）：模板串插值 ${...} 内的标识符随整串被剥（只漏检不误报）。
//
//  用法：node tools/scan-undefined-consts.cjs
//        全绿 exit 0；发现未定义常量 exit 1（门禁行为）
// ============================================================================
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'functions');

// 递归收集 functions/ 下全部 .js（含 _lib）
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) files.push(p);
    }
})(SCAN_ROOT);

// 剥掉块注释/行注释/单引号串/双引号串/模板串（粗处理足够识别常量定义与导入）
function strip(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

let issues = 0;
for (const f of files) {
    const stripped = strip(fs.readFileSync(f, 'utf8'));

    // 使用点：非属性位置的 KV_* 标识符（排除 Foo.KV_X 属性访问——那是对象成员不是裸常量）
    const used = new Set(stripped.match(/(?<!\.)\bKV_[A-Z0-9_]{2,}\b/g) || []);

    // 定义点：const/let/var 声明（含 export const 形式，正则天然覆盖）
    const defined = new Set();
    for (const m of stripped.matchAll(/\b(?:const|let|var)\s+(KV_[A-Z0-9_]+)/g)) defined.add(m[1]);

    // 导入点：import { X } / import { X as Y } from '...'
    const imported = new Set();
    for (const m of stripped.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop().trim();
            if (name) imported.add(name);
        }
    }

    for (const u of used) {
        if (!defined.has(u) && !imported.has(u)) {
            issues++;
            console.log('[UNDEFINED] ' + path.relative(REPO_ROOT, f) + ' : ' + u +
                '（使用但未定义/未导入 → 运行时 ReferenceError，node --check 查不出）');
        }
    }
}

if (issues === 0) {
    console.log('[scan-undefined-consts][OK] functions/ ' + files.length + ' 个文件扫描完毕，无未定义 KV_* 常量');
    process.exit(0);
} else {
    console.log('[scan-undefined-consts][FAIL] 共 ' + issues + ' 处未定义常量——补 const 声明或 import 后重推（参考 KNOWLEDGE 21.4 import 漏常量 P0 教训）');
    process.exit(1);
}
