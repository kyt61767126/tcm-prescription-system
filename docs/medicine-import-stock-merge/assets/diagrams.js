(function () {
  if (typeof mermaid === 'undefined') return;
  mermaid.initialize({
    startOnLoad: true,
    theme: 'base',
    securityLevel: 'loose',
    flowchart: { curve: 'linear', nodePadding: 16, rankSpacing: 52 },
    themeVariables: {
      fontFamily: "'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif",
      fontSize: '14px',
      primaryColor: '#EAF6F1',
      primaryBorderColor: '#12B886',
      primaryTextColor: '#1C2B28',
      lineColor: '#64736E',
      edgeLabelBackground: '#FFFFFF',
      clusterBkg: '#F7FAF9',
      clusterBorder: '#D8E2DE',
      tertiaryColor: '#FDF1F1'
    }
  });
})();
