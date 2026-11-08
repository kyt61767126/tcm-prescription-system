# 源程序鉴别材料排版：读取 source_v2_pages.json，生成严格分页的 DOCX。
# 页面：A4；上下 11mm，左右 10mm；页眉/页脚各 4mm。
# 正文：西文 Consolas（等宽）、中文 宋体；字号 7.5pt；行距固定 13pt；每页 58 行。
# 分页方式：每页一个"节"（NEW_PAGE），页脚写入字面页码（不依赖 PAGE 域，导出 PDF 不受域更新影响）。
# 页眉：惠康中医诊所管理系统 V1.0.0｜著作权人：高碑店惠康堂中医诊所有限公司
import json
import os
from docx import Document
from docx.shared import Pt, Mm
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BASE = r"D:\trae_projects\kyt-zy\软著补正_20261106_v2"
SRC = BASE + r"\build\_build\source_v2_pages.json"
OUT = BASE + r"\build\_build\惠康中医诊所管理系统V1.0.0_源程序_补正版_V2.docx"

with open(SRC, "r", encoding="utf-8") as f:
    data = json.load(f)

header_text = data["header"]
total_pages = data["totalPages"]
pages = data["pages"]
assert len(pages) == total_pages, f"页数不符: {len(pages)} != {total_pages}"

FONT_ASCII = "Consolas"
FONT_CJK = "SimSun"
# emoji（🗑🎤🔑👥 等）在 Consolas/宋体下无字形，WPS 导出 PDF 会变缺字方框；
# 单独成 run 指定 Segoe UI Emoji（Windows 自带），导出为可辨识的单色字形。
# 只影响 run 字体，不改文本、不改分页（每页一节，页数=节数，与字形宽度无关）。
FONT_EMOJI = "Segoe UI Emoji"
FONT_SIZE = Pt(7.5)
LINE_SPACING = Pt(13)


# emoji 修饰符（变体选择符-16 / ZWJ / 键帽组合符）：仅在已处于 emoji 段时并入
EMOJI_MODIFIERS = (0xFE0F, 0x200D, 0x20E3)


def is_emoji_codepoint(ch):
    o = ord(ch)
    # 只处理非 BMP 的 emoji 码位（🗑🎤🔑👥 等）；BMP 符号区（★ U+2605、⚠ U+26A0）
    # 宋体本就有字形，按普通文本走，避免无谓换字体。
    return 0x1F000 <= o <= 0x1FAFF


def split_emoji_segments(text):
    """把文本切成 [(片段, 是否emoji), ...]；emoji 与其修饰符并入同一段。"""
    parts = []
    buf = ""
    buf_is_emoji = None
    for ch in text:
        # 注意：必须 bool() 包裹——buf_is_emoji 为 None 时 `None and ...` 会让 em 变成
        # None 而非 False，状态机会把每个字符都误判为段首，导致整行段丢失。
        em = bool(is_emoji_codepoint(ch) or (buf_is_emoji and ord(ch) in EMOJI_MODIFIERS))
        if buf_is_emoji is None:
            buf, buf_is_emoji = ch, em
        elif em == buf_is_emoji:
            buf += ch
        else:
            parts.append((buf, buf_is_emoji))
            buf, buf_is_emoji = ch, em
    if buf_is_emoji is not None:
        parts.append((buf, buf_is_emoji))
    return parts

doc = Document()
cp = doc.core_properties
cp.author = "高碑店惠康堂中医诊所有限公司"
cp.last_modified_by = "高碑店惠康堂中医诊所有限公司"
cp.title = "惠康中医诊所管理系统V1.0.0 源程序鉴别材料（补正版V2）"
cp.subject = "计算机软件著作权登记——源程序鉴别材料"
cp.comments = ""
doc.styles["Normal"].font.name = FONT_ASCII
doc.styles["Normal"].font.size = FONT_SIZE

style = doc.styles["Normal"]
rpr = style.element.get_or_add_rPr()
rfonts = rpr.find(qn("w:rFonts"))
if rfonts is None:
    rfonts = OxmlElement("w:rFonts")
    rpr.append(rfonts)
rfonts.set(qn("w:ascii"), FONT_ASCII)
rfonts.set(qn("w:hAnsi"), FONT_ASCII)
rfonts.set(qn("w:eastAsia"), FONT_CJK)
rfonts.set(qn("w:cs"), FONT_ASCII)
pf = style.paragraph_format
pf.space_before = Pt(0)
pf.space_after = Pt(0)
pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
pf.line_spacing = LINE_SPACING


