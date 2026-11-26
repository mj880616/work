#!/usr/bin/env python3
"""WORK ON+ 아이콘(2026-11-21 07:35 사용자 확정: 표장 A 'W를 품은 원'에 + 를 단 판)을 저장소 안에서 만든다. 외부 서비스를 쓰지 않는다.
(그 전 판: 2026-11-20 22:25 표장 A, 이름 WORK ON. + 가 없고 W가 2칸 위에 있었다.)

모양(64칸 기준, 시안 원본 수치 그대로):
  어두운 앱 아이콘: 바탕 #22262B 둥근 네모(모서리 14) + 가운데 밝은 원(#F3F1EA, 반지름 22)
                    + 원 안 W 선(#22262B, 굵기 5, 끝·꺾임 둥글게) M19 27 l6 15 7-12 7 12 6-15
                    + 오른쪽 위 + (가운데가 원 테두리 위 (47.6,16.4), 팔 길이 5.3씩, 굵기 3.1, 끝 둥글게)
                      M47.6 11.1v10.6M42.3 16.4h10.6. 원 밖에 나온 부분은 밝은 색, 원 안에 겹친 부분은 어두운 색
                      (같은 + 를 밝은 색으로 그리고, 원으로 잘라(clipPath) 어두운 색으로 한 번 더 그린다).
  밝은 판(로고용):   색을 뒤집는다. 바탕 #F3F1EA, 원 #22262B, W #F3F1EA, + 원 밖 #22262B / 원 안 #F3F1EA
32px 이하(탭 아이콘 16·32, 사이드바 22px)에서는 같은 자리·같은 모양에서 선만 조금 굵게 한다(W 6, + 3.7).
원 크기는 그대로 둔다(+ 가운데가 원 테두리 위에 있어야 하므로). 글자가 없어 글꼴이 필요 없다.

    python3 scripts/app-icon/build-app-icons.py      # 아래 파일을 모두 다시 만듦
      app/app-icon.svg, favicon.svg(저장소 맨 위, 공유 페이지), app/brand/mark-light.svg(밝은 판), app/icons/*.png,
      about/nojoplus-logo-120.png(공개 소개·처리방침·약관 로고, 구글 로그인 동의 화면 로고에도 쓰는 120×120, 주소는 그대로 두고 그림만 바꿈)
      android-app/app/src/main/res/drawable-anydpi/app_icon.xml(안드로이드 적응형 아이콘)
      android-app/app/src/main/res/drawable/ic_push.xml(알림 작은 그림: 흰 원 + W 비움 + 원 밖 + 채움·원 안 + 비움)

둥근 바탕은 16·32·48·192·512(any)에만 쓴다. 180(apple-touch-icon)과 maskable은 모서리까지 꽉 찬 네모다
(iOS·안드로이드가 직접 모양을 깎는다). maskable은 그림 전체를 가운데 쪽으로 0.9배 줄여 안전 영역(가운데 80% 원) 안에 둔다
(+ 끝까지 포함해 가운데에서 64칸의 약 38%).
PC 파일 올리기 도우미(WORK ON+ 파일 올리기) 아이콘 basket-pc/icon/basket-icon.svg도 같은 그림·같은 수치다(S69, 0.8.1부터). 이 표장을 바꾸면 그 SVG도 고치고 basket-pc/tools/make-icon.py를 돌린다.
옛 노동조합+ 아이콘(J10)은 나중 노조 공간 앱(노조+)을 위해 scripts/app-icon/nojoplus-j10.svg에 남겨 둔다.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

DARK = '#22262B'
LIGHT = '#F3F1EA'
RADIUS = 14
MASKABLE_SCALE = 0.9
W_POINTS = [(19, 27), (25, 42), (32, 30), (39, 42), (45, 27)]
W_D = 'M19 27l6 15 7-12 7 12 6-15'
R = 22  # 원 반지름(두 판 같음)
PLUS_C = (47.6, 16.4)  # + 가운데(원 테두리 위: 가운데에서 22.06)
PLUS_ARM = 5.3
PLUS_D = 'M47.6 11.1v10.6M42.3 16.4h10.6'
SIZES = {'full': (5, 3.1), 'tab': (6, 3.7)}  # (W 선 굵기, + 선 굵기)
CLIP_ID = 'workon-ring'
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
NAME = 'WORK ON+'


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def mark(cls, bg_circle, w_color):
    sw, pw = SIZES[cls]
    line = 'fill="none" stroke-linecap="round" stroke-linejoin="round"'
    return (f'<g class="{cls}"><circle cx="32" cy="32" r="{R}" fill="{bg_circle}"/>'
            f'<path d="{W_D}" {line} stroke="{w_color}" stroke-width="{sw}"/>'
            f'<path d="{PLUS_D}" {line} stroke="{bg_circle}" stroke-width="{pw:g}"/>'
            f'<path d="{PLUS_D}" {line} stroke="{w_color}" stroke-width="{pw:g}" clip-path="url(#{CLIP_ID})"/></g>')


def svg(label=NAME, tile=DARK, circle=LIGHT):
    """한 파일: 32px 이하로 그려질 때 SVG 안의 미디어 조건이 굵은 판(tab)으로 바꾼다. rsvg 등 미디어 조건을 모르는 그리기는 full.
    + 의 원 안 부분은 원 모양 clipPath로 잘라 W 색으로 다시 그린다."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{label}">'
            '<style>.tab{display:none}@media (max-width:32px){.full{display:none}.tab{display:inline}}</style>'
            f'<defs><clipPath id="{CLIP_ID}"><circle cx="32" cy="32" r="{R}"/></clipPath></defs>'
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


