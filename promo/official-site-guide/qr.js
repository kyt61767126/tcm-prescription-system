/* 收款码示意图：确定性伪随机点阵 + 三个定位角（仅示意，非真实二维码） */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  function rect(svg, x, y, w, h, fill) {
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill);
    svg.appendChild(r);
  }
  document.querySelectorAll('svg.qr').forEach(function (svg) {
    var n = 29;
    var seed = svg.getAttribute('data-seed') || 'qr';
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    var rnd = function () { h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff; return h / 0x7fffffff; };
    var inFinder = function (x, y) {
      return (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    };
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (inFinder(x, y)) continue;
        if (rnd() < 0.46) rect(svg, x, y, 1.06, 1.06, '#0f172a');
      }
    }
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (p) {
      rect(svg, p[0], p[1], 7, 7, '#0f172a');
      rect(svg, p[0] + 1, p[1] + 1, 5, 5, '#ffffff');
      rect(svg, p[0] + 2, p[1] + 2, 3, 3, '#0f172a');
    });
  });
})();
