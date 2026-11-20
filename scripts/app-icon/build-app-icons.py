#!/usr/bin/env python3
"""WORK ON 아이콘(2026-11-20 22:25 명진 확정 표장 A 'W를 품은 원')을 저장소 안에서 만든다. 외부 서비스를 쓰지 않는다.

모양(64칸 기준, 시안 원본 수치 그대로):
  어두운 앱 아이콘: 바탕 #22262B 둥근 네모(모서리 14) + 가운데 밝은 원(#F3F1EA, 반지름 22)
                    + 원 안 W 선(#22262B, 굵기 5, 끝·꺾임 둥글게) M19 25 l6 15 7-12 7 12 6-15
  밝은 판(로고용):   바탕 #F3F1EA, 원 #22262B, W 선 #F3F1EA
32px 이하(탭 아이콘 16·32, 사이드바 22px)에서는 같은 자리·같은 색에서 원을 24로 키우고 W 선을 6으로 굵게 한다
(작을 때 선이 흐려지지 않게). 글자가 없어 글꼴이 필요 없다.

    python3 scripts/app-icon/build-app-icons.py      # 아래 파일을 모두 다시 만듦
      app/app-icon.svg, favicon.svg(저장소 맨 위, 공유 페이지), app/brand/mark-light.svg(밝은 판), app/icons/*.png,
      about/nojoplus-logo-120.png(공개 소개·처리방침·약관 로고, 주소는 그대로 두고 그림만 바꿈)
      android-app/app/src/main/res/drawable-anydpi/app_icon.xml(안드로이드 적응형 아이콘)
      android-app/app/src/main/res/drawable/ic_push.xml(알림 작은 그림: 흰 원 + W 비움)

둥근 바탕은 16·32·48·192·512(any)에만 쓴다. 180(apple-touch-icon)과 maskable은 모서리까지 꽉 찬 네모다
(iOS·안드로이드가 직접 모양을 깎는다). maskable은 그림 전체를 가운데 쪽으로 0.9배 줄여 안전 영역(가운데 80% 원) 안에 둔다.
바구니 PC(노조+ 파일 올리기 도우미) 아이콘 basket-pc/icon/basket-icon.svg는 그 프로그램 새 판과 함께 바꾼다(지금은 옛 그림 그대로).
옛 노동조합+ 아이콘(J10)은 나중 노조 공간 앱(노조+)을 위해 scripts/app-icon/nojoplus-j10.svg에 남겨 둔다.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

DARK = '#22262B'
LIGHT = '#F3F1EA'
RADIUS = 14
MASKABLE_SCALE = 0.9
W_POINTS = [(19, 25), (25, 40), (32, 28), (39, 40), (45, 25)]
W_D = 'M19 25l6 15 7-12 7 12 6-15'
SIZES = {'full': (22, 5), 'tab': (24, 6)}  # (원 반지름, W 선 굵기)
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
NAME = 'WORK ON'


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mark(cls, bg_circle, w_color):
    r, sw = SIZES[cls]
    return (f'<g class="{cls}"><circle cx="32" cy="32" r="{r}" fill="{bg_circle}"/>'
            f'<path d="{W_D}" fill="none" stroke="{w_color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/></g>')


def svg(label=NAME, tile=DARK, circle=LIGHT):
    """한 파일: 32px 이하로 그려질 때 SVG 안의 미디어 조건이 굵은 판(tab)으로 바꾼다. rsvg 등 미디어 조건을 모르는 그리기는 full."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{label}">'
            '<style>.tab{display:none}@media (max-width:32px){.full{display:none}.tab{display:inline}}</style>'
            f'<rect width="64" height="64" rx="{RADIUS}" fill="{tile}"/>'
            f'{mark("full", circle, tile)}{mark("tab", circle, tile)}</svg>\n')


def _arc(cx, cy, r, a0, a1, steps):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / steps), cy + r * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]


