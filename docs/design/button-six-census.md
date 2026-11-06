# UI-버튼6가지 전수 조사표 (S51-32, 2026-11-07 기준 main)

만든 방법: `tests/button-six-kinds.mjs` 검사기와 같은 기준으로 app/의 화면 코드에서 6가지 클래스가 없는 `<button>`을 하나씩 뽑고, 이름·속성으로 6가지 중 어디로 갈지 1차로 붙였다(화면별 정리 PR에서 실제 화면을 보고 확정). 코드에서 만드는 버튼(createElement)은 화면별 PR에서 더한다.

## 화면별 합계

| 화면 | 6가지 밖 버튼 | 화면 CSS 버튼 모양 선언 |
| --- | ---: | ---: |
| News(소식·통화) | 148 | 14 |
| 사업 보고 | 110 | 68 |
| 메뉴·머리줄·검색 | 110 | 19 |
| 담당조직 | 98 | 59 |
| 파일 | 88 | 8 |
| 사진 | 80 | 27 |
| 자료실 | 62 | 32 |
| 정리함 | 61 | 66 |
| 홈 | 55 | 70 |
| 노트 | 54 | 0 |
| 그 밖 | 53 | 38 |
| 할 일 | 48 | 25 |
| 일기 | 22 | 35 |
| 원장 | 21 | 6 |
| 공유 페이지 | 10 | 7 |
| 작은 창 | 7 | 53 |
| 일정 | 2 | 29 |
| 공용 파일 안 화면 규칙 | 0 | 234 |

## 버튼 하나씩 (화면 · 파일 · 버튼 · 지금 클래스 → 6가지 중 무엇)

