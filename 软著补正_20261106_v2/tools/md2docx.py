# 说明书 Markdown → DOCX 转换器（针对 软件说明书_补正版.md 的语法子集）
# 用法：
#   python md2docx.py --md <md路径> --out <docx路径> [--toc <页码json>] [--shots <截图目录>]
# 页码 json 形如 {"第一章 软件概述": 1, "附录 A：数据字段说明": 33}
import argparse
import json
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import (WD_ALIGN_PARAGRAPH, WD_LINE_SPACING,
                            WD_TAB_ALIGNMENT, WD_TAB_LEADER)
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt, RGBColor

FONT_CN = "SimSun"
FONT_HEI = "SimHei"
FONT_CODE = "Consolas"
BODY_SIZE = Pt(9.5)
LINE_MULT = 1.26

ap = argparse.ArgumentParser()
ap.add_argument("--md", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--toc", default="")
ap.add_argument("--toc-mode", default="manual", choices=["manual", "field"])
ap.add_argument("--shots", default="")
args = ap.parse_args()

SHOTS = args.shots or os.path.join(os.path.dirname(os.path.abspath(args.md)), "screenshots")
TOC_MAP = {}
if args.toc and os.path.exists(args.toc):
    with open(args.toc, "r", encoding="utf-8-sig") as f:
        TOC_MAP = json.load(f)

with open(args.md, "r", encoding="utf-8") as f:
    LINES = f.read().splitlines()

doc = Document()
cp = doc.core_properties
cp.author = "高碑店惠康堂中医诊所有限公司"
cp.last_modified_by = "高碑店惠康堂中医诊所有限公司"
cp.title = "惠康中医诊所管理系统V1.0.0 软件说明书（补正版V2）"
cp.subject = "计算机软件著作权登记——软件说明书"
cp.comments = ""

# ---------- 页面与默认样式 ----------
sec = doc.sections[0]
sec.page_width = Mm(210)
sec.page_height = Mm(297)
sec.top_margin = Mm(20)
sec.bottom_margin = Mm(18)
sec.left_margin = Mm(18)
sec.right_margin = Mm(18)
sec.header_distance = Mm(9)
sec.footer_distance = Mm(7)

style = doc.styles["Normal"]
style.font.name = FONT_CN
style.font.size = BODY_SIZE
rpr = style.element.get_or_add_rPr()
rf = rpr.find(qn("w:rFonts"))
if rf is None:
    rf = OxmlElement("w:rFonts")
    rpr.append(rf)
rf.set(qn("w:ascii"), FONT_CODE if False else "Times New Roman")
rf.set(qn("w:hAnsi"), "Times New Roman")
rf.set(qn("w:eastAsia"), FONT_CN)
pf = style.paragraph_format
pf.space_before = Pt(0)
pf.space_after = Pt(1.5)
pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
pf.line_spacing = LINE_MULT


def set_fonts(run, cn=FONT_CN, ascii_font="Times New Roman"):
    run.font.name = ascii_font
    r = run._element.get_or_add_rPr().get_or_add_rFonts()
    r.set(qn("w:ascii"), ascii_font)
    r.set(qn("w:hAnsi"), ascii_font)
    r.set(qn("w:eastAsia"), cn)


def bottom_border(p, sz="6", color="333333", space="2"):
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), sz)
    bottom.set(qn("w:space"), space)
    bottom.set(qn("w:color"), color)
    pBdr.append(bottom)
    pPr.append(pBdr)


