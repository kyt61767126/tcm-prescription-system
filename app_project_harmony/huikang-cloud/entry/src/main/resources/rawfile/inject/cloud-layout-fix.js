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
    window.__APP_BUILD__ = 'Build ' + vc;
    if (typeof applyEditionTags === 'function') { try { applyEditionTags(); } catch (e0) {} }
    var t = document.querySelector('title');
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
  } catch (e) {}
})();
