# AGENTS.md — Web2 저장소 규칙 (유일한 기준)

이 문서가 이 저장소의 **유일한 규칙 원문**이다. Claude Code(`CLAUDE.md`가 이 파일을 불러옴)와 Codex(이 파일을 직접 읽음) 모두 이 문서를 따른다. 규칙은 여기에만 쓰고 다른 파일에 복사하지 않는다.

운영 서비스 저장소이며 `main` 루트가 GitHub Pages로 공개 배포된다. 공개 저장소다.

## 1. 도구와 세션

| 도구·세션 | 위치 | 할 수 있는 일 | 하지 않는 일 |
| --- | --- | --- | --- |
| Claude Code 로컬 | 사용자 PC | 코드·문서·테스트, Supabase MCP(production 조회 전용), supabase CLI, gh. production 조회·Edge 배포·DB 적용 절차 | 아래 금지 규칙 |
| Claude Code 웹 | 클라우드 | 코드·문서·테스트 | Supabase·production 접근 |
| Codex CLI(PC) | 사용자 PC | 코드·문서·테스트, Supabase MCP(조회 전용, 이 프로젝트만) | Edge 배포·삭제, DB 쓰기, supabase CLI로 production 변경 |
| Codex 웹 | 클라우드 | 📱 작업만(코드·문서·테스트) | DB·Edge·production 접근, 환경에 비밀값 저장 |

- **배포·DB 변경 작업은 당분간 Claude Code 로컬에서만 한다.** Codex CLI는 조회까지만 한다.
- 도구 전환은 작업 사이에서만 한다. 한 브랜치·PR을 두 도구가 동시에 고치지 않는다.
- production 조회·배포·적용이 웹 세션(Claude Code 웹·Codex 웹)에서 필요해지면 추측하지 말고 중단·보고한다.
- 웹 세션에 production 토큰을 등록하도록 제안하지 않는다.
- Windows에서 supabase CLI는 `npx.cmd supabase`로 실행한다.

### 지시서 표시

- 지시서 맨 위에 "📱 폰 가능" 또는 "💻 PC 로컬 필요"를 적는다.
- 📱: 네 도구 모두 가능. 💻: 로컬 도구만 가능(배포·DB 변경은 Claude Code 로컬만). 💻 작업을 웹 세션에서 받으면 즉시 중단한다.

## 2. 작업 흐름

- 시작할 때 원격 최신 `main`을 다시 확인한다. 기억한 commit hash를 최신으로 가정하지 않는다.
- 최신 `main`에서 작업 브랜치를 만든다. 관련 브랜치·열린 PR이 있으면 그것을 이어서 쓴다.
- 작업 브랜치 → 커밋 → PR. `main`에 직접 push하지 않는다. **merge는 사용자 승인 후에만 한다.**
- 사용자의 미커밋 변경을 덮어쓰거나 지우지 않는다. 관련 없는 변경을 한 작업에 섞지 않는다.
- 과거 대화와 현재 저장소가 다르면 저장소와 실행 결과를 따른다.

### 원장

- 개발 작업 원장은 `docs/roadmap.md`다. 새 작업은 원장에 행을 추가한 뒤 시작한다.
- 작업 PR은 원장의 해당 행 상태·PR 번호를 같은 PR에서 갱신한다.
- 공개 저장소이므로 원장·문서에 이메일, 계정명, 키, 토큰, 개인정보를 쓰지 않는다.

## 3. 보안 (Non-negotiable)

