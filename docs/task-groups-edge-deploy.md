# TASK-할일묶음: Google Tasks 조회 범위 Edge 선행 배포

기준: main `3dce97c5ef745505622ab1e05bbac394109342ce`, 운영 `google-tasks` v12(2026-09-28 기록). 이 문서는 배포 절차이며, 이 PR에서 운영 Edge를 배포하지 않는다. 배포는 별도 승인 뒤 Claude Code 로컬 manual mode에서만 한다.

## 호환 계약

- 기존 `action=overview`·`action=tasks` 요청과 응답은 그대로 둔다. 옵션이 없거나 알 수 없는 값이면 기존처럼 미완료는 기한 지남과 한국 날짜 오늘~6일, 완료는 최근 3일만 반환한다.
- 새 앱은 `GET .../google-tasks?action=overview&pending_scope=all`을 쓴다. `action=tasks`도 같은 옵션을 지원한다. 성공 응답에는 기존 필드와 함께 `pending_scope: "all"`이 추가된다. 이 표식이 없으면 새 앱은 확장 범위가 배포되지 않은 것으로 판단할 수 있다.
- 새 옵션의 미완료는 기본 Google 목록의 기한 지남·오늘~6일·7일 이후·기한 없음 전부를 페이지 끝까지 읽는다. 완료는 계속 최근 3일만 읽는다. `unlinked`는 기존대로 프로젝트·조직의 확정 연결만 연결로 보며, 회의 연결만 있는 항목도 연결 안 된 쪽에 남는다. `linked`의 범위는 바꾸지 않는다.
- 앱 화면의 묶음·표시·삭제·편집창 저장 잠금은 후속 앱 PR에서 구현한다. Edge 배포만으로 화면은 바뀌지 않는다.

## 배포 전 정지 지점

1. 이 PR의 merge와 Edge 배포에 대한 별도 승인을 확인한다. 운영 DB 변경은 없다.
2. Claude Code 로컬에서 `npx.cmd supabase functions list`를 실행해 `google-tasks`의 직전 버전과 `verify_jwt=false`를 기록한다. 기준은 `docs/web2-env6b-edge-source.md` 5절의 v12·false다. 버전·설정이 달라졌다면 멈추고 원인을 확인한다.
3. 배포 대상이 merge된 main의 `supabase/functions/google-tasks/index.ts`인지 확인하고, 기존 옵션 없는 요청이 같은 응답을 내는 테스트와 새 옵션 테스트가 통과했는지 확인한다.

## 승인 후 배포·검증

1. 대상 함수만 `npx.cmd supabase functions deploy google-tasks --no-verify-jwt --use-api`로 배포한다. `--prune`은 쓰지 않는다.
2. `npx.cmd supabase functions list`에서 버전 증가와 `verify_jwt=false` 유지를 확인한다.
3. 데이터 생성 없이 OPTIONS/CORS와 비로그인 거부를 확인한다. 현재 비로그인 응답이 401 대신 400인 것은 별도 `일정 인증-1` 범위로 기록돼 있다. 인증 우회나 권한 완화로 해결하지 않는다.
4. 권한 있는 세션에서 옵션 없는 `overview`와 새 `overview&pending_scope=all`을 비교한다. 새 응답의 `pending_scope` 표식, 미완료 기한 없음·7일 이후의 포함, 완료 최근 3일 유지, 기존 응답 필드 유지를 확인한다. 확인 기록에는 개수와 상태만 남기고 할 일 제목·내용·토큰은 남기지 않는다.

## 복구

문제가 있으면 앱 PR을 진행하지 않는다. 기준 main `3dce97c5ef745505622ab1e05bbac394109342ce`의 `google-tasks` 원본을 별도 checkout에 준비하고, 같은 함수 이름·`--no-verify-jwt --use-api` 옵션으로 재배포한다. 복구 뒤 버전 증가·`verify_jwt=false`·기존 `overview` 응답·비로그인 거부·OPTIONS/CORS를 다시 확인한다. 회의 연결이 있는 운영 환경이므로 v11 이하 원본으로 되돌리지 않는다.