| 화면 | 파일 | 버튼 | 지금 클래스 | → 6가지 |
| --- | --- | --- | --- | --- |
| 그 밖 | ai-usage-line.js | data-aiu-toggle | `aiu-open` | ② 작은 버튼 |
| 그 밖 | arsenal.js | data-ars-row | `ars-row` | ④ 칩 |
| 그 밖 | arsenal.js | ‹ 목록 | `ars-back` | ⑥ 아이콘 |
| 노트 | basket-ai-summary.js | — | `ai-summary-run…` | ③ 글자 버튼 |
| 노트 | basket-ai-summary.js | 이걸로 바꾸기 | `…` | ② 작은 버튼 |
| 노트 | basket-ai-summary.js | 제안 닫기 | `…` | ② 작은 버튼 |
| 정리함 | basket-link-records.js | 정리함 기록 메뉴 | `basket-link-more` | ⑥ 아이콘 |
| 정리함 | basket-link-records.js | 노트 열기 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-link-records.js | 연결 해제 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-link-records.js | 요약 수정 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-link-records.js | 업데이트 열기 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-link-records.js | 연결 해제 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-link-records.js | 요약 수정 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-link-records.js | 원문 삭제 | `basket-link-danger` | ② 작은 버튼(지우기 빨강) |
| 정리함 | basket-manual-link.js | 담당조직 고르기 ▾ | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket-manual-link.js | 사업영역 꼬리표 달기 ▾ | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket-manual-link.js | 참고 ▾ | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket-manual-link.js | 기록도 남기기 | `basket-manual-record-toggle` | ④ 칩 |
| 정리함 | basket-manual-link.js | data-manual-confirm | `quick-pill-primary` | ① 주 동작 또는 ② 작은 버튼 |
| 정리함 | basket-manual-link.js | ▾ | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket-manual-link.js | 오늘 | 클래스 없음 | ④ 칩 |
| 정리함 | basket-manual-link.js | 내일 | 클래스 없음 | ④ 칩 |
| 정리함 | basket-manual-link.js | 모레 | 클래스 없음 | ④ 칩 |
| 정리함 | basket-manual-link.js | data-manual-task-day | 클래스 없음 | ④ 칩 |
| 정리함 | basket-manual-link.js | data-manual-task-day | 클래스 없음 | ④ 칩 |
| 정리함 | basket-manual-link.js | 할 일 만들기 | `quick-pill-primary` | ① 주 동작 또는 ② 작은 버튼 |
| 정리함 | basket-note-tasks.js | data-basket-return | `basket-back basket-back-origin` | ② 작은 버튼 |
| 노트 | basket-notes.js | 폴더 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 노트 | basket-notes.js | 목록 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 노트 | basket-notes.js | 포스트잇 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 노트 | basket-notes.js | 태그 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 노트 | basket-notes.js | 댓글 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 노트 | basket-notes.js | 노트 목록 메뉴 | `basket-icon-button note-folder-more` | ⑥ 아이콘 |
| 노트 | basket-notes.js | 폴더로 옮기기 | `kptu-act` | ② 작은 버튼 |
| 노트 | basket-notes.js | 지우기 | `kptu-act kptu-act-danger` | ② 작은 버튼(지우기 빨강) |
| 노트 | basket-notes.js | 전체 고르기 | `kptu-act` | ② 작은 버튼 |
| 노트 | basket-notes.js | 선택 끝내기 | `nx-sel-close` | ⑥ 아이콘 |
| 노트 | basket-notes.js | 다시 시도 | 클래스 없음 | ③ 글자 버튼 |
| 노트 | basket-notes.js | + 새 폴더 | `nx-new-folder` | ② 작은 버튼 |
| 노트 | basket-notes.js | data-note-row-more | `basket-row-more` | ⑥ 아이콘 |
| 노트 | basket-notes.js | data-note-row | `basket-row note-row` | ④ 칩 |
| 노트 | basket-notes.js | 폴더 나무로 | `ft-btn ft-focus-back nx-back` | ⑥ 아이콘 |
| 노트 | basket-notes.js | data-nx-recent-more | `ft-btn ft-box-more` | ② 작은 버튼 |
| 노트 | basket-notes.js | # | `nt-chip` | ④ 칩 |
| 노트 | basket-notes.js | data-nt-kind | `nt-chip` | ④ 칩 |
| 노트 | basket-notes.js | data-nt-cm-open | `nt-cm-open` | ② 작은 버튼 |
| 노트 | basket-notes.js | — | `…` | ② 작은 버튼 |
| 노트 | basket-notes.js | # | `note-meta-tag` | ② 작은 버튼 |
| 노트 | basket-notes.js | 기사로 가기 | `note-meta-news` | ② 작은 버튼 |
| 노트 | basket-notes.js | data-note-file-more | `basket-icon-button note-file-more` | ⑥ 아이콘 |
| 노트 | basket-notes.js | 노트 목록으로 | `basket-back note-back` | ⑥ 아이콘 |
| 노트 | basket-notes.js | 복사 | `basket-icon-button` | ② 작은 버튼 |
| 노트 | basket-notes.js | 이 노트 메뉴 | `basket-icon-button basket-more-trigger` | ⑥ 아이콘 |
| 노트 | basket-notes.js | 노트 다시 불러오기 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-record-delete.js | 되돌리기 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket-upload.js | 파일 첨부 | `basket-clip` | ② 작은 버튼 |
| 정리함 | basket.js | 다시 찾기 | `inbox-find` | ③ 글자 버튼 |
| 정리함 | basket.js | 처리 전 | `inbox-chip` | ④ 칩 |
| 정리함 | basket.js | 보냄 | `inbox-chip` | ④ 칩 |
| 정리함 | basket.js | 이미 함 | `inbox-chip` | ④ 칩 |
| 정리함 | basket.js | 무시 | `inbox-chip` | ④ 칩 |
| 정리함 | basket.js | 미분류 | `quick-pill-button` | ② 작은 버튼 |
| 정리함 | basket.js | 분류 완료 | `quick-pill-button` | ② 작은 버튼 |
| 정리함 | basket.js | 보류 | `quick-pill-button` | ② 작은 버튼 |
| 정리함 | basket.js | 참고 묶음 화면 › | `quick-text-link basket-ref-open` | ⑥ 아이콘 |
| 정리함 | basket.js | 다시 시도 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket.js | data-basket-row-act | `…` | ③ 글자 버튼 |
| 정리함 | basket.js | 글자 읽기 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 상태 확인 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 읽은 글 반영 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 임시 문서 정리 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | data-basket-chip-open | `basket-chip-open` | ③ 글자 버튼 |
| 정리함 | basket.js | × | `basket-chip-x` | ⑥ 아이콘 |
| 정리함 | basket.js | ⋯ | `basket-row-more` | ⑥ 아이콘 |
| 정리함 | basket.js | data-basket-row | `basket-row` | ③ 글자 버튼 |
| 정리함 | basket.js | data-basket-file-download | `basket-file-link` | ③ 글자 버튼 |
| 정리함 | basket.js | data-basket-library-send | `basket-file-link` | ③ 글자 버튼 |
| 정리함 | basket.js | data-basket-hwp-edit | `basket-file-link` | ③ 글자 버튼 |
| 정리함 | basket.js | data-basket-photo | `basket-file-thumb` | ⑥ 아이콘 |
| 정리함 | basket.js | 할 일 화면에서 보기 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 정리함 목록으로 | `basket-back` | ⑥ 아이콘 |
| 정리함 | basket.js | 이 업데이트 메뉴 | `basket-more-trigger` | ⑥ 아이콘 |
| 정리함 | basket.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 보류로 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 일기로 보내기 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 삭제 | `basket-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 정리함 | basket.js | 원문 그대로 보기 | `basket-icon-button` | ④ 칩 |
| 정리함 | basket.js | 복사 | `basket-icon-button` | ② 작은 버튼 |
| 정리함 | basket.js | 첨부 저장 | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 정리함 | basket.js | 업데이트 다시 불러오기 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket.js | 연결하기 | 클래스 없음 | ③ 글자 버튼 |
| 정리함 | basket.js | 할 일 만들기 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 노트로 옮기기 | 클래스 없음 | ② 작은 버튼 |
| 정리함 | basket.js | 수정 저장 | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | business-area-fields.js | 사업영역 … | `biz-area-open` | ③ 글자 버튼 |
| 사업 보고 | business-area-fields.js | 할 일에 있음 | `biz-plan-open optional` | ③ 글자 버튼 |
| 사업 보고 | business-area-fields.js | 할 일로 | `mini` | ② 작은 버튼 |
| 일정 | calendar-context-menu.js | data-calendar-event-act | `task-inline-danger` | ② 작은 버튼(지우기 빨강) |
| 일정 | calendar-interactions-v2.js | 일정 삭제 | `ci-menu-danger` | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | call-feed.js | data-cf-box | `feed-chip` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 업무 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 개인 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | data-cf-row | `feed-call…` | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 통화 메뉴 | `feed-hov` | ⑥ 아이콘 |
| News(소식·통화) | call-feed.js | ‹ 업무 통화 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | call-feed.js | 다시 시도 | `feed-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 다시 시도 | `feed-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 다시 시도 | `feed-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 되돌리기 | `feed-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 원장에서도 틀림으로 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | ‹ 통화 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | call-feed.js | 핵심내용 고치기 | `feed-mini-edit` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 직접 쓰기 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 개인 통화로 옮기기 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 통화 메뉴 | `feed-more` | ⑥ 아이콘 |
| News(소식·통화) | call-feed.js | 조직·이름 고치기 | `feed-whoname` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | ▾ | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | AI 값으로 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 지우기 | `feed-text-btn` | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | call-feed.js | AI 값으로 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | + 줄 더하기 | `feed-text-btn` | ① 주 동작 또는 ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 요약 복사 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | Drive 원본 열기 | 클래스 없음 | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 지우기 목록에서만 | `feed-menu-danger` | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | call-feed.js | 제목 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | data-cf-act | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 요약 고치기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | data-cf-act | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 조직 연결 | 클래스 없음 | ③ 글자 버튼 |
| News(소식·통화) | call-feed.js | 개인 통화로 옮기기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 업무 통화로 옮기기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | call-feed.js | 개인 통화로 정하기 | 클래스 없음 | ② 작은 버튼 |
| 작은 창 | choice-sheet.js | data-depth | `home-choice-row home-choice-pick` | ④ 칩 |
| 작은 창 | choice-sheet.js | data-depth | `home-choice-row home-choice-pick` | ④ 칩 |
| 작은 창 | choice-sheet.js | 선택판 닫기 | 클래스 없음 | ⑥ 아이콘 |
| 작은 창 | choice-sheet.js | 취소 | `home-choice-cancel` | ② 작은 버튼 |
| 작은 창 | choice-sheet.js | 저장 | `home-choice-save` | ① 주 동작 또는 ② 작은 버튼 |
| 그 밖 | collection-status.js | data-collect-expand | `collect-alert-open` | ② 작은 버튼 |
| 그 밖 | collection-status.js | 오늘 하루 숨기기 | `collect-alert-close` | ⑥ 아이콘 |
| 그 밖 | color-swatch.mjs | — | `ui-swatch` | ② 작은 버튼 |
| 일기 | diary-list.js | 찾기 닫기 | `mini` | ⑥ 아이콘 |
| 일기 | diary-list.js | data-diary-lv-star | `diary-lv-star` | ④ 칩 |
| 일기 | diary-list.js | ⋯ | `diary-lv-more` | ⑥ 아이콘 |
| 일기 | diary-list.js | data-diary-lv-open | `diary-lv-open` | ② 작은 버튼 |
| 일기 | diary-list.js | 📌 | `diary-lv-act` | ② 작은 버튼 |
| 일기 | diary-list.js | ★ | `diary-lv-act` | ② 작은 버튼 |
| 일기 | diary-list.js | data-diary-lv-open | `diary-lv-open` | ② 작은 버튼 |
| 일기 | diary-list.js | data-diary-lv-month | `diary-lv-head` | ② 작은 버튼 |
| 일기 | diary-list.js | 열기 | 클래스 없음 | ③ 글자 버튼 |
| 일기 | diary-list.js | data-diary-lv-menu | 클래스 없음 | ③ 글자 버튼 |
| 일기 | diary-list.js | data-diary-lv-menu | 클래스 없음 | ③ 글자 버튼 |
| 일기 | diary.js | 달력 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 일기 | diary.js | 목록 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 일기 | diary.js | 이전 달 | `mini` | ⑥ 아이콘 |
| 일기 | diary.js | 다음 달 | `mini` | ⑥ 아이콘 |
| 일기 | diary.js | 오늘 | `mini` | ② 작은 버튼 |
| 일기 | diary.js | 전체 | 클래스 없음 | ④ 칩 |
| 일기 | diary.js | 별표한 일기만 | 클래스 없음 | ④ 칩 |
| 일기 | diary.js | 일기 찾기 | `mini diary-lv-find` | ④ 칩 |
| 일기 | diary.js | 전체 | 클래스 없음 | ④ 칩 |
| 일기 | diary.js | 별표 | 클래스 없음 | ④ 칩 |
| 일기 | diary.js | 일기 지우기 | `diary-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 작은 창 | ed-window.js | data-sheet-value | `home-choice-row` | ③ 글자 버튼 |
| 작은 창 | ed-window.js | data-sheet-value | `home-choice-row` | ③ 글자 버튼 |
| News(소식·통화) | feed-link.js | ▾ | `feed-small` | ③ 글자 버튼 |
| News(소식·통화) | feed-link.js | 취소 | `feed-small` | ③ 글자 버튼 |
| News(소식·통화) | feed-link.js | data-sheet-value | `home-choice-row home-choice-pick` | ④ 칩 |
| 파일 | file-actions.js | — | `…` | ② 작은 버튼 |
| 파일 | file-rename.js | ✎ | `fr-edit…` | ② 작은 버튼 |
| 파일 | file-rename.js | AI 이름 | `fr-ai` | ② 작은 버튼 |
| 파일 | file-rename.js | 저장 | `fr-save` | ① 주 동작 또는 ② 작은 버튼 |
| 파일 | file-rename.js | 취소 | `fr-cancel` | ② 작은 버튼 |
| 파일 | files.js | 새 폴더 | `fx-btn fx-mkdir` | ② 작은 버튼 |
| 파일 | files.js | 올리기 | `fx-btn fx-upload` | ② 작은 버튼 |
| 파일 | files.js | data-fx-sync | `fx-sync` | ② 작은 버튼 |
| 파일 | files.js | 구글 드라이브 | `mini fx-src-btn` | ④ 칩 |
| 파일 | files.js | 이 폰 | `mini fx-src-btn` | ④ 칩 |
| 파일 | files.js | 내 PC | `mini fx-src-btn` | ④ 칩 |
| 파일 | files.js | 두 칸 보기 | `mini fx-two` | ② 작은 버튼 |
| 파일 | files.js | 폴더 나무 | `fx-up` | ⑥ 아이콘 |
| 파일 | files.js | data-fx-go | `fx-crumb-step` | ② 작은 버튼 |
| 파일 | files.js | 1 ? '위 폴더' : '폴더 나무' | `fx-up` | ⑥ 아이콘 |
| 파일 | files.js | ▾ | `mini fx-pdrop` | ② 작은 버튼 |
| 파일 | files.js | data-fx-sync | `fx-sync fx-sync-tree` | ② 작은 버튼 |
| 파일 | files.js | data-fx-shelf | `nx-main` | ② 작은 버튼 |
| 파일 | files.js | data-fx-twist | `fx-twist` | ② 작은 버튼 |
| 파일 | files.js | data-fx-go | `nx-main` | ② 작은 버튼 |
| 파일 | files.js | data-fx-pc-knock | `nx-main` | ③ 글자 버튼 |
| 파일 | files.js | data-fx-tfile | `ft-btn ft-main` | ② 작은 버튼 |
| 파일 | files.js | data-fx-recent-more | `ft-btn ft-box-more` | ② 작은 버튼 |
| 파일 | files.js | data-fx-row | `fx-row fx-cell………` | ③ 글자 버튼 |
| 파일 | files.js | data-fx-row | `fx-row………` | ③ 글자 버튼 |
| 파일 | files.js | data-fx-more-pages | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 미리보기 닫기 | `fx-back` | ⑥ 아이콘 |
| 파일 | files.js | 이 PC에서 열기 | `fx-btn` | ③ 글자 버튼 |
| 파일 | files.js | 탐색기에서 위치 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 미리보기 닫기 | `fx-back` | ⑥ 아이콘 |
| 파일 | files.js | data-fx-star-one | `mini fx-star-btn…` | ④ 칩 |
| 파일 | files.js | 열기 | `fx-btn` | ③ 글자 버튼 |
| 파일 | files.js | 받기 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 공유 | `fx-btn fx-share` | ② 작은 버튼 |
| 파일 | files.js | 자료실에서 보기 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 클라우드에 복사 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 이름 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 휴지통 | `fx-btn fx-danger` | ② 작은 버튼(지우기 빨강) |
| 파일 | files.js | 이름 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 복사 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 옮기기 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 휴지통 | `fx-btn fx-danger` | ② 작은 버튼(지우기 빨강) |
| 파일 | files.js | data-fx-go | `fx-twin` | ③ 글자 버튼 |
| 파일 | files.js | 색 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 위로 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 아래로 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | data-fx-paste | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 취소 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 고르기 풀기 | `fx-btn` | ⑥ 아이콘 |
| 파일 | files.js | data-fx-send | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 클라우드에 복사 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 이름 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 휴지통 | `fx-btn fx-danger` | ② 작은 버튼(지우기 빨강) |
| 파일 | files.js | 고르기 풀기 | `fx-btn` | ⑥ 아이콘 |
| 파일 | files.js | data-fx-send | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | data-fx-send | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 이름 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | data-fx-star | `fx-btn` | ③ 글자 버튼 |
| 파일 | files.js | 휴지통 | `fx-btn fx-danger` | ② 작은 버튼(지우기 빨강) |
| 파일 | files.js | 고르기 풀기 | `fx-btn` | ⑥ 아이콘 |
| 파일 | files.js | 복사 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 옮기기 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 이름 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | data-fx-star | `fx-btn` | ③ 글자 버튼 |
| 파일 | files.js | 휴지통 | `fx-btn fx-danger` | ② 작은 버튼(지우기 빨강) |
| 파일 | files.js | 고르기 풀기 | `fx-btn` | ⑥ 아이콘 |
| 파일 | files.js | data-fx-dest-pick | `fx-dest-chip…` | ② 작은 버튼 |
| 파일 | files.js | data-fx-dest-twist | `fx-twist` | ② 작은 버튼 |
| 파일 | files.js | data-fx-dest-pick | `nx-main` | ② 작은 버튼 |
| 파일 | files.js | 닫기 | `mini` | ⑥ 아이콘 |
| 파일 | files.js | 새 폴더 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | data-fx-dest-go | `fx-btn fx-pri` | ② 작은 버튼 |
| 파일 | files.js | data-fx-ask | `fx-btn fx-pri` | ② 작은 버튼 |
| 파일 | files.js | 건너뛰기 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | data-fx-jobs-open | `fx-xfer-go` | ② 작은 버튼 |
| 파일 | files.js | data-fx-job-act | `mini` | ② 작은 버튼 |
| 파일 | files.js | 모두 멈춤 | `mini` | ② 작은 버튼 |
| 파일 | files.js | 모두 이어 하기 | `mini` | ② 작은 버튼 |
| 파일 | files.js | 닫기 | `mini` | ⑥ 아이콘 |
| 파일 | files.js | 복사 | `fx-btn fx-pri` | ② 작은 버튼 |
| 파일 | files.js | 옮기기 | `fx-btn` | ② 작은 버튼 |
| 파일 | files.js | 놓기 그만두기 | `mini` | ⑥ 아이콘 |
| 파일 | folder-path.mjs | — | `fp-step` | ② 작은 버튼 |
| 파일 | folder-tree-ui.mjs | — | `ft-btn ft-dots…` | ② 작은 버튼 |
| 파일 | folder-tree-ui.mjs | — | `ft-btn ft-main` | ② 작은 버튼 |
| 파일 | folder-tree-ui.mjs | — | `ft-btn ft-row ft-more-row` | ③ 글자 버튼 |
| 파일 | folder-tree-ui.mjs | — | `ft-btn ft-main` | ② 작은 버튼 |
| 파일 | folder-tree-ui.mjs | — | `ft-btn ft-box-toggle` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | global-search.js | 폴더로 옮기기 › | 클래스 없음 | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | global-search.js | 노트 결과 개 폴더로 옮기기 › | 클래스 없음 | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | global-search.js | 자료실 결과 개 모두 고르기 | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | global-search.js | 열기 | 클래스 없음 | ③ 글자 버튼 |
| 메뉴·머리줄·검색 | global-search.js | 선택 | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | global-search.js | 폴더로 옮기기 › | 클래스 없음 | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | global-search.js | 자료실 결과 개 폴더로 옮기기 › | 클래스 없음 | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | global-search.js | 자료실 결과 개 모두 고르기 | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | global-search.js | 열기 | 클래스 없음 | ③ 글자 버튼 |
| 할 일 | google-tasks.js | 편집 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | google-tasks.js | 파일 붙이기 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | google-tasks.js | 삭제 | `gt-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 할 일 | google-tasks.js | data-gt-toggle | `gt-check` | ② 작은 버튼 |
| 할 일 | google-tasks.js | data-gt-edit | `gt-main` | ② 작은 버튼 |
| 할 일 | google-tasks.js | data-gt-toggle | `gt-check` | ② 작은 버튼 |
| 할 일 | google-tasks.js | data-gt-edit | `gt-main` | ② 작은 버튼 |
| 할 일 | google-tasks.js | 전체 보기 › | 클래스 없음 | ⑥ 아이콘 |
| 할 일 | google-tasks.js | data-gt-today-open | `gt-pane-today-item` | ② 작은 버튼 |
| 할 일 | google-tasks.js | 되돌리기 | 클래스 없음 | ③ 글자 버튼 |
| 할 일 | google-tasks.js | data-gt-linked-toggle | `gt-check` | ③ 글자 버튼 |
| 할 일 | google-tasks.js | data-gt-linked-edit | `gt-main` | ③ 글자 버튼 |
| 할 일 | google-tasks.js | data-gt-pick | `mini` | ② 작은 버튼 |
| 홈 | home-family.js | 노트 열기 › | `home-family-open` | ⑥ 아이콘 |
| 홈 | home-family.js | 할 일로 | `home-family-act` | ② 작은 버튼 |
| 홈 | home-family.js | 일정으로 | `home-family-act` | ② 작은 버튼 |
| 홈 | home-family.js | 노트로 | `home-family-act` | ② 작은 버튼 |
| 홈 | home-family.js | 제안 지우기:  | `home-family-act home-family-x` | ⑥ 아이콘 |
| 홈 | home-family.js | 되돌리기 | `home-family-open` | ③ 글자 버튼 |
| 홈 | home-quick.js | 사업영역 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 오늘 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 내일 | 클래스 없음 | ③ 글자 버튼 |
| 홈 | home-quick.js | 모레 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 다음주 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 날짜 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 업데이트 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 기록할 곳 선택 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 할 일 | 클래스 없음 | ② 작은 버튼 |
| 홈 | home-quick.js | 큰 창에서 쓰기 | `home-quick-big` | ② 작은 버튼 |
| 홈 | home-quick.js | 상세 설정으로 추가 | `home-quick-detail` | ① 주 동작 또는 ② 작은 버튼 |
| 홈 | home-quick.js | 폴더 없음 ▾ | `home-quick-folder` | ② 작은 버튼 |
| 홈 | home-quick.js | 추가 | `home-quick-save` | ① 주 동작 또는 ② 작은 버튼 |
| 홈 | home-quick.js | 새 업데이트 입력 | `home-quick-new-note` | ② 작은 버튼 |
| 홈 | home-quick.js | 정리함 전체 보기 › | `home-basket-link` | ⑥ 아이콘 |
| 홈 | home-summary.js | data-goto | `home-summary-open` | ② 작은 버튼 |
| 홈 | home-summary.js | 내일 약속  › | `home-summary-open home-summary-promise` | ⑥ 아이콘 |
| 그 밖 | hwp-convert.js | data-doc-type | `hwp-convert-chip` | ④ 칩 |
| 그 밖 | hwp-lab.js | data-hwp-act | 클래스 없음 | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 고쳐서 할 일로 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 이미 할 일에 있음 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 내 일 아님 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 할 일 화면에서 확인 | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 옮긴 것으로 표시 | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | data-inbox-todo-link-task | `inbox-todo-btn inbox-todo-link-pick` | ③ 글자 버튼 |
| 할 일 | inbox-todos.js | 다시 | `inbox-todo-btn` | ③ 글자 버튼 |
| 할 일 | inbox-todos.js | 그냥 빼기 | `inbox-todo-btn` | ③ 글자 버튼 |
| 할 일 | inbox-todos.js | 취소 | `inbox-todo-btn` | ③ 글자 버튼 |
| 할 일 | inbox-todos.js | 넣기 | `inbox-todo-btn` | ① 주 동작 또는 ② 작은 버튼 |
| 할 일 | inbox-todos.js | 취소 | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 할 일로 | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 이미 함 | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 무시 | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 더 보기 | `inbox-todo-btn inbox-todo-more` | ⑥ 아이콘 |
| 할 일 | inbox-todos.js | 출처 열기:  | `inbox-todo-source` | ③ 글자 버튼 |
| 할 일 | inbox-todos.js | data-inbox-promise-ledger | `inbox-todo-btn` | ② 작은 버튼 |
| 할 일 | inbox-todos.js | 다시 시도 | `inbox-todo-link` | ③ 글자 버튼 |
| 메뉴·머리줄·검색 | index.html | 홈 | `nav-btn nav-home-mid` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 정리함 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 일정 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 달력 | `nav-sub-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 할 일 | `nav-sub-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 일기 | `nav-sub-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 노트 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 사업 보고 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 자료실 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 파일 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 공유 페이지 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 담당조직 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | HWP 편집 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 원장 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 사진 | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | News | `nav-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 통화 | `nav-btn nav-feed nav-feed-first` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 텔레그램 소식 | `nav-btn nav-feed` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 아스날 | `nav-btn nav-feed` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 자주 가는 링크 › | `nav-btn nav-quick-links` | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | index.html | 로그아웃 | `sidebar-utility hidden` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 메뉴 숨기기 | `topline-btn topline-nav-toggle` | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | index.html | 뒤로 | `topline-btn topline-step` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 앞으로 | `topline-btn topline-step` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | + 추가 | `topline-btn topline-add` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | `mobile-tab-basket` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | — | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 메뉴 닫기 | 클래스 없음 | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | index.html | data-basket-kind-nav | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | data-view | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 달력 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 할 일 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 일기 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 이전 달 | `mini` | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | index.html | 다음 달 | `mini` | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | index.html | 오늘 | `mini` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 목록 보기 | `mini` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 주간 보기 | `mini` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 월간 보기 | `mini` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 일정 등록 | `mini calendar-toolbar-add` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 달력 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 할 일 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 일기 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 달력 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 할 일 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 일기 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 사업 보고로 돌아가기 | `area-window-back` | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | index.html | 사업영역 바꾸기 | `lu-select-act kptu-act` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 담당조직 바꾸기 | `lu-select-act kptu-act` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 분류 바꾸기 | `lu-select-act kptu-act` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 폴더로 옮기기 | `lu-select-act kptu-act` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 삭제 | `lu-select-act kptu-act kptu-act-danger` | ② 작은 버튼(지우기 빨강) |
| 메뉴·머리줄·검색 | index.html | 취소 | `lu-select-act kptu-act` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 일정 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 할 일 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 메뉴·머리줄·검색 | index.html | 후속 할 일 추가 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 추가 | `mtg-line-add` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 사진 고르기 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 회의자료 파일 고르기 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | index.html | 오트밀·올리브(기본) | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 남색 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 먹 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 라벤더 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 청록 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 하늘 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 민트 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 코랄 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 레몬 | 클래스 없음 | ④ 칩 |
| 메뉴·머리줄·검색 | index.html | 빨강 | 클래스 없음 | ④ 칩 |
| 홈 | journal-memorable.js | 넣기 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 홈 | journal-memorable.js | 취소 | `mini` | ② 작은 버튼 |
| 홈 | journal-memorable.js | 넣기 | `mini` | ③ 글자 버튼 |
| 홈 | journal-memorable.js | data-memorable-fix | `mini` | ③ 글자 버튼 |
| 홈 | journal-memorable.js | data-memorable-drop | `mini` | ③ 글자 버튼 |
| 홈 | journal.js | 이전 주 | `mini` | ⑥ 아이콘 |
| 홈 | journal.js | 다음 주 | `mini` | ⑥ 아이콘 |
| 홈 | journal.js | 이번 주 | `mini` | ② 작은 버튼 |
| 홈 | journal.js | 하루 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 홈 | journal.js | 주간 정리 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 홈 | journal.js | 삭제 | `mini journal-delete save-row-start` | ② 작은 버튼(지우기 빨강) |
| 홈 | journal.js | 취소 | `mini` | ② 작은 버튼 |
| 홈 | journal.js | 수정 | `mini` | ② 작은 버튼 |
| 홈 | journal.js | 삭제 | `mini journal-delete` | ② 작은 버튼(지우기 빨강) |
| 홈 | journal.js | 다시 | `wait-retry` | ③ 글자 버튼 |
| 홈 | journal.js | 할 일 화면 열기 | `journal-schedule-cal` | ⑥ 아이콘 |
| 홈 | journal.js | 이 날 달력 보기 | `journal-schedule-cal` | ⑥ 아이콘 |
| 홈 | journal.js | data-journal-dday-project | `journal-dday-chip…` | ② 작은 버튼 |
| 홈 | journal.js | 새로 기록된 약속 | `journal-item-open` | ② 작은 버튼 |
| 원장 | ledger-browse.js | 다시 읽기 | `lg-tool` | ③ 글자 버튼 |
| 원장 | ledger-browse.js | 더보기  ▾ | `lg-text-btn lb-list-more` | ② 작은 버튼 |
| 원장 | ledger-browse.js | 조건 ▾ | `lb-cond-btn` | ② 작은 버튼 |
| 원장 | ledger-browse.js | + 기록하기 | `lb-add` | ① 주 동작 또는 ② 작은 버튼 |
| 원장 | ledger-browse.js | 조건 지우기 | `lb-clear` | ② 작은 버튼(지우기 빨강) |
| 원장 | ledger-browse.js | 조건 해제:  | `lb-tag` | ⑥ 아이콘 |
| 원장 | ledger-browse.js | 더 보기 | `lg-tool lb-more` | ② 작은 버튼 |
| 원장 | ledger-browse.js | 다시 읽기 | `lg-tool` | ③ 글자 버튼 |
| 원장 | ledger-browse.js | data-lb-action | `lb-topic` | ② 작은 버튼 |
| 원장 | ledger-browse.js | ‹ 원장 | `lg-text-btn` | ⑥ 아이콘 |
| 원장 | ledger-browse.js | data-lb-action | `lb-head` | ② 작은 버튼 |
| 원장 | ledger-browse.js | data-lb-action | `lg-tool` | ② 작은 버튼 |
| 원장 | ledger-browse.js | ‹원문› | `lg-text-btn` | ⑥ 아이콘 |
| 원장 | ledger-browse.js | 같은 주제 결정 건 › | `lg-text-btn lb-hist-topic` | ⑥ 아이콘 |
| 원장 | ledger-browse.js | data-lb-action | `lb-menu-item` | ② 작은 버튼 |
| 원장 | ledger-browse.js | data-lb-action | `lb-menu-item` | ③ 글자 버튼 |
| 원장 | ledger-browse.js | 취소 | `lg-text-btn` | ② 작은 버튼 |
| 원장 | ledger-export.js | data-le-action | `lg-text-btn` | ③ 글자 버튼 |
| 원장 | ledger-fix.js | 기록하기 닫기 | `lg-text-btn lf-close` | ⑥ 아이콘 |
| 원장 | ledger-merge.js | data-lm-action | `lg-text-btn` | ② 작은 버튼 |
| 원장 | ledger-merge.js | data-lm-action | `lg-text-btn` | ③ 글자 버튼 |
| 자료실 | library-folders.js | data-lu-target | `lu-folder-target` | ⑤ 보기 바꾸기 |
| 자료실 | library-folders.js | 새 폴더 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 전체 고르기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 맨 위에 새 폴더 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 이름 바꾸기F2 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 안에 새 폴더 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | data-lu-folder-action | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 이 폴더로 들어가기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 위로 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 아래로 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 옮기기… | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 색 고르기… | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-folders.js | 폴더 지우기 | `lu-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 자료실 | library-folders.js | data-lu-move-open | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-html-view.js | Drive에서 열기 | `lu-html-drive` | ③ 글자 버튼 |
| 자료실 | library-move-picker.js | data-lu-move-folder | `lu-move-item` | ② 작은 버튼 |
| 자료실 | library-move-picker.js | + 새 폴더 만들어 넣기 | `lu-move-foot-btn` | ② 작은 버튼 |
| 자료실 | library-move-picker.js | 폴더 밖으로 | `lu-move-foot-btn` | ② 작은 버튼 |
| 자료실 | library-upload.js | 켜기 | `lu-off-show` | ② 작은 버튼 |
| 자료실 | library-upload.js | 폴더 나무로 | `ft-btn ft-focus-back` | ⑥ 아이콘 |
| 자료실 | library-upload.js | 자료실 전체 | `ft-btn ft-main` | ② 작은 버튼 |
| 자료실 | library-upload.js | 최근 올린 파일 | `lu-recent-title lu-recent-fold` | ② 작은 버튼 |
| 자료실 | library-upload.js | data-lu-recent-more | `lu-more-files lu-recent-more` | ② 작은 버튼 |
| 자료실 | library-upload.js | 📁 ? | `lu-suggest` | ② 작은 버튼 |
| 자료실 | library-upload.js | 옮길 사진이 없어요 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 선택 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 이름 바꾸기F2 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 분류 바꾸기› | 클래스 없음 | ⑥ 아이콘 |
| 자료실 | library-upload.js | 편집 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | Drive에서 열기 | 클래스 없음 | ③ 글자 버튼 |
| 자료실 | library-upload.js | 내려받기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 정보 수정… | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 삭제 | `lu-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 자료실 | library-upload.js | 분류 바꾸기› | 클래스 없음 | ⑥ 아이콘 |
| 자료실 | library-upload.js | 선택 풀기Esc | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 개 삭제 | `lu-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 자료실 | library-upload.js | 파일 교체 | `library-pick-button` | ② 작은 버튼 |
| 자료실 | library-upload.js | data-lu-prev-keep | `library-edit-prev-keep` | ② 작은 버튼 |
| 자료실 | library-upload.js | 전체 | `quick-pill-button` | ④ 칩 |
| 자료실 | library-upload.js | data-lu-top | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 고르기 끝내기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 여러 개 고르기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | data-lu-top | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | data-lu-bulk-value | 클래스 없음 | ② 작은 버튼 |
| 자료실 | library-upload.js | 고를 수 있는 값이 없어요 | 클래스 없음 | ② 작은 버튼 |
| 그 밖 | markdown-render.mjs | 🖼 이미지 개 | `md-image-chip` | ② 작은 버튼 |
| 사업 보고 | meeting-columns.js | data-meeting-kind | `mcol-kind kptu-pick-row` | ③ 글자 버튼 |
| 사업 보고 | meeting-columns.js | data-meeting-round | `mcol-card mcol-card-line` | ② 작은 버튼 |
| 사업 보고 | meeting-columns.js | data-meeting-round | `mcol-card` | ② 작은 버튼 |
| 사업 보고 | meeting-from-files.js | 직접 쓰기 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 사업 보고 | meeting-from-files.js | 파일·글로 만들기 | 클래스 없음 | ⑤ 보기 바꾸기 |
| 사업 보고 | meeting-from-files.js | 회의자료·회의결과 파일 고르기 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 계속 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 취소 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 이어 녹음 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 이어서 정리 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 버리기 | `rec-btn rec-discard` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 이어 녹음 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 멈추고 정리 | `rec-btn rec-stop` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 버리기 | `rec-btn rec-discard` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | data-rec | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 멈추고 정리 | `rec-btn rec-stop` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 버리기 | `rec-btn rec-discard` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 닫기 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 초안 열기 | `rec-btn` | ③ 글자 버튼 |
| 사업 보고 | meeting-recorder.js | 닫기 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 다시 | `rec-btn` | ③ 글자 버튼 |
| 사업 보고 | meeting-recorder.js | 닫기 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 이어 녹음 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 이어서 정리 | `rec-btn` | ② 작은 버튼 |
| 사업 보고 | meeting-recorder.js | 버리기 | `rec-btn rec-discard` | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 저장 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 버리기 | `mini` | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 후속 할 일 추가 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 추가 | `mtg-line-add` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 취소 | `mtg-line-cancel hidden` | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | AI로 후보 찾기 | `mrd-make-todos` | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 사진 고르기 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 회의자료 파일 고르기 | `mtg-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 칸 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 성명 초안 만들기 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 삭제 | `gt-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | meeting-round-detail.js | data-mrd-task-toggle | `gt-check` | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | data-mrd-task-edit | `gt-main mrd-task-main` | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | meeting-round-detail.js | 삭제 | `gt-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | meeting-round-detail.js | data-mrd-download | `file-line-open` | ③ 글자 버튼 |
| 사업 보고 | meeting-round-detail.js | 전사해서 결과에 넣기 | 클래스 없음 | ② 작은 버튼 |
| 그 밖 | menu-edit.js | ⠿ | `me-handle` | ② 작은 버튼 |
| 그 밖 | menu-layout.js | — | 클래스 없음 | ② 작은 버튼 |
| 그 밖 | my-work.html | ← 앱 홈으로 | `mywork-back` | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | data-nc-star | `nc-star` | ④ 칩 |
| News(소식·통화) | news-clipping.js | data-nc-folder | `nc-act` | ⑥ 아이콘 |
| News(소식·통화) | news-clipping.js | 더 보기 | `nc-text-btn nc-more-items` | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | 새 폴더 | `nc-text-btn nc-new-folder` | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | data-nc-folder-more | `nc-folder-more` | ⑥ 아이콘 |
| News(소식·통화) | news-clipping.js | data-nc-folder-toggle | `nc-folder` | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | 더 보기 | `nc-text-btn nc-more-items` | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | 목록으로 | `nc-back` | ⑥ 아이콘 |
| News(소식·통화) | news-clipping.js | — | `nc-switch` | ⑤ 보기 바꾸기 |
| News(소식·통화) | news-clipping.js | × | `nc-del` | ⑥ 아이콘 |
| News(소식·통화) | news-clipping.js | 안에 폴더 만들기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | 이름 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | news-clipping.js | 지우기 | 클래스 없음 | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | news-row.mjs | data-unread | `now-open` | ② 작은 버튼 |
| 노트 | note-board.js | 작게 | 클래스 없음 | ② 작은 버튼 |
| 노트 | note-board.js | 크게 | 클래스 없음 | ⑥ 아이콘 |
| 노트 | note-board.js | data-note-row | `nb-open` | ④ 칩 |
| 노트 | note-board.js | × | `nb-x` | ⑥ 아이콘 |
| 노트 | note-board.js | data-note-row-more | `basket-row-more nb-more` | ⑥ 아이콘 |
| 노트 | note-boards.js | 전체 | `nbb-chip` | ④ 칩 |
| 노트 | note-boards.js | data-nbb-board | `nbb-chip` | ④ 칩 |
| 노트 | note-boards.js | + 새 보드 | `nbb-new` | ② 작은 버튼 |
| 노트 | note-boards.js | + 노트 붙이기 | `nbb-new nbb-attach` | ② 작은 버튼 |
| 노트 | note-boards.js | data-nbb-folder | `nbb-folder` | ② 작은 버튼 |
| 노트 | note-boards.js | data-nbb-note | `nbb-note…` | ② 작은 버튼 |
| 노트 | note-boards.js | 이름 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| 노트 | note-boards.js | 보드 지우기 | `basket-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 노트 | note-boards.js | 닫기 | `nbb-pick-x` | ⑥ 아이콘 |
| 노트 | note-boards.js | 붙이기 | `nbb-pick-ok` | ② 작은 버튼 |
| 노트 | note-boards.js | data-nbb-pf | `nbb-folder` | ② 작은 버튼 |
| 노트 | note-boards.js | data-nbb-pn | `nbb-note…` | ④ 칩 |
| 노트 | note-comments-ui.js | 댓글 지우기 | `note-cm-del` | ⑥ 아이콘 |
| 노트 | note-comments-ui.js | 인용 빼기 | `note-cm-del` | ⑥ 아이콘 |
| 그 밖 | notice-done.js | 열기 | `kptu-notice-line-action` | ③ 글자 버튼 |
| 그 밖 | notice-done.js | 닫기 | `kptu-notice-line-close` | ⑥ 아이콘 |
| 그 밖 | notice-lines.js | data-notice-act | `kptu-notice-line-action` | ② 작은 버튼 |
| 그 밖 | notice-lines.js | 닫기 | `kptu-notice-line-close` | ⑥ 아이콘 |
| 그 밖 | notice-outside.js | 보기 | `kptu-notice-line-action` | ② 작은 버튼 |
| 그 밖 | notice-outside.js | 닫기 | `kptu-notice-line-close` | ⑥ 아이콘 |
| 홈 | now-detail.js | 다시 | `nd-act` | ③ 글자 버튼 |
| 홈 | now-detail.js | data-nd-related | `nd-rel` | ② 작은 버튼 |
| 홈 | now-detail.js | 가 | `nd-size-btn` | ④ 칩 |
| 홈 | now-detail.js | data-nd-act | `nd-act` | ④ 칩 |
| 홈 | now-detail.js | data-nd-act | `nd-act` | ② 작은 버튼 |
| 홈 | now-detail.js | 목록으로 | `nd-back` | ⑥ 아이콘 |
| 홈 | now-interests.js | ㅇ 확정 | `ni-btn` | ② 작은 버튼 |
| 홈 | now-interests.js | 고치기 | `ni-btn` | ② 작은 버튼 |
| 홈 | now-interests.js | 빼기 | `ni-btn` | ③ 글자 버튼 |
| 홈 | now-row-acts.js | data-now-act | `now-hov-btn` | ② 작은 버튼 |
| 홈 | now-row-acts.js | data-now-act | `now-hov-btn` | ① 주 동작 또는 ② 작은 버튼 |
| 홈 | now-row-acts.js | data-now-act | `now-hov-btn` | ② 작은 버튼 |
| 홈 | now-saved.js | data-ns-chip | `os-chip` | ④ 칩 |
| 담당조직 | od-link.js | data-od-link | `mini od-link` | ③ 글자 버튼 |
| 담당조직 | od-link.js | 다시 확인 | 클래스 없음 | ③ 글자 버튼 |
| 담당조직 | od-link.js | 원드라이브 연결 | 클래스 없음 | ② 작은 버튼 |
| 담당조직 | od-link.js | data-od-act | 클래스 없음 | ② 작은 버튼 |
| 담당조직 | od-link.js | 하위 폴더 켜고 끄기 | 클래스 없음 | ② 작은 버튼 |
| 담당조직 | od-link.js | data-od-act | 클래스 없음 | ④ 칩 |
| 담당조직 | od-link.js | 지우기를 쓰려면 다시 연결 | 클래스 없음 | ② 작은 버튼(지우기 빨강) |
| 담당조직 | od-link.js | 연결 끊기 | `od-link-danger` | ② 작은 버튼(지우기 빨강) |
| 담당조직 | od-settings.js | data-od-enter | `diary-od-name` | ② 작은 버튼 |
| 담당조직 | od-settings.js | data-od-sw | `diary-od-switch` | ⑤ 보기 바꾸기 |
| 담당조직 | od-settings.js | data-od-fold | `diary-od-fold` | ② 작은 버튼 |
| 담당조직 | od-settings.js | 비우기 | `diary-od-keep-clear` | ② 작은 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 다시 시도 | `wd-stage-btn` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 끝 날짜 넣기(선택) | `wd-stage-end-btn` | ② 작은 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 저장 | `wd-stage-btn` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | org-dispute-stage-ui.js | ⋯ | `wd-stage-hmore` | ⑥ 아이콘 |
| 담당조직 | org-dispute-stage-ui.js | 고치기 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 취소 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 저장 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 취소 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 투쟁 중 | `stg-sw…` | ④ 칩 |
| 담당조직 | org-dispute-stage-ui.js | 끝남 | `stg-sw end` | ④ 칩 |
| 담당조직 | org-dispute-stage-ui.js | 이름 바꾸기 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 끝남 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 취소 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 저장 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 취소 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | ⋮⋮ | `stg-grip` | ② 작은 버튼 |
| 담당조직 | org-dispute-stage-ui.js | ⋯ | `stg-more` | ⑥ 아이콘 |
| 담당조직 | org-dispute-stage-ui.js | 취소 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | 추가 | `stg-link` | ③ 글자 버튼 |
| 담당조직 | org-dispute-stage-ui.js | + 단계 | `stg-add-btn` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | org-key-people.js | 다시 시도 | `okp-link` | ③ 글자 버튼 |
| 담당조직 | org-key-people.js | 모두 | `okp-chip` | ④ 칩 |
| 담당조직 | org-key-people.js | data-okp-pick | `okp-chip` | ④ 칩 |
| 담당조직 | org-key-people.js | + 인물 | `okp-add` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | org-key-people.js | 고치기 | `okp-link` | ③ 글자 버튼 |
| 담당조직 | org-key-people.js | 닫기 | `okp-link` | ③ 글자 버튼 |
| 담당조직 | org-key-people.js | data-okp-open | `okp-row` | ③ 글자 버튼 |
| 담당조직 | org-key-people.js | data-okp-open | `okp-row` | ③ 글자 버튼 |
| 담당조직 | org-key-people.js | × | 클래스 없음 | ⑥ 아이콘 |
| 담당조직 | org-key-people.js | + | `okp-sg` | ② 작은 버튼 |
| 담당조직 | org-overview.js | 목록 | `so-team-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | org-overview.js | 전체 표 | `so-team-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | org-overview.js | 다시 시도 | `wd-st-btn` | ③ 글자 버튼 |
| 담당조직 | org-overview.js | 복사 | `wd-st-btn` | ② 작은 버튼 |
| 담당조직 | org-overview.js | data-oa-open | `oa-name` | ② 작은 버튼 |
| 담당조직 | org-quiet.js | data-oq-org | `oq-org` | ② 작은 버튼 |
| 담당조직 | org-quiet.js | data-oq-toggle | `oq-toggle` | ⑥ 아이콘 |
| 담당조직 | org-status-table.js | 빼기 | `wd-st-btn wd-st-del` | ② 작은 버튼(지우기 빨강) |
| 담당조직 | org-status-table.js | 취소 | `wd-st-btn` | ② 작은 버튼 |
| 담당조직 | org-status-table.js | 다시 시도 | `wd-st-btn` | ③ 글자 버튼 |
| 담당조직 | org-status-table.js | = ROWS_MAX ? ' disab | `wd-st-btn` | ③ 글자 버튼 |
| News(소식·통화) | outside-search.js | — | `os-chip` | ④ 칩 |
| News(소식·통화) | outside-search.js | data-osq-quote | `osq-quote` | ④ 칩 |
| News(소식·통화) | outside-search.js | data-osq-doc | `osq-doc` | ② 작은 버튼 |
| News(소식·통화) | outside-search.js | 더 보기 | `os-text-btn` | ② 작은 버튼 |
| News(소식·통화) | outside-search.js | 성명 초안 열기 | `os-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | outside-statements.js | data-os-tab | 클래스 없음 | ⑤ 보기 바꾸기 |
| News(소식·통화) | outside-statements.js | data-nw-media | `nw-dd` | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | News 메뉴 | `os-more` | ⑥ 아이콘 |
| News(소식·통화) | outside-statements.js | 목록으로 | `os-back` | ⑥ 아이콘 |
| News(소식·통화) | outside-statements.js | 더 보기 | `os-text-btn os-more-posts` | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 단체 켜고 끄기 | `os-text-btn` | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 목록으로 | `os-back` | ⑥ 아이콘 |
| News(소식·통화) | outside-statements.js | data-os-source | `os-switch` | ⑤ 보기 바꾸기 |
| News(소식·통화) | outside-statements.js | 보기 | `os-text-btn` | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 지금 채우기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 단체 켜고 끄기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 언론 매체 켜고 끄기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 키워드 고치기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 별표 폴더 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | outside-statements.js | 관심 주제 | 클래스 없음 | ② 작은 버튼 |
| 그 밖 | overlap-check.js | data-undo-action | 클래스 없음 | ③ 글자 버튼 |
| 그 밖 | overlap-check.js | data-undo-action | 클래스 없음 | ③ 글자 버튼 |
| 그 밖 | phone-push-settings.js | data-ps-push-recent-open | `ps-push-recent` | ② 작은 버튼 |
| 그 밖 | phone-push-settings.js | data-ps-push-kind | `ps-push-kind` | ④ 칩 |
| News(소식·통화) | phone-recorder.js | data-prec | `rec-btn` | ② 작은 버튼 |
| News(소식·통화) | phone-recorder.js | 멈추고 정리 | `rec-btn rec-stop` | ② 작은 버튼 |
| News(소식·통화) | phone-recorder.js | 버리기 | `rec-btn rec-discard` | ② 작은 버튼 |
| News(소식·통화) | phone-recorder.js | 닫기 | `rec-btn` | ② 작은 버튼 |
| News(소식·통화) | phone-recorder.js | 다시 | `rec-btn` | ③ 글자 버튼 |
| News(소식·통화) | phone-recorder.js | 닫기 | `rec-btn` | ② 작은 버튼 |
| News(소식·통화) | phone-recorder.js | 이어서 정리 | `rec-btn` | ② 작은 버튼 |
| News(소식·통화) | phone-recorder.js | 버리기 | `rec-btn rec-discard` | ② 작은 버튼 |
| 사진 | photo-act-bar.mjs | — | `kptu-act…` | ② 작은 버튼(지우기 빨강) |
| 사진 | photo-bar-menu.js | data-bar-item | 클래스 없음 | ② 작은 버튼 |
| 사진 | photo-grid-size.js | 사진 작게(한 줄 칸 늘리기) | 클래스 없음 | ② 작은 버튼 |
| 사진 | photo-grid-size.js | 사진 크게(한 줄 칸 줄이기) | 클래스 없음 | ⑥ 아이콘 |
| 사진 | photo-info-edit.js | 되돌리기 | `mini` | ③ 글자 버튼 |
| 사진 | photo-strip.js | 크게 보기 닫기 | `diary-viewer-close` | ⑥ 아이콘 |
| 사진 | photo-strip.js | 되돌리기 | `diary-viewer-undo` | ③ 글자 버튼 |
| 사진 | photo-tidy.js | 크게 보기 | `photos-tidy-cmp-ph` | ⑥ 아이콘 |
| 사진 | photo-tidy.js | data-photos-tidy-keep | `mini` | ④ 칩 |
| 사진 | photo-tidy.js | 앞 사진 | `mini` | ⑥ 아이콘 |
| 사진 | photo-tidy.js | 다음 사진 | `mini` | ⑥ 아이콘 |
| 사진 | photo-tidy.js | 다시 찾기 | `mini` | ③ 글자 버튼 |
| 사진 | photo-tidy.js | data-photos-tidy-sort | `photos-tidy-place` | ④ 칩 |
| 사진 | photo-tidy.js | 다시 찾기 | `mini` | ③ 글자 버튼 |
| 사진 | photo-tidy.js | 알았어요 | `mini` | ② 작은 버튼 |
| 사진 | photo-tidy.js | data-photos-place | `photos-tidy-place` | ④ 칩 |
| 사진 | photo-tidy.js | data-photos-tidy-off | `mini` | ③ 글자 버튼 |
| 사진 | photo-tidy.js | 보기 | `mini` | ② 작은 버튼 |
| 사진 | photo-tidy.js | 폴더 | `mini` | ② 작은 버튼 |
| 사진 | photo-tidy.js | 폰 공간만 비우기 | `mini photos-danger` | ② 작은 버튼(지우기 빨강) |
| 사진 | photo-tidy.js | data-photos-tidy-dupkind | `photos-tidy-place` | ④ 칩 |
| 사진 | photo-tidy.js | 찾기 | `mini` | ② 작은 버튼 |
| 사진 | photo-tidy.js | 비교 | `mini` | ② 작은 버튼 |
| 사진 | photo-tidy.js | 나머지 지우기 | `mini photos-danger` | ② 작은 버튼(지우기 빨강) |
| 사진 | photo-tidy.js | data-photos-tidy-keep | `photos-tidy-pick` | ④ 칩 |
| 사진 | photo-tidy.js | 나머지 모두 지우기 | `mini photos-danger` | ② 작은 버튼(지우기 빨강) |
| 사진 | photo-tidy.js | 보기 | `mini` | ② 작은 버튼 |
| 사진 | photo-tidy.js | data-photos-tidy-hide | `mini` | ③ 글자 버튼 |
| 사진 | photo-tidy.js | 지우기 | `mini photos-danger` | ② 작은 버튼(지우기 빨강) |
| 사진 | photo-view.js | 크게 보기 닫기 | `basket-photo-close` | ⑥ 아이콘 |
| 사진 | photos.js | 사진 | `photos-chip` | ⑤ 보기 바꾸기 |
| 사진 | photos.js | 달력 | `photos-chip` | ⑤ 보기 바꾸기 |
| 사진 | photos.js | 폴더 | `photos-chip` | ⑤ 보기 바꾸기 |
| 사진 | photos.js | 앨범 | `photos-chip` | ⑤ 보기 바꾸기 |
| 사진 | photos.js | 휴지통 | `photos-chip` | ⑤ 보기 바꾸기 |
| 사진 | photos.js | 정리 | `photos-chip photos-tidy-chip` | ② 작은 버튼 |
| 사진 | photos.js | data-photos-sort | `photos-sort` | ② 작은 버튼 |
| 사진 | photos.js | 구글 드라이브 | `mini photos-src-btn` | ④ 칩 |
| 사진 | photos.js | 폰 폴더 | `mini photos-src-btn` | ④ 칩 |
| 사진 | photos.js | 선택 끝내기 | `photos-sel-x` | ⑥ 아이콘 |
| 사진 | photos.js | 만들기 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 사진 | photos.js | 닫기 | `mini photos-name-x` | ⑥ 아이콘 |
| 사진 | photos.js | data-photos-restore | `kptu-act` | ② 작은 버튼 |
| 사진 | photos.js | data-photos-purge | `kptu-act kptu-act-danger` | ② 작은 버튼(지우기 빨강) |
| 사진 | photos.js | 더 보기 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | Drive 다시 연결 | `mini` | ③ 글자 버튼 |
| 사진 | photos.js | 다시 | `mini` | ③ 글자 버튼 |
| 사진 | photos.js | 다시 | `mini` | ③ 글자 버튼 |
| 사진 | photos.js | 연결 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | 폴더 고르기 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | 사진 접근 허용 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | 더 고르기 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | data-photos-day-pick | `photos-day-pick` | ② 작은 버튼 |
| 사진 | photos.js | 최신으로 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | 이전 달 | `mini` | ⑥ 아이콘 |
| 사진 | photos.js | 다음 달 | `mini` | ⑥ 아이콘 |
| 사진 | photos.js | 다시 | `mini` | ③ 글자 버튼 |
| 사진 | photos.js | 모두 비우기 | `mini` | ② 작은 버튼 |
| 사진 | photos.js | data-photos-fx-sw | `diary-od-switch photos-fx-sw` | ⑤ 보기 바꾸기 |
| 사진 | photos.js | — | `photos-fx-tog` | ② 작은 버튼 |
| 사진 | photos.js | — | `nx-main` | ② 작은 버튼 |
| 사진 | photos.js | ⋯ | `nx-more photos-fx-more` | ⑥ 아이콘 |
| 사진 | photos.js | + 새 폴더 | `nx-new-folder photos-fx-new` | ② 작은 버튼 |
| 사진 | photos.js | data-photos-pf-open | `nx-main` | ② 작은 버튼 |
| 사진 | photos.js | ⋯ | `nx-more photos-fx-more` | ⑥ 아이콘 |
| 사진 | photos.js | + 새 폴더 | `nx-new-folder photos-fx-new` | ② 작은 버튼 |
| 사진 | photos.js | 폴더 나무로 | `ft-btn ft-focus-back` | ⑥ 아이콘 |
| 사진 | photos.js | 다시 | `mini` | ③ 글자 버튼 |
| 사진 | photos.js | + 새 폴더 | `nx-new-folder photos-fx-new` | ② 작은 버튼 |
| 사진 | photos.js | + 새 폴더 | `nx-new-folder photos-fx-new` | ② 작은 버튼 |
| 사진 | photos.js | # | `photos-album-open` | ② 작은 버튼 |
| 사진 | photos.js | # | `photos-album-more` | ⑥ 아이콘 |
| 사진 | photos.js | 다시 | `mini` | ③ 글자 버튼 |
| 사진 | photos.js | 앨범 목록으로 | `mini` | ⑥ 아이콘 |
| 사진 | photos.js | # | `photos-album-more` | ⑥ 아이콘 |
| 사진 | photos.js | — | `…` | ② 작은 버튼 |
| 사진 | photos.js | data-sort-pick | 클래스 없음 | ④ 칩 |
| 사진 | photos.js | data-pick-gd | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 사진 | photos.js | data-pick-phone | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 사진 | photos.js | data-pick-folder | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 노트 | press-draft.js | data-pd-type | `pd-chip` | ④ 칩 |
| 노트 | press-draft.js | 다시 | `pd-link` | ③ 글자 버튼 |
| 노트 | press-draft.js | 근거 고르기로 | `pd-icon` | ⑥ 아이콘 |
| 노트 | press-draft.js | 노트 열기 | 클래스 없음 | ③ 글자 버튼 |
| 노트 | press-draft.js | 닫기 | `pd-icon` | ⑥ 아이콘 |
| 그 밖 | profile-settings.js | › | `ps-org-go` | ⑥ 아이콘 |
| 그 밖 | profile-status.js | 주` : '끄기'} | 클래스 없음 | ④ 칩 |
| 사업 보고 | project-system-v3.js | 보관 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 휴지통 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | data-ps | `… kptu-list-row` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | + | `ps3-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | data-ps | `ps3-child-link` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | data-ps | `ps3-rec-line` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 정리함 기록 메뉴 | `ps3-rec-more` | ⑥ 아이콘 |
| 사업 보고 | project-system-v3.js | 다시 불러오기 | 클래스 없음 | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 노트 열기 | 클래스 없음 | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 업데이트 열기 | 클래스 없음 | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 연결 해제 | `ps3-record-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | project-system-v3.js | 요약 수정 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 삭제 | `ps3-record-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | project-system-v3.js | 취소 | `ps3-text-btn` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 저장 | `ps3-text-btn` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | + 추가 | `ps3-text-btn` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 수정 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 기존 할 일 연결 | `ps3-text-btn` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 전체 개 보기 › | `ps3-text-btn ps3-docs-all` | ⑥ 아이콘 |
| 사업 보고 | project-system-v3.js | data-ps | `ps3-line-main…` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 연결 해제 | 클래스 없음 | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 연결 | `ps3-text-btn` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | + 회의 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | + 섹션 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 이름 수정 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | ↑ | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | ↓ | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | + 내용 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 수정 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | ↑ | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | ↓ | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | + 행 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | + 항목 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 취소 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 취소 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 취소 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 취소 | `mini` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | data-ps | `ps3-order-move` | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 다시 위로 | 클래스 없음 | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 아래로 접기 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 다시 위로 | 클래스 없음 | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 아래로 접기 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 순서 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | data-ps | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 보관 | 클래스 없음 | ② 작은 버튼 |
| 사업 보고 | project-system-v3.js | 삭제 | `ps3-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | project-system-v3.js | data-ps | `ps3-parent-link` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 복구 | `mini ps3-prow-restore` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 되돌리기 | `mini ps3-prow-restore` | ③ 글자 버튼 |
| 사업 보고 | project-system-v3.js | 영구 삭제 | `ps3-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | project-system-v3.js | 다시 시도 | `mini` | ③ 글자 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 링크 추가 | 클래스 없음 | ③ 글자 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 분류 추가 | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 이름 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 위로 | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 아래로 | 클래스 없음 | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 분류 지우기 | `ql-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 메뉴·머리줄·검색 | quick-links.js | 편집 | `ql-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | ''로 옮기기 | `ql-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 같이 지우기 | `ql-btn ql-remove` | ② 작은 버튼(지우기 빨강) |
| 메뉴·머리줄·검색 | quick-links.js | 취소 | `ql-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | ⠿ | `ql-handle` | ③ 글자 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 삭제 | `ql-btn ql-remove` | ② 작은 버튼(지우기 빨강) |
| 메뉴·머리줄·검색 | quick-links.js | 분류 순서 바꾸기(끌거나 위·아래 화살표) | `ql-handle` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 분류 이름 바꾸기 | `ql-icon` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 분류 메뉴 | `ql-icon` | ⑥ 아이콘 |
| 메뉴·머리줄·검색 | quick-links.js | + 추가 | `ql-btn ql-add` | ① 주 동작 또는 ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | 취소 | `ql-btn` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | quick-links.js | data-ql-save | `ql-btn ql-primary` | ① 주 동작 또는 ② 작은 버튼 |
| 그 밖 | record-files.js | data-record-photo | `record-file-thumb` | ⑥ 아이콘 |
| 그 밖 | record-files.js | data-record-file | `record-file-name` | ③ 글자 버튼 |
| 자료실 | reference-bundles.js | 참고 묶음 메뉴 | `rb-more` | ⑥ 아이콘 |
| 자료실 | reference-bundles.js | ↑ | `rb-icon-btn` | ② 작은 버튼 |
| 자료실 | reference-bundles.js | ↓ | `rb-icon-btn` | ② 작은 버튼 |
| 자료실 | reference-bundles.js | data-rb-bundle | `rb-row…` | ③ 글자 버튼 |
| 자료실 | reference-bundles.js | 취소 | `rb-small` | ② 작은 버튼 |
| 자료실 | reference-bundles.js | 취소 | `rb-small` | ① 주 동작 또는 ② 작은 버튼 |
| 자료실 | reference-bundles.js | 취소 | `rb-small` | ② 작은 버튼 |
| 자료실 | reference-bundles.js | data-rb-detail-more | `rb-more` | ⑥ 아이콘 |
| 자료실 | reference-bundles.js | ‹ 참고 묶음 | `back-text rb-back` | ⑥ 아이콘 |
| 자료실 | reference-bundles.js | data-rb-open | `rb-item-open` | ② 작은 버튼 |
| 자료실 | reference-bundles.js | data-rb-item-more | `rb-more` | ⑥ 아이콘 |
| 자료실 | reference-bundles.js | 묶음 더하기 | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 자료실 | reference-bundles.js | 순서 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | reference-bundles.js | 이름 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| 자료실 | reference-bundles.js | 묶음 지우기 | `rb-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 자료실 | reference-bundles.js | 업데이트 열기 | 클래스 없음 | ③ 글자 버튼 |
| 자료실 | reference-bundles.js | 연결 해제 | `rb-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 사업 보고 | report-filter-sheet.js | data-depth | `home-choice-row home-choice-pick` | ④ 칩 |
| 사업 보고 | report-kind-sheet.js | data-depth | `home-choice-row home-choice-pick` | ④ 칩 |
| 사업 보고 | report-kind-sheet.js | data-depth | `home-choice-row home-choice-oneline` | ③ 글자 버튼 |
| 사업 보고 | report-photo-row.js | 사진 크게 보기:  | `act-photo-thumb` | ⑥ 아이콘 |
| 사업 보고 | report-photo-row.js | × | `act-photo-x` | ⑥ 아이콘 |
| 사업 보고 | report-places-sheet.js | data-depth | `home-choice-row home-choice-pick` | ④ 칩 |
| 사업 보고 | report-views.js | 이전 달 | `rv-nav` | ⑥ 아이콘 |
| 사업 보고 | report-views.js | 다음 달 | `rv-nav` | ⑥ 아이콘 |
| 사업 보고 | report-views.js | 오늘 | `rv-nav rv-today` | ② 작은 버튼 |
| 사업 보고 | report-views.js | data-rv-day | `rv-num…` | ④ 칩 |
| 그 밖 | row-menu.js | data-row-item | `row-menu-last` | ③ 글자 버튼 |
| 그 밖 | share-ai-draft.js | 다시 | `pd-link` | ③ 글자 버튼 |
| 그 밖 | share-ai-draft.js | 재료 고르기로 | `pd-icon` | ⑥ 아이콘 |
| 그 밖 | share-ai-draft.js | 닫기 | `pd-icon` | ⑥ 아이콘 |
| 그 밖 | share-menu.js | data-share-act | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 보관 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 삭제 | `task-inline-danger` | ② 작은 버튼(지우기 빨강) |
| 공유 페이지 | share-pages.js | 되살리기 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 삭제 | `task-inline-danger` | ② 작은 버튼(지우기 빨강) |
| 공유 페이지 | share-pages.js | 링크 복사 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 새 파일로 바꾸기 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 링크 끄기 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 링크 켜기 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 보관함으로 | 클래스 없음 | ③ 글자 버튼 |
| 공유 페이지 | share-pages.js | 삭제 | `task-inline-danger` | ② 작은 버튼(지우기 빨강) |
| 그 밖 | suborganizations.js | 참고 묶음 › | `so-reference-entry` | ⑥ 아이콘 |
| 그 밖 | suborganizations.js | 쟁의 단계 관리 | 클래스 없음 | ② 작은 버튼 |
| 그 밖 | summary-copy.js | — | `copy-mini` | ② 작은 버튼 |
| 할 일 | task-files.js | Drive에서 열기 | `mini` | ③ 글자 버튼 |
| 할 일 | task-files.js | 내려받기 | `mini` | ② 작은 버튼 |
| 할 일 | task-files.js | 빼기 | `mini` | ③ 글자 버튼 |
| 할 일 | task-inline.js | ⋯ | `task-inline-more…` | ⑥ 아이콘 |
| 할 일 | task-inline.js | data-task-due-quick | `mini` | ② 작은 버튼 |
| 할 일 | task-inline.js | 바꾸기 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 할 일 | task-inline.js | 취소 | `mini` | ② 작은 버튼 |
| 할 일 | task-inline.js | data-task-inline-action | `task-inline-danger` | ② 작은 버튼(지우기 빨강) |
| 할 일 | task-row-view.js | — | `tl-task-main` | ② 작은 버튼 |
| 할 일 | task-row-view.js | ⋮ | `tl-menu-trigger` | ⑥ 아이콘 |
| 할 일 | task-row-view.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | task-row-view.js | 메모 | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 할 일 | task-row-view.js | 삭제 | 클래스 없음 | ② 작은 버튼(지우기 빨강) |
| 할 일 | task-week-pick.js | data-week-day | `task-week-end` | ② 작은 버튼 |
| 할 일 | task-workflow.js | data-meeting-action-edit | `gt-main` | ② 작은 버튼 |
| 할 일 | task-workflow.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 할 일 | task-workflow.js | 삭제 | `gt-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 담당조직 | team.js | 이걸로 | `mini` | ② 작은 버튼 |
| 담당조직 | team.js | data-report-week | `quick-pill-button` | ⑤ 보기 바꾸기 |
| 담당조직 | team.js | 달기 | `area-untagged-btn` | ② 작은 버튼 |
| 담당조직 | team.js | 자동 저장 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | team.js | 연결 해제 | `mini` | ② 작은 버튼 |
| 담당조직 | team.js | 사업영역 관리 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 되돌리기 | `feed-undo-btn` | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | — | `feed-chip…` | ④ 칩 |
| News(소식·통화) | telegram-feed.js | 폴더 메뉴 | `feed-more feed-folder-more` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 날짜별 | 클래스 없음 | ④ 칩 |
| News(소식·통화) | telegram-feed.js | 방별 | 클래스 없음 | ④ 칩 |
| News(소식·통화) | telegram-feed.js | + 폴더 | `feed-chip is-add` | ① 주 동작 또는 ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 보관함 | `feed-chip is-box` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | ‹ 소식 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | ‹ 소식 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | ‹ 소식 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 소식 메뉴 | `feed-more` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | data-tg-act-btn | `feed-act feed-act-…` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-rdopen | `feed-rdb` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-rdmore | `feed-hov` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 고정 풀기 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-roomopen | `feed-rdb` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-rdmore | `feed-hov` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | data-tg-rdopen | `feed-rdb` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 꺼내기 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 되살리기 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 되살리기 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 다시 시도 | `feed-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | 이전 날 더 보기 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-pin-open | `feed-pinbar` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 텔레그램에서 열기 | `feed-open` | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | AI 원래 요약으로 | `feed-text-btn feed-se-orig` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-open | `feed-dib` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 소식 메뉴 | `feed-more` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | ‹ 소식 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 이전 날 | `feed-nav` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 다음 날 | `feed-nav` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 요약 고치기 | `copy-mini` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | ‹ 소식 | `back-text` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 이전 날 더 보기 | `feed-text-btn` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 이름 붙이기 | `feed-whotag` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-rt-more | `feed-rt-more` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-sbox-chip | `feed-chip` | ④ 칩 |
| News(소식·통화) | telegram-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 취소 | `feed-small` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 이름 붙이기 | `feed-whotag` | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-person-more | `feed-more` | ⑥ 아이콘 |
| News(소식·통화) | telegram-feed.js | 다시 시도 | `feed-text-btn` | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | 보낸 사람 이름 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 휴지통 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 요약 복사 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 요약 고치기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-act | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 조직 연결 | 클래스 없음 | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | 삭제 | `feed-menu-danger` | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | telegram-feed.js | 나 표시 빼기 | 클래스 없음 | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | 나로 표시 내가 한 부탁은 챙길 것에 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-pact | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 다른 사람과 합치기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 지우기 소식 글은 그대로 | `feed-menu-danger` | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | telegram-feed.js | data-tg-ract | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 삭제 이 날 한 줄만 | `feed-menu-danger` | ② 작은 버튼(지우기 빨강) |
| News(소식·통화) | telegram-feed.js | 폴더로 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 보관 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | data-tg-fpick | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 폴더에서 빼기 | 클래스 없음 | ③ 글자 버튼 |
| News(소식·통화) | telegram-feed.js | + 새 폴더 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 이름 바꾸기 | 클래스 없음 | ② 작은 버튼 |
| News(소식·통화) | telegram-feed.js | 폴더 지우기 방은 그대로 | `feed-menu-danger` | ② 작은 버튼(지우기 빨강) |
| 그 밖 | text-backfill-notice.js | 알림 닫기 | `text-done-close` | ⑥ 아이콘 |
| 그 밖 | time-photos.js | 골라 붙이기 | `mini tp-open` | ② 작은 버튼 |
| 그 밖 | time-photos.js | 닫기 | `mini` | ② 작은 버튼 |
| 그 밖 | time-photos.js | 붙이기 | `mini tp-attach` | ② 작은 버튼 |
| 메뉴·머리줄·검색 | topbar-actions.js | data-topline-add | 클래스 없음 | ① 주 동작 또는 ② 작은 버튼 |
| 그 밖 | update-places.js | data-sheet-value | `home-choice-chip` | ④ 칩 |
| 그 밖 | update-places.js | data-depth | `home-choice-row home-choice-pick` | ④ 칩 |
| 그 밖 | version-notice.js | 새로고침 | `kptu-notice-line-action` | ② 작은 버튼 |
| 그 밖 | version-notice.js | 닫기 | `kptu-notice-line-close` | ⑥ 아이콘 |
| 그 밖 | wait-state.js | 다시 | `wait-retry` | ③ 글자 버튼 |
| 그 밖 | week-pick.js | 지난 주 | `week-pick-step` | ⑥ 아이콘 |
| 그 밖 | week-pick.js | 다음 주 | `week-pick-step` | ⑥ 아이콘 |
| 그 밖 | week-pick.js | 이번 주 | `week-pick-now` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | ↗ | `wl-src` | ③ 글자 버튼 |
| 담당조직 | weekly-org-lines.js | ✓ 넣기 | `wl-btn is-main` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 고치기 | `wl-btn` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | × | `wl-btn` | ⑥ 아이콘 |
| 담당조직 | weekly-org-lines.js | 그대로 두기 | `wl-btn` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 내 글로 바꾸기 | `wl-btn` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 빼기 | `wl-btn` | ③ 글자 버튼 |
| 담당조직 | weekly-org-lines.js | 취소 | `wl-btn` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 저장 | `wl-btn is-main` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 줄 | `wl-more is-last` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 가져오기 | `wl-btn` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 모두 가져오기 | `wl-btn` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | 외 줄 | `wl-more` | ② 작은 버튼 |
| 담당조직 | weekly-org-lines.js | + 줄 | `wl-add` | ① 주 동작 또는 ② 작은 버튼 |
| 그 밖 | weekly-summary-table.js | 주간 정리에서 보기 › | `biz-week-go` | ⑥ 아이콘 |
| 그 밖 | weekly-summary-table.js | data-bp-open | `biz-cell-line` | ② 작은 버튼 |
| 그 밖 | weekly-summary-table.js | 저장 | `mini` | ① 주 동작 또는 ② 작은 버튼 |
| 그 밖 | weekly-summary-table.js | data-bp-cell | `biz-write-open` | ③ 글자 버튼 |
| 그 밖 | weekly-summary-table.js | data-bp-cell | `biz-write-open` | ③ 글자 버튼 |
| 그 밖 | weekly-summary-table.js | data-bp-open | `biz-cell-line` | ② 작은 버튼 |
| 그 밖 | weekly-summary-table.js | data-bp-open | `biz-cell-line` | ② 작은 버튼 |
| 담당조직 | workplace-detail.js | data-wd-report-open | `wd-doc-main wd-report-main…` | ② 작은 버튼 |
| 담당조직 | workplace-detail.js | 연결 해제 | 클래스 없음 | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 다시 불러오기 | 클래스 없음 | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 기록 | `wd-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | workplace-detail.js | 현황 표 | `wd-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | workplace-detail.js | 기존 할 일 연결 | `wd-text-btn` | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 할 일 추가 | `wd-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | workplace-detail.js | 자료 올리기 | `wd-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | workplace-detail.js | 연결 | `wd-text-btn` | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 사업 보고 추가 | `wd-add-plus` | ① 주 동작 또는 ② 작은 버튼 |
| 담당조직 | workplace-detail.js | 주요 인물 | `wd-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | workplace-detail.js | 기본 정보 | `wd-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | workplace-detail.js | 소속 | `wd-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | workplace-detail.js | 이전 요약 | `wd-tab` | ⑤ 보기 바꾸기 |
| 담당조직 | workplace-detail.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 담당조직 | workplace-detail.js | 삭제 | `wd-danger` | ② 작은 버튼(지우기 빨강) |
| 담당조직 | workplace-detail.js | 기록 메뉴 | `wd-up-more` | ⑥ 아이콘 |
| 담당조직 | workplace-detail.js | 다시 불러오기 | 클래스 없음 | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 조직에서 빼기 | 클래스 없음 | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 다시 불러오기 | 클래스 없음 | ③ 글자 버튼 |
| 담당조직 | workplace-detail.js | 전체 개 보기 › | `wd-doc-all` | ⑥ 아이콘 |
| 담당조직 | workplace-detail.js | 메모 삭제 | `wd-danger` | ② 작은 버튼(지우기 빨강) |
| 담당조직 | workplace-detail.js | 수정 | 클래스 없음 | ② 작은 버튼 |
| 담당조직 | workplace-detail.js | 삭제 | `basket-link-danger` | ② 작은 버튼(지우기 빨강) |
| 담당조직 | workplace-report.js | 열기 | `mini` | ③ 글자 버튼 |
