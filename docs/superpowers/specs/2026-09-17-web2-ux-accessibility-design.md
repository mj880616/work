# Web2 Task 7 — UX·접근성·반응형 정리 설계

Date: 2026-09-17
Status: Ready for user review
Branch: `design/web2-ux-accessibility`
Base: `main@ce2e5bd18342125771ffa18f79d4a5fd177b7663`

## 1. 목적

Task 6에서 확정한 Design System 1.0을 기반으로, Web2 전 화면을 실제 상시 업무용 도구로 쓰기 위한 사용성·접근성·반응형 품질을 정리함.

이번 단계의 핵심은 새로운 기능을 추가하거나 화면 구조를 전면 재설계하는 것이 아니라, 현재 Home / Calendar / Tasks / Projects / Library / Meetings / Pages / Team / Profile 화면에서 다음 문제를 일관된 계약으로 해결하는 것임.

- 화면마다 다른 정보 위계와 action 위치
- modal의 dialog semantics, focus 이동·복귀, Escape 처리 부재
- 아이콘 버튼과 현재 메뉴의 accessible name/state 부족
- 저장·오류·busy 상태의 screen reader 전달 부족
- 360px / tablet / 1024px / 1440px에서의 overflow·hidden-content 위험
- keyboard-only navigation과 focus visibility 검증 부족
- loading / empty / error / disabled 상태 표현의 화면별 편차

Task 7은 Design System 1.0의 시각 언어를 바꾸지 않고, 그 위에 공통 UX·접근성 계약을 추가하는 단계임.

## 2. 설계 원칙

1. **접근성 계약을 먼저 고정함.** 화면별 미세 조정보다 keyboard, focus, dialog, live status, accessible name을 공통 규칙으로 먼저 확정함.
2. **canonical owner를 유지함.** Router, feature renderer, modal open/close 소유권을 새 helper가 빼앗지 않음.
3. **후행 DOM 보정을 만들지 않음.** MutationObserver, setTimeout, runtime style injection으로 접근성 속성이나 레이아웃을 덧붙이는 방식을 금지함.
4. **기능과 데이터 흐름을 변경하지 않음.** API, Supabase schema, authorization, runtime/session, 저장 모델은 Task 7 범위 밖임.
5. **모바일과 데스크톱의 정보 위계는 동일하게 유지함.** 배치만 달라지고 핵심 action과 상태 의미는 동일해야 함.
6. **자동검사 가능한 계약을 우선함.** 수동 시각 확인만으로 완료 판정하지 않음.

## 3. 범위

### In scope

- navigation의 현재 상태 전달
- 공통 modal/dialog 접근성
- focus 이동·trap·복귀·Escape 동작
- icon-only button accessible name
- status / alert / busy / disabled 의미 전달
- 화면 제목·설명·primary action·toolbar·content 순서의 일관성
- metadata와 badge의 정보 우선순위 조정
- 360 / 768 / 1024 / 1440 viewport의 overflow 및 hidden-content 검증
- keyboard-only 주요 flow 검증
- 관련 HTML/JS/CSS 및 Playwright 회귀검사

### Out of scope

- 새로운 기능 추가
- 메뉴 정보구조 전면개편
- Home 대시보드 기능 추가
- 프로젝트·회의·자료실 데이터 모델 변경
- 인증/권한/RLS 변경
- loader/runtime 성능개선(Task 8)
- branch protection 해결(Task 2 잔여 과제)
- pixel-perfect visual redesign

## 4. 접근성 공통 계약

### 4.1 Navigation

- 현재 활성 navigation item은 시각적 `.active` 상태와 함께 `aria-current="page"`를 가짐.
- 좌측 desktop navigation과 mobile dock 모두 동일한 active/current 의미를 사용함.
- router가 화면 전환을 단독 소유하므로 `aria-current` 갱신도 router의 view activation 경계에서 함께 처리함.
- desktop navigation에는 `aria-label="주요 메뉴"`를 부여함.
- mobile dock은 별도 navigation landmark로 유지하고 의미 있는 `aria-label`을 부여함.
- hidden view의 내부 focusable element가 tab sequence에 남지 않아야 함.

### 4.2 Icon-only controls

텍스트가 시각적으로 기호뿐인 버튼은 명시적 accessible name을 가짐.

예:
- `×` → `aria-label="닫기"`
- `‹` → `aria-label="이전 달"`
- `›` → `aria-label="다음 달"`

단순 `title`만으로 대체하지 않음. 정적 control은 HTML에 직접 속성을 두고, 동적 renderer가 만드는 control은 해당 canonical owner가 생성 시점에 accessible name을 포함함.

