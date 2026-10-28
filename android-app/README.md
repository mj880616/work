# 웹2 폰 앱 (안드로이드·갤럭시 전용)

설계: [docs/design/phone-app-v2.md](../docs/design/phone-app-v2.md). 지금은 단계 ②(공유로 바구니 넣기)까지다.

- 화면은 모두 `https://desk.bokdoong.com/work/app/` 웹이다. 웹을 배포하면 앱을 다시 열 때 바로 반영된다.
- 앱이 맡는 것: 시스템 바 색(웹 theme-color를 따라감), 뒤로가기(`window.KPTUNativeBack`), 로그인 복귀(`kptuwork://auth?handoff=` → 웹 `auth-handoff-client.js`), 바깥 링크(앱 위 브라우저 탭), 파일 선택, 새 버전 알림 줄, 공유 받기(아래).
- 앱은 토큰·업무 데이터를 따로 저장하지 않는다. 권한은 인터넷 하나. 백업·새 폰 옮기기에서 앱 저장 공간을 뺀다.
- 앱 ID `kr.or.kptu.work`, 이름 "웹2"는 옛 앱과 같다(설계 D2·D11). 옛 앱은 debug 키 서명이라 덮어 깔리지 않으므로 한 번 지우고 깐다.

## 공유로 바구니 넣기 (단계 ②)

- 다른 앱 [공유] → "웹2 바구니". 글·링크(`text/plain`), 사진·파일 1개·여러 개(`SEND`/`SEND_MULTIPLE`).
- 앱은 받은 항목을 메모리에만 든다(`ShareIntake.kt`). 폰 저장소에 복사하지 않고, 앱을 닫으면 버린다. `content://`만 받는다.
- 웹을 `?view=basket&share=<일회용 번호>`로 열거나(이미 웹2 화면이면 `window.KPTUShareIntake.arrive`로 알림) → 웹 `basket-share.js`가 바 색 다리(`KPTUAppShell`, 허용 Origin 최상위 화면만)로 `share:get:<번호>`를 보내 목록(이름·종류·크기·글)만 받는다.
- 파일 내용은 웹이 `__share/<번호>/<순번>`을 fetch하면 앱이 `shouldInterceptRequest`(서비스 워커 요청 포함)로 가로채 흘려준다. 서버로 나가지 않는다. 항목마다 한 번만 열리고, 다 열리거나 `share:done`이면 번호를 버린다.
- 저장은 웹 바구니 기존 길 그대로(`basket-upload.js` → `basket-files`, 글만은 `app_notes`). 앱은 토큰을 보지 않는다. 실패하면 웹 메모리의 파일로 [다시 보내기].

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `app/src/main/java/kr/or/kptu/work/MainActivity.kt` | WebView 껍데기 |
| `app/src/main/java/kr/or/kptu/work/ShellRules.kt` | 주소 판정·로그인 복귀 값·바 색·버전 비교·공유 번호·목록 JSON 규칙(단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/ShareIntake.kt` | 공유 받기(메모리 보관·`__share` 가로채기) |
| `app/src/main/java/kr/or/kptu/work/UpdateCheck.kt` | 공개 릴리스 `phone-app-v*` 최신 버전 확인 |
| `app/src/test/…/ShellRulesTest.kt` | 규칙 단위 시험 |

## 빌드

`.github/workflows/build-android-app.yml`이 단위 시험과 debug APK(`web2-phone-<버전>-debug` artifact)를 만든다. 서명된 release APK와 `phone-app-v*` 릴리스 workflow는 별도 작업이다(서명 키는 저장소에 넣지 않는다).