1. Do not weaken existing authentication, authorization, database policies, storage policies, or server-side validation to make a feature work. 인증 우회, RLS 약화, anon/public 등 권한 확대를 해결책으로 쓰지 않는다. 막히면 올바른 접근 경로를 설계한다.
2. Client-side UI restrictions are not sufficient access control. Sensitive permissions must be enforced in trusted server-side or database layers.
3. Do not trust ownership, organization, role, or user identifiers supplied only by the client when deciding permissions.
4. Do not expose privileged credentials or secrets in client code or committed source files. 키, 토큰, 비밀번호, 내부 전용 주소, 개인정보를 코드·문서·커밋에 넣지 않는다.
5. Validate untrusted input in an appropriate trusted layer.
6. Do not leave temporary access shortcuts, debug permissions, mock authorization, placeholder checks, or test-only exceptions in production code.
7. 공개/비공개 데이터를 명시적으로 구분하고, 기존 권한 경계를 먼저 파악한다.

### 토큰 취급

- 토큰·키 값을 명령어 인자에 넣지 않는다. gh가 있으면 gh를 우선 사용한다.

## 4. 조사와 수정

- 기존 구조와 source of truth(실제 데이터, 인증/DB 상태, 지정된 원장)를 확인한 뒤 수정한다. Inspect the relevant call path and data flow first: UI, routes, APIs/RPCs, database policies, storage rules, authentication/session handling, shared authorization logic, and related tests.
- 기대 동작과 실제 증상을 구분하고, 데이터 흐름과 필요한 git history를 추적해 최초 원인을 특정한다.
- 원인이 불명확한 채 여러 파일을 추측으로 고치지 않는다. 증상만 가리는 임시방편을 쓰지 않는다.
- 기존 구조를 가장 적게 흔드는 방법으로, 필요한 범위만 바꾼다. When a shared permission or data model changes, review all features that use the same model.
- 같은 목적의 테이블·함수·API·파일이 있는지 먼저 찾는다. 중복 구현이나 새 상태 저장소를 만들지 않는다. Keep permission-sensitive logic centralized.
- 기존 기능 수정 요청에 새 기능을 옆에 만들어 우회하지 않는다. 동작하는 코드를 불필요하게 재작성하지 않는다.
- 삭제 요청은 사용처·의존성을 확인한 뒤 정리한다. UI만 숨기지도, 조사 없이 공용 구조를 지우지도 않는다.
- 사용자가 폐기한 구조를 편의상 되살리지 않는다.
- UI 변경: 기존 컴포넌트를 재사용하고, 모바일·데스크톱을 함께 확인한다. 키보드·터치 접근성을 유지하고, 요청 없는 대규모 디자인 변경을 하지 않는다.
- Do not independently change Supabase schemas, RLS, existing data, visibility policy, URL structure, or Edge Function authentication boundaries. Record a proposal instead. Do not add product features or redesign the application as part of stabilization work.

### 범위

- 요청 범위만 수정한다. 범위 밖에서 발견한 문제는 고치지 않고 보고만 한다.
- 근본 원인 때문에 연관 파일 수정이 불가피하면 그 이유를 보고에 밝힌다.

### 캐시 버전

- Web2는 `app/index.html` → `app/app.js` → `app/loader-v2.js` → `app/view-loader.js`·기능 모듈 순서로 `?v=` 캐시 버전을 붙여 불러온다(`app/ARCHITECTURE.md`).
- `?v=`로 불러오는 파일을 고치면 그 파일을 불러오는 곳의 `?v=`를 올린다. 그 때문에 불러오는 파일 자체가 바뀌면 그 파일의 버전도 윗단계에서 올린다. `index.html`까지 올라간다(예: `view-loader.js` 수정 → `loader-v2.js`의 `view-loader.js?v=` → `app.js`의 `loader-v2.js?v=`와 `index.html` modulepreload → `index.html`의 `app.js?v=`).
- 버전 문자열을 기대하는 테스트(`tests/app-e2e/`)도 같은 PR에서 맞춘다.
- 어느 로더도 불러오지 않는 파일은 올릴 버전이 없다. 이 경우 보고에 그렇게 적는다.

## 5. 제품 구조 (Confirmed product structure)

Web2 (`app/`) is a private personal work system used only by its single signed-in owner (sole-owner). It is not a shared team database, a multi-user collaboration product, or a public site. Preserve the links among projects, schedules, follow-up tasks, meetings, and documents.

