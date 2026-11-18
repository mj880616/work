"""Builds every BasketDrop icon from the one drawing basket-pc/icon/basket-icon.svg (64x64 grid).

Run from anywhere:  python3 basket-pc/tools/make-icon.py      (needs only Pillow)

The SVG is the source. It is the same 노동조합+ picture as app/app-icon.svg (olive square, white "노조", yellow "+")
and is written by scripts/app-icon/build-app-icons.py. It has two drawings:
  class="full"  for 32 px and up (letters at weight 800)
  class="small" for 16, 20 and 24 px (same place and colours, letters at weight 900 so they stay readable)
and a hidden class="badge" (the small orange dot) inside each drawing for "something is waiting to be sent".

This script reads that SVG (rect, circle, polygon, polyline, filled glyph paths and the butt-capped "+" path)
and draws each size directly with Pillow (8x supersampled, then reduced), so no SVG library is needed.
Paths are flattened by scripts/app-icon/svgpath.py, shared with the web app icon builder.

Writes (commit all of them):
  src/BasketDrop/app.ico                     program: exe, installer, Start menu, title bars, tray when all is well
  src/BasketDrop/tray-pending.ico            tray: signed in, something waiting (orange dot)
  src/BasketDrop/tray-signedout.ico          tray: login needed (dim grey)
  src/BasketDrop/tray-signedout-pending.ico  tray: login needed and something waiting (dim grey + orange dot)
  icon/png/basket-<size>.png                 every program size as PNG
  ../docs/design/basket-pc-icon-preview.png  preview sheet (1x and enlarged) for reviews
"""
import io
import math
import pathlib
import re
import struct
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent / "scripts" / "app-icon"))
import svgpath  # noqa: E402  shared with the web app icon builder

BASE = pathlib.Path(__file__).resolve().parent.parent  # basket-pc/
SVG = BASE / "icon" / "basket-icon.svg"
APP_SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
TRAY_SIZES = [16, 20, 24, 32, 40, 48]  # notification area: 100% .. 300% scaling
SMALL_MAX = 24  # same rule as the SVG media query
SS = 8  # supersampling factor

# "login needed": the whole picture turns dim grey; the orange dot keeps its colour.
DIM = {"#4D5A2E": "#7A7C80", "#FFFEFA": "#E8E7E3", "#E7C25A": "#C4C5C1"}

NS = "{http://www.w3.org/2000/svg}"


def rgba(hexcolor):
    h = hexcolor.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def nums(text):
    return [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", text)]


def classes(el):
    return set((el.get("class") or "").split())


def draw(px, badge=False, dim=False):
    root = ET.parse(SVG).getroot()
    drawing = "small" if px <= SMALL_MAX else "full"
    n = px * SS
    k = n / 64
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def color(value):
        if not value or value == "none":
            return None
        value = value.upper()
        if dim:
            value = DIM.get(value, value)
        return rgba(value)

    def round_line(points, fill, width):
        pts = [(x * k, y * k) for x, y in points]
        w = width * k
        for a, b in zip(pts, pts[1:]):
            d.line([a, b], fill=fill, width=max(1, round(w)))
        for x, y in pts:  # round caps and joins
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=fill)

    def element(el, style):
        tag = el.tag.replace(NS, "")
        st = dict(style)
        for key in ("fill", "stroke", "stroke-width"):
            if el.get(key) is not None:
                st[key] = el.get(key)
        fill, stroke = color(st.get("fill")), color(st.get("stroke"))
        sw = float(st.get("stroke-width", 0))
        if tag == "g":
            cls = classes(el)
            if cls & {"full", "small"} and drawing not in cls:
                return
            if "badge" in cls and not badge:
                return
            for child in el:
                element(child, st)
        elif tag == "rect":
            x, y = float(el.get("x", 0)), float(el.get("y", 0))
            w, h, rx = float(el.get("width")), float(el.get("height")), float(el.get("rx", 0))
            d.rounded_rectangle([x * k, y * k, (x + w) * k - 1, (y + h) * k - 1], radius=rx * k, fill=fill)
        elif tag == "circle":
            cx, cy, r = float(el.get("cx")), float(el.get("cy")), float(el.get("r"))
            if stroke and sw:
                ro = (r + sw / 2) * k
                d.ellipse([cx * k - ro, cy * k - ro, cx * k + ro, cy * k + ro], fill=stroke)
            ri = (r - (sw / 2 if stroke else 0)) * k
            d.ellipse([cx * k - ri, cy * k - ri, cx * k + ri, cy * k + ri], fill=fill)
        elif tag in ("polygon", "polyline"):
            v = nums(el.get("points"))
            pts = list(zip(v[0::2], v[1::2]))
            if tag == "polygon":
                if fill:
                    d.polygon([(x * k, y * k) for x, y in pts], fill=fill)
                if stroke and sw:
                    round_line(pts + [pts[0]], stroke, sw)
            elif stroke and sw:
                round_line(pts, stroke, sw)
        elif tag == "path":
            # glyph outlines (filled, M/L/H/V/Q/C/Z) and the butt-capped "+" (stroke, horizontal/vertical lines only)
            if fill:
                for c in svgpath.contours(el.get("d")):
                    d.polygon([(x * k, y * k) for x, y in c], fill=fill)
            if stroke and sw:
                if st.get("stroke-linecap", el.get("stroke-linecap")) != "butt":
                    raise ValueError("only butt-capped stroked paths are supported")
                for c in svgpath.stroke_rects(el.get("d"), sw):
                    d.polygon([(x * k, y * k) for x, y in c], fill=stroke)
        elif tag in ("style",):
            return
        else:
            raise ValueError("unsupported SVG element: " + tag)

    for el in root:
        element(el, {})
    return im.resize((px, px), Image.LANCZOS)


