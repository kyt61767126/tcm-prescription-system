// ============================================================================
// symptom-dict.js — 中医症状体征词典 + 舌脉快捷录入面板（权威源）
// 设计文档：.trae/documents/symptom-quick-input-impl.md（v1.0 定稿）
// 分发：tools/sync-all.ps1（$BusinessJsFiles 已注册本文件）
// 缓存：public/_headers 对本文件 max-age=86400；词典修订需 bump version 破缓存
// 特性：
//   1) 词条按《中医诊断学》标准内置（80~120条），预置拼音简码
//   2) 快捷面板：分类点选 + 简码搜索（startsWith）/中文搜索（includes）
//   3) 拼接规则（§3.4）：同分类用顿号「、」，跨分类用逗号「，」，末尾无标点
//   4) 光标缓存插入（§4.2）：面板打开时缓存 selectionStart/End，插入后焦点回归
//   5) 频次记忆（§4.6）：localStorage[SYMPTOM_FREQ_KEY]，高频词前置，可重置
//   6) Alt+S 快捷键（§4.7）；「舌脉」按钮运行时注入 .history-tabs（HTML 零改动）
// ============================================================================
(function (global) {
    'use strict';

    // 防重复注入（script 标签 + 热更新场景双保险）
    if (global.__symptomDictLoaded) return;
    global.__symptomDictLoaded = true;

    // ========================================================================
    // 1. 词典数据（纯数据，无 DOM 依赖）
    // ========================================================================
    var DICT = {
        version: 1,
        categories: [
            // ---- 组合模板（order 0：快捷整串，追加不替换，§4.5）----
            { id: 'zh', name: '组合模板', order: 0, terms: [
                { text: '舌淡红，苔薄白，脉弦', code: '' },
                { text: '舌淡红，苔薄白，脉缓', code: '' },
                { text: '舌淡红，苔薄白，脉平', code: '' },
                { text: '舌红，苔黄腻，脉滑数', code: '' },
                { text: '舌红，苔薄黄，脉浮数', code: '' },
                { text: '舌淡，苔白腻，脉濡缓', code: '' },
                { text: '舌淡，苔薄白，脉沉细', code: '' },
                { text: '舌淡胖有齿痕，苔白滑，脉沉迟', code: '' },
                { text: '舌紫暗有瘀斑，苔薄白，脉涩', code: '' },
                { text: '舌红少苔，脉细数', code: '' },
                { text: '舌红绛，苔黄燥，脉洪数', code: '' },
                { text: '舌淡，苔白滑，脉紧', code: '' }
            ]},
            // ---- 舌质（order 1）----
            { id: 'tz', name: '舌质', order: 1, terms: [
                { text: '舌淡', code: 'sd' },
                { text: '舌淡红', code: 'sdh' },
                { text: '舌红', code: 'sh' },
                { text: '舌绛', code: 'sj' },
                { text: '舌红绛', code: 'shj' },
                { text: '舌紫暗', code: 'sza' },
                { text: '舌淡胖', code: 'sdp' },
                { text: '舌胖大', code: 'spd' },
                { text: '边有齿痕', code: 'bych' },
                { text: '舌有瘀斑', code: 'syyb' },
                { text: '舌有瘀点', code: 'syyd' },
                { text: '舌有裂纹', code: 'sylw' },
                { text: '舌瘦薄', code: 'ssb' },
                { text: '舌淡白', code: 'sdb' },
                { text: '舌歪斜', code: 'swx' }
            ]},
            // ---- 舌苔（order 2）----
            { id: 'tai', name: '舌苔', order: 2, terms: [
                { text: '苔薄白', code: 'tbb' },
                { text: '苔薄黄', code: 'tbh' },
                { text: '苔白腻', code: 'tbn' },
                { text: '苔白厚', code: 'tbho' },
                { text: '苔白滑', code: 'tbai' },
                { text: '苔白干', code: 'tbg' },
                { text: '苔白润', code: 'tbr' },
                { text: '苔黄腻', code: 'thn' },
                { text: '苔黄厚', code: 'thho' },
                { text: '苔黄燥', code: 'thz' },
                { text: '苔灰黑', code: 'thh' },
                { text: '苔少', code: 'ts' },
                { text: '无苔', code: 'wt' },
                { text: '苔剥落', code: 'tbl' },
                { text: '花剥苔', code: 'hbt' }
            ]},
            // ---- 脉象（order 3）----
            { id: 'mai', name: '脉象', order: 3, terms: [
                { text: '脉浮', code: 'mf' },
                { text: '脉沉', code: 'mc' },
                { text: '脉迟', code: 'mch' },
                { text: '脉数', code: 'msh' },
                { text: '脉滑', code: 'mh' },
                { text: '脉涩', code: 'mse' },
                { text: '脉弦', code: 'mx' },
                { text: '脉细', code: 'mxi' },
                { text: '脉弱', code: 'mr' },
                { text: '脉紧', code: 'mj' },
                { text: '脉洪', code: 'mhong' },
                { text: '脉濡', code: 'mru' },
                { text: '脉缓', code: 'mhuan' },
                { text: '脉促', code: 'mcu' },
                { text: '脉结', code: 'mjie' },
                { text: '脉代', code: 'md' }
            ]},
            // ---- 望闻诊（order 4）----
            { id: 'wen', name: '望闻诊', order: 4, terms: [
                { text: '面色萎黄', code: 'mswh' },
                { text: '面色苍白', code: 'mscb' },
                { text: '面色潮红', code: 'msch' },
                { text: '面色青紫', code: 'msqz' },
                { text: '面色晦暗', code: 'msha' },
                { text: '神疲乏力', code: 'spfl' },
                { text: '形体消瘦', code: 'xtxs' },
                { text: '形体肥胖', code: 'xtfp' },
                { text: '语声低微', code: 'ysdw' },
                { text: '少气懒言', code: 'sqly' },
                { text: '气短', code: 'qd' },
                { text: '咳嗽', code: 'ks' },
                { text: '咳痰稀白', code: 'ktxb' },
                { text: '端坐呼吸', code: 'dzpx' },
                { text: '口唇紫暗', code: 'kcza' },
                { text: '口唇淡白', code: 'kcdb' },
                { text: '咽喉肿痛', code: 'yhzt' }
            ]},
            // ---- 问诊（order 5，十问歌）----
            { id: 'wd', name: '问诊', order: 5, terms: [
                { text: '恶寒发热', code: 'ehfr' },
                { text: '恶寒', code: 'eh' },
                { text: '发热', code: 'fr' },
                { text: '寒热往来', code: 'hrwl' },
                { text: '午后潮热', code: 'whch' },
                { text: '自汗', code: 'zh' },
                { text: '盗汗', code: 'dh' },
                { text: '无汗', code: 'wh' },
                { text: '头痛', code: 'tt' },
                { text: '头晕', code: 'ty' },
                { text: '身重', code: 'sz' },
                { text: '关节痛', code: 'gjt' },
                { text: '腰痛', code: 'yt' },
                { text: '腰膝酸软', code: 'yxsr' },
                { text: '肢体麻木', code: 'ztmm' },
                { text: '便秘', code: 'bm' },
                { text: '大便溏薄', code: 'dbtb' },
                { text: '泄泻', code: 'xx' },
                { text: '小便短赤', code: 'xbdc' },
                { text: '小便清长', code: 'xbqz' },
                { text: '小便频数', code: 'xbps' },
                { text: '纳呆', code: 'nd' },
                { text: '纳差', code: 'nc' },
                { text: '多食易饥', code: 'dsyj' },
                { text: '口干', code: 'kg' },
                { text: '口苦', code: 'kk' },
                { text: '口淡', code: 'kd' },
                { text: '渴喜冷饮', code: 'kxly' },
                { text: '失眠', code: 'sm' },
                { text: '多梦', code: 'dm' },
                { text: '入睡困难', code: 'rskn' },
                { text: '嗜睡', code: 'sshu' },
                { text: '胸闷', code: 'xm' },
                { text: '胸痛', code: 'xtong' },
                { text: '心悸', code: 'xj' },
                { text: '胁肋胀痛', code: 'xlzt' },
                { text: '脘腹胀满', code: 'wbzm' },
                { text: '腹痛', code: 'ft' },
                { text: '腹胀', code: 'fz' },
                { text: '嗳气', code: 'aq' },
                { text: '泛酸', code: 'fs' },
                { text: '恶心', code: 'ex' },
                { text: '呕吐', code: 'ot' },
                { text: '耳鸣', code: 'em' },
                { text: '鼻塞流涕', code: 'bslt' }
            ]}
        ]
    };

    // ========================================================================
    // 2. 数据访问 API（供冒烟测试/铁闸/未来扩展调用）
    // ========================================================================
    var SYMPTOM_FREQ_KEY = 'symptom_freq_v1';
    var _catIndex = {};   // text -> catId
    var _orderIndex = {}; // catId -> order
    (function buildIndex() {
        for (var ci = 0; ci < DICT.categories.length; ci++) {
            var cat = DICT.categories[ci];
            _orderIndex[cat.id] = cat.order;
            for (var ti = 0; ti < cat.terms.length; ti++) {
                _catIndex[cat.terms[ti].text] = cat.id;
            }
        }
    })();

    function search(q) {
        q = String(q || '').trim().toLowerCase();
        if (!q) return [];
        var out = [];
        for (var ci = 0; ci < DICT.categories.length; ci++) {
            var terms = DICT.categories[ci].terms;
            for (var ti = 0; ti < terms.length; ti++) {
                var t = terms[ti];
                // §3.3：中文 includes 包含匹配；简码 startsWith 前缀匹配（小写比较）
                if (t.text.indexOf(q) >= 0 ||
                    (t.code && t.code.toLowerCase().indexOf(q) === 0)) {
                    out.push({ text: t.text, code: t.code, cat: DICT.categories[ci].id });
                }
            }
        }
        return out;
    }

    // ========================================================================
    // 3. 面板组件（运行时注入，HTML 静态结构零改动）
    // ========================================================================
    var _symCursor = null;          // 光标缓存（§4.2 R1）
    var _selected = [];             // 已选词条 [{text, cat}]
    var _activeCat = 'zh';          // 当前分类
    var _freq = {};                 // 频次 {text: count}

    function loadFreq() {
        try {
            var raw = global.localStorage ? global.localStorage.getItem(SYMPTOM_FREQ_KEY) : null;
            if (raw) {
                var obj = JSON.parse(raw);
                if (obj && typeof obj === 'object') _freq = obj;
            }
        } catch (e) { _freq = {}; }
    }
    function saveFreq() {
        try {
            if (global.localStorage) global.localStorage.setItem(SYMPTOM_FREQ_KEY, JSON.stringify(_freq));
        } catch (e) { /* 存储失败不影响主流程 */ }
    }

    // §3.4 拼接：按分类 order 升序分组 → 组内「、」、组间「，」、末尾无标点
    function assembleText(selected) {
        var groups = {}, catIds = [];
        selected.slice().sort(function (a, b) {
            // 注意：order=0 是合法值，不可用 || 兜底（falsy 陷阱）
            var oa = (a.cat in _orderIndex) ? _orderIndex[a.cat] : 99;
            var ob = (b.cat in _orderIndex) ? _orderIndex[b.cat] : 99;
            return oa - ob;
        }).forEach(function (t) {
            if (!groups[t.cat]) { groups[t.cat] = []; catIds.push(t.cat); }
            groups[t.cat].push(t.text);
        });
        return catIds.map(function (c) { return groups[c].join('、'); }).join('，');
    }

    // §4.2 光标缓存插入
    function insertAtCursor(text) {
        var ta = document.getElementById('medicalHistory');
        if (!ta || !text) return;
        var pos = _symCursor || { start: ta.value.length, end: ta.value.length };
        var before = ta.value.slice(0, pos.start);
        // 智能补逗号：插入点前已有内容且前一字符不是标点/换行时，前置「，」
        var needComma = before.length > 0 && !/[，、,;；。\n]$/.test(before);
        var insertText = (needComma ? '，' : '') + text;
        ta.value = before + insertText + ta.value.slice(pos.end);
        var newPos = pos.start + insertText.length;
        try { ta.setSelectionRange(newPos, newPos); } catch (e) { /* 兼容旧内核 */ }
        ta.focus();
        _symCursor = { start: newPos, end: newPos }; // 支持连续多次插入
        // 同步处方笺预览（防御式跨 IIFE 调用，铁律）
        if (typeof global.updatePrescriptionPaper === 'function') global.updatePrescriptionPaper();
        else if (typeof updatePrescriptionPaper === 'function') updatePrescriptionPaper();
    }

    function openSymptomPanel() {
        var ta = document.getElementById('medicalHistory');
        if (!ta) { alert('症状输入框未找到'); return; }
        // ① 第一时间缓存光标（弹窗抢焦点会导致 selection 重置，R1）
        _symCursor = { start: ta.selectionStart, end: ta.selectionEnd };
        ensurePanelDom();
        renderChips();
        renderTerms();
        renderPreview();
        if (typeof global.showModal === 'function') global.showModal('symptomModal');
        else if (typeof showModal === 'function') showModal('symptomModal');
        else {
            var m = document.getElementById('symptomModal');
            if (m) m.style.display = 'flex';
        }
    }

    function closeSymptomPanel() {
        if (typeof global.closeModal === 'function') global.closeModal('symptomModal');
        else if (typeof closeModal === 'function') closeModal('symptomModal');
        else {
            var m = document.getElementById('symptomModal');
            if (m) m.style.display = 'none';
        }
        // §4.4/Y5：焦点回归症状输入框，医生可无缝继续手动输入
        var ta = document.getElementById('medicalHistory');
        if (ta && _symCursor) {
            try { ta.setSelectionRange(_symCursor.start, _symCursor.end); } catch (e) {}
            ta.focus();
        } else if (ta) ta.focus();
    }

    function confirmInsert() {
        if (!_selected.length) { showToastTip('请先选择词条'); return; }
        insertAtCursor(assembleText(_selected));
        // 频次记忆（§4.6）
        _selected.forEach(function (t) { _freq[t.text] = (_freq[t.text] || 0) + 1; });
        saveFreq();
        _selected = [];
        closeSymptomPanel();
    }

    // ---------- DOM 注入 ----------
    var _domReady = false;
    function injectStyle() {
        if (document.getElementById('symptomPanelStyle')) return;
        var st = document.createElement('style');
        st.id = 'symptomPanelStyle';
        st.textContent =
            '#symptomModal .modal-content{max-width:500px;width:92%;max-height:84vh;display:flex;flex-direction:column;}' +
            '#symptomSearch{width:100%;padding:6px 8px;border:1px solid #808080;border-radius:3px;font-size:13px;box-sizing:border-box;}' +
            '.sym-chips{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0;}' +
            '.sym-chip{padding:3px 10px;border:1px solid #808080;border-radius:10px;background:#f0f0f0;cursor:pointer;font-size:11px;}' +
            '.sym-chip.on{background:#008000;color:#fff;border-color:#008000;}' +
            '.sym-terms{display:flex;flex-wrap:wrap;gap:5px;max-height:180px;overflow-y:auto;padding:2px;align-content:flex-start;-webkit-overflow-scrolling:touch;}' +
            '.sym-term{padding:3px 10px;min-height:28px;border:1px solid #a0a0a0;border-radius:3px;background:#fff;cursor:pointer;font-size:12px;line-height:1.4;}' +
            '.sym-term:active{background:#e8e8e8;}' +
            '.sym-term.on{background:#e8f5e9;border-color:#008000;color:#008000;font-weight:bold;}' +
            '.sym-preview{margin-top:8px;padding:6px 8px;border:1px dashed #808080;border-radius:3px;background:#fafafa;font-size:12px;line-height:1.5;min-height:30px;}' +
            '.sym-preview .sym-pv-label{color:#666;}' +
            '.sym-preview .sym-pv-text{color:#006000;font-weight:bold;word-break:break-all;}' +
            '.sym-tip{margin-top:6px;font-size:10px;color:#999;}' +
            '.sym-mini-btn{font-size:10px;padding:1px 8px;border:1px solid #bbb;border-radius:8px;background:#fff;cursor:pointer;color:#666;}' +
            '@media screen and (max-width:768px){' +
            '  .sym-term{min-height:36px;font-size:13px;padding:5px 12px;}' + // Y3 触摸目标 ≥36px
            '  .sym-chip{min-height:32px;padding:5px 12px;font-size:12px;}' +
            '  .sym-terms{max-height:200px;}' +
            '}';
        document.head.appendChild(st);
    }

    function injectButton() {
        var tabs = document.querySelector('.history-tabs');
        if (!tabs || document.getElementById('symptomQuickBtn')) return false;
        var btn = document.createElement('div');
        btn.id = 'symptomQuickBtn';
        btn.className = 'history-tab';
        btn.style.background = '#e8f5e9';
        btn.style.color = '#008000';
        btn.style.marginLeft = 'auto';
        btn.style.fontWeight = 'bold';
        btn.textContent = '舌脉';
        btn.title = '舌脉体征快捷录入（Alt+S）';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openSymptomPanel();
        });
        tabs.appendChild(btn);
        return true;
    }

    function injectModal() {
        if (document.getElementById('symptomModal')) return;
        var m = document.createElement('div');
        m.id = 'symptomModal';
        m.className = 'modal';
        m.style.display = 'none';
        m.innerHTML =
            '<div class="modal-content">' +
            '  <div class="modal-header"><h3>舌脉体征快捷录入</h3><span class="close-btn" id="symptomCloseBtn">&times;</span></div>' +
            '  <div class="modal-body">' +
            '    <input type="text" id="symptomSearch" placeholder="搜索名称或拼音简码：sd=舌淡，mx=脉弦" autocomplete="off">' +
            '    <div class="sym-chips" id="symptomChips"></div>' +
            '    <div id="symptomTemplateTip" style="display:none;font-size:10px;color:#999;margin-bottom:4px;">模板为整串插入，不清空已选</div>' +
            '    <div class="sym-terms" id="symptomTerms"></div>' +
            '    <div class="sym-preview" id="symptomPreview"></div>' +
            '    <div class="sym-tip">点选词条快速录入，支持拼音简码搜索，Alt+S 快捷唤起 <button type="button" class="sym-mini-btn" id="symptomFreqReset">重置频次</button></div>' +
            '  </div>' +
            '  <div class="modal-footer">' +
            '    <button class="action-btn" id="symptomCancelBtn">取消</button>' +
            '    <button class="action-btn primary" id="symptomOkBtn">确认插入</button>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(m);

        document.getElementById('symptomCloseBtn').addEventListener('click', closeSymptomPanel);
        document.getElementById('symptomCancelBtn').addEventListener('click', closeSymptomPanel);
        document.getElementById('symptomOkBtn').addEventListener('click', confirmInsert);
        document.getElementById('symptomFreqReset').addEventListener('click', function () {
            if (confirm('确定重置词条使用频次吗？')) {
                _freq = {}; saveFreq(); renderTerms(); showToastTip('频次已重置');
            }
        });
        document.getElementById('symptomSearch').addEventListener('input', function () {
            renderTerms();
        });
        // 点击遮罩关闭（与现有 modal 行为一致由 closeModal 管理，此处兜底）
        m.addEventListener('click', function (e) { if (e.target === m) closeSymptomPanel(); });
    }

    function ensurePanelDom() {
        injectStyle();
        injectModal();
    }

    // ---------- 渲染 ----------
    function freqSorted(terms) {
        // §4.6：分类内按频次降序（stable，同频次保持词典原序）
        return terms.slice().sort(function (a, b) {
            return (_freq[b.text] || 0) - (_freq[a.text] || 0);
        });
    }

    function renderChips() {
        var box = document.getElementById('symptomChips');
        if (!box) return;
        var html = '';
        var cats = DICT.categories.slice().sort(function (a, b) { return a.order - b.order; });
        for (var i = 0; i < cats.length; i++) {
            html += '<div class="sym-chip' + (cats[i].id === _activeCat ? ' on' : '') + '" data-cat="' + cats[i].id + '">' + cats[i].name + '</div>';
        }
        box.innerHTML = html;
    }

    function renderTerms() {
        var box = document.getElementById('symptomTerms');
        if (!box) return;
        var searchEl = document.getElementById('symptomSearch');
        var q = searchEl ? searchEl.value.trim() : '';
        var list = [];
        if (q) {
            list = search(q); // 跨分类搜索结果
        } else {
            var cat = null;
            for (var i = 0; i < DICT.categories.length; i++) {
                if (DICT.categories[i].id === _activeCat) { cat = DICT.categories[i]; break; }
            }
            if (cat) list = freqSorted(cat.terms).map(function (t) { return { text: t.text, code: t.code, cat: cat.id }; });
        }
        var tip = document.getElementById('symptomTemplateTip');
        if (tip) tip.style.display = (!q && _activeCat === 'zh') ? 'block' : 'none';

        if (!list.length) {
            box.innerHTML = '<span style="font-size:11px;color:#999;padding:4px;">无匹配词条</span>';
            return;
        }
        var html = '';
        for (var j = 0; j < list.length; j++) {
            var sel = _selected.some(function (s) { return s.text === list[j].text; });
            var codeTip = list[j].code ? ' title="简码:' + list[j].code + '"' : '';
            html += '<div class="sym-term' + (sel ? ' on' : '') + '" data-text="' + list[j].text + '"' + codeTip + '>' + list[j].text + '</div>';
        }
        box.innerHTML = html;
    }

    function renderPreview() {
        var pv = document.getElementById('symptomPreview');
        if (!pv) return;
        if (!_selected.length) {
            pv.innerHTML = '<span class="sym-pv-label">已选：（点击词条试试，可连续多选、再点取消）</span>';
            return;
        }
        pv.innerHTML = '<span class="sym-pv-label">将插入：</span><span class="sym-pv-text">' + assembleText(_selected) + '</span>';
    }

    function showToastTip(msg) {
        if (typeof global.showToast === 'function') global.showToast(msg);
        else if (typeof showToast === 'function') showToast(msg);
        else alert(msg);
    }

    // ---------- 事件委托 ----------
    function bindPanelEvents() {
        var terms = document.getElementById('symptomTerms');
        var chips = document.getElementById('symptomChips');
        if (terms && !terms.__symBound) {
            terms.__symBound = true;
            terms.addEventListener('click', function (e) {
                var el = e.target.closest ? e.target.closest('.sym-term') : null;
                if (!el) return;
                var text = el.getAttribute('data-text');
                var catId = _catIndex[text] || 'zh';
                var idx = -1;
                for (var i = 0; i < _selected.length; i++) { if (_selected[i].text === text) { idx = i; break; } }
                if (idx >= 0) _selected.splice(idx, 1); // 反选
                else _selected.push({ text: text, cat: catId }); // 追加（Y6：模板追加不替换）
                renderTerms(); renderPreview();
            });
        }
        if (chips && !chips.__symBound) {
            chips.__symBound = true;
            chips.addEventListener('click', function (e) {
                var el = e.target.closest ? e.target.closest('.sym-chip') : null;
                if (!el) return;
                _activeCat = el.getAttribute('data-cat');
                var searchEl = document.getElementById('symptomSearch');
                if (searchEl) searchEl.value = ''; // 切分类清空搜索
                renderChips(); renderTerms();
            });
        }
    }

    // ---------- 自举 ----------
    function tryInit(retry) {
        retry = retry || 0;
        if (_domReady) return;
        var ok = injectButton();
        if (ok) {
            _domReady = true;
            injectStyle();
            injectModal();
            bindPanelEvents();
            loadFreq();
            return;
        }
        if (retry < 40) { // 40 x 250ms = 10s 兜底（等 SPA 场景 DOM 就绪）
            setTimeout(function () { tryInit(retry + 1); }, 250);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { tryInit(0); });
    } else {
        tryInit(0);
    }

    // Alt+S 快捷键（§4.7；避开 Alt+1 辨证选方、F1~F9）
    document.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
            var m = document.getElementById('symptomModal');
            if (m && m.style.display !== 'none' && m.style.display !== '') {
                closeSymptomPanel();
            } else {
                e.preventDefault();
                openSymptomPanel();
            }
        }
    });

    // ========================================================================
    // 4. 导出（供测试与 P3 自定义词条扩展）
    // ========================================================================
    global.SYMPTOM_DICT = DICT;
    global.SymptomDict = {
        version: DICT.version,
        search: search,
        assembleText: assembleText,
        openPanel: openSymptomPanel,
        closePanel: closeSymptomPanel,
        getFreq: function () { return JSON.parse(JSON.stringify(_freq)); }
    };
})(typeof window !== 'undefined' ? window : this);
