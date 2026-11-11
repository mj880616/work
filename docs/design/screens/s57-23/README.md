# S57-23 화면 사진 (가짜 데이터)

고치기 전(`before-*`)·후(`after-*`) 사진이다. 파일 이름·회의 이름은 모두 지어낸 값이다. 만드는 법: `UI_REVIEW_DIR=docs/design/screens/s57-23 UI_REVIEW_PHASE=before|after npx playwright test tests/app-e2e/file-row-menu-stacking.spec.mjs tests/app-e2e/meeting-name-panel-no-hscroll.spec.mjs`.

## ① 창 안 파일 줄 ⋯ 메뉴 — 아래 줄 ⋯ 단추가 메뉴 위로 비침

원인: 사업 보고 자료 줄 ⋯(`<details class="file-line-more">`, `ui-standard.css`)가 줄마다 `position:relative; z-index:2`로 제 쌓임 칸을 만들어, 안의 메뉴(`z-index:8`)가 그 칸에 갇힌다. 아래 줄의 같은 ⋯ 칸(`z-index:2`, 문서에서 더 뒤)이 같은 높이에서 더 위에 그려져 메뉴 위로 비쳤다. 고침: 열린 ⋯ 칸만 `z-index:3`.

| 창 | 줄 ⋯ 부품 | 줄마다 쌓임 칸 | 비침 | 처리 · 확인 |
| --- | --- | --- | --- | --- |
| 사업 보고 결과 창(폰) · PC 3단 오른쪽 결과 칸 — 회의자료 | `details.file-line-more` (`meeting-columns.js fileMoreHtml`) | 있음(z-index:2) | 있었음 | **고침**(`.file-line-more[open]{z-index:3}`). `before-/after-meeting-files-{412,1280}.png` |
| 할 일 [파일 붙이기] 창 | `details.row-more` (`row-more.js`), 메뉴 `.row-more-menu` z-index:40 | 없음 | 없음 | 그대로. `after-task-files-{412,1280}.png`, 시험 `file-row-menu-stacking` ② |
| 담당조직 상세 [자료] | `details.wd-doc-more`, `.wd-doc-panel` z-index:8 | 없음 | 없음 | 그대로. 시험 ③(줄 모양 fixture), `after-org-docs-*` |
| 프로젝트 상세 [자료] | `details.ps3-more`, `.ps3-more-panel` z-index:8 | 없음 | 없음 | 그대로. 시험 ③, `after-project-docs-*` |
| 노트 상세 첨부 | `button.note-file-more` → 공용 떠 있는 메뉴 `#noteDocMenu`(`position:fixed; z-index:1600`, 맨 위 층) | 줄 안에 메뉴 없음 | 없음 | 그대로(구조상 줄 밖 메뉴). |
| 바구니 상세 첨부 카드 | 줄 ⋯ 메뉴 없음(단추) | — | — | 해당 없음 |

## ② PC 사업 보고 추가 창 [회의명] 고르기 창 — 아래 가로 막대

원인: 줄 끝 ⋯(`.icon-btn.mnp-more`, 폭 30px)에 공용 규칙(`base-ui.css` 44px 누르는 자리 `::after`)이 걸려 단추 양옆으로 7px씩 나오고, 오른쪽 7px이 창(`overflow-y:auto` → 가로도 auto)의 가로 넘침이 됐다(폭 정하는 `place()`·긴 이름은 원인 아님). 고침: `app/meeting-name-panel.css` — 누르는 크기 44×44는 그대로, 오른쪽 끝을 단추 끝에 맞추고 왼쪽으로만 넓힘. `before-/after-name-panel-{412,884,1280,1920}.png`
