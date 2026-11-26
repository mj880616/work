# 플레이 스토어 판 WORK ON+ (com.workonplus.app)

S69-10, 2026-11-24 사용자 결정(08:05). S62-34(APP-플레이스토어비공개테스트)의 play 판을 새 앱으로 옮긴다.

## 결정

- WORK ON+ 플레이 판은 **새 앱 `com.workonplus.app`**으로 낸다. 비공개 테스트(시험자 12명·14일) → 정식 출시.
- 플레이 콘솔에 2026-11-15 만든 초안 앱(옛 플레이 판 앱 ID)은 **나중 노조+ 앱 몫으로 남긴다.** 코드·workflow·시험에는 그 앱 ID를 두지 않는다(`tests/phone-app-play-flavor.test.mjs`가 고정).
- github 판(`kr.or.kptu.work`, GitHub 공개 릴리스·앱 안 스스로 업데이트)은 그대로다.

## 패키지 이름에 매인 곳(전수)

| 곳 | 지금 | 비고 |
| --- | --- | --- |
| `android-app/app/build.gradle` play `applicationId` | `com.workonplus.app` | namespace(코드 패키지 `kr.or.kptu.work`)는 그대로 |
| 앱 이름·아이콘 | main 매니페스트 `WORK ON+`, `@drawable/app_icon` | 두 판이 같이 쓴다. play 매니페스트는 권한 셋만 뺀다 |
| 로그인 복귀(웹) | `app/native-auth-bridge.js` `android-play` → `com.workonplus.app` | 주소에서 패키지를 받지 않는 고정 표 두 값. 옛 플레이 판 앱 ID는 뺐다 |
| 로그인 시작(웹) | `app/login/native-google-return.js`가 사용자 에이전트 `WorkOnPlay`를 보고 `native=android-play` | 옛 표시(노조 약칭이 든 `…Play`)는 `WorkOnPlay`로 바꿨다. 앱은 `BuildConfig.UA_MARK` |
| 위젯 로그인 | `WidgetAuth.kt`가 `BuildConfig.LOGIN_RETURN`(`android-play`) | 패키지 문자열 없음 |
| 서버·Worker 허용 목록 | 없음 | Supabase 리디렉트 허용은 웹 주소(`native-callback.html`)뿐. Edge·Worker에 앱 패키지 목록이 없다 → 서버 변경 없음 |
| intent filter·딥링크 | `kptuwork://auth` | 로그인 복귀는 `intent://…;package=<앱 ID>`로 정확한 앱만 연다. 아래 '남은 위험' 참고 |
| 공유 받기·위젯 provider | activity-alias·receiver 이름은 상대 이름(`.ShareToNote` 등) | 패키지를 따라간다. 액션 문자열(`kr.or.kptu.work.action.*`)은 앱 안 명시 인텐트 이름일 뿐이라 그대로 둔다 |
| FileProvider | `${applicationId}.shareout`, 코드 `BuildConfig.APPLICATION_ID + ".shareout"` | `check-flavor-manifests.py`가 판의 앱 ID로 시작하는지 본다 |
| 스스로 업데이트 | `UpdateRules.PACKAGE = kr.or.kptu.work` | github 판 전용. play 판은 `SELF_UPDATE=false`라 쓰지 않는다 |
| 푸시(FCM) | `play-bundle.yml`이 Firebase 앱 ID를 변수 `WEB2_FCM_PLAY_APP_ID`로 받는다 | Firebase 앱 ID는 패키지마다 다르다. 아래 'CC 할 일' |
| AAB 이름 | `workonplus-play-<버전>.aab`, artifact `workonplus-play-<버전>` | |

## Android App Links(`workonplus.com/.well-known/assetlinks.json`)

