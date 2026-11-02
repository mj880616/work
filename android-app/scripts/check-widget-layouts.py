#!/usr/bin/env python3
"""APP-죽은위젯: 홈 화면 위젯 화면 틀에 안드로이드 위젯(RemoteViews)이 그릴 수 있는 부품만 있는지 본다.

RemoteViews는 정해진 부품(@RemoteView 표시가 있는 것)만 그린다. 일반 <View>·<Space> 같은 부품이 하나라도
들어가면 기기에서만 그리기가 실패하고 '위젯을 추가할 수 없습니다'가 뜬다(0.4.x '웹2 지금'·'웹2 빠른 쓰기').
빌드·JVM 단위 시험은 이것을 잡지 못하므로(화면 틀은 문법만 맞으면 빌드된다) CI에서 따로 확인한다.

검사 대상: res/xml/*의 appwidget-provider가 가리키는 initialLayout·previewLayout·initialKeyguardLayout,
그리고 RemoteViews를 쓰는 Kotlin 파일이 부르는 R.layout.* — 모든 layout* 폴더(가로·크기별 판 포함).

쓰는 법: python3 android-app/scripts/check-widget-layouts.py [app/src/main 폴더]
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

MAIN = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "app" / "src" / "main"
RES = MAIN / "res"
SRC = MAIN / "java"
ANDROID = "{http://schemas.android.com/apk/res/android}"

# developer.android.com 'Create a simple widget' → 'RemoteViews에서 쓸 수 있는 부품'. minSdk 29 기준.
ALLOWED = {
    # 틀
    "FrameLayout", "LinearLayout", "RelativeLayout", "GridLayout",
    # 부품
    "AnalogClock", "Button", "Chronometer", "ImageButton", "ImageView", "ProgressBar",
    "TextClock", "TextView", "ViewFlipper", "ListView", "GridView", "StackView",
    "AdapterViewFlipper", "ViewStub",
}
# Android 12(API 31)부터만 되는 부품. minSdk가 29라 쓰면 11 이하 기기에서 죽는다.
API31_ONLY = {"CheckBox", "RadioButton", "RadioGroup", "Switch"}


def widget_layout_names() -> set:
    names = set()
    for info in sorted((RES / "xml").glob("*.xml")):
        root = ET.parse(info).getroot()
        if root.tag != "appwidget-provider":
            continue
        for attr in ("initialLayout", "previewLayout", "initialKeyguardLayout"):
            value = root.get(ANDROID + attr)
            if value and value.startswith("@layout/"):
                names.add(value[len("@layout/"):])
    for kt in sorted(SRC.rglob("*.kt")):
        text = kt.read_text(encoding="utf-8")
        if "RemoteViews" not in text:
            continue
        names.update(re.findall(r"R\.layout\.([A-Za-z0-9_]+)", text))
    return names


def check_file(path: Path) -> list:
    problems = []
    for el in ET.parse(path).getroot().iter():
        tag = el.tag
        if tag in ALLOWED:
            continue
        if tag in API31_ONLY:
            problems.append(f"{path.relative_to(MAIN)}: <{tag}>는 안드로이드 12부터만 됨(minSdk 29)")
        else:
            problems.append(f"{path.relative_to(MAIN)}: <{tag}>는 위젯(RemoteViews)이 그릴 수 없음")
    return problems


def main() -> int:
    names = widget_layout_names()
    if not names:
        print("위젯 화면 틀을 찾지 못함 — 검사 경로를 확인하세요.")
        return 1
    problems, checked = [], 0
    for name in sorted(names):
        files = sorted(RES.glob(f"layout*/{name}.xml"))
        if not files:
            problems.append(f"{name}: 화면 틀 파일 없음")
        for f in files:
            checked += 1
            problems.extend(check_file(f))
    if problems:
        print("위젯 화면 틀에 허용되지 않은 부품:")
        for p in problems:
            print("  " + p)
        print("빈 칸·줄은 빈 <TextView>(크기·배경 지정)나 layout_margin으로 바꾸세요.")
        return 1
    print(f"위젯 화면 틀 {checked}개 확인: 허용 부품만 사용")
    return 0


if __name__ == "__main__":
    sys.exit(main())
