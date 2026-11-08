// 软件说明书（补正版）PDF 构建脚本
// 用法：双击 软件说明书_重建PDF.bat，或在本目录执行  node build-manual-pdf-v2.cjs
// 流程：md →（marked）→ HTML →（puppeteer 第一遍估算各章页码，回填目录）→ HTML →（第二遍 page.pdf 带页眉页脚）→ PDF
// 与旧脚本的区别：
//   1) 读取 软件说明书_补正版.md，输出 惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf
//   2) 截图缺失时不再整篇报错，而是渲染"占位框"并在控制台列出缺哪几张——方便分步替换截图
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const SC = __dirname;
const MD = path.join(SC, '..', '软著补正_20261105', 'plain', '软件说明书_补正版_通俗版.md');
const BUILD = path.join(SC, '_build_manual');
const OUT = path.join(SC, '惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf');
const SHOTS_DIR = path.join(SC, 'screenshots');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const EDGE = EDGE_CANDIDATES.find((p) => fs.existsSync(p));

// A4：210x297mm；边距：上22 下20 左右18 → 内容区 174mm x 255mm
const CONTENT_W_PX = Math.round(174 * 3.7795);
const CONTENT_H_PX = Math.round(255 * 3.7795);

const missingShots = [];

function buildHtml(tocPages) {
  if (!fs.existsSync(MD)) {
    throw new Error('未找到说明书源文件：' + MD);
  }
  let md = fs.readFileSync(MD, 'utf8');
  let html = marked.parse(md, { async: false });

  // 图片路径改绝对 file:// URI（HTML 在 _build_manual/ 子目录，相对路径会解析失败）
  html = html.replace(/src="screenshots\//g, 'src="file:///' + SC.replace(/\\/g, '/') + '/screenshots/');

  // 缺失截图 → 占位框（不中断构建）
  html = html.replace(/<img[^>]*src="file:\/\/\/([^"]+)"[^>]*>/g, (m, absPath) => {
    const decoded = decodeURIComponent(absPath);
    if (decoded.includes('/screenshots/') && !fs.existsSync(decoded)) {
      const name = path.basename(decoded);
      missingShots.push(name);
      return `<div class="ph">【截图占位】缺少 screenshots/${name}<br>请按《截图清单与命名.txt》补拍同名文件后重新运行本脚本</div>`;
    }
    return m;
  });

  // 截图与架构图加 class，统一控制打印尺寸
  html = html.replace(/<img src="file:\/\/\/[^"]*arch-diagram\.png"/, '<img class="arch" src="file:///' + SC.replace(/\\/g, '/') + '/screenshots/arch-diagram.png"');
  html = html.replace(/<img ([^>]*?)src="file:\/\/\/([^"]*screenshots\/shot)/g, '<img class="shot" $1src="file:///$2');

  // 目录页码回填
  if (tocPages) {
    for (const [title, page] of Object.entries(tocPages)) {
      const re = new RegExp(`(<li>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*?)([·.．]{2,}[^0-9]*)(\\d+)(</li>)`);
      html = html.replace(re, `$1$2${page}$4`);
    }
  }

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>惠康中医诊所管理系统 V1.0.0 软件说明书</title>
<style>
  body { font-family: "SimSun","宋体",serif; font-size: 10.5pt; line-height: 1.75; color: #000; margin: 0; }
  h1,h2,h3,h4 { font-family: "SimHei","黑体","Microsoft YaHei",sans-serif; line-height: 1.4; }
  h1 { font-size: 20pt; text-align: center; }
  h2 { font-size: 15pt; page-break-before: always; border-bottom: 2px solid #333; padding-bottom: 4px; margin: 0 0 14px; }
  h2:first-of-type { page-break-before: avoid; }
  h3 { font-size: 12.5pt; margin: 16px 0 8px; }
  h4 { font-size: 11pt; margin: 12px 0 6px; }
  p { margin: 6px 0; text-align: justify; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
  th, td { border: 1px solid #888; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; font-family: "SimHei","黑体",sans-serif; }
  ul, ol { margin: 6px 0; padding-left: 2em; }
  li { margin: 3px 0; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 8.5pt; background: #f4f4f4; padding: 1px 3px; }
  pre { background: #f4f4f4; padding: 8px; font-size: 8.5pt; overflow: hidden; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #999; background: #fafafa; color: #333; }
  hr { border: none; border-top: 1px solid #bbb; margin: 10px 0; }
  img.shot { display: block; margin: 6px auto; width: 14.8cm; max-width: 100%; page-break-inside: avoid; }
  img.shot[src*="mobile_app"] { width: 8.5cm; }
  img.arch { display: block; margin: 8px auto; width: 15.6cm; max-width: 100%; page-break-inside: avoid; }
  blockquote img.shot, blockquote img.arch { page-break-inside: avoid; }
  .ph { display: block; margin: 6px auto; width: 14.8cm; box-sizing: border-box; border: 1px dashed #999; background: #fafafa;
        color: #777; font-family: "SimHei","黑体",sans-serif; font-size: 10pt; text-align: center; padding: 26px 10px; line-height: 1.8; }
</style></head><body>
${html}
</body></html>`;
}

(async () => {
  if (!EDGE) {
    console.error('未找到 Microsoft Edge，无法生成 PDF。请确认已安装 Edge，或把脚本里的 EDGE 路径改成本机路径。');
    process.exit(1);
  }
  fs.mkdirSync(BUILD, { recursive: true });

  // 调试/自检模式：只生成 HTML，不启动浏览器（HTML_ONLY=1）
  if (process.env.HTML_ONLY === '1') {
    const html = buildHtml(null);
    const outHtml = path.join(BUILD, 'manual_preview.html');
    fs.writeFileSync(outHtml, html, 'utf8');
    console.log('已生成预览 HTML：' + outHtml);
    console.log('页面标题数（h2）：' + (html.match(/<h2/g) || []).length);
    console.log('图片占位数：' + (html.match(/class="ph"/g) || []).length);
    const uniq0 = [...new Set(missingShots)];
    if (uniq0.length) { console.log('缺失截图：'); uniq0.forEach((n) => console.log('  - screenshots/' + n)); }
    return;
  }

  // 第一遍：估算各章页码
  fs.writeFileSync(path.join(BUILD, 'manual.html'), buildHtml(null), 'utf8');
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: CONTENT_W_PX, height: CONTENT_H_PX });
  await page.goto('file:///' + path.join(BUILD, 'manual.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 120000 });

  const headings = await page.evaluate(() => Array.from(document.querySelectorAll('h2')).map((h) => h.textContent.trim()));
  const yMap = await page.evaluate(() => {
    const m = {};
    document.querySelectorAll('h2').forEach((h) => { m[h.textContent.trim()] = h.offsetTop; });
    return m;
  });
  const tocPages = {};
  for (const t of headings) {
    const y = yMap[t] || 0;
    tocPages[t] = Math.max(1, Math.ceil((y + 2) / CONTENT_H_PX));
  }

  // 第二遍：回填目录页码后正式输出
  fs.writeFileSync(path.join(BUILD, 'manual_final.html'), buildHtml(tocPages), 'utf8');
  await page.goto('file:///' + path.join(BUILD, 'manual_final.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 120000 });
  await page.pdf({
    path: OUT,
    format: 'A4',
    portrait: true,
    printBackground: true,
    displayHeaderFooter: true,
    margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' },
    headerTemplate: `<div style="width:100%;text-align:center;font-size:9px;color:#333;font-family:'SimSun',serif;padding-top:4px;">惠康中医诊所管理系统 V1.0.0</div>`,
    footerTemplate: `<div style="width:100%;text-align:center;font-size:9px;color:#333;font-family:'SimSun',serif;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>`
  });
  await browser.close();

  const buf = fs.readFileSync(OUT);
  const m = buf.toString('latin1').match(/\/Count\s+(\d+)/);
  console.log('');
  console.log('====================================');
  console.log('说明书 PDF 已生成：');
  console.log('  ' + OUT);
  console.log('  大小：' + (buf.length / 1024).toFixed(0) + ' KB，页数：' + (m ? m[1] : '未知'));
  console.log('====================================');
  if (missingShots.length) {
    const uniq = [...new Set(missingShots)];
    console.log('以下截图缺失，PDF 中显示为虚线占位框，补齐后重新运行本脚本即可：');
    uniq.forEach((n) => console.log('  - screenshots/' + n));
  } else {
    console.log('8 张截图齐全，可直接提交。');
  }
  console.log('');
})().catch((e) => {
  console.error('生成失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
