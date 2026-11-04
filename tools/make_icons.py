"""アプリのアイコン（icons/*.png。Android 用の icon-maskable-*.png も）とロゴ（icons/logo.png）を作る。 python tools/make_icons.py
デザイン：横浜エクセレンスの緑のエンブレム（ボール・風のうず・「B STORM」の帯）
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

OUT = Path(__file__).resolve().parent.parent / "icons"
F = "C:/Windows/Fonts/"
S = 4            # 4倍で描いてから縮める（なめらかにするため）
N = 512 * S


def font(name, px):
    return ImageFont.truetype(F + name, int(px * S))


def radial(size, inner, outer, cy=0.35, r=0.85):
    step = 4
    small = Image.new("RGB", (size // step, size // step))
    sp = small.load()
    for y in range(size // step):
        for x in range(size // step):
            t = min(1, math.hypot(x * step / size - 0.5, y * step / size - cy) / r)
            sp[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(inner, outer))
    return small.resize((size, size), Image.BICUBIC)


def ball(d, cx, cy, r, lw):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#f07a24")
    w = int(lw * S)
    line = "#1d0e05"
    d.line([cx - r, cy, cx + r, cy], fill=line, width=w)
    d.line([cx, cy - r, cx, cy + r], fill=line, width=w)
    d.arc([cx - r * 1.75, cy - r, cx - r * 0.3, cy + r], -62, 62, fill=line, width=w)
    d.arc([cx + r * 0.3, cy - r, cx + r * 1.75, cy + r], 118, 242, fill=line, width=w)


def ball_shade(im, cx, cy, r):
    """ボールに丸みの影とつやを足す"""
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    sh = Image.new("L", im.size, 0)
    ImageDraw.Draw(sh).ellipse([cx - r * 0.75, cy - r * 0.95, cx + r * 1.25, cy + r * 1.05], fill=255)
    sh = sh.filter(ImageFilter.GaussianBlur(r * 0.35))
    dark = ImageChops.multiply(m, ImageChops.invert(sh))
    im.paste((40, 10, 0, 255), mask=dark.point(lambda v: int(v * 0.55)))
    hi = Image.new("L", im.size, 0)
    ImageDraw.Draw(hi).ellipse([cx - r * 0.62, cy - r * 0.7, cx - r * 0.05, cy - r * 0.2], fill=120)
    hi = ImageChops.multiply(hi.filter(ImageFilter.GaussianBlur(r * 0.12)), m)
    im.paste((255, 235, 200, 255), mask=hi)


def text_c(d, cx, y, s, f, fill):
    b = d.textbbox((0, 0), s, font=f)
    d.text((cx - (b[0] + b[2]) / 2, y - b[1]), s, font=f, fill=fill)


def italic_text(im, cx, y, s, f, fill, shear=0.12):
    """ななめの文字（スポーツっぽく）"""
    tmp = Image.new("RGBA", im.size, (0, 0, 0, 0))
    text_c(ImageDraw.Draw(tmp), cx, y, s, f, fill)
    tmp = tmp.transform(tmp.size, Image.AFFINE, (1, shear, -shear * y, 0, 1, 0), Image.BICUBIC)
    im.alpha_composite(tmp)


def emblem(im, cx, cy, R):
    """円のエンブレム（ボール・風のうず・帯）"""
    d = ImageDraw.Draw(im)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill="#0a0e0c", outline="#ffffff", width=int(R / 18))
    d.ellipse([cx - R * 0.86, cy - R * 0.86, cx + R * 0.86, cy + R * 0.86], outline="#25c868", width=int(R / 37))
    r = R * 0.5
    bcy = cy - R * 0.18
    ball(d, cx, bcy, r, lw=R / S / 20)
    ball_shade(im, cx, bcy, r)
    d = ImageDraw.Draw(im)
    for rr, a0, a1, wd in [(1.25, 200, 330, 9), (1.45, 215, 320, 6), (1.25, 20, 150, 9), (1.45, 35, 140, 6)]:
        d.arc([cx - r * rr, bcy - r * rr, cx + r * rr, bcy + r * rr], a0, a1, fill="#ffffff", width=int(wd * R / 184))
    by = cy + R * 0.42
    k = R / (N * 0.36)
    d.polygon([(cx - R * 1.08, by - 40 * S * k), (cx + R * 1.08, by - 40 * S * k),
               (cx + R * 0.98, by + 52 * S * k), (cx - R * 0.98, by + 52 * S * k)], fill="#ffffff")
    italic_text(im, cx, by - 36 * S * k, "B STORM", font("impact.ttf", 84 * k), "#0a0e0c")


def icon():
    im = radial(N, (30, 150, 80), (4, 40, 20)).convert("RGBA")
    emblem(im, N / 2, N * 0.43, N * 0.36)
    text_c(ImageDraw.Draw(im), N / 2, N * 0.835, "Bリーグ ストーム", font("YuGothB.ttc", 36), "#ffffff")
    return im.convert("RGB").resize((512, 512), Image.LANCZOS)


def maskable():
    """Android 用：全面が緑。丸や角丸に切りぬかれても欠けないよう、エンブレムはまん中の安全な円（直径80%）の中"""
    im = radial(N, (30, 150, 80), (4, 40, 20), cy=0.45, r=0.75).convert("RGBA")
    emblem(im, N / 2, N * 0.5, N * 0.33)
    return im.convert("RGB").resize((512, 512), Image.LANCZOS)


def logo():
    """アプリの中で使う、背景なしのロゴ"""
    im = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    emblem(im, N / 2, N * 0.48, N * 0.42)
    return im.resize((512, 512), Image.LANCZOS)


big = icon()
for n in (180, 192, 512):
    big.resize((n, n), Image.LANCZOS).save(OUT / f"icon-{n}.png")
mk = maskable()
for n in (192, 512):
    mk.resize((n, n), Image.LANCZOS).save(OUT / f"icon-maskable-{n}.png")
logo().save(OUT / "logo.png")
print("ok")
