// ============================================================================
// smoke-runtime.cjs — 铁闸8：运行时冒烟测试（构建期最后防线之一）
//
// 目的：在出包前用 vm 沙箱执行 asar 内的真实函数源码，注入坏数据，
//       断言【用户管理】链路（getDefaultUsers/getUsers/saveUsers/simpleDecrypt）
//       不抛错且永远返回数组 —— 杜绝 1.2.101 "按钮点击无响应" 类静默崩溃复发。
//
// 零依赖设计：不引入 jsdom / @electron/asar。
//   - asar 读取：与 final-verify.cjs 相同的 latin1 整读方式
//   - 函数提取：字符串感知的括号计数扫描器（跳过 '...' "..." `...` // /* */）
//   - 执行环境：node vm 裸沙箱 + 手写 localStorage/btoa/atob stub
//
// 用法：
//   node smoke-runtime.cjs --asar <path.asar>   构建闸门模式（final-verify 调用）
//   node smoke-runtime.cjs --html <path.html>   开发模式（直接验证某份 index.html）
//
// 导出（供 final-verify.cjs require）：
//   run({asarPath, htmlPath}) → { total, pass, fail, lines }
//   fail > 0 即视为构建失败。
// ============================================================================
const fs = require('fs');
const vm = require('vm');

// —— 必须存在于产物中并通过冒烟的函数（用户管理点击链路）——
const REQUIRED_FUNCS = ['simpleEncrypt', 'simpleDecrypt', 'getDefaultUsers', 'saveUsers', 'getUsers'];

// 兜底管理员（与 index.html 内硬编码一致，用于断言返回内容）
const FALLBACK_ADMIN_PW = '2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b';

// ============================================================================
// 1. 源码读取
//    asar 模式：解析 asar 头（Chromium Pickle 格式），精确定位 index.html 条目，
//    只对 index.html 内容做冒烟 —— 避免误扫 login.js 等其他文件的同名函数
//      字节 0-3: 4（pickle 尺寸） 4-7: headerSize 8-11: headerSize-4 12-15: jsonLen 16..: JSON头
//      文件数据区起点 = 8 + headerSize；条目 offset/size 相对数据区
// ============================================================================
function extractAsarIndexHtml(asarPath) {
  const buf = fs.readFileSync(asarPath);
  if (buf.length < 16 || buf.readUInt32LE(0) !== 4) {
    throw new Error('非法 asar 文件（pickle 头不匹配）: ' + asarPath);
  }
  const headerSize = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  let header;
  try {
    header = JSON.parse(buf.slice(16, 16 + jsonLen).toString('utf8'));
  } catch (e) {
    throw new Error('asar 头 JSON 解析失败: ' + e.message);
  }
  // 递归查找名为 index.html 的条目（asar 内通常在根，兼容嵌套）
  let entry = null, base = '';
  const walk = (files, prefix) => {
    for (const [name, node] of Object.entries(files || {})) {
      if (node.files) walk(node.files, prefix + name + '/');
      else if (name === 'index.html' && node.offset !== undefined) {
        if (!entry) { entry = node; base = prefix + name; }
      }
    }
  };
  walk(header.files, '');
  if (!entry) throw new Error('asar 内未找到 index.html');
  const dataStart = 8 + headerSize;
  const off = dataStart + Number(entry.offset);
  return {
    path: base,
    // latin1 逐字节读：JS 代码为 ASCII，中文仅存在于字符串字面量，不影响函数提取与执行
    content: buf.slice(off, off + entry.size).toString('latin1'),
  };
}

function readSource({ asarPath, htmlPath }) {
  if (asarPath) {
    if (!fs.existsSync(asarPath)) throw new Error('asar 不存在: ' + asarPath);
    const { path: p, content } = extractAsarIndexHtml(asarPath);
    return { content, label: p + ' @ ' + asarPath };
  }
  if (htmlPath) {
    if (!fs.existsSync(htmlPath)) throw new Error('html 不存在: ' + htmlPath);
    return { content: fs.readFileSync(htmlPath, 'utf8'), label: htmlPath };
  }
  throw new Error('必须提供 --asar 或 --html');
}

