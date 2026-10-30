"""단위 시험이 실패하면 실패한 시험 이름·메시지를 GitHub annotation(::error)으로 남긴다.

Actions 로그를 못 보는 환경에서도 PR 화면의 annotation으로 원인을 볼 수 있게 한다.
사용: python3 android-app/scripts/report-unit-test-failures.py <variant> (예: Debug, Release)
"""
import glob
import sys
import xml.etree.ElementTree as ET


def esc(text):
    return text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def esc_title(text):
    return esc(text).replace(':', '%3A').replace(',', '%2C')


variant = sys.argv[1] if len(sys.argv) > 1 else 'Release'
pattern = f'android-app/app/build/test-results/test{variant}UnitTest/*.xml'
files = sorted(glob.glob(pattern))
if not files:
    print(f'::error title=test{variant}UnitTest::시험 결과 파일이 없습니다({pattern}). 시험 전 단계(작업 찾기·컴파일)에서 실패했습니다. Gradle 출력의 "What went wrong"을 보세요.')
    sys.exit(0)
count = 0
for path in files:
    for case in ET.parse(path).getroot().iter('testcase'):
        for bad in list(case.findall('failure')) + list(case.findall('error')):
            count += 1
            name = f"{case.get('classname')}.{case.get('name')}"
            message = (bad.get('message') or '').strip()
            detail = (bad.text or '').strip().splitlines()[:8]
            print(f'::error title={esc_title(f'test{variant}UnitTest 실패 - {name}')}::{esc(message)}%0A{esc(chr(10).join(detail))}')
            if count >= 20:
                sys.exit(0)
if count == 0:
    print(f'::error title=test{variant}UnitTest::결과 파일에는 실패한 시험이 없습니다. 시험 뒤 단계에서 실패했습니다.')
