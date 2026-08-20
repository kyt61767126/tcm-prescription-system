// 软件说明书 PDF 构建脚本
// 流程：md →(marked)→ HTML →(puppeteer第一遍：计算章节页码回填目录)→ HTML →(puppeteer第二遍：page.pdf 带页眉页脚)→ PDF
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const SC = __dirname;
const MD = path.join(SC, '软件说明书.md');
const BUILD = path.join(SC, '_build');
const OUT = path.join(SC, '惠康中医诊所管理系统V1.0.0_软件说明书.pdf');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// A4: 210x297mm；边距 上22 下20 左18 右18（96dpi: 1mm=3.7795px）
const CONTENT_W_PX = Math.round(174 * 3.7795);   // 174mm 内容宽
const CONTENT_H_PX = Math.round(255 * 3.7795);   // 255mm 内容高

function buildHtml(tocPages) {
  let md = fs.readFileSync(MD, 'utf8');
  let html = marked.parse(md, { async: false });
  // 截图与架构图加 class（便于统一控制打印尺寸）
  html = html.replace(/<img src="screenshots\/arch-diagram\.png"/, '<img class="arch" src="screenshots/arch-diagram.png"');
  html = html.replace(/<img ([^>]*?)src="screenshots\/shot/g, '<img class="shot" $1src="screenshots/shot');
  // 目录页码回填
  if (tocPages) {
    for (const [title, page] of Object.entries(tocPages)) {
      const re = new RegExp(`(<li>${title}[^<]*?)( ·····[^0-9]*)(\\d+)(</li>)`);
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
  img.shot[src*="print_preview"] { width: 11.5cm; }
  img.arch { display: block; margin: 8px auto; width: 15.6cm; max-width: 100%; page-break-inside: avoid; }
  blockquote img.shot, blockquote img.arch { page-break-inside: avoid; }
</style></head><body>
${html}
</body></html>`;
}

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  // 第一遍：估算各章页码
  fs.writeFileSync(path.join(BUILD, 'manual.html'), buildHtml(null), 'utf8');
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: CONTENT_W_PX, height: CONTENT_H_PX });
  await page.goto('file:///' + path.join(BUILD, 'manual.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 60000 });
  const headings = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('h2').forEach(h => out.push({ text: h.textContent.trim() }));
    return out;
  });
  const yMap = await page.evaluate(() => {
    const m = {};
    document.querySelectorAll('h2').forEach(h => { m[h.textContent.trim()] = h.offsetTop; });
    return m;
  });
  const tocPages = {};
  for (const h of headings) {
    const y = yMap[h.text] || 0;
    tocPages[h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] = Math.max(1, Math.ceil((y + 2) / CONTENT_H_PX));
  }
  console.log('章节页码估算:', JSON.stringify(tocPages, null, 0));
  // 第二遍：回填目录页码后正式输出
  fs.writeFileSync(path.join(BUILD, 'manual_final.html'), buildHtml(tocPages), 'utf8');
  await page.goto('file:///' + path.join(BUILD, 'manual_final.html').replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 60000 });
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
  console.log(`PDF 已生成: ${OUT}`);
  console.log(`大小: ${(buf.length / 1024).toFixed(0)} KB, 页数: ${m ? m[1] : '未知'}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