// ============================================================================
// 2. 字符串感知的函数体提取器
//    返回该函数名在源码中【所有】出现的函数体数组（asar 内可能有多份副本，全部都要测）
// ============================================================================
function extractAllFunctions(src, name) {
  const bodies = [];
  const headRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
  let m;
  while ((m = headRe.exec(src)) !== null) {
    let i = src.indexOf('{', m.index);
    if (i < 0) break;
    const start = i;
    let depth = 0;
    let closed = false;
    while (i < src.length) {
      const c = src[i];
      if (c === "'" || c === '"') {            // 跳过普通字符串
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
        i++; continue;
      }
      if (c === '`') {                          // 跳过模板字符串（其中的 ${} 不影响函数体括号深度）
        i++;
        while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
        i++; continue;
      }
      if (c === '/' && src[i + 1] === '/') {    // 行注释
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {    // 块注释
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2; continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { bodies.push(src.substring(m.index, i + 1)); closed = true; break; }
      }
      i++;
    }
    if (!closed) throw new Error('函数 ' + name + ' 括号不平衡（第 ' + m.index + ' 字节处）——产物可能被截断');
  }
  return bodies;
}

// ============================================================================
// 3. vm 沙箱（浏览器 API stub）
// ============================================================================
function makeSandbox() {
  const storage = {};
  return {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    escape, unescape,
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
      clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
    },
    CONFIG: {},
    __storage: storage,
  };
}

// ============================================================================
// 4. 测试用例定义（每个用例独立沙箱，互不污染）
//    约定：fn 函数体 bundle 已注入沙箱全局；setup 负责布置坏数据；断言返回数组且不抛错
// ============================================================================
const CASES = [
  {
    name: 'C1 CONFIG.users=非数组字符串(length>0)',
    setup: (sb) => { sb.CONFIG.users = 'garbage-string-with-length'; },
    call: (sb) => sb.getDefaultUsers(),
  },
  {
    name: 'C2 CONFIG.users=伪数组对象{length:2}',
    setup: (sb) => { sb.CONFIG.users = { 0: 'a', 1: 'b', length: 2 }; },
    call: (sb) => sb.getDefaultUsers(),
  },
  {
    name: 'C3 CONFIG.users=undefined → 兜底admin',
    setup: (sb) => { sb.CONFIG.users = undefined; },
    call: (sb) => sb.getDefaultUsers(),
    assert: (r) => Array.isArray(r) && r.some(u => u && u.username === 'admin'),
  },
  {
    name: 'C4 CONFIG.users=合法数组 → 正常映射',
    setup: (sb) => { sb.CONFIG.users = [{ username: 'u1', password: 'p1', name: 'n1', role: 'user' }]; },
    call: (sb) => sb.getDefaultUsers(),
    assert: (r) => Array.isArray(r) && r.length === 1 && r[0].username === 'u1',
  },
  {
    name: 'C5 localStorage毒数据[object Promise]',
    setup: (sb) => { sb.__storage['local_systemUsers'] = '[object Promise]'; },
    call: (sb) => sb.getUsers(),
  },
  {
    name: 'C6 localStorage毒数据XORv1坏base64',
    setup: (sb) => { sb.__storage['local_systemUsers'] = 'XORv1:%%%not-base64%%%'; },
    call: (sb) => sb.getUsers(),
  },
  {
    name: 'C7 saveUsers→getUsers 正常往返',
    setup: (sb) => { sb.saveUsers([{ username: 'rt1', password: 'pw', name: '往返', role: 'admin' }]); },
    call: (sb) => sb.getUsers(),
    assert: (r) => Array.isArray(r) && r.some(u => u && u.username === 'rt1'),
  },
];

