# Web2 Design System 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web2의 기존 기능·DOM 소유권·데이터 흐름을 유지하면서, 차분한 업무도구형 Design System 1.0을 토큰·공통 primitive·반응형 규칙·CI invariant로 고정하고 주요 feature CSS를 이 체계에 정규화함.

**Architecture:** `base-ui.css`가 디자인 토큰과 공통 primitive의 유일한 기준점이 되고, `workspace-ui.css`는 app shell/mobile safe-area, `desktop-ui.css`는 1024px+ shell/layout만 담당함. Feature CSS는 해당 기능의 구조적 레이아웃과 semantic variation만 유지하며 공통 버튼·카드·배지·모달·상태 시각 규칙은 재정의하지 않음. 기존 JS/DOM 계약은 변경하지 않음.

**Tech Stack:** GitHub Pages, vanilla CSS/JavaScript, Playwright 1.55 Chromium, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-web2-design-system-1-design.md`

## Global Constraints

- 장식보다 정보 구조가 먼저 보이게 함.
- 기존 네이비 계열 정체성은 유지하되 채도와 대비를 절제함.
- 기본 spacing scale은 4/8/12/16/24/32px만 사용함.
- radius는 6/8/12px + pill만 사용함.
- 일반 card에는 shadow를 기본 적용하지 않음.
- default control height는 36px, compact action은 32px, icon button은 32px square로 고정함.
- mobile `<760px`, desktop `>=1024px`, wide desktop `>=1440px`를 공통 breakpoint로 사용함.
- `!important`는 `.hidden`, safe-area/mobile dock invariant, 불가피한 external override에만 허용함.
- DOM id/class 이름과 JS renderer는 기능 의존성이 있는 한 유지함.
- runtime style injection을 새로 도입하지 않음.
- API, Supabase schema, authorization, router/session/runtime 동작을 변경하지 않음.
- 기존 기능 E2E가 모두 green이 되기 전 main에 병합하지 않음.

---

### Task 1: Design System 회귀검사부터 고정

**Files:**
- Create: `tests/app-e2e/design-system.spec.mjs`
- Modify: `.github/workflows/app-e2e-check.yml`
- Modify: `tests/app-e2e/ui-system.spec.mjs`

**Interfaces:**
- Consumes: 현재 로그인 mock과 `#appView` 공통 UI
- Produces: `:root` token, Button/Card/Modal/SectionHeader의 computed-style 계약

- [ ] **Step 1: 새 Playwright 테스트를 추가해 현재 CSS에서 실패하게 함**

`tests/app-e2e/design-system.spec.mjs`에 `ui-system.spec.mjs`의 Supabase mock/login helper 패턴을 재사용하고 아래 invariant를 작성함.

```js
const tokenNames=[
  '--kptu-bg','--kptu-surface','--kptu-ink','--kptu-muted','--kptu-border',
  '--kptu-primary','--kptu-success','--kptu-warning','--kptu-danger','--kptu-info',
  '--kptu-space-1','--kptu-space-2','--kptu-space-3','--kptu-space-4','--kptu-space-5','--kptu-space-6',
  '--kptu-radius-sm','--kptu-radius-md','--kptu-radius-lg',
  '--kptu-control-height','--kptu-action-compact-height'
];
const values=await page.evaluate(names=>{
  const s=getComputedStyle(document.documentElement);
  return Object.fromEntries(names.map(n=>[n,s.getPropertyValue(n).trim()]));
},tokenNames);
for(const name of tokenNames)expect(values[name],name).not.toBe('');
```

버튼 계약:

```js
const selectors=['#newEventBtn','#newTaskBtn','#newProjectBtn','#newDocumentBtn','#newMeetingBtn','#newPageBtn'];
const metrics=[];
for(const selector of selectors){
  const el=page.locator(selector);
  await expect(el).toBeVisible();
  metrics.push(await el.evaluate(node=>({
    height:node.getBoundingClientRect().height,
    radius:getComputedStyle(node).borderRadius,
    fontSize:getComputedStyle(node).fontSize
  })));
}
expect(new Set(metrics.map(x=>Math.round(x.height))).size).toBe(1);
expect(metrics[0].height).toBeCloseTo(36,0);
expect(new Set(metrics.map(x=>x.radius)).size).toBe(1);
```

카드/모달 계약:

