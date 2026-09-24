# CLAUDE.md — mj880616/work

이 파일은 이 저장소에서 작업하는 에이전트와 개발자를 위한 제품 경계, 현재·목표 상태, 개발 절차를 정리한다.
- 제품 방향은 사용자의 최신 명시적 결정이 최우선이다.
- 보안·인증·권한 원칙은 `AGENTS.md`를 따른다.
- 이 문서, `AGENTS.md`, 실제 코드가 서로 충돌하면 임의로 해석하지 말고 불일치를 보고한다.

## 1. 제품 구조 (최상위 전제)

| 구분 | 정의 | 위치 |
|---|---|---|
| **Web2** | 로그인한 사용자 본인만 쓰는 **완전 비공개 개인 업무시스템** | `app/`, `desk.bokdoong.com` |
| **Web1** | 외부 공개나 링크 공유가 필요한 콘텐츠를 제공하는 **공개 채널** | 저장소 루트 페이지, `work.bokdoong.com` |

`Web2 = 개인 내부 업무공간`, `Web1 = 외부 공개·공유공간`으로 취급한다.

### Web2 원칙
- 프로젝트, 할 일, 일정, 회의, 자료, Google Calendar·Tasks 연동 등 모든 업무 기능은 로그인 사용자 전용이다.
- 비로그인 상태에서는 로그인 진입 외에 업무 데이터나 업무 화면을 보여주지 않는다.
- 공개 프로젝트, 공개 업무 홈, 익명 사용자용 업무 데이터라는 제품 개념은 없다.
- Web2는 공유 팀 DB나 다중 사용자 협업 시스템이 아니다. 앞으로도 개인 단일 사용자 구조로 계속 단순화한다.

### Web1 원칙
- 성명·보도자료, 공개 게시글, 정책·사업 공개 자료, 외부에 링크로 보낼 페이지를 담당한다.
- 공개가 필요하면 Web2 일부를 비로그인에게 여는 대신 Web1에 게시하거나 Web1을 통해 공유한다.

### 금지
- **외부 공유 요구를 이유로 Web2의 인증, RLS, DB grant, Edge Function 검사를 완화하지 않는다.**
- 현재 코드에 비로그인 Web2 경로가 남아 있어도 이를 제품 요구사항으로 해석하거나 보존·확장하지 않는다.

## 2. Current와 Target

현재 구현과 목표 제품 방향을 혼동하지 않는다. 아래 Current는 사실 기록이지 유지해야 할 요구사항이 아니다.

### Current (2026-09-25, `origin/main` 0e8ba46 기준)
이 절은 조사 시점의 스냅샷이다. 이후 작업에서는 항상 최신 `main`을 다시 확인하고, 구조가 바뀌었다면 Current 절을 갱신한다.

