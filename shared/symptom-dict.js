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
// ============================================================
// 4. 诊断快速输入模块（2026-09-01 新增，权威源）
//    依据：《中医诊断学》教材 + GB/T 15657《中医病证分类与代码》
// ============================================================
(function (global) {
    'use strict';
    if (global.__diagQuickLoaded) return;
    global.__diagQuickLoaded = true;

    var DISEASE = [
        { t: '感冒', c: 'gm' }, { t: '时行感冒', c: 'sxgm' }, { t: '咳嗽', c: 'ks' },
        { t: '哮病', c: 'xbing' }, { t: '喘证', c: 'chuanzheng' }, { t: '肺胀', c: 'feizhang' },
        { t: '肺痈', c: 'feiyong' }, { t: '肺痨', c: 'feilao' }, { t: '肺痿', c: 'feiwei' },
        { t: '鼻渊', c: 'byuan' }, { t: '鼻窒', c: 'bzhi' }, { t: '喉痹', c: 'houbi' },
        { t: '乳蛾', c: 'rue' }, { t: '失音', c: 'shiyin' },
        { t: '心悸', c: 'xj' }, { t: '怔忡', c: 'zhengchong' }, { t: '胸痹', c: 'xiongb' },
        { t: '真心痛', c: 'zhenxintong' }, { t: '心衰', c: 'xinshuai' }, { t: '不寐', c: 'bumei' },
        { t: '多梦', c: 'duomeng' }, { t: '健忘', c: 'jianwang' }, { t: '狂病', c: 'kuangbing' },
        { t: '癫病', c: 'dianbing' }, { t: '痫病', c: 'xianbing' }, { t: '痴呆', c: 'chidai' },
        { t: '胃痛', c: 'weitong' }, { t: '痞满', c: 'piman' }, { t: '胃痞', c: 'weipi' },
        { t: '呕吐', c: 'outu' }, { t: '吐酸', c: 'tusuan' }, { t: '嘈杂', c: 'caoz' },
        { t: '噎膈', c: 'yege' }, { t: '呃逆', c: 'eni' }, { t: '腹痛', c: 'futong' },
        { t: '泄泻', c: 'xiexie' }, { t: '痢疾', c: 'liji' }, { t: '便秘', c: 'bianmi' },
        { t: '霍乱', c: 'huoluan' }, { t: '虫证', c: 'chongzheng' },
        { t: '胁痛', c: 'xietong' }, { t: '黄疸', c: 'huangdan' }, { t: '鼓胀', c: 'guzhang' },
        { t: '积聚', c: 'jiju' }, { t: '瘿病', c: 'yingbing' }, { t: '瘰疬', c: 'luoli' },
        { t: '疟疾', c: 'nueji' }, { t: '眩晕', c: 'xuanyun' }, { t: '头痛', c: 'toutong' },
        { t: '头风', c: 'toufeng' }, { t: '中风', c: 'zhongfeng' }, { t: '中风后遗症', c: 'zfyhz' },
        { t: '颤证', c: 'chanzheng' }, { t: '痉证', c: 'jingzheng' }, { t: '郁证', c: 'yuzheng' },
        { t: '水肿', c: 'shuizhong' }, { t: '淋证', c: 'linzheng' }, { t: '癃闭', c: 'longbi' },
        { t: '关格', c: 'guange' }, { t: '遗精', c: 'yijing' }, { t: '早泄', c: 'zaoxie' },
        { t: '阳痿', c: 'yangwei' }, { t: '不育', c: 'buyu' }, { t: '腰痛', c: 'yaotong' },
        { t: '遗尿', c: 'yiniao' }, { t: '尿浊', c: 'niaozhuo' },
        { t: '痰饮', c: 'tanyin' }, { t: '消渴', c: 'xiaoke' }, { t: '自汗', c: 'zihan' },
        { t: '盗汗', c: 'daohan' }, { t: '内伤发热', c: 'nsfr' }, { t: '虚劳', c: 'xulao' },
        { t: '血证', c: 'xuezheng' }, { t: '鼻衄', c: 'binv' }, { t: '咳血', c: 'kexue' },
        { t: '吐血', c: 'tuxue' }, { t: '便血', c: 'bianxue' }, { t: '尿血', c: 'niaoxue' },
        { t: '紫斑', c: 'ziban' }, { t: '肥胖', c: 'feipang' }, { t: '癌病', c: 'aibing' },
        { t: '厥证', c: 'juezheng' },
        { t: '痹证', c: 'bizheng' }, { t: '行痹', c: 'xingbi' }, { t: '痛痹', c: 'tongbi' },
        { t: '着痹', c: 'zhuobi' }, { t: '热痹', c: 'rebi' }, { t: '尪痹', c: 'wangbi' },
        { t: '痿证', c: 'weizheng' }, { t: '颈痹', c: 'jingbi' }, { t: '肩痹', c: 'jianbi' },
        { t: '跟痛症', c: 'gentongzheng' },
        { t: '疮疡', c: 'chuangyang' }, { t: '疖', c: 'jie' }, { t: '疔', c: 'ding' },
        { t: '痈', c: 'yong' }, { t: '疽', c: 'ju' }, { t: '发颐', c: 'fayi' },
        { t: '丹毒', c: 'dandu' }, { t: '瘿瘤', c: 'yingliu' }, { t: '乳癖', c: 'rupi' },
        { t: '乳痈', c: 'ruyong' }, { t: '乳岩', c: 'ruyan' }, { t: '湿疹', c: 'shizhen' },
        { t: '瘾疹', c: 'yinzhen' }, { t: '牛皮癣', c: 'niupixuan' }, { t: '白疕', c: 'baibi' },
        { t: '蛇串疮', c: 'shechuanchuang' }, { t: '油风', c: 'youfeng' }, { t: '粉刺', c: 'fenci' },
        { t: '黧黑斑', c: 'liheiban' }, { t: '冻疮', c: 'dongchuang' }, { t: '烧烫伤', c: 'shaotangshang' },
        { t: '破伤风', c: 'poshangfeng' }, { t: '精浊', c: 'jingzhuo' }, { t: '子痈', c: 'ziyong' },
        { t: '脱疽', c: 'tuoju' }, { t: '股肿', c: 'guzhong' },
        { t: '月经先期', c: 'yjxq' }, { t: '月经后期', c: 'yjhq' }, { t: '月经先后无定期', c: 'yjhxw' },
        { t: '月经过多', c: 'yjgd' }, { t: '月经过少', c: 'yjgs' }, { t: '经期延长', c: 'jqyc' },
        { t: '经间期出血', c: 'jjqc' }, { t: '崩漏', c: 'benglous' }, { t: '闭经', c: 'bijng' },
        { t: '痛经', c: 'tongjing' }, { t: '经行乳房胀痛', c: 'jxrfzt' }, { t: '经行头痛', c: 'jxtt' },
        { t: '经行发热', c: 'jxfr' }, { t: '经行泄泻', c: 'jxxx' }, { t: '绝经前后诸证', c: 'jjqhz' },
        { t: '带下过多', c: 'dxgd' }, { t: '带下过少', c: 'dxgs' }, { t: '妊娠恶阻', c: 'rsesz' },
        { t: '胎漏', c: 'tailou' }, { t: '胎动不安', c: 'tdba' }, { t: '滑胎', c: 'huatai' },
        { t: '子肿', c: 'zizhong' }, { t: '产后发热', c: 'chfr' }, { t: '产后腹痛', c: 'chft' },
        { t: '产后恶露不绝', c: 'clelbj' }, { t: '缺乳', c: 'queru' }, { t: '不孕症', c: 'buyunzheng' },
        { t: '癥瘕', c: 'zhengjia' }, { t: '阴痒', c: 'yinyang' }, { t: '阴挺', c: 'yinting' },
        { t: '肺炎喘嗽', c: 'fycsh' }, { t: '哮喘', c: 'xiaochuan' }, { t: '鹅口疮', c: 'ekouchuang' },
        { t: '口疮', c: 'kouchuang' }, { t: '厌食', c: 'yanshi' }, { t: '积滞', c: 'jizhi' },
        { t: '疳证', c: 'ganzheng' }, { t: '营养性缺铁性贫血', c: 'yytiepin' }, { t: '汗证', c: 'ethanzheng' },
        { t: '惊风', c: 'jingfeng' }, { t: '慢惊风', c: 'manjf' }, { t: '癫痫', c: 'dianxian' },
        { t: '急性肾小球肾炎', c: 'jxsxqy' }, { t: '肾病综合征', c: 'sbzhz' },
        { t: '五迟', c: 'wuci' }, { t: '五软', c: 'wuruan' }, { t: '麻疹', c: 'mazhen' },
        { t: '风痧', c: 'fengsha' }, { t: '丹痧', c: 'dansha' }, { t: '水痘', c: 'shuidou' },
        { t: '痄腮', c: 'zhasai' }, { t: '手足口病', c: 'szkb' }, { t: '顿咳', c: 'dunke' },
        { t: '小儿暑温', c: 'xeshuwen' }, { t: '疫毒痢', c: 'yiduli' },
        { t: '针眼', c: 'zhenyan' }, { t: '沙眼', c: 'shayan' }, { t: '目赤肿痛', c: 'muchztong' },
        { t: '圆翳内障', c: 'yyneizhang' }, { t: '脓耳', c: 'nonger' }, { t: '耳鸣', c: 'erming' },
        { t: '耳聋', c: 'erlong' }, { t: '鼻鼽', c: 'biqiu' }, { t: '牙痛', c: 'yatong' },
        { t: '牙宣', c: 'yaxuan' }
    ];

    var SYNDROMES = [
        { t: '表证', c: 'bz' }, { t: '里证', c: 'lz' }, { t: '寒证', c: 'hzheng' },
        { t: '热证', c: 'rzheng' }, { t: '虚证', c: 'xuzheng' }, { t: '实证', c: 'shizheng' },
        { t: '阴证', c: 'yinzheng' }, { t: '阳证', c: 'yangzheng' },
        { t: '表寒', c: 'biaohan' }, { t: '表热', c: 'biaore' }, { t: '里寒', c: 'lihan' },
        { t: '里热', c: 'lire' }, { t: '虚寒', c: 'xuhan' }, { t: '虚热', c: 'xure' },
        { t: '实寒', c: 'shihan' }, { t: '实热', c: 'shire' },
        { t: '寒热错杂', c: 'hrcz' }, { t: '虚实夹杂', c: 'xszajia' }, { t: '表里同病', c: 'bltb' },
        { t: '亡阳', c: 'wangyang' }, { t: '亡阴', c: 'wangyin' },
        { t: '心气虚', c: 'xinqx' }, { t: '心血虚', c: 'xinxx' }, { t: '心阴虚', c: 'xinyinxu' },
        { t: '心阳虚', c: 'xinyangxu' }, { t: '心火亢盛', c: 'xhkangsheng' }, { t: '心血瘀阻', c: 'xxyuzu' },
        { t: '痰蒙心神', c: 'tanmengxinshen' }, { t: '痰火扰神', c: 'tanhuoraoshen' }, { t: '小肠实热', c: 'xiaochangshire' },
        { t: '肺气虚', c: 'feiqx' }, { t: '肺阴虚', c: 'feiyinxu' },
        { t: '风寒束肺', c: 'fhshufei' }, { t: '风热犯肺', c: 'frfanfei' }, { t: '燥邪犯肺', c: 'zaoxiefanfei' },
        { t: '肺热炽盛', c: 'frcsheng' }, { t: '痰湿阻肺', c: 'tanshizufei' },
        { t: '痰热壅肺', c: 'tanyongfei' }, { t: '寒饮停肺', c: 'hantingfei' },
        { t: '大肠湿热', c: 'dachangshire' }, { t: '肠燥津亏', c: 'changzaojinkui' },
        { t: '脾气虚', c: 'piqx' }, { t: '脾阳虚', c: 'piyangxu' }, { t: '脾虚气陷', c: 'pxqx' },
        { t: '脾不统血', c: 'pbutongxue' }, { t: '寒湿困脾', c: 'hanskpi' }, { t: '湿热蕴脾', c: 'shiryp' },
        { t: '胃气虚', c: 'weiqx' }, { t: '胃阴虚', c: 'weiyinxu' }, { t: '胃阳虚', c: 'weiyangxu' },
        { t: '胃火炽盛', c: 'weihuo' }, { t: '寒滞胃脘', c: 'hanzhiweiwan' }, { t: '食滞胃脘', c: 'shizhiww' },
        { t: '肝气郁结', c: 'gqyj' }, { t: '肝火炽盛', c: 'ghcsheng' }, { t: '肝阳上亢', c: 'gyshangkang' },
        { t: '肝风内动', c: 'gfnendong' }, { t: '肝阳化风', c: 'gyhuafeng' }, { t: '热极生风', c: 'rejisfeng' },
        { t: '阴虚动风', c: 'yinxfdongfeng' }, { t: '血虚生风', c: 'xuexsfeng' },
        { t: '肝血虚', c: 'ganxx' }, { t: '肝阴虚', c: 'ganyinxu' },
        { t: '肝胆湿热', c: 'gandanshire' }, { t: '寒凝肝脉', c: 'hnganmai' }, { t: '胆郁痰扰', c: 'danyutanrao' },
        { t: '肾阳虚', c: 'shenyangxu' }, { t: '肾阴虚', c: 'shenyinxu' }, { t: '肾精不足', c: 'shenjingbuzu' },
        { t: '肾气不固', c: 'shenqibugu' }, { t: '肾不纳气', c: 'shenbunaqi' }, { t: '肾虚水泛', c: 'shenxshuifan' },
        { t: '膀胱湿热', c: 'pgshire' }, { t: '膀胱虚寒', c: 'pgxh' },
        { t: '太阳伤寒', c: 'tyshanghan' }, { t: '太阳中风', c: 'tyzhongfeng' },
        { t: '阳明经证', c: 'ymjingzheng' }, { t: '阳明腑证', c: 'ymfuzheng' },
        { t: '少阳证', c: 'shaoyangzheng' }, { t: '太阴证', c: 'taiyinzheng' },
        { t: '少阴寒化', c: 'shaoyinhanhua' }, { t: '少阴热化', c: 'shaoyinrehua' }, { t: '厥阴证', c: 'jueyinzheng' },
        { t: '卫分证', c: 'weifenzheng' }, { t: '气分证', c: 'qifenzheng' },
        { t: '营分证', c: 'yingfenzheng' }, { t: '血分证', c: 'xuefenzheng' },
        { t: '上焦病证', c: 'shangjiao' }, { t: '中焦病证', c: 'zhongjiao' }, { t: '下焦病证', c: 'xiajiao' },
        { t: '气虚', c: 'qx' }, { t: '气陷', c: 'qixian' }, { t: '气滞', c: 'qizhi' },
        { t: '气逆', c: 'qini' }, { t: '气闭', c: 'qibi' }, { t: '气脱', c: 'qituo' },
        { t: '血虚', c: 'xx' }, { t: '血瘀', c: 'xyu' }, { t: '血热', c: 'xre' }, { t: '血寒', c: 'xhan' },
        { t: '气血两虚', c: 'qxlx' }, { t: '气虚血瘀', c: 'qxxyu' }, { t: '气滞血瘀', c: 'qizhixyu' },
        { t: '气不摄血', c: 'qibushexue' }, { t: '气随血脱', c: 'qisuixuetuo' },
        { t: '津液亏虚', c: 'jykuixu' }, { t: '水湿停聚', c: 'sssjtiju' }, { t: '痰浊内阻', c: 'tanzuoneizu' },
        { t: '水饮内停', c: 'shuiyinting' },
        { t: '风淫', c: 'fengyin' }, { t: '寒淫', c: 'hanyin' }, { t: '暑淫', c: 'shuyin' },
        { t: '湿淫', c: 'shiyin' }, { t: '燥淫', c: 'zaoyin' }, { t: '火淫', c: 'huoyin' }
    ];

    var COMBOS = [
        { t: '感冒（风寒束表）', c: 'gmfh' }, { t: '感冒（风热犯表）', c: 'gmfr' },
        { t: '感冒（暑湿伤表）', c: 'gmss' },
        { t: '咳嗽（风寒袭肺）', c: 'ksfh' }, { t: '咳嗽（风热犯肺）', c: 'ksfr' },
        { t: '咳嗽（痰湿蕴肺）', c: 'ksts' }, { t: '咳嗽（痰热郁肺）', c: 'kstanyure' },
        { t: '咳嗽（肺阴亏虚）', c: 'ksfyxk' },
        { t: '哮病（冷哮）', c: 'xbl' }, { t: '哮病（热哮）', c: 'xbr' }, { t: '哮病（风痰哮）', c: 'xbft' }, { t: '哮病（虚哮）', c: 'xbxx' },
        { t: '喘证（风寒壅肺）', c: 'czfh' }, { t: '喘证（表寒肺热）', c: 'czbfr' },
        { t: '喘证（痰热郁肺）', c: 'cztry' }, { t: '喘证（痰浊阻肺）', c: 'cztzz' },
        { t: '喘证（肺气郁痹）', c: 'czfqyb' }, { t: '喘证（肺气虚耗）', c: 'czfqxh' }, { t: '喘证（肾虚不纳）', c: 'czsxbn' },
        { t: '肺胀（痰浊壅肺）', c: 'fztzyf' }, { t: '肺胀（痰热郁肺）', c: 'fztryf' },
        { t: '肺胀（阳虚水泛）', c: 'fzyxshf' }, { t: '肺胀（肺肾气虚）', c: 'fzfsqx' },
        { t: '心悸（心虚胆怯）', c: 'xjxxdq' }, { t: '心悸（心血不足）', c: 'xjxxbz' },
        { t: '心悸（阴虚火旺）', c: 'xjyxhhwang' }, { t: '心悸（心阳不振）', c: 'xjxybz' },
        { t: '心悸（水饮凌心）', c: 'xjsyilin' }, { t: '心悸（瘀阻心脉）', c: 'xjyzxm' },
        { t: '胸痹（心血瘀阻）', c: 'xbxxyzu' }, { t: '胸痹（气滞心胸）', c: 'xbqizxxiong' },
        { t: '胸痹（痰浊闭阻）', c: 'xbtzzu' }, { t: '胸痹（寒凝心脉）', c: 'xblnxm' },
        { t: '胸痹（气阴两虚）', c: 'xbqxlx' }, { t: '胸痹（心肾阴虚）', c: 'xbxsyyinxu' }, { t: '胸痹（心肾阳虚）', c: 'xbxsyangxu' },
        { t: '不寐（肝火扰心）', c: 'bmghrao' }, { t: '不寐（痰热扰心）', c: 'bmthrao' },
        { t: '不寐（心脾两虚）', c: 'bmxplx' }, { t: '不寐（心肾不交）', c: 'bmxsbujiao' }, { t: '不寐（心胆气虚）', c: 'bmxdqx' },
        { t: '胃痛（寒邪客胃）', c: 'wthxkw' }, { t: '胃痛（饮食伤胃）', c: 'wtvysw' },
        { t: '胃痛（肝气犯胃）', c: 'wtgqfw' }, { t: '胃痛（湿热中阻）', c: 'wtshirzz' },
        { t: '胃痛（瘀血停胃）', c: 'wtyxtw' }, { t: '胃痛（胃阴亏耗）', c: 'wtwykuhao' }, { t: '胃痛（脾胃虚寒）', c: 'wtpwxh' },
        { t: '痞满（饮食内停）', c: 'pmysnt' }, { t: '痞满（痰湿中阻）', c: 'pmtshizz' },
        { t: '痞满（湿热阻胃）', c: 'pmsrzeiw' }, { t: '痞满（肝胃不和）', c: 'pmgwbh' }, { t: '痞满（脾胃虚弱）', c: 'pmppxur' },
        { t: '呕吐（外邪犯胃）', c: 'otwxfanw' }, { t: '呕吐（食滞内停）', c: 'otsznt' },
        { t: '呕吐（痰饮内阻）', c: 'ottynzu' }, { t: '呕吐（肝气犯胃）', c: 'otgqfw' },
        { t: '呕吐（脾胃气虚）', c: 'otppqx' }, { t: '呕吐（脾胃阳虚）', c: 'otppyx' }, { t: '呕吐（胃阴不足）', c: 'otwybz' },
        { t: '泄泻（寒湿内盛）', c: 'xxhshns' }, { t: '泄泻（湿热伤中）', c: 'xxsrszhong' },
        { t: '泄泻（食滞肠胃）', c: 'xxszcw' }, { t: '泄泻（肝气乘脾）', c: 'xxgqcp' },
        { t: '泄泻（脾胃虚弱）', c: 'xxppxruo' }, { t: '泄泻（肾阳虚衰）', c: 'xxshenyxshuai' },
        { t: '痢疾（湿热痢）', c: 'ljshire' }, { t: '痢疾（疫毒痢）', c: 'ljyidu' },
        { t: '痢疾（寒湿痢）', c: 'ljhanshi' }, { t: '痢疾（阴虚痢）', c: 'ljyinxu' },
        { t: '痢疾（虚寒痢）', c: 'ljxuhan' }, { t: '痢疾（休息痢）', c: 'ljxxi' },
        { t: '便秘（热秘）', c: 'bmre' }, { t: '便秘（气秘）', c: 'bmqi' }, { t: '便秘（冷秘）', c: 'bmleng' },
        { t: '便秘（气虚秘）', c: 'bmqixu' }, { t: '便秘（血虚秘）', c: 'bmxuexu' },
        { t: '便秘（阴虚秘）', c: 'bmyinxu' }, { t: '便秘（阳虚秘）', c: 'bmyangxu' },
        { t: '胁痛（肝郁气滞）', c: 'xtgyqizhi' }, { t: '胁痛（肝胆湿热）', c: 'xtgandanshire' },
        { t: '胁痛（瘀血阻络）', c: 'xtxyuzuoluo' }, { t: '胁痛（肝络失养）', c: 'xtglsyang' },
        { t: '黄疸（阳黄·热重于湿）', c: 'hdryzys' }, { t: '黄疸（阳黄·湿重于热）', c: 'hdhwyzyr' },
        { t: '黄疸（阳黄·胆腑郁热）', c: 'hddfyure' }, { t: '黄疸（急黄·疫毒炽盛）', c: 'hdjhydcsheng' },
        { t: '黄疸（阴黄·寒湿阻遏）', c: 'hdyhhsze' }, { t: '黄疸（阴黄·脾虚湿滞）', c: 'hdyhpxshzhi' },
        { t: '头痛（风寒）', c: 'ttfh' }, { t: '头痛（风热）', c: 'ttfr' }, { t: '头痛（风湿）', c: 'ttfs' },
        { t: '头痛（肝阳）', c: 'ttgy' }, { t: '头痛（痰浊）', c: 'tttanz' },
        { t: '头痛（瘀血）', c: 'ttxyu' }, { t: '头痛（血虚）', c: 'ttxuexu' }, { t: '头痛（肾虚）', c: 'ttshenxu' },
        { t: '眩晕（肝阳上亢）', c: 'xygyshangkang' }, { t: '眩晕（气血亏虚）', c: 'xyqxkxuy' },
        { t: '眩晕（肾精不足）', c: 'xyshenjingbz' }, { t: '眩晕（痰湿中阻）', c: 'xytanshizz' }, { t: '眩晕（瘀血阻窍）', c: 'xyxyzuqiao' },
        { t: '中风（风痰瘀阻）', c: 'zfftyzu' }, { t: '中风（风阳上扰）', c: 'zffyshangrao' },
        { t: '中风（阴虚风动）', c: 'zffxfdfdong' }, { t: '中风（气虚络瘀）', c: 'zfqxlyu' }, { t: '中风（肝肾亏虚）', c: 'zfgsxukui' },
        { t: '水肿（风水相搏）', c: 'szfsxiangbo' }, { t: '水肿（湿毒浸淫）', c: 'szsdjyinyin' },
        { t: '水肿（水湿浸渍）', c: 'szssjinzi' }, { t: '水肿（湿热壅盛）', c: 'szshirysheng' },
        { t: '水肿（脾阳虚衰）', c: 'szpiyxshuai' }, { t: '水肿（肾阳衰微）', c: 'szshenyxsw' },
        { t: '淋证（热淋）', c: 'linzr' }, { t: '淋证（石淋）', c: 'linzs' }, { t: '淋证（血淋）', c: 'linzx' },
        { t: '淋证（气淋）', c: 'linzq' }, { t: '淋证（膏淋）', c: 'linzg' }, { t: '淋证（劳淋）', c: 'linzl' },
        { t: '郁证（肝气郁结）', c: 'yzgyyj' }, { t: '郁证（气郁化火）', c: 'yzqyhuahuo' },
        { t: '郁证（痰气郁结）', c: 'yztqyj' }, { t: '郁证（心神失养）', c: 'yzxsshyang' },
        { t: '郁证（心脾两虚）', c: 'yzxplx' }, { t: '郁证（心肾阴虚）', c: 'yzxsyinx' },
        { t: '消渴（肺热津伤·上消）', c: 'xkfrjsshxiao' }, { t: '消渴（胃热炽盛·中消）', c: 'xkwrcszxiao' },
        { t: '消渴（气阴亏虚·中消）', c: 'xkqykxzxiao' }, { t: '消渴（肾阴亏虚·下消）', c: 'xksyykxxxiao' }, { t: '消渴（阴阳两虚·下消）', c: 'xkyylxxxiao' },
        { t: '自汗盗汗（肺卫不固）', c: 'zhdhfwbgu' }, { t: '自汗盗汗（心血不足）', c: 'zhdhxxbz' },
        { t: '自汗盗汗（阴虚火旺）', c: 'zhdhyxhhw' }, { t: '自汗盗汗（邪热郁蒸）', c: 'zhdhxryz' },
        { t: '内伤发热（阴虚）', c: 'nsfryinx' }, { t: '内伤发热（血虚）', c: 'nsfrxuex' },
        { t: '内伤发热（气虚）', c: 'nsfrqix' }, { t: '内伤发热（阳虚）', c: 'nsfryangx' },
        { t: '内伤发热（气郁）', c: 'nsfrqiyu' }, { t: '内伤发热（痰湿）', c: 'nsfrtansh' }, { t: '内伤发热（血瘀）', c: 'nsfrxueyu' },
        { t: '虚劳（气虚）', c: 'xlqx' }, { t: '虚劳（血虚）', c: 'xlxuex' }, { t: '虚劳（阴虚）', c: 'xlyinx' }, { t: '虚劳（阳虚）', c: 'xlyangx' },
        { t: '痹证（行痹）', c: 'bizxb' }, { t: '痹证（痛痹）', c: 'biztongb' },
        { t: '痹证（着痹）', c: 'bizzhuob' }, { t: '痹证（热痹）', c: 'bizreb' }, { t: '痹证（尪痹）', c: 'bizwangb' },
        { t: '痿证（肺热津伤）', c: 'weizfrjs' }, { t: '痿证（湿热浸淫）', c: 'weizshirejy' },
        { t: '痿证（脾胃虚弱）', c: 'weizppxr' }, { t: '痿证（肝肾亏损）', c: 'weizgsxks' }, { t: '痿证（脉络瘀阻）', c: 'weizmlxyu' },
        { t: '月经先期（气虚）', c: 'yjxqqx' }, { t: '月经先期（血热）', c: 'yjxqxre' },
        { t: '月经先期（阴虚血热）', c: 'yjxqyxre' }, { t: '月经先期（肝郁血热）', c: 'yjxqgyxre' },
        { t: '月经后期（肾虚）', c: 'yjhqshenx' }, { t: '月经后期（血虚）', c: 'yjhqxuex' },
        { t: '月经后期（血寒）', c: 'yjhqxhan' }, { t: '月经后期（气滞）', c: 'yjhqqz' }, { t: '月经后期（痰湿）', c: 'yjhqtansh' },
        { t: '痛经（气滞血瘀）', c: 'tjqizhixueyu' }, { t: '痛经（寒凝血瘀）', c: 'tjhnxueyu' },
        { t: '痛经（湿热瘀阻）', c: 'tjshirxyuz' }, { t: '痛经（气血虚弱）', c: 'tjqxueruo' }, { t: '痛经（肾气亏损）', c: 'tjshenqikuis' },
        { t: '绝经前后诸证（肾阴虚）', c: 'jjqhzsyinx' },
        { t: '绝经前后诸证（肾阳虚）', c: 'jjqhzsyangx' },
        { t: '绝经前后诸证（肾阴阳俱虚）', c: 'jjqhzsyinyxjuxu' },
        { t: '带下过多（脾虚）', c: 'dxgdpxu' }, { t: '带下过多（肾阳虚）', c: 'dxgdshenyxu' },
        { t: '带下过多（阴虚夹湿）', c: 'dxgdyinxjs' },
        { t: '带下过多（湿热下注）', c: 'dxgdshirxz' }, { t: '带下过多（热毒蕴结）', c: 'dxgdrdyunjie' },
        { t: '肺炎喘嗽（风寒郁肺）', c: 'fycshfhyf' }, { t: '肺炎喘嗽（风热郁肺）', c: 'fycshfryf' },
        { t: '肺炎喘嗽（痰热闭肺）', c: 'fycshthbf' }, { t: '肺炎喘嗽（毒热闭肺）', c: 'fycshdrbf' },
        { t: '肺炎喘嗽（阴虚肺热）', c: 'fycshyxfr' }, { t: '肺炎喘嗽（肺脾气虚）', c: 'fycshfpqx' },
        { t: '厌食（脾失健运）', c: 'yspsjyun' }, { t: '厌食（脾胃气虚）', c: 'ysppqx' }, { t: '厌食（脾胃阴虚）', c: 'ysppyinx' },
        { t: '积滞（乳食内积）', c: 'jzrsnj' }, { t: '积滞（脾虚夹积）', c: 'jzpxsjj' },
        { t: '疳证（疳气）', c: 'ganzhengqi' }, { t: '疳证（疳积）', c: 'ganzhengji' }, { t: '疳证（干疳）', c: 'ganzhenggan' }
    ];

    var DISEASE_CATS = [
        { id:'fx', name:'肺系', key:['感冒','时行感冒','咳嗽','哮','喘','肺','鼻渊','鼻窒','喉痹','乳蛾','失音'] },
        { id:'xx', name:'心系', key:['心悸','怔忡','胸痹','真心痛','心衰','不寐','多梦','健忘','狂病','癫病','痫病','痴呆'] },
        { id:'pw', name:'脾胃', key:['胃痛','痞满','胃痞','呕吐','吐酸','嘈杂','噎膈','呃逆','腹痛','泄泻','痢疾','便秘','霍乱','虫证'] },
        { id:'gd', name:'肝胆', key:['胁痛','黄疸','鼓胀','积聚','瘿病','瘰疬','疟疾','眩晕','头痛','头风','中风','颤证','痉证','郁证'] },
        { id:'sx', name:'肾系膀胱', key:['水肿','淋证','癃闭','关格','遗精','早泄','阳痿','不育','腰痛','遗尿','尿浊'] },
        { id:'qxjy', name:'气血津液', key:['痰饮','消渴','自汗','盗汗','内伤发热','虚劳','血证','鼻衄','咳血','吐血','便血','尿血','紫斑','肥胖','癌病','厥证'] },
        { id:'jlzt', name:'经络肢体', key:['痹证','行痹','痛痹','着痹','热痹','尪痹','痿证','颈痹','肩痹','跟痛症'] },
        { id:'waik', name:'外科', key:['疮疡','疖','疔','痈','疽','发颐','丹毒','瘿瘤','乳癖','乳痈','乳岩','湿疹','瘾疹','牛皮癣','白疕','蛇串疮','油风','粉刺','黧黑斑','冻疮','烧烫伤','破伤风','精浊','子痈','脱疽','股肿'] },
        { id:'fuke', name:'妇科', key:['月经','经期','崩漏','闭经','痛经','经行','绝经','带下','妊娠','胎漏','胎动','滑胎','子肿','产后','缺乳','不孕','癥瘕','阴痒','阴挺'] },
        { id:'erke', name:'儿科', key:['哮喘','鹅口疮','口疮','厌食','积滞','疳证','营养性','汗证','惊风','慢惊风','癫痫','急性肾小球','肾病','遗尿','五迟','五软','麻疹','风痧','丹痧','水痘','痄腮','手足口','顿咳','暑温','疫毒痢','肺炎喘嗽'] },
        { id:'wug', name:'五官科', key:['针眼','沙眼','目赤','圆翳','脓耳','耳鸣','耳聋','鼻鼽','牙痛','牙宣'] }
    ];

    var SYND_CATS = [
        { id:'bg', name:'八纲', key:['表证','里证','寒证','热证','虚证','实证','阴证','阳证','表寒','表热','里寒','里热','虚寒','虚热','实寒','实热','寒热错杂','虚实夹杂','表里同病','亡阳','亡阴'] },
        { id:'zf', name:'脏腑', key:['心气','心血','心阴','心阳','心火','心血瘀阻','痰蒙心神','痰火扰神','小肠实热','肺气','肺阴','风寒束肺','风热犯肺','燥邪犯肺','肺热','痰湿阻肺','痰热壅肺','寒饮停肺','大肠湿热','肠燥','脾气','脾阳','脾虚气陷','脾不统血','寒湿困脾','湿热蕴脾','胃气','胃阴','胃阳','胃火','寒滞胃脘','食滞胃脘','肝气郁结','肝火','肝阳上亢','肝风内动','肝阳化风','热极生风','阴虚动风','血虚生风','肝血虚','肝阴虚','肝胆湿热','寒凝肝脉','胆郁痰扰','肾阳','肾阴','肾精不足','肾气不固','肾不纳气','肾虚水泛','膀胱湿热','膀胱虚寒'] },
        { id:'liuJing', name:'六经', key:['太阳伤寒','太阳中风','阳明经证','阳明腑证','少阳','太阴','少阴寒化','少阴热化','厥阴'] },
        { id:'wqy', name:'卫气营血', key:['卫分','气分','营分','血分'] },
        { id:'sj', name:'三焦', key:['上焦','中焦','下焦'] },
        { id:'qxyj', name:'气血津液/六淫', key:['气虚','气陷','气滞','气逆','气闭','气脱','血虚','血瘀','血热','血寒','气血两虚','气虚血瘀','气滞血瘀','气不摄血','气随血脱','津液亏虚','水湿停聚','痰浊内阻','水饮内停','风淫','寒淫','暑淫','湿淫','燥淫','火淫'] }
    ];

    function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function buildIndex(arr){var o=[];for(var i=0;i<arr.length;i++)o.push({t:arr[i].t,c:(arr[i].c||'').toLowerCase(),s:arr[i].t.toLowerCase()});return o;}
    var D_IDX=buildIndex(DISEASE),S_IDX=buildIndex(SYNDROMES),C_IDX=buildIndex(COMBOS);

    function searchAll(q,mc,md,ms){
        mc=mc||8;md=md||8;ms=ms||8;q=(q||'').trim().toLowerCase();if(!q)return[];
        var out=[];
        function rk(idx,type,lim){
            var h=[];for(var i=0;i<idx.length;i++){
                var it=idx[i],sc=0;
                if(it.c&&it.c.indexOf(q)===0)sc+=100;else if(it.c&&it.c.indexOf(q)>=0)sc+=60;
                if(it.s.indexOf(q)===0)sc+=90;else if(it.s.indexOf(q)>=0)sc+=50;
                if(sc>0)h.push({t:it.t,type:type,score:sc,c:it.c});
            }
            h.sort(function(a,b){return b.score-a.score;});return h.slice(0,lim);
        }
        out=out.concat(rk(C_IDX,'combo',mc));
        out=out.concat(rk(D_IDX,'disease',md));
        out=out.concat(rk(S_IDX,'syndrome',ms));
        return out;
    }

    var MRU_KEY='diag_mru_v1',MRU_CAP=12;
    function loadMRU(){try{var r=global.localStorage?global.localStorage.getItem(MRU_KEY):null;if(!r)return[];var a=JSON.parse(r);return Array.isArray(a)?a:[];}catch(e){return[];}}
    function saveMRU(a){try{if(global.localStorage)global.localStorage.setItem(MRU_KEY,JSON.stringify(a));}catch(e){}}
    function touchMRU(txt){
        var a=loadMRU(),idx=-1;
        for(var i=0;i<a.length;i++)if(a[i].t===txt){idx=i;break;}
        var now=Date.now();
        if(idx>=0){a[idx].count=(a[idx].count||0)+1;a[idx].ts=now;}
        else a.unshift({t:txt,ts:now,count:1});
        a.sort(function(x,y){
            var da=Math.max(1,(now-(x.ts||0))/86400000),db=Math.max(1,(now-(y.ts||0))/86400000);
            var sa=(x.count||0)*3+1/Math.log(1+da),sb=(y.count||0)*3+1/Math.log(1+db);
            return sb-sa;
        });
        if(a.length>MRU_CAP)a.length=MRU_CAP;
        saveMRU(a);
    }

    var DD_MAX=12,_ddEl=null,_ddList=[],_ddIndex=-1,_ddInput=null,_layoutInjected=false;
    function _injectLayout(){
        if(_layoutInjected)return;_layoutInjected=true;
        var s=document.createElement('style');s.id='diagQuickLayout';
        // 目标：1) 诊断框宽度扩大完美显示；2) 剂数输入框长度缩小 1/2
        // 基线（index.html 内联）：#diagnosis flex:1 1 183px / doseCountInput3 width 42px
        s.textContent='' +
          '.diagnosis-section{padding:2px 6px !important;}' +
          '.diagnosis-section .patient-row{flex-wrap:nowrap !important;gap:2px !important;margin-bottom:0 !important;align-items:center;}' +
          '.diagnosis-section .patient-row .patient-label{width:40px !important;padding-right:4px !important;}' +
          '.diagnosis-section .patient-row input#diagnosis{flex:1 1 380px !important;min-width:120px !important;max-width:none !important;}' +
          '@media (max-width:1280px){.diagnosis-section .patient-row input#diagnosis{flex:1 1 260px !important;}}' +
          '@media (max-width:1024px){.diagnosis-section .patient-row input#diagnosis{flex:1 1 200px !important;}}' +
          '.diagnosis-section .patient-row input#doseCountInput3{flex:0 0 22px !important;width:22px !important;padding:3px 2px !important;text-align:center;}' +
          '.diagnosis-section .patient-row input#doctorName{flex:0 0 60px !important;width:60px !important;}' +
          '#diagQuickBtn{margin-right:12px !important;}';
        document.head.appendChild(s);
    }
    function ensureDD(){
        _injectLayout();
        if(_ddEl)return;
        _ddEl=document.createElement('div');_ddEl.id='diagDropdown';
        _ddEl.style.cssText='position:absolute;z-index:99999;background:#fff;border:1px solid #808080;border-radius:3px;box-shadow:0 3px 10px rgba(0,0,0,.18);max-height:280px;overflow-y:auto;min-width:240px;font-size:13px;line-height:1.4;display:none;';
        _ddEl.addEventListener('mousedown',function(e){e.preventDefault();});
        _ddEl.addEventListener('click',function(e){var el=e.target.closest?e.target.closest('[data-v]'):null;if(!el)return;var i=Number(el.getAttribute('data-i'));if(!isNaN(i)&&_ddList[i])_selDD(i);});
        document.body.appendChild(_ddEl);
    }
    function _posDD(){if(!_ddEl||!_ddInput)return;var r=_ddInput.getBoundingClientRect();_ddEl.style.top=(window.scrollY+r.bottom+2)+'px';_ddEl.style.left=(window.scrollX+r.left)+'px';_ddEl.style.minWidth=(r.width>=200?r.width:200)+'px';}
    function _renderDD(){
        if(!_ddEl)return;if(!_ddList.length){_ddEl.style.display='none';return;}
        var h='';
        for(var i=0;i<_ddList.length;i++){
            var icon={combo:'📋',disease:'🏥',syndrome:'🧭',mru:'⏱️'}[_ddList[i].type]||'·';
            var on=_ddIndex===i?'background:#e8f5e9;color:#006000;':'';
            h+='<div data-i="'+i+'" data-v="1" style="padding:5px 10px;cursor:pointer;'+on+'border-bottom:1px dashed #eee;">'+
                '<span style="margin-right:6px;">'+icon+'</span>'+escapeHtml(_ddList[i].t)+
                (_ddList[i].c?'<span style="color:#999;font-size:11px;float:right;">'+_ddList[i].c+'</span>':'')+'</div>';
        }
        _ddEl.innerHTML=h;_ddEl.style.display='block';
    }
    function _buildList(q){
        q=(q||'').trim();var a=[];
        if(q){var r=searchAll(q,4,4,4);for(var i=0;i<r.length;i++)a.push(r[i]);if(a.length>DD_MAX)a.length=DD_MAX;}
        else{
            var m=loadMRU();for(var j=0;j<m.length&&j<8;j++)a.push({t:m[j].t,type:'mru',c:'',score:999});
            for(var k=0;k<COMBOS.length&&a.length<DD_MAX;k++){
                if(!a.some(function(x){return x.t===COMBOS[k].t;}))a.push({t:COMBOS[k].t,type:'combo',c:COMBOS[k].c,score:50});
            }
        }
        return a;
    }
    function _selDD(i){
        if(!_ddList[i]||!_ddInput)return;
        var txt=_ddList[i].t,cur=(_ddInput.value||'').trim(),type=_ddList[i].type;
        if(cur&&(type==='disease'||type==='syndrome')){
            var parts=cur.split(/[，,;；]+/).map(function(s){return s.trim();}).filter(Boolean);
            if(parts.indexOf(txt)<0)cur=parts.join('，')+'，'+txt;else cur=parts.join('，');
        }else cur=txt;
        _ddInput.value=cur;touchMRU(txt);_hideDD();_trig();_ddInput.focus();
    }
    function _hideDD(){if(_ddEl)_ddEl.style.display='none';_ddIndex=-1;_ddList=[];}
    function _trig(){
        if(typeof global.updatePrescriptionPaper==='function')global.updatePrescriptionPaper();
        if(typeof global.onDiagnosisChange==='function')try{global.onDiagnosisChange(_ddInput?_ddInput.value:'');}catch(e){}
    }
    function _onInput(){if(!_ddInput)return;_ddList=_buildList(_ddInput.value);_ddIndex=_ddList.length?0:-1;ensureDD();_posDD();_renderDD();}
    function _onKey(e){
        if(!_ddEl||_ddEl.style.display==='none'||!_ddList.length)return;
        if(e.key==='ArrowDown'){e.preventDefault();_ddIndex=(_ddIndex+1)%_ddList.length;_renderDD();_sc(_ddIndex);}
        else if(e.key==='ArrowUp'){e.preventDefault();_ddIndex=(_ddIndex-1+_ddList.length)%_ddList.length;_renderDD();_sc(_ddIndex);}
        else if(e.key==='Enter'){e.preventDefault();if(_ddIndex>=0)_selDD(_ddIndex);else _hideDD();}
        else if(e.key==='Escape'){e.preventDefault();_hideDD();}
        else if(e.key==='Tab'){_hideDD();}
    }
    function _sc(i){if(!_ddEl)return;var c=_ddEl.children[i];if(c)c.scrollIntoView({block:'nearest'});}
    function initDD(){
        var input=document.getElementById('diagnosis');if(!input||input.__diagBound)return;
        _ddInput=input;input.__diagBound=true;ensureDD();
        input.addEventListener('input',_onInput);input.addEventListener('focus',_onInput);input.addEventListener('keydown',_onKey);
        input.addEventListener('blur',function(){setTimeout(_hideDD,150);});
        document.addEventListener('scroll',function(){if(_ddEl&&_ddEl.style.display!=='none')_posDD();},true);
        // ★ 2026-09-01 冒烟沙箱兼容：smoke-runtime 的 window 桩无 addEventListener（document 桩有），
        //   无 DOM 环境下加载不得抛错（S7 红线），resize 监听降级为可选。
        try { window.addEventListener('resize',function(){if(_ddEl&&_ddEl.style.display!=='none')_posDD();}); } catch(_) {}
        document.addEventListener('mousedown',function(e){
            if(!_ddEl||_ddEl.style.display==='none')return;
            if(e.target===_ddEl||(_ddEl.contains&&_ddEl.contains(e.target)))return;
            if(e.target===input)return;_hideDD();
        });
    }

    var MOD_ID='diagQuickModal';
    var PANEL={mode:'combo',comboMode:'ds',diseases:[],syndromes:[]};
    function openPanel(){
        var inp=document.getElementById('diagnosis');if(!inp){alert('诊断输入框未找到');return;}
        _ensure();_renderPanel();
        if(typeof global.showModal==='function')global.showModal(MOD_ID);
        else{var m=document.getElementById(MOD_ID);if(m)m.style.display='flex';}
    }
    function closePanel(){
        if(typeof global.closeModal==='function')global.closeModal(MOD_ID);
        else{var m=document.getElementById(MOD_ID);if(m)m.style.display='none';}
        var inp=document.getElementById('diagnosis');if(inp)inp.focus();
    }
    function _ensure(){
        if(document.getElementById(MOD_ID+'_style'))return;
        var st=document.createElement('style');st.id=MOD_ID+'_style';
        st.textContent='#'+MOD_ID+' .modal-content{max-width:680px;width:95%;max-height:88vh;display:flex;flex-direction:column;}'+
            '#diagTabs{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;}'+
            '#diagTabs>div{padding:5px 14px;border:1px solid #888;border-radius:14px;cursor:pointer;font-size:12px;background:#f5f5f5;}'+
            '#diagTabs>div.on{background:#006400;color:#fff;border-color:#006400;font-weight:bold;}'+
            '#diagSubBar{margin:6px 0 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;}'+
            '#diagSubBar label{font-size:11px;color:#666;margin:0;}'+
            '#diagSubBar select{padding:3px;font-size:12px;border:1px solid #aaa;border-radius:3px;}'+
            '#diagSearchBox{width:100%;padding:5px 8px;font-size:13px;border:1px solid #888;border-radius:3px;margin-bottom:8px;box-sizing:border-box;}'+
            '#diagGrid{display:flex;gap:12px;flex-wrap:wrap;max-height:280px;overflow-y:auto;align-content:flex-start;padding:4px;}'+
            '.diag-cell{padding:4px 10px;font-size:12px;border:1px solid #b0b0b0;border-radius:3px;background:#fff;cursor:pointer;line-height:1.5;}'+
            '.diag-cell:hover{background:#eef7ee;}.diag-cell.on{background:#e8f5e9;color:#006400;border-color:#006400;font-weight:bold;}'+
            '.diag-cat{flex:1 1 100%;font-size:11px;color:#006400;font-weight:bold;margin:6px 2px 0 2px;border-bottom:1px dotted #888;padding-bottom:2px;}'+
            '#diagPreview{margin-top:10px;padding:8px;border:1px dashed #888;border-radius:4px;background:#fafafa;font-size:13px;line-height:1.5;min-height:46px;}'+
            '#diagPreview b{color:#006400;}'+
            '.diag-mru{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;}'+
            '.diag-mru>div{padding:3px 8px;font-size:11px;background:#fff3e0;border:1px solid #ffb74d;border-radius:10px;cursor:pointer;}.diag-mru>div:hover{background:#ffe0b2;}';
        document.head.appendChild(st);
        var m=document.createElement('div');m.id=MOD_ID;m.className='modal';m.style.display='none';
        m.innerHTML='<div class="modal-content">'+
            '<div class="modal-header"><h3>Alt+D 诊断快速录入</h3><span class="close-btn" id="diagCloseBtn">&times;</span></div>'+
            '<div class="modal-body">'+
              '<div id="diagTabs"><div data-m="combo">📋 高频组合</div><div data-m="disease">🏥 病名</div><div data-m="syndrome">🧭 证型</div></div>'+
              '<div id="diagSubBar"><label>组合模式：</label>'+
                '<select id="diagComboMode"><option value="ds">病名+证型（如：感冒（风寒束表））</option><option value="d">仅病名</option><option value="s">仅证型</option></select>'+
                '<span style="margin-left:auto;font-size:11px;color:#999;">多选：病名可多选，证型可多选</span>'+
              '</div>'+
              '<div id="diagMRU" class="diag-mru"></div>'+
              '<input type="text" id="diagSearchBox" placeholder="搜索：拼音简码/中文，如 gm/感冒/风寒…" autocomplete="off">'+
              '<div id="diagGrid"></div>'+
              '<div id="diagPreview">将填入：<b>（请选择）</b></div>'+
            '</div>'+
            '<div class="modal-footer">'+
              '<button class="action-btn" id="diagCancelBtn">取消</button>'+
              '<button class="action-btn" id="diagResetBtn">清空已选</button>'+
              '<button class="action-btn primary" id="diagOkBtn">确认填入</button>'+
            '</div></div>';
        document.body.appendChild(m);
        document.getElementById('diagCloseBtn').onclick=closePanel;
        document.getElementById('diagCancelBtn').onclick=closePanel;
        document.getElementById('diagResetBtn').onclick=function(){PANEL.diseases=[];PANEL.syndromes=[];_renderPanel();};
        document.getElementById('diagOkBtn').onclick=function(){
            var t=_build();if(!t){alert('请先选择诊断');return;}
            var inp=document.getElementById('diagnosis');if(inp)inp.value=t;
            touchMRU(t);_trig();closePanel();
        };
        var tabs=document.getElementById('diagTabs');
        tabs.onclick=function(e){var el=e.target.closest?e.target.closest('[data-m]'):null;if(!el)return;PANEL.mode=el.getAttribute('data-m');_renderPanel();};
        document.getElementById('diagComboMode').onchange=function(){PANEL.comboMode=this.value;_prev();};
        document.getElementById('diagSearchBox').oninput=_renderGrid;
        m.onclick=function(e){if(e.target===m)closePanel();};
        document.getElementById('diagMRU').onclick=function(e){
            var el=e.target.closest?e.target.closest('[data-t]'):null;if(!el)return;var t=el.getAttribute('data-t');
            var inp=document.getElementById('diagnosis');if(inp)inp.value=t;touchMRU(t);_trig();closePanel();
        };
    }
    function _renderPanel(){
        var t=document.getElementById('diagTabs');if(t)for(var i=0;i<t.children.length;i++){var c=t.children[i];c.getAttribute('data-m')===PANEL.mode?c.classList.add('on'):c.classList.remove('on');}
        var sb=document.getElementById('diagSubBar');if(sb)sb.style.display=(PANEL.mode==='disease'||PANEL.mode==='syndrome')?'flex':'none';
        var cm=document.getElementById('diagComboMode');if(cm&&cm.value!==PANEL.comboMode)cm.value=PANEL.comboMode;
        _renderMRU();_renderGrid();_prev();
    }
    function _renderMRU(){
        var b=document.getElementById('diagMRU');if(!b)return;var a=loadMRU();if(!a.length){b.innerHTML='';return;}
        var h='<span style="font-size:11px;color:#888;align-self:center;">最近：</span>';
        for(var i=0;i<Math.min(8,a.length);i++)h+='<div data-t="'+escapeHtml(a[i].t)+'">'+escapeHtml(a[i].t)+'</div>';
        b.innerHTML=h;
    }
    function _fi(t,c,q){if(!q)return true;var tl=t.toLowerCase(),cl=(c||'').toLowerCase();return tl.indexOf(q)>=0||(cl&&cl.indexOf(q)>=0);}
    function _in(t,a){return a.indexOf(t)>=0;}
    function _renderGrid(){
        var g=document.getElementById('diagGrid');if(!g)return;
        var q=(document.getElementById('diagSearchBox').value||'').trim().toLowerCase();var html='';
        if(PANEL.mode==='combo'){
            for(var i=0;i<COMBOS.length;i++){var it=COMBOS[i];if(!_fi(it.t,it.c,q))continue;html+='<div class="diag-cell" data-kind="combo" data-t="'+escapeHtml(it.t)+'">'+escapeHtml(it.t)+(it.c?'<span style="color:#999;margin-left:4px;font-size:10px;">'+it.c+'</span>':'')+'</div>';}
        }else if(PANEL.mode==='disease'){
            for(var ci=0;ci<DISEASE_CATS.length;ci++){var cat=DISEASE_CATS[ci];var lines='';
                for(var di=0;di<DISEASE.length;di++){var dis=DISEASE[di];var mk=false;
                    for(var ki=0;ki<cat.key.length;ki++)if(dis.t.indexOf(cat.key[ki])>=0){mk=true;break;}
                    if(!mk)continue;if(!_fi(dis.t,dis.c,q))continue;
                    lines+='<div class="diag-cell'+(_in(dis.t,PANEL.diseases)?' on':'')+'" data-kind="disease" data-t="'+escapeHtml(dis.t)+'">'+escapeHtml(dis.t)+(dis.c?'<span style="color:#999;margin-left:4px;font-size:10px;">'+dis.c+'</span>':'')+'</div>';}
                if(lines)html+='<div class="diag-cat">'+cat.name+'</div>'+lines;
            }
        }else{
            for(var ci2=0;ci2<SYND_CATS.length;ci2++){var c2=SYND_CATS[ci2];var l2='';
                for(var si=0;si<SYNDROMES.length;si++){var s=SYNDROMES[si];var mk2=false;
                    for(var ki2=0;ki2<c2.key.length;ki2++)if(s.t.indexOf(c2.key[ki2])>=0){mk2=true;break;}
                    if(!mk2)continue;if(!_fi(s.t,s.c,q))continue;
                    l2+='<div class="diag-cell'+(_in(s.t,PANEL.syndromes)?' on':'')+'" data-kind="syndrome" data-t="'+escapeHtml(s.t)+'">'+escapeHtml(s.t)+(s.c?'<span style="color:#999;margin-left:4px;font-size:10px;">'+s.c+'</span>':'')+'</div>';}
                if(l2)html+='<div class="diag-cat">'+c2.name+'</div>'+l2;
            }
        }
        if(!html)html='<div style="font-size:12px;color:#999;padding:6px;">无匹配诊断</div>';
        g.innerHTML=html;
        g.onclick=function(e){
            var cell=e.target.closest?e.target.closest('.diag-cell'):null;if(!cell)return;
            var k=cell.getAttribute('data-kind'),t=cell.getAttribute('data-t');
            if(k==='combo'){var inp=document.getElementById('diagnosis');if(inp)inp.value=t;touchMRU(t);_trig();closePanel();return;}
            if(k==='disease'){var idx=PANEL.diseases.indexOf(t);idx>=0?PANEL.diseases.splice(idx,1):PANEL.diseases.push(t);}
            if(k==='syndrome'){var ix=PANEL.syndromes.indexOf(t);ix>=0?PANEL.syndromes.splice(ix,1):PANEL.syndromes.push(t);}
            _renderGrid();_prev();
        };
    }
    function _build(){
        if(PANEL.mode==='combo')return'';
        var d=PANEL.diseases,s=PANEL.syndromes;
        if(PANEL.comboMode==='d')return d.join('，');
        if(PANEL.comboMode==='s')return s.join('，');
        if(!d.length&&!s.length)return'';
        if(!d.length)return s.join('，');if(!s.length)return d.join('，');
        var st=s.join('、');if(d.length===1)return d[0]+'（'+st+'）';
        return d.map(function(x){return x+'（'+st+'）';}).join('，');
    }
    function _prev(){
        var pv=document.getElementById('diagPreview');if(!pv)return;
        if(PANEL.mode==='combo'){pv.innerHTML='说明：<b>点击组合直接填入</b>；切「病名/证型」可多选后按组合模式拼接。';return;}
        var t=_build();pv.innerHTML='将填入：'+(t?'<b>'+escapeHtml(t)+'</b>':'<span style="color:#999">（请选择病名或证型）</span>');
    }
    function _injBtn(){
        var inp=document.getElementById('diagnosis');if(!inp||document.getElementById('diagQuickBtn'))return!!inp;
        var p=inp.parentElement;if(!p)return false;
        var b=document.createElement('span');b.id='diagQuickBtn';b.textContent='诊断';b.title='诊断快速录入（Alt+D）';
        b.style.cssText='display:inline-block;padding:1px 8px;font-size:12px;border:1px solid #888;border-radius:10px;background:#e8f5e9;color:#006400;margin-left:4px;cursor:pointer;font-weight:600;';
        b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openPanel();});
        if(inp.nextSibling)p.insertBefore(b,inp.nextSibling);else p.appendChild(b);
        return true;
    }
    function initAll(r){
        r=r||0;
        if(document.body){initDD();_injBtn();_ensure();}
        if(!document.getElementById('diagnosis')||!document.body){if(r<40)setTimeout(function(){initAll(r+1);},250);return;}
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){initAll(0);});else initAll(0);
    document.addEventListener('keydown',function(e){
        if(e.altKey&&(e.key==='d'||e.key==='D')){
            var m=document.getElementById(MOD_ID);
            if(m&&m.style.display!=='none'&&m.style.display!=='')closePanel();
            else{e.preventDefault();openPanel();}
        }
    });
    global.DIAG={DISEASE:DISEASE,SYNDROMES:SYNDROMES,COMBOS:COMBOS,search:searchAll,openPanel:openPanel,closePanel:closePanel,loadMRU:loadMRU,touchMRU:touchMRU};
})(typeof window!=='undefined'?window:this);
