# Web2 Design System 1.0 — Design Specification

Date: 2026-09-17
Status: Proposed for implementation
Branch: `design/web2-design-system-1`

## 1. Purpose

Web2의 현재 기능 구조와 DOM 소유권은 유지하면서, 시각체계를 전면 재정비해 장시간 업무에 적합한 차분한 업무도구형 UI를 만든다. 목표는 화면을 새로 꾸미는 것이 아니라, 현재 각 기능 CSS에 흩어진 색상·간격·radius·shadow·버튼·카드 규칙을 하나의 디자인 시스템으로 통합하고 이후 기능 개발이 다시 임의 스타일을 늘리지 못하게 하는 것이다.

이번 단계는 Task 6에 한정한다. 화면별 정보 구조·기능 흐름·콘텐츠 우선순위 자체를 다시 설계하는 작업은 Task 7에서 수행한다.

## 2. Design Direction

선택한 방향은 “차분한 업무도구형”이다.

핵심 원칙:

- 장식보다 정보 구조가 먼저 보이게 한다.
- 장시간 사용에서 시각 피로를 줄인다.
- 카드와 그림자를 남발하지 않는다.
- 색상은 의미 전달에만 사용한다.
- 데스크톱과 모바일에서 같은 정보가 같은 시각언어를 사용한다.
- 조작 요소의 크기와 상태를 화면마다 다르게 정의하지 않는다.
- 기존 네이비 계열의 정체성은 유지하되 채도와 대비를 절제한다.

비교 기준으로는 Notion·Linear 계열의 절제된 업무도구 밀도를 참고하되, 특정 제품을 복제하지 않는다.

## 3. Scope

### In scope

- `app/base-ui.css`를 design tokens + common primitives의 기준점으로 재구성
- `app/workspace-ui.css`의 공통 후행 보정 축소 및 primitive 흡수
- `app/desktop-ui.css`를 데스크톱 레이아웃 역할 중심으로 축소
- `app/styles.css` 로드 순서와 책임 경계 정리
- 기능별 CSS에서 공통 색상·간격·radius·shadow·버튼·카드 규칙 제거 또는 token 참조로 전환
- Button, Card, SectionHeader, Toolbar, Badge, State, Modal, Toast 공통 규격 확정
- 모바일/데스크톱 반응형 규칙을 공통 breakpoint에 맞춤
- Design System invariants를 자동검사에 추가

### Out of scope

- 화면별 콘텐츠 재배치
- 정보 architecture 변경
- 메뉴 체계 개편
- 기능 삭제·추가
- API, Supabase schema, authorization 변경
- router/session/runtime 동작 변경
- Android WebView 동작 변경
- Task 7에서 다룰 세부 UX·접근성 전면개편

## 4. Architecture and CSS Ownership

CSS 책임 계층은 다음과 같이 고정한다.

1. `base-ui.css`
   - tokens
   - reset/base typography
   - controls
   - primitive components
   - universal state styles

2. `workspace-ui.css`
   - app shell 공통 레이아웃
   - workspace 단위의 공통 화면 배치
   - mobile dock/safe-area와 같은 앱 공통 반응형 제약
   - feature-specific 시각 규칙을 소유하지 않음

3. `desktop-ui.css`
   - 1024px+ shell/grid/navigation 폭
   - 1440px+ content width 조정
   - feature card/button/modal 스타일을 소유하지 않음

4. feature CSS
   - 해당 기능에서만 존재하는 구조적 레이아웃과 semantic variation만 소유
   - 공통 버튼·카드·배지·모달·상태 스타일을 재정의하지 않음
   - raw color/radius/shadow를 새로 만들지 않고 tokens 사용

`styles.css`는 위 계층 순서가 깨지지 않도록 import order를 명시적으로 유지한다.

## 5. Token System

토큰명은 `--kptu-*` prefix를 사용한다.

### 5.1 Color

Neutral:
- `--kptu-bg: #f5f6f7`
- `--kptu-surface: #ffffff`
- `--kptu-surface-subtle: #fafbfc`
- `--kptu-ink: #1f2933`
- `--kptu-muted: #66727f`
- `--kptu-faint: #8a949e`
- `--kptu-border: #dfe4e8`
- `--kptu-border-strong: #cfd6dc`

Brand/action:
- `--kptu-primary: #263f5f`
- `--kptu-primary-hover: #1f354f`
- `--kptu-primary-soft: #eef2f6`
- `--kptu-link: #355f86`

Semantic:
- `--kptu-success: #2f6b4f`
- `--kptu-success-soft: #eef6f1`
- `--kptu-warning: #8a6218`
- `--kptu-warning-soft: #faf4e7`
- `--kptu-danger: #9a4048`
- `--kptu-danger-soft: #faeeee`
- `--kptu-info: #496b8c`
- `--kptu-info-soft: #eef4f8`

