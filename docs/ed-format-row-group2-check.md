# ED-서식줄묶음2 확인 메모 (2026-10-24)

결론: 구현할 것이 없다. 옛 마크다운 편집기(`app/md-editor.js`)는 이미 폰 서식 줄 묶음을 쓰고 있다.

- 묶음 정의: `app/md-toolbar-layout.mjs` (제목 ▾ · 굵게 · 글자 ▾ · 문단 ▾ · 넣기 ▾ · ↶ · ↷).
- 묶음 동작: `app/md-editor.js`가 #1047의 공용 `createGrouping`(`app/toolbar-pop.js`)을 그대로 불러 쓴다.
- 시험: `tests/md-toolbar-groups.test.mjs` (4건 통과).
- 이 편집기에는 기호 버튼이 없어 기호 ▾ 묶음은 만들지 않았다(레이아웃 파일 주석).

## md-editor.js를 쓰는 화면

| 화면 | 입구 | 곧 새 편집기로 옮겨지는지 |
| --- | --- | --- |
| 업데이트 큰 창(바구니) | `basket.js` `openBigWriter` | 예(업데이트 단계) |
| 큰 쓰기 창(홈 입력 [크게]) | `home-quick.js` → `write-window.js` | 예 |
| 프로젝트 기록 [크게] | `project-system-v3.js` → `write-window.js` | 예 |
| 사업장 인박스 [크게] | `workplace-detail.js` `wdOpenBig` → `write-window.js` | 예 |
| 사업장 큰 창에서 수정 | `workplace-detail.js` → `openMarkdownEditor` | 예 |
| 상단 줄 쓰기 / 기록 위치 | `topbar-actions.js`·`update-places.js` → `write-window.js` | 예 |
| 노트 | `note-window.js` (이미 새 편집기, #1132) | 이미 옮겨짐 |
| 복사 함수만 | `journal.js`·`todo-radar.js`·`share-pages.js` (`copyText`, 편집기 화면 아님) | 해당 없음 |
