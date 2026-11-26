# 한 영역 한 렌더러 점검 (S71-74 UI-덮어쓰기땜질없애기, 2026-11-26)

사용자 요청(2026-11-26 23:39): 폰 하단바 [노트]를 누르면 화면이 깜빡이고, 옛 화면 위를 현재 화면이 덮어쓴다. 이 화면만이 아니라 땜질식 덮어쓰기는 안 된다.
규칙: AGENTS.md 5절. 한 화면 영역에는 상태 주인 하나와 최종 그리는 곳 하나만 둔다. 늦은 덮어쓰기, 넓은 MutationObserver, display:none 땜질은 쓰지 않는다.

지키는 장치는 둘이다.

- 동작 시험 `tests/app-e2e/layout-settle.spec.mjs`
  - 공용 도구는 `tests/app-e2e/helpers/layout-settle.mjs`의 `measureSettle`이다.
  - 화면을 열 때 최종 보이기 직후 첫 그림과 1.5초 뒤 그림을 비교한다. 서버 흉내는 0.7초 늦게 답한다.
  - 처음 열 때와 다른 화면에 갔다가 다시 열 때 모두, 두 그림에 있는 줄의 위치가 같아야 한다.
  - 아래 동작 표에서 고친 화면은 이 시험의 화면 표에 더한다.
- 정적 검사 `tests/patch-patterns.mjs`
  - 기준표는 `tests/patch-patterns-baseline.json`이다. CI의 App smoke check가 돌린다.
  - 세는 것: 넓은 MutationObserver(document·body를 subtree로 지켜봄), `display:none!important`, `:has(…)`로 고른 요소를 `display:none`으로 가리는 규칙.
  - 파일별 개수가 기준표보다 늘면 실패한다. 고쳐서 줄면 기준표도 줄인다.

## 1. 노트 탭: 사실로 확인한 원인

모든 시각은 [노트]를 누른 때부터 잰 것이다. 서버 응답은 약 0.9초가 걸렸다.

| 시각 | 무엇이 | 어디서 |
| --- | --- | --- |
| 0 | 라우터가 노트 화면을 보인다. 그 전에 그린 목록(최근 상자·폴더)이 그대로 남아 있다. | `basket.js` → `basket-notes.js` `show()` |
| 0(같은 틱) | 서버를 다시 읽기 시작하면서 목록 위 상태 줄 `[data-note-list-status]`에 `waitInlineHtml()`을 넣는다(글줄 기다림 '…'). 이 한 글자가 블록 칸 안의 한 줄(약 25px)을 차지한다. | `basket-notes.js` `refresh()` |
| 0.4초 | `.wait`의 늦은 표시가 끝나 '…' 줄이 보인다. 머리 줄 아래 왼쪽에 '⋯'처럼 보이는 줄이 생기고, 최근 상자와 폴더 목록이 그만큼 아래로 밀린다(사용자가 본 첫 장면). | `base-ui.css` `.wait.wait-inline::after` |
| 약 0.9~2초 | 다 읽은 뒤 `renderList()`가 상태 줄을 비운다(`status.innerHTML=''`). 줄이 없어지고 목록이 위로 올라붙는다(두 번째 장면). | `basket-notes.js` `renderList()` |

- 처음 생긴 커밋
  - #610(2026-10-17, MEMO-노트 PR 3): '불러오는 중…' 글자 줄로 시작했다.
  - #1447(2026-10-29, UI-기다림표시통일 1차): 글자가 '…' 한 글자로 바뀌었다.
- 고침(이 PR)
  - 이미 그린 목록이 있으면 목록 위에 줄을 두지 않는다. 그린 목록은 그대로 두고, 기다림은 높이 0인 `barHtml()`로 화면 맨 위 막대에만 알린다.
  - 처음 읽을 때는 목록 자리에 회색 빈 줄(`waitHtml`)을 둔다. 다 읽으면 그 자리에 목록을 한 번 그린다.
  - 숨김이나 늦은 덮어쓰기는 쓰지 않았다.
