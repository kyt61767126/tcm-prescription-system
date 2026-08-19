// ============================================================================
//  audit-cross-scope.js — 跨作用域/跨文件函数调用审计（预防性检查）
//
//  背景（2026-08-19 教训）：
//  云端登录报 "setCloudActivationDone is not defined"。根因是 auth-core.js 由
//  多个 IIFE 组成，登录成功路径在 IIFE-A，而 setCloudActivationDone 定义在
//  IIFE-B 且未挂载到 global，IIFE-A 内裸调用跨作用域 → 运行时报错。
//  该类错误无法被语法检查(node --check)发现，必须做跨作用域静态审计。
//
//  本工具检查两类风险：
//    R1 跨 IIFE 裸调用：函数定义在某 IIFE，却在另一个 IIFE 内裸调用
//        （未通过 global/window 挂载访问）
//    R2 内联脚本调用未挂载函数：index.html 等内联 <script> 调用的自定义函数
//        若未在任何外部 JS 挂载到 window/global，则可能 is not defined
//
//  用法：
//    node tools/audit-cross-scope.js [--files a.js,b.js] [--inline html]
//    默认扫描 public/auth-core.js, public/permission.js 及 inline=public/index.html
//    退出码：0=无风险 / 1=发现风险
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 内置/语言/常见 API 白名单（排除误报）
const BUILTIN = new Set(`
if for while return function catch typeof new require JSON Math Object Array String
Number Boolean BigInt Symbol Promise RegExp Error TypeError RangeError ReferenceError
SyntaxError EvalError URIError console Date fetch parseInt parseFloat encodeURIComponent
decodeURIComponent setTimeout setInterval clearTimeout clearInterval parse stringify
keys values entries globalThis window document location navigator sessionStorage localStorage
alert confirm prompt encodeURI decodeURI isNaN isFinite crypto getRandomValues randomUUID
Infinity NaN undefined null true false this arguments
querySelector querySelectorAll getElementById addEventListener removeEventListener
innerText textContent value classList style focus blur preventDefault stopPropagation
push splice map filter reduce forEach find some every includes indexOf slice join concat
split trim charAt charCodeAt toLowerCase toUpperCase toString replace test exec match
add remove toggle setAttribute getAttribute removeAttribute appendChild removeChild
createElement createTextNode insertBefore cloneNode parentNode children firstChild
lastChild nextSibling previousSibling body head sheet cssText scrollIntoView
getBoundingClientRect offsetHeight offsetWidth clientHeight clientWidth
hash pathname search reload replace open close print
requestAnimationFrame cancelAnimationFrame atob btoa
resolve reject then catch finally async await constructor prototype call apply bind
new Map Set WeakMap WeakSet Proxy Reflect from get set has delete clear
round floor ceil abs min max sqrt pow random hypot sign
beginPath closePath moveTo lineTo arc fill stroke strokeRect fillRect clearRect
fillText measureText createLinearGradient createRadialGradient createPattern
translate rotate scale setLineDash getContext toDataURL addColorStop
Blob FileReader FileList FormData XMLHttpRequest TextEncoder TextDecoder URL
atob btoa localStorage sessionStorage indexedDB IDBRequest IDBTransaction IDBCursor
getItem setItem removeItem clear key length
readAsArrayBuffer readAsText readAsDataURL readAsBinaryString createObjectURL revokeObjectURL
innerHTML outerHTML insertAdjacentHTML matches closest
getComputedStyle getBoundingClientRect requestFullscreen exitFullscreen
scrollTo scrollBy scrollIntoView offsetTop offsetLeft
getFullYear getMonth getDate getHours getMinutes getSeconds getMilliseconds getDay
getTime toISOString toJSON toDateString toLocaleDateString toLocaleString toLocaleTimeString
padStart padEnd startsWith endsWith substring substr charAt localeCompare
toFixed toPrecision toExponential fromCharCode fromCodePoint at
isArray isInteger isFinite isNaN
font fullwidth fwFont hwFont normal weight width size
Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array
Float32Array Float64Array ArrayBuffer DataView escape unescape switch
backgroundColor color border margin padding display none block flex grid inline
functionHeaderStr arrowStr assign getOwnPropertyNames defineProperty freeze seal preventExtensions
copyWithin fill reverse sort every some filter map forEach reduce reduceRight
find findIndex flat flatMap lastIndexOf includes indexOf join keys values entries
toString valueOf hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString
`.split(/\s+/).filter(Boolean));

