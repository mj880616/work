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

## MENU-자리나머지(S61-15)에서 고친 곳

#2472에서 남긴 9곳을 같은 공용 `keepMenus`로 끝냈다(app/anchored-menu.js는 고치지 않음). 시험: tests/app-e2e/menu-follow-rest-a·b·c.spec.mjs, 사진: docs/design/screens/s61-15/.

| 화면 | 그리기 주인 | 칸 표시 | 다시 그리는 길 | 메뉴 쪽 손질 |
| --- | --- | --- | --- | --- |
| 업무 기록 창 기록·잊지 말기 기록 | workplace-detail.js wdRenderUpdates·wdPatchLinks(root=#wdUpdates) | data-wd-up-menu, data-basket-link-menu | 기록 창 바뀜 알림·첨부 이름 바뀜 | basket-link-records.js `linkMenuFollower` 내보냄 |
| 할 일 줄 메뉴(일지·연결 할 일·달력 칸) | journal.js renderTasks, google-tasks.js renderLinked(root=그 목록), calendar-month-view.js render | data-journal-task-menu, data-gt-linked-more, data-calendar-task(-menu) | 할 일 바뀜 알림·다른 할 일 저장 | task-inline.js `menuFollower`(새 칸에도 같은 할 일 id를 적음 — 칸 기준 WeakMap 문제) |
| 사업 보고 창 후속 할 일 | meeting-round-detail.js mrdRenderTasks(root=#mrdTasks) | data-mrd-task-menu | 할 일 바뀜 알림 | 전에는 다시 그릴 때 메뉴를 닫았다 → 따라감 |
| 창 밖 사업 보고 메뉴(달력·사진·그날 창) | team.js renderMeetings, report-calendar-actions.js showReportDayWindow(구역 #calendarDayList / #meetingList) | data-mrd-meeting | 사업 보고 다시 읽기·그날 창 다시 채우기 | meeting-round-detail.js `outsideMenu`(mrdOutside.trigger도 새 줄로 — 메뉴 주인 판단 유지) |
| 통합 검색 결과 | global-search.js paintAll(구역 .gs-panel / #searchView) | data-gs-key | 다시 찾기·자료 바뀜 알림 | — |
| 원문 메뉴(지금 상세) | now-detail.js paint·paintBody(root=상세 칸) | data-nd-ob-more | 원문 읽기 끝·번역·같은 글 다시 열기 | — |
| 참고 묶음 | reference-bundles.js paint | data-rb-item-more, data-rb-detail-more, data-rb-list-more | 연결 바뀜 알림 | — |
| 가족 기억할 것 줄 | family-remind.js paint(root=그 칸) | data-fam-more | 가족 기억 바뀜 알림 | family-remind-menu.js `remindMenuFollower`(메뉴 ctx.row도 새 줄로) |
| 사업영역 줄(전체 사업) | project-system-v3.js renderGrid(구역 .ps3-plist / #ps3DetailPane) | data-ps3-project | 목록 다시 그리기 | — |

E2E가 없는 곳: 달력 칸 안 할 일 우클릭(#calendarTaskMenu)은 같은 task-inline `menuFollower`를 쓰지만 화면 시험은 일지·연결 할 일 두 곳으로 대신했다. 사업영역 줄 폰 길게 누르기는 PC 우클릭과 같은 다시 그리기 길이라 PC 시험으로 대신했다.

## 아직 남은 곳

| 화면 | 그리기 주인 | 칸 표시 | 남긴 이유 |
| --- | --- | --- | --- |
| 위치만 튀는 곳(실행은 됨, actDetached) | team.js renderGoogleControls(캘린더 색), list-edit 부르는 곳, text-highlights paintMarks, team.js redrawReportPlans(⋯ 경로) | data-google-cal, data-le-menu, data-hl-id, data-rv-plan-more | 실행 문제 없음, 자리만 |

## 해당 없음·이미 막음

- 목록 밖 고정 버튼: forget 보기 메뉴, HWP 편집, 원드라이브 링크, News 머리, 사진 막대, 공유 페이지 추가, 조직 보고 머리, 사업 보고 더 보기, 위 [추가], 다음 주 날짜.
- 이미 막음: 할 일(google-tasks taskRenderPending), 진행 기록(paintRecords 열림 중 건너뜀), 정리함 업데이트 메뉴(basket keepRowMenu), 달력 우클릭·지금 줄·그날 칸(누른 자리 `at` + actDetached).
- 다시 그리기 없음: 자주 가는 링크(수정 중엔 안 그림), 회의 후속 할 일 초안.
