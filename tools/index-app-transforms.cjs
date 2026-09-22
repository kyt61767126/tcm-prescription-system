#!/usr/bin/env node
// ============================================================================
//  index-app-transforms.cjs —— 离线APP index.html 变换表（P1-B1 收口核心）
//
//  作用：定义「离线桌面权威源 → index-app.html」的 34 条有序字面替换规则。
//  维护规则（KNOWLEDGE §2，防呆铁律）：
//    1. 禁止直接改 index-app.html / assets 副本——只改桌面权威源 + 本表；
//       改完运行 node tools/sync-index-app.cjs 重新生成。
//    2. find/replace 一律字面子串（内容含正则元字符/反引号，禁用正则）；
//       每条必须满足 mustReplaceOnce（在权威源应用序中恰好命中 1 次），
//       失配由生成器大声失败（exit 1）。
//    3. 锚点禁止落入 >>> USER-STORE / USER-ADMIN <<< 标记块（该块由
//       sync-shared-blocks.cjs 单独管理，工作流顺序 = 先 sync-shared-blocks
//       再跑生成器）。
//    4. T22（escapeJs 吞参欠债条目）已于 B2 删除——ID 永不复用，保持
//       追溯；删除后桌面权威源的修复随生成流自动灌入 index-app。
//
//  来源：tools/_tmp/extract-transforms.cjs 半自动提取 + 人工审定（desc），
//  首次生成已通过字节级复刻验收（cur === index-app.html 逐字节一致）。
// ============================================================================
'use strict';

