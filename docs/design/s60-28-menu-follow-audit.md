# FILES-다시그리기메뉴자리 — ⋯ 메뉴 전수 표 (S60-28b, 2026-11-12)

문제: `createAnchoredMenu` 메뉴를 연 채 그 목록이 다시 그려지면(재조회·다른 화면 알림·비동기 읽기 끝) 메뉴를 연 칸이 화면에서 떨어진다.
그러면 메뉴 상자가 화면 왼쪽 위로 튀고(자리 계산이 떨어진 칸 기준), `actDetached`가 아닌 메뉴는 항목을 눌러도 실행되지 않는다.
공용 해결: 그리기 주인이 그리기 함수를 `keepMenus(menus, {attrs, zones, root}, paint)`(app/anchored-menu.js)로 감싼다. 그리기 전 칸 자리(표시 이름=값 + 구역)를 적고, 그린 뒤 같은 자리의 새 칸으로 `follow`, 없으면 닫는다. 공용 줄 메뉴(row-menu.js)는 `rowMenuFollower`를 넘긴다.
지연 덮어쓰기·MutationObserver·display:none은 쓰지 않는다.

## 이 PR에서 고친 곳

| 화면 | 그리기 주인 | 칸 표시 | 다시 그리는 길 |
| --- | --- | --- | --- |
| 자료실 | library-upload.js luRenderLibrary | (#2436에서 이미) | 저장 뒤 다시 읽기 등 |
| 파일 | files.js keepFxMenus(나무·칸 나무·칸 머리·목록·고르기 막대) | data-fx-tmenu 등, 구역에 data-fx-box 포함(같은 파일이 '최근'과 저장소 상자에 함께 있을 때 같은 상자 칸) | 주기 맞추기·보기 설정 받음 |
| 사진 | photos.js keepPhotoMenus | data-photos-fx-more 등 | 보기 설정 받음·폴더 다시 읽기 |
| 통화 | call-feed.js paintList·paintDetail | data-cf-rowmore, data-cf-more | 20초 재조회 |
| 텔레그램(메뉴 5개) | telegram-feed.js paintList·paintDetail | data-tg-rdmore·act-btn·more·head-more·person-more·folder-more, 구역 data-tg-swipe | 20초 재조회 |
| 일기 목록 | diary-list.js paint | data-diary-lv-more | 읽기 끝·고정/별표 저장 끝 |
| 잊지 말기 | forget-list.js paint | data-forget-more | 할 일·소식 바뀜 알림 |
| 챙길 것(사업 보고 창) | inbox-todos.js paint(root=그 목록) | data-inbox-todo-more | 할 일 레이더 바뀜 알림 |
| 뉴스 별표 폴더 | news-clipping.js paint | data-nc-folder-more | 자동 채우기 끝·읽음 표시 |
| 공유 페이지 | share-pages.js renderList | data-sp-row-menu, data-sp-box-menu | 공유 페이지 바뀜 알림 |

## 같은 문제지만 이 PR에서 고치지 않은 곳(다음 작업 후보)

| 화면 | 그리기 주인 | 칸 표시 | 남긴 이유 |
| --- | --- | --- | --- |
| 업무 기록 창 기록·잊지 말기 기록 | workplace-detail.js wdRenderUpdates·wdPatchLinks(outerHTML) | data-wd-up-menu, data-basket-link-menu | 메뉴 두 개가 다른 파일(basket-link-records.js)에 있어 함께 손봐야 함 |
| 할 일 줄 메뉴(일지·달력·연결 할 일) | task-inline.js를 부르는 journal·calendar-tasks·google-tasks renderLinked | data-journal-task-menu 등 | 메뉴 key가 칸 기준 WeakMap이라 follow 뒤 새 칸에 기록이 없음 — task-inline 구조 손질 필요 |
| 사업 보고 창 후속 할 일 | meeting-round-detail.js mrdRenderTasks | data-mrd-task-menu | 다음 작업 |
| 창 밖 사업 보고 메뉴 | team.js 사업 보고 목록·달력 | data-mrd-meeting | mrdOutside.trigger 동일성 판단도 함께 바꿔야 함 |
| 통합 검색 결과 | global-search.js paint | data-gs-key | 다음 작업 |
| 원문 메뉴(지금 상세) | now-detail.js paintBody·paint | data-nd-ob-more | 다음 작업 |
| 참고 묶음 | reference-bundles.js paintList·paintDetail | data-rb-item-more 등 | 다음 작업 |
| 가족 기억할 것 줄 | family-remind.js paint | data-fam-more | 메뉴 ctx.row도 옮겨야 함 |
| 사업영역 줄(전체 사업) | project-system-v3.js renderGrid | data-ps3-project | 다시 들어올 때 경합(약함) |
| 위치만 튀는 곳(실행은 됨, actDetached) | team.js renderGoogleControls(캘린더 색), list-edit 부르는 곳, text-highlights paintMarks, team.js redrawReportPlans(⋯ 경로) | data-google-cal, data-le-menu, data-hl-id, data-rv-plan-more | 실행 문제 없음, 자리만 |

## 해당 없음·이미 막음

- 목록 밖 고정 버튼: forget 보기 메뉴, HWP 편집, 원드라이브 링크, News 머리, 사진 막대, 공유 페이지 추가, 조직 보고 머리, 사업 보고 더 보기, 위 [추가], 다음 주 날짜.
- 이미 막음: 할 일(google-tasks taskRenderPending), 진행 기록(paintRecords 열림 중 건너뜀), 정리함 업데이트 메뉴(basket keepRowMenu), 달력 우클릭·지금 줄·그날 칸(누른 자리 `at` + actDetached).
- 다시 그리기 없음: 자주 가는 링크(수정 중엔 안 그림), 회의 후속 할 일 초안.
