// ============================================================================
// prescription-core.js — 处方签核心共享模块
// ★ 2026-09-13 P2-A3 收缩到真实 API 面：全库触点审计（命名空间调用/动态访问/
//   工具链脚本）确认仅 getAutoJianfa 被消费（7 份 index.html 防御式调用）。
//   原 17 个工具函数（escapeHtml/formatPrice/排序/金额计算/校验/记录构建等）
//   自模块创建起即被各端 index.html 内联同名实现遮蔽、零命名空间调用，属
//   双轨漂移温床（如 escapeHtml 模块版 `!str` 守卫 vs 内联版 `str == null`
//   守卫已实际漂移），整体移除——唯一活实现 = 各端内联版，云↔离线同体由
//   diff-cross-version.cjs Tier B 基线守护。
// 保留两个活特性：
//   1. PrescriptionCore.getAutoJianfa()：药典煎煮方法自动匹配（JIANFA_RULES 唯一权威源）
//   2. PaperHistoryToggle：处方签「病史症状」栏开关（自执行运行时注入，HTML 零改动）
// ============================================================================
(function (global) {
    'use strict';

    // ==================== 中药煎煮方法规范规则表 ====================
    // 依据 2020版《中国药典》及《中药学》教材特殊煎煮法归纳。
    // 优先级约定（各端调用）：药库手动设置(非普通煎) > 本规则表自动匹配 > 普通煎
    const JIANFA_RULES = {
        // 先煎 —— 矿物、贝壳、化石类及需久煎去毒的药物
        '石膏': '先煎', '寒水石': '先煎', '花蕊石': '先煎', '海浮石': '先煎',
        '海蛤壳': '先煎', '瓦楞子': '先煎', '龙骨': '先煎', '龙齿': '先煎',
        '牡蛎': '先煎', '石决明': '先煎', '珍珠母': '先煎', '代赭石': '先煎',
        '磁石': '先煎', '紫石英': '先煎', '自然铜': '先煎', '龟甲': '先煎',
        '鳖甲': '先煎', '水牛角': '先煎', '川乌': '先煎', '草乌': '先煎', '附子': '先煎',
        // 后下 —— 气味芳香含挥发油、久煎降效的药物
        '薄荷': '后下', '砂仁': '后下', '白豆蔻': '后下', '青蒿': '后下',
        '香薷': '后下', '钩藤': '后下', '大黄': '后下', '番泻叶': '后下',
        '沉香': '后下', '檀香': '后下', '降香': '后下', '鱼腥草': '后下',
        // 包煎 —— 细小种子、花粉、含绒毛易浑汤的药物
        '车前子': '包煎', '滑石': '包煎', '旋覆花': '包煎', '辛夷': '包煎',
        '枇杷叶': '包煎', '海金沙': '包煎', '蒲黄': '包煎', '葶苈子': '包煎', '蚕沙': '包煎',
        // 烊化 —— 胶类药（另溶化兑入）
        '阿胶': '烊化', '鹿角胶': '烊化', '龟甲胶': '烊化', '鳖甲胶': '烊化',
        '黄明胶': '烊化', '饴糖': '烊化',
        // 另煎 —— 贵细药材（单独煎煮兑入）
        '人参': '另煎', '红参': '另煎', '西洋参': '另煎', '羚羊角': '另煎',
        '鹿茸': '另煎', '西红花': '另煎',
        // 冲服 —— 粉末/树脂类宜研末冲服（不入煎剂）
        '三七': '冲服', '琥珀': '冲服', '珍珠': '冲服', '牛黄': '冲服',
        '麝香': '冲服', '冰片': '冲服', '芒硝': '冲服', '玄明粉': '冲服',
        '竹沥': '冲服', '雷丸': '冲服',
        // 煎汤代水 —— 先单独煎煮取汤，再以其汤代水煎其余药物
        '灶心土': '煎汤代水', '伏龙肝': '煎汤代水',
        // 兑服 —— 液汁类直接兑入药液
        '姜汁': '兑服'
    };

    // 名称包含误匹配排除表（如"香附子"含"附子"、"肉豆蔻"含"豆蔻"，不得命中先煎/后下）
    const JIANFA_EXCLUDE = ['香附', '肉豆蔻'];

    // 按药名自动匹配规范煎煮方法：精确命中 > 长关键词包含匹配 > 无（返回''）
    // 支持"煅龙骨/生石膏/炒车前子"等炮制前缀写法
    function getAutoJianfa(name) {
        if (!name) return '';
        const n = String(name).replace(/\s+/g, '');
        if (JIANFA_RULES[n]) return JIANFA_RULES[n];
        for (let i = 0; i < JIANFA_EXCLUDE.length; i++) {
            if (n.indexOf(JIANFA_EXCLUDE[i]) !== -1) return '';
        }
        const keys = Object.keys(JIANFA_RULES).sort((a, b) => b.length - a.length);
        for (let i = 0; i < keys.length; i++) {
            if (n.indexOf(keys[i]) !== -1) return JIANFA_RULES[keys[i]];
        }
        return '';
    }

    // ==================== 导出 ====================
    const PrescriptionCore = {
        getAutoJianfa
    };

    global.PrescriptionCore = PrescriptionCore;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// ============================================================================
// 处方签「病史症状」栏显示/隐藏开关（2026-09-01 · 运行时注入 · HTML 零改动）
// 需求：处方签病史症状栏可勾选显示/隐藏（localStorage 持久化）；
//      默认隐藏 —— 屏幕预览与打印一致（打印取 #prescriptionPaper.innerHTML，
//      本模块对行内 div 写 style.display:none，随 innerHTML 携带进打印窗口）
// ============================================================================
(function (global) {
    'use strict';
    if (global.__paperHistoryToggleLoaded) return;
    global.__paperHistoryToggleLoaded = true;

    var LS_KEY = 'local_paperShowHistory'; // '1'=显示 / 其他=隐藏（默认隐藏）

    function getShow() {
        try { return !!(global.localStorage && global.localStorage.getItem(LS_KEY) === '1'); }
        catch (e) { return false; }
    }
    function setShow(v) {
        try { if (global.localStorage) global.localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch (e) {}
    }

    // 处方签上「病史症状」整行 = #paperMedicalHistory 向上最近的块级 div
    //（该 div 内含文本 span + 下划分隔线，整行隐藏即为栏目隐藏）
    function findRow() {
        var s = document.getElementById('paperMedicalHistory');
        if (!s) return null;
        if (s.closest) return s.closest('div');
        return s.parentElement && s.parentElement.parentElement;
    }

    // 应用显示/隐藏到处方签行 + 同步勾选框状态
    function applyHistoryToggle() {
        var row = findRow();
        if (row) row.style.display = getShow() ? '' : 'none';
        var cb = document.getElementById('paperHistoryToggle');
        if (cb && cb.checked !== getShow()) cb.checked = getShow();
    }

    // 打印前兜底：包一层 printPrescription，进打印前再 apply 一次
    //（防其他逻辑复位 display；printPrescription 由各端内联脚本后定义，需延迟包裹）
    function wrapPrint() {
        if (typeof global.printPrescription === 'function' && !global.printPrescription.__histWrapped) {
            var orig = global.printPrescription;
            var wrapped = function () { applyHistoryToggle(); return orig.apply(this, arguments); };
            wrapped.__histWrapped = true;
            global.printPrescription = wrapped;
            return true;
        }
        return typeof global.printPrescription === 'function';
    }

    // 注入勾选框到左栏「病史症状」页签行右端（不在 #prescriptionPaper 内，永不进打印）
    function injectHistoryToggle(retry) {
        retry = retry || 0;
        var row = findRow();
        var tabs = document.querySelector('.symptom-section .history-tabs');
        if (!row || !tabs) {
            if (retry < 40) setTimeout(function () { injectHistoryToggle(retry + 1); }, 250);
            return;
        }
        if (!document.getElementById('paperHistoryToggle')) {
            var lab = document.createElement('label');
            lab.id = 'paperHistoryToggleWrap';
            lab.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:4px;font-size:11px;color:#555;cursor:pointer;white-space:nowrap;padding:2px 0 2px 8px;';
            lab.title = '勾选=处方签显示病史症状栏（屏幕预览与打印一致）；默认隐藏、打印不输出';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = 'paperHistoryToggle';
            cb.style.cssText = 'width:13px;height:13px;margin:0;cursor:pointer;accent-color:#006400;';
            var tx = document.createElement('span');
            tx.textContent = '处方签显示病史';
            lab.appendChild(cb);
            lab.appendChild(tx);
            tabs.appendChild(lab);
            cb.addEventListener('change', function () { setShow(cb.checked); applyHistoryToggle(); });
        }
        applyHistoryToggle();
    }

    // 启动：勾选框/应用立即执行；printPrescription 包裹在后台重试
    //（printPrescription 由各端内联脚本在页面加载期定义，本模块先加载）
    function bootHistoryToggle() {
        injectHistoryToggle(0);
        (function wrapRetry(retry) {
            retry = retry || 0;
            if (wrapPrint() || retry >= 40) return;
            setTimeout(function () { wrapRetry(retry + 1); }, 250);
        })(0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootHistoryToggle);
    } else {
        bootHistoryToggle();
    }

    global.PaperHistoryToggle = {
        isShown: getShow,
        setShown: function (v) { setShow(!!v); applyHistoryToggle(); },
        apply: applyHistoryToggle
    };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