- Anonymous Web2 startup is blocked: the loader checks the session and redirects to login before routing or feature modules load (Task 11, #280; `tests/security/web2-anonymous-auth-gate.test.mjs`).
- Web2 data access is owner-only in the database and Edge Function layers (Task 12, #281–#284; `private.app_is_workspace_owner`).
- Web2 public and sharing paths have been removed: the anonymous workspace, public projects, project publication, share links, and publication/visibility controls are retired, and their RPCs no longer grant execution (Task 13, #286·#287; `supabase/migrations/20260925143746_task13_web2_private_boundary.sql`). Do not restore them.
- Web2 creates only `private` content. For the authenticated role, the database rejects inserts of non-private `app_pages`/`app_documents` rows and visibility changes to non-private values. Existing `public`/`workspace` rows are retained for Web1 and later cleanup.
- Web1 (repository root pages such as `/p/`, `public-policy/`, and the business pages) is the external public channel. `/p/` pages, `app_public_post(text)`, `public-page-edit`, and `public-policy-drive` are kept. When something must be shared externally, keep the original in Web2, publish only the needed content on Web1, and share the Web1 link. Never relax Web2 authentication, RLS, grants, or Edge Function checks for Web1 publication.
- RTW (읽생기, Read-Think-Write) is a separate product that shares this Supabase project, including Auth, with Web2. Do not modify `rtw_*` tables, policies, functions, or related Edge Functions as part of Web2 or Web1 work.
- Collaboration structures (workspace members and roles, invites, project invitations, event attendees, task assignment) still exist in the database but are scheduled for removal in roadmap Tasks 19–31 (`docs/roadmap.md`). Do not build new features on them.
- Startup order: session check → authenticated path or redirect to login → required data/modules → one final UI reveal.
- A UI region has one state owner and one final renderer. Do not repair competing renderers with delayed overwrites, broad `MutationObserver` decorators, or `display:none` patches.
- In project detail, the parent link stays in the hierarchy area above the title, and child-project navigation is the child-project list in the detail body (Task 16). Both stay separate from the ⋯ menu that holds complete, edit, archive, and delete. Keep child creation inside the child-project list, and keep native keyboard-accessible disclosure (`<details>`) for the ⋯ menu, progress history, and folded sections.

## 6. 정지 지점

아래는 적용 직전에 멈추고, 적용 순서와 복구 경로를 보고한 뒤 승인을 받는다.
DB migration, Supabase 권한·RLS 변경, Edge Function 배포·삭제, Cloudflare 설정 변경, production 데이터 변경.

## 7. production DB 적용 (Claude Code 로컬만)

- 순서: 로컬 세션 read-only 사전 확인(snapshot 대조) → 사용자가 SQL Editor에서 직접 실행 → 로컬 세션 read-only 사후 검증.
- AI가 apply_migration 등 쓰기 도구로 production DB를 직접 변경하지 않는다.
- **`supabase db push`·`migration repair`는 영구 금지.** production DB를 읽생기 저장소와 공유한다(`docs/migration-history.md`).
- migration마다 rollback SQL과 snapshot을 함께 두고, 적용 SQL은 main 파일 원문으로 제시한다(화면 출력 잘림 주의).
- 적용 SQL은 `commit;` 직전에 `supabase_migrations.schema_migrations` 기록 1행 insert를 포함한다. version·name은 저장소 파일 이름과 같게 한다.
- DB 변경을 요청할 때 사용자에게 일상어 3줄을 먼저 제시한다: 무엇이 바뀌나 / 잘못되면 어떤 일이 생기나 / 되돌리는 방법.
- 사용자에게 확인받을 3가지: 커맨드센터 실행 승인, SQL 끝이 `commit;`인지, 실행 결과 Success.

## 8. Edge Function 배포 (Claude Code 로컬만)

- 로컬 세션, manual mode에서만 한다.
- 배포 전 `functions list`로 현재 버전·verify_jwt·시각을 기록한다.
- 함수 이름을 반드시 지정한다. `--prune` 금지.
- **verify_jwt는 함수마다 다르다**(2026-09-26 기준 30개 중 true 8개, false 22개). 함수별 값은 `docs/web2-env6b-edge-source.md` 5절 표가 기준이다. 저장소에 `config.toml`이 없으므로 대상 함수의 현재 값을 확인하고 같은 값을 유지한다: `false`면 `--no-verify-jwt`를 붙이고, `true`면 붙이지 않는다. 값이 바뀌면 그 표를 같은 PR에서 고친다.
- verify_jwt=false인 Web2 함수는 함수 코드에서 인증한다. Web1 공개 페이지 함수는 로그인 없이 비밀번호·Origin으로 막는 것이 의도된 구조다.
- Docker 없이 배포할 때 `--use-api`를 사용한다.
- 배포 명령과 복구 명령(이전 commit 코드를 같은 옵션으로 재배포)을 제시하고 실행 직전에 멈춘다.
- 배포 후 버전 증가, 비로그인 요청 401(verify_jwt 또는 코드 인증 대상 함수), OPTIONS/CORS를 데이터 생성 없이 확인한다.
- CLI가 만든 `supabase/.temp`는 커밋하지 않는다.

## 9. 검증과 완료 기준

수정 → 직접 기능과 인접 기능 회귀 확인 → 테스트·lint·build·CI 통과 → PR 생성 → 결과 보고.

- requested behavior works for authorized users; existing related behavior still works;
- protected operations remain protected outside the allowed scope; shared permission and data paths have not regressed;
- temporary/debug code has been removed.
- Prefer automated browser E2E and regression tests over manual-only checks whenever feasible.
- 테스트를 우회하거나 삭제해서 통과시키지 않는다. CI 결과 확인 전에는 완료로 보고하지 않는다.
- 문서 전용 PR은 CI 대상 아님을 완료 기준으로 인정한다.
- If a security or authorization issue remains unresolved, do not describe the task as fully complete.

## 10. 보고

- 진행 중에는 원인 발견, 예상과 다른 구조, 보안·데이터 손실 위험, 요구사항 충돌, 테스트 실패를 우선 알린다.
- 요청과 구현이 다르면 차이를 명시한다.
- 사용자 할 일과 사용자 결정 항목은 채팅 보고와 별도로 PR 댓글로도 올린다(터미널 복사 시 잘림 방지).

### 완료보고 양식

아래 순서를 고정한다. 해당 없으면 "해당 없음"으로 적는다.

1. 세션(도구: Claude Code 로컬/웹, Codex CLI/웹)
2. 시작·최종 SHA, branch, PR
3. 원인(사실/추정 구분)
4. 변경 파일 요약
5. 실행한 테스트와 결과(기존 실패는 clean main 재현 여부)
6. CI 결과(gh 없으면 GitHub API)
7. DB·production 영향(적용 순서·복구·정지 지점), 권한·보안 확인 내용
8. 사용자 확인 필요 항목
9. 남은 위험
10. 범위 밖 발견사항
11. roadmap 갱신
12. merge 상태

## 11. 참고 문서

- `docs/roadmap.md`: Web2 개발 작업 원장. 작업 순서·상태·PR 번호.
- `docs/migration-history.md`: 저장소 migration 파일과 production 기록의 대응표.
- `docs/web2-env6b-edge-source.md` 5절: production Edge Function 전체 verify_jwt 표.
- `app/ARCHITECTURE.md`: Web2 앱 진입 경로, 모듈 로딩, 화면 전환 소유권 구조.
- `docs/bokdoong-domain.md`: bokdoong.com 도메인 연결과 호스트·경로 운영 설계.
- `docs/web2-expand-deploy-verify-contract.md`: Web2 공개 경로 변경의 Expand → Deploy → Verify → Contract 배포 순서.
