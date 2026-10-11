# 📱 폰 가능 · BASKET-조직만 검토 기록

2026-10-11 사용자 결정에 따라 바구니를 AI에게 맡기는 목적지를 담당조직으로만 안내한다. 기존 프로젝트 제안을 붙여 넣는 파서·미리보기·확정 흐름은 호환용으로 유지한다.

- 시작: 원격 `origin/main`을 다시 fetch한 `cc7ae1070fa4d690040e881dc03abc01be93fda8`(#490 merge).
- 브랜치: `codex/basket-org-only`. [#491](https://github.com/mj880616/work/pull/491). 최종 SHA·자동 CI 결과는 PR 본문·댓글에 기록한다.
- 사본 바구니 절: 담당조직 ID·이름만, “담당조직 목록 (ID · 이름)”. 프로젝트 목록·기타 kind 안내·별도 요약 제안 문장을 제거한다.
- 복사 글: “알맞은 담당조직으로 나눠 주세요”, `kind=organization` 안내와 예시만. `project-catalog` import/load 제거, 조직 페이지를 모두 읽은 뒤 세션·업무 공간을 다시 확인한다.
- Edge 배포는 함수 디렉터리의 모듈을 묶으며 앱은 브라우저 캐시 그래프로 불러온다. 배포 경계를 넓히는 공용 모듈 경로를 새로 만들지 않고, 두 안내의 첫 부탁·형식 안내 전문이 정확히 같다는 실행 테스트로 문장을 고정했다.
- 메모 필터·첨부 링크만·상한은 그대로. `core.mjs`·조직/프로젝트/회의 본문 렌더러·파서·확정 RPC·4b 변경 없음. `basket-classification.js`는 안내 함수만 변경했다.

## 검증

기존 관련 테스트 36/36 통과 후 기대값을 담당조직 전용으로 바꿨다. 변경 전 RED 32통과/7실패, 구현 뒤 신규 세션 변경 회귀를 포함한 GREEN 40/40. 테스트 삭제 없음. 프로젝트 목록을 기대하던 검사는 프로젝트 부재로 바꾸고, 기존 프로젝트 파서·화면 미리보기·확정 검사는 유지했다.

- Node: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs` — 506/506, 실패·skip 0.
- 담당조직 전체: 사본 501개(500개 페이지 경계), 복사 글 101개(100개 페이지 경계) 포함. 복사 글에서 프로젝트 목록 요청·카탈로그 호출·import 없음.
- 형식 안내: 두 경로의 전문 문자열 동일, 각각의 코드블록 예시·organization 제안 왕복 파싱, 기존 project 답 전체 파싱 통과.
- 시작 main의 합성 기존 출력 스냅샷: 조직 사본 전문·프로젝트 현황/회의 prefix를 바이트 단위로 비교. 바구니 절 밖 출력 동일.
- Node 문법·정적/HTTP smoke: `.github/workflows/app-smoke-check.yml`의 검사를 로컬에서 수행. 별도 8124 포트 서버 사용, 모두 통과. GitHub workflow 수동 실행 없음.
- 캐시: classification 3 → classification-ui 3 / handoff 2 → basket 8 → view-loader 120 → loader-v2 353 → app 241 → index. 기대 테스트·smoke workflow 고정 버전 함께 반영, 운영 참조 400개 통과.
- 브라우저 저장소 감사 통과. Deno 2.5.4 `check`(index.ts)·`lint`(basket.mjs) 통과.
- Chromium 151 / Playwright 1.55, 390/1280px, workers=2, retries=0: 관련·인접 144/145 통과(4.3분). 담당조직 복사·project 미호출·기존 project 답 전체 붙여넣기·미리보기·확정·실제 clipboard·첨부·Drive 사본 HTML·캐시 기대값 통과. 정상 기능의 콘솔 오류 0. 의도된 거절 응답 검사는 기존 기대 오류를 유지한다.
- 복사/연결 캡처: [390 복사](review/basket-org-only/handoff-copied-390.png) · [1280 복사](review/basket-org-only/handoff-copied-1280.png) · [390 연결](review/basket-org-only/handoff-connected-390.png) · [1280 연결](review/basket-org-only/handoff-connected-1280.png).
- 독립 리뷰: Critical/Important/Minor 지적 없음. 관련 Node 40/40, 시작 main snapshot·실제 builder 합성 예시·rollback 소스 바이트 일치 독립 확인.

범위 밖 기존 실패: `tests/app-e2e/basket.spec.mjs` 90행 `session scope change clears basket content and prevents a delayed response from restoring it`. 전체 배치 1실패, 단독 workers=1/repeat-each=3에서 **시작 main 3/3 실패·현재 브랜치 3/3 실패**. 시작 SHA를 `git archive`로 별도 경로에 풀고 앱 소스는 그대로, 테스트 URL 포트만 8125로 바꿔 비교했다. 실패는 지연 응답의 `BASKET_STALE_PRIVATE`가 원 계정 UI에 남는 negative assertion이다. trace·영상 보존, 테스트 제외·assertion 약화·timeout/retry 변경 없음.

사실: 테스트가 `context.set`으로 사용자 ID만 `different`로 바꾸지만 세션은 원 계정 그대로다. `runtime-client.js` 67~70행은 세션 소유자와 다른 ID를 거절해 context 변경이 성립하지 않는다. 이어지는 이벤트도 원 세션이므로 `basket.js`의 scope는 그대로다. 이는 실제 계정 전환을 재현하지 못하는 기존 테스트 설정이다. 추정: 지연 응답 처리와 부정 assertion 관측 순서에 따라 성공·실패가 갈릴 수 있다. 실제 다른 사용자의 운영 데이터 노출은 이 합성 테스트로 확인하지 않았다. trace에서 행 개수 0 검사는 응답 처리 전에 통과하고, 본문 부정 검사는 처리 뒤 실패했다. 독립 리뷰의 VM 대조에서는 `context.set`이 null을 반환해 scope 유지·무효화 0회였고, 실제 `session.write()`로 owner를 바꾸면 context가 비워져 scope 무효화가 발생했다. 해당 실제 계정 전환 시나리오의 브라우저 회귀 검증은 별도 보완이 필요하다. 요청 범위 밖이므로 이번 PR에서 테스트·runtime·세션 흐름을 고치지 않았다.

첫 브라우저 실행은 녹화용 ffmpeg의 Playwright 경로가 없어 `newPage` 전에 실패해 중단했다. 다운로드 주소는 환경 정책상 403이므로 시스템에 설치된 `/usr/bin/ffmpeg`를 연결한 뒤 같은 조건으로 다시 실행했다. 앱·테스트 assertion·timeout·retry 변경으로 우회하지 않았다.

## 합성 전문 예시

실제 계정·운영 데이터 없이 구현 함수에서 생성했다. ID·Drive 파일 ID는 모두 합성이다. 사본 링크는 실제 데이터에 접근하지 않고 문자열만 생성한다.

- [사본 바구니 절 전문](basket-org-only-drive-example.txt)
- [AI에게 맡기기 복사 글 전문](basket-ai-handoff-prompt-example.txt)

## 배포 준비 — 실행하지 않음

`drive-summary` 재배포가 필요하다. 커맨드센터가 merge·배포를 검토한 뒤 사용자가 `edge-function-deploy` workflow를 수동 실행하고 `production-edge`를 승인한다.

| 입력 | 배포 | 되돌리기 |
| --- | --- | --- |
| function | `drive-summary` | `drive-summary` |
| ref | `main`(이 PR merge 후 SHA 확인·기록) | `c7fdcac`(현재 운영 v3과 같은 소스, #485) |
| first_deploy | `false` | `false` |
| verify_jwt | `keep`(`false` 유지) | `keep`(`false` 유지) |
| expect_unauth_401 | `true` | `true` |

배포 후 version 증가·JWT 정책 유지·비로그인 POST 401·OPTIONS 200/204를 확인한다. 사본의 안내는 Edge 재배포 후 다음 사본 갱신부터 반영된다. 개발 세션에서는 운영 접속·DB 변경·Edge 배포·workflow 수동 실행·merge를 하지 않았다.

원장 `BASKET-조직만`은 진행중(이 PR), `BASKET-AI맡기기`는 완료(#490 merge `cc7ae10`). 실제 폰 확인·merge·배포는 커맨드센터와 사용자가 진행한다.