// ============================================================================
// 5. 主流程
// ============================================================================
function run({ asarPath, htmlPath }) {
  const lines = [];
  const { content: src, label } = readSource({ asarPath, htmlPath });

  lines.push('[SMOKE] ── 铁闸8 运行时冒烟（坏数据注入 + 用户管理链路）──');
  lines.push('[SMOKE] 目标: ' + label);

  // 5.1 提取所有副本的所有函数体
  const allBodies = {};
  let missing = [];
  for (const fn of REQUIRED_FUNCS) {
    let bodies;
    try { bodies = extractAllFunctions(src, fn); }
    catch (e) {
      lines.push('[SMOKE][FAIL] ' + fn + ' 提取异常: ' + e.message);
      return { total: 1, pass: 0, fail: 1, lines };
    }
    if (bodies.length === 0) missing.push(fn);
    allBodies[fn] = bodies;
  }
  if (missing.length) {
    lines.push('[SMOKE][FAIL] 产物中缺少关键函数: ' + missing.join(', ') + ' —— 修复代码未落位');
    return { total: 1, pass: 0, fail: 1, lines };
  }

  const copyCount = Math.max(...REQUIRED_FUNCS.map(f => allBodies[f].length));
  lines.push('[SMOKE] 提取函数副本数: ' + REQUIRED_FUNCS.map(f => f + '×' + allBodies[f].length).join(' '));

  // 5.1.1 提取 simpleEncrypt/simpleDecrypt 依赖的外部常量 PASSWORD_SALT
  const saltMatch = src.match(/const\s+PASSWORD_SALT\s*=\s*(['"])([^'"]*)\1\s*;/);
  if (!saltMatch) {
    lines.push('[SMOKE][FAIL] 产物中缺少 const PASSWORD_SALT 声明 —— 加密函数将无法运行');
    return { total: 1, pass: 0, fail: 1, lines };
  }

  // 5.2 对每一份副本 × 每个用例执行断言
  let pass = 0, fail = 0, total = 0;
  for (let copyIdx = 0; copyIdx < copyCount; copyIdx++) {
    // 提取结果已含完整函数声明头，salt 常量前置注入
    const bundle = saltMatch[0] + '\n' + REQUIRED_FUNCS
      .map(f => allBodies[f][Math.min(copyIdx, allBodies[f].length - 1)])
      .join('\n');
    const copyTag = copyCount > 1 ? ('副本#' + (copyIdx + 1) + ' ') : '';
    for (const c of CASES) {
      total++;
      const sb = makeSandbox();
      try {
        vm.createContext(sb);
        vm.runInContext(bundle, sb, { filename: 'smoke-extract.js' });
        c.setup(sb);
        const result = c.call(sb);
        const ok = Array.isArray(result) && (c.assert ? !!c.assert(result) : result.length >= 0);
        if (ok) { pass++; lines.push('[SMOKE][PASS] ' + copyTag + c.name + (Array.isArray(result) ? ' → Array(' + result.length + ')' : '')); }
        else { fail++; lines.push('[SMOKE][FAIL] ' + copyTag + c.name + ' → 返回类型 ' + Object.prototype.toString.call(result)); }
      } catch (e) {
        fail++;
        lines.push('[SMOKE][FAIL] ' + copyTag + c.name + ' → 抛错: ' + (e && e.message ? e.message : String(e)));
      }
    }
  }
  return { total, pass, fail, lines };
}

// ============================================================================
// 6. CLI 入口
// ============================================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const asarIdx = args.indexOf('--asar');
  const htmlIdx = args.indexOf('--html');
  let result;
  try {
    result = run({
      asarPath: asarIdx >= 0 ? args[asarIdx + 1] : undefined,
      htmlPath: htmlIdx >= 0 ? args[htmlIdx + 1] : undefined,
    });
  } catch (e) {
    console.error('[SMOKE][FAIL] ' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
  for (const l of result.lines) console.log(l);
  console.log('[SMOKE] 结果: ' + result.pass + '/' + result.total + ' 通过' + (result.fail ? '，失败 ' + result.fail + ' 项 !!' : ' ✓'));
  process.exit(result.fail > 0 ? 1 : 0);
}

module.exports = { run };
