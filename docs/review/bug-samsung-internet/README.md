# BUG-삼성인터넷 900px 캡처

Playwright Chromium, 삼성 인터넷 UA(`SamsungBrowser/27.0`), 폭 900px, 가짜 Supabase 응답.

- `*-before.png`: 현재 JS에 #584 이전 `project-system-v3.css`를 넣은 화면(낡은 CSS 사본 재현). 사용자 보고 증상과 같음: 이름·"일정 없음"이 오른쪽으로 밀리고 › 가 가운데, 줄 높이 비정상, 색 점 안 보임, 색 8개가 빈 납작한 칸.
- `*-after.png`: 이 PR의 현재 CSS·JS 화면.

브라우저 엔진 차이가 아니라 전달된 CSS 사본 차이로 같은 증상이 나온다는 확인용이다. 실제 삼성 인터넷 화면 확인은 사용자 기기에서 한다.