module.exports = [
  {
    id: "T01",
    desc: "登录头渐变：桌面 var(--login-accent) 主题变量 → APP 固定色 #667eea（Android WebView 偶发不支持 CSS 变量兜底）",
    find: "var(--login-accent) 0%, #764ba2 100%);\n            --login-header-gradient: linear-gradient(135deg, var(--login-accent)",
    replace: "#667eea 0%, #764ba2 100%);\n            --login-header-gradient: linear-gradient(135deg, #667eea",
  },
  {
    id: "T02",
    desc: "登录按钮渐变：var(--login-accent) → #664ba2（同 T01 动机）",
    find: "            --login-btn-gradient: linear-gradient(135deg, var(--login-accent) 0%, #764ba2 100%);",
    replace: "            --login-btn-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);",
  },
  {
    id: "T03",
    desc: ".login-field 布局：桌面行内双栏（label 左）→ APP 竖排两行（label 上、输入框下占满整行）——APP 竖屏窄屏适配",
    find: "8px; display: flex; flex-direction: row; align-items: center; gap: 6px; }\n        .login-field label { width: 36px; font-size: 12px; font-weight: bold; color: #555; text-align: righ",
    replace: "6px; display: flex; flex-direction: column; align-items: stretch; gap: 5px; }\n        /* ★ 2026-08-28 APP 统一：登录字段分2行显示（label 第一行、输入框第二行整行） */\n        .login-field label { font-size: 12px; line-height: 1.2; font-weight: bold; color: #555; text-align: lef",
  },
  {
    id: "T04",
    desc: ".username-dropdown-btn 补 overflow: visible（为 ▼(N) 按钮文本外显让位）",
    find: "        .username-dropdown-btn { position: absolute; right: 0; top: 0; bottom: 0; width: 27px; padding: 0; border: 2px solid #e0e0e0; border-left: none; border-radius: 0 8px 8px 0; background: linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%); color: #666; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: all 0.2s; }",
    replace: "        .username-dropdown-btn { position: absolute; right: 0; top: 0; bottom: 0; width: 27px; padding: 0; border: 2px solid #e0e0e0; border-left: none; border-radius: 0 8px 8px 0; background: linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%); color: #666; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: all 0.2s; overflow: visible; }",
  },
  {
    id: "T05",
    desc: "注释：废除 .username-dropdown-count 外飘胶囊（(N) 显示在输入框外）",
    find: "        .username-dropdown-btn:hover { background: linear-gradient(135deg, #e8e8e8 0%, #d0d0d0 100%); }\n        .username-dropdown-menu { position: absolute; z-index: 100; display: none; background: white; border: 2px solid var(--login-accent); border-radius: 8px; top: calc(100% + 4px); left: 0; right: 0; box-shadow: 0 8px 20px rgba(102, 126, 234, 0.25); max-height: 150px; overflow-y: auto; }",
    replace: "        .username-dropdown-btn:hover { background: linear-gradient(135deg, #e8e8e8 0%, #d0d0d0 100%); }\n        /* ★ 2026-08-29 废除 .username-dropdown-count 外飘胶囊（(N) 显示在输入框外），▼(N) 统一为按钮文本 */\n        .username-dropdown-menu { position: absolute; z-index: 100; display: none; background: white; border: 2px solid var(--login-accent); border-radius: 8px; top: calc(100% + 4px); left: 0; right: 0; box-shadow: 0 8px 20px rgba(102, 126, 234, 0.25); max-height: 150px; overflow-y: auto; }",
  },
  {
    id: "T06",
    desc: "360px 媒体查询内新增价格行紧凑样式（剂数/每剂/药费/诊疗/总计 单行 gap 3px、字号 10px，360px 屏完整显示不横滚）",
    find: "            .mobile-action-bar { display: block; }\n            ",
    replace: "            .mobile-action-bar { display: block; }\n\n            /* ★ 2026-09-10 价格行（剂数/每剂/药费/诊疗/总计）移动端紧凑单行：\n               gap 8→3px + 字号 10px + space-between 均匀分布，360px 屏完整显示不横滚 */\n            .action-buttons-section > div {\n                gap: 3px !important;\n                padding: 3px 2px !important;\n                justify-content: space-between !important;\n                overflow-x: hidden !important;\n            }\n            .action-buttons-section > div > span { font-size: 10px !important; }\n            .action-buttons-section > div > span:last-child { font-size: 11px !important; }\n            ",
  },
  {
    id: "T07",
    desc: "480px 断点：.login-field 分 2 行布局（label 第一行、输入框第二行）",
    find: ".login-field { flex-direction: row; align-items: center; gap: 8px; margin-bottom: 22px; }\n            .login-field label { width: 40px; font-size: 14px; text-align: right; flex-shrink: 0",
    replace: "/* ★ 2026-08-28 APP 统一：480px 移动端分2行布局（label 第一行、输入框第二行） */\n            .login-field { flex-direction: column; align-items: stretch; gap: 6px; margin-bottom: 22px; }\n            .login-field label { font-size: 13px; text-align: left; flex-shrink: 0; line-height: 1.2",
  },
  {
    id: "T08",
    desc: "360px 断点：.login-field 分 2 行布局（同 T07，超窄屏参数）",
    find: ".login-field { flex-direction: row; align-items: center; gap: 6px; margin-bottom: 12px; }\n            .login-field label { width: 38px; font-size: 12px; text-align: right; flex-shrink: 0",
    replace: "/* ★ 2026-08-28 APP 统一：360px 超窄屏分2行布局（label 第一行、输入框第二行） */\n            .login-field { flex-direction: column; align-items: stretch; gap: 4px; margin-bottom: 12px; }\n            .login-field label { font-size: 11px; text-align: left; flex-shrink: 0; line-height: 1.2",
  },
  {
    id: "T09",
    desc: "剂数输入框 DOM 移行：从医师行移到价格行动作区 + 尺寸缩小（width 50→40px、字号 14→12px）——手机端处方操作界面布局调整（2026-09-10）",
    find: "剂数</span><input type=\"number\" id=\"doseCountInput3\" value=\"7\" style=\"width:50px;padding:3px;font-size:14px;text-align:center;\" oninput=\"syncDoseInputs('doseCountInput3')\"><span style=\"font-size:13px;margin-right:8px;\">剂</span><span class=\"patient-label\">医师</span><input type=\"text\" id=\"doctorName\" class=\"patient-input x-small\" onkeyup=\"updatePrescriptionPaper()\" style=\"width: 90px; min-width: 70px;\"></div></div><div class=\"action-buttons-section\"><div style=\"display:flex;justify-content:flex-start;align-items:center;gap:8px;padding:3px 5px;overflow-x:auto;\"",
    replace: "医师</span><input type=\"text\" id=\"doctorName\" class=\"patient-input x-small\" onkeyup=\"updatePrescriptionPaper()\" style=\"width: 90px; min-width: 70px;\"></div></div><div class=\"action-buttons-section\"><div style=\"display:flex;justify-content:flex-start;align-items:center;gap:8px;padding:3px 5px;overflow-x:auto;\"><span style=\"font-size:11px;white-space:nowrap;\">剂数<input type=\"number\" id=\"doseCountInput3\" value=\"7\" style=\"width:40px;padding:2px;font-size:12px;text-align:center;\" oninput=\"syncDoseInputs('doseCountInput3')\">剂</span",
  },
  {
    id: "T10",
    desc: "版本标签 tag.style.display = ''（登录页直接显示版本号）",
    find: "            if (tag) {\n                if (!_loginVisible) {",
    replace: "            if (tag) {\n                tag.style.display = '';\n                if (!_loginVisible) {",
  },
  {
    id: "T11",
    desc: "登录页版本号直显 + window.__APP_BUILD__ 拼接（防 MainActivity 事后注入的 Build 号被重渲染抹掉的竞态）",
    find: "tag.innerHTML = '【离线 · 登录后显示版本】'",
    replace: "// ★ 2026-08-28 优化：登录页直接显示版本号（原「登录后显示版本」占位无信息量）；\n                    //   MainActivity 注入会追加 Build 号 → 【离线机构版】V1.0.0 Build NNN\n                    // ★ 2026-08-30 修复首开/二开版本号不一致：本函数重写 innerHTML 会抹掉 Java 事后\n                    //   注入的 Build 号（竞态），现直接拼接 window.__APP_BUILD__（MainActivity 注入），\n                    //   重渲染多少次 Build 号都不丢。\n                    tag.innerHTML = '【' + label + '】 ' + window.APP_VERSION +\n                        (window.__APP_BUILD__ ? (' ' + window.__APP_BUILD__) : '')",
  },
  {
    id: "T12",
    desc: "document.title 拼 __APP_BUILD__（同 T11 竞态修复）",
    find: "document.title = '惠康中医-' + label",
    replace: "// ★ 2026-08-30 同竞态修复：标题拼接 __APP_BUILD__，防 applyEditionTags 重写抹掉 Build 号\n            document.title = '惠康中医-' + label +\n                (window.__APP_BUILD__ ? (' ' + window.__APP_BUILD__) : '')",
  },
  {
    id: "T13",
    desc: "【启动竞态·第十一轮】AndroidNative.getAppConfig 同步直调分支：electronAPI shim 在 onPageFinished 才注入，页面脚本期同步直调 Java 桥补位；electronAPI promise 回调体抽为 __applyUserDataConfig/__enforceAfterConfigError 复用",
    find: "        (function() {\n            if (window.electronAPI && window.electronAPI.getAppConfig) {",
    replace: "        (function() {\n            // ★★★ 2026-09-06 第十一轮（机构版按钮错显·启动竞态根治）：安卓 APP 的\n            //   electronAPI shim 在 onPageFinished 才注入，而本 IIFE 在页面脚本解析期\n            //   同步执行——此刻 window.electronAPI 尚不存在 → getAppConfig 从未被调用\n            //   → CONFIG.edition 停留出厂 personal → 机构版激活登录后仍被\n            //   enforceStandardEditionButtons 强制标准版对齐（错显【修改密码】）。\n            //   AndroidNative（addJavascriptInterface）页面脚本期即已可用（auth-core\n            //   同款直调模式），此分支同步直调原生桥补位；desktop 走原 electronAPI 路径不变。\n            function __applyUserDataConfig(r) {\n                if (r && r.success && r.config) {\n                    var cfg = r.config;\n                    // ★ T2 入口关卡（2026-08-21）：净化后再入 CONFIG（users 非数组/edition 别名在此拦截）\n                    try { cfg = window.__normalizeIncomingConfig(cfg, 'getAppConfig'); } catch (_) {}\n                    // ★★★ 2026-08-17 【根治刀1-D】异步 IPC 强制全字段同步（Object.assign），不再漏 productName/maxUsers！\n                    //   且不管 edition 是否变化，一律执行 applyEditionTags + enforce（上一版的 if(cfg.edition!==CONFIG.edition) 包裹直接砍掉）\n                    try { Object.assign(CONFIG, cfg); } catch(_) {\n                        // 老浏览器兜底：逐个字段复制（productName/maxUsers 必须同步！）\n                        if (cfg.edition) CONFIG.edition = cfg.edition;\n                        if (cfg.clinicName) CONFIG.clinicName = cfg.clinicName;\n                        if (cfg.doctorName) CONFIG.doctorName = cfg.doctorName;\n                        if (cfg.productName) CONFIG.productName = cfg.productName;\n                        if (cfg.maxUsers) CONFIG.maxUsers = cfg.maxUsers;\n                        if (cfg.versionLabel) CONFIG.versionLabel = cfg.versionLabel;\n                        if (Array.isArray(cfg.users)) CONFIG.users = cfg.users;\n                        if (cfg.configIssuedAt) CONFIG.configIssuedAt = cfg.configIssuedAt;\n                    }\n                    applyEditionTags();\n                    console.log('[CONFIG] 已从 userData 同步配置，版本:', CONFIG.edition, '产品:', CONFIG.productName);\n                    // ★ 强制 enforce（最关键！上一版漏了这里的 enforce，导致同步回来后按钮还是机构版行为！）\n                    if (typeof enforceStandardEditionButtons === 'function') {\n                        enforceStandardEditionButtons('after-getAppConfig-then');\n                    }\n                    // ★★★ 2026-08-21 【Setup 竞态自愈】机构版配置就绪后，恢复被竞态窗口降级的角色并刷新按钮。\n                    //   竞态窗口：自动登录 updateUserDisplay-tail enforce 在配置就绪前执行 →\n                    //   IS_DESKTOP_LOCAL 权威模式把 currentUser.role 从 admin 降级为 user 且无人恢复。\n                    //   自愈源：localStorage currentUser / user_login_data（写入早于降级发生，保留权威 role）。\n                    try {\n                        var _healEd = String(CONFIG.edition || '');\n                        var _healInst = ['clinic','offline_clinic','clinic_custom','cloud_clinic'].indexOf(_healEd) >= 0;\n                        if (_healInst && typeof currentUser !== 'undefined' && currentUser && typeof updateUserDisplay === 'function') {\n                            try {\n                                if (!AuthCore.isClinicAdmin(currentUser)) {\n                                    var _lu = null;\n                                    try { _lu = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}\n                                    if (!_lu || !(AuthCore.isClinicAdmin(_lu))) {\n                                        try { _lu = (JSON.parse(localStorage.getItem('user_login_data') || 'null') || {}).user || null; } catch(_) {}\n                                    }\n                                    if (_lu && (AuthCore.isClinicAdmin(_lu))) {\n                                        console.log('[CONFIG] 竞态自愈：恢复 role', currentUser.role, '->', _lu.role);\n                                        currentUser.role = _lu.role;\n                                    }\n                                }\n                            } catch(_) {}\n                            setTimeout(function(){ try { updateUserDisplay(); } catch(_) {} }, 0);\n                        }\n                    } catch(_) {}\n                }\n            }\n            function __enforceAfterConfigError(e) {\n                console.warn('[CONFIG] 异步加载 userData 配置失败:', e && e.message);\n                // ★ catch 也要 enforce（IPC失败时就算 CONFIG 没变，也要强制对齐按钮！）\n                if (typeof enforceStandardEditionButtons === 'function') {\n                    enforceStandardEditionButtons('after-getAppConfig-CATCH-' + String((e && e.message) || 'error'));\n                }\n            }\n            if (window.electronAPI && window.electronAPI.getAppConfig) {",
  },
  {
    id: "T14",
    desc: "【承接 T13】electronAPI 分支改调 __applyUserDataConfig().catch(__enforceAfterConfigError)，删除原内联回调体（已函数化）",
    find: "function(r) {\n                    if (r && r.success && r.config) {\n                        var cfg = r.config;\n                        // ★ T2 入口关卡（2026-08-21）：净化后再入 CONFIG（users 非数组/edition 别名在此拦截）\n                        try { cfg = window.__normalizeIncomingConfig(cfg, 'getAppConfig'); } catch (_) {}\n                        // ★★★ 2026-08-17 【根治刀1-D】异步 IPC 强制全字段同步（Object.assign），不再漏 productName/maxUsers！\n                        //   且不管 edition 是否变化，一律执行 applyEditionTags + enforce（上一版的 if(cfg.edition!==CONFIG.edition) 包裹直接砍掉）\n                        try { Object.assign(CONFIG, cfg); } catch(_) {\n                            // 老浏览器兜底：逐个字段复制（productName/maxUsers 必须同步！）\n                            if (cfg.edition) CONFIG.edition = cfg.edition;\n                            if (cfg.clinicName) CONFIG.clinicName = cfg.clinicName;\n                            if (cfg.doctorName) CONFIG.doctorName = cfg.doctorName;\n                            if (cfg.productName) CONFIG.productName = cfg.productName;\n                            if (cfg.maxUsers) CONFIG.maxUsers = cfg.maxUsers;\n                            if (cfg.versionLabel) CONFIG.versionLabel = cfg.versionLabel;\n                            if (Array.isArray(cfg.users)) CONFIG.users = cfg.users;\n                            if (cfg.configIssuedAt) CONFIG.configIssuedAt = cfg.configIssuedAt;\n                        }\n                        applyEditionTags();\n                        console.log('[CONFIG] 已从 userData 同步配置，版本:', CONFIG.edition, '产品:', CONFIG.productName);\n                        // ★ 强制 enforce（最关键！上一版漏了这里的 enforce，导致同步回来后按钮还是机构版行为！）\n                        if (typeof enforceStandardEditionButtons === 'function') {\n                            enforceStandardEditionButtons('after-getAppConfig-then');\n                        }\n                        // ★★★ 2026-08-21 【Setup 竞态自愈】机构版配置就绪后，恢复被竞态窗口降级的角色并刷新按钮。\n                        //   竞态窗口：自动登录 updateUserDisplay-tail enforce 在配置就绪前执行 →\n                        //   IS_DESKTOP_LOCAL 权威模式把 currentUser.role 从 admin 降级为 user 且无人恢复。\n                        //   自愈源：localStorage currentUser / user_login_data（写入早于降级发生，保留权威 role）。\n                        try {\n                            var _healEd = String(CONFIG.edition || '');\n                            var _healInst = ['clinic','offline_clinic','clinic_custom','cloud_clinic'].indexOf(_healEd) >= 0;\n                            if (_healInst && typeof currentUser !== 'undefined' && currentUser && typeof updateUserDisplay === 'function') {\n                                try {\n                                    if (!AuthCore.isClinicAdmin(currentUser)) {\n                                        var _lu = null;\n                                        try { _lu = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch(_) {}\n                                        if (!_lu || !(AuthCore.isClinicAdmin(_lu))) {\n                                            try { _lu = (JSON.parse(localStorage.getItem('user_login_data') || 'null') || {}).user || null; } catch(_) {}\n                                        }\n                                        if (_lu && (AuthCore.isClinicAdmin(_lu))) {\n                                            console.log('[CONFIG] 竞态自愈：恢复 role', currentUser.role, '->', _lu.role);\n                                            currentUser.role = _lu.role;\n                                        }\n                                    }\n                                } catch(_) {}\n                                setTimeout(function(){ try { updateUserDisplay(); } catch(_) {} }, 0);\n                            }\n                        } catch(_) {}\n                    }\n                }).catch(function(e) {\n                    console.warn('[CONFIG] 异步加载 userData 配置失败:', e.message);\n                    // ★ catch 也要 enforce（IPC失败时就算 CONFIG 没变，也要强制对齐按钮！）\n                    if (typeof enforceStandardEditionButtons === 'function') {\n                        enforceStandardEditionButtons('after-getAppConfig-CATCH-' + String(e.message || 'error'));\n                    }\n                });",
    replace: "__applyUserDataConfig).catch(__enforceAfterConfigError);\n            } else if (window.AndroidNative && typeof window.AndroidNative.invoke === 'function') {\n                // ★ 2026-09-06 第十一轮：安卓 APP 启动竞态分支——shim 未注入时\n                //   同步直调 AndroidNative（JavaBridge 线程执行，返回 JSON 字符串）。\n                //   结果同步就绪，__appConfigReady 直接 resolve（自动登录无 800ms 等待）。\n                try {\n                    var __rawCfg = window.AndroidNative.invoke('getAppConfig', '{}');\n                    var __cfgRes = JSON.parse(__rawCfg);\n                    try {\n                        window.__appConfigReady = Promise.resolve(__cfgRes);\n                    } catch(_) {}\n                    __applyUserDataConfig(__cfgRes);\n                } catch (__) {\n                    try { window.__appConfigReady = Promise.resolve(null); } catch(_) {}\n                    __enforceAfterConfigError(__);\n                }",
  },
  {
    id: "T15",
    desc: "注释：忘记密码安全加固说明（已激活设备通过本机激活码核验；试用/免费机直接重置）",
    find: "        //   注入式实现（HTML DOM 零改动，沿用 __replaceTopClearWithStats 模式）。\n        function injectForgotPasswordLink() {",
    replace: "        //   注入式实现（HTML DOM 零改动，沿用 __replaceTopClearWithStats 模式）。\n        // ★ 2026-09-11 安全加固 / 2026-09-22 三态安全门：激活机（有激活记录）重置前\n        //   必须通过「本机激活码」核验（记录读取失败/无码/不匹配一律 fail-closed）；\n        //   试用/免费机无激活记录，直接设置新密码（不再使用临时口令 admin）。\n        //   旧逻辑零鉴权，任何人拿到设备输入账号名即可重置任意账号密码查看处方数据。\n        function injectForgotPasswordLink() {",
  },
  {
    id: "T17",
    desc: "【三态安全门 2026-09-22】APP忘记密码：AuthCore.isDeviceLicensed 判定激活态→必须激活码核验（记录读取失败/无码/不匹配 fail-closed）；试用/免费机直接放行设置新密码",
    find: "                if (idx < 0) { alert('未找到账号 ' + username + '，请检查输入是否正确'); return; }\n                // ★ 2026-09-22 直接设置新密码（不再经过临时口令 admin）。",
    replace: "                if (idx < 0) { alert('未找到账号 ' + username + '，请检查输入是否正确'); return; }\n                // ★ APP 忘记密码三态安全门（2026-09-11 加固 / 09-22 重构为真 fail-closed）：\n                //   ① 激活机（AuthCore.isDeviceLicensed 三源判定）→ 必须输入本机激活码核验，\n                //      激活记录读取失败/无码/核验不通过一律拒绝（联系客服）；\n                //   ② 试用/免费机 → 无激活记录，直接放行设置新密码。\n                let _devLicensed = false;\n                try {\n                    _devLicensed = !!(typeof window.__isDeviceLicensed === 'function'\n                        && await window.__isDeviceLicensed());\n                } catch (e) {\n                    alert('激活状态读取异常，为保护账号安全暂不能自助重置密码。\\n\\n请联系客服微信 hktzy1688 处理。');\n                    return;\n                }\n                if (_devLicensed) {\n                    let recCode = '';\n                    let recReadOk = false;\n                    try {\n                        if (window.electronAPI && window.electronAPI.license &&\n                            typeof window.electronAPI.license.getActivationRecord === 'function') {\n                            const rec = await window.electronAPI.license.getActivationRecord();\n                            recReadOk = true;\n                            if (rec && rec.success !== false) recCode = String(rec.code || '').trim();\n                        }\n                    } catch (e) { console.warn('[忘记密码] 读取激活记录失败:', e); recReadOk = false; }\n                    if (!recReadOk || !recCode) {\n                        alert('本机激活记录无法核验（激活记录较旧或读取失败），为保护账号安全暂不能自助重置密码。\\n\\n请联系客服微信 hktzy1688 处理。');\n                        return;\n                    }\n                    const inputCode = String(prompt('为保护账号安全，请输入本机激活码完成身份核验：\\n\\n（购买时通过短信/微信发送，格式如 BNZC-XXXX-XXXX-XXXX-XXXX；\\n  如遗失请联系客服微信 hktzy1688）') || '').trim();\n                    if (!inputCode) return;\n                    // 去横杠+大小写归一后全等比对（输入带不带横杠均可）\n                    const norm = s => String(s || '').replace(/-/g, '').toUpperCase();\n                    if (norm(inputCode) !== norm(recCode)) {\n                        alert('激活码核验失败，无法重置密码。\\n\\n请核对激活码后重试（购买时通过短信/微信发送）；\\n如遗失请联系客服微信 hktzy1688。');\n                        return;\n                    }\n                }\n                // ★ 2026-09-22 直接设置新密码（不再经过临时口令 admin）。",
  },
  {
    id: "T19",
    desc: "▼(N) 直接作为按钮文本显示（对齐云端布局，废除外飘胶囊徽标）",
    find: "btn.textContent = '▼(' + usernames.length",
    replace: "// ★ 2026-08-29 对齐云端布局：▼(N) 直接作为按钮文本（按钮内部显示），\n            //   废除外飘胶囊徽标（position:absolute; right:-34px 导致 (N) 显示在输入框外部）。\n            var count = usernames.length;\n            btn.textContent = '▼(' + count",
  },
  {
    id: "T20",
    desc: "新增卸载丢媒体备份提醒：checkMediaBackupRisk 延迟 5 秒执行（避开启动/登录流程）",
    find: "            dailyAutoBackup().catch(e => console.warn('[Backup] dailyAutoBackup error:', e));\n            ",
    replace: "            dailyAutoBackup().catch(e => console.warn('[Backup] dailyAutoBackup error:', e));\n            // ★ 2026-08-31 卸载丢媒体备份提醒：延迟 5 秒（避开启动/登录流程，每天最多弹一次）\n            setTimeout(function () { checkMediaBackupRisk(); }, 5000);\n            ",
  },
  {
    id: "T21",
    desc: "【IIFE 注入】手机端顶部「清空」按钮运行时替换为「统计」（打开数据统计弹窗）；桌面 >768px 不受影响",
    find: "\n        // 药物数据防火墙 - 确保药物数据总是被加载（即使 loadData 失败）",
    replace: "\n        // ★ 2026-08-29 手机端顶部「清空」与底部快捷栏「清空」重复：手机端运行时把顶部按钮改为「统计」，\n        // 打开数据统计弹窗（内含🗄️数据管理：一键备份/恢复数据），云端/离线APP入口一致；\n        // 桌面端（>768px）保持原「清空」（清空当前处方表单），不受影响\n        (function () {\n            function __replaceTopClearWithStats() {\n                try {\n                    if (window.innerWidth > 768) return;\n                    const bar = document.querySelector('.top-tabs-left');\n                    if (!bar) return;\n                    const btns = bar.querySelectorAll('button.action-btn');\n                    for (let i = 0; i < btns.length; i++) {\n                        const b = btns[i];\n                        const oc = b.getAttribute('onclick') || '';\n                        if (oc.indexOf('clearPrescription') >= 0 && (b.textContent || '').indexOf('清空') >= 0) {\n                            if (b.__statsReplaced) return;\n                            b.__statsReplaced = true;\n                            b.textContent = '统计';\n                            b.setAttribute('onclick', \"if(typeof showModal==='function')showModal('analyticsModal')\");\n                            b.style.background = '#2196F3';\n                            b.style.color = 'white';\n                            return;\n                        }\n                    }\n                } catch (e) { console.warn('顶部统计按钮替换失败:', e); }\n            }\n            if (document.readyState === 'loading') {\n                document.addEventListener('DOMContentLoaded', __replaceTopClearWithStats);\n            } else {\n                __replaceTopClearWithStats();\n            }\n            setTimeout(__replaceTopClearWithStats, 1500);\n        })();\n\n        // 药物数据防火墙 - 确保药物数据总是被加载（即使 loadData 失败）",
  },
  {
    id: "T23",
    desc: "相册导入模块头注释（从手机相册选照片视频按命名规则入库）",
    find: "\n        var __albumTargetCtx = null;",
    replace: "\n        // ========================================================================\n        // ★ 2026-09-10 历史处方·相册导入：从手机相册/文件管理器选取已有舌苔照片、\n        //   视频文件，按现有媒体命名规则（患者名_处方编号 前缀）保存到本机媒体目录\n        //   （APP端 Pictures/Movies/惠康中医处方/YYYY-MM/，与拍照录像同库，findMediaFiles\n        //   前缀扫描直接命中 → 📷🎥 查看器可见；网页端存 IndexedDB 同库同结构）。\n        //   大文件安全：APP shim（video-recorder-inject.js）自动 base64 分片上传；\n        //   前置限制 视频≤50MB / 图片≤10MB，超限跳过并提示。\n        // ========================================================================\n        var __albumTargetCtx = null;",
  },
  {
    id: "T24",
    desc: "collectAndUpdateMediaFiles 函数行首补 8 空格缩进（纯格式）",
    find: "async function collectAndUpdateMediaFiles(savedRecord, officialNo) {",
    replace: "        async function collectAndUpdateMediaFiles(savedRecord, officialNo) {",
  },
  {
    id: "T25",
    desc: "注释：「原生层」→「Java 层」（术语统一）",
    find: "            //   原生层 canPrescribe 同步拦截 readOnly=true，双保险）",
    replace: "            //   Java 层 canPrescribe 同步拦截 readOnly=true，双保险）",
  },
  {
    id: "T26",
    desc: "注释：「原生层」→「Java 层」（readOnly 拦截提示，术语统一）",
    find: "                        // ★ 2026-09-05 只读模式：原生层 readOnly 拦截给专属提示（max=-1 时旧文案会显示\"上限-1张\"）",
    replace: "                        // ★ 2026-09-05 只读模式：Java 层 readOnly 拦截给专属提示（max=-1 时旧文案会显示\"上限-1张\"）",
  },
  {
    id: "T27",
    desc: "【IS_ELECTRON 固化 bug】备份改运行时判断 window.electronAPI（APP shim 在页面脚本期未注入，IS_ELECTRON 已固化为 false 导致走错分支）",
    find: "与云桌面/APP端统一——运行时判断 + 显示实际保存位置（绝对路径）",
    replace: "APP 端 electronAPI shim 在 onPageFinished 注入，const IS_ELECTRON 在页面\n            //   脚本加载时已固化为 false，导致 APP 走浏览器下载分支（离线APP点击备份无反应）。\n            //   改为运行时判断 window.electronAPI（与 importData 一致）。",
  },
  {
    id: "T28",
    desc: "照片视频备份：调用 window.electronAPI.backupMedia() 复制媒体到公共 Downloads，backupInfo 拼接 mediaInfo 统计；保存位置文案改相对路径",
    find: "const backupInfo = `\\u5907\\u4EFd\\u6210\\u529F\\uFF01\\n\\n\\u5907\\u4EFd\\u6587\\u4EF6\\uFF1A${finalResult.fileName}\\n\\u4FDD\\u5B58\\u4F4D\\u7F6E\\uFF1A${finalResult.filePath || '惠康中医媒体/downloads/中医处方系统/'}\\n\\n\\u5907\\u4EFd\\u6570\\u636E\\u7EDF\\u8BA1\\uFF1A\\n\\u2022 \\u836F\\u54C1\\u6570\\u91CF\\uFF1A${medicines.length} 种\\n\\u2022 \\u9A8C\\u65B9\\u6570\\u91CF\\uFF1A${formulas.length} 个\\n\\u2022 \\u5904\\u65B9\\u6570\\u91CF\\uFF1A${prescriptionHistory.length} 张\\n\\n\\u6587\\u4EF6\\u5927\\u5C0F\\uFF1A${(jsonStr.length / 1024).toFixed(1)} KB",
    replace: "// ★ 2026-08-30 照片视频备份：媒体文件复制到公共 Downloads/中医处方系统/media/\n                    let mediaInfo = '';\n                    try {\n                        if (window.electronAPI && typeof window.electronAPI.backupMedia === 'function') {\n                            const mr = await window.electronAPI.backupMedia();\n                            if (mr && mr.success) {\n                                // ★ 2026-08-31 更新已备份媒体基准数（卸载丢媒体提醒的比对依据）\n                                try { getMediaStatsViaBridge().then(function (s) { if (s && s.success) localStorage.setItem('lastMediaBackupCount', String(s.count)); }); } catch (e) {}\n                                const mc = mr.copied || 0;\n                                const mb = mr.totalBytes || 0;\n                                if (mc > 0) {\n                                    mediaInfo = '\\n\\n照片视频备份：成功复制 ' + mc + ' 个文件（' + (mb / 1024 / 1024).toFixed(1) + ' MB）\\n保存位置：downloads/中医处方系统/media/';\n                                } else {\n                                    mediaInfo = '\\n\\n照片视频备份：已是最新（' + (mr.skipped || 0) + ' 个文件已存在）';\n                                }\n                            } else {\n                                mediaInfo = '\\n\\n照片视频备份：跳过（' + ((mr && mr.error) || '失败') + '）';\n                            }\n                        }\n                    } catch (e) { mediaInfo = '\\n\\n照片视频备份：跳过（' + String(e) + '）'; }\n                    const backupInfo = `\\u5907\\u4EFd\\u6210\\u529F\\uFF01\\n\\n\\u5907\\u4EFd\\u6587\\u4EF6\\uFF1A${finalResult.fileName}\\n\\u4FDD\\u5B58\\u4F4D\\u7F6E\\uFF1A${finalResult.filePath || 'downloads/中医处方系统/'}\\n\\n\\u5907\\u4EFd\\u6570\\u636E\\u7EDF\\u8BA1\\uFF1A\\n\\u2022 \\u836F\\u54C1\\u6570\\u91CF\\uFF1A${medicines.length} 种\\n\\u2022 \\u9A8C\\u65B9\\u6570\\u91CF\\uFF1A${formulas.length} 个\\n\\u2022 \\u5904\\u65B9\\u6570\\u91CF\\uFF1A${prescriptionHistory.length} 张\\n\\n\\u6587\\u4EF6\\u5927\\u5C0F\\uFF1A${(jsonStr.length / 1024).toFixed(1)} KB${mediaInfo}",
  },
  {
    id: "T29",
    desc: "注释措辞：导入核心逻辑抽离（系统文件选择器 与 原生 readBackupFile 两条恢复路径）",
    find: "核心导入逻辑抽离（备份列表/文件选择器",
    replace: "导入核心逻辑抽离\n        //   （系统文件选择器 与 原生 readBackupFile 两条恢复路径",
  },
  {
    id: "T30",
    desc: "照片视频恢复：数据导入后调用 window.electronAPI.restoreMedia() 从公共 Downloads 恢复媒体（重装一键恢复）",
    find: "alert('数据导入成功！'",
    replace: "// ★ 2026-08-30 照片视频恢复：从公共 Downloads/中医处方系统/media/ 复制回 APP 媒体目录\n                //   （重装后一键恢复照片视频；浏览器/无桥环境自动跳过）\n                let restoreMediaInfo = '';\n                try {\n                    if (window.electronAPI && typeof window.electronAPI.restoreMedia === 'function') {\n                        const mr = await window.electronAPI.restoreMedia();\n                        if (mr && mr.success) {\n                            if ((mr.restored || 0) > 0) {\n                                restoreMediaInfo = '\\n照片视频恢复：成功恢复 ' + mr.restored + ' 个文件';\n                            } else {\n                                restoreMediaInfo = '\\n照片视频恢复：' + (mr.message || '无新文件需要恢复');\n                            }\n                        } else {\n                            restoreMediaInfo = '\\n照片视频恢复：跳过（' + ((mr && mr.error) || '失败') + '）';\n                        }\n                    }\n                } catch (e) { restoreMediaInfo = '\\n照片视频恢复：跳过（' + String(e) + '）'; }\n                alert('数据导入成功！' + restoreMediaInfo",
  },
  {
    id: "T31",
    desc: "注释措辞：APP/桌面端优先走备份列表一键恢复（路径分隔符统一为正斜杠）",
    find: "优先走\"备份列表一键恢复\"（与云桌面/APP端一致）\n            //   列出 惠康中医媒体\\downloads\\中医处方系统\\",
    replace: "APP/桌面端优先走\"备份列表一键恢复\"\n            //   列出 Downloads/中医处方系统/",
  },
  {
    id: "T32",
    desc: "confirm 文案：「惠康中医媒体\\downloads\\中医处方系统\\」→「备份文件夹：中医处方系统」（Android 实际目录）",
    find: "                            var ok = confirm('发现 ' + result.files.length + ' 个备份文件（惠康中医媒体\\\\downloads\\\\中医处方系统\\\\）\\n\\n' + fileList + '\\n\\n【确定】用最新备份恢复（第1个）\\n【取消】改为手动选择文件');",
    replace: "                            var ok = confirm('发现 ' + result.files.length + ' 个备份文件（备份文件夹：中医处方系统）\\n\\n' + fileList + '\\n\\n【确定】用最新备份恢复（第1个）\\n【取消】改为手动选择文件');",
  },
  {
    id: "T33",
    desc: "提示文案：「目录（惠康中医媒体\\downloads\\中医处方系统\\」→「文件夹（中医处方系统」（同 T32 动机）",
    find: "目录（惠康中医媒体\\\\downloads\\\\中医处方系统\\\\",
    replace: "文件夹（中医处方系统",
  },
  {
    id: "T34",
    desc: "注释：系统文件选择器路径定性为「网页版主路径；APP/桌面端兜底」",
    find: "        // 系统文件选择器路径（兜底）",
    replace: "        // 系统文件选择器路径（网页版主路径；APP/桌面端兜底）",
  },
];
