// ============================================================================
// performance-utils.js — 性能优化工具模块
// 提供防抖/节流、空闲回调、虚拟滚动辅助、图片懒加载等工具
// 各端可渐进式采用，不破坏现有逻辑
// ============================================================================
(function (global) {
    'use strict';

    // ==================== 防抖 (Debounce) ====================
    // 延迟执行，适合搜索输入、窗口 resize 等高频事件
    function debounce(fn, wait) {
        let timer = null;
        const debounced = function () {
            const ctx = this, args = arguments;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                fn.apply(ctx, args);
                timer = null;
            }, wait || 200);
        };
        debounced.cancel = function () {
            if (timer) { clearTimeout(timer); timer = null; }
        };
        debounced.flush = function () {
            if (timer) {
                clearTimeout(timer);
                fn.apply(this, arguments);
                timer = null;
            }
        };
        return debounced;
    }

    // ==================== 节流 (Throttle) ====================
    // 固定频率执行，适合滚动、拖拽等持续事件
    function throttle(fn, wait) {
        let lastTime = 0;
        let timer = null;
        return function () {
            const ctx = this, args = arguments;
            const now = Date.now();
            const remaining = wait - (now - lastTime);
            if (remaining <= 0) {
                if (timer) { clearTimeout(timer); timer = null; }
                lastTime = now;
                fn.apply(ctx, args);
            } else if (!timer) {
                timer = setTimeout(() => {
                    lastTime = Date.now();
                    timer = null;
                    fn.apply(ctx, args);
                }, remaining);
            }
        };
    }

    // ==================== 空闲回调 (requestIdleCallback) ====================
    // 低优先级任务延后到浏览器空闲时执行，不阻塞用户交互
    function runIdle(fn, options) {
        if (typeof global.requestIdleCallback === 'function') {
            return global.requestIdleCallback(fn, options || { timeout: 1000 });
        }
        // 降级：setTimeout 50ms 后执行
        return setTimeout(fn, 50);
    }

    function cancelIdle(id) {
        if (typeof global.cancelIdleCallback === 'function') {
            global.cancelIdleCallback(id);
        } else {
            clearTimeout(id);
        }
    }

    // ==================== 简单虚拟滚动辅助 ====================
    // 适用于长列表（历史处方、药品库等），只渲染可视区域+缓冲区
    // 用法：
    //   const vs = PerfUtils.createVirtualScroller({
    //     container: document.getElementById('list'),
    //     itemHeight: 60,          // 单项高度
    //     bufferSize: 5,           // 上下缓冲项数
    //     render: (item, index) => {  // 返回 HTMLElement
    //       const el = document.createElement('div');
    //       el.textContent = item.name;
    //       return el;
    //     }
    //   });
    //   vs.setData(allItems);
    function createVirtualScroller(options) {
        const config = Object.assign({
            container: null,
            itemHeight: 50,
            bufferSize: 5,
            render: () => document.createElement('div'),
            onScroll: null
        }, options);

        if (!config.container) {
            console.warn('[PerfUtils] createVirtualScroller: container is required');
            return null;
        }

        const state = {
            data: [],
            scrollTop: 0,
            visibleCount: 0,
            renderTimer: null
        };

        // 创建内部 DOM 结构
        const viewport = config.container;
        viewport.style.overflowY = 'auto';
        viewport.style.position = 'relative';

        const spacer = document.createElement('div');
        spacer.style.position = 'relative';
        viewport.appendChild(spacer);

        const content = document.createElement('div');
        content.style.position = 'absolute';
        content.style.top = '0';
        content.style.left = '0';
        content.style.right = '0';
        spacer.appendChild(content);

        function render() {
            const containerHeight = viewport.clientHeight;
            state.visibleCount = Math.ceil(containerHeight / config.itemHeight) + config.bufferSize * 2;
            const startIndex = Math.max(0, Math.floor(state.scrollTop / config.itemHeight) - config.bufferSize);
            const endIndex = Math.min(state.data.length, startIndex + state.visibleCount);

            // 设置总高度撑开滚动条
            spacer.style.height = (state.data.length * config.itemHeight) + 'px';

            // 设置内容偏移
            content.style.transform = 'translateY(' + (startIndex * config.itemHeight) + 'px)';

            // 渲染可视项
            content.innerHTML = '';
            for (let i = startIndex; i < endIndex; i++) {
                const el = config.render(state.data[i], i);
                if (el) {
                    el.style.height = config.itemHeight + 'px';
                    el.style.boxSizing = 'border-box';
                    content.appendChild(el);
                }
            }

            if (config.onScroll) config.onScroll(startIndex, endIndex);
        }

        function onScroll() {
            state.scrollTop = viewport.scrollTop;
            if (state.renderTimer) cancelAnimationFrame(state.renderTimer);
            state.renderTimer = requestAnimationFrame(render);
        }

        viewport.addEventListener('scroll', throttle(onScroll, 16), { passive: true });

        return {
            setData(items) {
                state.data = items || [];
                state.scrollTop = viewport.scrollTop = 0;
                render();
            },
            refresh() { render(); },
            scrollToIndex(index) {
                viewport.scrollTop = index * config.itemHeight;
            },
            destroy() {
                viewport.removeEventListener('scroll', onScroll);
                viewport.innerHTML = '';
            }
        };
    }

    // ==================== 图片懒加载 (Lazy Image) ====================
    // 使用 IntersectionObserver 按需加载图片，减少首屏网络请求
    // 用法：
    //   PerfUtils.lazyImage(imgElement);  // img 的 data-src 设置真实 URL
    //   或 <img data-src="real.jpg" class="lazy">
    //   PerfUtils.observeLazyImages(document.querySelectorAll('img.lazy'));
    let _lazyObserver = null;

    function lazyImage(img) {
        if (!img) return;
        if (_lazyObserver) {
            _lazyObserver.observe(img);
        } else {
            // 降级：直接加载
            const src = img.getAttribute('data-src');
            if (src) img.src = src;
        }
    }

    function observeLazyImages(images) {
        if (!images || !images.length) return;

        if (!('IntersectionObserver' in global)) {
            // 降级：全部直接加载
            images.forEach(img => {
                const src = img.getAttribute('data-src');
                if (src) img.src = src;
            });
            return;
        }

        if (!_lazyObserver) {
            _lazyObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        const src = img.getAttribute('data-src');
                        if (src) {
                            img.src = src;
                            img.removeAttribute('data-src');
                        }
                        _lazyObserver.unobserve(img);
                    }
                });
            }, {
                rootMargin: '50px 0px',  // 提前 50px 加载
                threshold: 0.01
            });
        }

        images.forEach(img => {
            if (img.getAttribute('data-src')) {
                _lazyObserver.observe(img);
            }
        });
    }

    // ==================== DOM 批量更新 ====================
    // 使用 DocumentFragment 批量插入 DOM，减少重排
    // 用法：PerfUtils.batchAppend(container, items, (item) => createElement)
    function batchAppend(container, items, createElement) {
        if (!container || !items || !items.length) return;
        const fragment = document.createDocumentFragment();
        items.forEach(item => {
            const el = createElement(item);
            if (el) fragment.appendChild(el);
        });
        container.appendChild(fragment);
    }

    // ==================== 资源预加载 ====================
    // 空闲时预加载关键资源（如药品库 JSON）
    function prefetch(url, as) {
        runIdle(() => {
            try {
                const link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = url;
                link.as = as || 'fetch';
                document.head.appendChild(link);
            } catch (e) { /* 忽略 */ }
        });
    }

    // ==================== 执行耗时测量 ====================
    // 简单的性能测量工具
    function measure(name, fn) {
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        if (duration > 16) {  // 超过一帧才记录
            console.log('[Perf] ' + name + ': ' + duration.toFixed(2) + 'ms');
        }
        return result;
    }

    async function measureAsync(name, fn) {
        const start = performance.now();
        try {
            return await fn();
        } finally {
            const duration = performance.now() - start;
            if (duration > 16) {
                console.log('[Perf] ' + name + ': ' + duration.toFixed(2) + 'ms');
            }
        }
    }

    // ==================== 导出 ====================
    const PerfUtils = {
        debounce,
        throttle,
        runIdle,
        cancelIdle,
        createVirtualScroller,
        lazyImage,
        observeLazyImages,
        batchAppend,
        prefetch,
        measure,
        measureAsync
    };

    global.PerfUtils = PerfUtils;

    // ==================== 移动端键盘遮挡修复 ====================
    // 当药物表格内输入框获得焦点时，自动滚动到可见区域中央，避免被软键盘遮挡
    // 纯 JS 逻辑，不修改 HTML/CSS，仅监听 focusin 事件并调用 scrollIntoView
    function setupMobileKeyboardScroll() {
        // 仅在移动端（窄屏）启用，桌面端不需要
        if (window.innerWidth >= 769) return;

        var scrollTimer = null;

        // 监听整个 document 的 focusin 事件（事件冒泡）
        document.addEventListener('focusin', function(e) {
            var target = e.target;
            if (!target || target.tagName !== 'INPUT') return;

            // 检查是否在 medicine-table 内（药物输入表格）
            var table = target.closest ? target.closest('.medicine-table') : null;
            if (!table) return;

            // 延迟滚动，等待键盘动画完成（Android 键盘弹出约 250-300ms）
            if (scrollTimer) clearTimeout(scrollTimer);
            scrollTimer = setTimeout(function() {
                try {
                    // scrollIntoView block:center 将输入框滚动到可见区域中央
                    // 浏览器会自动避开软键盘区域
                    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                } catch(err) {
                    // 降级：旧版 WebView 不支持 options 参数
                    try { target.scrollIntoView(false); } catch(e2) {}
                }
            }, 350);
        }, true);

        // 使用 Visual Viewport API 动态调整表格容器高度（如果可用）
        // 当键盘弹出时，visualViewport.height 会减小，据此调整 max-height
        if (window.visualViewport) {
            var vvTimer = null;
            var adjustContainer = function() {
                if (vvTimer) clearTimeout(vvTimer);
                vvTimer = setTimeout(function() {
                    var containers = document.querySelectorAll('.medicine-table-container');
                    if (!containers.length) return;
                    // 可见高度减去其他界面元素估算高度（患者信息区+症状区+操作栏 约 280px）
                    var vh = window.visualViewport.height;
                    var maxH = Math.max(120, Math.min(400, vh - 280));
                    for (var i = 0; i < containers.length; i++) {
                        containers[i].style.maxHeight = maxH + 'px';
                    }
                }, 100);
            };
            window.visualViewport.addEventListener('resize', adjustContainer);
            // 延迟初始调整，等 DOM 完全加载
            setTimeout(adjustContainer, 500);
        }
    }

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMobileKeyboardScroll);
    } else {
        setupMobileKeyboardScroll();
    }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
