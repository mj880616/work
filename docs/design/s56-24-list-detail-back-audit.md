# S56-24 '목록 → 본문' 뒤로가기 전수 표 (CALL-상세뒤로가기)

기준(명진 11/10 14:08): 목록에서 눌러 본문(상세)으로 들어갔을 때 뒤로가기 한 번 = 그 목록, 모든 곳에서.
폰 = 안드로이드 앱 뒤로(`KPTUNativeBack` → `KPTURouter.back()`)·삼성 인터넷 뒤로·화면 ‹. PC = 브라우저 뒤로·위 줄 ‹(`KPTURouter.back()`).
앞 표: `docs/design/s56-10-back-audit.md`(다른 화면에서 연 원문·상세). 이 표는 그 표에 빠져 있던 '같은 화면 목록에서 바로 들어간 기본 길'과 '새로고침 뒤' 칸을 더한다.

표시: ✅ 목록으로 한 번에(근거 E2E) · 🔧 이번에 고침 · ❓ 코드로만 봄(실기기·E2E 없음).

## 원인(이번 건)

- 사실(E2E로 재현, 고치기 전 main): 폰 통화 상세를 연 뒤 **화면을 다시 열면**(당겨서 새로고침, 폰 앱이 화면을 다시 엶, 새 버전 새로고침, bfcache 복귀) 안드로이드 뒤로·위 줄 ‹(`KPTURouter.back()`)이 개인 통화 목록 대신 **홈**으로 갔다. 개인 통화 목록에서 새로고침한 뒤 상세를 열면 첫 뒤로는 목록, 두 번째 뒤로가 업무 통화 목록 대신 홈이었다.
- 까닭(사실): 라우터가 '이 문서가 처음 열린 기록 칸'(`baseIndex`)을 Web2의 첫 기록으로 보고, 그 아래로는 가지 않고 홈으로 바꿨다. 새로고침하면 새 문서가 지금 칸에서 시작하므로 그 아래의 목록 칸(같은 Web2 주소)이 '앱 밖'으로 취급됐다. 브라우저 자체 뒤로는 그 칸으로 갔기 때문에 기존 E2E(`page.goBack`)는 통과했다.
- 고침(공용 한 곳, `app/app-router.js`): Web2의 첫 기록 = 지금 칸 아래로 **같은 출처·같은 앱 경로**가 끊기지 않고 이어지는 가장 아래 칸. 로그인 화면(`login/`)·다른 사이트에서 끊긴다. `back()`·`canBack()`이 같은 규칙을 쓴다. 화면마다 따로 고치지 않았다.
- 추정: 명진이 이번에 겪은 길이 정확히 새로고침·앱 다시 열기였는지는 모름. 새로고침 없는 기본 길(목록 → 상세 → 뒤로, 전문 펼침·⋯ 메뉴·이름 수정·제목 바꾸기·요약 복사 뒤)은 고치기 전 main에서도 E2E로 목록이 나왔다(재현 안 됨). 실기기에서 새로고침 없이도 홈으로 간다면 그 길을 알려 주면 다시 본다.

## 표 — 같은 화면 목록 → 상세(폰)