- 비로그인으로 `app/`에 들어오면 `loader-v2.js`가 `public-workspace.js`를 로드한다. 이 모듈은 anon RPC `app_public_workspace_index`로 공개 게시글·공개 자료를 보여주는 "공개 랜딩"이다. #270은 이 랜딩을 유지한 채 인증 홈만 제거했다.
- `app_public_workspace_index`는 anon에 execute가 grant돼 있다. `projects`는 `[]`(#226 이후)이고, `app_pages`(published·public)와 `app_documents`(visibility=public)를 반환한다.
- `public-workspace-extras.js`도 같은 RPC를 호출한다.
- Web2 자료실에 "외부 공개"(`visibility=public`) 선택지가 있다. 페이지 편집 모달에도 public/unlisted 공개 범위가 있다.
- Web1의 일부 공개 콘텐츠(`p/`, `public-policy/` 공개 게시글)는 현재 Web2와 같은 Supabase 프로젝트의 `app_pages` 테이블과 anon RPC `app_public_post`를 사용한다. 이는 현재의 내부 구현 의존성일 뿐 Web1과 Web2의 제품 경계를 의미하지 않는다.
- 다중 사용자 시절의 잔재가 남아 있다: workspace membership·역할(owner/admin), 가입 승인(`access-approval.js`), 첫 관리자 등록(bootstrap), 초대(`?invite`), `workspace` 공개 범위, `app_space_members`.
- 인증 후 기본 화면은 일정(calendar)이고 메뉴는 8개다(#270). 프로젝트는 소유자 전용이다(#226). 할 일과 일정은 개인용이다(#250, #253).
- 비로그인 랜딩을 전제로 한 검사가 있다: `tests/app-e2e/public-workspace-auth.spec.mjs`, `app-initial-paint.spec.mjs`, `.github/workflows/public-workspace-auth-e2e.yml`, `app-smoke-check.yml`의 "public and authenticated app boundaries" 단계.

### Target
- Web2는 로그인한 본인만 접근하는 완전 비공개 개인 업무시스템이다.
- 비로그인 사용자는 Web2 업무 데이터나 업무 UI를 볼 수 없고, `app/`에 들어오면 로그인 화면(`app/login/`)으로 이동한다.
- Web2에는 외부 공개를 위한 `public`, `unlisted`, `workspace` 같은 가시성 개념을 장기적으로 두지 않는다.
- 외부 공개가 필요한 콘텐츠는 Web1을 통해 제공한다.
- Web2의 인증·RLS·DB 권한을 완화해서 공유 기능을 만들지 않는다.
- 필요하면 Web2에 "Web1에 게시" 기능을 둘 수 있다. 단 공개 결과물을 제공하는 채널은 Web1이다.
- Web1과 Web2가 내부적으로 같은 Supabase 프로젝트나 일부 테이블을 공유할 수는 있다. 그래도 제품 경계와 외부 접근 권한은 명확히 분리한다.
- Web2 공개 경로의 제거는 접근을 좁히는 방향으로만 한다. 순서와 방식은 아래 규칙을 따른다.
  - 클라이언트 경로 제거, 테스트 갱신, DB grant·RPC 회수를 각각 범위를 정한 변경으로 나눈다.
  - DB·RLS 변경은 제안과 운영 확인을 거친다.
  - Web1이 쓰는 `app_public_post` 같은 경로는 Web1 대체 경로가 확인되기 전에 끊지 않는다.

## 3. 개발 규칙

### Git
- `main`을 직접 수정하지 않는다. 항상 최신 `origin/main`에서 별도 브랜치를 만든다.
- 봇이 `main`을 계속 갱신한다. `sync-public-page-meta`는 5분마다, `web1-file-dropzone`은 매 push마다, 그 밖에 `install-*`, `bump-*`, `kptu-*`가 있다. PR 전과 push 전에 최신 `main`과 다시 동기화한다.
- `main` 병합은 곧 GitHub Pages 운영 배포다.
- 한 커밋·PR에는 한 가지 목적만 담는다. 기능 변경과 인증·세션 구조 변경을 섞지 않는다.

### 변경 원칙
- 최소 변경으로 한다.
- 증상을 우회하기보다 호출 경로와 데이터 흐름을 먼저 조사하고 원인을 고친다.
- 인증, RLS, DB 권한, Edge Function 인증 경계를 약화하지 않는다.
- Supabase 스키마, RLS, 운영 데이터, 공개 범위 정책, URL 구조, Edge Function 인증 경계는 임의로 바꾸지 않는다. 제안으로 기록한다.
- 로드되지 않는 파일(`app/legacy/`와 `app/` 바로 아래의 미사용 모듈)을 loader에 다시 연결하지 않는다. 단 `app/web1-admin-auth.js`와 `app/public-page-editor.js`는 Web1 페이지가 사용 중이다.

### 운영 상태를 확인할 수 없을 때
- Supabase 운영 상태가 저장소에서 확인되지 않으면 추측하지 않고 **`미확인`**으로 기록한다. 대상은 적용된 migration, RLS, grant, 함수 설정(`verify_jwt`), Auth Redirect URL이다.
- 저장소의 migration은 2026-09-16 이후의 증분뿐이다. 기본 스키마와 대부분의 RLS는 저장소에 없다.
- **일부 Edge Function은 저장소에 없다.** 클라이언트가 호출하지만 배포본에만 있는 함수는 다음과 같다: `document-actions`, `library-files`, `workspace-drive`, `auth-handoff`, `push-notifications`, `event-media`, `rail-1007-plan`, `rail-declaration-content`, `rail-declaration-comments`, `wedding-mc-shared`, `press-conference-files`, `pc0914-checklist`, `kptu-board-probe`, `joint-struggle-files`. 이 함수들의 동작은 확인된 것처럼 서술하지 않는다.
- DB 마이그레이션과 Edge Function 배포는 자동화돼 있지 않다(수동). 순서는 Expand → Deploy → Verify → Contract를 따른다.

### Web2 캐시 버전 (`?v=`)
- Web2 자산은 `?v=N` query로 캐시를 무효화한다. `desk.bokdoong.com`은 버전 붙은 JS·CSS·SVG·PNG를 **1년 immutable**로 edge·브라우저에 캐시한다(`sw.js` 제외).
- 파일 내용을 바꾸면 그 파일을 참조하는 쪽의 `?v=`를 반드시 올린다. 대상은 `app/index.html`, `app/app.js`, `app/loader-v2.js`, `app/view-loader.js`와 해당 모듈의 import 문이다. 올리지 않으면 이전 내용이 계속 제공된다(#234 사례).
- smoke 검사와 E2E가 특정 버전 문자열을 검사하는 경우가 있으므로 함께 갱신한다.

### Web2 구현 불변조건
- 화면 전환은 `app-router.js`만 소유한다.
- 세션 읽기·갱신과 API 호출은 `runtime-client.js`만 사용한다.
- 새 view나 모듈은 `view-loader.js`의 route 표에 등록한다.
- 한 UI 영역에는 상태 소유자 하나, 최종 renderer 하나만 둔다. 전역 `MutationObserver`, 지연 덮어쓰기, `display:none` 패치로 경쟁을 덮지 않는다.
- 인증 흐름(`native-auth-bridge.js`, `calendar-return-bridge.js`, `auth-*.js`, `app/login/`)을 바꿀 때는 Android WebView와 일반 브라우저를 각각 확인한다.
- Google OAuth(Calendar·Tasks·Drive) 콜백은 `public-policy-drive/callback` 하나다. state 접두사(`calendar.`, `tasks.`, `drive.`)와 복귀 URL 계약을 깨지 않는다.

### 검증과 완료
- 테스트와 CI 결과를 확인한 뒤에만 완료를 보고한다. 실패는 출력과 함께 그대로 보고한다.
- 로컬 명령:
  ```bash
  node --test tests/domain/*.test.mjs tests/security/*.test.mjs tests/meeting-draft-parser.test.mjs scripts/public-page-meta.test.mjs
  python3 -m http.server 8123 &          # 저장소 루트에서. E2E는 127.0.0.1:8123을 직접 사용
  npx playwright test tests/app-e2e --browser=chromium --workers=1 --reporter=line
  ```
  CI는 `@playwright/test@1.55.0`을 사용한다. 로컬 브라우저 revision이 다르면 그에 맞는 버전을 저장소 밖에 설치해 사용한다.
- 정적 불변조건 검사는 `.github/workflows/app-smoke-check.yml`의 run 단계들이다.
- `supabase/tests/*.sql`은 CI에서 **실행되지 않고** 파일 존재만 검사한다. RLS 관련 변경에는 수동 검증 계획을 함께 적는다.
- 알려진 기존 실패: `tests/private-rail-org-status.test.mjs`(CI 미연결). 새로 생긴 실패와 구분해서 보고한다.
- 완료 보고는 `AGENTS.md`의 5개 항목을 따르고, `미확인` 운영 상태를 따로 나열한다.

## 4. Source of Truth

| 대상 | 기준 |
|---|---|
| 제품 방향 | **사용자의 최신 명시적 결정**. 과거 문서, 코드 주석, 기존 동작보다 우선한다 |
| Web1·Web2 코드 | 이 저장소의 `main` |
| 도메인 라우팅 | `cloudflare/bokdoong-router.mjs`, `cloudflare/wrangler.toml` |
| Web2 앱 시작 흐름 | 실제 `app/index.html` → `app.js` → `loader-v2.js` → `view-loader.js` |
| DB·RLS | 저장소 migration과 확인 가능한 운영 상태. 확인할 수 없으면 `미확인` |
| 저장소에 없는 Edge Function | 배포본만 원본. 저장소에서는 `미확인` |
| 읽생기(`read.bokdoong.com`) | 별도 저장소 `mj880616/read-think-write` |

### 도메인 대응
| 호스트 | 원본 경로 |
|---|---|
| `bokdoong.com` | `/work/personal/portal/` |
| `work.bokdoong.com` | `/work/**` (Web1) |
| `desk.bokdoong.com` | `/work/app/**` (Web2) |
| `read.bokdoong.com` | `/read-think-write/**` |
| `arsenal.bokdoong.com` | `/work/personal/arsenal-match-archive/` |

## 5. 신뢰도에 주의할 문서

`app/ARCHITECTURE.md`와 `docs/`의 P5·P6·배포 계약 문서에는 현재 코드와 다른 내용이 있다. 없는 파일, 로드되지 않는 모듈, 제거된 홈, 다중 사용자·공개 프로젝트 전제가 그 예다. 이 문서들을 근거로 삼기 전에 실제 코드와 git history로 대조한다.
