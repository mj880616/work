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
| 12 | 전체 검색 결과 → 업데이트·노트·자료실 문서·할 일 | request…Open + openFrom | 🔧✅ | 🔧✅ | S56-14: 고치기 전 main에서 E2E로 재현(폰 412 기록 칸 2개, PC 1280 뒤로 한 번 뒤에도 업데이트 화면 — 둘 다 사실). 지금 E2E source-open-back-rest(업데이트, 상세를 늦게 읽어도 한 칸). 노트·자료실 문서·할 일은 같은 길(겹이 그 칸을 씀)로 ❓ |
| 13 | 전체 검색 결과 → 조직·회의·일정 | openFrom + 창 | 🔧❓ | 🔧❓ | 폰 창(.modal)도 그 칸을 씀(mobile-modal-history → 라우터 adoptSourceWindow). 조직 창은 19번 E2E로 같은 길 확인 |
| 14 | 원장 근거 ‹원문› → 통화 | ledger-browse.js → source-open.js | 🔧❓ | 🔧❓ | 1과 같은 길 |
| 15 | 원장 근거 ‹원문› → 업데이트·조직·회의 | openFrom(12·13과 같음) | 🔧❓ | 🔧❓ | 12·13과 같은 길 |
| 16 | 홈(업무일지) 원본 열기·다음 주 준비 줄 | journal.js goView → openFrom | 🔧❓ | 🔧❓ | S56-14: 화면 이동은 openFrom 한 길(할 일·원장 약속 상세가 그 칸을 씀). 뒤로 돌아올 때 스크롤은 라우터 기억 하나만 씀(홈 자체 스크롤 되돌리기는 기록 없이 ‹로 홈에 올 때만 남김). 보던 날·초점 되돌리기는 홈이 그대로 함 |
| 17 | 담당조직 전체 표 [기록 열기]·[↗] | org-overview.js openOrg + flashRecord | ❓ | ❓ | 같은 화면 안 열기(화면 안 이동) |
| 18 | 사업 보고 참고 줄 | app/team.js(S56-13이 고치는 중) | ❓ | ❓ | S56-14도 손대지 않음 — 바꿀 줄: team.js의 go(…)+show 호출부를 `KPTURouter.openFrom(view, open)`으로(라우터는 준비됨) |
| 19 | 연락 없는 조직 줄 → 조직 | org-quiet.js openFrom('team', open) | 🔧✅ | ✅ | S56-14: 고치기 전 main에서 폰 412 기록 칸 2개로 재현(사실), PC 1280은 그때도 한 번(창에 기록 없음). 지금 E2E 412·1280 한 번 + 같은 스크롤. 폰 창 ×도 홈으로 한 번 |
| 20 | 알림(바깥 소식) 눌러 열기 | notice-outside.js go('outside') | ✅❓ | ✅❓ | 화면 이동 한 칸 |
| 21 | 할 일 출처(업데이트) | google-tasks.js requestBasketNote + openFrom('basket') | 🔧❓ | 🔧❓ | 12와 같은 길 |
| 22 | 일정 연결(일정 창 → 기록) | calendar-* | ❓ | ❓ | 이번에 보지 못함 |

## S56-14에서 바꾼 것
- 라우터 `openFrom`(app-router.js): 기록 칸을 open()이 끝날 때 거두지 않고, 도착 화면이 처음 여는 겹(layer) 또는 폰 창(.modal)이 가져갈 때까지, 사람이 처음 누르거나 키를 칠 때까지, 기록 칸·화면이 바뀔 때까지 내준다(시간 재기 없음). 자료를 읽은 뒤 여는 상세도 같은 칸.
- 폰 창(mobile-modal-history.js)은 새 칸을 쓰기 전에 라우터 `adoptSourceWindow`에 묻는다. 그 칸을 가져가면 뒤로 한 번 = 창 닫기 + 원래 화면, 창 ×도 원래 화면으로(통화 원문 ‹와 같은 규칙).
- 호출부를 openFrom 한 길로: 전체 검색(global-search.js)·원장 근거(ledger-browse.js)·할 일 출처(google-tasks.js)·연락 없는 조직(org-quiet.js)·홈 원본 열기(journal.js goView). 화면별 예외 코드 없음.
- 홈 돌아오기: 뒤로가기 스크롤은 라우터 기억 하나만(홈 자체 scrollTo는 기록 없는 ‹(router back의 source 'back')에만). 보던 주·날과 초점은 그대로 홈이 지킨다.

## 남은 고침(다음 작업 제안)
- 18: team.js(사업 보고) 참고 줄을 openFrom으로(S56-13 merge 뒤).
- 7·8·13 PC: PC 창은 기록이 없어 브라우저 뒤로가 창을 닫지 않을 수 있음(❓). PC도 창에 기록을 둘지는 화면 결정 필요.
- 원문으로 바로 연 통화 상세의 '‹ 통화' 글자: 누르면 원래 화면으로 가므로 글자를 원래 화면 이름으로.
- 실기기(폰 앱 웹뷰·삼성 인터넷) 확인은 명진 폰에서.
