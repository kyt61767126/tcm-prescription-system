// 同步 2.36 唯一管理员模式过滤到离线系 4 副本（云端3副本已有，此为漏同步缺口）
const fs = require('fs');

const FILES = [
    'app_project/db-offline/desktop/index.html',
    'index.html',
    'app_project/db-offline/index-app.html',
    'app_project/db-offline/app/app/src/main/assets/public/index.html'
];

const OLD = `        function renderUserList() {
            try {
                const users = getUsers();`;

const NEW = `        function renderUserList() {
            try {
                // ★ 2026-08-22 补同步 KNOWLEDGE 2.36 唯一管理员模式：隐藏内置默认 admin
                //   （username=admin 且密码=出厂哈希）。激活后激活者=唯一管理员，内置 admin
                //   已被试用期降级为 user，其姓名"管理员"易与角色标签混淆（实测用户误读
                //   "2个管理员"）。云端3副本（public/cloud_desktop/cloud_app）已有此过滤。
                const users = getUsers().filter(u => !isBuiltinDefaultAdmin(u));`;

let fail = 0;
for (const f of FILES) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); }
    catch (e) { console.log('[MISS] ' + f); fail++; continue; }

    if (s.includes('getUsers().filter(u => !isBuiltinDefaultAdmin(u))')) {
        console.log('[SKIP-ALREADY] ' + f); continue;
    }

    // 前置条件：isBuiltinDefaultAdmin 必须已定义（USER-STORE 标记块）
    if (!/function isBuiltinDefaultAdmin/.test(s)) {
        console.log('[SKIP-NO-FN] ' + f + ' — 缺 isBuiltinDefaultAdmin 定义'); fail++; continue;
    }

    const c = s.split(OLD).length - 1;
    if (c !== 1) { console.log('[SKIP] ' + f + ' (renderUserList 模式命中=' + c + ')'); fail++; continue; }

    fs.writeFileSync(f, s.replace(OLD, NEW), 'utf8');
    console.log('[OK]   ' + f);
}

if (fail) { console.log('FAILED: ' + fail); process.exit(1); }
console.log('ALL 4 SYNCED');
