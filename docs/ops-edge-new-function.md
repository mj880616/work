# 📱 폰 가능 — 신규 Edge 함수 최초 배포

이 문서는 OPS-Edge새함수의 파일·PR 준비 기록과 사용자 절차다. 운영 조회·배포·workflow 실행은 하지 않았다. 규칙 원문은 [AGENTS.md §8](../AGENTS.md#8-edge-function-배포-claude-code-로컬--커맨드센터-승인-시-codex-로컬--사용자-승인형-workflow)이며, 규칙 변경 사용자 승인 후 커맨드센터에서 merge한다.

## 사용자 절차(폰)

1. 커맨드센터에서 배포할 소스 SHA·함수 이름·JWT 정책·HTTP 기대값을 승인한다. 해당 SHA에 `supabase/functions/<함수>/index.ts`와 [ENV-6b 문서 5절](web2-env6b-edge-source.md#5-production-함수-전체-verify_jwt-env-7-배포-때-기준표)의 함수 행이 있어야 한다. 신규 행은 배포 대기로 표시하고, 운영 합계에는 배포 확인 전 포함하지 않는다. `basket-files` 행·코드는 후속 서버 PR에서 준비한다.
2. GitHub Actions → Approved Edge Function deployment → Run workflow를 연다. workflow가 반영된 main에서 버튼을 열고 `function`에 승인된 이름, `ref`에 승인된 소스 SHA, `first_deploy=true`, `verify_jwt=true` 또는 `false`(5절 표와 동일)를 지정한다. `expect_unauth_401=true`를 유지하며 공개 함수에서만 승인된 `false`를 사용한다.
3. 사용자가 Run workflow를 누르고 `production-edge` environment 승인을 진행한다. AI는 실행·승인하지 않는다.
4. Summary에서 선택 소스 SHA, 최초 배포·JWT 정책, 생성된 함수의 version·verify_jwt·updated_at, POST 401(검사 대상만), OPTIONS 200/204를 확인한다. 정상 확인 뒤에 화면이 이 함수를 호출하는 후속 PR을 진행한다.

기존 함수 배포는 `first_deploy=false`, `verify_jwt=keep`이다. 기존 배포·소스 SHA로 되돌리기·HTTP 검사 방식은 유지한다. 최초 배포를 재시도할 때 동명 함수가 이미 있으면 실패하므로, 실패 후 무조건 재실행하지 않는다.

## 배포 전 검사

- 함수 폴더·index.ts 존재와 기존 경로 검사를 그대로 적용한다.
- 신규 모드는 JWT 정책을 명시해야 한다. 배포할 ref의 5절 본표에서 해당 이름이 정확히 1행이고 정책이 같아야 한다. 표 없음·불일치·중복·다른 절의 행은 실패한다.
- 직전 `functions list`에 동명 함수가 0개여야 한다. 기존 모드는 정확히 1개여야 한다.
- 기존과 같은 단일 함수 지정·`--use-api` 배포이며 false 정책에서만 `--no-verify-jwt`를 붙인다.

## 실패 시 수동 확인·되돌리기

실패해도 자동 삭제하지 않는다. Summary에는 “수동 확인·삭제 판단 필요(Edge 삭제는 금지 규칙 → 사용자 대시보드)”를 표시한다. 배포 전 실패·배포 요청 실패·사후 검사 실패를 구분하고 다음을 사용자 대시보드와 실행 기록에서 확인한다.

- 함수가 실제로 생성됐는지, 동명 함수가 정확히 1개인지.
- version이 양의 정수인지, verify_jwt가 승인한 명시값과 같은지, updated_at이 기록됐는지.
- 배포 요청까지 실행됐는지, 비로그인 POST 401과 OPTIONS 200/204가 확인됐는지. 공개 함수의 POST 생략은 승인한 기대값과 같은지.
- 화면이 아직 이 함수를 사용하지 않는지. 이전 버전이 없으므로 되돌리기 = 화면이 아직 이 함수를 쓰지 않는 상태 유지, 필요 시 사용자가 대시보드에서 함수 삭제 판단.

생성된 함수의 확인 후 재배포가 필요하면 기존 배포 모드(false/keep)로 별도 승인받는다. 삭제 기능·자동 복구·운영 토큰 출력은 추가하지 않았다.

