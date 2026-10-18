# UI-키보드하단바 화면 검토

📱 폰 가능. 메뉴 [쓰기] 큰 편집기 배치와 폰 하단 탭의 자판 처리.

- `writer-390-light.png`·`writer-390-dark.png`: 머리줄 한 줄 [× 닫기] [메모|노트] [쓰기|미리보기] … [내보내기 아이콘] [저장] → 서식 도구줄 → 본문 → 하단 탭 6칸.
- `writer-keyboard-390-*.png`: 자판이 뜬 상태(뷰포트를 444px로 줄여 흉내). 하단 탭이 숨고 본문이 자판 바로 위까지 내려옴. 그 아래 보이는 홈 화면 자리가 자판 자리.
- `writer-leave-390-*.png`: 글이 있는 쓰기 창에서 하단 탭을 누른 뒤의 "저장 안 하고 닫을까요?" [계속 쓰기]·[저장 안 하고 이동].
- `writer-1280-light.png`·`writer-1280-dark.png`: 넓은 화면. 같은 순서이고, [쓰기|미리보기] 대신 글·미리보기가 나란히 보임.

캡처는 `UI_REVIEW_DIR=<이 폴더> npx playwright test tests/app-e2e/ui-keyboard-tabbar.spec.mjs`로 다시 만든다.
