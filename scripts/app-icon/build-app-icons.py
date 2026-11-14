#!/usr/bin/env python3
"""노동조합+ 아이콘(J10: 올리브 둥근 네모 + 흰 '노조' + 노랑 각진 '+')을 저장소 안에서 만든다. 외부 서비스를 쓰지 않는다.

모양(64칸 기준, 시안 docs/design/mockups/nojoplus-icon.html 6차 J10 수치 그대로):
  바탕 올리브(#4D5A2E) 둥근 네모(모서리 14)
  '노조' 흰색(#FFFEFA), Noto Sans KR 굵기 800, 크기 20, 시작 x 9.1, 글자 기준선 y 40, 글자 사이 -1
  '+' 노랑(#E7C25A) 선 굵기 2.4, 끝 각짐: 세로 x 49 y 26~38, 가로 y 32 x 43~55('노조'와 '+' 사이 -1.5)
글자는 선(path)으로 바꿔 넣어 기기 글꼴과 상관없이 같은 모양이다. 32px 이하(탭 아이콘 16·32, 사이드바 22px)에서는
같은 색·같은 자리에서 글자 굵기만 900으로 올린다(작을 때 획이 흐려지지 않게).

글자 윤곽은 nojoplus-glyphs.json에 들어 있다(커밋됨). 글꼴에서 다시 뽑을 때만 --font를 준다:
    python3 scripts/app-icon/build-app-icons.py --font NotoSansKR[wght].ttf
  글꼴: Noto Sans KR 가변 글꼴(google/fonts 저장소 ofl/notosanskr, SIL Open Font License 1.1). 글꼴 파일은 커밋하지 않는다.

    python3 scripts/app-icon/build-app-icons.py      # 아래 파일을 모두 다시 만듦
      app/app-icon.svg, favicon.svg(저장소 맨 위, 공유 페이지), app/icons/*.png
      android-app/app/src/main/res/drawable-anydpi/app_icon.xml(안드로이드 적응형 아이콘)
      basket-pc/icon/basket-icon.svg(바구니 PC — 이어서 python3 basket-pc/tools/make-icon.py)

둥근 바탕은 16·32·48·192·512(any)에만 쓴다. 180(apple-touch-icon)과 maskable은 모서리까지 꽉 찬 네모다
(iOS·안드로이드가 직접 모양을 깎는다). maskable은 그림 전체를 가운데 쪽으로 0.9배 줄여 안전 영역(가운데 80% 원) 안에 둔다.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import svgpath  # noqa: E402

OLIVE = '#4D5A2E'
WHITE = '#FFFEFA'
YELLOW = '#E7C25A'
RADIUS = 14
MASKABLE_SCALE = 0.9
TEXT = '노조'
TEXT_X, TEXT_Y, TEXT_SIZE, LETTER_SPACING = 9.1, 40, 20, -1
PLUS_D = 'M49 26V38M43 32H55'
PLUS_W = 2.4
WEIGHTS = {'full': 800, 'tab': 900}
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
GLYPHS = HERE / 'nojoplus-glyphs.json'
NAME = '노동조합+'


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def extract(font_path):
    """가변 글꼴에서 굵기별 '노조' 윤곽을 64칸 좌표(시안과 같은 자리)로 뽑아 JSON에 적는다."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    out = {'source': 'Noto Sans KR (google/fonts ofl/notosanskr, SIL Open Font License 1.1)',
           'text': TEXT, 'x': TEXT_X, 'baseline': TEXT_Y, 'size': TEXT_SIZE, 'letterSpacing': LETTER_SPACING, 'paths': {}}
    for key, wght in WEIGHTS.items():
        font = instantiateVariableFont(TTFont(font_path), {'wght': wght})
        upm = font['head'].unitsPerEm
        k = TEXT_SIZE / upm
        gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font['hmtx']
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
        x = TEXT_X
        for ch in TEXT:
            name = cmap[ord(ch)]
            gs[name].draw(TransformPen(pen, (k, 0, 0, -k, x, TEXT_Y)))
            x += hmtx[name][0] * k + LETTER_SPACING
        out['paths'][key] = pen.getCommands()
    GLYPHS.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def glyphs():
    return json.loads(GLYPHS.read_text(encoding='utf-8'))['paths']


def plus_svg():
    return f'<path d="{PLUS_D}" fill="none" stroke="{YELLOW}" stroke-width="{PLUS_W}" stroke-linecap="butt"/>'


def svg(label=NAME):
    """한 파일: 32px 이하로 그려질 때 SVG 안의 미디어 조건이 굵은 글자(tab)로 바꾼다. rsvg 등 미디어 조건을 모르는 그리기는 full."""
    g = glyphs()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{label}">'
            '<style>.tab{display:none}@media (max-width:32px){.full{display:none}.tab{display:inline}}</style>'
            f'<rect width="64" height="64" rx="{RADIUS}" fill="{OLIVE}"/>'
            f'<path class="full" d="{g["full"]}" fill="{WHITE}"/>'
            f'<path class="tab" d="{g["tab"]}" fill="{WHITE}"/>'
            f'{plus_svg()}</svg>\n')


