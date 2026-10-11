# UI-한국시간 검토 자료

📱 폰 가능 — Codex 웹. 시작 origin/main `74e54ae6043bc0dcf5f285d624ea22b8f16dbd61`(새 fetch로 확인, #496 포함). 브랜치 `codex/ui-seoul-time`. [PR #498](https://github.com/mj880616/work/pull/498). 최종 SHA·자동 CI 결과는 PR 완료보고 댓글에 기록한다.

2026-10-11 사용자 결정대로 Web2의 날짜·일시를 Asia/Seoul 기준으로 표시하고 입력한다. `meeting-time.js`를 확장했으며 기존 회의 함수는 같은 공용 구현의 별칭이다. 새 공용 모듈은 만들지 않았다. 날짜만 있는 종일 일정과 Google 할 일 기한은 날짜 문자열의 의미를 유지한다.

## 원인과 저장 계약

사실: 기존 월간 렌더러는 일시의 `getDate/getHours`와 기기 자정으로 날짜 칸·시간·오늘·조회 범위를 계산했다. 일정 등록·수정과 프로젝트 주요 일정은 시간대 없는 입력 문자열을 `new Date(value)`로 해석했다. Rome에서 한국 10월 1일 00:10이 달력의 “오늘 9월 30일”이 되는 E2E 실패를 수정 전에 재현했다. 한국 00:30 입력의 UTC가 Rome에서 `22:30Z`, LA에서 `07:30Z`로 나오는 Node 실패도 재현했다.

서버 소스 확인: `google-calendar`는 `start_iso/end_iso`를 Google dateTime에 그대로 넣고, 종일 `start_date/end_date`는 기존대로 종료일을 하루 더해 배타적 종료일로 만든다. 프로젝트 주요 일정의 `start_at`도 기존 UTC ISO 형식을 유지한다. 따라서 클라이언트에서 한국 입력에 `+09:00`을 명시하면 서버 변경 없이 왕복 가능하다. `00:30` → 전날 `15:30Z`, `23:30` → 같은 날 `14:30Z`다. 기존 DB 행과 과거 잘못 저장된 일시는 재해석하거나 이동하지 않는다.

## 전수 조사표

조사: `app/`의 JS·HTML에서 Date 생성, 로컬 getter/setter, Date.parse, Intl/locale formatter, ISO 날짜 자르기, datetime-local/date/time 입력과 값 변환을 검색하고 활성 로더·사용처를 확인했다. 단순 UTC 현재 시각 기록·절대 경과 시간·정렬은 날짜 칸을 정하는 경로와 구별했다.

| 파일 | 함수·경로 | 용도 | 수정 여부·판정 |
| --- | --- | --- | --- |
| `app/meeting-time.js` | `seoulParts/DateKey/Date/DayStart/addSeoulDays/Clock/InputValue/toSeoulISO/formatSeoulTime` | 한국 날짜·요일·일시·입력·날짜 이동 공통 구현 | 확장. 기존 회의 API 유지, 입력 실제 달력 값 검증, formatter 재사용 |
| `app/calendar-month-view.js` | `key/dateOnly/dayStart/visibleRange/inclusiveEnd/segmentWeeks/timeLabel/dayEvents/render` | 월 배치·요일·오늘·범위·시간·종일·연속 일정·날짜 목록 | 수정. 한국 자정의 실제 일시로 계산, 자정 종료 배타성 유지, 잘못된 종료값 필터 유지 |
| `app/calendar-day-items.js` | `calendarDateKey/dayItems/appendDayRows/weekBands` | 목록·주간 날짜와 시간·연속 일정 | 수정. 월 렌더러와 같은 일시 사용, 기기 wall-date 복제 제거 |
| `app/calendar-view.js` | `today/thisWeek/range/render/move` | 오늘·주/목록 범위·제목·이동·페이지 추가 | 수정. 한국 월·일과 고정 일수 이동 |
| `app/calendar-list-view.js` | `renderList` | 일별 날짜·요일·오늘 | 수정 |
| `app/calendar-week-view.js` | `renderWeek` | 주간 날짜·요일·접근성 이름·날짜 배치 | 수정 |
| `app/calendar-day-overflow.js` | `taskDate/eventRow/open` | 날짜 목록 제목·일정 시각·할 일 날짜 | 수정 |
| `app/calendar-persistence.js` | `cpRange` | 월 조회·초기 fallback 범위 | 수정. 실제 한국 자정의 UTC 범위 전달 |
| `app/calendar-plus.js` | `cmForm/cmSaveGoogle` | 일정 새 입력 → UTC | 수정. 한국 입력 고정, 종일 날짜 API 그대로 |
| `app/calendar-interactions-v2.js` | `ciLocal/ciParts/ciMinusDay/ciSaveGoogle/ciClickedDate/ciCreateAt` | 수정 역변환·저장·종일 종료일·칸 눌러 만들기 | 수정 |
| `app/team.js` | `monthCursor/dateKey/todayKey/renderCalendar/moveMonth/openEventModal` | 초기 월·오늘·월 이동·새 일정 기본값 | 수정 |
| `app/team.js` | `saveMeeting/renderMeetings/meetingLabel` | 회의 일시 저장·표시 | 기존 한국 공용 구현 유지, import 버전만 갱신 |
| `app/project-system-v3.js` | `fmt/date/localInput/milestoneVisibleBody` | 주요 일정·기록 표시와 입력·수정 | 수정. UTC ISO와 Google 연동 저장 구조 그대로 |
| `app/project-system-v3.js` | `day/openCreate/openProgress/saveQuickProgress` | 현재 연도·시작일·진척 기준일 기본값 | 수정. 한국 오늘 사용 |
| `app/project-system-v3.js` | `decisions` | 결정과 회의 기록 날짜·시간 | 한국 공용 `fmt` 적용. 현재 상세 본문에서 호출되지 않는 렌더러, 다시 연결하지 않음. 격리 브라우저 렌더러 검사 |
| `app/project-system-v3.js` | `milestoneGoogleBody/overview/renderDetail/loadListSummaries` | UTC 연동·정렬·조회·D-day | 기존 절대 일시 연산 유지. dayKey는 공용 도구로 위임 |
| `app/home-read-model.js` | `dayKey/ranges/milestoneChips/todayEvents/dueTasks/weekUpdates` | 홈 한국 오늘·주·D-day·일정/기한 필터 | 이미 한국 고정. 날짜·요일 계산만 같은 공용 도구로 위임 |
| `app/home-read.js` | 일정 시각·조회 범위·보고 날짜 | 홈 표시/조회 | 이미 Asia/Seoul. 의존 캐시만 갱신 |
| `app/home-read-cache.js`, `app/home-quick.js` | dayKey/ranges 사용 | 홈 캐시 날짜·빠른 입력 | 공용 dayKey의 캐시 전파만 |
| `app/workplace-detail.js` | `wdRender/wdRenderUpdates/wdRenderItems/wdOpenTime` | 담당조직 수정 시각·기록·메모·연도 기본값 | 수정 |
| `app/google-tasks.js` | `dueDateKey/due` | 할 일 날짜 검증·날짜와 요일 표시 | 검증은 UTC 달력, 표시는 한국 공용 도구. Google 날짜 부분 그대로 |
| `app/meeting-round-detail.js` | `mrdDueDateValue/mrdStartEdit/mrdSaveEdit` | 후속 기한 fallback·회의 수정 | fallback만 한국 날짜. 기존 한국 회의 변환 유지 |
| `app/due-date-calendar.js` | `dateOnly` | 기한 입력의 문자열 날짜·fallback | ISO 날짜 부분 보존, Date fallback만 한국 고정 |
| `app/calendar-tasks.js` | `rows`, `dueDateKey` 사용 | 달력 할 일 배치·기한 지남 | 날짜 문자열 그대로, 이미 한국 dayKey. 수정 없음 |
| `app/suborganizations.js` | 최신 업데이트 날짜 | 조직 목록 최근 기록 | 이미 +09:00 고정. workplace 의존 캐시만 갱신 |
| `app/view-loader.js` | 홈 날짜 제목 | 홈 오늘 날짜·요일 | 이미 Asia/Seoul. 하위 의존 캐시 전파 |
| `app/basket.js` | `time` | 바구니 기록 날짜·시각 | 이미 Asia/Seoul. 수정 없음 |
| `app/basket-ai-handoff.js` | `buildHandoffText/readHandoff` | 외부 AI 전달의 한국 오늘 | 이미 +09:00 고정. 수정 없음 |
| `app/basket-classification.js` | 일시 검증 | 분류 결과 timestamp 검사 | UTC getter/setter와 명시 offset 검사. 수정 없음 |
| `app/drive-summary.js` | `showResult` | 요약 생성 시각 | 이미 Asia/Seoul. 범위 밖, 수정 없음 |
| `app/workflow-ai-v3.js` | `dueIso/classifyNewMeeting` | 은퇴 AI 초안 일시 변환 | 기존 한국 고정. 미로딩 유지, 공용 import 캐시만 변경 |
| `app/task-layout.js` | `due/dateValue/payload` | 은퇴 Web2 할 일 표시·입력 | 로컬 시간대 코드 잔존. 활성 로더에서 제외됨, 범위 밖 기록만 |
| `app/home-dashboard-v2.js` | `dt/dateLabel` | 은퇴 홈 날짜 표시 | 로컬 시간대 코드 잔존. 활성 로더에서 제외됨, 범위 밖 기록만 |
| `app/app.js`, `auth-service.js`, `runtime-client.js` | 로그·세션 만료·재시도 | UTC 기록·경과시간 | 날짜 칸/입력 변환 아님. 기능 수정 없음 |
| `app/workplace-report.js`, `profile-settings.js`, `library-upload.js`, `basket-data.js` 등 | `new Date().toISOString`, timestamp 정렬 | 수정·완료 시각 기록과 절대시간 비교 | 올바른 UTC 저장. 변경 없음 |
| `app/legacy/editable-page.js` | 백업 저장 시각 | Web1 legacy 기록 | UTC 저장, Web2 범위 밖. 수정 없음 |

## 검증

- 시작 main Node: **513/513 통과**. 신규 테스트는 수정 전에 실패를 확인했다.
- 전체 Node 명령: `node --test tests/*.test.mjs tests/domain/*.test.mjs tests/security/*.test.mjs scripts/*.test.mjs`. **520/520 통과**(서버 접속 없이 실행 가능한 전체 Node 단위·도메인·보안·scripts).
- 신규 E2E **18/18 통과**: `ui-seoul-time.spec.mjs`, 기기 Asia/Seoul·Europe/Rome·America/Los_Angeles × 390/1280px. 날짜 칸·오늘·요일·00:30/23:30·종일·월 경계·자정 배타적 종료·정확한 월/주/목록 조회 범위·새 저장/재열기/수정 왕복·프로젝트 주요 일정/기록/오늘·회의·홈. 외부 요청 전부 합성 응답으로 처리, 정상 흐름 console/pageerror 0을 각 테스트에서 요구.
- 전체 Chromium 회귀 대상 **1,190건**. 최종 SHA의 전체 실행 결과와 실패 재현 여부는 [PR #498 Checks](https://github.com/mj880616/work/pull/498/checks)와 완료보고 댓글에 기록한다. 기존 테스트 삭제·약화 없음. classic-script fixture는 활성 앱과 같은 module 로딩으로 맞췄다.
- 자동 CI는 PR 이벤트로 실행되는 검사만 확인한다. workflow 수동 실행 없음. 최종 SHA 전체 브라우저 결과 확인 전에는 완료로 보고하지 않는다.
- smoke inline 블록 **13/13 통과**, JavaScript 문법·로컬 HTTP 자산 포함. 캐시 검사 `node scripts/check-loader-cache.mjs --base 74e54ae6043bc0dcf5f285d624ea22b8f16dbd61`: **423 참조 통과**. 공백 검사 통과.
- 독립 리뷰에서 잘못된 종료값 필터의 예외를 발견해 실패 테스트 → 수정 → 통과를 확인했다. 날짜 문자열이 잘못된 경우도 포함한다. 범위 mock과 월/주/목록 끝값·자정 종료 검증을 강화했다.
- 새 E2E를 실제 보기 버튼 선택으로 바꾼 뒤 준비 전 클릭 3건 실패를 확인했다. 앱 모듈 준비·선택 상태를 기다리고 월 DOM으로 조회 범위를 한정해 최신 재실행 18/18 통과했다. 앱 기능이나 기존 검사를 약화하지 않았다.

## 전후 캡처

설치 Chromium, Europe/Rome, 동일 합성 데이터와 고정 시각 `2026-09-30T15:10:00Z`(한국 10/1 00:10), 390×900·1280×900. before는 시작 main 별도 archive 정적 서버, after는 작업 파일 서버다. 운영 요청 없음. 전후 두 폭 모두 console/pageerror **0**([전390](before/errors-390.json), [전1280](before/errors-1280.json), [후390](after/errors-390.json), [후1280](after/errors-1280.json)). 캡처 스크립트: `node docs/review/ui-seoul-time/capture.mjs before http://127.0.0.1:8125`, 같은 명령의 `after http://127.0.0.1:8123`.

| 화면 | 390px 전 / 후 | 1280px 전 / 후 |
| --- | --- | --- |
| 월 달력 | [전](before/month-390.png) / [후](after/month-390.png) | [전](before/month-1280.png) / [후](after/month-1280.png) |
| 날짜 목록 | [전](before/list-390.png) / [후](after/list-390.png) | [전](before/list-1280.png) / [후](after/list-1280.png) |
| 주간 | 해당 없음 | [전](before/week-1280.png) / [후](after/week-1280.png) |
| 새 일정 | [전](before/new-event-390.png) / [후](after/new-event-390.png) | [전](before/new-event-1280.png) / [후](after/new-event-1280.png) |
| 일정 수정 | [전](before/edit-event-390.png) / [후](after/edit-event-390.png) | [전](before/edit-event-1280.png) / [후](after/edit-event-1280.png) |
| 프로젝트 | [전](before/project-390.png) / [후](after/project-390.png) | [전](before/project-1280.png) / [후](after/project-1280.png) |
| 주요 일정 입력 | [전](before/milestone-input-390.png) / [후](after/milestone-input-390.png) | [전](before/milestone-input-1280.png) / [후](after/milestone-input-1280.png) |
| 회의 | [전](before/meetings-390.png) / [후](after/meetings-390.png) | [전](before/meetings-1280.png) / [후](after/meetings-1280.png) |
| 홈 | [전](before/home-390.png) / [후](after/home-390.png) | [전](before/home-1280.png) / [후](after/home-1280.png) |

## 캐시와 경계

캐시 최종값: meeting-time2, home-read-model2, calendar-day-items4, calendar-list-view5, calendar-week-view4, calendar-month-view22, calendar-view7, calendar-plus12, calendar-interactions19, calendar-day-overflow10, calendar-persistence17, team68, project-system44, meeting-round-detail26, google-tasks31, due-date-calendar2, workplace-detail16, suborganizations17, home-read17, home-read-cache2, home-quick9, view-loader124, loader-v2 357, app245 → index.html. 버전 기대 테스트·app-smoke-check·담당조직/조직 상세 static 검사 고정 문자열을 같은 값으로 맞췄다. 초기 자동 CI의 저장소 감사는 새 E2E의 직접 보기 설정이 승인 목록 밖이어서 실패했다. 감사 규칙 변경 없이 실제 보기 버튼을 눌러 설정하도록 테스트를 수정했다. 조직 관련 두 검사도 옛 캐시 고정값 때문에 실패해 기대값만 갱신했다. 은퇴 AI 모듈은 로더 참조가 없어 자체 상위 버전이 없다.

인증 게이트·API 엔드포인트·권한 검사·저장 필드·DB·RLS·Edge·drive-summary·서버·기존 데이터 변경 없음. 운영 접속·workflow 수동 실행·merge 없음. 한국 시간 고정은 이후 UI 입력에 적용되며 과거 기기 시간대로 잘못 저장한 행을 자동 교정하지 않는다. 복구는 이 파일 변경 PR을 되돌리는 파일 PR이며 DB 복구는 없다.

사용자 폰 확인: **이탈리아에서 달력 9/15 본부 집행위가 15일 칸 “오전 10:00”으로 보이는지, 새 일정 하나 입력 후 다시 열어 같은 시각인지.** 달력의 기존 24시간 숫자 표기는 유지되어 같은 한국 오전 시간이 `10:00`으로 보인다. 프로젝트·회의의 기존 오전/오후 표기도 유지한다.
