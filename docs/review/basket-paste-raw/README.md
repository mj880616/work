# 📱 BASKET-붙여넣기수정 검증

기준 origin/main: `6a5efd98ac8535e660881fa9487a84e07afe28ee` (#494 merge).
브랜치: `codex/basket-paste-raw`.

코드 블록 복사 버튼이 반환하는 표시 없는 JSON, 단일 json 블록, 설명과 단일 블록이 있는 답 전체를 받는다. 설명과 JSON만 섞인 글·블록 2개·표시 줄 1개는 거절한다. 모든 허용 입력은 기존 엄격 파서를 통과해야 한다. 크기·개수·중복 키·UUID·날짜·kind 검사는 변경하지 않았다.

확인 중 파서 오류나 현재값 읽기 오류가 나면 결과 문구를 `scrollIntoView({block:'nearest'})`로 보여 준다. CSS·버튼 배치·classificationFormat·Drive 사본 안내·서버 코드는 변경하지 않았다.

- 수정 전: 내용만 입력 Node/Chromium 실패와 화면 밖 오류 문구 Chromium 실패를 확인.
- Node: `node --test tests/*.test.mjs tests/domain/*.test.mjs tests/security/*.test.mjs scripts/*.test.mjs` — 513/513 통과.
- Chromium 151 (`/usr/bin/chromium`): 바구니 분류·일반 바구니·홈 기본 입력·첨부 아이콘·calendar-hotfix·startup-performance·task-layout-groups 81/81 통과. 새 입력/오류 경로 390/1280px 콘솔 오류 0. 기존 함수 없음 404 테스트는 예상 콘솔 오류 1개를 그대로 검사한다.
- 캐시 검사: `node scripts/check-loader-cache.mjs --base 6a5efd98ac8535e660881fa9487a84e07afe28ee` — 운영 참조 410개 통과.
- 변경 JS 문법·route-first 시작 마커·diff 공백 검사 통과. 별도 코드 리뷰에서 수정할 문제 없음.
- GitHub 자동 CI 결과는 해당 PR 최종 head 기준 보고/댓글 참조. workflow 수동 실행·재실행·승인 없음.

캐시 경로: classification 4 → classification-ui 5 / ai-handoff 3 → basket 10 → view-loader 123 → loader-v2 356 → app 244 → index.html. 기대 버전 테스트와 app-smoke-check 고정 버전 동시 갱신.

[390px 오류 문구](raw-paste-error-390.png) · [1280px 오류 문구](raw-paste-error-1280.png). 로컬 합성 데이터와 차단된 API fixture만 사용했다. 실제 운영·DB·Edge·Drive 접속 없음. AI 복사 버튼 → 바구니 붙여넣기는 merge 뒤 실기기에서 확인한다. 문제가 생기면 이 PR 변경을 되돌리는 별도 PR로 복구한다.