# Header 样式自带制表位（4680/9360 twips）会先于段落制表位生效，清掉后按 190mm 版心重设
_hdr_style = doc.styles["Header"]
_hdr_style.paragraph_format.tab_stops.clear_all()
_hdr_style.paragraph_format.tab_stops.add_tab_stop(Mm(95), WD_TAB_ALIGNMENT.CENTER)
_hdr_style.paragraph_format.tab_stops.add_tab_stop(Mm(190), WD_TAB_ALIGNMENT.RIGHT)


def bottom_border(paragraph):
    pPr = paragraph._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "4")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "808080")
    pBdr.append(bottom)
    pPr.append(pBdr)


def setup_section(sec, page_no):
    sec.page_width = Mm(210)
    sec.page_height = Mm(297)
    sec.top_margin = Mm(11)
    sec.bottom_margin = Mm(11)
    sec.left_margin = Mm(10)
    sec.right_margin = Mm(10)
    sec.header_distance = Mm(4)
    sec.footer_distance = Mm(4)

    # 页眉（每节独立写入）：居中名称+著作权人，右上角页码（版心 190mm）
    sec.header.is_linked_to_previous = False
    hp = sec.header.paragraphs[0]
    for r in list(hp.runs):
        r._element.getparent().remove(r._element)
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hp.paragraph_format.space_before = Pt(0)
    hp.paragraph_format.space_after = Pt(1)
    hp.paragraph_format.tab_stops.add_tab_stop(Mm(95), WD_TAB_ALIGNMENT.CENTER)
    hp.paragraph_format.tab_stops.add_tab_stop(Mm(190), WD_TAB_ALIGNMENT.RIGHT)
    hr = hp.add_run("\t" + header_text + f"\t第 {page_no} 页 / 共 {total_pages} 页")
    hr.font.size = Pt(7.5)
    hr.font.name = FONT_CJK
    hr._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT_CJK)
    bottom_border(hp)

    # 页脚清空（页码已移到页眉右上角）
    sec.footer.is_linked_to_previous = False
    fp = sec.footer.paragraphs[0]
    for r in list(fp.runs):
        r._element.getparent().remove(r._element)


def set_para_fonts(p):
    pPr = p._p.get_or_add_pPr()
    rPr = pPr.find(qn("w:rPr"))
    if rPr is None:
        rPr = OxmlElement("w:rPr")
        pPr.append(rPr)
    rf = OxmlElement("w:rFonts")
    rf.set(qn("w:ascii"), FONT_ASCII)
    rf.set(qn("w:hAnsi"), FONT_ASCII)
    rf.set(qn("w:eastAsia"), FONT_CJK)
    rPr.append(rf)


# 第 1 页使用文档默认节
setup_section(doc.sections[0], 1)

for p_idx, page in enumerate(pages):
    if p_idx > 0:
        sec = doc.add_section(WD_SECTION.NEW_PAGE)
        setup_section(sec, p_idx + 1)
    for line in page:
        para = doc.add_paragraph()
        para.paragraph_format.space_before = Pt(0)
        para.paragraph_format.space_after = Pt(0)
        para.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        para.paragraph_format.line_spacing = LINE_SPACING
        set_para_fonts(para)
        for seg_text, seg_is_emoji in split_emoji_segments(line.rstrip()):
            if seg_is_emoji:
                # WPS 实测：带 U+FE0F 变体选择符的 emoji（如 🗑️）被中文前后夹挤时，
                # 即使 run 显式指定 Segoe UI Emoji 仍回退成缺字方框；段首尾包零宽空格
                # (U+200B) 可打断错误的上下文合并，实测恢复正常字形。ZWSP 零宽不可见、
                # 不改语义/版心/分页；普通无 VS16 的 emoji（🎤🔑👥）无此问题，不做处理。
                if "\ufe0f" in seg_text or "\u200d" in seg_text:
                    seg_text = "\u200b" + seg_text + "\u200b"
                run = para.add_run(seg_text)
                run.font.size = FONT_SIZE
                run.font.name = FONT_EMOJI
                _rf = run._element.get_or_add_rPr().get_or_add_rFonts()
                _rf.set(qn("w:ascii"), FONT_EMOJI)
                _rf.set(qn("w:hAnsi"), FONT_EMOJI)
                _rf.set(qn("w:eastAsia"), FONT_EMOJI)
                _rf.set(qn("w:cs"), FONT_EMOJI)
            else:
                run = para.add_run(seg_text)
                run.font.size = FONT_SIZE
                run.font.name = FONT_ASCII
                run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), FONT_CJK)

doc.save(OUT)
print("DOCX 已生成:", OUT)
print("页数:", len(pages), "| 每页行数:", min(len(p) for p in pages), "-", max(len(p) for p in pages))
