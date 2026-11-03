# 로딩 표시 자리 전수 조사 (UI-로딩자리전수, S49-15 A, 2026-11-03)

명진 요청(11/03 10:37): "pc버전 로딩 모션 뜨는 위치 전수조사 후 개선". 캡처는 PC [파일] 화면 — 회색 로딩 막대가 오른쪽 아래 빈 곳 한가운데, '맞추는 중' 흐린 글자가 왼쪽 위, 목록 칸은 아직 불러오는 중인데 '최근 없음', 위쪽 '바뀐 날' 줄이 폭 가득 빈 상자.

## 규칙 (한 곳)

1. 로딩 표시는 **불러오는 그 칸의 맨 위, 칸 폭 가득 얇은 막대 한 줄**이다. 화면 한가운데·칸 안 구석에 뜨지 않는다. 화면 전체를 처음 불러올 때는 머리줄 바로 아래 한 줄(기존 앱 시작 규칙 = `loader-v2.js` `barHtml()`).
2. 공용 부품은 `app/wait-state.js` 하나다(새로 만들지 않음): 칸 목록 자리 = `waitHtml`(막대 + 실제 줄 높이 회색 빈 줄), 막대만 = `barHtml`, 글줄 안 한 칸(건수·한 줄 요약·상태 줄) = `waitInlineHtml`. 모양·자리는 `base-ui.css`의 `.wait`(칸 폭 가득, 0.4초 안에 끝나면 안 보임).
3. 불러오는 동안에는 '없음'·'최근 없음'·'빈 폴더' 같은 빈 결과 글을 그리지 않는다. 다 읽은 뒤에만 그린다.
4. 막대와 중복되는 두 번째 로딩 글자('맞추는 중' 등)는 없다.

## 이번에 고친 곳 (전 → 후)

| 화면 | 칸 | 전(지금 자리·문제) | 후 |
| --- | --- | --- | --- |
| 파일 | 목록 칸 | 목록을 맞추는 중(처음 색인 중)이면 결과가 비어 '최근 없음'·'빈 폴더'가 뜸 | 맞추는 동안은 목록 칸 맨 위 막대(+회색 줄), 끝난 뒤에만 '없음' |
| 파일 | 위쪽 줄 | [맞추기] 버튼 글자가 '맞추는 중'·'목록 맞추는 중'으로 바뀜(두 번째 로딩 글자) | 글자는 그대로('n분 전 맞춤'/'맞추기'), 맞추는 동안 비활성 + 목록 칸 맨 위 가는 줄 하나 |
| 파일 | 미리보기 칸 | 받는 중 짧은 회색 막대가 칸 가운데쯤에 뜸(`waitInlineHtml`) | 미리보기 칸 맨 위 폭 가득 막대(`barHtml`) |
| 파일 | 정렬 | 정렬 상자('바뀐 날')가 PC에서 굵은 테두리 상자로 보임 | PC에서 작은 칩(테두리 없는 연한 바탕·높이 24px) |
| 설정 | 챙길 것 규칙 · 폰 알림 | 칸 가운데 작은 회색 막대(`waitInlineHtml`) | 칸 맨 위 폭 가득 막대(`barHtml`) |
| 공통 | `.wait` | 부모가 가운데 정렬이면 막대가 칸 안에 떠 있을 수 있음 | `width:100%`·`align-self/justify-self:stretch`(글줄 안 한 칸만 예외) |

## 전수 표 (자동 수집: `node scripts/ops/loading-audit.mjs --md`)

앱 화면 파일마다 로딩 표시(waitHtml·waitEl·showWait·waitInline·barHtml)와 빈 결과 글(emptyHtml·emptyEl·showEmpty) 수를 센다. 빈 결과 글 앞 25줄 안에 로딩·상태 확인 낱말이 없으면 '로딩 확인 없는 빈 결과 글'로 올렸고, 아래 8개 파일 11곳을 눈으로 검토했다: 모두 읽은 뒤에만 부르는 그리기 함수(달력 날짜 목록 비움·노트 붙이기 목록·회의 3칸 등)로, 호출하는 쪽이 기다림·실패를 먼저 처리한다. 이 검토 끝 개수를 `tests/wait-state.test.mjs` 기준표로 묶어 두어 늘면 CI가 실패한다.

