// ============================================================================
//  quiz-core.js — 通用题库引擎（多题库，manifest 驱动，零硬编码）
//
//  职责：
//    · 读取 window.QUIZ_MANIFEST（题库注册表），按需动态注入题库数据脚本（懒加载，不用 fetch）
//    · 浏览 / 随机试卷 / 评分 / 逐题回顾所需的数据与算法
//    · 进度、错题、历史、偏好统一走 localStorage 的 `quiz:` 命名空间
//      —— 绝不触碰 PrescriptionDB / 处方 / 云同步数据
//
//  明确约束：
//    · 本文件不得出现任何具体题库名称、文件名或题号常量
//    · 新增题库只需加数据文件 + 在 manifest.js 加一条登记，本文件零改动
//
//  ★ 授权位明确不挂（P4 声明）：题库【不依赖】license-manager.js 的 features 枚举，
//    不新增任何授权功能位。原因：存量激活码未包含新位，若按授权位拦截会被误判为
//    未授权而阻断老客户；离线端无网络无法补授权，一旦误拦不可挽回。入口显隐只按
//    角色（收费员隐藏，其余全角色可见），与授权/版本完全无关。
//    后续若有人想在题库上加 feature 位，请先读本段并改走「角色/版本」维度。
//
//  ★ 记录迁移（P4）：题目 id 约定为 `<bankId>:<三位题号>`（见 manifest.js 与构建工具）。
//    修订题库时尽量保持题号不变；确需改题号时旧 id 会在下次加载时静默清理并提示一次。
//    清理幂等：第二次加载已无失效 id，不再清理、不再提示。
//
//  暴露：window.QuizCore
// ============================================================================
(function (global) {
    'use strict';

    var CORE_SRC = (document.currentScript && document.currentScript.src) || '';
    var BASE_DIR = CORE_SRC ? CORE_SRC.replace(/[^/]*$/, '') : '';
    var DATA_URL_RE = /^[A-Za-z0-9_./?=&%:-]+$/;
    var LETTERS = ['A', 'B', 'C', 'D'];
    var CACHE_PREFIX = 'quiz:';
    var HISTORY_MAX = 200;
    var WRONG_MAX = 200;

    // ------------------------------------------------------------------
    // 基础工具
    // ------------------------------------------------------------------
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function storageKey() {
        return CACHE_PREFIX + Array.prototype.slice.call(arguments).join(':');
    }

    function readStore(key, fallback) {
        try {
            var raw = global.localStorage.getItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try {
            global.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    function removeStore(key) {
        try { global.localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }

    function nowIso() {
        try { return new Date().toISOString(); } catch (e) { return ''; }
    }

    // ------------------------------------------------------------------
    // manifest / 懒加载
    // ------------------------------------------------------------------
    function listBanks(options) {
        var manifest = global.QUIZ_MANIFEST;
        if (!Array.isArray(manifest)) return [];
        var onlyEnabled = !(options && options.includeDisabled);
        var list = manifest.filter(function (b) {
            return b && b.id && (!onlyEnabled || b.enabled !== false);
        });
        list.sort(function (a, b) {
            return (a.order == null ? 999 : a.order) - (b.order == null ? 999 : b.order);
        });
        return list;
    }

    function findBankMeta(id) {
        var all = listBanks({ includeDisabled: true });
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === id) return all[i];
        }
        return null;
    }

    var bankCache = {};
    var pending = {};

    function loadBank(id) {
        if (bankCache[id]) return Promise.resolve(bankCache[id]);
        if (pending[id]) return pending[id];

        var meta = findBankMeta(id);
        if (!meta) return Promise.reject(new Error('题库不存在或未登记: ' + id));
        if (!meta.file || !DATA_URL_RE.test(meta.file)) {
            return Promise.reject(new Error('题库文件路径非法: ' + id));
        }

        var existing = global[meta.global];
        if (existing && Array.isArray(existing.questions)) {
            bankCache[id] = existing;
            return Promise.resolve(existing);
        }

        pending[id] = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            var done = false;
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                reject(new Error('题库加载超时: ' + id));
            }, 15000);

            script.async = true;
            script.src = BASE_DIR + meta.file;
            script.onload = function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                var bank = global[meta.global];
                if (!bank || !Array.isArray(bank.questions)) {
                    reject(new Error('题库数据未挂载到 window.' + meta.global));
                    return;
                }
                if (bank.bankId !== id || !bank.questions.length) {
                    reject(new Error('题库数据 bankId 不匹配: ' + id));
                    return;
                }
                if (typeof meta.count === 'number' && bank.questions.length !== meta.count) {
                    reject(new Error('题库题数与 manifest 不一致: ' + id + ' (' + bank.questions.length + ' != ' + meta.count + ')'));
                    return;
                }
                bankCache[id] = bank;
                resolve(bank);
            };
            script.onerror = function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(new Error('题库脚本加载失败: ' + script.src));
            };
            document.head.appendChild(script);
        });

        pending[id].then(function (b) { delete pending[id]; return b; }, function (e) { delete pending[id]; throw e; });
        return pending[id];
    }

    function loadBanks(ids) {
        return Promise.all((ids || []).map(loadBank));
    }

    // ------------------------------------------------------------------
    // 进度 / 错题 / 历史 / 偏好（quiz: 命名空间）
    // ------------------------------------------------------------------
    function progressKey(bankId) { return storageKey('progress', bankId); }
    function wrongKey(bankId) { return storageKey('wrong', bankId); }
    var HISTORY_KEY = storageKey('history');
    var PREFS_KEY = storageKey('prefs');

    function getProgress(bankId) {
        var p = readStore(progressKey(bankId), null);
        if (!p || typeof p !== 'object') p = {};
        if (!p.answered || typeof p.answered !== 'object') p.answered = {};
        if (!p.correct || typeof p.correct !== 'object') p.correct = {};
        if (typeof p.lastNo !== 'number') p.lastNo = 1;
        return p;
    }

    function saveProgress(bankId, p) {
        p.updatedAt = nowIso();
        return writeStore(progressKey(bankId), p);
    }

    function getBankStats(bankId) {
        var p = getProgress(bankId);
        var answered = Object.keys(p.answered).length;
        var correct = Object.keys(p.correct).length;
        return {
            answered: answered,
            correct: correct,
            rate: answered ? Math.round(correct / answered * 100) : 0,
            lastNo: p.lastNo || 1
        };
    }

    function markAnswered(bankId, question, selectedIndex) {
        if (!question || !question.id) return null;
        var p = getProgress(bankId);
        var correct = selectedIndex === question.ansIndex;
        p.answered[question.id] = selectedIndex;
        if (correct) p.correct[question.id] = true;
        else delete p.correct[question.id];
        p.lastNo = question.no || p.lastNo;
        saveProgress(bankId, p);
        if (!correct) addWrong(bankId, question, selectedIndex);
        else removeWrong(bankId, question.id);
        return correct;
    }

    function getWrong(bankId) {
        var w = readStore(wrongKey(bankId), null);
        return (w && typeof w === 'object') ? w : {};
    }

    function addWrong(bankId, question, selectedIndex) {
        var w = getWrong(bankId);
        var prev = w[question.id] || { count: 0 };
        w[question.id] = {
            no: question.no,
            lastSelected: selectedIndex,
            count: prev.count + 1,
            lastAt: nowIso()
        };
        var ids = Object.keys(w);
        if (ids.length > WRONG_MAX) {
            ids.sort(function (a, b) { return (w[a].lastAt || '') < (w[b].lastAt || '') ? -1 : 1; });
            while (ids.length > WRONG_MAX) delete w[ids.shift()];
        }
        writeStore(wrongKey(bankId), w);
    }

    function removeWrong(bankId, qid) {
        var w = getWrong(bankId);
        if (w[qid]) {
            delete w[qid];
            writeStore(wrongKey(bankId), w);
        }
    }

    /**
     * 题库版本迁移：加载题库后，清理进度/错题中已不存在的题目 id。
     * 幂等：失效记录删除后不再存在，重复调用返回 0（不会重复清理）。
     * @returns {number} 本次清理的失效记录条数（进度与错题去重计数）
     */
    function migrateBankRecords(bank) {
        if (!bank || !bank.bankId || !Array.isArray(bank.questions)) return 0;
        var valid = {};
        bank.questions.forEach(function (q) { if (q && q.id) valid[q.id] = true; });

        var removed = 0;
        var p = getProgress(bank.bankId);
        var stale = {};
        Object.keys(p.answered).forEach(function (id) { if (!valid[id]) stale[id] = true; });
        Object.keys(p.correct).forEach(function (id) { if (!valid[id]) stale[id] = true; });
        var staleIds = Object.keys(stale);
        if (staleIds.length) {
            staleIds.forEach(function (id) { delete p.answered[id]; delete p.correct[id]; });
            saveProgress(bank.bankId, p);
            removed += staleIds.length;
        }

        var w = getWrong(bank.bankId);
        var removedWrong = 0;
        Object.keys(w).forEach(function (id) {
            if (!valid[id]) { delete w[id]; removedWrong++; }
        });
        if (removedWrong) {
            writeStore(wrongKey(bank.bankId), w);
            removed += removedWrong;
        }
        return removed;
    }

    function noticeInMain(text) {
        if (!overlayEl) return;
        var main = overlayEl.querySelector('.qz-main');
        if (!main) return;
        var n = el('div', 'qz-panel qz-meta qz-notice', esc(text));
        main.insertBefore(n, main.firstChild);
    }

    function getHistory() {
        var h = readStore(HISTORY_KEY, []);
        return Array.isArray(h) ? h : [];
    }

    function pushHistory(record) {
        var h = getHistory();
        h.push(record);
        while (h.length > HISTORY_MAX) h.shift();
        writeStore(HISTORY_KEY, h);
    }

    function getPrefs() {
        var p = readStore(PREFS_KEY, null);
        if (!p || typeof p !== 'object') p = {};
        if (typeof p.perBank !== 'number' || p.perBank < 1) p.perBank = 5;
        return p;
    }

    function setPrefs(patch) {
        var p = getPrefs();
        Object.keys(patch || {}).forEach(function (k) { p[k] = patch[k]; });
        writeStore(PREFS_KEY, p);
        return p;
    }

    function clearBank(bankId) {
        removeStore(progressKey(bankId));
        removeStore(wrongKey(bankId));
    }

    // ------------------------------------------------------------------
    // 抽题 / 试卷 / 评分
    // ------------------------------------------------------------------
    function shuffle(arr, rnd) {
        var r = rnd || Math.random;
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(r() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    function sample(arr, n) {
        var copy = arr.slice();
        shuffle(copy);
        return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
    }

    /**
     * 知识组去重池：同 group 只保留一条（随机取），无 group 的题目全部保留。
     * 用于试卷抽题；浏览模式仍读完整 questions，不受影响。
     */
    function examPool(questions) {
        var shuffled = shuffle((questions || []).slice());
        var seen = {};
        var out = [];
        shuffled.forEach(function (q) {
            var key = q.group ? String(q.group) : '';
            if (key) {
                if (seen[key]) return;
                seen[key] = true;
            }
            out.push(q);
        });
        return out;
    }

    /**
     * 生成跨库试卷。
     * @param {{bankIds?:string[], perBank?:number, total?:number}} opts
     *   perBank：每库抽题数（默认取 prefs.perBank，默认 5）
     *   total：总题数上限（可选；按库轮转分配，池不足自动缩减）
     * @returns {Promise<{id,createdAt,scope,questions:Array}>}
     */
    function createExam(opts) {
        opts = opts || {};
        var ids = opts.bankIds && opts.bankIds.length ? opts.bankIds : listBanks().map(function (b) { return b.id; });
        var perBank = typeof opts.perBank === 'number' && opts.perBank > 0 ? opts.perBank : getPrefs().perBank;
        var createdAt = nowIso();

        return loadBanks(ids).then(function (banks) {
            var picked = [];
            if (typeof opts.total === 'number' && opts.total > 0) {
                // 按库轮转，保证小库不被大库淹没
                var pools = banks.map(function (b) { return examPool(b.questions); });
                var rounds = 0;
                var guard = 0;
                while (picked.length < opts.total && guard++ < 100000) {
                    var added = false;
                    for (var i = 0; i < pools.length && picked.length < opts.total; i++) {
                        var q = pools[i][rounds];
                        if (q) {
                            picked.push(parentBankQuestion(banks[i], q));
                            added = true;
                        }
                    }
                    rounds++;
                    if (!added) break;
                }
            } else {
                banks.forEach(function (b) {
                    sample(examPool(b.questions), perBank).forEach(function (q) {
                        picked.push(parentBankQuestion(b, q));
                    });
                });
            }
            shuffle(picked);
            return {
                id: 'exam-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
                createdAt: createdAt,
                scope: ids.slice(),
                perBank: perBank,
                total: picked.length,
                questions: picked
            };
        });
    }

    function parentBankQuestion(bank, q) {
        var copy = {};
        Object.keys(q).forEach(function (k) { copy[k] = q[k]; });
        copy.bankId = bank.bankId;
        copy.bankName = bank.name;
        return copy;
    }

    /**
     * 评分。answers: { [qid]: selectedIndex } 或 [{id, selected}]
     * @returns {{total,correct,score,byBank,details}}
     */
    function gradeExam(exam, answers) {
        var map = {};
        if (Array.isArray(answers)) {
            answers.forEach(function (a) { if (a && a.id) map[a.id] = a.selected; });
        } else if (answers && typeof answers === 'object') {
            map = answers;
        }

        var result = { total: 0, correct: 0, score: 0, byBank: {}, details: [] };
        (exam && exam.questions ? exam.questions : []).forEach(function (q) {
            var selected = map[q.id];
            var isCorrect = selected === q.ansIndex;
            var b = q.bankId || '';
            if (!result.byBank[b]) result.byBank[b] = { total: 0, correct: 0, bankName: q.bankName || b };
            result.byBank[b].total++;
            if (isCorrect) {
                result.byBank[b].correct++;
                result.correct++;
            }
            result.details.push({
                id: q.id,
                bankId: b,
                no: q.no,
                selected: (selected === undefined ? null : selected),
                ansIndex: q.ansIndex,
                correct: isCorrect
            });
        });
        result.total = result.details.length;
        result.score = result.total ? Math.round(result.correct / result.total * 100) : 0;
        Object.keys(result.byBank).forEach(function (k) {
            var v = result.byBank[k];
            v.score = v.total ? Math.round(v.correct / v.total * 100) : 0;
        });
        return result;
    }

    // ------------------------------------------------------------------
    // 极简渲染（P1 地基自检用；P2 再接主界面入口与完整交互）
    // ------------------------------------------------------------------
    var styleInjected = false;
    function ensureStyle() {
        if (styleInjected || !document.head) return;
        styleInjected = true;
        var st = document.createElement('style');
        st.id = 'quiz-core-style';
        st.textContent = [
            '.qz-wrap{font-family:"Microsoft YaHei","SimSun",sans-serif;font-size:13px;color:#222;background:#f0f0f0;padding:10px;box-sizing:border-box;}',
            '.qz-head{background:#e0e0e0;border:1px solid #808080;padding:5px 8px;margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
            '.qz-title{font-weight:bold;}',
            '.qz-btn{background:#e0e0e0;border:1px solid #808080;padding:3px 10px;cursor:pointer;font-size:12px;}',
            '.qz-btn:hover{background:#d0d0d0;}',
            '.qz-btn:disabled{color:#888;cursor:default;}',
            '.qz-card{background:#fff;border:1px solid #808080;padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:10px;cursor:pointer;}',
            '.qz-card:hover{background:#f7f7f7;}',
            '.qz-name{font-weight:bold;flex:1;}',
            '.qz-meta{color:#555;font-size:12px;}',
            '.qz-bar{height:8px;background:#ddd;border:1px solid #aaa;width:120px;}',
            '.qz-bar>i{display:block;height:100%;background:#008000;}',
            '.qz-q{background:#fff;border:1px solid #808080;padding:10px;line-height:1.7;}',
            '.qz-opt{padding:4px 6px;border:1px solid #d0d0d0;margin:4px 0;cursor:pointer;}',
            '.qz-opt:hover{background:#eef;}',
            '.qz-opt.qz-right{background:#e8f5e9;border-color:#008000;}',
            '.qz-opt.qz-wrong{background:#fdecea;border-color:#8b0000;}',
            '.qz-explain{margin-top:8px;padding:6px;background:#fffde7;border:1px solid #c0c0c0;}',
            '.qz-nav{display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;}',
            '.qz-input{width:70px;padding:3px;border:1px solid #808080;}',
            /* ---- P2 页内全屏模块（系统 Win31 视觉：灰底、1px #808080 边框、无圆角无阴影） ---- */
            '.qz-app{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1500;background:#f0f0f0;display:flex;flex-direction:column;font-family:"Microsoft YaHei","SimSun",sans-serif;font-size:13px;color:#222;overflow:hidden;}',
            '.qz-top{background:#c0c0c0;border-bottom:2px solid #808080;display:flex;align-items:center;gap:8px;padding:4px 8px;flex-wrap:wrap;flex-shrink:0;}',
            '.qz-brand{font-weight:bold;font-size:13px;color:#000080;}',
            '.qz-crumb{font-size:12px;color:#333;flex:1;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.qz-main{flex:1;overflow:auto;overflow-x:hidden;background:#f0f0f0;padding:8px;box-sizing:border-box;}',
            '.qz-bottom{display:none;background:#e0e0e0;border-top:2px solid #808080;padding:6px 8px;gap:6px;flex-shrink:0;}',
            '.qz-btn{background:#e0e0e0;border:1px solid #808080;padding:3px 10px;cursor:pointer;font-size:12px;font-family:inherit;color:#222;border-radius:0;}',
            '.qz-btn:hover{background:#d0d0d0;}',
            '.qz-btn:disabled{color:#888;cursor:default;}',
            '.qz-btn.qz-primary{background:#008000;color:#fff;border-color:#006000;}',
            '.qz-btn.qz-danger{background:#ffdddd;color:#8b0000;}',
            '.qz-btn.qz-on{background:#000080;color:#fff;border-color:#000060;}',
            '.qz-select,.qz-input{padding:3px 4px;border:1px solid #808080;font-size:12px;font-family:inherit;background:#fff;border-radius:0;}',
            '.qz-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;}',
            '.qz-panel{background:#fff;border:1px solid #808080;padding:8px 10px;margin-bottom:8px;}',
            '.qz-bank{background:#fff;border:1px solid #808080;padding:8px 10px;margin-bottom:6px;cursor:pointer;}',
            '.qz-bank:hover{background:#f7f7f7;}',
            '.qz-bank-name{font-weight:bold;font-size:13px;}',
            '.qz-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
            '.qz-q{border:1px solid #808080;background:#fff;padding:10px;}',
            '.qz-qno{font-weight:bold;margin-bottom:6px;}',
            '.qz-stem{font-weight:bold;line-height:1.7;margin-bottom:8px;word-break:break-word;}',
            '.qz-opt{border:1px solid #d0d0d0;background:#fafafa;padding:6px 8px;margin:5px 0;cursor:pointer;line-height:1.6;word-break:break-word;}',
            '.qz-opt:hover{background:#eef;}',
            '.qz-opt.qz-sel{background:#dfe9ff;border-color:#000080;}',
            '.qz-opt.qz-right{background:#e8f5e9;border-color:#008000;}',
            '.qz-opt.qz-wrong{background:#fdecea;border-color:#8b0000;}',
            '.qz-exp{margin-top:8px;border:1px solid #c0c0c0;background:#fffde7;padding:6px 8px;line-height:1.6;}',
            '.qz-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(30px,1fr));gap:4px;}',
            '.qz-cell{background:#e0e0e0;border:1px solid #808080;padding:3px 0;font-size:11px;cursor:pointer;text-align:center;}',
            '.qz-cell.qz-ans{background:#c8e6c9;border-color:#008000;}',
            '.qz-cell.qz-cur{background:#000080;color:#fff;border-color:#000060;}',
            '.qz-cell.qz-bad{background:#ffcdd2;border-color:#8b0000;}',
            '.qz-score{font-size:26px;font-weight:bold;color:#008000;}',
            '.qz-table{width:100%;border-collapse:collapse;font-size:12px;}',
            '.qz-table th,.qz-table td{border:1px solid #808080;padding:4px 6px;}',
            '.qz-table th{background:#e0e0e0;}',
            '.qz-review{border:1px solid #d0d0d0;background:#fff;padding:6px 8px;margin-top:6px;}',
            '.qz-tag{display:inline-block;border:1px solid #808080;background:#e0e0e0;padding:0 4px;font-size:11px;margin-left:6px;font-weight:normal;}',
            /* ---- P3 体验增强：宽屏答题卡侧栏 / 显示答案开关 / 错题本 / 成绩历史 ---- */
            '.qz-check{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#333;cursor:pointer;}',
            '.qz-exam-layout{display:block;}',
            '.qz-exam-q{min-width:0;}',
            '.qz-exam-side{min-width:0;}',
            '.qz-wrong-item{border:1px solid #d0d0d0;background:#fff;padding:6px 8px;margin-top:6px;}',
            '.qz-wrong-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}',
            '.qz-hist-wrap{max-height:420px;overflow:auto;}',
            '.qz-empty{color:#555;font-size:12px;padding:4px 0;}',
            '@media(max-width:768px){.qz-bar{width:80px}.qz-card{padding:8px}.qz-wrap{padding:6px}}',
            '@media(max-width:768px){.qz-app{font-size:14px;}.qz-main{padding:6px;}.qz-btn{min-height:44px;font-size:14px;padding:6px 12px;}.qz-bottom{display:flex;flex-wrap:wrap;}.qz-opt{padding:10px 8px;min-height:44px;}.qz-top{padding:4px 6px;}.qz-crumb{font-size:11px;}}',
            '@media(min-width:1024px){.qz-main{padding:12px;}}',
            '@media(min-width:1280px){.qz-exam-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;grid-template-areas:"q side";gap:8px;align-items:start;}.qz-exam-q{grid-area:q;}.qz-exam-side{grid-area:side;position:sticky;top:0;}}'
        ].join('\n');
        document.head.appendChild(st);
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

    function renderBankList(container) {
        ensureStyle();
        if (!container) return;
        clear(container);
        var wrap = document.createElement('div');
        wrap.className = 'qz-wrap';

        var head = document.createElement('div');
        head.className = 'qz-head';
        head.innerHTML = '<span class="qz-title">题库</span><span class="qz-meta">共 ' + listBanks().length + ' 个题库</span>';
        wrap.appendChild(head);

        listBanks().forEach(function (b) {
            var stats = getBankStats(b.id);
            var card = document.createElement('div');
            card.className = 'qz-card';
            card.setAttribute('data-bank-id', b.id);
            card.innerHTML =
                '<span class="qz-name">' + esc(b.name) + '</span>' +
                '<span class="qz-meta">' + esc(b.category || '') + ' · ' + (b.count || 0) + ' 题 · v' + esc(b.version || '') + '</span>' +
                '<span class="qz-bar"><i style="width:' + Math.min(100, stats.rate) + '%"></i></span>' +
                '<span class="qz-meta">已练 ' + stats.answered + ' 题 / 正确率 ' + stats.rate + '%</span>';
            card.addEventListener('click', function () {
                openBankView(container, b.id);
            });
            wrap.appendChild(card);
        });

        container.appendChild(wrap);
    }

    function openBankView(container, bankId) {
        loadBank(bankId).then(function (bank) {
            var stats = getBankStats(bankId);
            var idx = Math.max(0, Math.min(bank.questions.length - 1, (stats.lastNo || 1) - 1));
            renderBrowse(container, bank, idx);
        }).catch(function (e) {
            if (container) container.textContent = '题库加载失败：' + e.message;
        });
    }

    function renderBrowse(container, bank, idx) {
        ensureStyle();
        clear(container);
        var wrap = document.createElement('div');
        wrap.className = 'qz-wrap';

        var head = document.createElement('div');
        head.className = 'qz-head';
        head.innerHTML = '<button class="qz-btn" data-act="back">返回题库</button>' +
            '<span class="qz-title">' + esc(bank.name) + '</span>' +
            '<span class="qz-meta">共 ' + bank.questions.length + ' 题</span>';
        wrap.appendChild(head);

        var body = document.createElement('div');
        body.className = 'qz-q';
        wrap.appendChild(body);

        var nav = document.createElement('div');
        nav.className = 'qz-nav';
        nav.innerHTML = '<button class="qz-btn" data-act="prev">上一题</button>' +
            '<span class="qz-meta">第 <b class="qz-cur"></b> / ' + bank.questions.length + ' 题</span>' +
            '<button class="qz-btn" data-act="next">下一题</button>' +
            '<span class="qz-meta">跳转</span><input class="qz-input" type="number" min="1" max="' + bank.questions.length + '" data-act="jump">';
        wrap.appendChild(nav);

        var cur = idx;

        function paint() {
            var q = bank.questions[cur];
            var answeredSel = null;
            var p = getProgress(bank.bankId);
            if (p.answered && p.answered[q.id] !== undefined) answeredSel = p.answered[q.id];
            body.innerHTML = '<div><b>第 ' + (q.no || (cur + 1)) + ' 题</b></div>' +
                '<div style="margin:6px 0;font-weight:bold;">' + esc(q.q) + '</div>' +
                '<div class="qz-opts"></div>' +
                '<div class="qz-explain" style="display:none;">' + esc(q.explain) + '</div>';
            var optsBox = body.querySelector('.qz-opts');
            q.opts.forEach(function (text, i) {
                var opt = document.createElement('div');
                opt.className = 'qz-opt';
                opt.innerHTML = '<b>' + LETTERS[i] + '.</b> ' + esc(text);
                if (answeredSel !== null) {
                    if (i === q.ansIndex) opt.classList.add('qz-right');
                    else if (i === answeredSel) opt.classList.add('qz-wrong');
                }
                opt.addEventListener('click', function () {
                    markAnswered(bank.bankId, q, i);
                    paint();
                    var ex = body.querySelector('.qz-explain');
                    if (ex) ex.style.display = 'block';
                });
                optsBox.appendChild(opt);
            });
            if (answeredSel !== null) body.querySelector('.qz-explain').style.display = 'block';
            nav.querySelector('.qz-cur').textContent = String(cur + 1);
            nav.querySelector('[data-act=prev]').disabled = cur <= 0;
            nav.querySelector('[data-act=next]').disabled = cur >= bank.questions.length - 1;
        }

        head.querySelector('[data-act=back]').addEventListener('click', function () {
            renderBankList(container);
        });
        nav.querySelector('[data-act=prev]').addEventListener('click', function () {
            if (cur > 0) { cur--; paint(); }
        });
        nav.querySelector('[data-act=next]').addEventListener('click', function () {
            if (cur < bank.questions.length - 1) { cur++; paint(); }
        });
        nav.querySelector('[data-act=jump]').addEventListener('change', function (e) {
            var n = parseInt(e.target.value, 10);
            if (n >= 1 && n <= bank.questions.length) { cur = n - 1; paint(); }
        });

        container.appendChild(wrap);
        paint();
    }

    function mount(container) {
        renderBankList(container);
    }

    // ------------------------------------------------------------------
    // P2 主界面模块：页内全屏（不新开窗口、不用 iframe）
    // ------------------------------------------------------------------
    var overlayEl = null;
    var app = null;

    function el(tag, cls, html) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }

    function btn(text, handler, cls) {
        var b = el('button', 'qz-btn' + (cls ? ' ' + cls : ''), esc(text));
        b.type = 'button';
        b.onclick = handler;
        return b;
    }

    function normText(s) {
        return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
    }

    function frame(crumbText, actions) {
        clear(overlayEl);
        var top = el('div', 'qz-top');
        top.appendChild(el('div', 'qz-brand', '📚 题库'));
        top.appendChild(el('div', 'qz-crumb', esc(crumbText)));
        var acts = el('div', 'qz-row');
        (actions || []).forEach(function (b) { acts.appendChild(b); });
        top.appendChild(acts);
        var main = el('div', 'qz-main');
        var bottom = el('div', 'qz-bottom');
        overlayEl.appendChild(top);
        overlayEl.appendChild(main);
        overlayEl.appendChild(bottom);
        return { main: main, bottom: bottom };
    }

    function openModule() {
        ensureStyle();
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = el('div', 'qz-app');
        overlayEl.id = 'quizModule';
        document.body.appendChild(overlayEl);
        app = {
            category: '', bankId: null, bank: null, qIndex: 0, search: '',
            mode: 'browse', exam: null, answers: {}, examIdx: 0, grade: null,
            examCount: 20, examScore: 100, examTitle: '试卷',
            instant: getPrefs().browseInstant === true,
            pending: null, reveal: false, expOpen: false,
            wrongFocus: '', wrongCount: 10
        };
        renderList();
        return overlayEl;
    }

    function closeModule() {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
        app = null;
    }

    function renderList() {
        var f = frame('题库列表', [btn('关闭', closeModule)]);
        var all = listBanks();
        var cats = [''];
        all.forEach(function (b) {
            var c = b.category || '';
            if (cats.indexOf(c) < 0) cats.push(c);
        });

        var tb = el('div', 'qz-toolbar');
        tb.appendChild(el('span', 'qz-meta', '分类：'));
        var sel = el('select', 'qz-select');
        cats.forEach(function (c) {
            var o = el('option', null, esc(c || '全部'));
            o.value = c;
            if ((app.category || '') === c) o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = function () { app.category = sel.value; renderList(); };
        tb.appendChild(sel);
        tb.appendChild(el('span', 'qz-meta', '共 ' + all.length + ' 个题库'));
        tb.appendChild(btn('错题本', function () { openWrongBook(''); }));
        tb.appendChild(btn('成绩历史', function () { renderHistory(); }));
        f.main.appendChild(tb);

        if (!all.length) {
            f.main.appendChild(el('div', 'qz-panel', '未登记任何题库。请在 public/quiz/manifest.js 追加登记项。'));
            return;
        }
        var list = all.filter(function (b) { return !app.category || (b.category || '') === app.category; });
        if (!list.length) {
            f.main.appendChild(el('div', 'qz-panel qz-meta', '该分类下暂无题库'));
            return;
        }
        list.forEach(function (b) {
            var stats = getBankStats(b.id);
            var total = b.count || 0;
            var done = total ? Math.round(stats.answered / total * 100) : 0;
            done = Math.max(0, Math.min(100, done));
            var card = el('div', 'qz-bank');
            card.setAttribute('data-bank-id', b.id);
            card.innerHTML = '<div class="qz-bank-name">' + esc(b.name) + '</div>'
                + '<div class="qz-row" style="margin-top:6px;">'
                + '<span class="qz-meta">' + esc(b.category || '未分类') + ' · ' + total + ' 题 · v' + esc(b.version || '') + '</span>'
                + '<span class="qz-bar"><i style="width:' + done + '%"></i></span>'
                + '<span class="qz-meta">已练 ' + stats.answered + ' / ' + total + '（' + done + '%），正确率 ' + stats.rate + '%</span>'
                + '</div>';
            card.onclick = function () { openBank(b.id); };
            f.main.appendChild(card);
        });
    }

    function openBank(bankId) {
        app.bankId = bankId;
        app.bank = null;
        app.mode = 'browse';
        app.exam = null;
        app.grade = null;
        var meta = findBankMeta(bankId);
        var f = frame((meta ? meta.name : bankId) + ' · 加载中…',
            [btn('返回题库', function () { renderList(); }), btn('关闭', closeModule)]);
        f.main.appendChild(el('div', 'qz-panel qz-meta', '正在加载题库数据…'));
        loadBank(bankId).then(function (bank) {
            app.bank = bank;
            // 题库版本迁移：清理已不存在题目的进度/错题（幂等，重复加载不会再提示）
            var cleaned = migrateBankRecords(bank);
            var last = getProgress(bankId).lastNo || 1;
            app.qIndex = Math.max(0, Math.min(bank.questions.length - 1, last - 1));
            app.search = '';
            renderBank();
            if (cleaned) noticeInMain('已清理 ' + cleaned + ' 条失效记录（题库版本变化后自动整理）');
        }).catch(function (e) {
            clear(f.main);
            f.main.appendChild(el('div', 'qz-panel', '题库加载失败：' + esc(e.message)));
        });
    }

    function renderBank() {
        var bank = app.bank;
        if (!bank) { renderList(); return; }
        var f = frame(bank.name + ' · ' + (app.mode === 'browse' ? '浏览模式' : '试卷模式'),
            [btn('返回题库', function () { app.bank = null; app.bankId = null; app.exam = null; app.grade = null; renderList(); }),
             btn('关闭', closeModule)]);
        var tabs = el('div', 'qz-toolbar');
        tabs.appendChild(btn('浏览模式', function () {
            if (app.mode !== 'browse') { app.mode = 'browse'; renderBank(); }
        }, app.mode === 'browse' ? 'qz-on' : ''));
        tabs.appendChild(btn('试卷模式', function () {
            if (app.mode !== 'exam') { app.mode = 'exam'; app.exam = null; app.grade = null; renderBank(); }
        }, app.mode === 'exam' ? 'qz-on' : ''));
        var st = getBankStats(bank.bankId);
        tabs.appendChild(el('span', 'qz-meta',
            '共 ' + bank.questions.length + ' 题 · 已练 ' + st.answered + ' 题 · 正确率 ' + st.rate + '%'));
        var wc = Object.keys(getWrong(bank.bankId)).length;
        tabs.appendChild(btn('错题本(' + wc + ')', function () { openWrongBook(bank.bankId); }));
        tabs.appendChild(btn('成绩历史', function () { renderHistory(); }));
        f.main.appendChild(tabs);
        if (app.mode === 'browse') renderBrowseInto(f);
        else renderExamHome(f);
    }

    function renderBrowseInto(f) {
        var bank = app.bank;
        var partSize = bank.partSize || 400;
        var parts = Math.ceil(bank.questions.length / partSize) || 1;
        var partBtns = [];

        var tb = el('div', 'qz-toolbar');
        tb.appendChild(el('span', 'qz-meta', '分册：'));
        for (var p = 1; p <= parts; p++) {
            (function (pp) {
                var b = btn('第' + pp + '册', function () {
                    app.qIndex = Math.min(bank.questions.length - 1, (pp - 1) * partSize);
                    resetGate();
                    paint();
                });
                partBtns.push(b);
                tb.appendChild(b);
            })(p);
        }
        f.main.appendChild(tb);

        var tb2 = el('div', 'qz-toolbar');
        var search = el('input', 'qz-input');
        search.type = 'search';
        search.placeholder = '按题干关键词搜索';
        search.value = app.search;
        search.style.minWidth = '150px';
        tb2.appendChild(search);
        var matchInfo = el('span', 'qz-meta', '');
        tb2.appendChild(matchInfo);
        tb2.appendChild(el('span', 'qz-meta', '题号：'));
        var jump = el('input', 'qz-input');
        jump.type = 'number';
        jump.min = '1';
        jump.max = String(bank.questions.length);
        jump.placeholder = '题号';
        jump.style.width = '70px';
        tb2.appendChild(jump);
        tb2.appendChild(btn('跳转', function () {
            var n = parseInt(jump.value, 10);
            if (n >= 1 && n <= bank.questions.length) { app.qIndex = n - 1; resetGate(); paint(); }
        }));
        var chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = app.instant;
        var chkLab = el('label', 'qz-check');
        chkLab.appendChild(chk);
        chkLab.appendChild(document.createTextNode(' 点选即判分'));
        chk.onchange = function () {
            app.instant = !!chk.checked;
            setPrefs({ browseInstant: app.instant });
            resetGate();
            paint();
        };
        tb2.appendChild(chkLab);
        f.main.appendChild(tb2);

        var qBox = el('div');
        f.main.appendChild(qBox);

        var nav = el('div', 'qz-toolbar');
        var prev = btn('上一题', function () { step(-1); });
        var next = btn('下一题', function () { step(1); });
        var pos = el('span', 'qz-meta', '');
        nav.appendChild(prev);
        nav.appendChild(pos);
        nav.appendChild(next);
        f.main.appendChild(nav);

        var mPrev = btn('上一题', function () { step(-1); });
        var mNext = btn('下一题', function () { step(1); });
        f.bottom.appendChild(mPrev);
        f.bottom.appendChild(mNext);
        f.bottom.appendChild(btn('返回题库', function () { renderList(); }));

        function matches() {
            if (!app.search) return null;
            var k = normText(app.search);
            var out = [];
            bank.questions.forEach(function (q, i) {
                if (normText(q.q).indexOf(k) >= 0) out.push(i);
            });
            return out;
        }

        function step(dir) {
            var ms = matches();
            if (ms && ms.length) {
                var at = ms.indexOf(app.qIndex);
                app.qIndex = (at < 0) ? ms[0] : ms[(at + dir + ms.length) % ms.length];
            } else {
                app.qIndex = Math.max(0, Math.min(bank.questions.length - 1, app.qIndex + dir));
            }
            resetGate();
            paint();
        }

        function resetGate() {
            app.pending = null;
            app.reveal = false;
            app.expOpen = false;
        }

        search.oninput = function () {
            app.search = String(search.value || '').trim();
            resetGate();
            paint();
        };

        function paint() {
            clear(qBox);
            var q = bank.questions[app.qIndex];
            var prog = getProgress(bank.bankId);
            var answeredSel = (prog.answered && prog.answered[q.id] !== undefined) ? prog.answered[q.id] : null;

            var card = el('div', 'qz-q');
            card.innerHTML = '<div class="qz-qno">第 ' + (q.no || (app.qIndex + 1)) + ' 题'
                + '<span class="qz-tag">第 ' + (q.part || 1) + ' 册</span>'
                + '</div>'
                + '<div class="qz-stem">' + esc(q.q) + '</div>'
                + '<div class="qz-opts"></div>'
                + '<div class="qz-toolbar" style="margin-top:8px;"></div>'
                + '<div class="qz-exp" style="display:' + (app.expOpen ? 'block' : 'none') + ';">' + esc(q.explain) + '</div>';
            var gateHint = (answeredSel === null && !app.instant)
                ? '<span class="qz-meta">先自测，点「显示答案/解析」后判分</span>' : '';
            if (gateHint) card.querySelector('.qz-toolbar').innerHTML = gateHint;
            var expLabel = app.expOpen ? '收起答案解析'
                : (answeredSel === null && !app.reveal ? '显示答案/解析' : '查看答案解析');
            var expBtn = btn(expLabel, function () {
                if (app.expOpen) { app.expOpen = false; paint(); return; }
                if (answeredSel === null && app.pending !== null) {
                    markAnswered(bank.bankId, q, app.pending);
                    app.pending = null;
                    app.reveal = true;
                    app.expOpen = true;
                    paint();
                    return;
                }
                if (answeredSel === null) app.reveal = true;
                app.expOpen = true;
                paint();
            });
            card.querySelector('.qz-toolbar').appendChild(expBtn);

            var optsBox = card.querySelector('.qz-opts');
            q.opts.forEach(function (text, i) {
                var o = el('div', 'qz-opt', '<b>' + LETTERS[i] + '.</b> ' + esc(text));
                if (answeredSel !== null) {
                    if (i === q.ansIndex) o.className += ' qz-right';
                    else if (i === answeredSel) o.className += ' qz-wrong';
                } else if (app.reveal) {
                    if (i === q.ansIndex) o.className += ' qz-right';
                } else if (app.pending === i) {
                    o.className += ' qz-sel';
                }
                o.onclick = function () {
                    if (app.instant) {
                        markAnswered(bank.bankId, q, i);
                        resetGate();
                        paint();
                        return;
                    }
                    if (answeredSel !== null) return;
                    app.pending = i;
                    app.reveal = false;
                    app.expOpen = false;
                    paint();
                };
                optsBox.appendChild(o);
            });
            qBox.appendChild(card);

            var ms = matches();
            pos.textContent = '第 ' + (app.qIndex + 1) + ' / ' + bank.questions.length + ' 题';
            if (ms) {
                var at = ms.indexOf(app.qIndex);
                matchInfo.textContent = '匹配 ' + ms.length + ' 题' + (at >= 0 ? '（第 ' + (at + 1) + ' 个）' : '');
                matchInfo.style.color = ms.length ? '#333' : '#8b0000';
            } else {
                matchInfo.textContent = '';
                matchInfo.style.color = '#555';
            }
            var cp = Math.floor(app.qIndex / partSize) + 1;
            for (var i = 0; i < partBtns.length; i++) {
                partBtns[i].className = 'qz-btn' + ((i + 1) === cp ? ' qz-on' : '');
            }
            prev.disabled = !ms && app.qIndex <= 0;
            next.disabled = !ms && app.qIndex >= bank.questions.length - 1;
            mPrev.disabled = prev.disabled;
            mNext.disabled = next.disabled;
        }
        paint();
    }

    function renderExamHome(f) {
        var bank = app.bank;
        var pool = examPool(bank.questions);
        var dupN = bank.questions.length - pool.length;

        var panel = el('div', 'qz-panel');
        panel.appendChild(el('div', 'qz-bank-name', '出卷设置'));
        panel.appendChild(el('div', 'qz-meta',
            '可抽题 ' + pool.length + ' 题' + (dupN > 0 ? '（' + dupN + ' 条同组重复题干已合并）' : '')));

        var row = el('div', 'qz-toolbar');
        row.style.marginTop = '8px';
        row.appendChild(el('span', 'qz-meta', '抽题数量：'));
        var cnt = el('input', 'qz-input');
        cnt.type = 'number';
        cnt.min = '1';
        cnt.max = String(pool.length);
        cnt.value = String(Math.min(app.examCount || 20, pool.length));
        cnt.style.width = '80px';
        row.appendChild(cnt);
        row.appendChild(el('span', 'qz-meta', '总分：'));
        var sc = el('input', 'qz-input');
        sc.type = 'number';
        sc.min = '1';
        sc.value = String(app.examScore || 100);
        sc.style.width = '80px';
        row.appendChild(sc);
        row.appendChild(btn('开始答题', function () {
            var n = parseInt(cnt.value, 10);
            if (!(n >= 1)) n = Math.min(20, pool.length);
            n = Math.min(n, pool.length);
            var s = parseInt(sc.value, 10);
            if (!(s >= 1)) s = 100;
            app.examCount = n;
            app.examScore = s;
            startExam(bank.bankId, n);
        }, 'qz-primary'));
        panel.appendChild(row);
        f.main.appendChild(panel);
        f.main.appendChild(el('div', 'qz-panel qz-meta',
            '规则：随机抽题、答完统一评分；同一题干的知识组只抽一条；答题记录与错题仅保存在本机 quiz: 空间，'
            + '不写入处方数据、不参与云同步。'));
    }

    function startExam(bankId, n) {
        var f = frame('试卷 · 准备中…', [btn('关闭', closeModule)]);
        f.main.appendChild(el('div', 'qz-panel qz-meta', '正在抽题…'));
        app.examTitle = '试卷';
        createExam({ bankIds: [bankId], total: n }).then(function (exam) {
            beginExam(exam);
        }).catch(function (e) {
            clear(f.main);
            f.main.appendChild(el('div', 'qz-panel', '出卷失败：' + esc(e.message)));
        });
    }

    function beginExam(exam) {
        app.exam = exam;
        app.answers = {};
        app.examIdx = 0;
        app.grade = null;
        renderExamRun();
    }

    function renderExamRun() {
        var exam = app.exam;
        var f = frame((app.examTitle || '试卷') + ' · ' + exam.total + ' 题 · 总分 ' + app.examScore + ' 分',
            [btn('放弃', function () {
                if (confirm('确定放弃本套试卷？已答内容不会计入进度。')) {
                    app.exam = null;
                    app.mode = 'exam';
                    renderBank();
                }
            }), btn('关闭', closeModule)]);

        var cardBox = el('div', 'qz-panel');
        cardBox.appendChild(el('div', 'qz-bank-name', '答题卡'));
        var grid = el('div', 'qz-cards');
        cardBox.appendChild(grid);
        var legend = el('div', 'qz-meta', '');
        legend.style.marginTop = '6px';
        cardBox.appendChild(legend);

        var qBox = el('div');
        var layout = el('div', 'qz-exam-layout');
        var sideWrap = el('div', 'qz-exam-side');
        var qWrap = el('div', 'qz-exam-q');
        sideWrap.appendChild(cardBox);
        qWrap.appendChild(qBox);
        layout.appendChild(sideWrap);
        layout.appendChild(qWrap);
        f.main.appendChild(layout);

        var nav = el('div', 'qz-toolbar');
        var prev = btn('上一题', function () { moveExam(-1); });
        var next = btn('下一题', function () { moveExam(1); });
        var pos = el('span', 'qz-meta', '');
        var submit = btn('提交评分', submitExam, 'qz-primary');
        nav.appendChild(prev);
        nav.appendChild(pos);
        nav.appendChild(next);
        nav.appendChild(submit);
        f.main.appendChild(nav);

        var mPrev = btn('上一题', function () { moveExam(-1); });
        var mNext = btn('下一题', function () { moveExam(1); });
        var mSubmit = btn('提交', submitExam, 'qz-primary');
        f.bottom.appendChild(mPrev);
        f.bottom.appendChild(mNext);
        f.bottom.appendChild(mSubmit);

        function paintCard() {
            clear(grid);
            exam.questions.forEach(function (q, i) {
                var c = el('div', 'qz-cell', String(i + 1));
                if (app.answers[q.id] !== undefined) c.className += ' qz-ans';
                if (i === app.examIdx) c.className += ' qz-cur';
                c.onclick = function () { app.examIdx = i; paintCard(); paintQ(); };
                grid.appendChild(c);
            });
            var n = Object.keys(app.answers).length;
            legend.textContent = '已答 ' + n + ' / ' + exam.total + ' 题（绿色=已答，深蓝=当前题）';
        }

        function paintQ() {
            clear(qBox);
            var q = exam.questions[app.examIdx];
            var sel = app.answers[q.id];
            var card = el('div', 'qz-q');
            card.innerHTML = '<div class="qz-qno">第 ' + (app.examIdx + 1) + ' / ' + exam.total + ' 题'
                + (q.bankName ? '<span class="qz-tag">' + esc(q.bankName) + '</span>' : '')
                + (q.no ? '<span class="qz-tag">原题号 ' + q.no + '</span>' : '')
                + '</div>'
                + '<div class="qz-stem">' + esc(q.q) + '</div>'
                + '<div class="qz-opts"></div>';
            var box = card.querySelector('.qz-opts');
            q.opts.forEach(function (text, i) {
                var o = el('div', 'qz-opt', '<b>' + LETTERS[i] + '.</b> ' + esc(text));
                if (sel === i) o.className += ' qz-sel';
                o.onclick = function () {
                    app.answers[q.id] = i;
                    paintCard();
                    paintQ();
                };
                box.appendChild(o);
            });
            qBox.appendChild(card);
            pos.textContent = '第 ' + (app.examIdx + 1) + ' / ' + exam.total + ' 题';
            prev.disabled = app.examIdx <= 0;
            next.disabled = app.examIdx >= exam.total - 1;
            mPrev.disabled = prev.disabled;
            mNext.disabled = next.disabled;
        }

        function moveExam(d) {
            app.examIdx = Math.max(0, Math.min(exam.total - 1, app.examIdx + d));
            paintCard();
            paintQ();
        }

        function submitExam() {
            var answered = Object.keys(app.answers).length;
            if (answered === 0) { alert('还没有作答，请先答题。'); return; }
            if (!confirm('已答 ' + answered + ' / ' + exam.total + ' 题，确定提交评分？')) return;
            exam.questions.forEach(function (q) {
                if (app.answers[q.id] !== undefined) markAnswered(q.bankId, q, app.answers[q.id]);
            });
            var g = gradeExam(exam, app.answers);
            g.percent = g.total ? Math.round(g.correct / g.total * 100) : 0;
            g.totalScore = app.examScore;
            g.score = g.total ? Math.round(g.correct / g.total * app.examScore) : 0;
            pushHistory({
                id: exam.id, createdAt: exam.createdAt, at: nowIso(),
                bankIds: exam.scope, total: exam.total, correct: g.correct,
                percent: g.percent, score: g.score, totalScore: app.examScore
            });
            app.grade = g;
            renderGrade();
        }

        paintCard();
        paintQ();
    }

    function renderGrade() {
        var g = app.grade;
        var f = frame('评分结果 · ' + g.total + ' 题 · 总分 ' + g.totalScore,
            [btn('再来一套', function () {
                if (app.exam && app.exam.kind === 'wrong') startWrongPractice(app.wrongFocus || '', app.examCount);
                else startExam(app.bankId, app.examCount);
            }),
             btn('返回题库', function () {
                 app.exam = null; app.grade = null; app.mode = 'browse'; renderBank();
             }),
             btn('退出', closeModule)]);

        var panel = el('div', 'qz-panel');
        panel.innerHTML = '<div class="qz-score">得分 ' + g.score + ' / ' + g.totalScore + '</div>'
            + '<div class="qz-meta" style="margin-top:6px;">正确率 ' + g.percent + '%（答对 '
            + g.correct + ' / ' + g.total + ' 题）</div>';
        f.main.appendChild(panel);

        var byBank = el('div', 'qz-panel');
        var html = '<div class="qz-bank-name">按题库统计</div>'
            + '<table class="qz-table" style="margin-top:6px;"><thead><tr>'
            + '<th>题库</th><th>题数</th><th>答对</th><th>正确率</th></tr></thead><tbody>';
        Object.keys(g.byBank).forEach(function (bid) {
            var v = g.byBank[bid];
            html += '<tr><td>' + esc(v.bankName || bid) + '</td><td>' + v.total + '</td><td>'
                + v.correct + '</td><td>' + v.score + '%</td></tr>';
        });
        html += '</tbody></table>';
        byBank.innerHTML = html;
        f.main.appendChild(byBank);

        // 最近成绩（轻量，最多保留 200 条，评分页展示最近 5 条）
        var recent = getHistory().slice(-5).reverse();
        if (recent.length) {
            var histPanel = el('div', 'qz-panel');
            var hh = '<div class="qz-bank-name">最近成绩</div>'
                + '<table class="qz-table" style="margin-top:6px;"><thead><tr>'
                + '<th>时间</th><th>题库</th><th>题数</th><th>得分</th><th>正确率</th></tr></thead><tbody>';
            recent.forEach(function (r) {
                hh += '<tr><td>' + esc(fmtTime(r.at || r.createdAt)) + '</td>'
                    + '<td>' + esc(bankNames(r.bankIds)) + '</td>'
                    + '<td>' + (r.total || 0) + '</td>'
                    + '<td>' + esc(String(r.score == null ? '' : r.score) + (r.totalScore ? ' / ' + r.totalScore : '')) + '</td>'
                    + '<td>' + esc(r.percent == null ? '' : r.percent + '%') + '</td></tr>';
            });
            hh += '</tbody></table>';
            histPanel.innerHTML = hh;
            f.main.appendChild(histPanel);
        }

        var revWrap = el('div', 'qz-panel');
        var revList = el('div');
        revList.style.display = 'none';
        var revBtn = btn('逐题回顾', function () {
            var show = revList.style.display === 'none';
            if (show && !revList.getAttribute('data-built')) buildReview(revList);
            revList.style.display = show ? 'block' : 'none';
            revBtn.textContent = show ? '收起回顾' : '逐题回顾';
        });
        revWrap.appendChild(revBtn);
        revWrap.appendChild(revList);
        f.main.appendChild(revWrap);
    }

    function buildReview(host) {
        var g = app.grade;
        var exam = app.exam;
        host.setAttribute('data-built', '1');
        exam.questions.forEach(function (q, i) {
            var d = g.details[i] || {};
            var sel = d.selected;
            var row = el('div', 'qz-review');
            var yours = (sel === null || sel === undefined) ? '未作答' : LETTERS[sel] + '. ' + esc(q.opts[sel]);
            var right = LETTERS[q.ansIndex] + '. ' + esc(q.opts[q.ansIndex]);
            row.innerHTML = '<div class="qz-qno">第 ' + (i + 1) + ' 题 '
                + (d.correct ? '<span style="color:#008000;">✓ 正确</span>' : '<span style="color:#8b0000;">✗ 错误</span>')
                + '</div>'
                + '<div style="line-height:1.6;">' + esc(q.q) + '</div>'
                + '<div class="qz-meta" style="margin-top:4px;">你的答案：' + yours + '</div>'
                + '<div class="qz-meta" style="color:#008000;">正确答案：' + right + '</div>'
                + '<div class="qz-exp">' + esc(q.explain) + '</div>';
            host.appendChild(row);
        });
    }

    // ------------------------------------------------------------------
    // P3 成绩历史 / 错题本
    // ------------------------------------------------------------------
    function fmtTime(v) {
        if (!v) return '';
        var d = new Date(v);
        if (isNaN(d.getTime())) return String(v);
        function p2(n) { return n < 10 ? '0' + n : String(n); }
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
            + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }

    function bankNames(ids) {
        if (!ids || !ids.length) return '';
        return ids.map(function (id) {
            var m = findBankMeta(id);
            return m ? m.name : id;
        }).join('、');
    }

    function historyFileName() {
        var d = new Date();
        function p2(n) { return n < 10 ? '0' + n : String(n); }
        return 'quiz-history-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
            + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.json';
    }

    // 只读导出：不写任何存储、不动环形缓冲
    function exportHistory() {
        var h = getHistory();
        if (!h.length) { alert('暂无成绩记录可导出。'); return; }
        var payload = { exportedAt: nowIso(), count: h.length, records: h };
        var text = JSON.stringify(payload, null, 2);
        var name = historyFileName();
        try {
            if (typeof Blob !== 'function' || !('download' in document.createElement('a'))) throw new Error('download unsupported');
            var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = name;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                try { document.body.removeChild(a); } catch (e) { /* ignore */ }
                try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
            }, 0);
        } catch (e) {
            showExportFallback(text, name);
        }
    }

    // file:// / Electron 等禁止下载时的替代：文本弹层，可全选复制
    function showExportFallback(text, name) {
        var f = frame('导出成绩历史 · ' + name, [btn('返回成绩历史', renderHistory), btn('关闭', closeModule)]);
        f.main.appendChild(el('div', 'qz-panel qz-meta',
            '当前环境无法直接下载，已改为文本导出：点击文本框后全选复制即可（共 ' + getHistory().length + ' 条）。'));
        var ta = el('textarea', 'qz-input');
        ta.style.width = '100%';
        ta.style.height = '360px';
        ta.value = text;
        f.main.appendChild(ta);
        try { ta.focus(); ta.select(); } catch (e) { /* ignore */ }
    }

    function renderHistory() {
        var h = getHistory().slice().reverse();
        var f = frame('成绩历史 · 最近 ' + Math.min(h.length, 50) + ' 条',
            [btn('返回题库', renderList), btn('导出 JSON', exportHistory), btn('关闭', closeModule)]);
        f.main.appendChild(el('div', 'qz-panel qz-meta',
            '共 ' + h.length + ' 条（最多保留 200 条，超出按 FIFO 截断）；得分按各套试卷设定的总分计算。'));
        if (!h.length) {
            f.main.appendChild(el('div', 'qz-panel qz-empty', '还没有成绩记录，先做一套试卷吧。'));
            return;
        }
        var wrap = el('div', 'qz-panel qz-hist-wrap');
        var html = '<table class="qz-table"><thead><tr>'
            + '<th>时间</th><th>题库</th><th>题数</th><th>得分</th><th>正确率</th></tr></thead><tbody>';
        h.slice(0, 50).forEach(function (r) {
            html += '<tr><td>' + esc(fmtTime(r.at || r.createdAt)) + '</td>'
                + '<td>' + esc(bankNames(r.bankIds)) + '</td>'
                + '<td>' + (r.total || 0) + '</td>'
                + '<td>' + esc(String(r.score == null ? '' : r.score) + (r.totalScore ? ' / ' + r.totalScore : '')) + '</td>'
                + '<td>' + esc(r.percent == null ? '' : r.percent + '%') + '</td></tr>';
        });
        html += '</tbody></table>';
        wrap.innerHTML = html;
        f.main.appendChild(wrap);
    }

    function openWrongBook(focusBankId) {
        app.wrongFocus = focusBankId || '';
        renderWrongBook();
    }

    function clearWrongBank(bankId) {
        var meta = findBankMeta(bankId);
        var name = meta ? meta.name : bankId;
        var n = Object.keys(getWrong(bankId)).length;
        if (!confirm('确定清空「' + name + '」的 ' + n + ' 条错题？')) return;
        if (!confirm('二次确认：清空后不可恢复，确定继续？')) return;
        removeStore(wrongKey(bankId));
        renderWrongBook();
    }

    function startWrongPractice(scope, nVal) {
        var metas = listBanks().filter(function (b) { return !scope || b.id === scope; });
        var ids = metas.filter(function (b) { return Object.keys(getWrong(b.id)).length > 0; })
            .map(function (b) { return b.id; });
        if (!ids.length) { alert('当前范围暂无错题。'); return; }
        var n = parseInt(nVal, 10);
        if (!(n >= 1)) n = 10;
        app.wrongCount = n;
        app.examCount = n;
        var f = frame('错题练习 · 准备中…', [btn('关闭', closeModule)]);
        f.main.appendChild(el('div', 'qz-panel qz-meta', '正在抽取错题…'));
        Promise.all(ids.map(loadBank)).then(function (banks) {
            var pool = [];
            banks.forEach(function (b) {
                var w = getWrong(b.bankId);
                b.questions.forEach(function (q) {
                    if (w[q.id]) pool.push(parentBankQuestion(b, q));
                });
            });
            shuffle(pool);
            var picked = pool.slice(0, Math.max(1, Math.min(n, pool.length)));
            app.examTitle = '错题练习';
            beginExam({
                id: 'wrong-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
                createdAt: nowIso(),
                scope: ids.slice(),
                total: picked.length,
                questions: picked,
                kind: 'wrong'
            });
        }).catch(function (e) {
            clear(f.main);
            f.main.appendChild(el('div', 'qz-panel', '错题练习出卷失败：' + esc(e.message)));
        });
    }

    // 先加载题库做失效记录迁移，再绘制；迁移发生时才提示一次（幂等，不会重复提示）
    function renderWrongBook(notice) {
        var metas = listBanks();
        var ids = metas.filter(function (b) { return Object.keys(getWrong(b.id)).length > 0; })
            .map(function (b) { return b.id; });
        if (!ids.length) { paintWrongBook(notice || 0); return; }
        Promise.all(ids.map(loadBank)).then(function (banks) {
            var cleaned = 0;
            banks.forEach(function (b) { cleaned += migrateBankRecords(b); });
            if (cleaned) { renderWrongBook((notice || 0) + cleaned); return; }
            paintWrongBook(notice || 0);
        }).catch(function () { paintWrongBook(notice || 0); });
    }

    function paintWrongBook(notice) {
        var metas = listBanks();
        var counts = {};
        var total = 0;
        metas.forEach(function (b) {
            var n = Object.keys(getWrong(b.id)).length;
            counts[b.id] = n;
            total += n;
        });
        var f = frame('错题本 · 共 ' + total + ' 题',
            [btn('返回题库', renderList), btn('成绩历史', renderHistory), btn('关闭', closeModule)]);

        var tb = el('div', 'qz-toolbar');
        tb.appendChild(el('span', 'qz-meta', '题库：'));
        var sel = el('select', 'qz-select');
        var oAll = el('option', null, '全部（' + total + '）');
        oAll.value = '';
        sel.appendChild(oAll);
        metas.forEach(function (b) {
            var o = el('option', null, b.name + '（' + (counts[b.id] || 0) + '）');
            o.value = b.id;
            sel.appendChild(o);
        });
        sel.value = app.wrongFocus || '';
        tb.appendChild(sel);
        sel.onchange = function () {
            app.wrongFocus = sel.value;
            renderWrongBook();
        };
        tb.appendChild(el('span', 'qz-meta', '抽题数量：'));
        var cnt = el('input', 'qz-input');
        cnt.type = 'number';
        cnt.min = '1';
        cnt.value = String(app.wrongCount || 10);
        cnt.style.width = '80px';
        tb.appendChild(cnt);
        tb.appendChild(btn('开始练错题', function () { startWrongPractice(sel.value, cnt.value); }, 'qz-primary'));
        tb.appendChild(btn('清空该库错题', function () {
            if (!sel.value) { alert('请先选择具体题库（“全部”下不提供一键清空）。'); return; }
            clearWrongBank(sel.value);
        }, 'qz-danger'));
        f.main.appendChild(tb);
        if (notice) noticeInMain('已清理 ' + notice + ' 条失效记录（题库版本变化后自动整理）');

        if (!total) {
            f.main.appendChild(el('div', 'qz-panel qz-empty', '暂无错题。答错题目会自动进入错题本。'));
            return;
        }

        var ids = metas.filter(function (b) {
            return (!sel.value || b.id === sel.value) && (counts[b.id] || 0) > 0;
        }).map(function (b) { return b.id; });
        if (!ids.length) {
            f.main.appendChild(el('div', 'qz-panel qz-empty', '该题库暂无错题。'));
            return;
        }

        var loading = el('div', 'qz-panel qz-meta', '正在加载错题…');
        f.main.appendChild(loading);
        Promise.all(ids.map(loadBank)).then(function (banks) {
            if (loading.parentNode) loading.parentNode.removeChild(loading);
            banks.forEach(function (b) {
                var w = getWrong(b.bankId);
                var items = b.questions.filter(function (q) { return !!w[q.id]; });
                items.sort(function (a, bb) {
                    return (w[bb.id].lastAt || '') < (w[a.id].lastAt || '') ? -1 : 1;
                });
                var p = el('div', 'qz-panel');
                p.appendChild(el('div', 'qz-bank-name', b.name + ' · ' + items.length + ' 题'));
                items.forEach(function (q) {
                    var info = w[q.id];
                    var yours = (info.lastSelected == null || q.opts[info.lastSelected] == null)
                        ? '未知' : LETTERS[info.lastSelected] + '. ' + q.opts[info.lastSelected];
                    var row = el('div', 'qz-wrong-item');
                    row.setAttribute('data-qid', q.id);
                    row.innerHTML = '<div class="qz-qno">第 ' + (q.no || 0) + ' 题'
                        + '<span class="qz-tag">错 ' + (info.count || 0) + ' 次</span>'
                        + '<span class="qz-tag">最近错选 ' + esc(yours) + '</span></div>'
                        + '<div style="line-height:1.6;">' + esc(q.q) + '</div>';
                    var ans = el('div', 'qz-exp');
                    ans.style.display = 'none';
                    ans.innerHTML = '<div><b>正确答案：</b>' + LETTERS[q.ansIndex] + '. ' + esc(q.opts[q.ansIndex]) + '</div>'
                        + '<div style="margin-top:4px;"><b>解析：</b>' + esc(q.explain) + '</div>';
                    var acts = el('div', 'qz-wrong-acts');
                    var showBtn = btn('查看正确项与解析', function () {
                        var show = ans.style.display === 'none';
                        ans.style.display = show ? 'block' : 'none';
                        showBtn.textContent = show ? '收起正确项与解析' : '查看正确项与解析';
                    });
                    acts.appendChild(showBtn);
                    acts.appendChild(btn('移除', function () {
                        removeWrong(b.bankId, q.id);
                        renderWrongBook();
                    }, 'qz-danger'));
                    row.appendChild(ans);
                    row.appendChild(acts);
                    p.appendChild(row);
                });
                f.main.appendChild(p);
            });
        }).catch(function (e) {
            if (loading.parentNode) loading.parentNode.removeChild(loading);
            f.main.appendChild(el('div', 'qz-panel', '错题加载失败：' + esc(e.message)));
        });
    }

    // ------------------------------------------------------------------
    global.QuizCore = {
        version: '1.3.0',
        // 清单 / 加载
        listBanks: listBanks,
        findBankMeta: findBankMeta,
        loadBank: loadBank,
        loadBanks: loadBanks,
        baseDir: function () { return BASE_DIR; },
        // 存储
        storageKey: storageKey,
        getProgress: getProgress,
        getBankStats: getBankStats,
        markAnswered: markAnswered,
        getWrong: getWrong,
        getHistory: getHistory,
        pushHistory: pushHistory,
        getPrefs: getPrefs,
        setPrefs: setPrefs,
        clearBank: clearBank,
        removeWrong: removeWrong,
        migrateBankRecords: migrateBankRecords,
        exportHistory: exportHistory,
        // 试卷
        createExam: createExam,
        gradeExam: gradeExam,
        // 渲染
        mount: mount,
        renderBankList: renderBankList,
        openBankView: openBankView,
        // 页内全屏模块（主界面入口调用）
        open: openModule,
        close: closeModule,
        // P3 页面
        openWrong: openWrongBook,
        openHistory: renderHistory
    };
})(window);