def add_field(par, instr, size=Pt(9)):
    run = par.add_run()
    fld = OxmlElement("w:fldChar")
    fld.set(qn("w:fldCharType"), "begin")
    run._r.append(fld)
    r2 = par.add_run()
    it = OxmlElement("w:instrText")
    it.set(qn("xml:space"), "preserve")
    it.text = instr
    r2._r.append(it)
    r3 = par.add_run()
    f2 = OxmlElement("w:fldChar")
    f2.set(qn("w:fldCharType"), "separate")
    r3._r.append(f2)
    r4 = par.add_run("1")
    r5 = par.add_run()
    f3 = OxmlElement("w:fldChar")
    f3.set(qn("w:fldCharType"), "end")
    r5._r.append(f3)
    for r in (run, r2, r3, r4, r5):
        r.font.size = size
        set_fonts(r)


# 页眉：一行内「居中：软件名称+版本+著作权人」+「右上角：第 X 页 / 共 N 页」
# 版心宽 210-18*2 = 174mm，居中制表位 87mm，右制表位 174mm（右端对齐版心右边界）
HEADER_TEXT = "惠康中医诊所管理系统 V1.0.0｜著作权人：高碑店惠康堂中医诊所有限公司"
TEXT_W_CM = 17.4
NUMBERED_TOTAL = 32          # 封面不编号：33 张纸中显示 1..32


def build_header(par, with_number):
    for _r in list(par.runs):
        _r._element.getparent().remove(_r._element)
    par.alignment = WD_ALIGN_PARAGRAPH.LEFT
    par.paragraph_format.space_before = Pt(0)
    par.paragraph_format.space_after = Pt(1)
    par.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    par.paragraph_format.tab_stops.add_tab_stop(Cm(TEXT_W_CM / 2), WD_TAB_ALIGNMENT.CENTER)
    par.paragraph_format.tab_stops.add_tab_stop(Cm(TEXT_W_CM), WD_TAB_ALIGNMENT.RIGHT)
    _r = par.add_run("\t" + HEADER_TEXT)
    _r.font.size = Pt(9)
    set_fonts(_r, ascii_font=FONT_CN)
    if with_number:
        _r = par.add_run("\t第 ")
        _r.font.size = Pt(9)
        add_field(par, " PAGE ")
        _r = par.add_run(" 页 / 共 %d 页" % NUMBERED_TOTAL)
        _r.font.size = Pt(9)
        for _run in par.runs:
            _run.font.size = Pt(9)
            set_fonts(_run, ascii_font=FONT_CN)
    bottom_border(par, sz="4", color="808080", space="1")


# 页码从 0 起编：封面 = 0（不显示），目录 = 第 1 页
# Header 样式自带的制表位（4680/9360 twips = 8.26/16.51cm）会先于段落制表位生效，先清掉
_hdr_style = doc.styles["Header"]
_hdr_style.paragraph_format.tab_stops.clear_all()
_hdr_style.paragraph_format.tab_stops.add_tab_stop(Cm(TEXT_W_CM / 2), WD_TAB_ALIGNMENT.CENTER)
_hdr_style.paragraph_format.tab_stops.add_tab_stop(Cm(TEXT_W_CM), WD_TAB_ALIGNMENT.RIGHT)
sec.different_first_page_header_footer = True
_pgNum = OxmlElement("w:pgNumType")
_pgNum.set(qn("w:start"), "0")
sec._sectPr.insert_element_before(_pgNum, "w:cols", "w:formProt", "w:vAlign", "w:noEndnote",
                                  "w:titlePg", "w:textDirection", "w:bidi", "w:rtlGutter",
                                  "w:docGrid", "w:printerSettings", "w:sectPrChange")

build_header(sec.first_page_header.paragraphs[0], with_number=False)
build_header(sec.header.paragraphs[0], with_number=True)

# 页脚清空（页码已移到页眉右上角）
for _ft in (sec.first_page_footer, sec.footer):
    _fp = _ft.paragraphs[0]
    for _r in list(_fp.runs):
        _r._element.getparent().remove(_r._element)

# ---------- 行内格式 ----------
INLINE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))")


