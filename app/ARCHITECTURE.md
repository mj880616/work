# 공공기관사업팀 Workspace 앱 구조

## 1. 진입 경로

현재 런타임 진입은 아래 한 경로를 기준으로 함.

1. `index.html`
2. `app.js`
3. `loader-v2.js`
4. `runtime-client.js`, `app-router.js` 등 공용 코어
5. 기능 모듈

`index.html`은 캐시 버전을 가진 `app.js`만 직접 로드함. 기능 모듈 추가·삭제는 원칙적으로 `loader-v2.js`에서 관리함.

## 2. 화면 전환 소유권

화면 전환은 `app-router.js`가 단독 소유함.

- 상단 메뉴: `data-view`
- 홈 카드 등 이동 버튼: `data-goto`
- 모바일 하단바: `data-cc-view`
- 좌상단 브랜드: 홈으로 이동

각 기능 모듈은 직접 모든 `.view-panel`을 숨기거나 활성 메뉴를 다시 계산하지 않음. 화면 전환이 필요하면 `window.KPTURouter.go(view)`를 사용함.

화면 진입 때 추가 작업이 필요하면 클릭 핸들러를 또 만들지 말고 `window.KPTURouter.on(view, callback)`을 사용함. 캘린더와 알림 화면의 진입 후 갱신도 이 방식으로 연결함.

## 3. 세션·API 공용 런타임

`runtime-client.js`가 세션 읽기·저장·만료 확인·refresh token 갱신 잠금과 공용 API 호출을 제공함.

2차 안정화 기준 공용 런타임을 사용하는 주요 모듈:

- `team.js`
- `library-upload.js`
- `collaboration-center.js`
- `notification-center-ui.js`
- `calendar-persistence.js`
- `task-workflow.js`
- `project-access.js`
- `meeting-round-detail.js`

일정·할 일·프로젝트·회의 핵심 보조 모듈에 남아 있던 별도 세션 저장·refresh token 갱신 로직을 제거함. 여러 모듈이 동시에 refresh token을 사용해 각각 세션을 갱신하지 않도록 `runtime-client.js` 안에서 하나의 refresh promise를 공유함.

로그인 방식, Google OAuth 진입·복귀 방식, 세션 저장 키와 DB 구조는 변경하지 않음.

## 4. 런타임 계층

### 인증

- `native-auth-bridge.js`
- `calendar-return-bridge.js`
- `auth-handoff-client.js`
- `auth-bootstrap.js`
- `auth-ui.js`
- `auth-login-fallback.js`
- `session-resilience.js`
- `member-default-role.js`

Android OAuth 복귀 경로는 별도 기능 수정과 섞지 않음. 인증 UI 변경 시 Android WebView와 일반 브라우저 흐름을 각각 확인함.

### 기본 셸

- `runtime-client.js`: 공용 세션 갱신 및 공용 API 기반
- `app-router.js`: 화면 전환 단일 소유자
- `team.js`: 워크스페이스 기본 데이터 및 기본 기능
- `workspace-ui.css`: 공통 UI 보정. 단순 스타일 수정용 JS 모듈을 새로 만들지 않음.

### 협업

- `collaboration-center.js`: 메시지, 알림 수량, 프로젝트 초대 관련 협업 기능
- `notification-center-ui.js`: 전용 알림 화면
- `team-profile-view.js`: 다른 팀원 프로필 조회
- `profile-settings.js`: 내 프로필 및 담당 정보 관리
- `suborganizations.js`, `suborganization-planned-assignee.js`: 산하조직 영역

### 업무 기능

- 일정: `calendar-*`
- 할 일: `task-*`
- 프로젝트: `project-*`
- 회의: `meeting-*`
- 자료실: `library-upload.js`, `project-files.js`
- 게시/현장공유: `page-editor-fix.js`

## 5. 알림 모듈 안정화

`notification-center-ui.js`는 2차 안정화에서 다음 옛 구조를 제거함.

- 전역 `MutationObserver`
- capture 단계의 전역 클릭 가로채기
- 12초 `setInterval` polling

