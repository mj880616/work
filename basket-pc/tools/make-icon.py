"""Builds src/BasketDrop/app.ico from the shape of app/app-icon.svg (same coordinates, 64x64 grid).
Run: python3 basket-pc/tools/make-icon.py   (needs Pillow). Every size is drawn directly, not scaled from one bitmap."""
import io, struct, pathlib
from PIL import Image, ImageDraw

SIZES = [16, 20, 24, 32, 40, 48, 64, 256]
BG, FG, DOT = (0x1f, 0x31, 0x50, 255), (0xf2, 0xe8, 0xd5, 255), (0xc9, 0x67, 0x3d, 255)
RECTS = [(32, 13.5, 48.5, 18.5), (43.5, 13.5, 48.5, 50.5), (15.5, 45.5, 48.5, 50.5), (15.5, 32, 20.5, 50.5)]

def draw(px):
    ss = 8  # supersample for smooth edges
    n = px * ss
    im = Image.new("RGBA", (n, n), BG)
    d = ImageDraw.Draw(im)
    k = n / 64
    for x0, y0, x1, y1 in RECTS:
        d.rectangle([x0 * k, y0 * k, x1 * k - 1, y1 * k - 1], fill=FG)
    r = (4.5 if px <= 32 else 3.5) * k  # same rule as the SVG: bigger dot on small sizes
    d.ellipse([32 * k - r, 32 * k - r, 32 * k + r, 32 * k + r], fill=DOT)
    return im.resize((px, px), Image.LANCZOS)

def dib(im):  # 32-bit BMP entry (no file header), bottom-up BGRA + AND mask
    w, h = im.size
    px = im.load()
    rows = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            rows += bytes((b, g, r, a))
    mask_row = ((w + 31) // 32) * 4
    return struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(rows), 0, 0, 0, 0) + bytes(rows) + bytes(mask_row * h)

entries = []
for s in SIZES:
    im = draw(s)
    if s >= 256:
        buf = io.BytesIO(); im.save(buf, "PNG"); entries.append((s, buf.getvalue()))
    else:
        entries.append((s, dib(im)))
out = struct.pack("<HHH", 0, 1, len(entries))
off = 6 + 16 * len(entries)
for s, data in entries:
    out += struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s, 0, 0, 1, 32, len(data), off)
    off += len(data)
for _, data in entries:
    out += data
dest = pathlib.Path(__file__).resolve().parent.parent / "src" / "BasketDrop" / "app.ico"
dest.write_bytes(out)
print(dest, len(out), "bytes, sizes", SIZES)