def _short(a0, a1):
    while a1 - a0 > math.pi:
        a1 -= 2 * math.pi
    while a1 - a0 < -math.pi:
        a1 += 2 * math.pi
    return a1


def w_outline(sw, steps=8):
    """W 선(굵기 sw, 끝·꺾임 둥글게)의 바깥 테두리 한 줄(겹치지 않는 닫힌 다각형). 바깥 꺾임은 둥글게, 안쪽 꺾임은 두 선이 만나는 점,
    양 끝은 반원. 원 안에 비움(evenOdd)으로 쓴다(안드로이드 한 색 그림: monochrome·알림 작은 그림)."""
    h = sw / 2
    pts = W_POINTS
    segs = []
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy)
        segs.append((dx / n, dy / n))

    def side(points, dirs, sign):
        out = []
        for i, (dx, dy) in enumerate(dirs):
            nx, ny = -dy * sign * h, dx * sign * h
            a, b = points[i], points[i + 1]
            if i == 0:
                out.append((a[0] + nx, a[1] + ny))
            if i + 1 < len(dirs):
                ex, ey = dirs[i + 1]
                mx, my = -ey * sign * h, ex * sign * h
                cross = dx * ey - dy * ex
                if cross * sign < 0:  # 이쪽이 바깥 꺾임: 둥글게
                    a0 = math.atan2(ny, nx)
                    out += _arc(b[0], b[1], h, a0, _short(a0, math.atan2(my, mx)), steps)
                else:  # 안쪽 꺾임: 두 띠 가장자리가 만나는 점
                    p1, p2 = (a[0] + nx, a[1] + ny), (b[0] + mx, b[1] + my)
                    t = ((p2[0] - p1[0]) * ey - (p2[1] - p1[1]) * ex) / (dx * ey - dy * ex)
                    out.append((p1[0] + dx * t, p1[1] + dy * t))
            else:
                out.append((b[0] + nx, b[1] + ny))
        return out

    def cap(c, d, sign):
        a0 = math.atan2(d[0] * sign, -d[1] * sign)  # +법선 각
        return _arc(c[0], c[1], h, a0, a0 - math.pi, steps * 2)[1:-1]

    back = [(-dx, -dy) for dx, dy in reversed(segs)]
    ring = side(pts, segs, 1) + cap(pts[-1], segs[-1], 1) + side(list(reversed(pts)), back, 1) + cap(pts[0], back[-1], 1)
    return 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in ring) + ' Z'


def circle_d(r, cx=32, cy=32):
    return f'M{cx - r:g},{cy:g} a{r:g},{r:g} 0 1,0 {2 * r:g},0 a{r:g},{r:g} 0 1,0 {-2 * r:g},0 Z'


def android_xml():
    """적응형 아이콘: 바탕 #22262B(@color/app_icon_bg), 앞 그림은 64칸 그림을 1.125배(72dp 보이는 영역 = 64칸)로 108칸 가운데에 둔다.
    원(반지름 22 → 24.75dp)까지 가운데 66dp 원(안전 영역) 안에 든다. monochrome(안드로이드 13+ 테마 아이콘)은 원에서 W를 비운 한 색."""
    s = 72 / 64
    t = 54 - 32 * s
    r, sw = SIZES['full']
    group = (f'<group android:translateX="{t:g}" android:translateY="{t:g}" android:scaleX="{s:g}" android:scaleY="{s:g}">'
             '\n            {body}\n        </group>')
    fg = (f'<path android:fillColor="{LIGHT}" android:pathData="{circle_d(r)}"/>'
          f'\n            <path android:strokeColor="{DARK}" android:strokeWidth="{sw}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="{W_D}"/>')
    mono = f'<path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="{circle_d(r)} {w_outline(sw)}"/>'

    def layer(body):
        return ('<vector android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">'
                '\n        ' + group.format(body=body) + '\n    </vector>')
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- WORK ON 아이콘(표장 A). scripts/app-icon/build-app-icons.py가 만든다. 손으로 고치지 않는다. -->\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt">\n'
            '    <background android:drawable="@color/app_icon_bg"/>\n'
            '    <foreground>\n        <aapt:attr name="android:drawable">\n    '
            + layer(fg).replace('\n', '\n    ') +
            '\n        </aapt:attr>\n    </foreground>\n'
            '    <monochrome>\n        <aapt:attr name="android:drawable">\n    '
            + layer(mono).replace('\n', '\n    ') +
            '\n        </aapt:attr>\n    </monochrome>\n</adaptive-icon>\n')