def add_inline(par, text, size=BODY_SIZE, base_bold=False, cn=FONT_CN):
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            run = par.add_run(text[pos:m.start()])
            run.font.size = size
            run.bold = base_bold
            set_fonts(run, cn=cn)
        tok = m.group(0)
        if tok.startswith("**"):
            run = par.add_run(tok[2:-2])
            run.bold = True
            run.font.size = size
            set_fonts(run, cn=cn)
        elif tok.startswith("`"):
            run = par.add_run(tok[1:-1])
            run.font.size = Pt(9)
            run.font.name = FONT_CODE
            r = run._element.get_or_add_rPr().get_or_add_rFonts()
            r.set(qn("w:ascii"), FONT_CODE)
            r.set(qn("w:hAnsi"), FONT_CODE)
            r.set(qn("w:eastAsia"), FONT_CN)
        elif tok.startswith("!["):
            # 行内图片按普通文字处理（图片通常独占一行，已在块级处理）
            par.add_run("")
        else:
            label = re.match(r"\[([^\]]+)\]", tok).group(1)
            run = par.add_run(label)
            run.font.size = size
            set_fonts(run, cn=cn)
        pos = m.end()
    if pos < len(text):
        run = par.add_run(text[pos:])
        run.font.size = size
        run.bold = base_bold
        set_fonts(run, cn=cn)


# ---------- 块级渲染 ----------
def para(text, align=None, size=BODY_SIZE, bold=False, indent_cm=0.0, space_after=Pt(3), first_line_cm=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = space_after
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    p.paragraph_format.line_spacing = LINE_MULT
    if indent_cm:
        p.paragraph_format.left_indent = Cm(indent_cm)
    if first_line_cm is not None:
        p.paragraph_format.first_line_indent = Cm(first_line_cm)
    if align is not None:
        p.alignment = align
    add_inline(p, text, size=size, base_bold=bold)
    return p


def heading(text, level, toc_anchor=False):
    if level == 1:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(12)
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(20)
        set_fonts(run, cn=FONT_HEI, ascii_font="Times New Roman")
        return p
    if level == 2:
        p = doc.add_paragraph()
        try:
            p.style = doc.styles["Heading 1"]
        except Exception:
            pass
        p.paragraph_format.page_break_before = True
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(10)
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(15)
        run.font.color.rgb = RGBColor(0, 0, 0)
        set_fonts(run, cn=FONT_HEI, ascii_font="Times New Roman")
        bottom_border(p)
        return p
    if level == 3:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(9)
        p.paragraph_format.space_after = Pt(5)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(12.5)
        set_fonts(run, cn=FONT_HEI, ascii_font="Times New Roman")
        return p
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(11)
    set_fonts(run, cn=FONT_HEI, ascii_font="Times New Roman")
    return p


def image(path, alt):
    fname = os.path.basename(path)
    full = os.path.join(SHOTS, fname)
    if "mobile_app" in fname:
        width = Cm(8.0)
    elif fname.startswith("shot1_login"):
        width = Cm(6.7)   # 登录窗口为竖版（336×498），按比例缩到与旧图相近高度（约 9.9cm）
    else:
        width = Cm(11.8)
    if os.path.exists(full):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(2)
        p.add_run().add_picture(full, width=width)
    else:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(4)
        run = p.add_run(f"【截图占位】缺少 screenshots/{fname}（请补拍同名文件后重新生成）")
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)
        set_fonts(run, cn=FONT_HEI)


def table(rows):
    if not rows:
        return
    ncol = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=ncol)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for ri, row in enumerate(rows):
        for ci in range(ncol):
            cell = t.cell(ri, ci)
            text = row[ci] if ci < len(row) else ""
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
            add_inline(p, text, size=Pt(8.2), base_bold=(ri == 0))
            if ri == 0:
                shd = OxmlElement("w:shd")
                shd.set(qn("w:val"), "clear")
                shd.set(qn("w:fill"), "EFEFEF")
                cell._tc.get_or_add_tcPr().append(shd)