- 시험: `layout-settle.spec.mjs`의 '노트 390/1280'. 고치기 전에는 4개가 모두 실패했고(다시 열 때 dy=-25), 고친 뒤에는 통과한다.

## 2. 앱 전체 정적 조사 (app/ 전체, 판 번호 폴더·vendor·legacy 제외)

| 번호 | 종류 | 파일:줄 | 무엇을 | 왜 생겼나 | 고치는 방법 | 크기 | 처리 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 넓은 감시·고침 | `due-date-calendar.js:63,71` | 문서 전체를 지켜보다가 '기한' input의 type을 date로 바꾸고 `!important` 스타일을 주입한다. | 2026-09-12 할 일 기한 달력 | 기한 칸을 그리는 화면이 처음부터 `type=date`로 그린다. 이 파일은 지운다. | 중간 | 다음 PR ① |
| 2 | 넓은 감시·옮기기 | `date-field.js:87-89`(옮기기 66) | body 전체를 지켜보다가 남이 그린 `input[type=date]`를 span으로 감싸 옮긴다. | 2026-10-29 #1408 UI-버튼통일 | 날짜 칸을 그리는 모듈이 `enhanceDateInput()`을 직접 부른다. 감시는 없앤다. | 큼 | 다음 PR ① |
| 3 | 넓은 감시·속성 | `mobile-modal-history.js:65` | 새 `.modal`마다 감시를 붙이고 history와 속성을 쓴다. | 2026-09-13 모바일 팝업 뒤로가기 | 창을 여닫는 공용 함수에서 sync를 부른다. | 중간 | 다음 PR ② |
| 4 | 옮기기 | `screen-tools.js:22,25` | 화면이 그린 단추 묶음(`#reportTop`·`#soTeamTools`)을 머리 줄로 옮기고, 화면을 떠나면 되돌린다. | 2026-11-25 S70-53 | 머리 줄 칸이 등록받아 직접 그린다. `screen-find.js` toolsBox와 하나로 합친다. | 중간 | 다음 PR ③(열린 #3202 뒤) |
| 5 | 옮기기 | `library-upload.js:167` | `index.html`에 그린 `.lu-head-actions`를 toolsBox로 옮긴다. | 2026-11-26 S70-54 ② | 마크업을 index.html에서 빼고 toolsBox 안에 처음부터 그린다. | 작음 | 다음 PR ③(같은 영역 #3202·#3194가 열려 있어 뒤로 미룸) |
| 6 | 옮기기 | `project-system-v3.js:1050,397` | `index.html`의 `#newProjectBtn`을 두 곳에서 각각 옮긴다. | 2026-09-15, 09-28 | 툴바를 그리는 함수 하나가 단추를 만든다. | 작음 | 다음 PR ④ |
| 7 | 덧칠·두 주인 | `team.js:603` → `calendar-persistence.js:80` | 칩 줄을 team.js가 그린 뒤 `cpDecorate()`가 덧칠한다. 고른 상태가 두 곳에 있다. | 2026-09-16 | 칩 줄 주인을 하나로 정한다. | 중간 | 다음 PR ⑤ |
| 8 | 두 렌더러 | `team.js:172` ↔ `library-upload.js:357` | `#documentList`를 두 파일이 그린다(team.js는 옛 대체용). | 2026-09-25 | team.js의 대체 그리기를 지운다. | 작음 | 다음 PR ⑤ |
| 9 | 두 렌더러 | `team.js:621,623` ↔ `calendar-plus.js:38` | `#eventStatus`를 두 파일이 그린다. | 2026-10-29 | 상태 줄 함수를 하나로 모은다. | 작음 | 다음 PR ⑤ |
| 10 | 두 렌더러 | `calendar-tasks.js:87` ↔ `calendar-day-overflow.js:63` | 그날 창 목록을 지운 뒤 '일정 없음'을 다시 쓴다. | 2026-10-29 #1521 | 빈 상태 그리기를 overflow 쪽 함수 하나로 모은다. | 작음 | 다음 PR ⑤ |
| 11 | 두 렌더러 | `basket-manual-link.js:416,452` ↔ `basket.js` | 정리함 상태 줄을 두 모듈이 쓴다. | 2026-10-14 | basket.js의 say()를 부른다. | 작음 | 다음 PR ⑥ |
| 12 | 같은 모듈 시간차 | `suborganizations.js:103-110` | 그린 조직 줄에 단계 꼬리표를 나중에 지웠다가 다시 끼운다. | 2026-10-24 | 단계 자료를 줄 그리기에 넘겨 한 번에 그린다. | 작음 | 다음 PR ⑥ |
| 13 | 죽은 숨김 | `suborganizations.css:7` | 아무도 그리지 않는 요소 3개를 `!important`로 숨겼다. | 2026-09-23 기능 삭제를 숨김으로 대신함 | 규칙을 지운다. | 작음 | **이 PR에서 지움** |
| 14 | 죽은 숨김 | `workspace-ui.css:5-6` | 없는 `#taskAssignee`·`#personalTaskNote`를 숨겼다. | 2026-09-12 | 지운다. | 작음 | **이 PR에서 지움** |
| 15 | 죽은 숨김 | `base-ui.css:56` | 없는 `#authView`를 숨겼다. | 2026-09-15 | 지운다. smoke 검사는 '요소가 되살아나지 않음'으로 바꿨다. | 작음 | **이 PR에서 지움** |
| 16 | 죽은 숨김 | `task-layout.css:2` | 없는 `#tasksView>.toolbar`를 숨겼다. | 2026-09-15 | 지운다. | 작음 | **이 PR에서 지움** |
| 17 | 죽은 숨김 | `static-gates.css:1`(+ 운영에서 안 부르는 `myspace-return.js`) | 없는 `#myspaceView`를 숨겼다. | 2026-09-19 | 시험 fixture와 함께 지운다. | 작음 | 다음 PR ⑥ |
| 18 | `:has`로 남의 요소 숨김 | `ui-standard.css:672,889` · `basket.css:191` · `feed.css:184-185` · `hwp-lab.css:38` · `topbar-actions.css:85` | 각 화면 CSS가 셸이 가진 앱 머리 줄을 `html:has(#…View …)`로 숨긴다. | 2026-10-30 등 | 머리 줄 주인(셸)이 '이 화면은 머리 줄 접음' 속성 하나를 받아 숨긴다. | 중간 | 다음 PR ⑦ |

같은 종류인 넓은 감시 중 읽기만 하는 것도 있다. `select-menu.js:288`과 `meeting-name-panel.js:324`는 열린 목록을 닫기만 하고 고치지는 않는다. 그래도 기준표에는 넣었다.

## 3. 화면 전수 동작 조사 (폰 390 · PC 1280, 느린 서버 0.7초, 처음 열기 / 다시 열기)

| 화면 | 390 | 1280 | 원인(2번 표와 연결) | 처리 |
| --- | --- | --- | --- | --- |
| 노트 | 다시 열 때 목록 25px 위로 | 같음 | 1절: 상태 줄 '…' | **이 PR** |
| 할 일 | 이동 없음 | 처음 열 때 목록 58px 밀림 | 입력칸을 늦은 `import()`로 그려, 목록이 보인 뒤에 위에 끼어들었다. | **이 PR**(`google-tasks.js` 정적 불러오기) |
| 할 일(남음) | – | 4번 중 1번: 입력칸 12px, 목록 40px 위로 | 목록이 0개인 첫 그림에서 입력칸 여백이 바뀐다(입력칸 모양 클래스가 늦게 붙는 것으로 추정). | 다음 PR ⑧ |
| 일정(달력 목록) | 처음 열 때 날짜 묶음 79~165px, 다시 열 때 4px | 처음 열 때 시간 축 48px, 다시 열 때 8px | 처음 열 때는 기다림 회색 줄 높이가 실제 줄과 다르다. 다시 열 때는 목록 위 한 칸이 4~8px 줄어든다. 일정 칩 줄은 2번 표 7번(두 주인)과 같은 영역이다. | 다음 PR ⑤ |
| 사업 관리 | 다시 열 때 목록 132px 위로 | 171px 위로 | 다시 열 때 '이번 주 주간 보고' 칸이 표 모양 자리(4줄 뼈대)로 돌아갔다가 진짜 표로 바뀐다. 칸 상자를 다시 만드는 것으로 추정된다(`weekly-summary-table.js` drawPaper·`team.js` syncWeekBox). | 다음 PR ⑨ |
| 잊지 말기 | 5px 위로 | 이동 없음 | 기다림 줄과 '없음' 줄의 높이가 다르다. | 다음 PR ⑥ |
| 파일 | 처음 열 때 나무 63px 밀림 | 같음 | 가져올 곳 칩 줄이 늦게 위에 끼어든다. | 다음 PR ⑩ |
| 읽을 거리 | 처음 열 때 4px | 같음 | 기다림 줄과 '새 글 없음'의 높이가 다르다. | 다음 PR ⑩ |
| 홈·조직 관리·브리핑 룸·자료실·저장한 글·통화·텔레그램·사진·아스날·내 프로필·쓰는 법·하루 기록(PC) | 이동 없음 | 이동 없음 | – | 시험 표에 넣음 |

## 4. 다음 PR 제안 (CC가 줄 세움)

| PR | 묶음 | 파일 | 완료 기준 |
| --- | --- | --- | --- |
| ① | 날짜 칸 넓은 감시 없애기 | `date-field.js`, `due-date-calendar.js`, 날짜 칸을 그리는 화면들 | 두 파일에 넓은 감시가 없고, 기준표 broadObserver가 2 줄어든다. 날짜 칸 E2E가 통과한다. |
| ② | 창 뒤로가기 감시 없애기 | `mobile-modal-history.js`, `accessibility-dialog.js` | 넓은 감시가 0이다. 뒤로가기로 창이 닫히는 E2E가 통과한다. |
| ③ | 화면 단추 자리 하나로 | `screen-tools.js`, `screen-find.js`, `library-upload.js`, `index.html` | 옮기기 없이 자리 칸이 직접 그린다. #3202 뒤로 줄 세운다. |
| ④ | 사업영역 관리 단추 | `project-system-v3.js`, `index.html` | `#newProjectBtn`을 만드는 곳이 하나다. |
| ⑤ | 일정 두 주인 | `team.js`, `calendar-persistence.js`, `calendar-plus.js`, `calendar-tasks.js`, `calendar-day-overflow.js`, `library-upload.js` | 칩 줄·상태 줄·그날 목록의 그리는 곳이 하나씩이다. 일정을 `layout-settle` 표에 더한다. |
| ⑥ | 작은 정리 | `basket-manual-link.js`, `suborganizations.js`, `static-gates.css`, `myspace-return.js`, 잊지 말기 기다림 줄 | 잊지 말기를 `layout-settle` 표에 더한다. |
| ⑦ | 머리 줄 숨김 주인 | 셸(`topbar-actions.js`·`app-router.js`) + 18번 CSS들 | `:has` 숨김이 기준표에서 줄어든다. |
| ⑧ | 할 일 PC 입력칸 모양 | `google-tasks.js`, `home-quick.js`, `ui-standard.css` | 할 일 1280을 `layout-settle` 표에 더한다. |
| ⑨ | 사업 관리 다시 열기 | `weekly-summary-table.js`, `team.js` | 다시 열 때 주간 칸이 뼈대로 돌아가지 않는다. 사업 관리를 표에 더한다. |
| ⑩ | 파일·읽을 거리 첫 그림 | `files.js`, `outside-statements.js` | 칩 줄과 '없음' 줄을 처음부터 그 자리에 그린다. 두 화면을 표에 더한다. |