| # | 화면 | 상세 여는 길(폰) | 기본 길 뒤로 | 새로고침·앱 다시 열기 뒤 뒤로 | 근거 |
|---|---|---|---|---|---|
| 1 | 통화(업무) | router layer `call-detail` | ✅ 목록 | 🔧 목록 | E2E call-detail-back(390·344), call-personal-box |
| 2 | 통화(개인 통화함) | layer `call-box` + `call-detail` | ✅ 개인 목록 → 업무 목록 | 🔧 개인 목록 → 업무 목록 | E2E call-detail-back(목록·상세에서 새로고침, 주소로 바로 열기) |
| 3 | 텔레그램 소식(방·날) | layer `telegram-room`·`telegram-day` | ✅ 목록 | 🔧 공용 고침(라우터) ❓ | E2E tg-room-day(뒤로가기는 목록) |
| 4 | 할 일 | 상세 칸 layer `task-detail` | ✅ 목록 | 🔧 공용 고침 ❓ | E2E task-screen-cleanup·todo-fold-split-detail |
| 5 | 노트(폴더 → 노트) | layer `basket-note-folder`·`basket-notedoc` | ✅ 노트 목록 → 폴더 목록 | 🔧 공용 고침(브라우저 뒤로는 E2E ✅) | E2E basket-note-folder·refresh-same-place(노트) |
| 6 | 정리함 업데이트 | layer `basket-note` | ✅ 목록 | 🔧 공용 고침(브라우저 뒤로 E2E ✅) | E2E basket-notes·refresh-same-place(정리함) |
| 7 | 담당조직(조직 보고) → 조직 상세 | 폰 창 `#wdModal`(mobile-modal-history) | ✅ 목록 | 🔧 공용 고침 ❓ | E2E organization-pc-split·source-open-back-rest(조직) |
| 8 | 사업 보고 → 회의 상세 | 창(.modal, mobile-modal-history) | ✅ 목록 | 🔧 공용 고침 ❓ | E2E report-kinds·project-pc-split |
| 9 | 참고 묶음 | layer `reference-bundle` | ✅ 목록 | 🔧 공용 고침 ❓ | E2E reference-bundles(폰 390 뒤로 한 칸 = 목록) |
| 10 | 사진(폴더·앨범·날) | layer `photos-folder`·`photos-album`·`photos-day` | ✅ 목록 | 🔧 공용 고침 ❓ | E2E photos-folders·photos-album-line |
| 11 | 자료실(폴더) | layer `library-folder` | ✅ 상위 목록 | 🔧 공용 고침(브라우저 뒤로 E2E ✅) | E2E library-folder-explorer·refresh-same-place(자료실) |
| 12 | 아스날(경기 리뷰) | layer `arsenal-review` | ✅ 목록 | 🔧 공용 고침 ❓ | E2E arsenal-view |
| 13 | News(글 상세) | layer `now-detail` | ✅ 목록 | 🔧 공용 고침 ❓ | E2E now-detail·news-detail |
| 14 | 일기(날) | layer `diary-day` | ✅ 달력 | 🔧 공용 고침 ❓ | E2E diary |
| 15 | 파일(폴더·미리보기) | layer `files-list`·`files-preview` | ✅ 목록 | 🔧 공용 고침 ❓ | E2E files-explorer·files-focus-pinch-back |

'🔧 공용 고침 ❓': 새로고침 뒤 라우터 뒤로가 앞 칸(목록)으로 가는 규칙은 화면과 상관없이 같은 한 곳이라 고쳐졌다. 그 화면이 새로고침 뒤 상세를 그대로 다시 여는지(주소 `PLACE_PARAMS`)와 돌아간 목록 모양은 화면마다 다르며, E2E는 통화(라우터 뒤로)와 노트·정리함·자료실(브라우저 뒤로)만 있다.

## 다른 화면에서 들어온 길(통화)

| 길 | 뒤로 한 번 | 근거 |
|---|---|---|
| 잊지 말기 소식(통화) | 원래 화면(잊지 말기) | S56-10 표 1번, E2E forget-source-back |
| 조직 주요 인물 통화 줄 | 원래 화면 | S56-10 표 10번(source-open.js) |
| 전체 검색·원장 근거 | 원래 화면 | S56-10 표 11·14번 |
| 새로고침·앱 다시 열기(주소 `?view=calls&box=personal&call=`) | 🔧 개인 목록 → 업무 목록 | E2E call-detail-back |
| 폰 알림 | 지금 통화를 여는 폰 알림 없음(S56-25가 다루는 중) | — |

다른 화면에서 연 통화는 #2283·#2289의 규칙(뒤로 한 번 = 눌렀던 원래 화면·같은 자리)을 그대로 둔다. 지시서 ①의 '어느 길로 열었든 통화 목록'과 다르므로 PR에 결정 사항으로 남겼다.
