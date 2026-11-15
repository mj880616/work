💻 PC 로컬 필요 — 배포·복구는 Claude Code 로컬에서 별도 승인 후 실행

# TASK-회의후속 ② google-tasks 배포 준비

이 문서는 실행 절차다. 이 PR에서는 배포·운영 DB 조회·변경을 하지 않는다. 앱·원장·migration도 변경하지 않는다.

## 기준과 선행 조건

- 작업 시작 main: `f6e252ffefef95a036605f0a87600d83e9469414` (선행 DB PR #349 포함).
- 사용자 확인: migration `20260928123601_task_meeting_followup_record_links` 운영 적용·사후 확인 완료. 이번 작업에서 운영 DB를 재조회하지 않았다.
- 최신 저장소 배포 기록: `docs/roadmap.md` TASK-구현 PR 3의 `google-tasks` **v11**, 2026-09-27 11:56 UTC, **verify_jwt=false**. `docs/web2-env6b-edge-source.md` 표의 v6은 이전 조사 기록이다. 배포 직전에는 반드시 실제 값을 다시 읽는다.
- `getUser(req)`가 Authorization의 사용자 JWT를 `admin.auth.getUser(token)`으로 검증한 뒤 모든 동작을 처리한다. `userDb(req)`는 anon 키 + 호출자 JWT를 사용한다. 회의·프로젝트·조직 확인 및 연결 읽기/쓰기는 이 클라이언트와 RLS로만 수행한다.
- service role은 기존 사용자 토큰 검증·Google 연결/설정 처리 용도만 유지한다. 회의 확인에 사용하지 않는다. 인증 방식·권한·CORS 설정은 변경하지 않는다.

## 요청·응답 계약

| 동작 | 요청 추가 | 응답과 기존 동작 |
| --- | --- | --- |
| `create`, `link` | `links`의 각 행에 `{meeting_id: UUID}` 허용 | 프로젝트·회의를 함께 연결하려면 `[{project_id: UUID}, {meeting_id: UUID}]`를 보낸다. 한 행에는 대상 하나만 허용, 합계 최대 20개, 중복 제거. 각 대상 workspace는 사용자 JWT로 조회한다. 클라이언트 workspace 값은 사용하지 않는다. |
| `links` | 기존 `task_id` 그대로 | `links`에는 기존 프로젝트·조직 행만, 새 `meeting_links`에는 회의 행만 반환한다. 모든 연결 행의 선택 칼럼에 `meeting_id` 추가(기존 행은 null). |
| `create`, `link`, `unlink` 응답 | — | 기존 `ok`, `task`, `links`, `link_error`의 용도 유지. 회의 연결은 동일하게 새 `meeting_links` 배열에 반환한다. |
| `unlink` | `links: [{meeting_id: UUID}]` 허용 | 지정된 회의 행만 제거한다. 프로젝트 해제 요청은 회의 행을 건드리지 않는다. `links`와 함께 Google 연결이 끊겨 있어도 동작한다. |
| `linked` | 기존 대상 대신 `meeting_id` 허용(GET query 또는 POST body) | `{tasks, removed}` 유지. 회의는 확정 연결된 미완료·완료 전부, 기한·완료 시점 제한 없음. 프로젝트·조직은 기존대로 미완료 전부 + 최근 3일 완료. |
| `unlinked` | 변화 없음 | 미완료 중 확정 프로젝트·조직 연결이 없는 할 일. 회의 연결만 있으면 포함한다. |
| 나머지 동작 | 변화 없음 | 기본 목록 `@default`, `overview`/`tasks`의 기간 기준, 완료 사본 갱신·삭제 흐름 유지. 완료 사본과 삭제는 회의 행에도 적용된다. |

회의 조회는 기존 `linked`를 확장한다. 연결된 ID로 Google을 직접 조회하므로 완료 날짜가 오래됐거나 숨김 처리된 완료도 기간 필터 없이 반환하고, 기존 동시 요청 제한·404/삭제 정리·완료 사본 동기화를 재사용한다. Google에 없는 할 일은 기존 방식대로 모든 대상 연결을 정리한다. 조회 불가 workspace는 RLS에 의해 빈 결과이며, 생성·연결 시 없는 회의나 조회 불가 회의는 거부한다.

회의의 프로젝트를 자동 추론하지 않는다. 후속 앱이 해당 회의의 프로젝트와 회의를 별도 행으로 함께 보내야 한다. 이번 PR은 그 복수 대상 저장 계약을 제공하며 앱 호출부는 변경하지 않는다.

## 이전 앱 호환 근거

`app/google-tasks.js`의 `linkKey`는 프로젝트가 아닌 모든 행을 `o:` + organization_id로 바꾼다. 회의 행을 기존 `links`에 섞으면 빈 조직 키 `o:`가 만들어지고, `chosenLinks()`가 화면에 없는 키를 보존하여 선택 개수에도 포함한다. 연결 한도에서 저장을 막는 등 오작동할 수 있다.

따라서 `meeting_links`를 별도 칸으로 추가한다. 이전 편집창은 기존 `links`만 읽으며 프로젝트·조직의 추가/해제 차이만 전송한다. 이 요청은 회의 연결을 보존한다. 회의 행의 `meeting_id`는 새 배열에서 읽는다. 테스트는 실제 이전 앱의 키 변환 함수를 실행하여 잘못된 조직 키가 생기지 않는 것과 이전 해제 요청 뒤 회의 행이 남는 것을 확인한다.

## 배포 전 확인과 정지 지점

1. 사용자가 PR merge를 별도로 승인하고 merge가 완료된 뒤, 최신 main·CI 및 승인한 배포 SHA를 확인한다. 배포할 checkout은 깨끗해야 한다.
2. Claude Code 로컬 manual mode에서 기존 인증을 사용한다. 토큰을 명령어 인자·문서·로그에 쓰지 않는다. 아래 `$taskProjectRef`는 해당 프로젝트 식별자로 별도 확인하여 설정한다(비밀 키가 아님).
3. CLI 버전 및 도움말을 확인한다. 배포 명령을 미리 실행하지 않는다.

```powershell
npx.cmd supabase --version
npx.cmd supabase functions list --help
npx.cmd supabase functions deploy --help
npx.cmd supabase functions list --project-ref $taskProjectRef --output json
```

4. 결과에서 **google-tasks만**의 버전, verify_jwt, 배포 시각을 기록한다. 기대값은 v11 / false다. CLI 출력에 verify_jwt가 없으면 승인된 조회 경로에서 해당 함수 상세 설정을 확인한다. 추정으로 채우지 않는다. 다른 값이면 중단하고 변경 이력을 대조한다.
5. 운영 함수 소스와 배포 직전 main 원본을 대조하고 복구 원본을 보관한다. 현재 복구 기준은 `f6e252ffefef95a036605f0a87600d83e9469414`의 `supabase/functions/google-tasks/index.ts`. 운영 소스가 다르면 이 SHA를 복구본으로 단정하지 않는다.
6. 선행 DB 적용 완료 기록을 확인한다. 재적용 SQL은 없다. 운영 DB를 직접 쓰지 않는다.
7. 아래 배포 명령, 복구 조건·명령, 정확한 배포/복구 SHA를 제시한 뒤 **실행 직전 중단하여 별도 승인을 받는다**.

## 승인 후 배포 명령

승인한 main checkout 루트에서, 함수 하나만 지정한다. `--prune`은 사용하지 않는다.

```powershell
npx.cmd supabase functions deploy google-tasks --project-ref $taskProjectRef --use-api --no-verify-jwt
```

`--use-api`는 Docker 없이 서버 측 묶기를 사용하며 `--no-verify-jwt`로 기존 플랫폼 설정을 유지한다. 함수 안 사용자 JWT 검증은 계속 적용된다. [공식 CLI 문서](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

## 배포 뒤 확인

- `functions list` 및 필요 시 함수 상세 조회로 버전 증가(v11에서 배포했다면 v12), verify_jwt=false, 새 배포 시각을 확인한다. 배포 SHA와 함께 기록한다.
- OPTIONS의 기존 CORS 헤더·응답을 확인한다. 데이터 생성 없이 무토큰/잘못된 JWT 요청이 거부되고 Google·연결 데이터에 접근하지 않는지 확인한다.
- **기존 응답 주의:** 현재 코드의 인증 실패는 공통 catch에서 HTTP **400**으로 반환한다. AGENTS.md의 일반 401 확인 항목과 차이가 있으나 이번 PR에서 응답 코드를 바꾸지 않았다. 거부 응답과 부작용 없음이 유지되는지 확인하고, 401 통일은 별도 작업으로 판단한다.
- 기존 로그인 앱에서 `links`에 프로젝트·조직만 있고 회의는 `meeting_links`에 있는지, 이전 편집창의 선택 개수가 맞는지 확인한다. 회의 조회는 오래된 완료도 포함하고 프로젝트 조회는 최근 3일 기준을 유지하는지 확인한다.
- 운영 검증에 사용할 회의/할 일이 없으면 만들지 말고 그 검증은 미실행으로 기록한다. `linked`는 조회 중 삭제 연결 정리·완료 사본 갱신을 할 수 있으므로 이 부작용까지 승인받은 범위에서만 호출한다.
- 할 일 제목·메모·계정·토큰을 보고하지 않는다. 개수, 응답 상태, 오류 유무만 보고한다. 테스트 생성/연결/해제는 별도 승인된 테스트 환경에서 수행한다.

## 복구

복구는 이 PR 직전 main 원본을 같은 옵션으로 재배포한다. 작업 중 checkout을 되돌려 덮어쓰지 말고, 보관한 원본 또는 검증된 별도 checkout 루트에서 실행한다. 현재 기준 SHA는 `f6e252ffefef95a036605f0a87600d83e9469414`이며, 배포 직전 소스 대조 결과가 우선한다.

```powershell
# 복구 원본 checkout에서 HEAD와 index.ts가 위 기준 원본과 일치하는지 먼저 확인
git rev-parse HEAD
npx.cmd supabase functions deploy google-tasks --project-ref $taskProjectRef --use-api --no-verify-jwt
```

복구도 실행 직전에 승인을 받는다. 배포 뒤와 같은 버전·verify_jwt·시각·인증 거부 확인을 반복한다. 재배포하면 버전 번호가 증가하며 v11 번호 자체로 돌아가지는 않는다. DB migration은 되돌리지 않으며 연결 데이터도 삭제하지 않는다.

**복구 제한:** 회의 행이 이미 생긴 뒤 구 Edge로 복구하면 구 `links`가 회의 행까지 반환해 이전 편집창 문제가 재발하고, `unlinked`에서 회의만 연결된 할 일이 빠질 수 있다. 먼저 회의 작성 앱을 중지하고 회의 행 존재 여부를 승인된 조회로 확인한다. 회의 행이 있으면 무조건 구 원본으로 되돌리지 말고 영향·수정 배포 방안을 보고하여 결정받는다. 이번 작업에서 이 위험을 없애려고 운영 연결을 지우지 않는다.

## 검증과 남은 한계

- `node --test tests/security/google-tasks-edge-links.test.mjs`: 기존 17개 + 회의/호환 8개, 합계 25개 통과.
- `node --test tests/security/*.test.mjs`: 132개 통과. Google·Supabase는 가짜 경계로 검증하고 실제 Edge handler와 이전 앱의 키 변환 코드를 실행한다. DB 모형은 선행 migration의 3종 대상·유일성·workspace 검사를 반영한다.
- 실제 운영 배포·Google/DB 통합 검증은 미실행. 이 문서의 명령은 준비 자료이며 실행 증거가 아니다.
- 복수 행 저장은 기존처럼 개별 insert여서 중간 DB 실패 시 일부 연결만 저장될 수 있다. `create`의 기존 `link_error`를 유지하며, 재시도는 대상 중복을 허용하지 않는 기존 제약을 사용한다.
- 브라우저 캐시 버전 대상 없음(Edge·테스트·문서만 변경). 앱·원장·DB migration·Cloudflare 변경 없음.
