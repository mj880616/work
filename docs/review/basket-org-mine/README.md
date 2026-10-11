# 📱 폰 가능 · BASKET-3-보완 검토

1. **세션:** Codex 웹. 운영 접속·DB/RLS 변경·Edge 배포·workflow 수동 실행·merge 없이 파일·PR 준비.
2. **시작·최종 SHA, branch, PR:** 원격 main을 새로 fetch한 시작 SHA `741fd7675edbd621ccb377e291ffd01e107dac1d`. `codex/basket-org-mine`. 최종 SHA·PR 번호·자동 CI/전체 브라우저 결과는 PR 본문·최종 댓글에 기록한다.
3. **원인(사실):** 서버 `core.mjs`와 화면 `basket-ai-handoff.js`가 workspace의 모든 조직을 읽어 AI 안내에 나열했다. 담당 연결·활성 여부를 적용하지 않았다. `home-read.js`는 현재 소유자의 `user_id`로 assignees를 읽고 `weekUpdates`가 `active !== false`와 교차한다. `suborganizations.js`는 실제 연결이 전혀 없는 조직에만 `default_assignee_name`과 소유자 표시 이름을 정규화해 비교하며 “계정 연결 전”으로 표시한다. 이름 보조 규칙은 홈과 다른 의미이고 계정 연결을 확정하지 않으므로 이번 기준에서 제외했다. 운영 데이터에서 두 집합의 실제 차이·건수는 조회하지 않았다.
4. **변경 파일:** 두 경로가 같은 `selectBasketOrganizations` 정의(활성 + 소유자 실제 연결)를 사용한다. Edge 배포 폴더와 브라우저 로딩 경계를 유지하도록 각 경로에 동일한 순수 선택 함수 1개씩 두고, 15개 입력 조합의 결과 동등성을 검사한다. 새 저장소·테이블 없음. 담당이 0개·비활성만 연결·담당 조회 실패면 전체 활성 목록으로 대체하고 목록 위에 “담당조직이 지정되지 않아 전체 조직을 싣습니다”를 출력한다. 서버의 조직 사본 전문·프로젝트/회의 prefix, 나머지 안내 문장·파서·확정 RPC는 유지한다. `active` 조회 필드 추가는 바구니 필터에만 사용하고 조직 사본 본문을 줄이지 않는다. 캐시: handoff 3→4, basket 10→11, view-loader 125→126, loader-v2 358→359, app 246→247, index modulepreload·script. 버전 기대 E2E와 smoke 문자열도 동시 갱신.
5. **테스트:** 시작 main Node 520/520. 추가한 담당·대체 회귀 13개가 구현 전 41통과/13실패(전체/비활성 출력 때문에 실패), 구현 후 관련 54/54 통과. 이후 두 경로 동등성·cron 소유자 모호성·연결 페이지 완료 검사를 추가했다. 최종 전체 Node 550/550 통과(`tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs personal/arsenal-match-archive/*.test.mjs`). 인접 브라우저 결과는 PR 댓글에 기록한다. 로컬 격리 PostgreSQL 59/59 통과. Deno 2.5.4 `check supabase/functions/drive-summary/index.ts`·`lint supabase/functions/drive-summary` 통과. 캐시 운영 참조 423개, smoke 다중행 검사 12개·저장소 감사·diff 공백 검사 통과. Chromium/Playwright 1.55: 관련 분류·캐시·신규 검사 38/38, 신규 담당조직 검사 최종 8/8. 390/1280px 실제 clipboard 전문 = 수동 복사 textarea, 담당 2개·0개·비활성만·조회 실패, 목록 밖 조직 미리보기/확정 RPC 처리, 정상 console/pageerror 0. 기존 검사 삭제·약화 없음.
6. **CI:** PR 생성·마지막 push로 발생하는 자동 CI를 조회한다. 수동 workflow 실행 없음. 최종 SHA의 CI·전체 브라우저 회귀 실행 링크/결과는 최종 PR 댓글에 기록한다. 실패하면 이름과 시작 main 재현 여부를 명시한다.
7. **DB·production 영향 및 보안:** 클라이언트는 기존 runtime 인증·소유자 RLS를 그대로 사용하며 조직은 workspace 범위로 읽고 담당 ID와 교차한다. 서버는 인증 완료된 owner ID를 쓰고 cron만 고정 slug workspace의 sole owner를 조회한다. 담당 연결 조회는 조직 `!inner(workspace_id)` + 고정 workspace + 신뢰된 owner ID로 제한한다. 클라이언트 payload의 사용자/조직/workspace ID를 권한 판단에 쓰지 않는다. 연결 페이지 실패는 부분 결과를 버리고 대체한다. 인증/전체 원본 조직 조회 실패는 기존처럼 실패로 처리하며, 데이터를 확보하지 못한 목록을 임의로 만들지 않는다. 배포 정지 지점은 아래 사용자 승인형 버튼 절차다. 운영 v4·source `d85e334`(#491)는 사용자 제공 이력이며 운영 재조회 없음.
8. **사용자 확인:** 승인 후 재배포·사본 갱신을 거쳐 Drive ‘프로젝트 현황’ 사본 바구니 절이 내 담당조직만 싣는지, 바구니 ‘AI에게 맡기기’ 복사 글도 같은 목록인지 확인한다. 담당 0개/조회 실패면 대체 문구와 전체 활성 조직을 확인한다.
9. **남은 위험:** Edge는 재배포 전까지 기존 v4를 실행한다. `default_assignee_name`만 있는 조직은 이름에 맞아도 실제 담당 연결로 보지 않는다. 담당 연결 조회 장애가 발생하면 요청한 대체 문구로 전체 활성 조직을 안내한다. 실제 운영 자료/기기 검증은 사용자 확인 사항이다.
10. **범위 밖:** 원장 24 담당조직 3중 저장 통합은 대기 유지. 사진만 있는 메모에 AI 근거가 없는 것은 설계상 정상이며 이번 범위 밖. 전체 브라우저 기존 실패가 있으면 수정·약화 없이 최종 댓글에 별도 기록한다.
11. **roadmap:** BASKET-3-보완을 대기→진행중, 사용자 결정 2→1→3→4→5와 시작 SHA/브랜치를 기록했다. 같은 PR에서 번호·검증 보고 링크를 갱신한다.
12. **merge:** 미실행. PR만 준비하며 운영 배포도 미실행.

## 배포 안내

커맨드센터 승인 → 사용자가 Edge 배포 workflow 수동 실행 → production-edge 승인. AI는 실행하지 않는다.

| 입력 | 값 |
| --- | --- |
| function | `drive-summary` |
| ref | **merge 후 SHA** |
| first_deploy | `false` |
| verify_jwt | `keep` |
| expect_unauth_401 | `true` |
| 되돌리기 ref | `d85e334` (운영 v4, #491) |

배포 전 현재 version/JWT/시각 확인 → 같은 JWT 정책으로 배포 → version 증가·비로그인 POST 401·OPTIONS 200/204 확인. 문제가 생기면 같은 승인형 버튼에서 ref만 `d85e334`로 바꾸어 재배포한다. 화면 변경은 필요 시 이번 PR을 되돌리는 별도 PR로 복구한다.

## 합성 전문과 캡처

생성기: `node docs/review/basket-org-mine/generate-examples.mjs`. 실제 조직명·개인정보 없음. 활성 3개·비활성 1개 중 2개 담당 사례, 담당 0개 대체 사례를 실제 선택/출력 함수로 생성한다.

- [사본 바구니 절 전문](../../basket-org-only-drive-example.txt) · [복사 글 전문](../../basket-ai-handoff-prompt-example.txt)
- [사본 대체 전문](../../basket-org-mine-drive-fallback.txt) · [복사 글 대체 전문](../../basket-org-mine-handoff-fallback.txt)
- 담당 2개: [390px](orgs-two-390.png) · [1280px](orgs-two-1280.png)
- 담당 0개: [390px](orgs-zero-390.png) · [1280px](orgs-zero-1280.png)