글줄 안 한 칸용 `waitInlineHtml`은 상태 줄·건수 자리 약 40곳에서 그대로 둔다(칸 맨 위가 아니라 글줄 안이 맞는 자리).

| 화면(파일) | 로딩 표시 수 | 빈 결과 글 수 | 로딩 확인 없는 빈 결과 글 | 판정 |
| --- | --- | --- | --- | --- |
| 아스날 `arsenal.js` | 1 | 1 | - | 맞음 |
|  `basket-manual-link.js` | 1 | 0 | - | 맞음 |
| 노트 `basket-notes.js` | 1 | 4 | - | 맞음 |
| 정리함 `basket.js` | 2 | 0 | - | 맞음 |
|  `business-area-fields.js` | 1 | 0 | - | 맞음 |
|  `calendar-day-items.js` | 1 | 1 | - | 맞음 |
|  `calendar-day-overflow.js` | 1 | 1 | - | 맞음 |
|  `calendar-list-view.js` | 1 | 0 | - | 맞음 |
|  `calendar-tasks.js` | 0 | 1 | 81 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
| 통화 `call-feed.js` | 2 | 4 | - | 맞음 |
|  `choice-sheet.js` | 0 | 1 | - | 맞음 |
|  `data-freshness.js` | 1 | 0 | - | 맞음 |
| 일기 목록 `diary-list.js` | 2 | 1 | - | 맞음 |
| 일기 `diary.js` | 4 | 3 | - | 맞음 |
|  `document-category-editor.js` | 1 | 0 | - | 맞음 |
| 파일 `files.js` | 6 | 3 | - | 맞음 |
| 전체 검색 `global-search.js` | 3 | 1 | - | 맞음 |
| 할 일 `google-tasks.js` | 6 | 5 | 113 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
|  `home-quick.js` | 1 | 0 | - | 맞음 |
|  `html-frame.js` | 1 | 0 | - | 맞음 |
| 정리함 챙길 것 `inbox-todos.js` | 2 | 1 | - | 맞음 |
|  `journal-hwpx.js` | 3 | 0 | - | 맞음 |
| 업무일지 주간 `journal-weekly.js` | 3 | 4 | - | 맞음 |
| 홈 업무일지(하루) `journal.js` | 6 | 4 | - | 맞음 |
| 원장 `ledger-browse.js` | 6 | 5 | - | 맞음 |
|  `ledger-merge.js` | 1 | 0 | - | 맞음 |
|  `library-folders.js` | 0 | 1 | 413 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
|  `library-html-view.js` | 1 | 0 | - | 맞음 |
|  `library-move-picker.js` | 0 | 1 | - | 맞음 |
|  `loader-v2.js` | 1 | 0 | - | 맞음 |
| 사업 보고 3칸 `meeting-columns.js` | 0 | 2 | 79, 103 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
| 사업 보고 상세 `meeting-round-detail.js` | 2 | 2 | - | 맞음 |
|  `meeting-todo-candidates.js` | 1 | 0 | - | 맞음 |
|  `meeting-transcript-draft.js` | 1 | 0 | - | 맞음 |
|  `news-clipping.js` | 6 | 4 | - | 맞음 |
|  `note-boards.js` | 0 | 2 | 78 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
|  `now-detail.js` | 2 | 0 | - | 맞음 |
|  `now-interests.js` | 1 | 1 | - | 맞음 |
|  `now-saved.js` | 1 | 1 | - | 맞음 |
|  `od-settings.js` | 3 | 2 | - | 맞음 |
|  `org-dispute-stage-ui.js` | 2 | 0 | - | 맞음 |
| 담당조직 핵심 인물 `org-key-people.js` | 1 | 3 | - | 맞음 |
| 담당조직 개요 `org-overview.js` | 1 | 1 | - | 맞음 |
|  `org-status-table.js` | 1 | 1 | - | 맞음 |
| Now 검색 `outside-search.js` | 3 | 2 | - | 맞음 |
| Now(바깥 성명) `outside-statements.js` | 6 | 5 | - | 맞음 |
| 설정(폰 알림) `phone-push-settings.js` | 1 | 0 | - | 맞음 |
|  `phone-reopen.js` | 1 | 0 | - | 맞음 |
|  `photo-info-edit.js` | 1 | 0 | - | 맞음 |
|  `photo-share.js` | 1 | 0 | - | 맞음 |
| 사진 정리 `photo-tidy.js` | 1 | 0 | - | 맞음 |
| 사진 `photos.js` | 17 | 5 | - | 맞음 |
|  `pick-fold.mjs` | 0 | 2 | - | 맞음 |
|  `pre-meeting-sheet.js` | 1 | 0 | - | 맞음 |
|  `prep-sheet-view.js` | 1 | 1 | - | 맞음 |
|  `press-draft.js` | 2 | 1 | - | 맞음 |
| 사업 영역 상세 `project-system-v3.js` | 3 | 4 | 316 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
|  `quick-links.js` | 1 | 2 | - | 맞음 |
|  `record-sheet.js` | 0 | 1 | - | 맞음 |
|  `reference-bundles.js` | 1 | 2 | - | 맞음 |
|  `release-notes-ui.js` | 1 | 1 | - | 맞음 |
|  `report-summary-preview.js` | 0 | 2 | - | 맞음 |
| 사업 보고 달력·사진 `report-views.js` | 0 | 3 | 32, 33, 41 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
|  `share-ai-draft.js` | 2 | 1 | - | 맞음 |
|  `share-html.js` | 1 | 0 | - | 맞음 |
| 공유 페이지 `share-pages.js` | 5 | 2 | - | 맞음 |
|  `task-files.js` | 0 | 1 | - | 맞음 |
|  `task-workflow.js` | 0 | 1 | - | 맞음 |
| 담당조직·사업 보고 `team.js` | 1 | 3 | 252 | 그리기 함수(호출한 쪽이 읽은 뒤에만 부름) 검토 끝 |
| 텔레그램 소식 `telegram-feed.js` | 5 | 7 | - | 맞음 |
| 사진(시간대) `time-photos.js` | 1 | 0 | - | 맞음 |
|  `weekly-detail-lines.js` | 0 | 1 | - | 맞음 |
|  `weekly-discuss-table.js` | 1 | 1 | - | 맞음 |
|  `weekly-flow-cells.js` | 2 | 1 | - | 맞음 |
|  `weekly-hand-lines.js` | 1 | 0 | - | 맞음 |
|  `weekly-hq-schedule.js` | 1 | 1 | - | 맞음 |
|  `weekly-learn-panel.js` | 0 | 1 | - | 맞음 |
|  `workflow-ai-v3.js` | 1 | 0 | - | 맞음 |
| 담당조직 상세 `workplace-detail.js` | 2 | 5 | - | 맞음 |

## 폰
폰도 같은 부품·같은 규칙이다(`.wait`는 PC·폰 공통). 폰 [파일]의 최근 탭도 위 규칙을 따른다(코드 경로가 같음). 실기기에서 봐야 할 것은 PR 마감 보고의 확인 방법에 적었다.

## 재발 막기 (CI)
- `tests/wait-state.test.mjs`: 자리 규칙 CSS, 칸 자리에 글줄용 막대 금지(파일·설정), [파일] '맞추는 중' 금지·맞추는 동안 빈 결과 글 금지, 전수 도구 기준표.
- `tests/app-e2e/loading-place.spec.mjs`: 느린 응답(목록 1.5초 지연) 흉내로 PC 1440·1920에서 [파일] 로딩 줄이 목록 칸 맨 위·폭 가득, '없음'·'맞추는 중' 글자 없음, 다 읽으면 목록.
