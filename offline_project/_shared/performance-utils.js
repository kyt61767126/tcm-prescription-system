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

    // ==================== 药物候选框防键盘遮挡 ====================
    // 问题：showSearchDropdown 将候选框固定显示在输入框下方，键盘弹出时下方空间不足被遮挡
    // 修复：监听候选框显示，动态判断上方/下方空间，空间不足时显示在输入框上方
    function setupDropdownKeyboardFix() {
        if (window.innerWidth >= 769) return;

        var dropdown = document.getElementById('medicineSearchDropdown');
        if (!dropdown) {
            setTimeout(setupDropdownKeyboardFix, 500);
            return;
        }

        function repositionDropdown() {
            if (dropdown.style.display !== 'block') return;
            var activeEl = document.activeElement;
            if (!activeEl || activeEl.tagName !== 'INPUT') return;

            var rect = activeEl.getBoundingClientRect();
            var winHeight = window.innerHeight;
            var vvHeight = window.visualViewport ? window.visualViewport.height : winHeight;

            // ★ adjustPan 模式下 visualViewport.height 不更新（仍=innerHeight），需保守估算键盘高度
            // 键盘通常占屏幕高度 35%-45%，取 40% 作为保守估计
            var visibleHeight;
            if (winHeight - vvHeight < 50) {
                // visualViewport 未检测到键盘（adjustPan 模式），保守估算
                visibleHeight = winHeight * 0.6;
            } else {
                // visualViewport 检测到键盘（adjustResize 模式），使用实际值
                visibleHeight = vvHeight;
            }

            var availableBelow = visibleHeight - rect.bottom;
            var availableAbove = rect.top;
            var dropdownMaxHeight = 250;

            // 下方空间不足且上方空间更大时，候选框显示在输入框上方
            if (availableBelow < 120 && availableAbove > availableBelow) {
                var aboveHeight = Math.min(availableAbove - 4, dropdownMaxHeight);
                dropdown.style.top = Math.max(0, rect.top - aboveHeight - 2) + 'px';
                dropdown.style.maxHeight = aboveHeight + 'px';
            } else {
                // 下方显示，限制最大高度不超过可用空间
                var belowHeight = Math.min(Math.max(availableBelow - 4, 60), dropdownMaxHeight);
                dropdown.style.top = (rect.bottom + 2) + 'px';
                dropdown.style.maxHeight = belowHeight + 'px';
            }
        }

        // 监听候选框 style 变化（showSearchDropdown 设置 display=block 时触发）
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                if (m.attributeName === 'style' && dropdown.style.display === 'block') {
                    setTimeout(repositionDropdown, 10);
                    setTimeout(repositionDropdown, 200);
                }
            });
        });
        observer.observe(dropdown, { attributes: true, attributeFilter: ['style'] });

        // 键盘弹出/收起时重新定位
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', function() {
                if (dropdown.style.display === 'block') {
                    setTimeout(repositionDropdown, 50);
                }
            });
        }
    }

    // ==================== 移动端键盘遮挡修复 ====================
    // adjustResize 模式下：键盘弹出时系统缩小视口，fixed 元素自动保持在键盘上方
    // scrollIntoView 即可让焦点元素滚动到可见区域
    function setupMobileKeyboardScroll() {
        // 仅在移动端（窄屏）启用，桌面端不需要
        if (window.innerWidth >= 769) return;

        var lastFocusedInput = null;

        // 滚动焦点元素到可见区域中央（adjustResize 模式下 scrollIntoView 即可）
        function doScroll(target) {
            if (!target) return;
            try {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                // 同时调整容器内部滚动（确保焦点行完全可见）
                var container = target.closest ? target.closest('.medicine-table-container') : null;
                if (container) {
                    var targetRect = target.getBoundingClientRect();
                    var containerRect = container.getBoundingClientRect();
                    var vh = window.innerHeight;
                    var safeMargin = 80;
                    if (targetRect.bottom > vh - safeMargin) {
                        var targetCenterInContainer = targetRect.top + targetRect.height / 2 - containerRect.top;
                        var containerCenter = containerRect.height / 2;
                        var scrollDelta = targetCenterInContainer - containerCenter;
                        if (Math.abs(scrollDelta) > 5) {
                            var newTop = container.scrollTop + scrollDelta;
                            var maxScroll = container.scrollHeight - container.clientHeight;
                            if (newTop < 0) newTop = 0;
                            if (newTop > maxScroll) newTop = maxScroll;
                            try {
                                container.scrollTo({ top: newTop, behavior: 'smooth' });
                            } catch(e) {
                                container.scrollTop = newTop;
                            }
                        }
                    }
                }
            } catch(err) {
                try { target.scrollIntoView(false); } catch(e2) {}
            }
        }

        // 监听 focusin 事件（捕获阶段，确保最早收到）
        document.addEventListener('focusin', function(e) {
            var target = e.target;
            if (!target) return;
            if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') return;

            // 检查是否在 medicine-table 内（药物输入表格）
            var table = target.closest ? target.closest('.medicine-table') : null;
            if (!table) return;

            lastFocusedInput = target;

            // 多次尝试滚动，适配不同设备的键盘弹出速度
            setTimeout(function() { doScroll(target); }, 100);
            setTimeout(function() { doScroll(target); }, 300);
            setTimeout(function() { doScroll(target); }, 500);
            setTimeout(function() { doScroll(target); }, 800);
        }, true);

        // 监听 focusout 清除 lastFocusedInput（延迟清除避免快速切换丢失）
        document.addEventListener('focusout', function() {
            setTimeout(function() {
                if (!document.activeElement || document.activeElement === document.body) {
                    lastFocusedInput = null;
                }
            }, 100);
        }, true);

        // visualViewport.resize 事件触发时重新滚动（键盘弹出/收起时会触发）
        function onViewportChange() {
            if (lastFocusedInput) {
                setTimeout(function() { doScroll(lastFocusedInput); }, 50);
                setTimeout(function() { doScroll(lastFocusedInput); }, 200);
                setTimeout(function() { doScroll(lastFocusedInput); }, 400);
            }
        }

        // Visual Viewport API（现代浏览器）- 键盘弹出时会触发
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', onViewportChange);
            window.visualViewport.addEventListener('scroll', onViewportChange);
        }
    }

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMobileKeyboardScroll);
        document.addEventListener('DOMContentLoaded', setupDropdownKeyboardFix);
    } else {
        setupMobileKeyboardScroll();
        setupDropdownKeyboardFix();
    }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
