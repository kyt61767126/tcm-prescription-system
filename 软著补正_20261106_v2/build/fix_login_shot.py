# 图 1 处理：抹除微信号与"回退旧版"链接，再 3 倍 Lanczos 放大 + 轻度锐化
import os
import shutil

from PIL import Image, ImageFilter

SRC = r"c:\Users\61767\.trae-cn\attachments\9e9126a1-56d5-4f71-8fc1-e00ab0bdadaf_999ddc51-f289-4fde-ace2-e610dda18b5d_image.png"
DST = r"D:\trae_projects\kyt-zy\软著补正_20261106_v2\screenshots\shot1_login.png"
BAK = r"D:\trae_projects\kyt-zy\软著补正_20261106_v2\screenshots\shot1_login_prev.png"

if os.path.exists(DST) and not os.path.exists(BAK):
    shutil.copy2(DST, BAK)

im = Image.open(SRC).convert("RGB")
w, h = im.size
print("source", w, h)

# 抹除区域：y=433..470（覆盖"微信号：hktzy1688"与"新版异常？点此回退上一版"两行）
BOX = (0, 433, w, 471)
im.paste((245, 245, 245), BOX)
print("erased", BOX)

# 3 倍 Lanczos 放大（336x498 -> 1008x1494），轻度锐化
big = im.resize((w * 3, h * 3), Image.LANCZOS)
big = big.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=3))
big.save(DST, "PNG", optimize=True)
print("saved", DST, big.size, os.path.getsize(DST))

# 复核：抹除带内不应有深色像素
band = im.crop(BOX)
dark = sum(1 for px in band.getdata() if max(px) < 200)
print("dark pixels in erased band:", dark)