알림 화면 진입은 `KPTURouter.on('notifications', ...)`에서 명시적으로 처리함. 프로젝트 초대·할 일 배정 수락/거절 및 읽음 처리는 알림 화면의 명시적 액션으로 처리함. 포커스 복귀 시에도 알림 화면이 실제로 열려 있을 때만 갱신함.

## 6. 비활성 파일 격리

현재 진입 경로에서 로드되지 않는 과거 보정 모듈 15개를 삭제하지 않고 `app/legacy/`로 이동함.

- `calendar-app-edit-ui.js`
- `calendar-create-live-title.js`
- `calendar-date-create.js`
- `calendar-edit-actions.js`
- `calendar-event-edit.js`
- `calendar-google-fast-edit.js`
- `calendar-observer-stability.js`
- `editable-page.js`
- `google-color-palette.js`
- `home-task-actions.js`
- `meeting-detail-patches.js`
- `page-preview-tools.js`
- `project-child-header.js`
- `project-hierarchy-ui.js`
- `startup-speed.js`

`app/legacy/README.md`에 격리 원칙을 기록함. 새 기능에서 legacy 파일을 다시 import하지 않고, 필요한 과거 구현은 현재 소유 모듈에 통합함.

## 7. 변경 규칙

- 화면 이동은 `app-router.js`만 담당함.
- 같은 버튼에 여러 모듈이 `onclick`/`click`을 중복 등록하지 않음.
- 세션 refresh 로직을 기능 모듈에 새로 만들지 않고 `runtime-client.js`를 사용함.
- DOM 생성 시점을 기다리기 위한 전역 `MutationObserver`는 최후 수단으로만 사용함. 가능하면 명시적 이벤트를 사용함.
- 단순 CSS 변경을 JavaScript 주입 모듈로 만들지 않음.
- 새 기능은 기존 소유 모듈에 통합하는 것을 우선함.
- 비활성 파일은 바로 삭제하지 않고 의존성 검사 후 `legacy`에 격리함.
- 사용자 기능 변경과 인증·세션 구조 변경을 한 커밋에 섞지 않음.

## 8. 자동검사

### 정적·구조 smoke test

`.github/workflows/app-smoke-check.yml`에서 아래를 검사함.

- 최상위 JavaScript 문법 검사
- `app.js`에서 시작하는 재귀 의존성 및 누락 파일 검사
- 공용 라우터·공용 세션 런타임·핵심 모듈 버전 검사
- 알림 모듈의 전역 observer/polling/capture interceptor 재유입 방지
- 일정·할 일·프로젝트·회의 모듈의 기능별 refresh/session 저장 로직 재유입 방지
- legacy 파일의 앱 루트 재유입 방지
- 정적 HTTP로 앱 진입 파일 접근 검사

### 브라우저 E2E

`.github/workflows/app-e2e-check.yml`과 `tests/app-e2e/workspace.spec.mjs`를 추가함.

Playwright Chromium에서 Supabase 응답을 테스트 상태로 대체하고 아래 핵심 흐름을 실제 브라우저 클릭으로 확인함.

- 이메일 로그인
- 메뉴 이동
- 일정 저장
- 할 일 저장
- 프로젝트 생성
- 회의 결과 저장
- 메시지 전송
- 알림 화면 진입 및 프로젝트 초대 수락

두 검사는 작업 브랜치의 매 커밋마다 실행하지 않고 `main` 반영 또는 `main` 대상 Pull Request에서 실행하도록 제한함. 개발 중간 실패 메일이 반복되는 문제를 줄이고, 반영 직전 회귀검사에 집중함.

## 9. 2차 안정화 이후 운영 방식

2차 안정화 이후에는 별도의 대규모 구조개편을 계속하지 않음.

1. 기능 개발은 기존 소유 모듈에 통합함.
2. 변경 전후 정적 smoke와 브라우저 E2E를 회귀 기준으로 사용함.
3. 실패가 발생한 기능 단위만 수정함.
4. 인증·Android OAuth·DB 구조는 별도 필요가 확인되지 않는 한 유지함.
5. 새 보정 파일을 늘리기보다 공용 라우터·공용 런타임·명시적 이벤트 구조를 유지함.