### 4.3 Modal / Dialog

모든 production modal은 다음 계약을 만족함.

- `role="dialog"`
- `aria-modal="true"`
- `aria-labelledby`가 modal 제목 element를 가리킴
- 필요 시 `aria-describedby`가 설명/상태 영역을 가리킴
- 열기 직전 trigger element를 기억함
- 열리면 첫 의미 있는 interactive control 또는 dialog container로 focus 이동함
- Tab / Shift+Tab은 열린 modal 안에서 순환함
- Escape로 닫힘. 단, 저장 중이거나 기능상 닫으면 안 되는 state는 해당 owner가 `requestClose`를 거부함
- 닫힌 뒤 원래 trigger가 DOM에 남아 있으면 해당 trigger로 focus 복귀함
- trigger가 사라진 경우 현재 view heading 또는 의미 있는 fallback으로 focus 복귀함
- modal이 닫힐 때 `aria-hidden="true"`, 열릴 때 `aria-hidden="false"`를 기존 visibility contract와 일치시킴

공통 keyboard/focus 동작은 새 `app/accessibility-dialog.js`가 단일 제공함. 단, 이 helper는 modal 표시 여부나 저장 상태를 직접 변경하지 않으며, 기존 canonical owner가 열기/닫기 결정을 계속 소유함.

공통 interface는 다음으로 고정함.

```js
window.KPTUA11y.activateDialog(modal, {
  trigger,
  initialFocus,
  requestClose
});

window.KPTUA11y.deactivateDialog(modal, {
  restoreFocus: true,
  fallbackFocus
});
```

`activateDialog()` 역할:
- trigger 기록
- initial focus 이동
- modal 내부 Tab/Shift+Tab 순환
- Escape 입력 시 owner가 넘긴 `requestClose()` 호출

`deactivateDialog()` 역할:
- key handler 해제
- trigger 또는 fallback으로 focus 복귀

금지사항:
- helper가 `.hidden` class를 직접 조작하지 않음
- helper가 `aria-hidden`을 owner 대신 임의 변경하지 않음
- MutationObserver로 열린 modal을 탐지하지 않음
- 기존 `mobile-modal-history.js`의 browser-back 처리 소유권을 대체하지 않음

정적 modal semantics는 `index.html`에 직접 기록하고, 동적 modal은 renderer가 생성 시점에 semantics를 포함함. helper는 이미 존재하는 dialog DOM의 keyboard/focus lifecycle만 담당함.

### 4.4 Status / Error / Busy

- 일반 저장 성공·진행 메시지: `role="status"` 또는 `aria-live="polite"`
- 즉시 주의가 필요한 오류: `role="alert"` 또는 `aria-live="assertive"`
- 저장 중 primary action: `disabled` + `aria-busy="true"`
- 저장 완료/실패 후 `aria-busy`를 제거함
- 단순 색상만으로 상태를 표현하지 않음
- 기존 visible text는 유지하고 screen-reader-only 문구를 과도하게 추가하지 않음

### 4.5 Focus visibility

- Design System 1.0의 `:focus-visible` outline을 모든 button/input/select/textarea/link/navigation control에 적용함.
- `outline:none`은 대체 focus indicator가 있을 때만 허용함.
- focus 상태가 sticky header, mobile dock, modal footer 뒤에 가려지지 않도록 scroll margin/scroll padding을 확인함.

## 5. 정보 위계와 화면별 UX

공통 화면 흐름은 아래 순서를 기준으로 함.

1. 화면 제목 + 짧은 설명
2. primary action
3. search/filter/sort toolbar
4. main content
5. secondary/contextual actions
6. empty/error/loading state

### 5.1 Home

목표: 요약 화면으로서 읽기 우선, 이동 버튼 남발 억제.

- stat cards는 실제 상태 요약과 navigation shortcut 역할만 유지함.
- `내 할 일`을 핵심 업무 영역으로 유지함.
- 중복된 설명, 의미가 약한 badge, 시각적으로 같은 중요도로 보이는 보조 metadata를 줄임.
- stat card 자체가 button이므로 keyboard focus와 accessible name을 명확히 유지함.

### 5.2 Calendar

목표: 월 이동과 일정 추가가 좁은 화면에서도 즉시 이해되게 함.

- `+ 일정 등록`은 section primary action으로 유지함.
- 이전/다음 월 버튼에 accessible name을 부여함.
- month title을 navigation group의 의미 있는 label로 사용함.
- 360px에서 calendar cell content가 horizontal overflow를 만들지 않도록 점검함.
- 일정 modal은 dialog contract를 우선 적용함.

### 5.3 Tasks