원칙:
- 색상은 token을 통해서만 사용한다.
- 기능 CSS에 새로운 hex/rgb를 추가하지 않는다. 예외는 외부 서비스 브랜드 색상처럼 의미가 고정된 경우뿐이다.
- primary는 선택·핵심 action에만 사용한다.

### 5.2 Spacing

기본 spacing scale:
- `--kptu-space-1: 4px`
- `--kptu-space-2: 8px`
- `--kptu-space-3: 12px`
- `--kptu-space-4: 16px`
- `--kptu-space-5: 24px`
- `--kptu-space-6: 32px`

기능 CSS의 임의 5/7/9/11/13/17px spacing은 단계적으로 scale에 맞춘다. 정밀 정렬에 필요한 1~2px border/optical correction은 허용한다.

### 5.3 Radius

- `--kptu-radius-sm: 6px`
- `--kptu-radius-md: 8px`
- `--kptu-radius-lg: 12px`
- `--kptu-radius-pill: 999px`

사용:
- badge/chip: pill
- compact control: sm
- button/input: md
- card/modal section: lg

기능 CSS가 자체 9/10/11/14/15/16/18/20px radius를 갖지 않도록 정리한다.

### 5.4 Shadow

- `--kptu-shadow-float: 0 8px 24px rgba(20,33,48,.08)`
- `--kptu-shadow-modal: 0 24px 64px rgba(20,33,48,.16)`

일반 card에는 shadow를 기본 적용하지 않는다. shadow는 floating UI, dropdown, modal에만 사용한다.

### 5.5 Typography

Font family는 기존 system/Noto Sans KR stack을 유지한다.

단계:
- Page title: 28px / 1.25 / 800
- Section title: 20px / 1.35 / 800
- Card title: 15px / 1.4 / 700
- Body: 14px / 1.55 / 400~600
- Meta: 12px / 1.45 / 500~600
- Micro: 11px / 1.4 / 500~700

모바일에서는 Page title을 24px로 축소한다. 화면별 독자 type scale을 만들지 않는다.

### 5.6 Action sizes

- Default control height: 36px
- Compact action height: 32px
- Icon button: 32px square
- Input/select/textarea minimum control height: 36px

기존 `--kptu-action-*` 계열은 새 token naming으로 통합하거나 compatibility alias로 유지한다.

## 6. Core Primitives

### 6.1 Button

Variant:
- Primary
- Secondary
- Ghost
- Danger

State:
- default
- hover
- active
- focus-visible
- disabled
- busy

규칙:
- 버튼 높이와 padding은 공통 token 사용
- 동일 hierarchy의 action은 화면에 관계없이 같은 variant 사용
- `!important`로 크기를 강제하는 현재 방식은 제거 대상으로 본다
- destructive action은 Danger로만 표현

### 6.2 Card

기본 Card:
- white surface
- 1px neutral border
- large radius
- no shadow
- padding 16px 또는 24px

hoverable Card만 border tone을 소폭 강화한다. 카드 안 카드 구조는 가능한 한 피한다. 기능상 nested grouping이 필요한 경우 inner block은 `surface-subtle` 또는 border-top을 사용한다.

### 6.3 SectionHeader

공통 구조:
- left: title + optional description
- right: primary/secondary actions
- mobile: 필요 시 세로 적층하되 hierarchy 유지

`section-head`, `panel-head` 계열을 하나의 시각 규격으로 통합한다.

### 6.4 Toolbar

기본 순서:
1. search
2. filter/sort
3. contextual secondary action
4. primary action

모바일에서는 세로 wrap을 허용하되 control height와 spacing은 동일하게 유지한다.

### 6.5 Badge / Chip

Badge는 status/visibility/role 등 semantic 정보만 표현한다. 장식성 badge는 제거 대상으로 본다.

Variant:
- neutral
- info
- success
- warning
- danger

Badge font와 padding은 공통 규격을 사용한다.

### 6.6 State primitive

Empty / Loading / Error / Success informational state가 같은 구조를 공유한다.

구성:
- optional title
- body
- optional action

Error는 `danger` semantic token을 사용하되 화면 전체를 붉게 만들지 않는다.

### 6.7 Modal

Desktop:
- viewport center
- max-width role별 preset
- radius lg
- modal shadow
- header/body/footer spacing 통일

Mobile:
- bottom sheet 방식 유지
- safe area 반영
- viewport를 넘는 content는 modal 내부 scroll
- footer action이 content와 충돌하지 않도록 sticky footer 사용 가능

모달별 자체 radius/padding/shadow는 feature CSS에서 제거한다.

### 6.8 Toast

- 짧은 feedback 전용
- 한 번에 하나의 toast
- 기본 neutral dark surface
- semantic color는 icon/text accent 수준으로 제한
- mobile dock 위에 안전하게 위치

## 7. Responsive System

공통 breakpoint:
- mobile: `< 760px`
- desktop: `>= 1024px`
- wide desktop: `>= 1440px`

760~1023px은 tablet/intermediate layout으로 간주하고 기존 fluid layout을 유지한다.

