# Web2 Production Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web2를 구조 안정화 단계에서 실제 상시 업무용 프로덕션 서비스 수준으로 끌어올리고, 이후 기능개발이 다시 기술·보안부채를 늘리지 않도록 운영 게이트를 고정함.

**Architecture:** 화면별 canonical owner와 명시 readiness/event 계약을 유지하고, router/loader를 마지막 공통 초기화 경계로 정리함. 이후 GitHub merge gate, storage/security audit, 실패복구, 디자인 시스템, 성능 순으로 각 단계가 독립적으로 검증 가능한 상태를 만든 뒤 다음 단계로 넘어감.

**Tech Stack:** GitHub Pages, vanilla JavaScript/CSS, Playwright, GitHub Actions, Supabase Auth/Postgres/RLS/Edge Functions, Android WebView wrapper.

**Spec:** 사용자 승인 안정화 방향 및 `/AGENTS.md`

## Global Constraints

- `/AGENTS.md`의 Production Development Rules를 모든 단계의 완료조건으로 적용함.
- 인증·권한·RLS·Storage policy·server-side validation을 기능 구현을 위해 약화하지 않음.
- Client-side UI 제한을 접근제어로 간주하지 않음.
- 화면/영역별 canonical owner는 하나만 유지함.
- MutationObserver, 지연 setTimeout, 런타임 style 삽입을 화면 후행 보정 수단으로 재도입하지 않음.
- 관련 자동화 테스트와 권한 회귀검사가 성공하기 전에는 main에 병합하지 않음.
- 기존 Web1과 Web2의 보안 경계를 혼동하지 않으며, 공개 GitHub Pages에 민감정보를 저장하지 않음.

---

### Task 1: Router 및 앱 초기화 안정화

**Files:**
- Modify: `app/app-router.js`
- Modify: `app/loader-v2.js`
- Modify: `app/app.js`
- Modify: `tests/app-e2e/app-initial-paint.spec.mjs`
- Modify: `.github/workflows/app-smoke-check.yml`

**Interfaces:**
- Consumes: `kptu:app-ui-ready`, `kptu:session-changed`, browser `popstate`
- Produces: `window.KPTURouter.go/on/restoreFromUrl`, `kptu:view-changed`

- [ ] 테스트에서 앱 UI-ready 전 URL deep link가 적용되지 않음을 검증함.
- [ ] 테스트에서 UI-ready 이후 deep link가 정확히 복원됨을 검증함.
- [ ] 테스트에서 nav 클릭 URL 동기화와 browser back 복원을 검증함.
- [ ] 기존 router의 MutationObserver/setTimeout 의존으로 테스트가 실패하는 것을 확인함.
- [ ] router를 `kptu:app-ui-ready` 명시 이벤트 기반으로 구현함.
- [ ] loader/app cache version을 갱신함.
- [ ] smoke에서 router의 MutationObserver/setTimeout 재도입을 금지함.
- [ ] 전체 App browser E2E와 Android back 관련 회귀검사를 통과함.
- [ ] PR 검증 후 squash merge함.

### Task 2: Main 배포 게이트 구축

**Files:**
- Review/Configure: repository branch protection/ruleset
- Review: `.github/workflows/app-smoke-check.yml`
- Review: `.github/workflows/app-e2e-check.yml`
- Review: `.github/workflows/public-workspace-auth-e2e.yml`

**Interfaces:**
- Consumes: GitHub Actions check results
- Produces: main merge policy

- [ ] main 직접 push/force push 가능 여부를 점검함.
- [ ] required checks로 smoke, browser E2E, public auth 및 핵심 구조검사를 지정함.
- [ ] PR 없이 production code가 main에 들어가지 않도록 보호규칙을 설정함.
- [ ] merge 전 최신 head SHA와 required checks 성공을 강제함.
- [ ] 보호규칙 적용 후 정상 PR merge 경로를 검증함.

### Task 3: Browser storage audit 100% green

**Files:**
- Review/Modify: `private-rail/forum-0929/index.html`
- Review/Modify: `.github/workflows/browser-storage-audit.yml`
- Server-side path: appropriate Supabase tables/RPCs when shared persistence is required

**Interfaces:**
- Consumes: existing Web1 checklist/comment/status persistence
- Produces: no prohibited shared business data in browser-local persistence

- [ ] localStorage 3건의 데이터 성격과 공유 필요성을 분류함.
- [ ] 공유 데이터이면 server-side persistence로 이전하는 테스트를 먼저 추가함.
- [ ] 개인 UI preference인 경우 허용기준을 문서화하고 audit 규칙과 일치시킴.
- [ ] storage audit을 100% green으로 만듦.
- [ ] 신규 localStorage/sessionStorage 사용을 CI가 계속 차단하는지 검증함.

### Task 4: 인증·권한 Negative E2E 확대

**Files:**
- Modify/Create: `tests/app-e2e/security-*.spec.mjs`
- Review: Supabase RLS/RPC/Edge Functions used by Web2

