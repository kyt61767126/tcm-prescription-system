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
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
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
    // utf8 读取：index.html 是 UTF-8 文件；USER-STORE 标记块含中文注释，
    // latin1 会乱码导致 extractBlock 匹配失败（JS 标识符均为 ASCII，utf8 同样安全）
    content: buf.slice(off, off + entry.size).toString('utf8'),
  };
}

// 提取 asar 内任意文件（T2：normalize-config.js 为独立文件条目，不在 index.html 内联）
function extractAsarFile(asarPath, fileName) {
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.slice(16, 16 + jsonLen).toString('utf8'));
  let found = null;
  const walk = (files) => {
    for (const [name, node] of Object.entries(files || {})) {
      if (node.files) walk(node.files);
      else if (name === fileName && node.offset !== undefined) found = node;
    }
  };
  walk(header.files);
  if (!found) return null;
  const dataStart = 8 + headerSize;
  const off = dataStart + Number(found.offset);
  return buf.slice(off, off + found.size).toString('utf8');
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

  // 5.2 执行断言 —— 双路径
  //   新路径：T3 标记块（USER-STORE）自包含（含 IIFE+薄包装），整块执行
  //   旧路径：多副本提取 + PASSWORD_SALT 前置注入（未同步标记块的产物兼容）
  const { extractBlock } = require('./sync-shared-blocks.cjs');
  const block = extractBlock(src);
  let pass = 0, fail = 0, total = 0;

  if (block) {
    lines.push('[SMOKE] 检测到 USER-STORE 标记块 → 整块执行（自包含）');
    // 存在性：块内必须有 5 个函数（含嵌套定义与包装）
    let missingFn = REQUIRED_FUNCS.filter(fn => !new RegExp('function\\s+' + fn + '\\s*\\(').test(block));
    if (missingFn.length) {
      total++; fail++;
      lines.push('[SMOKE][FAIL] 标记块缺少函数: ' + missingFn.join(', '));
    } else {
      for (const c of CASES) {
        total++;
        const sb = makeSandbox();
        try {
          vm.createContext(sb);
          vm.runInContext(block, sb, { filename: 'user-store-block.js' });
          c.setup(sb);
          const result = c.call(sb);
          const ok = Array.isArray(result) && (c.assert ? !!c.assert(result) : result.length >= 0);
          if (ok) { pass++; lines.push('[SMOKE][PASS] ' + c.name + ' → Array(' + result.length + ')'); }
          else { fail++; lines.push('[SMOKE][FAIL] ' + c.name + ' → 返回类型 ' + Object.prototype.toString.call(result)); }
        } catch (e) {
          fail++;
          lines.push('[SMOKE][FAIL] ' + c.name + ' → 抛错: ' + (e && e.message ? e.message : String(e)));
        }
      }
    }
    // 5.2b 旧路径变量占位（N/W 段继续使用同一累计器）
    const copyCount = 0, allBodies = {}, saltMatch = null;
  } else {
    // —— 旧路径：提取所有副本的所有函数体 ——
    const allBodies = {};
    const missing = [];
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

    const saltMatch = src.match(/(?:const|var)\s+PASSWORD_SALT\s*=\s*(['"])([^'"]*)\1\s*;/);
    if (!saltMatch) {
      lines.push('[SMOKE][FAIL] 产物中缺少 PASSWORD_SALT 声明 —— 加密函数将无法运行');
      return { total: 1, pass: 0, fail: 1, lines };
    }

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
  }

  // 5.3 T2 关卡测试：__normalizeIncomingConfig（入口归一化）+ 接线存在性
  let ncSrc = null;
  if (asarPath) {
    ncSrc = extractAsarFile(asarPath, 'normalize-config.js');
  } else if (htmlPath) {
    const p = require('path').join(require('path').dirname(htmlPath), 'normalize-config.js');
    if (fs.existsSync(p)) ncSrc = fs.readFileSync(p, 'utf8');
  }

  if (!ncSrc) {
    total++; fail++;
    lines.push('[SMOKE][FAIL] 产物中缺少 normalize-config.js —— T2 入口关卡未随包交付');
  } else if (ncSrc.indexOf('__normalizeIncomingConfig') < 0) {
    total++; fail++;
    lines.push('[SMOKE][FAIL] normalize-config.js 未导出 __normalizeIncomingConfig');
  } else {
    // N 用例：沙箱执行整文件，测关卡行为
    const NC_CASES = [
      ['N1 users=毒字符串 → 丢弃且不伤及其他字段', (f) => { const o = f({ users: 'garbage-len>0', clinicName: 'X' }); return o.clinicName === 'X' && !('users' in o); }],
      ['N2 users=伪数组对象 → 丢弃', (f) => { const o = f({ users: { 0: 'a', length: 1 } }); return !('users' in o); }],
      ['N3 users 含脏条目 → 过滤后保留合法项', (f) => { const o = f({ users: [{ username: 'ok' }, { bad: 1 }, { username: '' }] }); return Array.isArray(o.users) && o.users.length === 1 && o.users[0].username === 'ok'; }],
      ['N4 edition 别名归一 institution→cloud_clinic', (f) => f({ edition: 'institution' }).edition === 'cloud_clinic'],
      ['N5 edition 别名归一 standard→personal', (f) => f({ edition: 'standard' }).edition === 'personal'],
      ['N6 cfg 非对象 → {}', (f) => Object.keys(f(null)).length === 0 && Object.keys(f('str')).length === 0],
      ['N7 maxUsers 非数字 → 丢弃', (f) => { const o = f({ maxUsers: '5' }); return !('maxUsers' in o); }],
      ['N8 合法 users 原样透传', (f) => { const u = [{ username: 'a', password: 'p', role: 'admin' }]; const o = f({ users: u }); return Array.isArray(o.users) && o.users.length === 1 && o.users[0].role === 'admin'; }],
    ];
    const sb = makeSandbox();
    try {
      vm.createContext(sb);
      vm.runInContext(ncSrc, sb, { filename: 'normalize-config.js' });
      const fn = sb.__normalizeIncomingConfig;
      if (typeof fn !== 'function') throw new Error('__normalizeIncomingConfig 未挂到全局');
      for (const [nm, chk] of NC_CASES) {
        total++;
        let ok = false;
        try { ok = !!chk(fn); } catch (e) { lines.push('[SMOKE][FAIL] ' + nm + ' → 抛错: ' + e.message); fail++; continue; }
        if (ok) { pass++; lines.push('[SMOKE][PASS] ' + nm); }
        else { fail++; lines.push('[SMOKE][FAIL] ' + nm + ' → 行为不符合契约'); }
      }
    } catch (e) {
      total++; fail++;
      lines.push('[SMOKE][FAIL] normalize-config.js 沙箱执行异常: ' + e.message);
    }
  }

  // W 接线检查：index.html 必须真正调用关卡且无旁路弱写入
  const W_CHECKS = [
    ['W1 index.html 已调用 __normalizeIncomingConfig', src.includes('__normalizeIncomingConfig(cfg')],
    ['W2 index.html 已加载 normalize-config.js 标签', src.includes('normalize-config.js')],
    ['W3 无旁路弱写入 if (cfg.users) CONFIG.users', !src.includes('if (cfg.users) CONFIG.users')],
  ];
  for (const [nm, ok] of W_CHECKS) {
    total++;
    if (ok) { pass++; lines.push('[SMOKE][PASS] ' + nm); }
    else { fail++; lines.push('[SMOKE][FAIL] ' + nm); }
  }

  // S 区块：症状词典（symptom-dict.js）冒烟 —— 2026-08-21 舌脉快捷录入
  //   asar 模式取包内文件；html 模式取同目录文件；任一表面缺失即红线。
  let sdSrc = null;
  let sdTemplateSurface = false;
  if (asarPath) {
    try { sdSrc = extractAsarFile(asarPath, 'symptom-dict.js'); } catch (e) { sdSrc = null; }
  } else if (htmlPath) {
    const dir = path.dirname(htmlPath);
    const sdPath = path.join(dir, 'symptom-dict.js');
    if (fs.existsSync(sdPath)) {
      sdSrc = fs.readFileSync(sdPath, 'utf8');
    } else if (!fs.existsSync(path.join(dir, 'medicine-dict.js'))) {
      // 源模板/母版表面（如根 index.html、index-app.html）：同目录连 medicine-dict.js 都没有，
      // 词典文件由 sync-all.ps1 分发到真实产物目录（desktop/ public/ APP assets），并非本目录交付。
      // 随包交付硬校验由 asar 产物闸门（asarPath 模式）承担；此表面降级为 SKIP，宁可漏检不可误报。
      sdTemplateSurface = true;
    }
  }

  // S8 接线：index.html 必须加载词典
  total++;
  if (src.includes('symptom-dict.js')) { pass++; lines.push('[SMOKE][PASS] S8 index.html 已加载 symptom-dict.js 标签'); }
  else { fail++; lines.push('[SMOKE][FAIL] S8 index.html 缺 symptom-dict.js 标签 —— 舌脉快捷录入未接线'); }

  if (!sdSrc) {
    if (!sdTemplateSurface) {
      total++; fail++;
      lines.push('[SMOKE][FAIL] S1 产物中缺少 symptom-dict.js —— 舌脉词典未随包交付');
    } else {
      // 源模板/母版表面：允许 SKIP（不参与 fail 统计），随包交付由 asar 闸门保证
      lines.push('[SMOKE][SKIP] S1 源模板表面跳过 symptom-dict 存在性（产物目录分发，随包由 asar 闸门校验）');
    }
  } else {
    // 专用沙箱：无 DOM 环境（querySelector/getElementById 均返回 null，组件走安全重试路径）
    const elStub = () => ({ style: {}, addEventListener() {}, appendChild() {}, innerHTML: '' });
    const sb2 = Object.assign(makeSandbox(), {
      document: {
        readyState: 'complete',
        addEventListener() {},
        getElementById() { return elStub(); },
        querySelector() { return null; },          // 按钮/面板注入走重试分支（setTimeout stub 为 no-op）
        createElement() { return elStub(); },
        head: { appendChild() {} },
        body: { appendChild() {} },
      },
      setTimeout() { return 0; },
      clearTimeout() {},
      confirm() { return true; },
      alert() {},
    });
    sb2.window = sb2;
    sb2.globalThis = sb2;
    // 频次毒数据：JSON 解析失败必须被 try/catch 吞掉（宁漏检不可误报原则）
    sb2.__storage['symptom_freq_v1'] = 'garbage{not-json';

    let SD = null, DICT = null, loadErr = null;
    try {
      vm.createContext(sb2);
      vm.runInContext(sdSrc, sb2, { filename: 'symptom-dict.js' });
      SD = sb2.SymptomDict; DICT = sb2.SYMPTOM_DICT;
    } catch (e) { loadErr = e; }

    const termCount = (DICT && Array.isArray(DICT.categories))
      ? DICT.categories.reduce((s, c) => s + (c.terms || []).length, 0) : -1;
    const S_CASES = [
      ['S1 词典结构：6分类/词条80~130（实际' + termCount + '）', !loadErr && !!DICT && Array.isArray(DICT.categories) && DICT.categories.length === 6 && termCount >= 80 && termCount <= 130],
      ['S2 简码前缀搜索 mx→脉弦', !loadErr && !!SD && (() => { const r = SD.search('mx'); return Array.isArray(r) && r.some(x => x.text === '脉弦'); })()],
      ['S3 空搜索→空数组', !loadErr && !!SD && Array.isArray(SD.search('')) && SD.search('').length === 0],
      ['S4 拼接跨分类用逗号', !loadErr && !!SD && SD.assembleText([{ text: '舌淡红', cat: 'tz' }, { text: '苔薄白', cat: 'tai' }, { text: '脉弦', cat: 'mai' }]) === '舌淡红，苔薄白，脉弦'],
      ['S5 拼接同分类用顿号', !loadErr && !!SD && SD.assembleText([{ text: '舌红', cat: 'tz' }, { text: '舌有瘀斑', cat: 'tz' }]) === '舌红、舌有瘀斑'],
      ['S6 模板追加语义+order=0 falsy 排序回归', !loadErr && !!SD && SD.assembleText([{ text: '恶寒发热', cat: 'wd' }, { text: '舌淡红，苔薄白，脉弦', cat: 'zh' }]) === '舌淡红，苔薄白，脉弦，恶寒发热'],
      ['S7 毒频次数据+无DOM环境下加载不抛错', !loadErr],
    ];
    for (const [nm, ok] of S_CASES) {
      total++;
      if (ok) { pass++; lines.push('[SMOKE][PASS] ' + nm); }
      else { fail++; lines.push('[SMOKE][FAIL] ' + nm + (loadErr ? ' → 加载抛错: ' + loadErr.message : '')); }
    }
  }

  return { total, pass, fail, lines };
}

// ============================================================================
// 5.5 --all 模式（P2 · 2026-08-21）：循环全部 7 表面 + login 旁路
//   复用 sync-shared-blocks.cjs 的 HTML_FILES 单一清单（新增表面只改一处）。
//   任一表面 fail > 0 → 聚合 fail，构建红线阻断。
// ============================================================================
function runAll() {
  const lines = [];
  let pass = 0, fail = 0, total = 0;
  const HTML_FILES = require('./sync-shared-blocks.cjs').HTML_FILES;
  for (const rel of HTML_FILES) {
    const abs = path.join(ROOT, rel);
    lines.push('');
    lines.push('[SMOKE-ALL] ── 表面: ' + rel + ' ──');
    let r;
    try {
      r = run({ htmlPath: abs });
    } catch (e) {
      total++;
      fail++;
      lines.push('[SMOKE][FAIL] 表面执行异常: ' + (e && e.message ? e.message : String(e)));
      continue;
    }
    total += r.total; pass += r.pass; fail += r.fail;
    // 只打印 FAIL 行与汇总，避免 7×18 行刷屏
    for (const l of r.lines) if (l.indexOf('[FAIL]') >= 0) lines.push(l);
    lines.push('[SMOKE-ALL] ' + rel + ' → ' + r.pass + '/' + r.total + (r.fail ? ' !!FAIL!!' : ' ✓'));
  }
  // login 旁路检测一并聚合（构建时 final-verify 8b 也单独跑，这里保证 --all 单独可用时全覆盖）
  const lb = checkLoginBypass();
  total += lb.total; pass += lb.pass; fail += lb.fail;
  for (const l of lb.lines) if (l.indexOf('[FAIL]') >= 0) lines.push(l);
  lines.push('[SMOKE-ALL] login-bypass → ' + lb.pass + '/' + lb.total + (lb.fail ? ' !!FAIL!!' : ' ✓'));
  return { total, pass, fail, lines };
}

// ============================================================================
// 6. CLI 入口
// ============================================================================
// ★ P1（2026-08-21）--login 模式：登录窗口旁路检测。
//   login.js 历史上独立实现 XORv1 加解密直读 local_systemUsers（绕过 UserStore
//   权威源）。P1 已改为优先委托 window.UserStore；此检测防止任何人再把委托
//   删掉回到旁路状态。两份 login.js（云端/离线桌面）+ 对应 login.html 全查。
function checkLoginBypass() {
  const lines = [];
  let pass = 0, fail = 0, total = 0;
  const PAIRS = [
    ['app_project/db-yunduan/cloud_desktop/electron', '云端桌面'],
    ['app_project/db-offline/desktop/electron', '离线桌面'],
  ];
  for (const [dir, label] of PAIRS) {
    const jsPath = path.join(ROOT, dir, 'login.js');
    const htmlPath = path.join(ROOT, dir, 'login.html');
    const usPath = path.join(ROOT, dir, 'user-store.js');
    let js = '', html = '';
    try { js = fs.readFileSync(jsPath, 'utf8'); } catch (e) { js = ''; }
    try { html = fs.readFileSync(htmlPath, 'utf8'); } catch (e) { html = ''; }
    const checks = [
      ['L1 ' + label + ' login.js simpleDecrypt 委托 UserStore', js.includes('window.UserStore.simpleDecrypt')],
      ['L2 ' + label + ' login.js simpleEncrypt 委托 UserStore', js.includes('window.UserStore.simpleEncrypt')],
      ['L3 ' + label + ' login.html 已加载 user-store.js', html.includes('user-store.js')],
      ['L4 ' + label + ' electron/user-store.js 文件存在', fs.existsSync(usPath)],
    ];
    for (const [nm, ok] of checks) {
      total++;
      if (ok) { pass++; lines.push('[SMOKE][PASS] ' + nm); }
      else { fail++; lines.push('[SMOKE][FAIL] ' + nm); }
    }
  }
  return { total, pass, fail, lines };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const asarIdx = args.indexOf('--asar');
  const htmlIdx = args.indexOf('--html');
  let result;
  try {
    if (args.includes('--all')) {
      result = runAll();
    } else if (args.includes('--login')) {
      result = checkLoginBypass();
    } else {
      result = run({
        asarPath: asarIdx >= 0 ? args[asarIdx + 1] : undefined,
        htmlPath: htmlIdx >= 0 ? args[htmlIdx + 1] : undefined,
      });
    }
  } catch (e) {
    console.error('[SMOKE][FAIL] ' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
  for (const l of result.lines) console.log(l);
  console.log('[SMOKE] 结果: ' + result.pass + '/' + result.total + ' 通过' + (result.fail ? '，失败 ' + result.fail + ' 项 !!' : ' ✓'));
  process.exit(result.fail > 0 ? 1 : 0);
}

module.exports = { run, checkLoginBypass, runAll };
