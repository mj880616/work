# 웹2 폰 앱 (안드로이드·갤럭시 전용)

설계: [docs/design/phone-app-v2.md](../docs/design/phone-app-v2.md). 지금은 단계 ③(홈 화면 위젯)과 [녹음](0.3.3), 위젯 여러 개 ①(0.3.4)·②(0.3.5)·③(0.3.6), 당겨서 새로고침(0.3.7), 앱 스스로 업데이트(0.3.8), 사진 메뉴 폰 사진(0.3.9)까지다.

- 화면은 모두 `https://bokdoong.com/work/app/` 웹이다(0.3.1부터, 주소 이전 ①-D1). 웹을 배포하면 앱을 다시 열 때 바로 반영된다.
- 앱 안 주소(`ShellRules.isInternalApp`, 시험으로 고정): `https` + 호스트 `bokdoong.com`·`desk.bokdoong.com`·`work.bokdoong.com`·`mj880616.github.io`의 `/work/app/` 아래, 그리고 `bokdoong.com`·`desk`의 맨 앞 `/`(Worker가 Web2로 보냄). desk·work는 넘김(302) 기간 동안 안쪽으로 둔다. 그 밖(`bokdoong.com/p/` 같은 Web1 공개 페이지, 공유 짧은 주소 `bokdoong.com/s/…`, 공유 페이지 `work.bokdoong.com/work/share/`, `work`의 Web1)은 바깥 브라우저 탭으로 연다(설계 `docs/design/domain-move.md` 4.3절).
- 앱이 맡는 것: 시스템 바 색(웹 theme-color를 따라감), 뒤로가기(`window.KPTUNativeBack`), 로그인 복귀(`kptuwork://auth?handoff=` → 웹 `auth-handoff-client.js`), 바깥 링크(앱 위 브라우저 탭), 파일 선택, 새 버전 줄과 앱 스스로 업데이트(아래), 공유 받기(아래).
- 앱은 웹 화면의 토큰·업무 데이터를 따로 저장하지 않는다(위젯 세션의 새로고침 토큰 하나만 아래처럼 암호화해 둔다). 요청 권한은 인터넷과 사진 메뉴 '폰 사진'용 사진·동영상 읽기(아래, 0.3.9), [녹음]용 마이크·앞쪽 서비스(마이크)·알림, 앱 스스로 업데이트용 '이 앱에서 설치 허용'(`REQUEST_INSTALL_PACKAGES`)·`UPDATE_PACKAGES_WITHOUT_USER_ACTION`(아래, WorkManager가 일반 권한 몇 개를 자동으로 더함). 백업·새 폰 옮기기에서 앱 저장 공간을 뺀다.
- 앱 ID `kr.or.kptu.work`, 이름 "웹2"는 옛 앱과 같다(설계 D2·D11). 옛 앱은 debug 키 서명이라 덮어 깔리지 않으므로 한 번 지우고 깐다.

## 공유로 바구니 넣기 (단계 ②)

- 다른 앱 [공유] → "웹2 바구니". 글·링크(`text/plain`), 사진·파일 1개·여러 개(`SEND`/`SEND_MULTIPLE`).
- 앱은 받은 항목을 메모리에만 든다(`ShareIntake.kt`). 폰 저장소에 복사하지 않고, 앱을 닫으면 버린다. `content://`만 받는다.
- 웹을 `?view=basket&share=<일회용 번호>`로 열거나(이미 웹2 화면이면 `window.KPTUShareIntake.arrive`로 알림) → 웹 `basket-share.js`가 바 색 다리(`KPTUAppShell`, 허용 Origin 최상위 화면만)로 `share:get:<번호>`를 보내 목록(이름·종류·크기·글)만 받는다.
- 파일 내용은 웹이 `__share/<번호>/<순번>`을 fetch하면 앱이 `shouldInterceptRequest`(서비스 워커 요청 포함)로 가로채 흘려준다. 서버로 나가지 않는다. 항목마다 한 번만 열리고, 다 열리거나 `share:done`이면 번호를 버린다.
- 공유가 들어오면 확인 줄·[넣기] 없이 바로 넣는다(SHARE-바로넣기, 2026-10-30). 저장은 웹 바구니 기존 길 그대로(`basket-upload.js` → `basket-files`, 글만은 `app_notes`). 앱은 토큰을 보지 않는다. 결과는 위쪽 작은 알림 "정리함에 넣었어요 [메모 달기] [되돌리기]", 실패하면 "넣지 못했어요 [다시]"(웹 메모리의 파일로 다시 보냄, 폰에 따로 남기지 않음). 앱 쪽 바뀐 것은 없다(`share:back`은 웹이 더 보내지 않지만 앱은 그대로 받는다).

