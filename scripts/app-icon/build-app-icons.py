#!/usr/bin/env python3
"""Web2 앱 아이콘(메모 줄 + 체크)을 저장소 안에서 만든다. 외부 서비스·글꼴을 쓰지 않는다.

모양(64칸 기준): 종이색(#F2EFE6) 둥근 네모 바탕(모서리 14) 위에 남색(#3B4A6B) 가로줄 3개(길이 40·32·16,
굵기 5, 끝 둥글게) + 오른쪽 아래 초록(#2F9E7A) 체크(굵기 6, 끝·꺾임 둥글게).
32px 이하(탭 아이콘 16·32)에서는 줄 2개(굵기 7) + 더 굵은 체크(굵기 8)로 줄여 또렷하게 한다.
색은 하나로 고정이며 화면 테마(밝게·어둡게)를 따르지 않는다.
둥근 바탕은 16·32·48·192·512(any)에만 쓴다. 180(apple-touch-icon)과 maskable은 모서리까지 꽉 찬 네모다
(iOS·안드로이드가 직접 모양을 깎는다). maskable은 그림 전체를 가운데 쪽으로 0.9배 줄여 안전 영역(가운데 80% 원)
안에 체크 끝까지 들어오게 한다 — 시험(tests)이 이 값을 다시 계산해 확인한다.

    python3 scripts/app-icon/build-app-icons.py   # app/app-icon.svg, app/icons/*.png 다시 만듦

SVG와 PNG는 같은 도형(둥근 막대·둥근 꺾은선)을 쓴다. PNG는 16배로 그린 뒤 줄여 가장자리를 부드럽게 한다.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

PAPER = '#F2EFE6'
NAVY = '#3B4A6B'
GREEN = '#2F9E7A'
RADIUS = 14
MASKABLE_SCALE = 0.9
# 큰 모양: 줄 (x, y, 길이), 굵기 5 / 체크 꺾은선, 굵기 6
FULL_LINES = [(12, 14, 40), (12, 26, 32), (12, 38, 16)]
FULL_H = 5
FULL_CHECK = [(35, 46), (42, 53), (55, 37)]
FULL_CHECK_W = 6
# 작은 모양(≤32px): 줄 2개 굵기 7 / 체크 굵기 8
TAB_LINES = [(10, 15, 42), (10, 29, 28)]
TAB_H = 7
TAB_CHECK = [(30, 45), (38, 53), (54, 34)]
TAB_CHECK_W = 8
ROOT = Path(__file__).resolve().parents[2] / 'app'


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def extent(small=False):
    """그림 가장자리(굵기 반영)가 64칸 한가운데에서 가장 멀리 떨어진 거리. maskable 시험에 쓴다."""
    lines, h, check, cw = (TAB_LINES, TAB_H, TAB_CHECK, TAB_CHECK_W) if small else (FULL_LINES, FULL_H, FULL_CHECK, FULL_CHECK_W)
    far = 0.0
    for x, y, w in lines:
        for px in (x, x + w):
            for py in (y, y + h):
                far = max(far, math.hypot(px - 32, py - 32))
    for px, py in check:
        far = max(far, math.hypot(px - 32, py - 32) + cw / 2)
    return far


def svg():
    """한 파일: 32px 이하로 그려질 때(탭 아이콘·사이드바 22px) SVG 안의 미디어 조건이 작은 모양으로 바꾼다."""
    def bars(lines, h):
        return ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2:g}"/>' for x, y, w in lines)

    def chk(pts, w):
        d = 'M' + ' L'.join(f'{x} {y}' for x, y in pts)
        return f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="웹2">'
            '<style>.tab{display:none}@media (max-width:32px){.full{display:none}.tab{display:inline}}</style>'
            f'<rect width="64" height="64" rx="{RADIUS}" fill="{PAPER}"/>'
            f'<g class="full"><g fill="{NAVY}">{bars(FULL_LINES, FULL_H)}</g>{chk(FULL_CHECK, FULL_CHECK_W)}</g>'
            f'<g class="tab"><g fill="{NAVY}">{bars(TAB_LINES, TAB_H)}</g>{chk(TAB_CHECK, TAB_CHECK_W)}</g></svg>\n')


def png(size, path, maskable=False, square=False):
    small = size <= 32
    lines, h, check, cw = (TAB_LINES, TAB_H, TAB_CHECK, TAB_CHECK_W) if small else (FULL_LINES, FULL_H, FULL_CHECK, FULL_CHECK_W)
    s = MASKABLE_SCALE if maskable else 1.0
    k = 16
    big = size * k
    unit = big / 64

    def t(v):  # 64칸 좌표 → 큰 그림 좌표(maskable은 한가운데 기준 축소)
        return (32 + (v - 32) * s) * unit

    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or square:
        d.rectangle([0, 0, big, big], fill=hexrgb(PAPER))
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * unit, fill=hexrgb(PAPER))
    for x, y, w in lines:
        d.rounded_rectangle([t(x), t(y), t(x + w), t(y + h)], radius=h * s * unit / 2, fill=hexrgb(NAVY))
    r = cw * s * unit / 2
    pts = [(t(x), t(y)) for x, y in check]
    for a, b in zip(pts, pts[1:]):
        ang = math.atan2(b[1] - a[1], b[0] - a[0]) + math.pi / 2
        dx, dy = math.cos(ang) * r, math.sin(ang) * r
        d.polygon([(a[0] + dx, a[1] + dy), (b[0] + dx, b[1] + dy), (b[0] - dx, b[1] - dy), (a[0] - dx, a[1] - dy)], fill=hexrgb(GREEN))
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=hexrgb(GREEN))
    out = img.resize((size, size), Image.LANCZOS)
    if maskable or square:
        out = out.convert('RGB')
    out.save(path, optimize=True)


def main():
    (ROOT / 'icons').mkdir(exist_ok=True)
    (ROOT / 'app-icon.svg').write_text(svg(), encoding='utf-8')
    for size in (16, 32, 48, 192, 512):
        png(size, ROOT / 'icons' / f'app-icon-{size}.png')
    png(180, ROOT / 'icons' / 'app-icon-180.png', square=True)
    for size in (192, 512):
        png(size, ROOT / 'icons' / f'app-icon-maskable-{size}.png', maskable=True)


if __name__ == '__main__':
    main()
