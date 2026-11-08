# 从 WPS 更新过目录域的 docx 中提取「章标题 → 起始页码」
import docx
import json
import re
import sys

DOCX = sys.argv[1] if len(sys.argv) > 1 else r"D:\trae_projects\kyt-zy\软著补正_20261105\tools\out\manual_upd.docx"
OUT = sys.argv[2] if len(sys.argv) > 2 else r"D:\trae_projects\kyt-zy\软著补正_20261105\tools\out\toc.json"

d = docx.Document(DOCX)
paras = d.paragraphs
idx = None
for i, p in enumerate(paras):
    if p.text.strip().replace(" ", "") == "目录":
        idx = i
        break
if idx is None:
    raise SystemExit("未找到目录标题")

out = {}
for p in paras[idx + 1: idx + 30]:
    t = p.text.strip()
    m = re.match(r"^(第[一二三四五六七八九十]+章.*?|附录\s?[A-F].*?)\t+(\d+)$", t)
    if m:
        out[m.group(1).strip()] = int(m.group(2))

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("TOC entries:", len(out))
for k, v in out.items():
    print(" ", k, "->", v)
