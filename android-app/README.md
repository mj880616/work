# 웹2 폰 앱 (안드로이드·갤럭시 전용)

설계: [docs/design/phone-app-v2.md](../docs/design/phone-app-v2.md). 지금은 단계 ③(홈 화면 위젯)과 [녹음](0.3.3)까지다.

- 화면은 모두 `https://bokdoong.com/work/app/` 웹이다(0.3.1부터, 주소 이전 ①-D1). 웹을 배포하면 앱을 다시 열 때 바로 반영된다.
- 앱 안 주소(`ShellRules.isInternalApp`, 시험으로 고정): `https` + 호스트 `bokdoong.com`·`desk.bokdoong.com`·`work.bokdoong.com`·`mj880616.github.io`의 `/work/app/` 아래, 그리고 `bokdoong.com`·`desk`의 맨 앞 `/`(Worker가 Web2로 보냄). desk·work는 넘김(302) 기간 동안 안쪽으로 둔다. 그 밖(`bokdoong.com/p/` 같은 Web1 공개 페이지, 공유 짧은 주소 `bokdoong.com/s/…`, 공유 페이지 `work.bokdoong.com/work/share/`, `work`의 Web1)은 바깥 브라우저 탭으로 연다(설계 `docs/design/domain-move.md` 4.3절).
- 앱이 맡는 것: 시스템 바 색(웹 theme-color를 따라감), 뒤로가기(`window.KPTUNativeBack`), 로그인 복귀(`kptuwork://auth?handoff=` → 웹 `auth-handoff-client.js`), 바깥 링크(앱 위 브라우저 탭), 파일 선택, 새 버전 알림 줄, 공유 받기(아래).
- 앱은 웹 화면의 토큰·업무 데이터를 따로 저장하지 않는다(위젯 세션의 새로고침 토큰 하나만 아래처럼 암호화해 둔다). 요청 권한은 인터넷과 [녹음]용 마이크·앞쪽 서비스(마이크)·알림(아래, WorkManager가 일반 권한 몇 개를 자동으로 더함). 백업·새 폰 옮기기에서 앱 저장 공간을 뺀다.
- 앱 ID `kr.or.kptu.work`, 이름 "웹2"는 옛 앱과 같다(설계 D2·D11). 옛 앱은 debug 키 서명이라 덮어 깔리지 않으므로 한 번 지우고 깐다.

## 공유로 바구니 넣기 (단계 ②)

- 다른 앱 [공유] → "웹2 바구니". 글·링크(`text/plain`), 사진·파일 1개·여러 개(`SEND`/`SEND_MULTIPLE`).
- 앱은 받은 항목을 메모리에만 든다(`ShareIntake.kt`). 폰 저장소에 복사하지 않고, 앱을 닫으면 버린다. `content://`만 받는다.
- 웹을 `?view=basket&share=<일회용 번호>`로 열거나(이미 웹2 화면이면 `window.KPTUShareIntake.arrive`로 알림) → 웹 `basket-share.js`가 바 색 다리(`KPTUAppShell`, 허용 Origin 최상위 화면만)로 `share:get:<번호>`를 보내 목록(이름·종류·크기·글)만 받는다.
- 파일 내용은 웹이 `__share/<번호>/<순번>`을 fetch하면 앱이 `shouldInterceptRequest`(서비스 워커 요청 포함)로 가로채 흘려준다. 서버로 나가지 않는다. 항목마다 한 번만 열리고, 다 열리거나 `share:done`이면 번호를 버린다.
- 저장은 웹 바구니 기존 길 그대로(`basket-upload.js` → `basket-files`, 글만은 `app_notes`). 앱은 토큰을 보지 않는다. 실패하면 웹 메모리의 파일로 [다시 보내기].

## 홈 화면 위젯 (단계 ③)

설계: [docs/design/phone-widget-auth.md](../docs/design/phone-widget-auth.md) 10절, 명진 결정 W-D1~W-D5(모두 추천안).

