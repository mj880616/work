# 폰 알림 설계 (APP-폰알림)

📱 이 문서는 설계만 한다. 앱·웹 코드, DB, Edge, 비밀값, CI 검사, workflow는 바꾸지 않는다. **명진 승인(9절)이 있어야 구현한다.**

- 작성: 2026-10-28, Claude Code 웹. 기준 `origin/main` `71e6132`(#1434). production은 조회하지 않았다. "사실"은 저장소 파일에서 읽은 내용, "추정"·"확인 필요"는 안드로이드·Firebase 일반 지식이다.
- 요청: Drive 'Web2 요청함' [10/29 01:28] "폰 알림" 1~6, 명진 결정 "진행, 추천대로(폰 앱 활용)". 원장 행 APP-폰알림(대기 → 설계).
- **결정 변경 기록.** 상위 설계 [phone-app-v2.md](phone-app-v2.md) D9("알림은 지금 만들까요?" → 추천 "아니요, 보류")를 명진이 10/29 01:28 요청함에서 **"진행"으로 바꿨다.** 이 문서가 그 후속이다. 상위 설계 3절 ④ "착수하지 않는다" 문장은 원장 반영 때 갱신이 필요하다.
- 관련: [위젯 로그인](phone-widget-auth.md), [다음 주 준비 한 장](next-week-sheet.md) 4절(예약 장치), `app/collection-status.js`(수집 멈춤 기준), `.github/workflows/collaboration-ownership-check.yml`(알림 재유입 검사), `.github/workflows/drive-summary-refresh.yml`(예약 → Edge 방식).

## 0. 명진용 요약

- **무엇.** 갤럭시의 새 "웹2" 앱으로 알림을 받는다. 할 일 기한·원장 약속·회의 요약 완료·수집 멈춤은 그때그때, 새로 생긴 챙길 것·하루 마감 초안은 아침 8시·저녁 6시에 묶어서, 금요일 15시에는 '다음 주 준비 한 장' 한 번. 일정 알림은 구글 캘린더가 이미 하므로 넣지 않는다.
- **설정.** 종류별 켜기/끄기와 밤 조용한 시간을 웹2 프로필에서 고르고, 서버에 저장한다. 알림을 누르면 그 기록이 앱에서 바로 열린다.
- **새로 필요한 것(전부 처음 생김).** ① 구글의 알림 배달 서비스 Firebase(FCM, 무료) ② 폰 주소(기기 토큰)를 적어 둘 서버 표 ③ 알림을 만들어 보내는 서버 함수 ④ 그 함수가 쓸 비밀값 ⑤ 예약 실행(GitHub Actions). 그래서 정지 지점이 여러 번 있다(6절).
- **명진이 할 일.** Firebase 프로젝트 만들기(화면 안내 7절), 비밀값 붙여 넣기(대시보드, 직접), DB·Edge 승인 버튼, 폰에서 알림 허용과 확인.
- **비용.** FCM·Firebase 기본 요금제는 무료, 예약 실행은 공개 저장소라 무료, AI를 쓰지 않는다. 추가 비용 0원(추정).

## 1. 지금 상태 (사실)

| 항목 | 내용 |
| --- | --- |
| 옛 알림 | 웹 알림 센터·푸시 화면·안드로이드 Firebase 코드는 #272에서 제거됐다. `supabase/functions/push-notifications`는 410 "retired"만 돌려주는 코드로 저장소에 남아 있고, 운영에서는 ENV-6c에서 **삭제**됐다(`docs/web2-env6b-edge-source.md` 5.1) |
| 재유입 검사 | `collaboration-ownership-check.yml`("Notification removal check")이 옛 파일 이름(`notification-center-ui.*`, `push-notifications-ui.js`, `KptuFirebaseMessagingService.java`, `ic_notification.xml`)이 없어야 하고, 앱 소스에 `FirebaseMessaging`·`FirebaseApp`·`KPTUNativePush`·`POST_NOTIFICATIONS`·`MESSAGING_EVENT`·`firebase-messaging`이 없어야 하며, `app/sw.js`에 push·notificationclick 처리가 없어야 통과한다 |
| 새 앱 | `android-app/`(Kotlin, #1414·#1421). 권한은 인터넷 하나. 웹 → 앱 좁은 다리 `KPTUAppShell`(허용 Origin 최상위 화면만, 문자열 명령). 내부 주소 판정 `ShellRules` |
| 예약 장치 | GitHub Actions 예약 → 공유 비밀값으로 Edge 호출(`drive-summary-refresh.yml`, `library-text-nightly.yml`). pg_cron 없음. JOURNAL-오늘한줄초안(18시)·다음 주 준비(금 15시)도 이 방식으로 진행 중(#1430~#1432, next-week-sheet 4절) |
| 알림 재료 | 할 일 = Google Tasks(`google-tasks`, 서버 토큰 `ensureAccess`) · 원장 약속 = `app_ledger_records`(`kind='commitment'`, `commitment_status='waiting'`, `follow_up_on`) · 챙길 것 = `app_todo_candidates`(`status='open'`) · 하루 마감 초안 = `app_journal_drafts`(#1430) · 다음 주 준비 = `app_journal_next_week_sheets`(설계안, next-week-sheet 5절) · 수집 멈춤 = `drive-summary` 상태(`collectors` 신호)와 `app/collection-status.js`의 `STALL_HOURS`·`SEND_SILENT_HOURS`·`SILENT_HOURS` · 회의 요약 완료 = MTG-녹음초안(#1438·#1439 진행 중) |
| 설정 저장 | 화면 설정은 `app_profiles.view_prefs`(jsonb + 검사 제약). 알림 설정 칸은 없음 |

## 2. 알림 종류 (요청 1~4)

| 종류 | 언제 | 내용(예) | 누르면 |
| --- | --- | --- | --- |
| 할 일 기한 당일 | 그날 **아침 8시 묶음 실행 때 개별 알림**(Google Tasks 기한은 날짜만 있고 시각이 없다). 5건 넘으면 "할 일 기한 오늘 외 n건" 한 개로 | "기한 오늘 · ○○ 자료 보내기" | 할 일 화면 그 할 일 |
| 원장 약속 D-1 | 전날 **저녁 6시 실행 때 개별 알림**. `follow_up_on`(없으면 `date_end`)이 내일, 대기 중, 유효(`current`·`needs_check`) | "내일 약속 · ○○에 답 주기" | 원장 그 기록 |
| 회의 요약 완료 | 서버 뒤 작업(긴 전사)이 끝난 순간 | "회의 요약 완료 · ○○ 회의" | 사업 보고 › 회의 그 초안 |
| 수집 멈춤 | 15분마다 확인, **멈춤이 시작될 때 한 번**(풀렸다 다시 멈추면 또 한 번) | "수집 멈춤 · 텔레그램 보내기 10시간째 신호 없음" | 홈 수집 칸 |
| 아침 묶음 08:00 | 매일 | "새 챙길 것 3건" | 챙길 것 목록 |
| 저녁 묶음 18:00 | 매일(오늘한줄초안 18시 생성 **뒤**, 18:20 근처) | "하루 마감 초안 준비됨 · 새 챙길 것 2건" | 업무일지 오늘 |
| 다음 주 준비 | 금요일 15시(한 장 생성 뒤, 15:20 근처) | "다음 주 준비 한 장" | 업무일지 주간 [다음 주] |
| 일정 | **보내지 않음**(요청 4, 구글 캘린더와 겹침) | — | — |

- 묶음에 넣을 것이 하나도 없으면 묶음 알림을 보내지 않는다.
- 수집 멈춤 판단은 홈 수집 칸과 **같은 기준**이어야 한다. `collection-status.js`의 기준 숫자와 판단을 서버·화면이 같이 쓰는 공용 모듈(`app/collection-stall-rules.mjs` 같은 것)로 옮겨 둘이 어긋나지 않게 한다(중복 구현 금지).
- 회의 요약 완료는 MTG-녹음초안이 "긴 전사를 서버 뒤 작업으로" 만드는 단계에서 연결한다. 지금 1단계(#1439)는 화면 안에서 바로 끝나므로 알림이 필요 없다(그 작업 뒤로 줄 세우기).
- GitHub 예약은 수십 분 늦을 수 있다(사실: 정각을 피해 분을 흩뜨리는 기존 관례). 알림 시각은 "8시 뒤", "6시 뒤"로 이해한다.

## 3. 설정·조용한 시간·누르면 그 자리 (요청 5·6)

- **설정 저장 위치.** `app_profiles`에 새 칸 `notify_prefs`(jsonb, 검사 제약)를 더하는 것을 추천한다. 기존 `view_prefs`는 화면 모양 설정이라 섞지 않되, 같은 사용자 설정 표를 써서 새 표를 늘리지 않는다(AGENTS §4). 모양: `{"kinds":{"task_due":true,"commitment":true,"meeting_done":true,"collect_stall":true,"morning":true,"evening":true,"next_week":true},"quiet":{"from":"22:00","to":"07:00"}}`. 기본값은 전부 켬, 조용한 시간 22:00~07:00(서울).
- **조용한 시간에 생긴 알림.** 버리지 않고 조용한 시간이 끝나는 첫 실행(07:00 근처)에 **한 개로 묶어** 보낸다(추천, 결정 N-D3). 아침 8시 묶음과 가까우면 그 묶음에 합친다.
- **화면.** 웹2 내 프로필에 "폰 알림" 작은 줄 묶음(종류별 켜기/끄기 칩 + 조용한 시간 두 칸 + [시험 알림]). 앱이 아닌 브라우저에서도 설정은 보이고 저장된다. 큰 카드·안내문은 쓰지 않는다.
- **안드로이드 쪽.** 종류마다 알림 채널을 하나씩 만든다(갤럭시 설정에서도 끌 수 있음). 그러나 **켜기/끄기의 원본은 서버 설정**이다. 서버가 꺼진 종류는 아예 보내지 않는다.
- **잠금 화면.** 알림 공개 범위를 "비공개"로 둬 잠금 화면에는 "웹2 · 새 알림"만 보이고, 잠금을 풀면 제목이 보인다(추천, 결정 N-D4).
- **누르면 그 자리로.** 알림에 `open` 값(예: `/work/app/?view=tasks&task=<id>`)만 싣는다. 앱은 `ShellRules`의 내부 주소 판정을 통과한 주소만 WebView로 열고, 아니면 앱 첫 화면을 연다. 로그인은 웹 화면 세션 그대로다(알림이 로그인 정보를 실어 나르지 않음).

## 4. 구조

```
[GitHub Actions 예약(15분·08:00·18:20·금 15:20)] --공유 비밀값--> [Edge phone-push]
        ├─ 재료 읽기(서버 안: Google Tasks 토큰, app_ledger_records, app_todo_candidates, app_journal_drafts, 수집 상태)
        ├─ 설정·조용한 시간(app_profiles.notify_prefs) → 보낼 것 고르기
        ├─ 중복 막기(app_push_log: 같은 종류·같은 기록·같은 날은 한 번)
        └─ FCM HTTP v1 (서비스 계정 비밀값) ──> 구글 ──> 갤럭시 웹2 앱
[회의 요약 서버 뒤 작업 끝] --(같은 함수의 공용 보내기 모듈)--> FCM
[앱] FCM 기기 토큰 → 다리(KPTUAppShell) → 웹 화면 → phone-push register(사용자 JWT)
```

### 4.1 새 서버 표 (DB migration 1개)

| 표 | 칸 | 권한 |
| --- | --- | --- |
| `app_push_devices` | `id`, `workspace_id`, `user_id`, `fcm_token`(유일), `app_version`, `created_at`, `last_seen_at`, `revoked_at` | owner만(`private.app_is_workspace_owner`). authenticated: 자기 기기 읽기·지우기. 넣기·고치기는 Edge(서버)만. anon·PUBLIC 없음 |
| `app_push_log` | `workspace_id`, `kind`, `ref_key`(기록 id 또는 묶음 날짜), `day`, `sent_at`, `status`(`sent`·`held_quiet`·`failed`·`skipped_off`) · (`workspace_id`,`kind`,`ref_key`,`day`) 유일 | owner 읽기만(설정 화면 "최근 보낸 알림" 확인용). 쓰기는 Edge만. 30일 지난 행은 같은 함수가 지움 |
| `app_profiles.notify_prefs` | 3절 모양, 검사 제약 | 기존 `app_profiles` 정책 그대로(owner) |

- 기기 토큰은 "이 폰에 알림을 보낼 수 있는 주소"다. 토큰만으로 웹2 데이터를 읽을 수는 없지만, 남이 알면 그 폰에 알림을 보낼 수 있다(서비스 계정 비밀값도 있어야 함). 그래서 화면에는 끝 6자리만 보이고, 로그·PR·보고에 출력하지 않는다.
- FCM이 "등록 안 됨(UNREGISTERED)"을 돌려주면 그 기기를 `revoked_at`으로 표시하고 다시 보내지 않는다.

### 4.2 새 Edge 함수 `phone-push` (첫 배포)

- 옛 이름 `push-notifications`는 **되살리지 않는다**(폐기한 구조, AGENTS §4). 새 이름·새 코드로 만든다. 저장소의 옛 410 폴더 정리는 별도 판단(범위 밖 1).
- `verify_jwt=false` + 코드 인증(다른 예약 함수와 같은 방식). 입구 두 가지만:
  - **사용자 입구**(JWT, 소유자 확인): `register`(기기 토큰 등록·갱신), `unregister`, `devices`(끝 6자리·마지막 시각), `test`(내 기기에 시험 알림 1개). 설정 읽기·저장은 화면이 `app_profiles`를 기존 RLS로 직접 한다(새 입구 없음).
  - **예약 입구**(`x-phone-push-cron-secret` 고정 길이 비교, drive-summary와 같은 방식): `run?slot=quarter|morning|evening|friday`. 누구에게 보낼지는 **서버가 정한다**(단독 소유자). 호출 쪽이 보낸 사용자·작업공간 id를 믿지 않는다(AGENTS §3-3). 두 입구의 비밀값·JWT가 섞여 오면 거절한다(collector-feed와 같은 방식).
- 알림 본문은 짧은 제목(40자 안팎)만. 업무 본문 전체·첨부·사람 연락처를 싣지 않는다.
- Google Tasks 읽기는 `google-tasks`의 토큰 읽기(`ensureAccess`)를 공용 모듈로 불러 쓴다(next-week-sheet가 같은 길을 쓰기로 했으므로 그 공용 모듈을 함께 쓴다).

### 4.3 새 비밀값·설정 (저장소에 넣지 않음)

| 이름(안) | 어디에 | 누가 |
| --- | --- | --- |
| `FCM_SERVICE_ACCOUNT_JSON` | Supabase Edge 비밀값 | 명진이 대시보드에서 직접 붙여 넣기(7절). 채팅에 보내지 않음 |
| `PHONE_PUSH_CRON_SECRET` | Supabase Edge 비밀값 + GitHub Actions 비밀값(같은 값) | 💻 PC 로컬 세션이 만들어 `gh secret set`, Supabase는 명진이 대시보드에 |
| Firebase 앱 설정 4개(project id, app id, sender id, API key) | GitHub environment `phone-app-release`의 **변수**(release 빌드 때만 앱에 들어감) | 💻 PC 로컬 세션 |

- Firebase 앱 설정값은 APK 안에 들어가므로 원래 비밀은 아니지만, 공개 저장소 규칙(키를 커밋하지 않음)에 따라 커밋하지 않는다. `google-services.json` 파일도 저장소에 넣지 않는다. 그 API 키는 Google Cloud 콘솔에서 "Android 앱 `kr.or.kptu.work` + 서명 SHA-1"로 제한한다(7절).
- PR CI의 debug 빌드는 Firebase 설정 없이 빌드되고, 알림 기능은 꺼진 채로 돈다.

### 4.4 앱 변경

- `firebase-messaging` 라이브러리, `FirebaseApp`을 빌드 변수로 직접 초기화(구글 서비스 Gradle 플러그인·json 파일 없이), 메시지 받는 서비스 `PushService.kt` 1개, `POST_NOTIFICATIONS` 권한(안드로이드 13+ 실행 중 요청: 설정의 [시험 알림]이나 첫 알림 켜기 때 한 번).
- 기기 토큰은 앱이 서버에 직접 보내지 않는다. 앱 → `KPTUAppShell` 다리(허용 Origin 최상위 화면만) → 웹 화면 → `phone-push register`(웹 세션 JWT). 앱이 로그인 토큰을 만지지 않는 원칙(상위 설계 4.2)을 지킨다.
- 받는 메시지는 "데이터 메시지"(제목·종류·`open`)로 받아 앱이 알림을 그린다. `open`은 3절 판정.

## 5. 옛 알림 금지 검사 바꾸기 (새 승인 필요)

지금 검사는 "알림이 다시 들어오지 않게" 넣은 장치다. 새 알림을 넣으려면 검사를 **좁고 분명하게** 바꿔야 한다. 이것은 명진의 새 승인 대상이다(결정 N-D6).

| 지금 검사 | 바꾸는 안 |
| --- | --- |
| 옛 파일 이름 5개가 없어야 함 | **그대로**(옛 알림 센터·옛 서비스 파일 이름은 계속 금지) |
| 웹 `index.html`·`loader-v2.js` 등에 옛 알림 UI 이름 금지 | **그대로** |
| `app/sw.js`에 push·notificationclick 처리 금지 | **그대로**(웹 푸시는 만들지 않음. 알림은 앱만) |
| 앱 소스에 `FirebaseMessaging`·`FirebaseApp`·`POST_NOTIFICATIONS`·`MESSAGING_EVENT`·`firebase-messaging` 금지 | **허용 위치를 못 박는다:** `FirebaseMessaging`·`MESSAGING_EVENT`는 `PushService.kt`에서만, `FirebaseApp`은 `PushSetup.kt`에서만, `POST_NOTIFICATIONS`는 `AndroidManifest.xml`과 `PushSetup.kt`에서만, `firebase-messaging`은 `app/build.gradle`에서만. 그 밖의 파일에 나오면 실패 |
| `KPTUNativePush` 금지 | **그대로**(옛 다리 이름) |
| (새로) | 웹 쪽: 기기 등록 호출은 `app/phone-push-settings.js` 한 파일에서만. 옛 이름 `push-notifications`를 부르는 코드 금지 |

검사 이름 "Notification removal check"는 "Notification boundary check"로 바꾸는 것을 제안한다(같은 workflow 파일, 뜻이 바뀌었으므로).

## 6. 단계·정지 지점

| 단계 | 내용 | 정지 지점·명진 몫 |
| --- | --- | --- |
| N0 | 이 설계 + 검사 바꾸기 승인 | **명진 승인** |
| N1 | Firebase 프로젝트·Android 앱 등록, 서비스 계정 키 | **명진 직접**(7절). 💻 PC 세션이 서명 SHA-1 알려 줌·변수 등록 |
| N2 DB | `app_push_devices`·`app_push_log`·`app_profiles.notify_prefs` migration(짝 파일 5개, owner 정책, anon·PUBLIC 없음) | **DB 적용 정지**(승인형 DB workflow, 명진 승인 버튼) |
| N3 Edge | `phone-push` 첫 배포(`first_deploy=true`, `verify_jwt=false` 명시, env6b 5절 표 사전 등록). 사용자 입구·예약 입구·시험 알림만. 종류 판단은 N5 | **비밀값 2개 등록(명진)** → **Edge 첫 배포 정지**(승인형 workflow) |
| N4 앱+웹 | 앱 FCM 받기·권한·채널·누르면 열기, 검사 바꾸기(5절), 웹 설정 줄·기기 등록. 새 앱 판 | 검사 변경은 N0 승인 범위 안. **앱 릴리스 승인**(`phone-app-release`) |
| N5 종류 | 할 일 기한·원장 약속·아침/저녁 묶음·금요일·수집 멈춤 판단 + 예약 workflow(`phone-push-schedule.yml`, 15분·08:00·18:20·금 15:20, 분 흩뜨림) + 조용한 시간 보류·합치기 + 수집 멈춤 공용 모듈 | **Edge 재배포 정지**. 예약 workflow는 커맨드센터 merge |
| N6 회의 | 회의 요약 완료 연결(MTG-녹음초안 서버 뒤 작업 단계 뒤) | 그 작업의 Edge 배포 정지 |
| N7 확인 | 명진 갤럭시: 종류별 수신·누르면 그 자리·끄기·조용한 시간 | 명진 |

- 순서·의존: N0 → N1·N2(나란히) → N3 → N4 → N5 → N6. 위젯(③)과는 독립이다. 오늘한줄초안(#1430~#1432)·다음 주 준비가 먼저 merge·적용돼야 저녁 묶음·금요일 알림의 재료가 생긴다.
- 크기: 대(세션 4~5개, DB·Edge·비밀값 포함).

**되돌리기.** 앱: 알림 권한을 끄거나 웹2 설정에서 전부 끔(서버가 안 보냄). Edge: 예약 workflow를 끄면 알림이 멈춤(Actions 화면 [Disable workflow]). DB: 각 migration의 rollback SQL(표 삭제, `notify_prefs` 칸 삭제). Firebase: 프로젝트 삭제. 업무 데이터에는 쓰지 않으므로 잃는 데이터가 없다.

## 7. 명진이 할 일 (N1, 한 번)

PC 크롬에서 한다. 비밀번호·키·JSON 내용은 채팅에 보내지 않는다.

1. `console.firebase.google.com` 접속 → 평소 쓰는 구글 계정으로 로그인.
2. [프로젝트 만들기] → 이름 `web2-phone`(아무 이름 가능) → [계속] → "Google 애널리틱스 사용"은 **끔** → [프로젝트 만들기] → [계속].
3. 프로젝트 첫 화면에서 안드로이드 모양 아이콘(앱 추가) → "Android 패키지 이름"에 `kr.or.kptu.work` 입력 → "디버그 서명 인증서 SHA-1" 칸에는 💻 PC 세션이 알려 주는 값(서명 키 만든 뒤)을 넣는다 → [앱 등록].
4. "google-services.json 다운로드" 화면이 나오면 **받기만** 하고 저장소·채팅에 올리지 않는다. 💻 PC 세션이 그 파일에서 값 4개를 읽어 GitHub 변수로 등록하고, 끝나면 파일을 지운다. [다음] → [다음] → [콘솔로 이동].
5. 왼쪽 위 톱니바퀴 → [프로젝트 설정] → [서비스 계정] 탭 → [새 비공개 키 생성] → [키 생성] → JSON 파일이 내려받아진다.
6. Supabase 대시보드 → 이 프로젝트 → [Edge Functions] → [Secrets] → [Add new secret] → 이름 `FCM_SERVICE_ACCOUNT_JSON`, 값에 5번 파일 내용 전체 붙여 넣기 → [Save]. 그다음 5번 파일을 지운다(휴지통 비우기까지).
7. (API 키 제한) Firebase [프로젝트 설정] → [일반] → 웹 API 키 옆 "Google Cloud Console에서 관리"(또는 `console.cloud.google.com` → [API 및 서비스] → [사용자 인증 정보]) → "Android key" 또는 자동 생성 키 → [애플리케이션 제한사항]에서 [Android 앱] → 패키지 `kr.or.kptu.work` + 3번 SHA-1 → [저장].
8. 앱 새 판 설치 뒤 폰에서 웹2 → 내 프로필 → 폰 알림 → [시험 알림] → "알림 허용" 물으면 [허용].

## 8. 위험

| 위험 | 대응 |
| --- | --- |
| 알림 내용이 구글 서버를 거침 | 짧은 제목만 싣고 본문·첨부·연락처는 싣지 않음. 잠금 화면 비공개(N-D4) |
| 서비스 계정 키 유출 시 남이 내 폰에 알림을 보낼 수 있음 | Supabase 비밀값에만, 파일은 바로 삭제. 유출 의심 시 Firebase에서 키 삭제·새로 만들기 |
| 예약 지연·누락(GitHub) | 15분 확인 + 묶음은 "뒤"로 표현. 같은 날 같은 알림 중복은 `app_push_log`로 막음 |
| 수집 멈춤 알림이 너무 자주 | 멈춤 시작 때 한 번, 풀렸다 다시 멈출 때만 다시 |
| 홈 수집 칸과 알림 판단이 어긋남 | 공용 기준 모듈 하나(2절) |
| 갤럭시 배터리 절약이 앱을 재움 | FCM 우선순위 "높음"은 즉시 알림 4종만. 묶음은 보통. 갤럭시 [배터리] → 앱 "제한 없음"을 명진 확인 항목에 넣음 |
| 구글 개발자 인증 정책(상위 설계 위험) | 알림과 무관. 상위 설계 그대로 |
| 옛 금지 검사를 넓게 풀어 옛 구조가 다시 들어옴 | 허용 위치를 파일 단위로 못 박고 옛 이름은 계속 금지(5절) |
| Google Tasks 연결이 끊김(재연결 필요) | 할 일 알림만 건너뛰고 저녁 묶음에 "할 일 연결 다시 필요" 한 줄 |

## 9. 명진 결정 필요

"ㅇ"이면 모두 추천안으로 진행한다.

| # | 질문 | 추천 |
| --- | --- | --- |
| N-D1 | 알림은 구글 Firebase(무료)로 새 웹2 앱에 보낼까요? | **예.** 갤럭시에서 확실히 받는 표준 길 |
| N-D2 | 할 일 기한 알림은 그날 아침 8시, 원장 약속은 전날 저녁 6시에 보낼까요? | **예.** 구글 할 일에는 시각이 없어 시각을 정해야 한다 |
| N-D3 | 조용한 시간(밤 10시~아침 7시)에 생긴 알림은 아침에 한 개로 모아 보낼까요? | **예.** 버리지 않고 모은다 |
| N-D4 | 잠금 화면에서는 알림 내용을 숨길까요? | **예.** "웹2 · 새 알림"만 보이고 잠금을 풀면 제목이 보인다 |
| N-D5 | 알림 설정은 내 프로필에 작은 줄로 둘까요? (종류별 켜기/끄기, 조용한 시간, 시험 알림) | **예** |
| N-D6 | 옛 알림이 다시 들어오지 못하게 막던 검사를, "새 알림 파일 몇 개만 허용"으로 좁게 바꿀까요? | **예.** 옛 알림 이름·웹 푸시는 계속 막는다 |
| N-D7 | 옛 서버 함수 이름(`push-notifications`)은 다시 쓰지 않고 새 이름(`phone-push`)으로 만들까요? | **예** |

## 10. 범위 밖 발견사항 (고치지 않음)

1. `supabase/functions/push-notifications/`(410 코드)는 운영에서 삭제됐는데 저장소에는 남아 있다. 테스트 모의 응답 2곳(`tests/app-e2e/accessibility-ux.spec.mjs`, `design-system.spec.mjs`)이 이 이름을 쓴다(env6b 문서 3절). 폴더 정리는 별도 판단.
2. 상위 설계 `phone-app-v2.md` 0절·3절 ④·D9의 "알림 보류" 문장은 이 결정으로 낡았다(원장 반영 때 갱신).

## 부록. 읽은 파일

요청함 [10/29 01:28] 4건(폰 알림, 오늘한줄초안, 회의 녹음 초안, 다음 주 준비), `docs/design/phone-app-v2.md`, `docs/design/next-week-sheet.md` 2·4·5절, `docs/web2-env6b-edge-source.md`, `.github/workflows/{collaboration-ownership-check,drive-summary-refresh}.yml`, `supabase/functions/push-notifications/index.ts`, `supabase/functions/collector-feed/handler.ts`(비밀값 비교 방식), `supabase/functions/google-tasks/index.ts`(action), `app/collection-status.js`, `supabase/migrations/20261029014500_journal_ai_drafts.sql`, `…/20261023180000_profile_view_prefs.sql`, `android-app/README.md`, PR #1414 본문.