def plus_outline(pw, steps=8):
    """+ (굵기 pw, 끝 둥글게)의 바깥 테두리 한 줄(겹치지 않는 닫힌 다각형). 원·W와 함께 evenOdd로 쓰면
    원 밖에 나온 부분은 채워지고 원 안에 겹친 부분은 비워진다(안드로이드 한 색 그림)."""
    cx, cy = PLUS_C
    h, a = pw / 2, PLUS_ARM
    pi = math.pi
    ring = []
    ring += _arc(cx, cy - a, h, pi, 2 * pi, steps * 2)              # 위 끝(왼쪽 → 위 → 오른쪽)
    ring += [(cx + h, cy - h)]
    ring += _arc(cx + a, cy, h, -pi / 2, pi / 2, steps * 2)         # 오른쪽 끝
    ring += [(cx + h, cy + h)]
    ring += _arc(cx, cy + a, h, 0, pi, steps * 2)                   # 아래 끝
    ring += [(cx - h, cy + h)]
    ring += _arc(cx - a, cy, h, pi / 2, 3 * pi / 2, steps * 2)      # 왼쪽 끝
    ring += [(cx - h, cy - h)]
    return 'M' + ' L'.join(f'{x:.2f},{y:.2f}' for x, y in ring) + ' Z'


def circle_d(r, cx=32, cy=32):
    return f'M{cx - r:g},{cy:g} a{r:g},{r:g} 0 1,0 {2 * r:g},0 a{r:g},{r:g} 0 1,0 {-2 * r:g},0 Z'


def mono_d(cls):
    """한 색 그림: 원 + W 비움 + (원 밖 + 채움·원 안 + 비움)."""
    sw, pw = SIZES[cls]
    return f'{circle_d(R)} {w_outline(sw)} {plus_outline(pw)}'


def android_xml():
    """적응형 아이콘: 바탕 #22262B(@color/app_icon_bg), 앞 그림은 64칸 그림을 1.125배(72dp 보이는 영역 = 64칸)로 108칸 가운데에 둔다.
    원(반지름 22 → 24.75dp)과 + 끝(가운데에서 약 27.3칸 → 30.7dp)까지 가운데 66dp 원(안전 영역) 안에 든다.
    + 의 원 안 부분은 원 clip-path로 잘라 어두운 색으로 다시 그린다. monochrome(안드로이드 13+ 테마 아이콘)은 한 색(mono_d)."""
    s = 72 / 64
    t = 54 - 32 * s
    sw, pw = SIZES['full']
    group = (f'<group android:translateX="{t:g}" android:translateY="{t:g}" android:scaleX="{s:g}" android:scaleY="{s:g}">'
             '\n            {body}\n        </group>')
    line = 'android:strokeLineCap="round" android:strokeLineJoin="round"'
    fg = (f'<path android:fillColor="{LIGHT}" android:pathData="{circle_d(R)}"/>'
          f'\n            <path android:strokeColor="{DARK}" android:strokeWidth="{sw}" {line} android:pathData="{W_D}"/>'
          f'\n            <path android:strokeColor="{LIGHT}" android:strokeWidth="{pw:g}" {line} android:pathData="{PLUS_D}"/>'
          f'\n            <group>'
          f'\n                <clip-path android:pathData="{circle_d(R)}"/>'
          f'\n                <path android:strokeColor="{DARK}" android:strokeWidth="{pw:g}" {line} android:pathData="{PLUS_D}"/>'
          f'\n            </group>')
    mono = f'<path android:fillColor="#FFFFFF" android:fillType="evenOdd" android:pathData="{mono_d("full")}"/>'

    def layer(body):
        return ('<vector android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">'
                '\n        ' + group.format(body=body) + '\n    </vector>')
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- WORK ON+ 아이콘(표장 A + 덧셈표). scripts/app-icon/build-app-icons.py가 만든다. 손으로 고치지 않는다. -->\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt">\n'
            '    <background android:drawable="@color/app_icon_bg"/>\n'
            '    <foreground>\n        <aapt:attr name="android:drawable">\n    '
            + layer(fg).replace('\n', '\n    ') +
            '\n        </aapt:attr>\n    </foreground>\n'
            '    <monochrome>\n        <aapt:attr name="android:drawable">\n    '
            + layer(mono).replace('\n', '\n    ') +
            '\n        </aapt:attr>\n    </monochrome>\n</adaptive-icon>\n')


