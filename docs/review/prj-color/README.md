# PRJ-색 캡처 (390px, 밝은/어두운)

`PRJ_COLOR_CAPTURE=1 npx playwright test tests/app-e2e/project-color.spec.mjs --browser=chromium` 로 다시 만든다. 화면 데이터는 합성(네트워크만 가짜, 앱 코드는 실제).

| 파일 | 내용 |
| --- | --- |
| `list-390-light.png` / `list-390-dark.png` | 프로젝트 목록. 초록 메인 → 하위는 연한 초록, 색 없는 메인 → 회색(하위는 연한 회색), 허용되지 않은 값 → 회색 |
| `detail-child-390-light.png` / `detail-child-390-dark.png` | 하위 프로젝트 상세 머리줄: 위계(← 상위) 그대로, 제목 앞 연한 톤 점, ⋯ 메뉴 그대로 |
| `create-390-light.png` / `create-390-dark.png` | 프로젝트 만들기 창: 상위 프로젝트 아래 색 8개(파랑 선택 표시). 상위를 고르면 색 칸이 숨겨짐 |
