# 说明书 PDF 生成流程（内部用）

> 用途：截图替换后，重新生成《惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf》。
> 环境：Windows + WPS Office + 带 python-docx 的 Python（本机用 DSH 自带 Python 即可）。

## 一、流程（5 步）

```powershell
$py = 'C:\Users\61767\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe'
$md = 'D:\trae_projects\kyt-zy\software_copyright\软件说明书_补正版.md'
$shots = 'D:\trae_projects\kyt-zy\software_copyright\screenshots'
$out = 'D:\trae_projects\kyt-zy\软著补正_20261105\tools\out'
$final = 'D:\trae_projects\kyt-zy\软著补正_20261105'

# 1) 先做"带目录域"的版本（用于自动测量各章真实页码）
& $py .\md2docx.py --md $md --out "$out\manual_field.docx" --toc-mode field --shots $shots

# 2) WPS 更新目录域并另存（得到带页码的目录）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\update-export.ps1 `
  -Docx "$out\manual_field.docx" -SaveAs "$out\manual_upd.docx"

# 3) 从更新后的 docx 中提取"章标题 → 页码"（脚本见下，输出 $out\toc.json）
& $py .\extract_toc.py

# 4) 用真实页码重建最终 docx（手工目录，版面可控）
& $py .\md2docx.py --md $md --out "$final\惠康中医诊所管理系统V1.0.0_软件说明书_补正版.docx" `
  --toc-mode manual --toc "$out\toc.json" --shots $shots

# 5) 导出最终 PDF（顺带更新页眉页脚域）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\update-export.ps1 `
  -Docx "$final\惠康中医诊所管理系统V1.0.0_软件说明书_补正版.docx" `
  -Pdf "$final\惠康中医诊所管理系统V1.0.0_软件说明书_补正版.pdf"
```

> 注意：WPS COM 退出时偶发挂起（进程占 CPU 但不返回），PDF 通常已生成，检查文件存在与 `/Count` 页数后直接结束进程即可。
> 第 3 步的 `extract_toc.py` 内容见下方附录；也可以让 AI 会话按同样逻辑临时生成。

## 二、截图要求

- 图片放 `D:\trae_projects\kyt-zy\software_copyright\screenshots\`，文件名与说明书 md 中的 8 个图位一致：
  `shot1_login.png`、`shot2_main.png`、`shot3_symptom.png`、`shot4_formula.png`、`shot7_case_history.png`、`shot5_analytics.png`、`shot7_stock.png`、`shot6_mobile_app.png`（另需 `arch-diagram.png` 架构图，已有）。
- 缺图不会导致失败：PDF 中显示灰色"截图占位"框，补图后重跑即可。

## 三、校验

1. PDF 页数约 50–60 页（A4）；
2. 打开 PDF 检查：封面、目录页码、8 张截图、图注、页眉页脚；
3. 运行 `software_copyright\提交前自检.bat`（或 `node check-submit.cjs`）确认两份 PDF 与 8 张截图齐全。

## 附录：extract_toc.py

```python
import docx, json, re
d = docx.Document(r"<manual_upd.docx 路径>")
paras = d.paragraphs
idx = next(i for i, p in enumerate(paras) if p.text.strip().replace(" ", "") == "目录")
out = {}
for p in paras[idx + 1: idx + 25]:
    t = p.text.strip()
    m = re.match(r"^(第[一二三四五六七八九十]+章.*?|附录\s?[A-F].*?)\t+(\d+)$", t)
    if m:
        out[m.group(1).strip()] = int(m.group(2))
json.dump(out, open(r"<toc.json 路径>", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("TOC entries:", len(out))
```