## 홈 화면 위젯 (단계 ③)

설계: [docs/design/phone-widget-auth.md](../docs/design/phone-widget-auth.md) 10절, 명진 결정 W-D1~W-D5(모두 추천안).

- '웹2 오늘' 위젯(홈 화면 전용): 오늘 일정(서울 0시~24시)·할 일(기한 오늘·지난 것) 몇 줄, [＋바구니], [↻]. 줄을 누르면 앱의 달력·할 일 화면, 바구니는 `?view=basket`.
- 위젯 로그인(W-D1): 위젯 [로그인] 줄 → 내보내지 않은 `WidgetLoginActivity`가 메모리 표시(10분·한 번)를 세움 → 단계 ①과 같은 로그인 주소 → 돌아온 handoff를 표시가 있을 때만 앱이 직접 `auth-handoff` `consume`(Origin `https://bokdoong.com`, 0.3.0까지는 desk). 표시가 없으면 지금처럼 웹 화면으로 넘긴다. 서버·허용 주소는 바꾸지 않았다.
- 위젯 자동 로그인(0.3.2, 설계 12절): 앱 웹 화면이 로그인돼 있으면 그 화면(`app/phone-widget-auth.js`)이 `auth-handoff` `widget_seal`로 같은 사용자의 새 세션 봉인만 받아 다리(`widget:ready`→`widget:mint`→`widget:handoff:`)로 넘기고, 앱이 지금의 consume으로 위젯 세션을 만든다(구글 화면 없음). 웹이 로그아웃·실패·시간 초과면 구글 로그인 탭(대체 길)을 화면이 앞에 나온 뒤 연다(`WidgetLoginFlow`).
- HTTP 도구는 OkHttp. 자바 표준 `HttpURLConnection`은 Origin 머리글을 소리 없이 버린다(`WidgetHttpTest`가 둘 다 확인).
- 토큰: 새로고침 토큰은 Android Keystore AES-GCM 키로 암호화해 `noBackupFilesDir/widget_session.bin` 하나에(`KeystoreVault.kt`), 접근 토큰은 메모리에만. 위젯 내용은 폰에 저장하지 않는다(W-D2, 마지막 그림은 프로세스 메모리에만). 자동으로 끊지 않는다(W-D3).
- 갱신: WorkManager 고유 작업(30분 주기 + 지금 한 번, 같은 이름은 KEEP), 토큰 갱신은 `WidgetSession` 잠금 하나, 새 토큰을 먼저 저장한 뒤 사용. 400·401·403은 열쇠 삭제 → [로그인] 줄, 네트워크·5xx·429는 그대로 두고 다음 갱신.
- 위젯이 부르는 주소는 아래 목록뿐(0.3.6에서 텔레그램·아스날 읽기 넷이 더해짐, 아래 '텔레그램·아스날' 절. `WidgetRules.allowed`, 시험으로 고정): `auth-handoff`(POST), `auth/v1/token?grant_type=refresh_token`, `auth/v1/logout?scope=local`, `google-calendar?action=events`(GET), `google-tasks?action=overview`(GET), `rest/v1/app_todo_candidates?status=eq.open&select=source_kind,summary&order=created_at.desc&limit=100`(GET, 0.3.5).
- 끊기(W-D5): 웹 내 프로필 '계정' 칸의 [위젯 로그아웃](앱에서만 보임, `app/phone-widget-line.js`) → 다리 `widget:logout` → `logout?scope=local` + 파일·키 삭제. 앱 지우기, PC 웹 로그아웃(모든 세션이면 위젯도 끊김, 실기기 확인 필요)도 끊는다.
- WorkManager가 매니페스트에 일반 권한(`WAKE_LOCK`·`ACCESS_NETWORK_STATE`·`RECEIVE_BOOT_COMPLETED`·`FOREGROUND_SERVICE`)을 자동으로 더한다. 사용자에게 묻지 않는 권한이고 데이터 접근을 넓히지 않는다.