// 平台桥接对象（由原生 WebView/JSBridge/Capacitor 注入，前端 JS 不定义但合法）
const PLATFORM = new Set(`
APP AndroidNative AndroidAppExit Capacitor AndroidBridge JSBridge bridge
WebViewJavascriptBridge bnzc Cordova Ionic StatusBar SplashScreen
`.split(/\s+/).filter(Boolean));

// 已知无害函数名（CSS 内联字符串/选择器/模板里的词、注释文本，或已有 typeof 防御的调用，非真实缺失）
const IGNORE = new Set(`
child repeat rgba translateY term order totalPos query valueOf appendSync
savePrescriptionHistory renderPrescriptionHistory updateStats
`.split(/\s+/).filter(Boolean));

// 去掉字符串字面量（单/双引号、模板字符串），避免 CSS 等字符串内容被误认为函数调用
// ★ 2026-08-20 说明：朴素逐字符剥离对含 ${} 嵌套的模板字符串不可靠，已被禁用以避免误伤内部函数定义；
//   现改由 IGNORE 白名单定向清理 CSS/template 高频误报词。此处保留函数但未在审计链路调用，供后续参考。

function parseArgs(argv) {
  const args = { files: [], inline: [], dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files' && argv[i + 1]) { args.files = argv[++i].split(',').filter(Boolean); }
    else if (a === '--inline' && argv[i + 1]) { args.inline = argv[++i].split(',').filter(Boolean); }
    else if (a === '--dir' && argv[i + 1]) { args.dir = argv[++i]; }
    else if (!a.startsWith('--')) { args.files.push(a); }
  }
  if (!args.files.length) {
    args.files = [
      'public/auth-core.js',
      'public/permission.js',
      'shared/auth-core/cloud.js',
      'shared/auth-core/offline.js',
    ];
  }
  if (!args.inline.length) {
    args.inline = ['public/index.html'];
  }
  return args;
}

// 递归收集目录下所有 .js 文件（供挂载清单收集）
function collectJsInDir(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) out.push(p);
    }
  };
  walk(path.resolve(ROOT, dir));
  return out;
}

// 收集文件里所有 IIFE 区间
function iifeRanges(src) {
  const starts = [], ends = [];
  src.split('\n').forEach((l, i) => {
    if (/^\(function\s*\(global\)\s*\{/.test(l)) starts.push(i + 1);
    if (/^\}\)\((typeof|window)/.test(l.trimStart())) ends.push(i + 1);
  });
  const ranges = [];
  for (const s of starts) {
    const e = ends.find(x => x > s) || Infinity;
    ranges.push([s, e]);
  }
  return ranges;
}

// 检查 R1：跨 IIFE 裸调用
function auditCrossIife(name, src) {
  const ranges = iifeRanges(src);
  if (ranges.length < 2) return []; // 单 IIFE 无跨块风险
  const fnDefs = new Map(); // name -> line
  const defRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = defRe.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    if (!fnDefs.has(m[1])) fnDefs.set(m[1], line);
  }
  const mounted = new Set();
  const mountRe = /(?:window|global)\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = mountRe.exec(src))) mounted.add(m[1]);
  const issues = [];
  for (const [fn, defLine] of fnDefs) {
    if (mounted.has(fn) || BUILTIN.has(fn)) continue;
    const defRange = ranges.find(r => defLine >= r[0] && defLine <= r[1]);
    if (!defRange) continue;
    // 排除成员方法调用（obj.method( 前有 .），只查真正的裸调用
    const callRe = new RegExp('(?<![.\\w$])\\b' + fn.replace(/[$]/g, '\\$&') + '\\s*\\(', 'g');
    let mm;
    while ((mm = callRe.exec(src))) {
      const callLine = src.slice(0, mm.index).split('\n').length;
      if (callLine === defLine) continue;
      const r = ranges.find(r2 => callLine >= r2[0] && callLine <= r2[1]);
      if (r && defRange && r[0] !== defRange[0]) {
        issues.push(`${name}:${callLine} 跨IIFE裸调用 ${fn}(  (定义于 ${name}:${defLine}, 块IIFE[${defRange}] → 调用块IIFE[${r}])`);
      }
    }
  }
  return issues;
}

