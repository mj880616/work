# 웹2 폰 앱 (안드로이드·갤럭시 전용)

설계: [docs/design/phone-app-v2.md](../docs/design/phone-app-v2.md). 지금은 단계 ①(웹 감싸기)까지다.

- 화면은 모두 `https://desk.bokdoong.com/work/app/` 웹이다. 웹을 배포하면 앱을 다시 열 때 바로 반영된다.
- 앱이 맡는 것: 시스템 바 색(웹 theme-color를 따라감), 뒤로가기(`window.KPTUNativeBack`), 로그인 복귀(`kptuwork://auth?handoff=` → 웹 `auth-handoff-client.js`), 바깥 링크(앱 위 브라우저 탭), 파일 선택, 새 버전 알림 줄.
- 앱은 토큰·업무 데이터를 따로 저장하지 않는다. 권한은 인터넷 하나. 백업·새 폰 옮기기에서 앱 저장 공간을 뺀다.
- 앱 ID `kr.or.kptu.work`, 이름 "웹2"는 옛 앱과 같다(설계 D2·D11). 옛 앱은 debug 키 서명이라 덮어 깔리지 않으므로 한 번 지우고 깐다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `app/src/main/java/kr/or/kptu/work/MainActivity.kt` | WebView 껍데기 |
| `app/src/main/java/kr/or/kptu/work/ShellRules.kt` | 주소 판정·로그인 복귀 값·바 색·버전 비교 규칙(단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/UpdateCheck.kt` | 공개 릴리스 `phone-app-v*` 최신 버전 확인 |
| `app/src/test/…/ShellRulesTest.kt` | 규칙 단위 시험 |

## 빌드

`.github/workflows/build-android-app.yml`이 단위 시험과 debug APK(`web2-phone-<버전>-debug` artifact)를 만든다. 서명된 release APK와 `phone-app-v*` 릴리스 workflow는 별도 작업이다(서명 키는 저장소에 넣지 않는다).