- '웹2 오늘' 위젯(홈 화면 전용): 오늘 일정(서울 0시~24시)·할 일(기한 오늘·지난 것) 몇 줄, [＋바구니], [↻]. 줄을 누르면 앱의 달력·할 일 화면, 바구니는 `?view=basket`.
- 위젯 로그인(W-D1): 위젯 [로그인] 줄 → 내보내지 않은 `WidgetLoginActivity`가 메모리 표시(10분·한 번)를 세움 → 단계 ①과 같은 로그인 주소 → 돌아온 handoff를 표시가 있을 때만 앱이 직접 `auth-handoff` `consume`(Origin `https://bokdoong.com`, 0.3.0까지는 desk). 표시가 없으면 지금처럼 웹 화면으로 넘긴다. 서버·허용 주소는 바꾸지 않았다.
- 위젯 자동 로그인(0.3.2, 설계 12절): 앱 웹 화면이 로그인돼 있으면 그 화면(`app/phone-widget-auth.js`)이 `auth-handoff` `widget_seal`로 같은 사용자의 새 세션 봉인만 받아 다리(`widget:ready`→`widget:mint`→`widget:handoff:`)로 넘기고, 앱이 지금의 consume으로 위젯 세션을 만든다(구글 화면 없음). 웹이 로그아웃·실패·시간 초과면 구글 로그인 탭(대체 길)을 화면이 앞에 나온 뒤 연다(`WidgetLoginFlow`).
- HTTP 도구는 OkHttp. 자바 표준 `HttpURLConnection`은 Origin 머리글을 소리 없이 버린다(`WidgetHttpTest`가 둘 다 확인).
- 토큰: 새로고침 토큰은 Android Keystore AES-GCM 키로 암호화해 `noBackupFilesDir/widget_session.bin` 하나에(`KeystoreVault.kt`), 접근 토큰은 메모리에만. 위젯 내용은 폰에 저장하지 않는다(W-D2, 마지막 그림은 프로세스 메모리에만). 자동으로 끊지 않는다(W-D3).
- 갱신: WorkManager 고유 작업(30분 주기 + 지금 한 번, 같은 이름은 KEEP), 토큰 갱신은 `WidgetSession` 잠금 하나, 새 토큰을 먼저 저장한 뒤 사용. 400·401·403은 열쇠 삭제 → [로그인] 줄, 네트워크·5xx·429는 그대로 두고 다음 갱신.
- 위젯이 부르는 주소는 다섯 개뿐(`WidgetRules.allowed`, 시험으로 고정): `auth-handoff`(POST), `auth/v1/token?grant_type=refresh_token`, `auth/v1/logout?scope=local`, `google-calendar?action=events`(GET), `google-tasks?action=overview`(GET).
- 끊기(W-D5): 웹 내 프로필 '계정' 칸의 [위젯 로그아웃](앱에서만 보임, `app/phone-widget-line.js`) → 다리 `widget:logout` → `logout?scope=local` + 파일·키 삭제. 앱 지우기, PC 웹 로그아웃(모든 세션이면 위젯도 끊김, 실기기 확인 필요)도 끊는다.
- WorkManager가 매니페스트에 일반 권한(`WAKE_LOCK`·`ACCESS_NETWORK_STATE`·`RECEIVE_BOOT_COMPLETED`·`FOREGROUND_SERVICE`)을 자동으로 더한다. 사용자에게 묻지 않는 권한이고 데이터 접근을 넓히지 않는다.

## 녹음 (0.3.3, MTG-폰녹음)