**Interfaces:**
- Consumes: owner/admin/editor/author/viewer, workspace/project/document/page identifiers
- Produces: trusted-layer authorization regression suite

- [ ] 역할별 허용 작업 matrix를 확정함.
- [ ] 다른 Workspace ID 변조를 거부하는 테스트를 추가함.
- [ ] 접근권한 없는 project/document/page ID 변조를 거부하는 테스트를 추가함.
- [ ] public/unlisted/workspace/groups/private 공개범위 matrix를 검증함.
- [ ] invite 및 membership 변경의 권한 경계를 검증함.
- [ ] server/RLS가 거부하는 것을 확인하며 UI 숨김만으로 통과시키지 않음.

### Task 5: Runtime 오류복구 및 데이터 정합성

**Files:**
- Review/Modify: `app/runtime-client.js`, `app/session-resilience.js`, 저장 controller/service modules
- Create/Modify: failure-path Playwright tests

**Interfaces:**
- Consumes: API timeout, 401/403/5xx, duplicate submit, upload failure, partial save failure
- Produces: isolated error state, retry/recovery, no silent data loss

- [ ] 각 주요 저장 흐름의 중복 제출 방지를 검증함.
- [ ] session expiry/refresh 실패 동작을 검증함.
- [ ] API 5xx/timeout 시 전체 앱이 아닌 해당 기능만 실패하도록 검증함.
- [ ] partial save 상태를 사용자에게 구체적으로 표시함.
- [ ] optimistic update가 있다면 실패 시 rollback을 검증함.
- [ ] 저장 성공/실패 후 canonical server state와 UI가 일치하는지 검증함.

### Task 6: Design System 1.0

**Files:**
- Refactor: `app/base-ui.css`, `app/workspace-ui.css`, `app/desktop-ui.css`
- Review/Refactor: feature CSS files loaded by `app/styles.css`
- Create: visual/design invariant documentation or test fixtures as appropriate

**Interfaces:**
- Consumes: existing feature UI
- Produces: tokens → primitives/layout → feature CSS hierarchy

- [ ] spacing, type scale, radius, border, shadow, color, action size, breakpoints를 token으로 확정함.
- [ ] Card, SectionHeader, Toolbar, Badge, Empty/Error/Loading State, Modal, Toast 규격을 통일함.
- [ ] 기능별 `!important`와 상호 override를 전수 점검함.
- [ ] 화면별 임의 버튼/카드 규격을 공통 primitive로 치환함.
- [ ] 모바일/PC에서 동일 정보가 동일한 시각언어를 사용하도록 검증함.

### Task 7: 전 화면 UX·접근성·심미성 정리

**Files:**
- Modify: relevant feature HTML/JS/CSS only after Design System 1.0
- Test: desktop/mobile Playwright visual/interaction coverage

**Interfaces:**
- Consumes: Design System 1.0
- Produces: consistent production UI across Home/Calendar/Tasks/Projects/Library/Meetings/Pages/Team/Profile

- [ ] 정보 hierarchy, padding, metadata, badge, action 위치를 화면별 비교함.
- [ ] loading/empty/error/disabled/focus 상태를 통일함.
- [ ] keyboard navigation, focus visibility, accessible names를 검증함.
- [ ] 360px급 mobile, tablet, 1024px+, 1440px+ layout을 검증함.
- [ ] 핵심 화면의 overflow/hidden-content가 없는지 검증함.

### Task 8: 초기 로딩 및 성능 최적화

**Files:**
- Modify after stabilization: `app/loader-v2.js` and feature loading boundaries
- Test: startup/performance regression checks

**Interfaces:**
- Consumes: explicit readiness contracts from stabilized modules
- Produces: minimal critical startup graph with lazy-loaded noncritical features

- [ ] 초기 interactive에 필요한 critical modules를 분류함.
- [ ] page-builder AI 등 비현재화면 기능을 lazy-load 후보로 분류함.
- [ ] lazy-load 전후 기능 E2E 결과가 동일한지 검증함.
- [ ] 초기 API/module 요청 수와 사용자 체감 시작시간을 비교함.
- [ ] 로딩순서 race가 재도입되지 않도록 readiness 테스트를 유지함.

### Task 9: 최종 Production Audit

**Files:**
- Review: application, workflows, Supabase authorization/storage paths, Android wrapper

**Interfaces:**
- Consumes: Tasks 1-8 outputs
- Produces: production readiness decision and residual risk register

- [ ] 전체 CI가 known-failure 없이 green인지 확인함.
- [ ] main protection/required checks가 실제 강제되는지 확인함.
- [ ] 인증·권한·Storage·RLS/Edge Function 경계를 재점검함.
- [ ] Web/Android 핵심 사용자 흐름을 재검증함.
- [ ] 디자인/모바일/PC 일관성을 최종 점검함.
- [ ] 남은 리스크를 P0/P1/P2로 분류함.
- [ ] P0/P1이 없을 때만 ‘안정화 완료, 일반 기능개발 단계 전환’으로 판단함.
