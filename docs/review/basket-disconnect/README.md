# BUG-바구니연결해제 캡처 (390, 라이트·다크)

`tests/app-e2e/basket-link-disconnect.spec.mjs`가 `CAPTURE_DIR`를 주면 이 폴더에 저장한다(모의 API, 실제 앱 화면).

| 화면 | 라이트 | 다크 |
| --- | --- | --- |
| 조직 상세 🧺 줄 ⋯ 메뉴 | org-menu-390-light.png | org-menu-390-dark.png |
| 조직 상세 해제 뒤 5초 [되돌리기] | org-undo-390-light.png | org-undo-390-dark.png |
| 프로젝트 상세 🧺 줄 ⋯ 메뉴([메모 열기]·[연결 해제]만) | project-menu-390-light.png | project-menu-390-dark.png |
| 프로젝트 상세 해제 뒤 [되돌리기] | project-undo-390-light.png | project-undo-390-dark.png |
| 바구니 목록 메모 줄 칩 × | basket-list-390-light.png | basket-list-390-dark.png |
| 바구니 목록 해제 뒤 [되돌리기] | basket-list-undo-390-light.png | basket-list-undo-390-dark.png |
| 메모 화면 연결 칩(누르기 = 열기, × = 해제) | note-chips-390-light.png | note-chips-390-dark.png |
| 메모 화면 해제 뒤 [되돌리기] | note-undo-390-light.png | note-undo-390-dark.png |

확인 창 문구는 브라우저 기본 창이라 캡처에 찍히지 않는다. 검사가 받은 문구: "○○ 연결을 해제할까요? 메모는 남아요".
회의·자료실 칩에는 ×가 없다(기존 연결 만들기 경로로 되돌릴 수 없음).
