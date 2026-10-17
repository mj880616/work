#!/usr/bin/env python3
"""Web2 앱 아이콘(UI-디자인손질 7번)을 저장소 안에서 만든다. 외부 서비스·글꼴을 쓰지 않는다.

모양(64칸 기준): 남색 바탕, 왼쪽 위가 열린 가는 크림색 틀(경로 M32 16 H46 V48 H18 V32, 굵기 5,
끝은 자른 모양·모서리는 직각) + 정가운데 테라코타 점(r 3.5). 32px 이하에서는 점만 r 4.5로 키운다.
maskable 아이콘은 안전 영역(가운데 80% 원) 안에 들도록 그림만 0.8배로 줄인다.

    python3 scripts/app-icon/build-app-icons.py   # app/app-icon.svg, app/icons/*.png 다시 만듦

SVG와 PNG는 같은 사각형 합집합으로 그리므로 모양이 같다. PNG는 16배로 그린 뒤 줄여 가장자리를 부드럽게 한다.
"""
from pathlib import Path
from PIL import Image, ImageDraw

NAVY = '#1f3150'
CREAM = '#f2e8d5'
TERRACOTTA = '#c9673d'
STROKE = 5.0
DOT = 3.5
SMALL_DOT = 4.5
ROOT = Path(__file__).resolve().parents[2] / 'app'


def frame_rects(scale=1.0):
    """M32 16 H46 V48 H18 V32 를 굵기 5의 직사각형 넷으로(끝 자름·직각 모서리)."""
    h = STROKE / 2
    rects = [
        (32, 16 - h, 46 + h, 16 + h),      # 위: 32 → 46
        (46 - h, 16 - h, 46 + h, 48 + h),  # 오른쪽: 16 → 48
        (18 - h, 48 - h, 46 + h, 48 + h),  # 아래: 46 → 18
        (18 - h, 32, 18 + h, 48 + h),      # 왼쪽: 48 → 32
    ]
    c = 32
    return [tuple(c + (v - c) * scale for v in r) for r in rects]


def svg():
    """한 파일: 32px 이하로 그려질 때(파비콘·사이드바 22px) SVG 안의 미디어 조건이 점만 키운다."""
    rects = ''.join(
        f'<rect x="{x0:g}" y="{y0:g}" width="{x1 - x0:g}" height="{y1 - y0:g}"/>'
        for x0, y0, x1, y1 in frame_rects())
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="9-6">'
            f'<style>@media (max-width:32px){{.dot{{r:{SMALL_DOT:g}px}}}}</style>'
            f'<rect width="64" height="64" fill="{NAVY}"/>'
            f'<g fill="{CREAM}">{rects}</g>'
            f'<circle class="dot" cx="32" cy="32" r="{DOT:g}" fill="{TERRACOTTA}"/></svg>\n')


def png(size, path, maskable=False):
    scale = 0.8 if maskable else 1.0
    dot = SMALL_DOT if size <= 32 else DOT
    k = 16
    big = size * k
    unit = big / 64
    img = Image.new('RGB', (big, big), NAVY)
    draw = ImageDraw.Draw(img)
    for x0, y0, x1, y1 in frame_rects(scale):
        draw.rectangle([round(x0 * unit), round(y0 * unit), round(x1 * unit) - 1, round(y1 * unit) - 1], fill=CREAM)
    r = dot * scale * unit
    draw.ellipse([32 * unit - r, 32 * unit - r, 32 * unit + r, 32 * unit + r], fill=TERRACOTTA)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)


def main():
    (ROOT / 'icons').mkdir(exist_ok=True)
    (ROOT / 'app-icon.svg').write_text(svg(), encoding='utf-8')
    for size in (16, 32, 48, 180, 192, 512):
        png(size, ROOT / 'icons' / f'app-icon-{size}.png')
    for size in (192, 512):
        png(size, ROOT / 'icons' / f'app-icon-maskable-{size}.png', maskable=True)


if __name__ == '__main__':
    main()