def dib(im):  # 32-bit BMP entry (no file header), bottom-up BGRA + empty AND mask
    w, h = im.size
    p = im.load()
    rows = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = p[x, y]
            rows += bytes((b, g, r, a))
    mask_row = ((w + 31) // 32) * 4
    return struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(rows), 0, 0, 0, 0) + bytes(rows) + bytes(mask_row * h)


def write_ico(dest, sizes, **look):
    entries = []
    for s in sizes:
        im = draw(s, **look)
        if s >= 256:
            buf = io.BytesIO()
            im.save(buf, "PNG")
            entries.append((s, buf.getvalue()))
        else:
            entries.append((s, dib(im)))
    out = struct.pack("<HHH", 0, 1, len(entries))
    off = 6 + 16 * len(entries)
    for s, data in entries:
        out += struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s, 0, 0, 1, 32, len(data), off)
        off += len(data)
    for _, data in entries:
        out += data
    dest.write_bytes(out)
    print(dest.relative_to(BASE.parent), len(out), "bytes")


def preview(dest):
    looks = [("기본", {}), ("대기 있음", {"badge": True}), ("로그인 필요", {"dim": True}), ("둘 다", {"badge": True, "dim": True})]
    sizes = [16, 20, 24, 32, 48]
    zoom = 4
    cell = 48 * zoom + 16
    sheet = Image.new("RGBA", (16 + len(sizes) * cell + 256 + 16, 16 + len(looks) * (cell + 72)), (40, 44, 52, 255))
    y = 16
    for _, look in looks:
        x = 16
        for s in sizes:
            im = draw(s, **look)
            sheet.alpha_composite(im, (x, y))  # real size
            big = im.resize((s * zoom, s * zoom), Image.NEAREST)  # enlarged, pixels visible
            sheet.alpha_composite(big, (x, y + 56))
            x += cell
        big = draw(256, **look) if look == {} else None
        if big is not None:
            sheet.alpha_composite(big, (x, y))
        y += cell + 72
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)
    print(dest.relative_to(BASE.parent))


if __name__ == "__main__":
    src = BASE / "src" / "BasketDrop"
    write_ico(src / "app.ico", APP_SIZES)
    write_ico(src / "tray-pending.ico", TRAY_SIZES, badge=True)
    write_ico(src / "tray-signedout.ico", TRAY_SIZES, dim=True)
    write_ico(src / "tray-signedout-pending.ico", TRAY_SIZES, badge=True, dim=True)
    png = BASE / "icon" / "png"
    png.mkdir(parents=True, exist_ok=True)
    for s in APP_SIZES:
        draw(s).save(png / f"basket-{s}.png")
    preview(BASE.parent / "docs" / "design" / "basket-pc-icon-preview.png")