원칙:
- feature CSS가 제각각 700/720/768/800px breakpoint를 새로 만들지 않는다.
- 기존 예외 breakpoint는 기능상 이유가 확인된 경우만 유지한다.
- desktop에서는 left navigation + workspace content 구조를 유지한다.
- wide desktop에서는 콘텐츠 폭을 무제한 확장하지 않는다.
- mobile에서는 같은 정보 hierarchy를 세로로 재배치한다.

## 8. `!important` Policy

현재 `workspace-ui.css`와 일부 feature CSS의 `!important`는 전수 점검한다.

허용:
- `.hidden`
- safe-area / mobile dock 충돌 회피처럼 cascade보다 명시적 강제가 필요한 app-shell invariant
- third-party/external style override가 불가피한 경우

제거 대상:
- button height/padding/font
- card radius/shadow
- generic modal padding/radius
- feature-level color
- layout correction을 위해 후행 stylesheet가 앞선 stylesheet를 억지로 덮는 경우

목표는 `!important` 0개가 아니라, 사용 이유가 app-shell invariant로 설명 가능한 상태다.

## 9. Migration Strategy

한 번에 모든 feature UI를 시각적으로 재작성하지 않는다. Design System 1.0은 아래 순서로 적용한다.

Phase 1 — tokens + primitives
- `base-ui.css` 재구성
- compatibility aliases 제공
- 공통 button/card/header/toolbar/badge/state/modal/toast 확정

Phase 2 — shell
- `workspace-ui.css`에서 후행 보정 축소
- `desktop-ui.css`에서 feature styling 제거
- safe-area/mobile dock invariant 유지

Phase 3 — feature normalization
- Home
- Calendar
- Tasks
- Projects
- Library
- Meetings
- Pages
- Team/Profile/Suborganizations

각 feature는 구조 변경 없이 공통 tokens/primitives로 치환한다.

Phase 4 — cleanup
- raw colors/radii/shadows scan
- 불필요한 `!important` 제거
- compatibility alias 중 불필요한 항목 제거
- `styles.css` cache version 갱신

## 10. Testing and Invariants

기존 기능 E2E는 모두 유지한다.

Design System 전용 검사에서 최소 다음을 검증한다.

- top-level action button의 실제 높이가 동일 hierarchy에서 일치
- primary/secondary/ghost/danger variant의 computed style이 화면별로 동일
- generic card radius/border가 공통 token과 일치
- modal desktop/mobile 구조가 공통 규격과 일치
- 390px에서 mobile dock과 마지막 content가 겹치지 않음
- 1024px에서 left navigation과 content가 겹치지 않음
- 1440px에서 content width가 과도하게 확장되지 않음
- raw color/radius/shadow 신규 추가를 정적 검사로 제한
- 공통 primitive를 feature stylesheet에서 재정의하지 않도록 smoke rule 추가

시각 회귀는 pixel-perfect screenshot 강제보다 computed-style invariant와 핵심 viewport interaction을 우선한다. Task 7에서 화면별 시각검증을 확대한다.

## 11. Compatibility Rules

- DOM id/class 이름은 기능 테스트와 JS가 의존하는 경우 유지한다.
- 디자인 통일을 위해 JS renderer를 바꾸지 않는다.
- 기존 class가 primitive 역할과 충돌하면 CSS alias를 먼저 사용한다.
- 기능이 안정된 상태에서 class rename이 필요하면 별도 단계와 테스트로 처리한다.
- runtime style injection을 새로 도입하지 않는다.

## 12. Success Criteria

Task 6 완료 조건:

1. spacing/type/radius/border/shadow/color/action size/breakpoint가 token으로 명시됨.
2. Button/Card/SectionHeader/Toolbar/Badge/State/Modal/Toast가 공통 규격을 사용함.
3. 주요 feature CSS가 공통 primitive의 시각 규칙을 자체 재정의하지 않음.
4. 공통 버튼·카드·모달을 위해 사용되던 불필요한 `!important`가 제거됨.
5. 390px, 1024px, 1440px 핵심 화면에서 동일 시각언어가 확인됨.
6. 기존 기능 E2E가 모두 green임.
7. 디자인 시스템 구조와 invariant를 CI가 지속적으로 검사함.

## 13. Non-goals / Deferred to Task 7

다음 항목은 Design System 1.0의 기반 위에서 Task 7에서 처리한다.

- 화면별 정보 hierarchy 재조정
- 개별 화면의 action 위치 재설계
- keyboard/focus/accessibility 전수 점검
- loading skeleton 등 화면별 세부 UX
- 360px, tablet, 1024px+, 1440px+ 전체 화면 QA
- 홈/프로젝트/자료실 등의 카드 개수 및 실제 정보 밀도 조정

Task 6은 “모든 화면을 예쁘게 완성”하는 단계가 아니라, Task 7에서 일관된 UX 개선이 가능하도록 시각 언어와 CSS 책임 경계를 고정하는 단계다.