목표: high-frequency 업무화면으로서 filter와 primary action을 가장 빠르게 접근 가능하게 함.

- `+ 할 일 추가`는 첫 viewport에 유지함.
- `내 할 일 / 팀 전체`, `미완료 / 전체 / 완료` filter의 label 관계를 명확히 함.
- 완료/수정/삭제 action은 keyboard 순서가 내용 읽기 순서와 충돌하지 않도록 유지함.
- 상태별 empty message를 동일 state primitive와 semantic role로 정리함.

### 5.4 Projects

목표: 카드 내부 정보량을 줄이고 핵심 상태·다음 action이 먼저 보이게 함.

- 프로젝트명 → 상태/유형 → 핵심 metadata → action 순으로 유지함.
- badge가 metadata를 대체하지 않도록 제한함.
- detail modal의 section navigation과 close/focus contract를 점검함.
- child project menu가 keyboard로 열리고 이동 가능한지 확인함.

### 5.5 Library

목표: 검색/필터/등록의 역할을 명확히 구분함.

- 자료 검색 input에 visible 또는 accessible label을 제공함.
- 프로젝트 filter와 search의 의미를 screen reader가 식별 가능해야 함.
- 자료 등록 modal의 입력 label은 기존 visible label 구조를 유지함.
- upload/link failure는 해당 modal 안에서 error status로 전달함.

### 5.6 Meetings

목표: 회의 기록의 읽기 위계와 연결 action을 명확히 함.

- 회의명·일시·결정·할 일 연결 순서를 유지함.
- 상세 modal/round detail의 heading level이 논리적으로 이어지도록 정리함.
- 생성·수정 modal focus contract를 적용함.

### 5.7 Pages

목표: 게시 상태·공개범위·편집 action을 혼동하지 않게 함.

- 검색 input과 상태 filter label을 명확히 함.
- published/review/draft 등의 badge는 상태 정보에만 사용함.
- edit/open/share/delete action의 visual hierarchy는 기능 위험도에 맞게 유지함.
- page modal/editor의 dialog semantics와 저장 busy/error state를 적용함.

### 5.8 Team / Profile / Suborganizations

목표: 관리 action과 일반 조회 action의 의미를 분리함.

- 관리자 전용 버튼이 hidden일 때 focus 대상에 남지 않음을 확인함.
- 구성원·그룹·산하조직 카드에서 role/status badge와 action이 혼동되지 않게 함.
- profile modal/view가 실제 dialog 또는 routed view인지 구조에 맞는 semantics를 사용함.
- destructive action은 accessible name에도 목적 대상을 포함할 수 있도록 검토함.

## 6. Responsive Contract

### 6.1 Canonical viewports

- 360×800: 최소 mobile 품질 기준
- 768×1024: tablet/intermediate 기준
- 1024×768: desktop 진입 기준
- 1440×900: wide desktop 기준

390px는 기존 회귀검사에서 계속 유지 가능하지만 Task 7의 최소 mobile 기준은 360px로 둠.

### 6.2 공통 조건

각 viewport에서 다음을 만족해야 함.

- document-level horizontal scroll 없음
- primary action이 viewport 밖으로 잘리지 않음
- sticky topbar / mobile dock이 content나 focus target을 가리지 않음
- modal footer가 viewport 아래로 사라지지 않음
- modal body가 길면 modal 내부가 scroll됨
- toolbar는 필요한 경우 wrap되지만 control 의미 순서는 유지함
- 최소 터치 target은 기존 36px control 계약을 하한으로 유지하고, compact/icon은 Design System 규격을 따름
- text zoom/긴 한국어 제목에서 버튼·badge가 container를 밀어내지 않음

## 7. 코드 책임과 예상 변경 파일

### 공통

- Create: `app/accessibility-dialog.js` — dialog keyboard/focus lifecycle 전용 helper
- Modify: `app/loader-v2.js` — helper를 feature modal owners보다 먼저 1회 로드
- Modify: `app/index.html` — 정적 modal semantics, labels, navigation semantics
- Modify: `app/app-router.js` — active/current navigation 동기화
- Modify: `app/base-ui.css` — focus/label/responsive shared rules 보강
- Modify: `app/workspace-ui.css`, `app/desktop-ui.css` — shell overflow/focus clearance만 수정

### Modal/feature owners

- `app/team.js`
- `app/calendar-*`
- `app/task-layout.js` / task owner
- `app/project-system-v3.js`
- `app/library-upload.js`
- `app/meeting-round-detail.js` / meeting owner
- `app/page-*`
- `app/profile-settings.js`
- `app/suborganizations.js`

