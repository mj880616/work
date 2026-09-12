# 공공기관사업팀 Workspace 앱 구조

## 1. 진입 경로

현재 런타임 진입은 아래 한 경로를 기준으로 함.

1. `index.html`
2. `app.js`
3. `loader-v2.js`
4. 공용 코어 및 기능 모듈

`index.html`은 캐시 버전을 가진 `app.js`만 직접 로드함. 기능 모듈 추가·삭제는 원칙적으로 `loader-v2.js`에서 관리함.

## 2. 화면 전환 소유권

화면 전환은 `app-router.js`가 단독 소유함.

- 상단 메뉴: `data-view`
- 홈 카드 등 이동 버튼: `data-goto`
- 모바일 하단바: `data-cc-view`
- 좌상단 브랜드: 홈으로 이동

각 기능 모듈은 직접 모든 `.view-panel`을 숨기거나 활성 메뉴를 다시 계산하지 않음. 화면 전환이 필요하면 `window.KPTURouter.go(view)`를 사용함.

화면 진입 때 추가 작업이 필요하면 클릭 핸들러를 또 만들지 말고 `window.KPTURouter.on(view, callback)`을 사용함. 현재 캘린더의 Google 일정 갱신이 이 방식으로 연결됨.

## 3. 런타임 계층

### 인증·세션

- `native-auth-bridge.js`
- `calendar-return-bridge.js`
- `auth-handoff-client.js`
- `auth-bootstrap.js`
- `auth-ui.js`
- `auth-login-fallback.js`
- `session-resilience.js`
- `member-default-role.js`

로그인 영역은 최근 Android OAuth 복귀 문제를 해결한 코드가 포함되어 있으므로 기능 변경과 구조 정리를 동시에 하지 않음. 세션/API 공통화는 별도 단계에서 테스트 계정 기반 E2E와 함께 진행함.

### 기본 셸

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

## 4. 제거한 중복 보정 모듈

1차 안정화에서 다음 파일은 런타임에서 제거 후 파일 자체도 삭제함.

- `auth-cleanup.js`: `auth-ui.js`와 중복
- `brand-home-nav.js`: `app-router.js`로 대체
- `mobile-dock-tune.js`: `workspace-ui.css`로 통합

새 기능을 만들 때 기존 기능을 덮어쓰기 위한 `*-fix.js`, `*-tune.js`, `*-cleanup.js` 파일을 우선 추가하지 않음. 먼저 기존 기능의 소유 모듈을 찾아 수정함.

## 5. 비활성·격리 검토 후보

의존성 검사 기준 현재 진입 경로에서 로드되지 않는 후보임. 바로 삭제하지 않고 과거 직접 참조 여부를 추가 확인한 뒤 정리함.

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

## 6. 변경 규칙

- 화면 이동은 `app-router.js`만 담당함.
- 같은 버튼에 여러 모듈이 `onclick`/`click`을 중복 등록하지 않음.
- DOM 생성 시점을 기다리기 위한 전역 `MutationObserver`는 최후 수단으로만 사용함. 가능하면 명시적 커스텀 이벤트를 사용함.
- 단순 CSS 변경을 JavaScript 주입 모듈로 만들지 않음.
- 새 기능은 기존 소유 모듈에 통합하는 것을 우선함.
- 파일을 삭제하기 전 재귀 의존성 검사와 저장소 직접 참조 여부를 확인함.
- 사용자 기능 변경과 인증·세션 구조 변경을 한 커밋에 섞지 않음.

## 7. 자동검사

`.github/workflows/app-smoke-check.yml`에서 앱 변경 시 자동으로 아래를 검사함.

- 모든 최상위 JavaScript 문법 검사
- `app.js`에서 시작하는 재귀 의존성 및 누락 파일 검사
- 공용 라우터·현재 핵심 모듈 버전 검사
- 제거한 구형 라우팅/상단 UI 코드 재유입 방지
- 정적 HTTP로 앱 진입 파일 접근 검사

현재 검사는 정적·구조 smoke test임. 로그인 후 실제 클릭, DB 저장, 두 계정 간 동기화까지 확인하는 브라우저 E2E는 다음 안정화 단계에서 추가함.

## 8. 다음 안정화 순서

1. 세션 읽기·갱신 및 Supabase API 호출 공용화
2. 남은 전역 `MutationObserver`를 명시적 이벤트로 축소
3. 자료실·프로필·메시지의 사용자 간 갱신 흐름 통일
4. Playwright 기반 로그인 후 핵심 업무 흐름 E2E 추가
5. 검증된 비활성 파일을 `legacy` 격리 또는 삭제