def code_block(lines):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), "F4F4F4")
    p._p.get_or_add_pPr().append(shd)
    for i, ln in enumerate(lines):
        run = p.add_run(ln)
        run.font.size = Pt(8.5)
        run.font.name = FONT_CODE
        r = run._element.get_or_add_rPr().get_or_add_rFonts()
        r.set(qn("w:ascii"), FONT_CODE)
        r.set(qn("w:hAnsi"), FONT_CODE)
        r.set(qn("w:eastAsia"), FONT_CN)
        if i < len(lines) - 1:
            run.add_break()


TOC_TITLES = []


def insert_toc_field():
    """插入 Word 目录域（TOC \\o "1-1"），由 WPS/Word 打开时更新出真实页码。"""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    r1 = p.add_run()
    fld = OxmlElement("w:fldChar")
    fld.set(qn("w:fldCharType"), "begin")
    r1._r.append(fld)
    r2 = p.add_run()
    it = OxmlElement("w:instrText")
    it.set(qn("xml:space"), "preserve")
    it.text = ' TOC \\o "1-1" \\h \\z \\u '
    r2._r.append(it)
    r3 = p.add_run()
    f2 = OxmlElement("w:fldChar")
    f2.set(qn("w:fldCharType"), "separate")
    r3._r.append(f2)
    r4 = p.add_run("（目录将在此自动生成）")
    r4.font.size = Pt(10.5)
    set_fonts(r4)
    r5 = p.add_run()
    f3 = OxmlElement("w:fldChar")
    f3.set(qn("w:fldCharType"), "end")
    r5._r.append(f3)


