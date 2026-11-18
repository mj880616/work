"""SVG path 'd'(M·L·H·V·Q·C·Z, 절대 좌표)를 다각형 목록으로 펴는 작은 도구. Pillow만으로 아이콘을 그릴 때 쓴다.

앱 아이콘(scripts/app-icon/build-app-icons.py)과 바구니 PC 아이콘(basket-pc/tools/make-icon.py)이 함께 쓴다.
글자 윤곽(구멍 없는 'ㄴ·ㅗ·ㅈ')만 다루므로 각 윤곽을 채워 합치면 nonzero 채우기와 같다.
"""
import re

_TOKEN = re.compile(r"[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?")


def contours(d, steps=12):
    """d 문자열 → [[(x, y), ...], ...]. 곡선은 steps 조각으로 편다."""
    toks = _TOKEN.findall(d)
    out, cur, i = [], [], 0
    x = y = sx = sy = 0.0
    cmd = None

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        if re.fullmatch(r"[A-Za-z]", toks[i]):
            cmd = toks[i]
            i += 1
            if cmd.islower():
                raise ValueError("상대 좌표 명령은 쓰지 않는다: " + cmd)
            if cmd == "Z":
                if cur:
                    out.append(cur)
                cur, x, y = [], sx, sy
                continue
        if cmd == "M":
            if cur:
                out.append(cur)
            x, y = num(), num()
            sx, sy, cur = x, y, [(x, y)]
            cmd = "L"
        elif cmd == "L":
            x, y = num(), num()
            cur.append((x, y))
        elif cmd == "H":
            x = num()
            cur.append((x, y))
        elif cmd == "V":
            y = num()
            cur.append((x, y))
        elif cmd == "Q":
            x1, y1, x2, y2 = num(), num(), num(), num()
            for s in range(1, steps + 1):
                t = s / steps
                cur.append(((1 - t) ** 2 * x + 2 * (1 - t) * t * x1 + t * t * x2,
                            (1 - t) ** 2 * y + 2 * (1 - t) * t * y1 + t * t * y2))
            x, y = x2, y2
        elif cmd == "C":
            x1, y1, x2, y2, x3, y3 = (num() for _ in range(6))
            for s in range(1, steps + 1):
                t = s / steps
                a, b, c, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                cur.append((a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3))
            x, y = x3, y3
        else:
            raise ValueError("지원하지 않는 명령: " + str(cmd))
    if cur:
        out.append(cur)
    return out


def stroke_rects(d, width):
    """끝이 각진(butt) 가로·세로 선분 'M x y V y2' / 'M x y H x2'를 채울 네모 다각형으로 바꾼다('+' 표시용)."""
    polys, h = [], width / 2
    for c in contours(d):
        for (x0, y0), (x1, y1) in zip(c, c[1:]):
            if x0 == x1:
                polys.append([(x0 - h, y0), (x0 + h, y0), (x1 + h, y1), (x1 - h, y1)])
            elif y0 == y1:
                polys.append([(x0, y0 - h), (x1, y1 - h), (x1, y1 + h), (x0, y0 + h)])
            else:
                raise ValueError("가로·세로 선분만 지원한다")
    return polys