// 检查 R2：内联脚本调用未挂载的自定义函数
// jsSrcs: 扫描目录下所有外部 JS 源码（用于收集挂载清单）
function auditInline(htmlPath, allJsSrcs) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const blocks = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) blocks.push(m[1]);
  if (!blocks.length) return [];
  // 只留内联 <script> 内容拼合；（<style> 等 CSS 内容不属于 JS，不参与检测）
  const inlineSrc = blocks.join('\n');

  const mounted = new Set();
  for (const js of allJsSrcs) {
    const mountRe = /(?:window|global)\.([A-Za-z_$][\w$]*)\s*=|window\['([^']+)'\]\s*=/g;
    let mm;
    while ((mm = mountRe.exec(js))) mounted.add(mm[1] || mm[2]);
  }
  // 内联脚本自身定义的函数（function xxx(){}、const/let/var xxx = ...、{ xxx(){} } 方法、window.xxx=function）
  // 视为已定义，避免把"同一脚本内互相调用"误报为跨文件风险
  const inlineDef = new Set();
  const defRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let dm;
  while ((dm = defRe.exec(inlineSrc))) inlineDef.add(dm[1]);
  const assignRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((dm = assignRe.exec(inlineSrc))) inlineDef.add(dm[1]);
  const methodRe = /\b([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{|,\s*([A-Za-z_$][\w$]*)\s*\(/g;
  while ((dm = methodRe.exec(inlineSrc))) { if (dm[1]) inlineDef.add(dm[1]); if (dm[2]) inlineDef.add(dm[2]); }
  const wAssignRe = /(?:window|global)\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\(\)\s*=>)/g;
  while ((dm = wAssignRe.exec(inlineSrc))) inlineDef.add(dm[1]);
  // 排除成员方法调用（obj.method( 前有 . 或 ?. ），只查真正的裸调用
  const callRe = /\b(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  const called = new Set();
  let cm;
  while ((cm = callRe.exec(inlineSrc))) called.add(cm[1]);

  const missing = [...called].filter(n =>
    !mounted.has(n) && !inlineDef.has(n) && !BUILTIN.has(n) && !PLATFORM.has(n) && !IGNORE.has(n)
    && !/^[A-Z]$/.test(n) && !/^__\w+__$/.test(n)
  ).sort();
  return missing.map(n => `${htmlPath} 内联脚本调用 ${n}( 但外部JS未挂载、内联自身也未定义`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const jsSrcs = [];
  const allIssues = [];

  for (const f of args.files) {
    const p = path.resolve(ROOT, f);
    if (!fs.existsSync(p)) { console.error(`[SKIP] 文件不存在: ${f}`); continue; }
    const src = fs.readFileSync(p, 'utf8');
    jsSrcs.push(src);
    const issues = auditCrossIife(f, src);
    allIssues.push(...issues);
  }

  // 挂载清单收集：扫描 --dir 下所有 JS（默认 public/），含未显式列入 files 的模块
  let allJsSrcs = jsSrcs.slice();
  if (args.dir) {
    for (const p of collectJsInDir(args.dir)) {
      allJsSrcs.push(fs.readFileSync(p, 'utf8'));
    }
  }

  for (const h of args.inline) {
    const p = path.resolve(ROOT, h);
    if (!fs.existsSync(p)) { console.error(`[SKIP] HTML不存在: ${h}`); continue; }
    const issues = auditInline(p, allJsSrcs);
    allIssues.push(...issues);
  }

  if (allIssues.length) {
    console.log('[AUDIT] 发现跨作用域/跨文件调用风险:');
    allIssues.forEach(i => console.log('  ⚠ ' + i));
    console.log(`\n[AUDIT] 共 ${allIssues.length} 处风险（可结合人工判断，含部分误报）。`);
    process.exit(1);
  } else {
    console.log('[AUDIT] OK — 未发现跨 IIFE 裸调用 / 内联未挂载调用风险。');
    process.exit(0);
  }
}

main();
