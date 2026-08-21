// ============================================================================
// sync-shared-blocks.cjs — 权威源 → 各 index.html 标记块 同步/校验工具（T3）
//
// 用法：
//   node tools/sync-shared-blocks.cjs            # 同步：删旧散落实现 + 注入标记块
//   node tools/sync-shared-blocks.cjs --check    # 仅校验（copy-consistency 调用，漂移即非0）
//
// 标记块结构（内联在 index.html 中，非 <script src>）：
//   // >>> USER-STORE ... ===
//   <shared/user-store.js 权威内容 verbatim>
//   <5 个薄包装函数：getDefaultUsers/getUsers/saveUsers/simpleEncrypt/simpleDecrypt>
//   // <<< USER-STORE-END ===
//
// 同步动作（幂等）：
//   1. 删除散落的 5 个旧函数定义（字符串感知括号扫描，防注释/字符串误删）
//   2. 在 `const PASSWORD_SALT` 声明行后插入标记块（hashPassword/computeBackupHmac
//      仍引用该顶层常量，声明保留在块外）
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const AUTHORITY = path.join(ROOT, 'shared', 'user-store.js');

const HTML_FILES = [
    'app_project/db-yunduan/cloud_desktop/index.html',
    'app_project/db-offline/desktop/index.html',
    'index.html',
    'public/index.html',
    'app_project/db-offline/index-app.html',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html',
    'app_project/db-offline/app/app/src/main/assets/public/index.html'
];

const BLOCK_BEGIN = '        // >>> USER-STORE (generated from shared/user-store.js via tools/sync-shared-blocks.cjs — 修改权威源后运行同步，勿手改此处) ===';
const BLOCK_END = '        // <<< USER-STORE-END ===';

const WRAPPERS = [
    '        // ── 兼容薄包装：20+ 处既有调用点签名零变化 ──',
    '        function getDefaultUsers() { return UserStore.getDefaultUsers(); }',
    '        function getUsers() { return UserStore.get(); }',
    '        function saveUsers(users) { return UserStore.save(users); }',
    '        function simpleEncrypt(text) { return UserStore.simpleEncrypt(text); }',
    '        function simpleDecrypt(stored) { return UserStore.simpleDecrypt(stored); }',
].join('\n');

// 旧散落函数名（整段删除目标；不含 PASSWORD_SALT 常量本身）
const OLD_FUNCS = ['getDefaultUsers', 'simpleEncrypt', 'simpleDecrypt', 'getUsers', 'saveUsers'];

// —— 字符串感知的函数整段提取/删除（与 smoke-runtime 同款算法）——
function findFunctionSpan(src, name) {
    const headRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    const spans = [];
    let m;
    while ((m = headRe.exec(src)) !== null) {
        let i = src.indexOf('{', m.index);
        let depth = 0, closed = false;
        while (i < src.length) {
            const c = src[i];
            if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
            if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; } i++; continue; }
            if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
            if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { closed = true; break; }
            }
            i++;
        }
        if (!closed) throw new Error('函数 ' + name + ' 括号不平衡 @' + m.index);
        // 扩展到行首缩进与行尾换行
        let start = m.index;
        while (start > 0 && src[start - 1] === ' ') start--;
        let end = i + 1;
        if (src[end] === '\r') end++;
        if (src[end] === '\n') end++;
        spans.push([start, end]);
    }
    return spans;
}

function buildBlock(authoritySrc) {
    return [BLOCK_BEGIN, authoritySrc.trimEnd(), WRAPPERS, BLOCK_END].join('\n');
}

function extractBlock(html) {
    // 用「行首注释形式」的 ASCII 锚点定位真标记行：
    //   权威源文档注释中也出现过锚点文字（括号内说明），裸 indexOf 会误匹配导致块截断
    const bTag = '\n        // >>> USER-STORE';
    const eTag = '\n        // <<< USER-STORE-END';
    const b = html.indexOf(bTag);
    if (b < 0) return null;
    const e = html.indexOf(eTag, b);
    if (e < 0) return null;
    const eEnd = html.indexOf('\n', e + 1);
    return html.substring(b + 1, eEnd < 0 ? html.length : eEnd);
}

function syncFile(rel, authoritySrc, checkOnly) {
    const abs = path.join(ROOT, rel);
    let html = fs.readFileSync(abs, 'utf8');
    const label = path.basename(path.dirname(abs)) + '/' + path.basename(abs);

    // 已有标记块：校验或刷新
    const existing = extractBlock(html);
    if (existing) {
        const want = buildBlock(authoritySrc);
        if (existing === want) { console.log('[OK]   ' + rel + ' 已是最新'); return true; }
        if (checkOnly) { console.log('[FAIL] ' + rel + ' 标记块与权威源不一致（漂移）'); return false; }
        html = html.replace(existing, want);
        fs.writeFileSync(abs, html, 'utf8');
        console.log('[SYNC] ' + rel + ' 标记块已刷新');
        return true;
    }

    if (checkOnly) { console.log('[FAIL] ' + rel + ' 缺少 USER-STORE 标记块'); return false; }

    // 首次注入：删旧散落实现 + 在 PASSWORD_SALT 后插块
    for (const fn of OLD_FUNCS) {
        const spans = findFunctionSpan(html, fn);
        if (spans.length === 0) { console.log('[FAIL] ' + rel + ' 未找到旧函数 ' + fn); return false; }
        if (spans.length > 1) { console.log('[FAIL] ' + rel + ' ' + fn + ' 出现 ' + spans.length + ' 次，需人工处理'); return false; }
        html = html.substring(0, spans[0][0]) + html.substring(spans[0][1]);
    }
    const saltAnchor = /const PASSWORD_SALT = 'bnzc_prescription_salt_v1';[^\n]*\n/;
    const m = html.match(saltAnchor);
    if (!m) { console.log('[FAIL] ' + rel + ' 未找到 PASSWORD_SALT 锚点'); return false; }
    const at = html.indexOf(m[0]) + m[0].length;
    html = html.substring(0, at) + '\n' + buildBlock(authoritySrc) + '\n' + html.substring(at);
    fs.writeFileSync(abs, html, 'utf8');
    console.log('[SYNC] ' + rel + ' 旧实现已删 + 标记块已注入');
    return true;
}

module.exports = {
    buildBlock,
    extractBlock,
    HTML_FILES,
    blockHash(authoritySrc) { return crypto.createHash('sha256').update(buildBlock(authoritySrc)).digest('hex'); },
    run(checkOnly) {
        const authoritySrc = fs.readFileSync(AUTHORITY, 'utf8');
        let ok = true;
        for (const f of HTML_FILES) {
            try { if (!syncFile(f, authoritySrc, checkOnly)) ok = false; }
            catch (e) { console.log('[FAIL] ' + f + ' 异常: ' + e.message); ok = false; }
        }
        return ok;
    }
};

if (require.main === module) {
    const checkOnly = process.argv.includes('--check');
    const ok = module.exports.run(checkOnly);
    console.log(checkOnly ? (ok ? '[PASS] 标记块一致性 ALL PASS' : '[FAIL] 标记块存在漂移') : (ok ? '[DONE] 同步完成' : '[FAIL] 同步有失败项'));
    process.exit(ok ? 0 : 1);
}