def push_xml():
    """알림줄 작은 그림(24dp, 흰 한 색): 원 + W 비움 + 원 밖 + 채움. 원과 + 끝을 합친 네모를 24칸 가득으로, 작은 크기라 굵은 판(tab)."""
    sw, pw = SIZES['tab']
    x0, x1 = 32 - R, PLUS_C[0] + PLUS_ARM + pw / 2
    y0, y1 = PLUS_C[1] - PLUS_ARM - pw / 2, 32 + R
    side = max(x1 - x0, y1 - y0)
    s = 24 / side
    tx, ty = 12 - (x0 + x1) / 2 * s, 12 - (y0 + y1) / 2 * s
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- WORK ON+ 알림 작은 그림(흰 원 + W 비움 + 덧셈표, 한 색). scripts/app-icon/build-app-icons.py가 만든다. -->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="24dp"\n    android:height="24dp"\n    android:viewportWidth="24"\n    android:viewportHeight="24">\n'
            f'    <group android:translateX="{tx:.5f}" android:translateY="{ty:.5f}" android:scaleX="{s:.6f}" android:scaleY="{s:.6f}">\n'
            f'        <path android:fillColor="#FFFFFFFF" android:fillType="evenOdd" android:pathData="{mono_d("tab")}"/>\n'
            '    </group>\n</vector>\n')


def draw(size, maskable=False, square=False, tile=DARK, circle=LIGHT):
    cls = 'tab' if size <= 32 else 'full'
    sw, pw = SIZES[cls]
    s = MASKABLE_SCALE if maskable else 1.0
    k = 16
    big = size * k
    unit = big / 64

    def t(pt):  # 64칸 좌표 → 큰 그림 좌표(maskable은 한가운데 기준 축소)
        return ((32 + (pt[0] - 32) * s) * unit, (32 + (pt[1] - 32) * s) * unit)

    def stroke(d, pts, width, fill):
        d.line(pts, fill=fill, width=round(width), joint='curve')
        for x, y in pts:
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=fill)

    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or square:
        d.rectangle([0, 0, big, big], fill=hexrgb(tile))
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * unit, fill=hexrgb(tile))
    cx, cy = t((32, 32))
    rr = R * s * unit
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=hexrgb(circle))
    stroke(d, [t(p) for p in W_POINTS], sw * s * unit, hexrgb(tile))
    px, py = PLUS_C
    arms = ([t((px, py - PLUS_ARM)), t((px, py + PLUS_ARM))], [t((px - PLUS_ARM, py)), t((px + PLUS_ARM, py))])
    pwid = pw * s * unit
    for arm in arms:  # + 전체를 원 색으로
        stroke(d, arm, pwid, hexrgb(circle))
    plus = Image.new('L', (big, big), 0)
    pd = ImageDraw.Draw(plus)
    for arm in arms:
        stroke(pd, arm, pwid, 255)
    ring = Image.new('L', (big, big), 0)
    ImageDraw.Draw(ring).ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=255)
    inside = Image.composite(plus, Image.new('L', (big, big), 0), ring)  # + 중 원 안 부분
    img.paste(Image.new('RGBA', (big, big), hexrgb(tile) + (255,)), (0, 0), inside)
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