각 기능 owner가 modal visibility와 save lifecycle을 계속 소유하며, open/close 직후 `KPTUA11y.activateDialog()` / `deactivateDialog()`를 명시적으로 호출함.

### Tests

- Create: `tests/app-e2e/accessibility-ux.spec.mjs`
- Modify: `tests/app-e2e/ui-system.spec.mjs`
- Review/modify: `mobile-ux-shell.spec.mjs`, `desktop-layout.spec.mjs` 및 feature-specific specs
- Modify: `.github/workflows/app-e2e-check.yml`
- Modify: `.github/workflows/app-smoke-check.yml` — MutationObserver/setTimeout 기반 접근성 보정 재유입 금지 및 helper load contract 검사

## 8. Test Design

### 8.1 Accessibility E2E

최소 검증:

- active nav에 `aria-current="page"`
- navigation landmark에 accessible name 존재
- icon-only controls에 accessible name 존재
- 주요 modal에 `role=dialog`, `aria-modal=true`, valid labelledby 존재
- modal open 시 focus가 modal 내부로 이동
- Tab / Shift+Tab이 modal 밖으로 탈출하지 않음
- Escape가 owner close path를 호출해 modal을 닫음
- close 후 trigger로 focus 복귀
- saving button의 disabled + `aria-busy`
- error/status live semantics

### 8.2 Responsive E2E

Home / Calendar / Tasks / Projects / Library / Meetings / Pages / Team에 대해 360, 768, 1024, 1440에서 아래를 자동검사함.

```text
scrollWidth <= clientWidth + tolerance
visible primary action rect within viewport
visible toolbar controls not clipped
last meaningful content can scroll above mobile dock
open modal rect/footer remains reachable
```

### 8.3 Keyboard-only smoke

최소 대표 flow:

1. 로그인
2. keyboard로 Tasks 진입
3. `+ 할 일 추가` focus
4. Enter로 modal open
5. modal form Tab 이동
6. Escape로 닫기
7. focus가 `+ 할 일 추가`로 복귀

Calendar와 Pages에서도 같은 modal contract를 재사용 검증함.

## 9. 구현 순서

### Phase 1 — Accessibility foundation

- navigation current state
- icon accessible names
- `accessibility-dialog.js`
- dialog semantics
- focus open/close/trap/Escape
- live/busy semantics
- accessibility regression tests

### Phase 2 — High-frequency screens

- Home
- Tasks
- Calendar

정보 위계, action 위치, 360/tablet overflow를 우선 정리함.

### Phase 3 — Content/management screens

- Projects
- Library
- Meetings
- Pages
- Team/Profile/Suborganizations

공통 foundation을 재사용하고 화면별 예외를 최소화함.

### Phase 4 — Viewport and regression sweep

- 360 / 768 / 1024 / 1440 전수검사
- hidden-content / overflow / focus-obscured 검사
- 전체 기존 E2E + Task 7 신규 E2E
- cache version 갱신
- PR latest head green 확인 후 squash merge

## 10. 완료 조건

Task 7은 다음 조건을 모두 만족할 때 완료로 판단함.

1. 주요 navigation이 현재 위치를 programmatically 전달함.
2. 주요 modal이 dialog semantics와 focus open/close/Escape contract를 만족함.
3. icon-only controls에 accessible name이 존재함.
4. 저장/오류/busy 상태가 시각적 표현뿐 아니라 semantic state로 전달됨.
5. keyboard-only 대표 flow가 통과함.
6. Home/Calendar/Tasks/Projects/Library/Meetings/Pages/Team이 360/768/1024/1440에서 document-level overflow 없이 사용 가능함.
7. mobile dock, sticky header, modal footer가 focus/content를 가리지 않음.
8. 기존 canonical owner, authz, runtime/session/data contracts가 유지됨.
9. 신규 접근성·UX E2E와 기존 관련 CI가 모두 green임.
10. 알려진 P0/P1 UX·접근성 회귀가 없음.

## 11. 비목표 및 후속 단계

Task 7 종료 후에도 다음은 별도 단계로 남김.

- startup module graph / lazy loading / request count 최적화: Task 8
- 최종 production audit 및 residual risk register: Task 9
- branch protection: 기존 Task 2 잔여 과제
- 필요 시 WCAG 세부 준수 수준 전체 감사는 별도 audit로 진행 가능

Task 7의 목적은 Web2를 모든 접근성 표준에 대한 완전한 인증 상태로 만드는 것이 아니라, 실제 프로덕션 업무도구에서 필요한 기본 keyboard·focus·dialog·status·responsive contract를 자동검사 가능한 수준으로 고정하는 것임.
