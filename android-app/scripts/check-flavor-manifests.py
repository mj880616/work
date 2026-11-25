"""S62-34 APP-플레이스토어비공개테스트: 빌드된 두 판의 매니페스트(병합 결과)를 aapt2로 읽어 본다.

- play 판(com.workonplus.app): 스스로 업데이트·설치 요청·'모든 파일 접근' 권한이 없어야 한다.
  S70-45: 앞쪽 서비스 권한(FOREGROUND_SERVICE·_MICROPHONE·_DATA_SYNC)과 서비스의 foregroundServiceType,
  사진·동영상 권한(READ_MEDIA_*·READ_EXTERNAL_STORAGE·ACCESS_MEDIA_LOCATION·MANAGE_MEDIA)도 없어야 한다.
  github 판은 위 권한이 모두 있고 서비스 종류도 dataSync·microphone 그대로여야 한다.
- github 판(kr.or.kptu.work): 지금과 같다(위 권한이 그대로 있다).
- 두 판 모두: 플레이에서 신고서 없이는 막히는 권한(통화·SMS·통화 기록·백그라운드 위치·모든 앱 보기·접근성 등)이 라이브러리를 통해서도 들어오지 않았다.
- FileProvider 이름(authorities)이 판의 앱 ID를 따른다.

사용: python3 android-app/scripts/check-flavor-manifests.py <aapt2 경로> [--github <apk>] [--play <apk>]
실패하면 ::error 줄을 남기고 1로 끝난다. 값(열쇠·비밀번호)은 다루지 않는다.
"""
import re
import subprocess
import sys

PLAY_ID = 'com.workonplus.app'
GITHUB_ID = 'kr.or.kptu.work'

# play 판에서 뺀 권한(android-app/app/src/play/AndroidManifest.xml).
PLAY_REMOVED = [
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION',
    'android.permission.MANAGE_EXTERNAL_STORAGE',
    # S70-45 APP-플레이판권한줄이기
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    'android.permission.READ_MEDIA_IMAGES',
    'android.permission.READ_MEDIA_VIDEO',
    'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.ACCESS_MEDIA_LOCATION',
    'android.permission.MANAGE_MEDIA',
]

# 어느 판에도 없어야 하는 권한(플레이 제한 권한·신고서 대상). 라이브러리가 끌어와도 여기서 잡힌다.
NEVER = [
    'android.permission.READ_CALL_LOG',
    'android.permission.WRITE_CALL_LOG',
    'android.permission.PROCESS_OUTGOING_CALLS',
    'android.permission.READ_SMS',
    'android.permission.SEND_SMS',
    'android.permission.RECEIVE_SMS',
    'android.permission.RECEIVE_MMS',
    'android.permission.RECEIVE_WAP_PUSH',
    'android.permission.CALL_PHONE',
    'android.permission.ANSWER_PHONE_CALLS',
    'android.permission.READ_PHONE_NUMBERS',
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.QUERY_ALL_PACKAGES',
    'android.permission.BIND_ACCESSIBILITY_SERVICE',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.USE_FULL_SCREEN_INTENT',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.REQUEST_DELETE_PACKAGES',
    'android.permission.BIND_VPN_SERVICE',
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
    'android.permission.GET_ACCOUNTS',
    'android.permission.CAMERA',
]

# 있으면 플레이 콘솔 '광고 ID' 질문의 답이 달라진다. 실패로 보지 않고 알려만 준다.
NOTICE = ['com.google.android.gms.permission.AD_ID']

errors = []


def fail(msg):
    errors.append(msg)
    print(f'::error title=flavor manifest::{msg}')


def run(aapt2, *args):
    return subprocess.run([aapt2, *args], check=True, capture_output=True, text=True).stdout


def read(aapt2, apk):
    badging = run(aapt2, 'dump', 'badging', apk)
    m = re.search(r"^package: name='([^']+)'", badging, re.M)
    package = m.group(1) if m else ''
    perms = set(re.findall(r"^uses-permission: name='([^']+)'", badging, re.M))
    tree = run(aapt2, 'dump', 'xmltree', '--file', 'AndroidManifest.xml', apk)
    authorities = set(re.findall(r'android:authorities\([^)]*\)="([^"]+)"', tree))
    # aapt2 xmltree는 foregroundServiceType을 숫자(0x...)로 적는다. 있는지만 본다.
    fgs_types = len(re.findall(r'android:foregroundServiceType\(', tree))
    return package, perms, authorities, fgs_types


def check(aapt2, apk, flavor):
    package, perms, authorities, fgs_types = read(aapt2, apk)
    want = PLAY_ID if flavor == 'play' else GITHUB_ID
    if package != want:
        fail(f'{flavor} 판 앱 ID가 {want}가 아닙니다: {package or "(없음)"}')
    for p in NEVER:
        if p in perms:
            fail(f'{flavor} 판에 플레이 제한 권한이 들어왔습니다: {p}')
    for p in PLAY_REMOVED:
        if flavor == 'play' and p in perms:
            fail(f'play 판에 빼야 할 권한이 남았습니다: {p}')
        if flavor == 'github' and p not in perms:
            fail(f'github 판에서 권한이 빠졌습니다(github 판은 바뀌면 안 됨): {p}')
    if flavor == 'play' and fgs_types:
        fail(f'play 판에 앞쪽 서비스 종류(foregroundServiceType)가 {fgs_types}개 남았습니다')
    if flavor == 'github' and fgs_types < 2:
        fail(f'github 판의 앞쪽 서비스 종류가 빠졌습니다(dataSync·microphone 2개여야 함): {fgs_types}')
    if f'{want}.shareout' not in authorities:
        fail(f'{flavor} 판 FileProvider 이름이 {want}.shareout이 아닙니다')
    for p in NOTICE:
        if p in perms:
            print(f'::notice title=flavor manifest::{flavor} 판에 {p}가 있습니다(플레이 콘솔 광고 ID 신고에 반영)')
    for a in authorities:
        if not a.startswith(want + '.'):
            fail(f'{flavor} 판에 다른 앱 ID로 시작하는 authorities가 있습니다: {a}')
    print(f'{flavor}: package={package} permissions={len(perms)} authorities={len(authorities)} fgs_types={fgs_types}')


def main(argv):
    if len(argv) < 2:
        print('사용: check-flavor-manifests.py <aapt2> [--github <apk>] [--play <apk>]')
        return 2
    aapt2 = argv[1]
    rest = argv[2:]
    seen = 0
    while rest:
        flag, apk, rest = rest[0], rest[1], rest[2:]
        if flag not in ('--github', '--play'):
            print(f'모르는 선택지: {flag}')
            return 2
        check(aapt2, apk, flag[2:])
        seen += 1
    if seen == 0:
        print('검사할 APK가 없습니다')
        return 2
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
