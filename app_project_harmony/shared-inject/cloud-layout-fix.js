/*
 * 注入脚本：布局修正 + 登录页版本号显示
 * 语义提取自安卓云端版 MainActivity.injectLayoutFixScript（2026-09-01）
 * 差异：安卓在 Java 侧拼接 versionName/versionCode；鸿蒙端由原生先注入
 *       window.__HK_APP_VERSION__ / window.__HK_APP_CODE__，本脚本读取。
 * 注入时机：onPageEnd（立即 + 600ms + 1500ms 三次重试，与安卓一致）
 */
(function() {
  if (window._layoutFixInjected) return;
  window._layoutFixInjected = true;
  var style = document.createElement('style');
  style.id = 'app-layout-fix';
  style.textContent = '    html, body { box-sizing: border-box !important; }    .top-tabs-left, .top-tabs { position: relative !important; z-index: 10 !important; }  ';
  document.head.appendChild(style);
})();

/* 版本号显示（独立 IIFE，可重复注入，自带幂等守卫） */
(function() {
  try {
    var vn = window.__HK_APP_VERSION__ || '1.0.0';
    var vc = window.__HK_APP_CODE__ || 0;
    // 2026-11-15 版本口径统一（方案A）：原生已注入四段 APP_VERSION（如 V1.0.0.1000002），
    // 此时直接采用，避免再拼接「Build N」产生第二个版本口径。
    var av = String(window.APP_VERSION || '');
    var hasBuild = /^V\d+(\.\d+){3,}$/.test(av);
    // 四段号已含构建号，__APP_BUILD__ 置空，避免标题/帮助弹窗再拼一次「Build N」
    window.__APP_BUILD__ = hasBuild ? '' : ('Build ' + vc);
    if (typeof applyEditionTags === 'function') { try { applyEditionTags(); } catch (e0) {} }
    var t = document.querySelector('title');
    if (hasBuild) {
      if (t && t.textContent.indexOf(av) === -1) { t.textContent += ' ' + av; }
      var v1f = document.querySelector('.login-footer');
      if (v1f) { v1f.textContent = v1f.textContent.replace(/(版本:\s*)V[0-9.]+/, '$1' + av); }
      var v2f = document.querySelector('.version-tag');
      if (v2f && v2f.textContent) {
        var vhf = v2f.innerHTML || v2f.textContent;
        v2f.innerHTML = vhf.replace(/V[0-9.]+(\s+Build\s+\d+)?/, av);
      }
    } else {
      if (t && t.textContent.indexOf('Build') === -1) { t.textContent += ' V' + vn + ' Build ' + vc; }
      var v1 = document.querySelector('.login-footer');
      if (v1 && v1.textContent.indexOf('Build') === -1) {
        v1.textContent = v1.textContent.replace(/(\|\s*版本:\s*V[0-9.]+)/, '$1 Build ' + vc);
        if (v1.textContent.indexOf('Build') === -1) v1.textContent += ' | 版本: V' + vn + ' Build ' + vc;
      }
      var v2 = document.querySelector('.version-tag');
      if (v2 && v2.textContent && v2.textContent.indexOf('Build') === -1) {
        var vh = v2.innerHTML; if (!vh) vh = v2.textContent;
        v2.innerHTML = vh.replace(/(V[0-9.]+)/, '$1 Build ' + vc);
      }
    }
  } catch (e) {}
})();