## 위젯 여러 개 (0.3.4, WIDGET-여러개 ①)

- '웹2 빠른 쓰기'(4×1): [업데이트] [할 일] [노트] [사진]. '웹2 한 칸'(1×1): 놓을 때 기능 하나를 고른다(노트 추가·업데이트(정리함)·할 일 추가·사진 올리기·녹음 시작). 같은 위젯을 여러 개 놓아 각각 다른 기능을 둔다. 꾹 눌러 다시 고를 수 있다(안드로이드 12+). 시안 6번 '한 칸 바구니'는 한 칸 [업데이트]와 같아 합쳤다.
- 두 위젯은 서버를 읽지 않는다(위젯 세션·`WidgetRules.allowed` 목록 그대로, 갱신 작업 없음). 칸을 누르면 앱 화면만 연다. 어디로 여는지는 `WidgetActions.target`(시험으로 고정).
- [업데이트]·[할 일]·[노트]: 웹2 상단 [+ 추가]와 같은 쓰기 창(`app/phone-widget-write.js` → `KPTUQuickWrite`). 웹2가 떠 있으면 다리 `write:open:<종류>`로 창만 열고(화면을 다시 불러오지 않음, 웹이 `write:hello`로 준비를 알림), 아니면 `?write=<종류>`로 연다(웹이 읽고 주소에서 지움).
- [사진]: 내보내지 않은 `PhotoPickActivity`가 사진 고르기(여러 장)·카메라를 띄우고, 고른 사진을 공유 받기와 같은 길(`ShareIntake`, SHARE-바로넣기)로 정리함에 바로 넣는다. 저장소·카메라 권한 없음. 카메라 사진은 카메라 앱이 사진첩 `Pictures/웹2`에 저장하고, 찍지 않고 닫으면 빈 자리를 지운다.
- [녹음]: 녹음 시작 인텐트(`RecordHub.ACTION_START` → `RecordActionActivity`).
- 한 칸 위젯이 고른 기능은 앱 전용 설정 파일 `widget_one`(위젯 번호 → 기능 이름, 백업 제외)에만 둔다. 위젯을 지우면 그 줄도 지운다.
- 색: 앱 아이콘 톤(종이색 #F2EFE6 바탕·남색 #3B4A6B), 어두운 모드는 `values-night`. 폴드 접음·펼침: 빠른 쓰기는 가로로 늘고 줄며, 한 칸은 크기 고정.

## 오늘 손보기·이번 주 (0.3.5, WIDGET-여러개 ②)

- '웹2 오늘' 맨 아래 '챙길 것 n · 나한테 온 요청 n' 줄(건수만, 누르면 정리함). 웹 `inbox-count.js`와 같은 규칙(처리 전 후보 중 이미 할 일이 된 제목은 빼고, 텔레그램 후보를 '요청'으로 셈). 읽기는 허용 주소 하나 `rest/v1/app_todo_candidates?status=eq.open&select=source_kind,summary&…`(GET, 기존 소유자 RLS). 후보 표가 없으면(404) 0, 다른 실패면 줄을 숨긴다.
- '웹2 이번 주'(4×2): 이번 주(월~일, 서울) 중 오늘부터 일요일까지 일정 8줄까지. 지난 날 시작해 오늘까지 이어지면 '계속'. 줄을 누르면 앱 달력의 그 날(`WIDGET_DAY` → 웹 `?view=calendar&day=` 또는 다리 `day:open:`, 달력 `showDay`).
- 갱신은 오늘·이번 주가 같은 WorkManager 작업 하나(30분 + 지금 한 번), 읽기도 `WidgetSession.readList` 한 번에 묶는다. 위젯을 모두 지우면 작업을 끈다.
- 이번 주 일정 읽기는 오늘 위젯과 같은 `google-calendar?action=events` 모양이라 허용 주소 규칙이 그대로 받는다.

## 텔레그램·아스날 (0.3.6, WIDGET-여러개 ③)

- '웹2 텔레그램'(4×2, 운영자 전용): 머리 '새 소식 n · 요청 n'(오늘 중요한 소식 수·텔레그램 '나한테 온 요청' 수) + 어제·오늘 최근 방 세 곳(방 이름 · 한 줄). 줄을 누르면 앱 텔레그램 화면의 그 방·그 날(`WIDGET_TG` → 웹 `?view=telegram&tg_room=&tg_day=` 또는 다리 `tg:open:`, `KPTUTelegramFeed.show`).
- 내용은 서버 허용표(`private.app_workspace_has_feature`)를 쓰는 기존 RLS만 준다. 위젯은 내 기능 목록(`rpc/app_my_features`, GET)에 telegram이 없으면 '이 기능 없음'만 그린다(누를 곳·새로고침 없음).
- '아스날'(2×1): 다음 경기(자료가 있으면)·지난 경기 결과. 자료는 앱 아스날 화면과 같은 공개 정적 파일 `app/arsenal/matches.js`를 로그인 없이(토큰 없이) 같은 갱신 작업 안에서 6시간에 한 번만 받는다(`WidgetSession.readPublic`, 이 주소 하나만). 지금 파일에는 끝난 경기만 있어 '다음 경기 자료 준비 중'으로 보인다. 점수가 없고 날짜가 오늘 이후인 줄(선택 `"kickoff":"HH:MM"` 서울 시각)이 생기면 그 줄을 다음 경기로 쓴다.
- 허용 주소 추가(GET만, 시험으로 고정): `rpc/app_my_features`, `app_feed_days?source=eq.telegram&day=eq.<날짜>&select=day,kept_count,room_count`, `app_feed_items?source=eq.telegram&hidden_at=is.null&day=gte.<날짜>&select=room_key,room_label,title,summary,day,occurred_at&order=occurred_at.desc&limit=40`, `bokdoong.com/work/app/arsenal/matches.js`(토큰 없음).

## 당겨서 새로고침 (0.3.7, APP-당겨서새로고침)

- 웹 화면을 `SwipeRefreshLayout`(동그란 표시)이 감싼다. 손가락을 댈 때마다 당기기를 끄고, 웹2 화면(`app/phone-pull-refresh.js`)이 그 손가락에 다리 `pull:on`을 보낼 때만 받는다(`ShellRules.pullReady`). 웹은 화면 맨 위가 아니거나, 포스트잇 판·열린 창(아래에서 올라온 창 포함)·메뉴, 내려가 있는 칸 안 스크롤 목록, 글 쓰는 중이면 `pull:off`.
- 당기면 앱이 웹에 `KPTUPullRefresh.run()`을 묻는다. 저장 안 한 글이 있으면 웹이 새 버전 안내 [새로고침]과 같은 확인(`KPTUReloadGuard`, `version-notice.js`)으로 먼저 묻고, 같은 주소로 다시 연다. 웹 다리가 없는 웹2 화면은 앱이 같은 주소를 다시 연다. 다리는 기존 허용 Origin 최상위 화면 규칙 그대로.

## 설치·업데이트 (0.3.8, APP-스스로업데이트)

처음 설치: GitHub 릴리스 `phone-app-v<버전>`의 `web2-phone-<버전>.apk`를 폰 브라우저로 받아 누른다. **0.3.7 이하에서 0.3.8로는 마지막으로 한 번 브라우저로 받아 설치한다**(0.3.7 이하는 앱 안 설치 기능이 없다). 0.3.8부터는 다음 판을 앱이 스스로 받는다.

- 확인: 앱을 열 때 공개 릴리스 목록(로그인·토큰 없음)에서 지금보다 새 판을 찾는다(`UpdateRules.pick`). 초안·미리보기, 다른 저장소·다른 태그 자산, 크기 0·64MB 넘는 자산은 뺀다.
- 받기(`AppUpdater`): 앱 전용 공간 `noBackupFilesDir/update/web2-phone-<버전>.apk`에 받는다. 첫 주소는 `https://github.com/mj880616/work/releases/download/phone-app-v<버전>/…apk`만, 넘김(302)은 자동으로 따라가지 않고 한 번씩 허용 목록(`objects.githubusercontent.com`·`release-assets.githubusercontent.com`, https·기본 포트)만 따라간다(5번까지). 받는 동안 릴리스 정보의 크기를 넘으면 멈추고, 다 받으면 크기·sha256(릴리스 `digest`가 있을 때)을 맞춘다.
- 확인(설치 전): 받은 APK를 `PackageManager`로 열어 앱 ID `kr.or.kptu.work`, 버전 이름 = 릴리스 버전, 버전 번호 > 지금, 서명 인증서 SHA-256 묶음 = 지금 앱 서명(`UpdateRules.sameSigner`)을 본다. 설치 직전에 한 번 더 본다.
- 처음 한 번 '이 앱에서 설치 허용': 위쪽 줄 '처음 한 번 설치 허용 필요 [허용하기]' → 안내 창(1. [설정 열기] 2. '이 출처 허용' 켜기 3. 뒤로가기) → 설정 화면(`ACTION_MANAGE_UNKNOWN_APP_SOURCES`, 이 앱 자리)이 바로 열린다. 돌아오면 이어서 설치한다.
- 설치: `PackageInstaller` 세션. 안드로이드 12+는 `setRequireUserAction(USER_ACTION_NOT_REQUIRED)`로 확인 없이 업데이트를 청한다. 시스템이 확인을 원하면(첫 번째 앱 안 업데이트는 설치한 곳이 브라우저라 보통 확인 한 번) 알림 [업데이트] 한 번(화면에서 [지금 업데이트]를 눌렀으면 바로 확인 창). 앱이 스스로 설치한 뒤부터는 확인 없이 될 수 있다(실기기 확인 필요).
- 언제: 화면을 쓰는 중에는 앱을 닫지 않는다. 위쪽 줄 '준비됨 [지금 업데이트]'를 누르거나, 앱이 뒤에 10분 머물면(WorkManager, 앞에 오면 취소) 설치한다. 로그인 탭·파일 고르기·카메라로 잠깐 뒤에 가는 사이에는 설치하지 않는다.
- 녹음: 녹음 중·일시정지·[멈추고 정리] 뒤 조각 올리는 중에는 설치하지 않고 '녹음이 끝나면 업데이트'로 미룬다(`UpdateRules.recordingBusy`, 녹음 상태가 바뀌면 다시 본다). 앱이 죽어 남은 녹음(이어서 정리 대기)은 앱 전용 공간에 남아 업데이트 뒤에도 이어서 정리된다.
- 상태: 받는 중·설치 중은 알림줄 한 줄('웹2 0.3.9 받는 중'·'설치 중', 알림 권한이 없으면 위쪽 줄만). 새 판으로 바뀌면 받은 파일을 지우고 '웹2 <버전>로 업데이트했어요'(`MY_PACKAGE_REPLACED`).
- 실패: 주소·넘김·크기·sha256·앱 ID·버전·서명 중 하나라도 어긋나거나, 설치가 실패·취소되면 예전처럼 위쪽 줄 [받기](브라우저로 APK 주소).

## 사진 메뉴 폰 사진 (0.3.9, PHOTO-출처 ①)

- 사진 메뉴 위 줄 오른쪽 출처 아이콘 중 [폰 사진](폴더 모양)은 이 앱에서만 보인다. 웹(`app/phone-photos.js`)이 다리로 `photos:hello`를 보내 앱이 `photos:state:{"access":"full|partial|none","key":…,"trash":…}`로 답해야 보인다(웹 브라우저·0.3.8 이하 앱은 아이콘 없음).
- 처음 한 번 [사진 접근 허용](`photos:ask`): 안드로이드 13+는 `READ_MEDIA_IMAGES`·`READ_MEDIA_VIDEO`, 14+는 '고른 사진만'(`READ_MEDIA_VISUAL_USER_SELECTED`, 부분 허용)도 함께 묻는다. 12 이하는 `READ_EXTERNAL_STORAGE`(32까지만 선언). 부분 허용이면 화면에 '고른 것만 보여요 [더 고르기]'. 설정에서 바꾸고 돌아오면 앱이 상태를 다시 알린다.
- 목록·그림: 웹이 `./__phone/<열쇠>/page|ids|months|days|thumb/<번호>|media/<번호>`를 fetch·`<img>`로 부르면 앱이 가로채(`PhoneMedia.serve`, 서비스 워커 요청 포함) MediaStore에서 답한다. 서버로 나가지 않고, 사진·목록을 저장하지 않는다(목록은 메모리 30초, 작은 그림 320·큰 그림 1600은 그때그때 `loadThumbnail`). 열쇠는 앱 프로세스마다 새 무작위 값이고 허용 Origin 최상위 화면 다리에만 준다. 주소·열쇠·값 규칙은 `PhoneMediaRules`(JVM 시험).
- 지우기: `photos:trash:<번호들>` → 안드로이드 11+ `MediaStore.createTrashRequest`(시스템 확인 창, 폰 휴지통 30일) → `photos:trashed:{"ok":…,"count":…}`. 10은 지우기 없음.
- 별표·앨범은 웹2 서버에 출처 'phone'·열쇠 `ms:<MediaStore 번호>`로만 둔다(사진 파일은 올리지 않음, DB 20261030230000). 사진 이름·내용은 로그에 쓰지 않는다.

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
| `app/src/main/java/kr/or/kptu/work/UpdateRules.kt` | 앱 스스로 업데이트 규칙(릴리스 고르기·허용 주소·넘김·크기·버전·서명 비교·녹음 중 미룸·상태 줄, 단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/AppUpdater.kt` | 앱 스스로 업데이트(받기·확인·PackageInstaller 설치·알림줄, `UpdateReceiver`·`UpdateInstallWorker`) |
| `app/src/main/java/kr/or/kptu/work/WidgetAuth.kt` | 위젯 세션(로그인 표시·consume·갱신·로그아웃)과 허용 주소 규칙 |
| `app/src/main/java/kr/or/kptu/work/WidgetHttp.kt` | 위젯 HTTP(OkHttp) |
| `app/src/main/java/kr/or/kptu/work/KeystoreVault.kt` | 위젯 새로고침 토큰 암호화 보관 |
| `app/src/main/java/kr/or/kptu/work/WidgetToday.kt` | 위젯 줄 만들기(오늘 범위·정렬·안내) |
| `app/src/main/java/kr/or/kptu/work/TodayWidget.kt` | 위젯 그리기·WorkManager 작업·`WidgetLoginActivity` |
| `app/src/main/java/kr/or/kptu/work/WidgetTelegram.kt`, `TelegramWidget.kt`, `WidgetArsenal.kt`, `ArsenalWidget.kt` | 텔레그램·아스날 위젯 내용 만들기(JVM 시험 대상)·그리기 |
| `app/src/main/java/kr/or/kptu/work/WidgetWeek.kt`, `WeekWidget.kt` | 이번 주 위젯 줄 만들기(JVM 시험 대상)·그리기 |
| `app/src/main/java/kr/or/kptu/work/WidgetActions.kt` | 빠른 쓰기·한 칸 위젯 규칙(칸 순서·고르기 목록·여는 곳·쓰기 주소, 단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/ActionWidgets.kt` | 빠른 쓰기·한 칸 위젯 그리기, 한 칸 기능 고르기 창, [사진] 고르기·카메라 |
| `app/src/main/java/kr/or/kptu/work/MiniJson.kt` | 응답 JSON 읽기(JVM 시험용, org.json 대신) |
| `app/src/main/java/kr/or/kptu/work/PhoneMediaRules.kt`, `PhoneMedia.kt` | 사진 메뉴 폰 사진(주소·열쇠·권한·정렬·쪽·JSON 규칙은 JVM 시험 대상, MediaStore 읽기·그림·폰 휴지통) |
| `app/src/main/java/kr/or/kptu/work/RecordRules.kt` | 녹음 규칙(조각 자르기·구간 넘김·대기열·재시도·지울 파일·권한·다리 글, 단위 시험 대상) |
| `app/src/main/java/kr/or/kptu/work/RecordStore.kt` | 녹음 임시 보관(앱 전용 공간, 상태 파일, 조각 읽기, 지우기) |
| `app/src/main/java/kr/or/kptu/work/RecordHub.kt` | 녹음 한 곳 상태·`__rec` 가로채기·`RecordActionActivity` |
| `app/src/main/java/kr/or/kptu/work/RecorderService.kt` | 녹음 앞쪽 서비스·알림줄 |
| `app/src/test/…/ShellRulesTest.kt` | 규칙 단위 시험 |
| `app/src/test/…/UpdateRulesTest.kt` | 앱 스스로 업데이트 단위 시험(허용 주소·넘김·크기·서명 비교·녹음 중 미룸·실패 시 브라우저 길·토큰 없음) |
| `app/src/test/…/RecordRulesTest.kt`, `RecordStoreTest.kt` | 녹음 단위 시험(조각 나누기·업로드 재시도·임시 파일 지우기·권한 흐름·다리 글) |
| `app/src/test/…/Widget*Test.kt`, `MiniJsonTest.kt` | 위젯 단위 시험(Origin 전송, 표시·저장 순서·실패 종류·주소 목록·로그 없음) |

## 빌드

`.github/workflows/build-android-app.yml`이 단위 시험, debug APK(`web2-phone-<버전>-debug` artifact), 서명 없는 release 빌드 확인을 한다.

새 판 내기: `android-app/app/build.gradle`의 `versionName`·`versionCode`를 올려 main에 merge → 태그 `phone-app-v<versionName>`(또는 `phone-app-release.yml` 손 실행, `version` 입력) → 승인형 environment `phone-app-release` 승인 → 서명된 `web2-phone-<버전>.apk`가 GitHub 릴리스에 올라간다. `versionCode`는 판마다 1씩 올린다(0.3.0=30, 0.3.1=31, 0.3.2=32, 0.3.3=33, 0.3.4=34, 0.3.5=35, 0.3.6=36, 0.3.7=37, 0.3.8=38, 0.3.9=39). 서명 키·비밀번호는 그 environment 비밀값(`PHONE_APP_KEYSTORE_B64`, `PHONE_APP_KEYSTORE_PASSWORD`, `PHONE_APP_KEY_ALIAS`, `PHONE_APP_KEY_PASSWORD`)에만 있고 저장소에는 없다.

## 위젯 빈칸 고침 (FIX-위젯, 2026-10-30)

- 원인: `WidgetToday`의 정규식에 자바 전용 줄 안 표시 U가 있었다. 안드로이드 정규식(ICU)은 이 표시를 받지 않아 `WidgetToday`가 만들어지지 못했고(초기화 실패), 이 객체를 쓰는 오늘·이번 주·아스날 그리기와 갱신 작업 전체가 예외로 끝나 위젯이 빈칸(놓은 그대로)·'불러오는 중'에 멈췄다(0.3.5~0.3.7). JVM 단위 시험에서는 표시가 되어 잡히지 않았다.
- 정규식은 표시 없이 유니코드 공백(`\p{Z}`·FEFF)을 직접 적는다(웹 `/[\s\p{P}\p{S}]+/gu`와 같은 글자). CI는 앱 코드의 `Regex("…")`를 시스템 ICU로 하나씩 만들어 본다(`scripts/check-icu-regex.py`).
- 울타리(`WidgetGuard`, `WidgetRefresh.kt`): 위젯마다 그리기·내용 만들기를 따로 감싸 한 위젯 실패가 다른 위젯·갱신 작업을 막지 않는다. 그리다 실패하면 빈칸 대신 '불러오지 못했어요 · ↻로 다시'.
- 놓자마자 빈칸이 없게: 레이아웃 기본 글자(머리 '오늘'·'이번 주'·'텔레그램'·'아스날' + '불러오는 중'). 위젯 로그인이 없으면 '위젯 로그인 필요 · 누르면 로그인'.
- 바로 갱신: '지금 한 번'은 안드로이드 12+에서 급한 작업(expedited, 몫이 없으면 일반 작업). 놓을 때·앱을 열 때(마지막 갱신에서 5분이 지났을 때만)·위젯 로그인 직후(도는 작업을 새로 바꿈). 30분 주기·같은 이름 KEEP 규칙은 그대로. 로그인 위젯을 먼저 읽고 아스날 파일은 그다음.
