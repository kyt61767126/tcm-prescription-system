/*
 * 注入脚本：禁用密码框自动填充（防系统 Autofill 弹凭据提示）
 * 语义逐字提取自安卓云端版 MainActivity.injectAutocompleteOff（2026-09-01）
 * 注入时机：onPageBegin / onPageEnd（与安卓 onPageStarted/onPageFinished 一致）
 */
(function() {
  function np(p) {
    if (!p || p.__bnAf) return;
    p.__bnAf = 1;
    p.setAttribute('autocomplete', 'new-password');
    p.setAttribute('data-lpignore', 'true');
    p.setAttribute('data-form-type', 'other');
    p.setAttribute('role', 'textbox');
    p.setAttribute('readonly', '');
    p.addEventListener('focus', function() { this.removeAttribute('readonly'); });
  }
  function scan() {
    var s = 'input[type="password"],input[autocomplete*="password"],input[name*="password"],input[name*="pwd"]';
    var l = document.querySelectorAll(s);
    for (var i = 0; i < l.length; i++) { np(l[i]); }
  }
  scan();
  if (!window.__bnAfObs) {
    window.__bnAfObs = new MutationObserver(function() { scan(); });
    var t = document.body || document.documentElement;
    if (t) window.__bnAfObs.observe(t, {childList: true, subtree: true, attributes: true, attributeFilter: ['type']});
  }
})();