- 자리: 앱 안 사업 보고 위쪽 줄 [녹음](노트북 [녹음]과 같은 자리, `app/phone-recorder.js`가 붙임). 웹 화면이 `rec:hello`를 보내 앱이 답해야 보인다(웹 브라우저·0.3.2 이하 앱에서는 안 보임).
- 녹음: 앞쪽 서비스 `RecorderService`(foregroundServiceType=microphone)가 MediaRecorder로 OGG/Opus 32kbps, 1채널을 앱 전용 공간 `noBackupFilesDir/rec/seg-<녹음>-<구간>.ogg` 한 파일에 계속 쓴다. 화면이 꺼지거나 다른 앱을 써도 이어진다. 알림줄 '녹음 중 12:34'(시계는 알림이 셈) + [일시정지]/[이어 녹음] + [멈추고 정리].
- 조각: 1분마다 새로 쓰인 바이트를 조각(파일 안 범위)으로 자른다(`RecordRules.cut`). 서버(`meeting-transcribe` rec_piece)는 조각을 순서대로 이어 한 파일로 만들므로 바이트 순서만 지키면 된다. 구간은 서버 `rec_start` 답의 `piece_seconds`가 300 이상(옛 5분 기준, 한 구간 16조각까지)이면 15분, 1분 기준이면 서버 `segment_seconds`(59분)에서 새 구간 파일로 넘긴다.
- 올리기: 웹 화면(`app/phone-recorder-core.mjs`)이 웹2 로그인 세션으로 `rec_start`·`rec_piece`를 부른다. 앱은 토큰을 보지 않는다. 조각 내용은 웹이 `./__rec/<한 번 번호>`를 fetch하면 앱이 가로채 흘려준다(`RecordHub.serve`, 서버로 나가지 않음). 대기열 순서·재시도 간격(3·10·30·60초)·서버가 닫은 구간 버리기는 앱 규칙(`RecordRules`, 시험으로 고정).
- 임시 파일: 다 올린 구간 파일은 바로 지우고, `rec_finish`가 끝나거나 [버리기]하면 상태 파일(`state.json`, 번호·바이트 범위·초만)과 남은 파일을 모두 지운다. 갤러리·공용 폴더에는 남기지 않는다(저장소 권한 없음).
- 앱이 죽으면(강제 종료·폰 꺼짐) 올린 조각은 서버에, 못 올린 조각은 앱 전용 공간에 남는다. 다시 열면 '끝나지 않은 폰 녹음' 줄 [이어서 정리](남은 조각 올림 → 정리)·[버리기].
- [멈추고 정리](띠·알림줄): 녹음기를 멈춤 → 남은 조각 올림 → `rec_finish` → 구간마다 전사 → 사업 보고 › 회의 입력 창이 초안을 채운 채 열림(노트북과 같은 `KPTUReportEntry`·`KPTUMeetingTranscriptDraft`). 저장은 명진이 [저장]. 알림줄 동작은 내보내지 않은 `RecordActionActivity`가 받아 웹2 화면을 앞으로 부른다.
- 녹음 시작 인텐트: `kr.or.kptu.work.action.REC_START`를 `RecordActionActivity`(내보내지 않음)로 보내면 웹2를 열고 녹음을 시작한다. 홈 위젯 [녹음] 칸이 쓸 자리(위젯 여러 개 작업과 줄 세우기).
- 권한: 마이크는 처음 녹음할 때 묻고(거절하면 녹음 안 함), 알림(안드로이드 13+)은 한 번만 묻는다(거절해도 녹음은 됨). 소리·토큰은 로그에 쓰지 않는다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `app/src/main/java/kr/or/kptu/work/MainActivity.kt` | WebView 껍데기 |
| `app/src/main/java/kr/or/kptu/work/ShellRules.kt` | 주소 판정·로그인 복귀 값·바 색·버전 비교·공유 번호·목록 JSON 규칙(단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/ShareIntake.kt` | 공유 받기(메모리 보관·`__share` 가로채기) |
| `app/src/main/java/kr/or/kptu/work/UpdateCheck.kt` | 공개 릴리스 `phone-app-v*` 최신 버전 확인 |
| `app/src/main/java/kr/or/kptu/work/WidgetAuth.kt` | 위젯 세션(로그인 표시·consume·갱신·로그아웃)과 허용 주소 규칙 |
| `app/src/main/java/kr/or/kptu/work/WidgetHttp.kt` | 위젯 HTTP(OkHttp) |
| `app/src/main/java/kr/or/kptu/work/KeystoreVault.kt` | 위젯 새로고침 토큰 암호화 보관 |
| `app/src/main/java/kr/or/kptu/work/WidgetToday.kt` | 위젯 줄 만들기(오늘 범위·정렬·안내) |
| `app/src/main/java/kr/or/kptu/work/TodayWidget.kt` | 위젯 그리기·WorkManager 작업·`WidgetLoginActivity` |
| `app/src/main/java/kr/or/kptu/work/MiniJson.kt` | 응답 JSON 읽기(JVM 시험용, org.json 대신) |
| `app/src/main/java/kr/or/kptu/work/RecordRules.kt` | 녹음 규칙(조각 자르기·구간 넘김·대기열·재시도·지울 파일·권한·다리 글, 단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/RecordStore.kt` | 녹음 임시 보관(앱 전용 공간, 상태 파일, 조각 읽기, 지우기) |
| `app/src/main/java/kr/or/kptu/work/RecordHub.kt` | 녹음 한 곳 상태·`__rec` 가로채기·`RecordActionActivity` |
| `app/src/main/java/kr/or/kptu/work/RecorderService.kt` | 녹음 앞쪽 서비스·알림줄 |
| `app/src/test/…/ShellRulesTest.kt` | 규칙 단위 시험 |
| `app/src/test/…/RecordRulesTest.kt`, `RecordStoreTest.kt` | 녹음 단위 시험(조각 나누기·업로드 재시도·임시 파일 지우기·권한 흐름·다리 글) |
| `app/src/test/…/Widget*Test.kt`, `MiniJsonTest.kt` | 위젯 단위 시험(Origin 전송, 표시·저장 순서·실패 종류·주소 목록·로그 없음) |

## 빌드

`.github/workflows/build-android-app.yml`이 단위 시험, debug APK(`web2-phone-<버전>-debug` artifact), 서명 없는 release 빌드 확인을 한다.

새 판 내기: `android-app/app/build.gradle`의 `versionName`·`versionCode`를 올려 main에 merge → 태그 `phone-app-v<versionName>`(또는 `phone-app-release.yml` 손 실행, `version` 입력) → 승인형 environment `phone-app-release` 승인 → 서명된 `web2-phone-<버전>.apk`가 GitHub 릴리스에 올라간다. `versionCode`는 판마다 1씩 올린다(0.3.0=30, 0.3.1=31, 0.3.2=32, 0.3.3=33). 서명 키·비밀번호는 그 environment 비밀값(`PHONE_APP_KEYSTORE_B64`, `PHONE_APP_KEYSTORE_PASSWORD`, `PHONE_APP_KEY_ALIAS`, `PHONE_APP_KEY_PASSWORD`)에만 있고 저장소에는 없다.
