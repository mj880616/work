# S56-10 뒤로가기 전수 점검 표 (FORGET-원문열기·뒤로가기 ③)

기준: '눌러 가기 → 뒤로가기 한 번 → 원래 화면·같은 자리'. 폰 = 안드로이드 앱 뒤로(`KPTURouter.back()`)·삼성 인터넷 뒤로·화면 ‹, PC = 브라우저 뒤로·상단 줄 ‹.
공용 길: `KPTURouter.openFrom`(app-router.js) + 원문 열기 한 곳 `app/source-open.js`(통화·텔레그램). 스크롤 자리는 라우터가 화면을 옮길 때 기록 칸마다 기억(메모리)하고 뒤로 돌아오면 되돌린다(PR-1부터 모든 화면 전환에 적용).

표시: ✅ 한 번에 돌아옴(근거 적음) · 🔧 이번에 고침 · ⚠ 아직 두 번 또는 자리 다름(다음 작업) · ❓ 코드로만 봤고 실기기·E2E 확인 없음.

| # | 어디서 → 무엇을 | 여는 코드 | 폰 | PC | 근거 |
|---|---|---|---|---|---|
| 1 | 잊지 말기 소식(통화) → 통화 원문 | forget-news-data.js → source-open.js | 🔧✅ | 🔧✅ | E2E forget-source-back(412·1280, 같은 거르기·스크롤·줄) |
| 2 | 잊지 말기 소식(텔레그램) → 그 방·날 | 같은 곳 | 🔧❓ | 🔧❓ | 1과 같은 길(텔레그램 날 상세도 router layer) |
| 3 | 잊지 말기 텔레그램 요청 → 그 방·날 | todo-radar.js openSource → source-open.js | 🔧❓ | 🔧❓ | 같은 길 |
| 4 | 잊지 말기 출처 꼬리표 › | notice-box.mjs data-nbx-open | 🔧✅ | 🔧✅ | 내용 버튼과 같은 길(E2E 1번이 › 로 엶) |
| 5 | 잊지 말기 업데이트 줄 → 업데이트 상세 | basket.js openDetail(layer) | ✅ | ✅ | 같은 화면 layer, back-closes-top E2E |
| 6 | 잊지 말기 챙길 것(업데이트·노트 출처) → 상세 | todo-radar.js requestBasketNote + go('basket') | ✅❓ | ✅❓ | 같은 화면이라 layer 한 칸. 보기는 PR-1부터 그대로 |
| 7 | 잊지 말기 챙길 것(회의) → 회의 상세 창 | KPTUMeetingRoundDetail.open | ✅❓ | ❓ | 폰은 창 기록 1칸(mobile-modal-history). PC 창은 기록 없음 — 브라우저 뒤로가 창을 닫지 않을 수 있음 |
| 8 | 잊지 말기 챙길 것(조직 기록) → 조직 상세 | KPTUWorkplace.open | ✅❓ | ❓ | 폰 #wdModal 창 1칸. PC는 화면을 옮기지 않고 엶 |
| 9 | 잊지 말기 가족 줄 | — | 원문 없음(› 없음) | 같음 | 요청대로 |
| 10 | 조직 상세 [주요 인물] 통화·텔레그램 줄 | org-key-people.js → source-open.js | 🔧❓ | 🔧❓ | 1과 같은 길. 폰은 조직 상세가 창이라 돌아오면 창은 닫혀 있을 수 있음 ⚠ |
| 11 | 전체 검색 결과 → 통화·텔레그램 | global-search.js → source-open.js | 🔧❓ | 🔧❓ | 같은 길 |
| 12 | 전체 검색 결과 → 업데이트·노트·자료실 문서·할 일 | request…Open + go | ⚠ | ⚠❓ | 도착 화면 훅이 상세를 layer로 따로 엶 → 폰 뒤로 두 번(추정). 다음 작업: openFrom이 '다음 layer'를 기다리게 |
| 13 | 전체 검색 결과 → 조직·회의·일정 | go + 창 | ⚠❓ | ❓ | 폰: 화면 칸 + 창 칸 = 두 번(추정) |
| 14 | 원장 근거 ‹원문› → 통화 | ledger-browse.js → source-open.js | 🔧❓ | 🔧❓ | 1과 같은 길 |
| 15 | 원장 근거 ‹원문› → 업데이트·조직·회의 | 12·13과 같음 | ⚠❓ | ❓ | 12·13과 같음 |
| 16 | 홈(업무일지) 원본 열기·다음 주 준비 줄 | journal.js rememberReturn·requestBasketNoteFrom | ✅❓ | ✅❓ | 화면 자체 돌아오기 길(스크롤·초점 기억)이 따로 있음 — 라우터 한 길로 합치기는 다음 작업 |
| 17 | 담당조직 전체 표 [기록 열기]·[↗] | org-overview.js openOrg + flashRecord | ❓ | ❓ | 같은 화면 안 열기(화면 안 이동) |
| 18 | 사업 보고 참고 줄 | app/team.js(다른 작업이 고치는 중) | ❓ | ❓ | 손대지 않음 — 이 작업 뒤 같은 길(openFrom)로 바꿀 줄: team.js의 go(…)+show 호출부 |
| 19 | 연락 없는 조직 줄 → 조직 | org-quiet.js go('team')+open | ⚠❓ | ❓ | 폰 화면 칸 + 창 칸(추정) |
| 20 | 알림(바깥 소식) 눌러 열기 | notice-outside.js go('outside') | ✅❓ | ✅❓ | 화면 이동 한 칸 |
| 21 | 할 일 출처(업데이트) | google-tasks.js requestBasketNote + go('basket') | ⚠❓ | ❓ | 12와 같음 |
| 22 | 일정 연결(일정 창 → 기록) | calendar-* | ❓ | ❓ | 이번에 보지 못함 |

## 남은 고침(다음 작업 제안)
- 12·13·15·19·21: `openFrom`이 도착 화면이 나중에(자료를 읽은 뒤) 여는 첫 layer·창(.modal 기록)도 같은 칸으로 받게 넓히기(라우터·mobile-modal-history 한 곳). 그 뒤 각 호출부를 openFrom으로.
- 16: journal.js 자체 돌아오기 길을 라우터 스크롤 기억으로 합치기(중복 제거).
- 원문으로 바로 연 통화 상세의 '‹ 통화' 글자: 누르면 원래 화면으로 가므로 글자를 원래 화면 이름으로.
- 실기기(폰 앱 웹뷰·삼성 인터넷) 확인은 명진 폰에서.
