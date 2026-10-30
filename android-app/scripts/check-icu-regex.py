#!/usr/bin/env python3
"""FIX-위젯: 앱 코드의 Regex("…") 글을 안드로이드와 같은 ICU 정규식으로 하나씩 만들어 본다.

안드로이드 java.util.regex는 ICU로 돈다. JVM(단위 시험)에서는 되는 (?U) 같은 표시가 ICU에서는
PatternSyntaxException이라, 그 정규식을 가진 객체가 기기에서만 만들어지지 못한다(0.3.5~0.3.7 위젯 빈칸의 원인).
JVM 단위 시험으로는 잡히지 않으므로 CI에서 시스템 ICU(libicui18n)로 따로 확인한다.

쓰는 법: python3 android-app/scripts/check-icu-regex.py [소스 폴더]
"""
import ctypes
import glob
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "app" / "src" / "main" / "java"
LITERAL = re.compile(r'Regex\("((?:[^"\\]|\\.)*)"')


def kotlin_unescape(text: str) -> str:
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c != "\\":
            out.append(c)
            i += 1
            continue
        e = text[i + 1]
        if e == "u":
            out.append(chr(int(text[i + 2:i + 6], 16)))
            i += 6
            continue
        out.append({"n": "\n", "t": "\t", "r": "\r", "b": "\b", "\\": "\\", '"': '"', "'": "'", "$": "$"}[e])
        i += 2
    return "".join(out)


def load_icu():
    for path in sorted(glob.glob("/usr/lib/x86_64-linux-gnu/libicui18n.so.*") + glob.glob("/lib/x86_64-linux-gnu/libicui18n.so.*")):
        m = re.search(r"libicui18n\.so\.(\d+)$", path)
        if not m:
            continue
        lib = ctypes.CDLL(path)
        uc = ctypes.CDLL(path.replace("libicui18n", "libicuuc"))
        ver = m.group(1)
        open_ = getattr(lib, "uregex_open_" + ver)
        open_.restype = ctypes.c_void_p
        open_.argtypes = [ctypes.c_char_p, ctypes.c_int32, ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        close = getattr(lib, "uregex_close_" + ver)
        close.argtypes = [ctypes.c_void_p]
        name = getattr(uc, "u_errorName_" + ver)
        name.restype = ctypes.c_char_p
        name.argtypes = [ctypes.c_int]
        return open_, close, name
    raise SystemExit("ICU(libicui18n)를 찾지 못했습니다.")


def main() -> int:
    open_, close, name = load_icu()
    files = sorted(ROOT.rglob("*.kt"))
    count, bad = 0, []
    for f in files:
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for m in LITERAL.finditer(line):
                pattern = kotlin_unescape(m.group(1))
                units = pattern.encode("utf-16-le")
                status = ctypes.c_int(0)
                parse_error = ctypes.create_string_buffer(256)
                handle = open_(units + b"\0\0", len(units) // 2, 0, parse_error, ctypes.byref(status))
                if handle:
                    close(handle)
                count += 1
                if status.value > 0:
                    bad.append(f"{f.relative_to(ROOT)}:{n}: {name(status.value).decode()} {m.group(1)}")
    if count == 0:
        print("Regex(\"…\") 글을 하나도 찾지 못했습니다.")
        return 1
    if bad:
        print("안드로이드(ICU)에서 만들어지지 않는 정규식:")
        print("\n".join(bad))
        return 1
    print(f"ICU 정규식 확인: {count}개 모두 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