```js
await page.locator('[data-view="pages"]').first().click();
const card=page.locator('.page-card').first();
if(await card.count()){
  const css=await card.evaluate(el=>getComputedStyle(el));
  expect(css.borderRadius).toBe('12px');
  expect(css.boxShadow).toBe('none');
}
await page.locator('#newTaskBtn').click();
const modal=page.locator('#taskModal .modal-card');
await expect(modal).toBeVisible();
expect(await modal.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('12px');
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run:

```bash
python3 -m http.server 8123 >/tmp/kptu-design-http.log 2>&1 &
npx playwright test tests/app-e2e/design-system.spec.mjs --browser=chromium --workers=1 --reporter=line
```

Expected: FAIL. 현재 `--kptu-*` 핵심 token이 없고 top-level primary button이 36px 규격이 아니며 card/modal radius가 12px로 통일되지 않았기 때문임.

- [ ] **Step 3: 기존 `ui-system.spec.mjs`의 버튼 기준을 새 규격에 맞게 엄격화**

기존 `30px 이상, 편차 1.5px 이하` 조건을 다음처럼 변경함.

```js
expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(.5);
for(const height of heights)expect(height).toBeCloseTo(36,0);
```

- [ ] **Step 4: App browser E2E workflow에 새 테스트를 포함**

`.github/workflows/app-e2e-check.yml`의 실행 목록에서 `tests/app-e2e/ui-system.spec.mjs` 바로 다음에 다음 줄을 추가함.

```text
tests/app-e2e/design-system.spec.mjs
```

- [ ] **Step 5: 커밋**

```bash
git add tests/app-e2e/design-system.spec.mjs tests/app-e2e/ui-system.spec.mjs .github/workflows/app-e2e-check.yml
git commit -m "test: define Design System 1.0 invariants"
```

---

### Task 2: `base-ui.css`에 token과 primitive를 단일 소유자로 구현

**Files:**
- Modify: `app/base-ui.css`
- Test: `tests/app-e2e/design-system.spec.mjs`

**Interfaces:**
- Consumes: 기존 `.primary`, `.secondary`, `.ghost`, `.mini`, `.page-card`, `.group-card`, `.section-head`, `.toolbar`, `.badge`, `.empty`, `.modal`, `.modal-card`, `.toast`
- Produces: `--kptu-*` token 및 compatibility alias `--bg/--paper/--ink/--muted/--line/--navy/--blue/--green/--amber/--red`

- [ ] **Step 1: `:root`를 새 token 세트로 교체하고 기존 변수는 alias로 연결**

```css
:root{
  --kptu-bg:#f5f6f7;
  --kptu-surface:#fff;
  --kptu-surface-subtle:#fafbfc;
  --kptu-ink:#1f2933;
  --kptu-muted:#66727f;
  --kptu-faint:#8a949e;
  --kptu-border:#dfe4e8;
  --kptu-border-strong:#cfd6dc;
  --kptu-primary:#263f5f;
  --kptu-primary-hover:#1f354f;
  --kptu-primary-soft:#eef2f6;
  --kptu-link:#355f86;
  --kptu-success:#2f6b4f;
  --kptu-success-soft:#eef6f1;
  --kptu-warning:#8a6218;
  --kptu-warning-soft:#faf4e7;
  --kptu-danger:#9a4048;
  --kptu-danger-soft:#faeeee;
  --kptu-info:#496b8c;
  --kptu-info-soft:#eef4f8;
  --kptu-space-1:4px;
  --kptu-space-2:8px;
  --kptu-space-3:12px;
  --kptu-space-4:16px;
  --kptu-space-5:24px;
  --kptu-space-6:32px;
  --kptu-radius-sm:6px;
  --kptu-radius-md:8px;
  --kptu-radius-lg:12px;
  --kptu-radius-pill:999px;
  --kptu-shadow-float:0 8px 24px rgba(20,33,48,.08);
  --kptu-shadow-modal:0 24px 64px rgba(20,33,48,.16);
  --kptu-control-height:36px;
  --kptu-action-compact-height:32px;
  --bg:var(--kptu-bg);--paper:var(--kptu-surface);--ink:var(--kptu-ink);--muted:var(--kptu-muted);
  --line:var(--kptu-border);--navy:var(--kptu-primary);--blue:var(--kptu-link);
  --green:var(--kptu-success);--amber:var(--kptu-warning);--red:var(--kptu-danger);
}
```

- [ ] **Step 2: 공통 Button variant를 36px 기준으로 구현**

```css
.primary,.secondary,.ghost,.danger,.mini{
  min-height:var(--kptu-control-height);
  border:1px solid transparent;
  border-radius:var(--kptu-radius-md);
  padding:0 var(--kptu-space-3);
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:var(--kptu-space-1);
  font-size:12px;
  font-weight:700;
  line-height:1;
  white-space:nowrap;
}
.mini{min-height:var(--kptu-action-compact-height);font-size:11px;padding:0 var(--kptu-space-2)}
.primary{background:var(--kptu-primary);color:#fff}
.primary:hover{background:var(--kptu-primary-hover)}
.secondary{background:var(--kptu-surface);color:var(--kptu-ink);border-color:var(--kptu-border-strong)}
.ghost{background:transparent;color:var(--kptu-muted)}
.danger{background:var(--kptu-danger);color:#fff}
.primary:focus-visible,.secondary:focus-visible,.ghost:focus-visible,.danger:focus-visible,.mini:focus-visible{outline:2px solid var(--kptu-info);outline-offset:2px}
button:disabled,[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
```

- [ ] **Step 3: Card/SectionHeader/Toolbar/Badge/State/Modal/Toast 규격을 base에 통합**

핵심 값:

```css
.page-card,.group-card,.panel,.project-card{
  background:var(--kptu-surface);
  border:1px solid var(--kptu-border);
  border-radius:var(--kptu-radius-lg);
  box-shadow:none;
}
.section-head,.panel-head{display:flex;align-items:center;justify-content:space-between;gap:var(--kptu-space-3);margin-bottom:var(--kptu-space-4)}
.toolbar{display:flex;align-items:center;gap:var(--kptu-space-2);margin-bottom:var(--kptu-space-4)}
.badge{border-radius:var(--kptu-radius-pill);font-size:11px;font-weight:700;padding:3px 8px;background:var(--kptu-primary-soft);color:var(--kptu-muted)}
.empty,.state-empty,.state-error,.state-loading{border:1px dashed var(--kptu-border-strong);border-radius:var(--kptu-radius-lg);background:var(--kptu-surface);color:var(--kptu-muted)}
.modal-card{background:var(--kptu-surface);border-radius:var(--kptu-radius-lg);box-shadow:var(--kptu-shadow-modal)}
.toast{background:#25303a;color:#fff;border-radius:var(--kptu-radius-md);box-shadow:var(--kptu-shadow-float)}
```

- [ ] **Step 4: 모바일 base breakpoint를 정확히 760px로 통일**

현재 `@media(max-width:760px)`는 유지하되 button/card/modal primitive의 크기 자체를 별도로 축소하지 않음. Page title만 24px로 축소함.

- [ ] **Step 5: Design System 테스트 실행**

Run:

```bash
npx playwright test tests/app-e2e/design-system.spec.mjs tests/app-e2e/ui-system.spec.mjs --browser=chromium --workers=1 --reporter=line
```

Expected: token 존재 및 기본 primitive 계약 PASS. Feature override 때문에 일부 computed-style 검사가 남아 실패할 수 있으며, 해당 실패는 Task 3~4에서 제거함.

- [ ] **Step 6: 커밋**

```bash
git add app/base-ui.css
git commit -m "style: establish Design System 1.0 primitives"
```

---

### Task 3: Shell CSS에서 후행 보정 제거

**Files:**
- Modify: `app/workspace-ui.css`
- Modify: `app/desktop-ui.css`
- Modify: `app/desktop-tight-nav.css`
- Test: `tests/app-e2e/design-system.spec.mjs`
- Test: `tests/app-e2e/mobile-ux-shell.spec.mjs`
- Test: `tests/app-e2e/desktop-layout.spec.mjs`

**Interfaces:**
- Consumes: Task 2의 `--kptu-*` token과 primitive
- Produces: workspace shell/mobile safe-area/desktop grid만 담당하는 shell CSS

- [ ] **Step 1: `workspace-ui.css`의 공통 버튼 강제 블록을 제거**

다음 selector group처럼 button height/padding/radius/font를 `!important`로 강제하는 블록을 삭제함.

```css
#appView .mini,
#appView .section-head button:not(.nav-btn),
#appView .panel-head button:not(.nav-btn),
#appView .workspace-head .head-actions button,
...
```

`--kptu-action-height`, `--kptu-action-pad-*`, `--kptu-action-radius`, `--kptu-action-font`은 삭제하고 `--kptu-mobile-dock`, `--kptu-mobile-gap`만 shell token으로 유지함.

- [ ] **Step 2: workspace breakpoint를 700px에서 760px로 통일**

```css
@media(max-width:760px){
  html,body{scroll-padding-bottom:calc(var(--kptu-mobile-dock) + var(--kptu-mobile-gap))!important}
  body{padding-bottom:var(--kptu-mobile-dock)!important}
  main{padding-bottom:calc(var(--kptu-mobile-dock) + 30px)!important}
  #appView .view-panel{padding-bottom:calc(var(--kptu-mobile-dock) + 22px)!important}
}
```

safe-area/mobile dock 관련 `!important`는 app-shell invariant이므로 유지 가능함. 메시지 peer list처럼 feature-specific 모바일 보정은 `collaboration-center.css`로 이동시킬 대상으로 표시하고 Task 4에서 이동함.

- [ ] **Step 3: `desktop-ui.css`의 card shadow 등 feature styling을 제거**

다음 규칙은 삭제함.

```css
.panel,.project-card,.page-card,.group-card{box-shadow:0 5px 18px rgba(20,33,48,.035)}
```

desktop 파일에는 `main`, `#appView.app-view`, `.app-nav`, `.view-panel`, grid column 수, modal viewport sizing처럼 layout만 남김. `.app-nav` 자체 surface/border는 shell component이므로 token을 사용해 유지함.

- [ ] **Step 4: 390/1024/1440 viewport 회귀 테스트 실행**

Run:

```bash
npx playwright test tests/app-e2e/design-system.spec.mjs tests/app-e2e/mobile-ux-shell.spec.mjs tests/app-e2e/desktop-layout.spec.mjs --browser=chromium --workers=1 --reporter=line
```

Expected: mobile dock clearance, desktop navigation/content non-overlap, 1440px max-width PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/workspace-ui.css app/desktop-ui.css app/desktop-tight-nav.css
git commit -m "style: separate shell layout from visual primitives"
```

---

### Task 4: 고밀도 업무 화면을 공통 primitive로 정규화

**Files:**
- Modify: `app/calendar-ui.css`
- Modify: `app/task-layout.css`
- Modify: `app/google-tasks.css`
- Modify: `app/project-system-v3.css`
- Modify: `app/meeting-ui.css`
- Modify: `app/page-core.css`
- Modify: `app/page-builder.css`
- Modify: `app/page-editor-static.css`
- Test: existing calendar/task/project/page/meeting Playwright specs

**Interfaces:**
- Consumes: Task 2 primitive/token, Task 3 shell
- Produces: Calendar/Tasks/Projects/Meetings/Pages의 feature-only structural CSS

- [ ] **Step 1: 각 파일에서 raw color/radius/shadow 목록을 먼저 기록**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
files=['calendar-ui.css','task-layout.css','google-tasks.css','project-system-v3.css','meeting-ui.css','page-core.css','page-builder.css','page-editor-static.css']
for name in files:
    text=(Path('app')/name).read_text(encoding='utf-8')
    colors=sorted(set(re.findall(r'#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)',text)))
    radii=sorted(set(re.findall(r'border-radius\s*:\s*([^;}]+)',text)))
    shadows=sorted(set(re.findall(r'box-shadow\s*:\s*([^;}]+)',text)))
    print(name,'colors=',colors,'radii=',radii,'shadows=',shadows)
PY
```

- [ ] **Step 2: Project V3의 자체 card/badge/modal 값을 token으로 치환**

예:

```css
.ps3-project-card{background:var(--kptu-surface);border:1px solid var(--kptu-border);border-radius:var(--kptu-radius-lg);box-shadow:none}
.ps3-project-card:hover{border-color:var(--kptu-border-strong);box-shadow:none}
.ps3-kind,.ps3-type,.ps3-phase{border-radius:var(--kptu-radius-pill)}
.ps3-detail-card{border-radius:var(--kptu-radius-lg)}
.ps3-section{border:1px solid var(--kptu-border);border-radius:var(--kptu-radius-lg);background:var(--kptu-surface)}
.ps3-danger{color:var(--kptu-danger)!important}
.ps3-danger-btn{background:var(--kptu-danger)!important;border-color:var(--kptu-danger)!important}
```

Danger의 `!important`는 기존 selector 충돌이 제거된 뒤 가능하면 함께 제거함.

- [ ] **Step 3: Calendar/Tasks/Meetings/Pages의 generic button/card/badge/modal 재정의를 삭제하고 token 사용**

원칙:
- 구조적 grid/flex/overflow/date-cell 규칙은 feature CSS에 유지
- `background:#fff`, generic `border:1px solid ...`, generic `border-radius`, generic `box-shadow`는 공통 primitive와 의미가 겹치면 삭제
- semantic 상태색은 `var(--kptu-success|warning|danger|info[-soft])`로 치환

- [ ] **Step 4: 기능별 회귀 테스트 실행**

Run:

```bash
npx playwright test \
  tests/app-e2e/calendar-move.spec.mjs \
  tests/app-e2e/task-layout-groups.spec.mjs \
  tests/app-e2e/project-system-v3.spec.mjs \
  tests/app-e2e/project-v3-structure.spec.mjs \
  tests/app-e2e/meeting-entry.spec.mjs \
  tests/app-e2e/page-core-structure.spec.mjs \
  tests/app-e2e/page-builder.spec.mjs \
  tests/app-e2e/design-system.spec.mjs \
  --browser=chromium --workers=1 --reporter=line
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/calendar-ui.css app/task-layout.css app/google-tasks.css app/project-system-v3.css app/meeting-ui.css app/page-core.css app/page-builder.css app/page-editor-static.css
git commit -m "style: normalize core work screens to design tokens"
```

---

### Task 5: 사람·협업·홈 화면을 같은 시각언어로 정규화

**Files:**
- Modify: `app/team.css`
- Modify: `app/team-member-overview.css`
- Modify: `app/team-profile-view.css`
- Modify: `app/team-member-management.css`
- Modify: `app/profile-settings.css`
- Modify: `app/workplace-detail.css`
- Modify: `app/suborganizations.css`
- Modify: `app/suborganization-filters.css`
- Modify: `app/access-approval.css`
- Modify: `app/collaboration-center.css`
- Modify: `app/notification-center-ui.css`
- Modify: `app/home-task.css`
- Modify: `app/photo-room.css`
- Modify: `app/public-workspace.css`
- Modify: `app/topbar-actions.css`
- Modify: `app/workspace-ui.css`

**Interfaces:**
- Consumes: Task 2 token/primitive
- Produces: Team/Profile/Suborganizations/Collaboration/Home의 공통 visual language

- [ ] **Step 1: `workspace-ui.css`에 남은 collaboration feature rule을 소유 CSS로 이동**

아래 selector는 `collaboration-center.css`로 이동하고 token을 사용함.

```css
.cc-messages-layout
.cc-peer-list
.cc-peer
.cc-chat
```

`workspace-ui.css`에는 mobile dock과 safe-area만 남김.

- [ ] **Step 2: 사람/조직 card와 action을 common primitive에 맞춤**

`team*`, `profile-settings`, `workplace-detail`, `suborganizations*`에서 generic surface/border/radius/shadow를 자체 선언하지 않고 다음 token을 사용함.

```css
background:var(--kptu-surface);
border-color:var(--kptu-border);
border-radius:var(--kptu-radius-lg);
color:var(--kptu-ink);
```

- [ ] **Step 3: collaboration/notification/home의 상태색과 compact action을 token으로 정규화**

기존 blue/green/red/amber raw value를 semantic token으로 치환하고, clickable compact action은 `.mini`, `.secondary`, `.ghost` 공통 규격을 따르게 함.

- [ ] **Step 4: 관련 회귀 테스트 실행**

Run:

```bash
npx playwright test \
  tests/app-e2e/profile-workplaces.spec.mjs \
  tests/app-e2e/home-dashboard-v2.spec.mjs \
  tests/app-e2e/security-org-affiliations.spec.mjs \
  tests/app-e2e/photo-room.spec.mjs \
  tests/app-e2e/ui-system.spec.mjs \
  tests/app-e2e/design-system.spec.mjs \
  --browser=chromium --workers=1 --reporter=line
```

Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add app/team.css app/team-member-overview.css app/team-profile-view.css app/team-member-management.css app/profile-settings.css app/workplace-detail.css app/suborganizations.css app/suborganization-filters.css app/access-approval.css app/collaboration-center.css app/notification-center-ui.css app/home-task.css app/photo-room.css app/public-workspace.css app/topbar-actions.css app/workspace-ui.css
git commit -m "style: align collaboration and people screens with design system"
```

---

### Task 6: 정적 invariant와 cache chain을 고정

**Files:**
- Modify: `.github/workflows/app-smoke-check.yml`
- Modify: `app/styles.css`
- Modify: `app/index.html`
- Test: `tests/app-e2e/design-system.spec.mjs`

**Interfaces:**
- Consumes: Tasks 2~5에서 정리된 CSS
- Produces: 신규 CSS가 다시 임의 primitive를 만들지 못하게 하는 CI gate와 최종 배포 cache version

- [ ] **Step 1: smoke에 Design System token 존재 검사를 추가**

```bash
for token in \
  --kptu-bg --kptu-surface --kptu-ink --kptu-muted --kptu-border \
  --kptu-primary --kptu-success --kptu-warning --kptu-danger --kptu-info \
  --kptu-space-1 --kptu-space-2 --kptu-space-3 --kptu-space-4 --kptu-space-5 --kptu-space-6 \
  --kptu-radius-sm --kptu-radius-md --kptu-radius-lg \
  --kptu-control-height --kptu-action-compact-height; do
  grep -q -- "$token" app/base-ui.css || { echo "missing design token: $token"; exit 1; }
done
```

- [ ] **Step 2: feature CSS의 금지된 공통 primitive 재정의를 정적 검사**

Python 검사에서 `base-ui.css`, `workspace-ui.css`, `desktop-ui.css`를 제외한 feature CSS를 대상으로 다음을 실패 처리함.

- `.primary`, `.secondary`, `.ghost`, `.badge`, `.modal-card`, `.toast` selector 자체 재정의
- 신규 `box-shadow:` raw value. `var(--kptu-shadow-*)`만 허용
- `border-radius:` raw px value. `var(--kptu-radius-*)` 또는 `999px`만 허용

검사 예:

```python
from pathlib import Path
import re,sys
exclude={'base-ui.css','workspace-ui.css','desktop-ui.css','desktop-tight-nav.css','static-gates.css'}
errors=[]
for path in Path('app').glob('*.css'):
    if path.name in exclude: continue
    text=path.read_text(encoding='utf-8')
    if re.search(r'(^|[},])\s*\.(primary|secondary|ghost|badge|modal-card|toast)(?:\b|[,:.#\[])',text):
        errors.append(f'{path}: common primitive selector redefined')
    for value in re.findall(r'border-radius\s*:\s*([^;}]+)',text):
        if 'var(--kptu-radius-' not in value and value.strip()!='999px':
            errors.append(f'{path}: raw radius {value.strip()}')
    for value in re.findall(r'box-shadow\s*:\s*([^;}]+)',text):
        if value.strip()!='none' and 'var(--kptu-shadow-' not in value:
            errors.append(f'{path}: raw shadow {value.strip()}')
if errors:
    print('\n'.join(errors)); sys.exit(1)
```

기존 기능상 남겨야 하는 예외가 발견되면 selector-level allowlist를 명시적으로 코드에 추가하고 사유를 주석으로 남김. 파일 전체를 제외하지 않음.

- [ ] **Step 3: `styles.css` import version을 변경된 파일별로 올림**

최소 다음을 bump함.

```css
@import url('./base-ui.css?v=2');
@import url('./workspace-ui.css?v=7');
@import url('./desktop-ui.css?v=4');
@import url('./project-system-v3.css?v=2');
```

그 외 실제 수정된 feature CSS도 각각 `v=2` 또는 현재값+1로 올림.

- [ ] **Step 4: `index.html`의 styles cache version을 `styles.css?v=13`으로 올림**

```html
<link rel="stylesheet" href="./styles.css?v=13">
```

- [ ] **Step 5: smoke의 hard-coded CSS version 계약을 새 값으로 함께 갱신**

기존 `grep -q "...css?v=..." app/styles.css` 검사를 제거하지 않고 새 버전으로 정확히 변경함.

- [ ] **Step 6: 전체 App browser E2E와 smoke를 실행**

Run:

```bash
npx playwright test \
  tests/app-e2e/app-initial-paint.spec.mjs \
  tests/app-e2e/calendar-move.spec.mjs \
  tests/app-e2e/profile-workplaces.spec.mjs \
  tests/app-e2e/page-builder.spec.mjs \
  tests/app-e2e/page-core-structure.spec.mjs \
  tests/app-e2e/project-system-v3.spec.mjs \
  tests/app-e2e/project-v3-structure.spec.mjs \
  tests/app-e2e/mobile-ux-shell.spec.mjs \
  tests/app-e2e/swipe-nav-follow.spec.mjs \
  tests/app-e2e/google-tasks-push.spec.mjs \
  tests/app-e2e/access-request-push.spec.mjs \
  tests/app-e2e/task-layout-groups.spec.mjs \
  tests/app-e2e/workflow-ai-model.spec.mjs \
  tests/app-e2e/meeting-entry.spec.mjs \
  tests/app-e2e/desktop-layout.spec.mjs \
  tests/app-e2e/home-dashboard-v2.spec.mjs \
  tests/app-e2e/security-org-affiliations.spec.mjs \
  tests/app-e2e/ui-system.spec.mjs \
  tests/app-e2e/design-system.spec.mjs \
  tests/app-e2e/photo-room.spec.mjs \
  --grep-invert "long-running project operating model" \
  --browser=chromium --workers=1 --reporter=line
```

그리고 `.github/workflows/app-smoke-check.yml`의 shell/Python 검사 블록을 로컬에서 같은 내용으로 실행하거나 PR CI에서 반드시 green을 확인함.

- [ ] **Step 7: 커밋**

```bash
git add .github/workflows/app-smoke-check.yml .github/workflows/app-e2e-check.yml app/styles.css app/index.html tests/app-e2e/design-system.spec.mjs tests/app-e2e/ui-system.spec.mjs
git commit -m "ci: enforce Design System 1.0 contracts"
```

---

### Task 7: PR 검증 및 Task 6 완료 판정

**Files:**
- Review only: all changed files
- Review: `docs/superpowers/specs/2026-09-17-web2-design-system-1-design.md`
- Review: `docs/superpowers/plans/2026-09-17-web2-design-system-1.md`

**Interfaces:**
- Consumes: Tasks 1~6 결과
- Produces: Task 6 완료 상태와 main squash merge

- [ ] **Step 1: main과 branch diff를 검토해 JS/DOM 기능 변경이 섞이지 않았는지 확인**

```bash
git diff --name-only main...HEAD
```

허용 파일은 CSS, Design System tests/workflows, cache reference, spec/plan 문서임. JS 기능 변경이 있으면 분리하거나 되돌림.

- [ ] **Step 2: PR을 draft로 생성**

제목:

```text
Establish Web2 Design System 1.0
```

본문에는 token/primitive/shell/feature normalization, breakpoint 통일, `!important` 축소, 새 design-system E2E와 static gate를 요약함.

- [ ] **Step 3: 최신 PR head의 관련 CI가 모두 green인지 확인**

필수 확인:
- App smoke check
- App browser E2E check
- Router ready E2E
- Runtime recovery E2E
- Browser storage audit
- Public workspace auth E2E
- Page management E2E
- Profile single-render check
- Suborganization filters E2E
- Task visibility observer check
- Collaboration ownership check
- Workplace detail static UI check

- [ ] **Step 4: 실패가 있으면 해당 기능 단위만 수정하고 동일 head에서 재검증**

기존 회귀검사를 약화하거나 삭제해서 green으로 만들지 않음.

- [ ] **Step 5: all-green head SHA를 고정해 ready-for-review 후 squash merge**

merge 시 expected head SHA를 사용함.

- [ ] **Step 6: main이 merge commit을 가리키는지 확인하고 Task 6 완료로 기록**

Task 7 UX/accessibility 작업은 별도 브랜치에서 시작하며, 이 PR에 정보 구조 변경을 추가하지 않음.

## Self-Review

- Spec coverage: token, primitive, CSS ownership, breakpoint, `!important` policy, feature normalization, compatibility, CI invariant, cache chain, 390/1024/1440 검증을 Tasks 1~7이 모두 포함함.
- Placeholder scan: 구현 단계에 TBD/TODO/미정 항목 없음.
- Interface consistency: 모든 feature task는 Task 2의 `--kptu-*` token과 common primitive를 소비하며, shell은 Task 3에서 분리됨.
- Scope check: API/JS 기능·정보 architecture·Task 7 접근성/UX는 명시적으로 제외되어 Task 6 범위를 벗어나지 않음.
