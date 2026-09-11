// ============================================================================
//  stock-core.js —— 药品库存管理核心（P1 闭环 + P2 出入库流水 · 2026-09-11）
//
//  架构（对齐 auth-core 自安装钩子模式，index.html 仅 4 处一行式锚点编辑）：
//    ① 保存处方自动扣库存：包装 savePrescriptionToDB（唯一落库收口点）
//       扣减公式 = 每味药用量(dosage) × 剂数(doseCount)，单位同药品单位（g）
//    ② 同日覆盖/修改历史处方：差值冲正——处方记录携带 __stockApplied 幂等标记
//       （{v,at,items:{药名:已扣量}}），重存时只扣增量/退回减量，回收站恢复
//       天然 no-op（标记随记录同步），彻底删除时冲回（有标记才冲，防幻影退回）
//    ③ 库存预警：药品 m.stockThreshold（0=不预警），低于阈值红字 + 药品管理
//       tab 红点；拾药下拉显示 [库存:N]（灰=充足 红=不足本次所需）
//    ④ 出入库流水：入库登记 / 处方消耗 / 处方调整 / 删除冲回 / 盘点调整
//       （药品编辑弹窗改库存数自动记"盘点调整"），localStorage 上限 3000 条
//    ⑤ 开关：基础设置注入「启用库存管理」复选框，默认关闭——老用户升级后
//       行为零变化；未启用时全部钩子 no-op、全部 UI 注入隐藏
//
//  数据落点（与药品库同域，均为本机存储，无服务端改动）：
//    开关   local_stockMgmtEnabled ('true'/'false')
//    阈值   medicines[].stockThreshold（随药品库 JSON 持久化）
//    流水   stock_ledger_v1（数组，新条目在前，cap 3000）
//    标记   处方记录.__stockApplied（随处方 IndexedDB/云端同步）
//
//  跨端一致性：本文件为权威源（shared/），由 sync-all.ps1 分发；
//    index.html 端的 4 处锚点编辑各端字节一致（html-sync-check / 人工核对）。
//
//  药品数组跨作用域访问：medicines 是各端 inline script 的顶层 let（非
//    window 属性），本模块通过 Function 构造器（全局作用域）拿到活数组
//    直接改库存并镜像写 localStorage，UI 数组、medicineMap、持久层三者
//    始终同源一致。
// ============================================================================
(function (global) {
    'use strict';

    var ENABLE_KEY = 'local_stockMgmtEnabled';
    var LEDGER_KEY = 'stock_ledger_v1';
    var LEDGER_CAP = 3000;

    // ------------------------------------------------------------------
    //  基础工具
    // ------------------------------------------------------------------
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function round2(n) { return Math.round(n * 100) / 100; }
    function isEnabled() { try { return localStorage.getItem(ENABLE_KEY) === 'true'; } catch (e) { return false; } }
    function setEnabled(v) {
        try { localStorage.setItem(ENABLE_KEY, v ? 'true' : 'false'); } catch (e) {}
    }
    function toast(msg) {
        try { if (typeof global.showToast === 'function') { global.showToast(msg); return; } } catch (e) {}
        try { console.log('[StockCore] ' + msg); } catch (e) {}
    }
    function operator() {
        try { return (global.currentUser && (global.currentUser.name || global.currentUser.username)) || 'unknown'; } catch (e) { return 'unknown'; }
    }
    // 活数组（与 UI 同源）：medicines 是各端 inline script 顶层 let（全局词法绑定），
    // 所有经典 script 共享同一全局词法环境，直接按标识符即可跨脚本读取；
    // 禁用 new Function/eval 取值——云端网页 CSP 拦 unsafe-eval 会静默失败（实测踩坑）
    function getMedArrayLive() {
        try {
            return (typeof medicines !== 'undefined' && Array.isArray(medicines)) ? medicines : null;
        } catch (e) { return null; } // TDZ（先于 inline script 初始化调用）：降级 localStorage
    }
    // 药品列表（只读用途）：优先活数组，降级 localStorage 解析副本
    function getMedList() {
        var live = getMedArrayLive();
        if (live) return live;
        try {
            var arr = JSON.parse(localStorage.getItem('local_medicines') || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    // 活引用（UI 同步用）：优先走各端全局 getMedicineByName（medicineMap 活引用）
    function getMedLive(name) {
        try { if (typeof global.getMedicineByName === 'function') return global.getMedicineByName(name) || null; } catch (e) {}
        return null;
    }
    function getThreshold(m) { return (m && parseFloat(m.stockThreshold) > 0) ? parseFloat(m.stockThreshold) : 0; }
    function isLowStock(m) {
        if (!m) return false;
        var t = getThreshold(m);
        if (t <= 0) return false;
        return (parseFloat(m.stock) || 0) <= t;
    }
    function lowStockList() {
        return getMedList().filter(isLowStock);
    }

    // ------------------------------------------------------------------
    //  持久化：活数组优先改（UI 数组即药品库真身），localStorage 同步镜像，
    //  electron 端再经 saveMedicinesToDisk 落用户数据盘
    // ------------------------------------------------------------------
    function persistList(list) {
        try { localStorage.setItem('local_medicines', JSON.stringify(list)); } catch (e) { console.warn('[StockCore] 药品库镜像写入失败:', e); }
        try { if (typeof global.saveMedicinesToDisk === 'function') global.saveMedicinesToDisk(); } catch (e) {}
    }
    // 对某药品库存加 delta（可负），返回新结存（null=未找到药品）
    function applyStockDelta(name, delta) {
        var arr = getMedArrayLive();
        if (arr) {
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && arr[i].name === name) {
                    arr[i].stock = round2((parseFloat(arr[i].stock) || 0) + delta);
                    persistList(arr);
                    return arr[i].stock;
                }
            }
            return null; // 活数组中无此药（已删/改名）：不再降级，防双源不一致
        }
        var list = getMedList();
        for (var j = 0; j < list.length; j++) {
            if (list[j] && list[j].name === name) {
                list[j].stock = round2((parseFloat(list[j].stock) || 0) + delta);
                persistList(list);
                return list[j].stock;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------
    //  流水账
    // ------------------------------------------------------------------
    var TYPE_LABEL = { 'in': '入库', 'rx': '处方消耗', 'rx-adj': '处方调整', 'rx-revert': '删除冲回', 'adj': '盘点调整' };
    function getLedger() {
        try {
            var arr = JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }
    function saveLedger(arr) {
        try {
            if (!Array.isArray(arr)) return;
            if (arr.length > LEDGER_CAP) arr = arr.slice(0, LEDGER_CAP);
            localStorage.setItem(LEDGER_KEY, JSON.stringify(arr));
        } catch (e) { console.warn('[StockCore] 流水落盘失败:', e); }
    }
    function pushEntry(e) {
        var arr = getLedger();
        arr.unshift(e);
        saveLedger(arr);
    }
    function makeEntry(name, type, qty, stock, note) {
        return {
            t: new Date().toISOString(),
            name: name,
            type: type,
            qty: round2(qty),
            stock: (stock === null || stock === undefined) ? null : round2(stock),
            op: operator(),
            note: note || ''
        };
    }

    // ------------------------------------------------------------------
    //  ① 处方扣减引擎（差值冲正 + 幂等标记）
    // ------------------------------------------------------------------
    // 纯计算：不产生副作用。返回 {hasChanges, deltas:[{name,delta}], marker}
    function planDeduction(record) {
        var items = (record && Array.isArray(record.items)) ? record.items : [];
        var dose = parseInt(record && record.doseCount, 10) || 0;
        var need = {};
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it || !it.name) continue;
            var q = (parseFloat(it.dosage) || 0) * dose;
            if (Math.abs(q) < 0.01) continue;
            need[it.name] = round2((need[it.name] || 0) + q);
        }
        var prev = {};
        try {
            if (record && record.__stockApplied && record.__stockApplied.items &&
                typeof record.__stockApplied.items === 'object') {
                prev = record.__stockApplied.items;
            }
        } catch (e) {}
        var deltas = [];
        var name;
        for (name in need) {
            if (!need.hasOwnProperty(name)) continue;
            var d = round2(need[name] - (parseFloat(prev[name]) || 0));
            if (Math.abs(d) >= 0.01) deltas.push({ name: name, delta: d });
        }
        for (name in prev) { // 处方中已删除的药味：全额退回
            if (!prev.hasOwnProperty(name)) continue;
            if (!(name in need)) {
                var d2 = -round2(parseFloat(prev[name]) || 0);
                if (Math.abs(d2) >= 0.01) deltas.push({ name: name, delta: d2 });
            }
        }
        return {
            hasChanges: deltas.length > 0,
            deltas: deltas,
            marker: { v: 1, at: new Date().toISOString(), items: need }
        };
    }
    // 应用扣减计划：改库存 + 记流水，返回预警清单 [{name, stock, threshold}]
    function commitDeduction(plan, rxNo, isFirstApply) {
        var warns = [];
        if (!plan || !plan.hasChanges) return warns;
        for (var i = 0; i < plan.deltas.length; i++) {
            var d = plan.deltas[i];
            var next = applyStockDelta(d.name, -d.delta);
            if (next === null) continue; // 药品库无此药（已删/改名）：跳过
            pushEntry(makeEntry(d.name, isFirstApply ? 'rx' : 'rx-adj', d.delta, next, rxNo ? '处方 ' + rxNo : ''));
            var live = getMedLive(d.name) || getMedList().filter(function (m) { return m.name === d.name; })[0];
            if (live && isLowStock(live)) warns.push({ name: d.name, stock: live.stock, threshold: getThreshold(live) });
            else if (live && (parseFloat(live.stock) || 0) < 0) warns.push({ name: d.name, stock: live.stock, threshold: 0 });
        }
        refreshUI();
        return warns;
    }
    // 彻底删除冲回：有 __stockApplied 标记才冲（防幻影退回）
    function revertRecord(record) {
        var applied = null;
        try { applied = record && record.__stockApplied && record.__stockApplied.items; } catch (e) {}
        if (!applied) return 0;
        var n = 0;
        var rxNo = (record && (record.prescriptionNo || record.outpatientNo)) || '';
        for (var name in applied) {
            if (!applied.hasOwnProperty(name)) continue;
            var qty = parseFloat(applied[name]) || 0;
            if (Math.abs(qty) < 0.01) continue;
            var next = applyStockDelta(name, qty);
            if (next === null) continue;
            pushEntry(makeEntry(name, 'rx-revert', qty, next, rxNo ? '处方 ' + rxNo + ' 删除冲回' : '删除冲回'));
            n++;
        }
        if (n > 0) refreshUI();
        return n;
    }
    function notifyLowStock(warns) {
        if (!warns || !warns.length) return;
        var parts = warns.slice(0, 3).map(function (w) {
            return w.name + '(结存' + w.stock + (w.threshold > 0 ? '/阈值' + w.threshold : '') + ')';
        });
        toast('⚠ 库存预警：' + parts.join('、') + (warns.length > 3 ? ' 等' + warns.length + ' 项' : ''));
    }

    // ------------------------------------------------------------------
    //  ② 入库 / 盘点
    // ------------------------------------------------------------------
    function stockIn(name, qty, note) {
        qty = parseFloat(qty) || 0;
        if (!name || Math.abs(qty) < 0.01) return false;
        var next = applyStockDelta(name, qty);
        if (next === null) return false;
        pushEntry(makeEntry(name, 'in', qty, next, note || ''));
        refreshUI();
        return true;
    }
    function recordManualAdjust(name, oldStock, newStock, note) {
        var diff = round2((parseFloat(newStock) || 0) - (parseFloat(oldStock) || 0));
        if (Math.abs(diff) < 0.01) return false;
        pushEntry(makeEntry(name, 'adj', diff, parseFloat(newStock) || 0, note || ''));
        return true;
    }

    // ------------------------------------------------------------------
    //  ③ UI 渲染辅助（供 index.html 锚点模板调用）
    // ------------------------------------------------------------------
    function stockText(m) {
        var s = (m && m.stock !== undefined && m.stock !== null) ? m.stock : 0;
        if (!isEnabled()) return String(s);
        var low = isLowStock(m);
        var neg = (parseFloat(s) || 0) < 0;
        if (low || neg) {
            var t = '<span style="color:#e53935;font-weight:bold;">' + esc(s);
            if (low && getThreshold(m) > 0) t += ' ⚠';
            t += '</span>';
            return t;
        }
        return String(s);
    }
    function currentDoseCount() {
        var ids = ['doseCountInput3', 'doseCountInput', 'doseCountInput3M', 'doseCountInput2'];
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (el && el.value) { var v = parseInt(el.value, 10); if (v > 0) return v; }
        }
        return 7;
    }
    function dropBadge(m) {
        if (!isEnabled() || !m) return '';
        var s = parseFloat(m.stock) || 0;
        var need = (parseFloat(m.dosage) || 0) * currentDoseCount();
        var insufficient = need > 0 && s > 0 && s < need;
        var low = isLowStock(m);
        if (s <= 0 && !insufficient && !low) return ''; // 0=未维护，不显示（噪音控制）
        var color = (insufficient || low) ? '#e53935' : '#909399';
        return ' <span style="color:' + color + ';font-size:10px;">[库存:' + esc(s) + ']</span>';
    }

    // ------------------------------------------------------------------
    //  红点徽标（药品管理 tab + 移动端底部导航）
    // ------------------------------------------------------------------
    function updateStockBadges() {
        var count = isEnabled() ? lowStockList().length : 0;
        var targets = [];
        try {
            var tabs = document.querySelectorAll('.tab-item');
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].textContent.indexOf('药品管理') >= 0) { targets.push(tabs[i]); break; }
            }
            var navs = document.querySelectorAll('.mobile-nav-item');
            for (var j = 0; j < navs.length; j++) {
                if (navs[j].textContent.indexOf('药品') >= 0) { targets.push(navs[j]); break; }
            }
        } catch (e) {}
        for (var k = 0; k < targets.length; k++) {
            var t = targets[k];
            var old = t.querySelector('.stock-badge');
            if (old) old.parentNode.removeChild(old);
            if (count > 0) {
                var b = document.createElement('span');
                b.className = 'stock-badge';
                b.textContent = String(count);
                b.style.cssText = 'display:inline-block;background:#e53935;color:#fff;border-radius:9px;font-size:9px;font-weight:bold;line-height:14px;min-width:14px;height:14px;text-align:center;padding:0 3px;margin-left:3px;vertical-align:middle;';
                t.appendChild(b);
            }
        }
    }

    // ------------------------------------------------------------------
    //  ④ 注入式 UI：基础设置开关 / 药品管理按钮 / 编辑弹窗阈值 / 入库 / 流水
    // ------------------------------------------------------------------
    function injectSettingsToggle() {
        try {
            var body = document.querySelector('#settingsModal .modal-body');
            if (!body || document.getElementById('stockMgmtToggleRow')) return;
            var div = document.createElement('div');
            div.id = 'stockMgmtToggleRow';
            div.style.cssText = 'margin-bottom:12px;padding-top:12px;border-top:1px solid #eee;';
            div.innerHTML =
                '<label style="display:flex;align-items:center;gap:8px;">' +
                '<input type="checkbox" id="stockMgmtEnabled" style="width:18px;height:18px;">' +
                '启用库存管理（开方自动扣库存）</label>' +
                '<div style="font-size:11px;color:#666;margin-top:4px;">启用后：保存处方按 用量×剂数 自动扣库存，改方自动多退少补；药品管理可入库、看流水；药品可设预警阈值</div>';
            body.appendChild(div);
            var cb = div.querySelector('#stockMgmtEnabled');
            cb.checked = isEnabled();
            cb.addEventListener('change', function () {
                setEnabled(cb.checked);
                refreshUI();
                toast(cb.checked
                    ? '库存管理已启用：请到「药品管理」入库/设置预警阈值（基础设置本次保存后生效提示可忽略，开关已即时保存）'
                    : '库存管理已停用：保存处方不再扣减库存');
            });
        } catch (e) { console.warn('[StockCore] 设置开关注入失败:', e); }
    }

    function injectMedicineModalButtons() {
        try {
            var searchInput = document.getElementById('medicineSearch');
            if (!searchInput || document.getElementById('stockInBtn')) return;
            var row = searchInput.parentNode;
            var mk = function (id, text, bg, fn) {
                var b = document.createElement('button');
                b.className = 'action-btn'; b.id = id; b.textContent = text;
                b.style.background = bg; b.style.color = '#fff';
                b.addEventListener('click', fn);
                return b;
            };
            var inBtn = mk('stockInBtn', '📥 入库', '#2e7d32', function () { openStockInDialog(); });
            var ledBtn = mk('stockLedgerBtn', '📒 库存流水', '#1565c0', function () { openLedgerDialog(); });
            // 插到红色「清空药物库」按钮之前（工具类在前、破坏性操作殿后）
            var clearBtn = null;
            for (var i = 0; i < row.children.length; i++) {
                var el = row.children[i];
                if (el.tagName === 'BUTTON' && /clearMedicineLibrary/.test(el.getAttribute('onclick') || '')) { clearBtn = el; break; }
            }
            if (clearBtn) { row.insertBefore(inBtn, clearBtn); row.insertBefore(ledBtn, clearBtn); }
            else { row.appendChild(inBtn); row.appendChild(ledBtn); }
            // 未启用提示条（启用后隐藏）
            var list = document.getElementById('medicineList');
            if (list && !document.getElementById('stockHintBar')) {
                var hint = document.createElement('div');
                hint.id = 'stockHintBar';
                hint.style.cssText = 'margin-bottom:8px;padding:6px 10px;background:#fff8e1;border:1px solid #ffe082;border-radius:4px;font-size:11px;color:#795548;';
                hint.textContent = '💡 库存管理未启用：可在「基础设置」勾选「启用库存管理」，开方自动扣库存、库存不足预警';
                list.parentNode.insertBefore(hint, list);
            }
            syncMedicineModalUI();
        } catch (e) { console.warn('[StockCore] 药品管理按钮注入失败:', e); }
    }
    function syncMedicineModalUI() {
        var on = isEnabled();
        var inBtn = document.getElementById('stockInBtn');
        var ledBtn = document.getElementById('stockLedgerBtn');
        var hint = document.getElementById('stockHintBar');
        if (inBtn) inBtn.style.display = on ? '' : 'none';
        if (ledBtn) ledBtn.style.display = on ? '' : 'none';
        if (hint) hint.style.display = on ? 'none' : '';
    }

    // 编辑弹窗：库存输入框旁注入预警阈值输入框
    function ensureEditThresholdField(m) {
        try {
            var stockInput = document.getElementById('medEditStock');
            if (!stockInput) return;
            var stockDiv = stockInput.parentNode;
            var thrDiv = document.getElementById('medEditThresholdRow');
            if (!thrDiv) {
                thrDiv = document.createElement('div');
                thrDiv.id = 'medEditThresholdRow';
                thrDiv.innerHTML =
                    '<label style="display:block;margin-bottom:4px;font-weight:bold;">库存预警阈值 <span style="font-weight:normal;font-size:11px;color:#999;">（0=不预警，库存≤此数时红字提醒）</span></label>' +
                    '<input type="number" id="medEditThreshold" style="width:100%;padding:8px;border:1px solid #888;border-radius:4px;" placeholder="0" value="0">';
                stockDiv.parentNode.insertBefore(thrDiv, stockDiv.nextSibling);
            }
            var thr = thrDiv.querySelector('#medEditThreshold');
            thr.value = m ? (getThreshold(m) || 0) : 0;
            thrDiv.style.display = isEnabled() ? '' : 'none';
        } catch (e) {}
    }

    function closeInjectedModal(id) {
        var el = document.getElementById(id);
        if (el) el.parentNode.removeChild(el);
    }
    function openInjectedModal(id, title, bodyHtml, footerHtml) {
        closeInjectedModal(id);
        var wrap = document.createElement('div');
        wrap.className = 'modal'; wrap.id = id;
        wrap.style.display = 'flex';
        wrap.innerHTML = '<div class="modal-content" style="max-width:460px;width:92%;max-height:88vh;display:flex;flex-direction:column;">' +
            '<div class="modal-header"><h3>' + esc(title) + '</h3><span class="close-btn" onclick="StockCore.closeInjectedModal(\'' + id + '\')">&times;</span></div>' +
            '<div class="modal-body" style="overflow:auto;flex:1;">' + bodyHtml + '</div>' +
            '<div class="modal-footer">' + (footerHtml || '<button class="action-btn" onclick="StockCore.closeInjectedModal(\'' + id + '\')">关闭</button>') + '</div></div>';
        document.body.appendChild(wrap);
        return wrap;
    }

    function openStockInDialog() {
        if (!isEnabled()) { toast('请先在「基础设置」中启用库存管理'); return; }
        var meds = getMedList();
        if (!meds.length) { toast('药品库为空，请先添加药品'); return; }
        var options = meds.map(function (m) {
            return '<option value="' + esc(m.name) + '">' + esc(m.name) + '（当前库存 ' + esc(m.stock || 0) + esc(m.unit || 'g') + '）</option>';
        }).join('');
        var body =
            '<div style="margin-bottom:10px;"><label style="display:block;font-weight:bold;margin-bottom:4px;">药品</label>' +
            '<select id="stockInName" style="width:100%;padding:8px;border:1px solid #888;border-radius:4px;">' + options + '</select></div>' +
            '<div style="margin-bottom:10px;"><label style="display:block;font-weight:bold;margin-bottom:4px;">入库数量（单位同药品单位，可负=退货出库）</label>' +
            '<input type="number" id="stockInQty" placeholder="如 500" style="width:100%;padding:8px;border:1px solid #888;border-radius:4px;"></div>' +
            '<div style="margin-bottom:6px;"><label style="display:block;font-weight:bold;margin-bottom:4px;">备注（选填）</label>' +
            '<input type="text" id="stockInNote" placeholder="如：进货 5 公斤" style="width:100%;padding:8px;border:1px solid #888;border-radius:4px;"></div>' +
            '<div style="font-size:11px;color:#909399;">💡 批发公斤请自行换算为克（1公斤=1000g）</div>';
        var footer =
            '<button class="action-btn" onclick="StockCore.closeInjectedModal(\'stockInModal\')">取消</button>' +
            '<button class="action-btn primary" onclick="StockCore.confirmStockIn()">确定入库</button>';
        openInjectedModal('stockInModal', '📥 药品入库', body, footer);
    }
    function confirmStockIn() {
        var name = (document.getElementById('stockInName') || {}).value || '';
        var qty = parseFloat((document.getElementById('stockInQty') || {}).value);
        var note = (document.getElementById('stockInNote') || {}).value || '';
        if (!name || isNaN(qty) || Math.abs(qty) < 0.01) { toast('请填写药品和入库数量'); return; }
        if (stockIn(name, qty, note)) {
            closeInjectedModal('stockInModal');
            toast('已入库：' + name + ' ' + (qty > 0 ? '+' : '') + qty);
            var m = getMedLive(name);
            if (m && isLowStock(m)) toast('⚠ 注意：' + name + ' 仍低于预警阈值');
        }
    }

    function openLedgerDialog() {
        if (!isEnabled()) { toast('请先在「基础设置」中启用库存管理'); return; }
        var body =
            '<div style="margin-bottom:8px;display:flex;gap:6px;">' +
            '<input type="text" id="ledgerFilter" placeholder="按药品名筛选（空=全部）" style="flex:1;padding:6px;border:1px solid #888;border-radius:4px;" oninput="StockCore.renderLedgerTable()">' +
            '<button class="action-btn" onclick="StockCore.exportLedgerCsv()">导出CSV</button></div>' +
            '<div id="ledgerTable" style="max-height:50vh;overflow:auto;"></div>';
        openInjectedModal('ledgerModal', '📒 库存流水（最近 300 条）', body);
        renderLedgerTable();
    }
    function renderLedgerTable() {
        var el = document.getElementById('ledgerTable');
        if (!el) return;
        var kw = ((document.getElementById('ledgerFilter') || {}).value || '').trim();
        var rows = getLedger().filter(function (e) { return !kw || (e.name || '').indexOf(kw) >= 0; }).slice(0, 300);
        if (!rows.length) { el.innerHTML = '<div style="text-align:center;color:#999;padding:20px;font-size:12px;">暂无流水记录</div>'; return; }
        var html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
            '<thead><tr style="background:#f5f5f5;">' +
            ['时间', '药品', '类型', '数量', '结存', '经办', '说明'].map(function (h) {
                return '<th style="border:1px solid #ddd;padding:4px;text-align:' + (h === '药品' || h === '说明' ? 'left' : 'center') + ';">' + h + '</th>';
            }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (e) {
            var d = new Date(e.t);
            var ts = isNaN(d.getTime()) ? '' : (d.toLocaleDateString('zh-CN') + ' ' + d.toTimeString().slice(0, 5));
            var qtyColor = (e.qty < 0) ? '#e53935' : '#2e7d32';
            html += '<tr>' +
                '<td style="border:1px solid #ddd;padding:4px;white-space:nowrap;">' + esc(ts) + '</td>' +
                '<td style="border:1px solid #ddd;padding:4px;">' + esc(e.name) + '</td>' +
                '<td style="border:1px solid #ddd;padding:4px;text-align:center;white-space:nowrap;">' + esc(TYPE_LABEL[e.type] || e.type) + '</td>' +
                '<td style="border:1px solid #ddd;padding:4px;text-align:center;color:' + qtyColor + ';font-weight:bold;">' + (e.qty > 0 ? '+' : '') + esc(e.qty) + '</td>' +
                '<td style="border:1px solid #ddd;padding:4px;text-align:center;">' + esc(e.stock === null ? '-' : e.stock) + '</td>' +
                '<td style="border:1px solid #ddd;padding:4px;text-align:center;white-space:nowrap;">' + esc(e.op) + '</td>' +
                '<td style="border:1px solid #ddd;padding:4px;">' + esc(e.note) + '</td>' +
                '</tr>';
        });
        el.innerHTML = html + '</tbody></table>';
    }
    function exportLedgerCsv() {
        try {
            var rows = getLedger();
            if (!rows.length) { toast('暂无流水可导出'); return; }
            var csv = '\uFEFF' + ['时间', '药品', '类型', '数量', '结存', '经办人', '说明'].join(',') + '\n';
            rows.forEach(function (e) {
                csv += [e.t, e.name, TYPE_LABEL[e.type] || e.type, e.qty, (e.stock === null ? '' : e.stock), e.op, e.note]
                    .map(function (v) { return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"'; }).join(',') + '\n';
            });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            a.download = '库存流水_' + new Date().toLocaleDateString('zh-CN').replace(/\//g, '-') + '.csv';
            a.click();
        } catch (e) { toast('导出失败：' + e.message); }
    }

    // ------------------------------------------------------------------
    //  ⑤ 钩子安装（DOMContentLoaded 后重试直至 inline script 定义目标函数）
    // ------------------------------------------------------------------
    var installed = false;
    function tryInstall() {
        if (installed) return true;
        if (typeof global.savePrescriptionToDB !== 'function' ||
            typeof global.saveMedicineEdit !== 'function' ||
            typeof global.showMedicineEditModal !== 'function') {
            return false;
        }
        installed = true;

        // ① 保存处方 → 差值扣减（唯一落库收口：新存/同日覆盖/改历史/回收站恢复全走此）
        var _saveRx = global.savePrescriptionToDB;
        global.savePrescriptionToDB = async function (record) {
            var plan = null, rxNo = '', isFirstApply = false;
            try {
                if (isEnabled()) {
                    isFirstApply = !(record && record.__stockApplied);
                    rxNo = (record && (record.prescriptionNo || record.outpatientNo)) || '';
                    plan = planDeduction(record);
                }
            } catch (e) { plan = null; }
            var result = await _saveRx.apply(this, arguments);
            try {
                if (plan && plan.hasChanges && record && typeof record === 'object') {
                    record.__stockApplied = plan.marker;      // 幂等标记随处方持久化/云端同步
                    try { await _saveRx.call(this, record); } catch (e2) {}
                    notifyLowStock(commitDeduction(plan, rxNo, isFirstApply));
                }
            } catch (e) { console.warn('[StockCore] 处方扣库存失败（不影响处方保存）:', e); }
            return result;
        };

        // ② 彻底删除/清空回收站 → 冲回（confirm 在原函数内部，须在其成功后判定）
        var _delBin = global.deleteFromRecycleBin;
        if (typeof _delBin === 'function') {
            global.deleteFromRecycleBin = function (id) {
                var rec = null;
                try { if (isEnabled() && typeof global.getRecycleBin === 'function') { global.getRecycleBin().forEach(function (r) { if (r && r.id === id) rec = r; }); } } catch (e) {}
                var r2 = _delBin.apply(this, arguments);
                try {
                    if (rec && isEnabled() && typeof global.getRecycleBin === 'function' &&
                        !global.getRecycleBin().some(function (x) { return x.id === id; })) {
                        var n = revertRecord(rec);
                        if (n > 0) toast('已冲回 ' + n + ' 味药的处方扣减库存');
                    }
                } catch (e) {}
                return r2;
            };
        }
        var _clearBin = global.clearRecycleBin;
        if (typeof _clearBin === 'function') {
            global.clearRecycleBin = function () {
                var recs = [];
                try { if (isEnabled() && typeof global.getRecycleBin === 'function') { recs = global.getRecycleBin().filter(function (r) { return r && r.__stockApplied; }); } } catch (e) {}
                var r2 = _clearBin.apply(this, arguments);
                try {
                    if (isEnabled() && recs.length && typeof global.getRecycleBin === 'function' && global.getRecycleBin().length === 0) {
                        var n = 0; recs.forEach(function (r) { n += revertRecord(r) || 0; });
                        if (n > 0) toast('已冲回 ' + n + ' 条处方扣减库存');
                    }
                } catch (e) {}
                return r2;
            };
        }

        // ③ 药品编辑：阈值字段注入 + 盘点调整自动记账
        var _showEdit = global.showMedicineEditModal;
        global.showMedicineEditModal = function (m, isAdd) {
            var r = _showEdit.apply(this, arguments);
            try { ensureEditThresholdField(m); } catch (e) {}
            return r;
        };
        var _saveMed = global.saveMedicineEdit;
        global.saveMedicineEdit = function () {
            var name = '', oldStock = 0, wasAdd = false, thr = 0;
            try {
                var el = document.getElementById('medEditName');
                name = (el && el.value ? el.value : '').trim();
                var existing = (typeof global.getMedicineByName === 'function') ? global.getMedicineByName(name) : null;
                wasAdd = !existing;
                oldStock = existing ? (parseFloat(existing.stock) || 0) : 0;
                var thrEl = document.getElementById('medEditThreshold');
                thr = thrEl ? (parseFloat(thrEl.value) || 0) : 0;
            } catch (e) {}
            var r = _saveMed.apply(this, arguments);
            try {
                if (name) {
                    var saved = (typeof global.getMedicineByName === 'function') ? global.getMedicineByName(name) : null;
                    if (saved) {
                        var changed = false;
                        if (isEnabled() && (getThreshold(saved) || 0) !== thr) {
                            saved.stockThreshold = thr; changed = true;
                        }
                        if (isEnabled()) {
                            var newStock = parseFloat(saved.stock) || 0;
                            if (!wasAdd && Math.abs(newStock - oldStock) >= 0.01) {
                                recordManualAdjust(name, oldStock, newStock, '编辑药品'); changed = true;
                            } else if (wasAdd && newStock > 0) {
                                pushEntry(makeEntry(name, 'in', newStock, newStock, '新增药品期初库存')); changed = true;
                            }
                        }
                        if (changed) {
                            persistList(getMedList());
                            if (typeof global.renderMedicineList === 'function') global.renderMedicineList();
                        }
                    }
                }
            } catch (e) { console.warn('[StockCore] 药品编辑后处理失败:', e); }
            updateStockBadges();
            return r;
        };

        // ④ 药品列表渲染后刷新红点（列表模板中的红字由锚点编辑直接渲染）
        var _render = global.renderMedicineList;
        if (typeof _render === 'function') {
            global.renderMedicineList = function () {
                var r = _render.apply(this, arguments);
                updateStockBadges();
                syncMedicineModalUI();
                return r;
            };
        }

        // ⑤ 备份恢复：流水 + 开关随备份走（备份导出字段由 index.html 锚点编辑注入 data 对象）
        var _imp = global.importDataFromJson;
        if (typeof _imp === 'function') {
            global.importDataFromJson = async function (jsonStr) {
                var r = await _imp.apply(this, arguments);
                try { restoreFromBackup(jsonStr); } catch (e) {}
                return r;
            };
        }

        injectSettingsToggle();
        injectMedicineModalButtons();
        updateStockBadges();
        return true;
    }
    function restoreFromBackup(jsonStr) {
        if (typeof jsonStr !== 'string' || !jsonStr.trim()) return;
        var d = null;
        try { d = JSON.parse(jsonStr); } catch (e) { return; }
        if (!d || typeof d !== 'object') return;
        var restored = false;
        if (Array.isArray(d.stockLedger)) { saveLedger(d.stockLedger); restored = true; }
        if (typeof d.stockMgmtEnabled === 'boolean') { setEnabled(d.stockMgmtEnabled); restored = true; }
        if (restored) { updateStockBadges(); syncMedicineModalUI(); toast('库存流水已随备份恢复'); }
    }

    function refreshUI() {
        updateStockBadges();
        syncMedicineModalUI();
        try { if (typeof global.renderMedicineList === 'function' && document.getElementById('medicineModal') && document.getElementById('medicineModal').style.display !== 'none') global.renderMedicineList(); } catch (e) {}
    }

    function boot() {
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (tryInstall() || tries > 100) { clearInterval(timer); }
        }, 300);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // ------------------------------------------------------------------
    //  导出
    // ------------------------------------------------------------------
    global.StockCore = {
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        stockText: stockText,          // 药品列表行：红字库存 HTML
        dropBadge: dropBadge,          // 拾药下拉：[库存:N] 徽标
        getLedger: getLedger,
        lowStockList: lowStockList,
        updateStockBadges: updateStockBadges,
        closeInjectedModal: closeInjectedModal,
        openStockInDialog: openStockInDialog,
        confirmStockIn: confirmStockIn,
        openLedgerDialog: openLedgerDialog,
        renderLedgerTable: renderLedgerTable,
        exportLedgerCsv: exportLedgerCsv,
        // 以下供单测/调试
        _planDeduction: planDeduction,
        _commitDeduction: commitDeduction,
        _revertRecord: revertRecord,
        _stockIn: stockIn,
        _recordManualAdjust: recordManualAdjust,
        _applyStockDelta: applyStockDelta,
        _getMedList: getMedList,
        _getThreshold: getThreshold,
        _isLowStock: isLowStock,
        _makeEntry: makeEntry,
        _restoreFromBackup: restoreFromBackup,
        _pushEntry: pushEntry
    };
})(typeof window !== 'undefined' ? window : this);
