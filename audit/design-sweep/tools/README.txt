디자인 전수 점검(2026-10-27) 재현 도구. 제품 코드는 건드리지 않는다.
- fake.mjs: 가짜 Supabase 응답(지어낸 데이터). 실제 로그인·실제 데이터 없음.
- capture.spec.mjs: 주요 화면 15개 × 1920·1280·390 스크린샷 + DOM 수치(metrics-*.json).
- popups.spec.mjs: 창·메뉴·하위 화면 스크린샷과 수치.
- items.mjs + shots.spec.mjs: 항목별 before / fix_css 주입 후 after.
- share.spec.mjs: 공개 공유 페이지(/share/).
실행: 저장소 루트에서 python3 -m http.server 8123 을 띄운 뒤
  SWEEP_OUT=<출력폴더> npx playwright test audit/design-sweep/tools/<파일> --browser=chromium