def push_xml():
    """알림줄 작은 그림(24dp, 흰 한 색): 원 + W 비움. 64칸 원(반지름 22)을 24칸 가득(반지름 11)으로, 작은 크기라 W 선은 굵은 판(6)."""
    s = 24 / 44
    t = 12 - 32 * s
    r, sw = SIZES['full'][0], SIZES['tab'][1]
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- WORK ON 알림 작은 그림(표장 A: 흰 원 + W 비움, 한 색). scripts/app-icon/build-app-icons.py가 만든다. -->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="24dp"\n    android:height="24dp"\n    android:viewportWidth="24"\n    android:viewportHeight="24">\n'
            f'    <group android:translateX="{t:g}" android:translateY="{t:g}" android:scaleX="{s:g}" android:scaleY="{s:g}">\n'
            f'        <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd" android:pathData="{circle_d(r)} {w_outline(sw)}"/>\n'
            '    </group>\n</vector>\n')


def draw(size, maskable=False, square=False, tile=DARK, circle=LIGHT):
    cls = 'tab' if size <= 32 else 'full'
    r, sw = SIZES[cls]
    s = MASKABLE_SCALE if maskable else 1.0
    k = 16
    big = size * k
    unit = big / 64

    def t(pt):  # 64칸 좌표 → 큰 그림 좌표(maskable은 한가운데 기준 축소)
        return ((32 + (pt[0] - 32) * s) * unit, (32 + (pt[1] - 32) * s) * unit)

    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or square:
        d.rectangle([0, 0, big, big], fill=hexrgb(tile))
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * unit, fill=hexrgb(tile))
    cx, cy = t((32, 32))
    rr = r * s * unit
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=hexrgb(circle))
    pts = [t(p) for p in W_POINTS]
    w = sw * s * unit
    d.line(pts, fill=hexrgb(tile), width=round(w), joint='curve')
    for x, y in pts:
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=hexrgb(tile))
    out = img.resize((size, size), Image.LANCZOS)
    if maskable or square:
        out = out.convert('RGB')
    return out


def main():
    app = REPO / 'app'
    (app / 'icons').mkdir(exist_ok=True)
    (app / 'app-icon.svg').write_text(svg(), encoding='utf-8')
    (REPO / 'favicon.svg').write_text(svg(), encoding='utf-8')
    (app / 'brand' / 'mark-light.svg').write_text(svg(tile=LIGHT, circle=DARK), encoding='utf-8')
    res = REPO / 'android-app' / 'app' / 'src' / 'main' / 'res'
    (res / 'drawable-anydpi').mkdir(exist_ok=True)
    (res / 'drawable-anydpi' / 'app_icon.xml').write_text(android_xml(), encoding='utf-8')
    (res / 'drawable' / 'ic_push.xml').write_text(push_xml(), encoding='utf-8')
    for size in (16, 32, 48, 192, 512):
        draw(size).save(app / 'icons' / f'app-icon-{size}.png', optimize=True)
    draw(180, square=True).save(app / 'icons' / 'app-icon-180.png', optimize=True)
    for size in (192, 512):
        draw(size, maskable=True).save(app / 'icons' / f'app-icon-maskable-{size}.png', optimize=True)
    draw(120).save(REPO / 'about' / 'nojoplus-logo-120.png', optimize=True)


if __name__ == '__main__':
    main()