- **지금은 두지 않는다.** 앱에 `https` + `autoVerify` intent filter가 없다(App Links를 쓰지 않음). 로그인 복귀는 패키지를 지정한 `intent://`라 App Links 없이도 다른 앱이 가로채지 못한다. 파일을 두려면 Worker 경로를 더해야 해서(Cloudflare 변경 = 6절 정지 지점) 쓸 일이 생길 때 한다.
- 쓰게 되면 넣을 모양(자리):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.workonplus.app",
    "sha256_cert_fingerprints": ["<플레이 콘솔 '앱 서명 키 인증서' SHA-256>"]
  }
}]
```

- 업로드 키 지문은 **넣지 않는다**고 판단한다: 플레이로 받은 앱은 구글의 앱 서명 키로 서명된다. 업로드 키로 서명된 AAB는 플레이에 올리는 용도라 폰에 직접 깔리지 않는다. github 판(`kr.or.kptu.work`)은 다른 패키지라 이 파일과 관계없다.

## 플레이 정책 점검표

| 항목 | 상태 |
| --- | --- |
| targetSdk | 36 — 2026-08-31부터 새 앱·업데이트는 API 36 이상 필요. 충족 |
| minSdk | 29 |
| 스스로 업데이트·설치 요청 | play 판에서 `REQUEST_INSTALL_PACKAGES`·`UPDATE_PACKAGES_WITHOUT_USER_ACTION` 뺌, `SELF_UPDATE=false` |
| 모든 파일 접근 | play 판에서 `MANAGE_EXTERNAL_STORAGE` 뺌, `ALL_FILES=false` |
| 앞쪽 서비스(포그라운드 서비스) 신고 | S70-45(사용자 결정 11/25 '플레이 판만 빼고 먼저'): play 판에서 `FOREGROUND_SERVICE`·`_MICROPHONE`·`_DATA_SYNC`와 두 서비스의 `foregroundServiceType` 뺌, `FG_SERVICES=false` — 신고 없음 |
| 사진·동영상 권한 신고 | S70-45: play 판에서 `READ_MEDIA_*`·`READ_EXTERNAL_STORAGE`·`ACCESS_MEDIA_LOCATION`·`MANAGE_MEDIA` 뺌, `PHONE_GALLERY=false` — 신고 없음 |
| 제한 권한(통화·SMS·위치·연락처·카메라·모든 앱 보기 등) | 없음 — `check-flavor-manifests.py`가 빌드된 판으로 막는다 |

권한과 이유(play 판 최종)

| 권한 | 이유 |
| --- | --- |
| `INTERNET` | 웹 화면·서버 |
| `RECORD_AUDIO` | [녹음] — play 판은 앱이 켜진 동안만(앱을 나가면 일시정지). 실행 중 묻는 보통 위험 권한이라 플레이 '민감 권한' 신고 대상이 아니다(데이터 보안 양식의 '오디오' 항목만) |

play 판에 없는 것(S70-45, github 판에는 그대로): 사진 메뉴 '폰 사진'(폰 사진 폴더 전체 보기·폴더 바꾸기·정보 고치기 — 사진 넣기는 안드로이드 사진 고르기, 권한 없음), 화면 꺼진 뒤 녹음 잇기, 올리는 동안 앞쪽 알림(뒤에서 올리기는 알림 없는 보통 작업으로 계속).

| `POST_NOTIFICATIONS` | 폰 알림 |
| FCM 라이브러리 권한(`WAKE_LOCK`·`RECEIVE` 등) | 폰 알림 받기 |
| `com.google.android.gms.permission.AD_ID` | 라이브러리가 끌어오면 검사가 알림만 남긴다. 들어 있으면 콘솔 '광고 ID' 질문에 '광고에 쓰지 않음'으로 답하거나 매니페스트에서 뺀다 |

데이터 보안 양식에 적을 것(초안)

- 수집: 이메일 주소(구글 로그인, 계정 관리), 사용자 콘텐츠(노트·업데이트·보고·일정·할 일·자료 파일·사용자가 올린 사진·녹음), 기기 ID(폰 알림 토큰), 앱 안 오류·의견(사용자가 보낸 것만).
- play 판은 폰 사진 목록·'이 폰' 파일 목록을 읽지 않는다(사용자가 골라 올린 것만 수집).
- 공유(제3자): 사용자가 연결한 본인 Google 캘린더·할 일·Drive와 주고받는 것, 녹음 받아쓰기 때 AI 처리 업체(about/privacy 5절). 광고·판매 없음.
- 전송 중 암호화: 예(`usesCleartextTraffic=false`, HTTPS만).
- 삭제 요청: 가능 — 앱 안 내 프로필 › 계정 › [계정 삭제](바로), 앱에 못 들어가면 문의(about/privacy 6·11절, `about/delete-account/`).

계정 삭제 경로 — S69 STORE-계정삭제로 해결

- 앱 안: 내 프로필 › 계정 › [계정 삭제] → 확인 창(지워지는 것·남는 것·되돌릴 수 없음, 확인 글자 '삭제') → 바로 삭제 + 모든 기기 로그아웃. 설계 `docs/design/account-delete.md`.
- 웹 주소: `https://workonplus.com/work/about/delete-account/`(로그인 없이 열림, 앱 안 방법 + 앱에 못 들어갈 때 방법).

## CC·사용자 할 일

- Firebase: 같은 Firebase 프로젝트에 Android 앱 `com.workonplus.app`을 등록하고, 나온 앱 ID를 GitHub environment `phone-app-release` 변수 `WEB2_FCM_PLAY_APP_ID`에 넣는다(비밀값 아님). 없으면 play 판은 알림만 꺼진 채 빌드된다. API 키에 Android 앱 제한이 걸려 있으면 `com.workonplus.app`과 플레이 앱 서명 키 SHA-1을 더한다.
- 플레이 콘솔: 새 앱 `com.workonplus.app`(WORK ON+) 만들기 → Play App Signing → 업로드 키 인증서가 `play-bundle.yml` 요약의 SHA-256과 같은지 확인. 앱 서명 키 SHA-256은 App Links를 쓸 때 위 자리에 넣는다.

## 남은 위험

- 두 판이 같은 `kptuwork://auth`를 받는다. 로그인 복귀(토큰 봉인)는 패키지를 지정해 안전하지만, Google 캘린더 연결 결과 화면(`calendar-return-bridge.js`)은 패키지 없이 `kptuwork://auth?google=…`(토큰 없음)를 연다 → 두 판을 한 폰에 같이 깔면 고르는 창이 뜰 수 있다. 한 판만 깐 폰은 그대로다.