def render():
    i = 0
    n = len(LINES)
    in_center = False
    pending_break = False
    toc_mode = False
    toc_done = False
    while i < n:
        raw = LINES[i]
        line = raw.rstrip()
        s = line.strip()

        if s == '<div align="center">':
            in_center = True; i += 1; continue
        if s == '</div>':
            in_center = False; i += 1; continue
        if s == '<br>':
            i += 1; continue
        if 'page-break-before' in s:
            pending_break = True; i += 1; continue
        if s == '---':
            i += 1; continue
        if s == '':
            i += 1; continue

        # 代码块
        if s.startswith('```'):
            i += 1
            buf = []
            while i < n and LINES[i].strip() != '```':
                buf.append(LINES[i]); i += 1
            i += 1
            code_block(buf)
            continue

        # 图片
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", s)
        if m:
            image(m.group(2), m.group(1))
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            if level == 1 and text == '目录':
                p = heading('目 录', 1)
                p.paragraph_format.page_break_before = True
                toc_mode = True
            elif level == 2:
                TOC_TITLES.append(text)
                toc_mode = False
                heading(text, 2)
            else:
                heading(text, level)
                if level == 1:
                    p = doc.paragraphs[-1]
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if pending_break:
                doc.paragraphs[-1].paragraph_format.page_break_before = True
                pending_break = False
            i += 1
            continue

        # 表格
        if s.startswith('|'):
            rows = []
            while i < n and LINES[i].strip().startswith('|'):
                cells = [c.strip() for c in LINES[i].strip().strip('|').split('|')]
                if not all(re.match(r'^:?-{2,}:?$', c) for c in cells if c):
                    rows.append(cells)
                i += 1
            table(rows)
            if pending_break:
                doc.add_paragraph().paragraph_format.page_break_before = True
                pending_break = False
            continue

        # 引用（含图注）
        if s.startswith('>'):
            buf = []
            while i < n and LINES[i].strip().startswith('>'):
                buf.append(LINES[i].strip().lstrip('>').strip()); i += 1
            text = ' '.join(x for x in buf if x)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.5)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
            p.paragraph_format.line_spacing = 1.4
            is_caption = bool(re.match(r'^图\s?\d', text))
            if is_caption:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                add_inline(p, text, size=Pt(9))
                for r0 in p.runs:
                    r0.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
            else:
                add_inline(p, text, size=Pt(9.5))
            continue

        # 目录区（先于列表分支处理，避免被当成普通项目符号）
        mtoc_line = re.match(r'^-\s+(.+?)\s*[·.．]{2,}\s*(\d*)\s*$', s)
        if toc_mode and mtoc_line:
            if args.toc_mode == 'field':
                if not toc_done:
                    insert_toc_field()
                    toc_done = True
            else:
                title = mtoc_line.group(1).strip()
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
                p.paragraph_format.tab_stops.add_tab_stop(Cm(17.2), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
                run = p.add_run(title + "\t" + str(TOC_MAP.get(title, '')))
                run.font.size = Pt(11)
                set_fonts(run)
            i += 1
            continue

        # 有序/无序列表（含一层缩进）
        if re.match(r'^\s*(\d+\.|[-*])\s+', line):
            while i < n and re.match(r'^\s*(\d+\.|[-*])\s+', LINES[i]):
                l0 = LINES[i]
                indent = len(l0) - len(l0.lstrip(' '))
                lvl = 1 if indent >= 2 else 0
                mlist = re.match(r'^\s*(\d+\.|[-*])\s+(.*)$', l0)
                marker, content = mlist.group(1), mlist.group(2)
                marker_text = marker if marker[0].isdigit() else '·'
                p = doc.add_paragraph()
                left_cm = 0.74 * (lvl + 1)
                p.paragraph_format.left_indent = Cm(left_cm)
                p.paragraph_format.first_line_indent = Cm(-0.74)
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
                p.paragraph_format.line_spacing = LINE_MULT
                # 悬挂缩进 + 制表位：编号/圆点定在行首，正文统一从 left_cm 起，换行后与首行文字对齐
                p.paragraph_format.tab_stops.add_tab_stop(Cm(left_cm))
                run = p.add_run(marker_text + "\t")
                run.font.size = BODY_SIZE
                set_fonts(run)
                add_inline(p, content, size=BODY_SIZE)
                i += 1
            if pending_break:
                doc.paragraphs[-1].paragraph_format.page_break_before = True
                pending_break = False
            continue

        # 目录行：- 第X章 …… 页码
        mtoc = re.match(r'^-\s+(.+?)\s*[·.．]{2,}\s*(\d*)\s*$', s)
        if mtoc:
            title = mtoc.group(1).strip()
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
            p.paragraph_format.tab_stops.add_tab_stop(Cm(17.2), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
            run = p.add_run(title + "\t" + str(TOC_MAP.get(title, '')))
            run.font.size = Pt(11)
            set_fonts(run)
            i += 1
            continue

        # 普通段落（合并连续行）
        buf = [line]
        i += 1
        while i < n:
            nxt = LINES[i]
            ns = nxt.strip()
            if ns == '' or ns.startswith(('|', '>', '#', '```', '![')) or ns in ('---', '</div>', '<br>') or re.match(r'^\s*(\d+\.|[-*])\s+', nxt):
                break
            buf.append(nxt)
            i += 1
        text = ''
        for part in buf:
            part = part.strip()
            if not text:
                text = part
            elif re.search(r'[A-Za-z0-9]$', text) and re.match(r'^[A-Za-z0-9]', part):
                text += ' ' + part
            else:
                text += part
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        p.paragraph_format.line_spacing = LINE_MULT
        if in_center:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        else:
            # 中文正文习惯：首行缩进 2 字符（2 × 9.5pt）
            p.paragraph_format.first_line_indent = Pt(19)
        add_inline(p, text, size=BODY_SIZE)
        if pending_break:
            p.paragraph_format.page_break_before = True
            pending_break = False


render()
doc.save(args.out)
print("DOCX 已生成:", args.out)
print("标题数:", len(TOC_TITLES))
print("页码映射条数:", len(TOC_MAP))


