"""アプリのアイコン（icons/*.png）を作る。 python tools/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"


def icon(size):
    s = size / 512
    im = Image.new("RGB", (size, size), "#0b1220")
    d = ImageDraw.Draw(im)
    # バスケットボール
    c, r = size / 2, 170 * s
    d.ellipse([c - r, c - r - 20 * s, c + r, c + r - 20 * s], fill="#f07a24")
    w = max(2, int(14 * s))
    d.line([c - r, c - 20 * s, c + r, c - 20 * s], fill="#1a0d05", width=w)
    d.line([c, c - r - 20 * s, c, c + r - 20 * s], fill="#1a0d05", width=w)
    d.arc([c - r * 1.6, c - r - 20 * s, c - r * .35, c + r - 20 * s], -60, 60, fill="#1a0d05", width=w)
    d.arc([c + r * .35, c - r - 20 * s, c + r * 1.6, c + r - 20 * s], 120, 240, fill="#1a0d05", width=w)
    # 下の帯
    d.rectangle([0, size - 120 * s, size, size], fill="#e8b33a")
    d.polygon([(c - 90 * s, size - 120 * s), (c, size - 175 * s), (c + 90 * s, size - 120 * s)], fill="#e8b33a")
    return im


for n in (180, 192, 512):
    icon(n).save(OUT / f"icon-{n}.png")
print("ok")