def basket_svg():
    """바구니 PC: 같은 그림 + 보낼 것이 있을 때만 켜는 주황 점(badge). 작은 크기(≤24px)는 굵은 글자."""
    g = glyphs()
    badge = f'<g class="badge"><circle cx="54" cy="54" r="8" fill="#C9673D" stroke="{OLIVE}" stroke-width="3"/></g>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="바구니 PC드롭">'
            '<style>.small,.badge{display:none}@media (max-width:24px){.full{display:none}.small{display:inline}}</style>'
            f'<rect width="64" height="64" rx="{RADIUS}" fill="{OLIVE}"/>'
            f'<g class="full"><path d="{g["full"]}" fill="{WHITE}"/>{plus_svg()}{badge}</g>'
            f'<g class="small"><path d="{g["tab"]}" fill="{WHITE}"/>{plus_svg()}{badge}</g></svg>\n')


def android_xml():
    """적응형 아이콘: 바탕 올리브, 앞 그림은 64칸 그림을 1.125배(72dp 보이는 영역 = 64칸)로 108칸 가운데에 둔다.
    글자·'+' 끝까지 가운데 66dp 원(안전 영역) 안에 든다. monochrome은 테마 아이콘(안드로이드 13+)용."""
    g = glyphs()
    s = 72 / 64
    t = 54 - 32 * s
    hw = PLUS_W / 2
    plus = f'M{49 - hw:g},26H{49 + hw:g}V38H{49 - hw:g}Z M43,{32 - hw:g}H55V{32 + hw:g}H43Z'
    fg = (f'<group android:translateX="{t:g}" android:translateY="{t:g}" android:scaleX="{s:g}" android:scaleY="{s:g}">'
          '\n            <path android:fillColor="{white}" android:pathData="{text}"/>'
          '\n            <path android:fillColor="{yellow}" android:pathData="{plus}"/>'
          '\n        </group>')

    def layer(white, yellow):
        return ('<vector android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">'
                '\n        ' + fg.format(white=white, yellow=yellow, text=g['full'], plus=plus) + '\n    </vector>')
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- 노동조합+ 아이콘(J10). scripts/app-icon/build-app-icons.py가 만든다. 손으로 고치지 않는다. -->\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt">\n'
            f'    <background android:drawable="@color/app_icon_bg"/>\n'
            '    <foreground>\n        <aapt:attr name="android:drawable">\n    '
            + layer(WHITE, YELLOW).replace('\n', '\n    ') +
            '\n        </aapt:attr>\n    </foreground>\n'
            '    <monochrome>\n        <aapt:attr name="android:drawable">\n    '
            + layer('#FFFFFF', '#FFFFFF').replace('\n', '\n    ') +
            '\n        </aapt:attr>\n    </monochrome>\n</adaptive-icon>\n')


def png(size, path, maskable=False, square=False):
    small = size <= 32
    s = MASKABLE_SCALE if maskable else 1.0
    k = 16
    big = size * k
    unit = big / 64

    def t(pt):  # 64칸 좌표 → 큰 그림 좌표(maskable은 한가운데 기준 축소)
        return ((32 + (pt[0] - 32) * s) * unit, (32 + (pt[1] - 32) * s) * unit)

    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or square:
        d.rectangle([0, 0, big, big], fill=hexrgb(OLIVE))
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * unit, fill=hexrgb(OLIVE))
    for c in svgpath.contours(glyphs()['tab' if small else 'full']):
        d.polygon([t(p) for p in c], fill=hexrgb(WHITE))
    for c in svgpath.stroke_rects(PLUS_D, PLUS_W):
        d.polygon([t(p) for p in c], fill=hexrgb(YELLOW))
    out = img.resize((size, size), Image.LANCZOS)
    if maskable or square:
        out = out.convert('RGB')
    out.save(path, optimize=True)


def main():
    if '--font' in sys.argv:
        extract(sys.argv[sys.argv.index('--font') + 1])
    app = REPO / 'app'
    (app / 'icons').mkdir(exist_ok=True)
    (app / 'app-icon.svg').write_text(svg(), encoding='utf-8')
    (REPO / 'favicon.svg').write_text(svg(), encoding='utf-8')
    (REPO / 'basket-pc' / 'icon' / 'basket-icon.svg').write_text(basket_svg(), encoding='utf-8')
    res = REPO / 'android-app' / 'app' / 'src' / 'main' / 'res' / 'drawable-anydpi'
    res.mkdir(exist_ok=True)
    (res / 'app_icon.xml').write_text(android_xml(), encoding='utf-8')
    for size in (16, 32, 48, 192, 512):
        png(size, app / 'icons' / f'app-icon-{size}.png')
    png(180, app / 'icons' / 'app-icon-180.png', square=True)
    for size in (192, 512):
        png(size, app / 'icons' / f'app-icon-maskable-{size}.png', maskable=True)


if __name__ == '__main__':
    main()
