// ============================================================================
// voice-input.js —— 智能语音输入模块（语音版专属，2026-09-17 第一期）
// 版本线：cloud_voice（与 trial/personal/pro 平行的独立版本线）
//   权益 = 标准版全部 + 语音输入；1年/1设备
//
// 架构（三层，一期实现第①层）：
//   ① ASR 语音识别：Web Speech API（浏览器免费；Electron/WebView 无此 API 自动降级）
//      —— 四期离线端换 sherpa-onnx + SenseVoice 本地模型
//   ② NLU 语义路由：药名词典匹配（复用简码库）+ 年龄/性别/剂数正则 + 关键词触发（二期）
//   ③ 表单填充：浅紫色高亮待确认，复用现有选药事件链（showSearchDropdown/selectMedicine）
//
// ★ Feature gate 铁律（P0 安全设计）：
//   语音入口的显示与否 = 三重条件缺一不可（isAvailable()）：
//     1. 环境支持：window.SpeechRecognition / webkitSpeechRecognition 存在
//     2. 安全上下文：window.isSecureContext（麦克风权限需 https/localhost）
//     3. 版本授权：Permission.isVoiceEdition()——判定依据是服务端登录响应
//        clinicEdition（auth-core 登录钩子写入 CONFIG.edition），不信任本地可伪造标记
//   任一不满足 → 按钮不渲染 → 键盘开方完全不受影响（降级安全）。
//
// ★ P0 填充铁律：所有语音填充内容必须浅紫色高亮待医生确认；
//   语音药名强制走药名词典候选弹窗（showSearchDropdown），无匹配绝不静默填充。
//
// smoke-runtime S7 红线：无 DOM 环境加载不得抛错——所有 window.*/document.* 访问
// 一律 try-catch 包裹。
// ============================================================================
(function (global) {
    'use strict';

    var VoiceInput = {};

    // ── 1. 环境探测 ──────────────────────────────────────────────
    // Web Speech API 构造器（Chrome/Edge 系前缀 webkitSpeechRecognition）
    function getRecognitionCtor() {
        try {
            if (typeof window === 'undefined') return null;
            return window.SpeechRecognition || window.webkitSpeechRecognition || null;
        } catch (_) { return null; }
    }

    // 安全上下文检测（麦克风权限仅 https/localhost 可用）
    function isSecureCtx() {
        try {
            if (typeof window === 'undefined') return false;
            if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
            // 兜底：file:// 与 https:// 视为安全
            if (window.location && window.location.protocol === 'https:') return true;
            if (window.location && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname || '')) return true;
            return false;
        } catch (_) { return false; }
    }

    // 版本授权 gate：Permission.isVoiceEdition()（edition-lock 归一化后读取）
    function hasVoiceEntitlement() {
        try {
            if (global.Permission && typeof global.Permission.isVoiceEdition === 'function') {
                return !!global.Permission.isVoiceEdition();
            }
        } catch (_) {}
        // Permission 未加载时兜底直读 CONFIG.edition（edition-lock getter 已归一化）
        try {
            if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition) {
                return String(CONFIG.edition) === 'cloud_voice';
            }
        } catch (_) {}
        return false;
    }

    // ★ 三重条件入口判定（唯一 gate，注入按钮前必须调用）
    VoiceInput.isAvailable = function () {
        return !!(getRecognitionCtor() && isSecureCtx() && hasVoiceEntitlement());
    };

    // ── 2. ASR 识别（一期：Web Speech API） ─────────────────────
    var listening = false;
    var recognition = null;

    // 防重入：识别中重复点击直接忽略
    VoiceInput.isListening = function () { return listening; };

    /**
     * 单次语音识别（按下 🎤 → 说话 → 自动结束回调）
     * @param {Function} onResult  (text:string) => void 识别成功回调（已 trim）
     * @param {Function} onError   (msg:string) => void  失败/拒绝回调（用户可读中文）
     * @param {Function} onEnd     () => void 识别结束回调（无论成败，用于恢复按钮态）
     */
    VoiceInput.listen = function (onResult, onError, onEnd) {
        var Ctor = getRecognitionCtor();
        if (!Ctor) {
            if (typeof onError === 'function') onError('当前环境不支持语音识别');
            if (typeof onEnd === 'function') onEnd();
            return;
        }
        if (listening) {
            try { if (recognition) recognition.abort(); } catch (_) {}
            listening = false;
        }

        try {
            recognition = new Ctor();
        } catch (e) {
            if (typeof onError === 'function') onError('语音识别初始化失败');
            if (typeof onEnd === 'function') onEnd();
            return;
        }

        recognition.lang = 'zh-CN';
        recognition.interimResults = false;   // 一期只要最终结果（准确率优先）
        // ★ 2026-09-17 连报修复：多候选——ASR 对药名常输出同音字（白芍→白勺），
        //   收集全部候选供业务层逐个尝试匹配（单候选时同音字必 miss）。
        recognition.maxAlternatives = 5;
        recognition.continuous = false;       // 单句模式：说完自动结束

        listening = true;

        recognition.onresult = function (event) {
            try {
                var text = '';
                var alts = [];
                if (event && event.results && event.results.length > 0) {
                    var r = event.results[event.results.length - 1];
                    if (r && r.length > 0) {
                        for (var ai = 0; ai < r.length; ai++) {
                            var at = String(r[ai].transcript || '').trim();
                            if (!at) continue;
                            if (!text) text = at;
                            if (alts.indexOf(at) < 0) alts.push(at);
                        }
                    }
                }
                // onResult(text, alts)：alts = 全部候选文本（含首选，去重），旧调用方只收 text 不受影响
                if (text && typeof onResult === 'function') onResult(text, alts);
                else if (!text && typeof onError === 'function') onError('未识别到内容，请再试一次');
            } catch (e) {
                if (typeof onError === 'function') onError('识别结果处理异常');
            }
        };

        recognition.onerror = function (event) {
            var code = (event && event.error) || '';
            var msg;
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                msg = '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试';
            } else if (code === 'no-speech') {
                msg = '未检测到语音，请靠近麦克风重试';
            } else if (code === 'network') {
                msg = '语音服务网络异常，请检查网络后重试';
            } else if (code === 'aborted') {
                msg = '';  // 主动中止不算错误（静默）
            } else {
                msg = '语音识别失败（' + code + '），请重试';
            }
            if (msg && typeof onError === 'function') onError(msg);
        };

        recognition.onend = function () {
            listening = false;
            if (typeof onEnd === 'function') onEnd();
        };

        try {
            recognition.start();
        } catch (e) {
            // start 抛异常（如已启动竞态）——按失败处理
            listening = false;
            if (typeof onError === 'function') onError('语音识别启动失败，请重试');
            if (typeof onEnd === 'function') onEnd();
        }
    };

    // ── 3. 高亮辅助（P0：语音填充内容必须高亮待确认） ────────────
    // 浅紫色高亮：target 填充后加 class + 2.5s 后淡出（医生可继续编辑）
    var HIGHLIGHT_CLASS = 'voice-filled-highlight';
    var highlightStyleInjected = false;

    function ensureHighlightStyle() {
        try {
            if (highlightStyleInjected) return;
            if (typeof document === 'undefined' || !document.head) return;
            var style = document.createElement('style');
            style.id = 'voice-input-highlight-style';
            style.textContent = '.' + HIGHLIGHT_CLASS + '{background:#f3eefa !important;box-shadow:0 0 0 1px #b9a6f2 inset !important;transition:background .6s,box-shadow .6s;}';
            document.head.appendChild(style);
            highlightStyleInjected = true;
        } catch (_) {}
    }

    VoiceInput.highlight = function (el) {
        try {
            if (!el || !el.classList) return;
            ensureHighlightStyle();
            el.classList.add(HIGHLIGHT_CLASS);
            // 2.5s 后淡出高亮（内容保留，仅提示色消退；再次填充会重新高亮）
            setTimeout(function () {
                try { el.classList.remove(HIGHLIGHT_CLASS); } catch (_) {}
            }, 2500);
        } catch (_) {}
    };

    // ── 3.5 拼音容错（2026-09-17 连报修复：ASR 药名同音字根治） ──
    // vendor/pinyin-pro.min.js 本地按需加载（云端网页语音版专属；其余端
    // isAvailable()=false 永不触达，vendor 404 也只静默降级——拼音匹配不可用，
    // 精确/多候选匹配照常）。加载失败 resolve(null)，绝不 reject（防未捕获异常）。
    var pinyinProPromise = null;
    VoiceInput.ensurePinyin = function () {
        if (pinyinProPromise) return pinyinProPromise;
        pinyinProPromise = new Promise(function (resolve) {
            try {
                if (global.pinyinPro && typeof global.pinyinPro.pinyin === 'function') { resolve(global.pinyinPro); return; }
                if (typeof document === 'undefined' || !document.head) { resolve(null); return; }
                var s = document.createElement('script');
                s.src = 'vendor/pinyin-pro.min.js';
                s.onload = function () { resolve(global.pinyinPro || null); };
                s.onerror = function () { pinyinProPromise = null; resolve(null); }; // 允许下次重试
                document.head.appendChild(s);
            } catch (e) { pinyinProPromise = null; resolve(null); }
        });
        return pinyinProPromise;
    };

    // 汉字→无声调全拼（如 白勺/白芍 → baishao）；未加载/失败返回 ''（调用方跳过拼音匹配）
    VoiceInput.toPinyin = function (text) {
        try {
            var P = global.pinyinPro;
            if (!P || typeof P.pinyin !== 'function') return '';
            return P.pinyin(String(text || ''), { toneType: 'none', type: 'string' }).replace(/\s+/g, '');
        } catch (e) { return ''; }
    };

    // ── 4. 文本后处理（常见同音字/口语词归一，一期轻量规则） ──────
    // 年龄/性别类字段识别后清洗；药名/姓名/诊断不做强归一（走词典/人工确认）
    VoiceInput.cleanText = function (text) {
        return String(text || '')
            .replace(/[，。！？、\s]+/g, '')   // 去标点与空白（医嘱口述场景）
            .trim();
    };

    // 从口述文本提取性别（男/女关键词）
    VoiceInput.extractGender = function (text) {
        var t = String(text || '');
        if (t.indexOf('男') >= 0) return '男';
        if (t.indexOf('女') >= 0) return '女';
        return '';
    };

    // 从口述文本提取年龄（中文数字 + 阿拉伯数字，支持"岁"）
    VoiceInput.extractAge = function (text) {
        var t = String(text || '');
        // 阿拉伯数字优先（识别引擎通常输出阿拉伯数字）
        var m = t.match(/(\d{1,3})\s*岁?/);
        if (m) {
            var n = parseInt(m[1], 10);
            if (n > 0 && n < 150) return String(n);
        }
        // 中文数字兜底（一到九十九）
        // 含「百/千/万/零」的复合表达（如"一百二十岁"）无法可靠解析——
        // 截断误填（一百二→1）比不填更危险，宁缺勿错直接放弃
        if (/[百千万零]/.test(t)) return '';
        var cnMap = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
        var m2 = t.match(/([一二两三四五六七八九十]{1,3})\s*岁?/);
        if (m2) {
            var s = m2[1];
            var v = 0;
            if (s.length === 1) v = cnMap[s] || 0;
            else if (s.length === 2 && s[0] === '十') v = 10 + (cnMap[s[1]] || 0);         // 十八
            else if (s.length === 2 && s[1] === '十') v = (cnMap[s[0]] || 0) * 10;         // 二十
            else if (s.length === 3 && s[1] === '十') v = (cnMap[s[0]] || 0) * 10 + (cnMap[s[2]] || 0); // 二十五
            if (v > 0 && v < 150) return String(v);
        }
        return '';
    };

    // ── 暴露 ─────────────────────────────────────────────────────
    global.VoiceInput = VoiceInput;

})(typeof window !== 'undefined' ? window : this);
