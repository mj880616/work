# Web2 Task 7 UX·접근성·반응형 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Design System 1.0을 유지하면서 Web2 전 화면에 일관된 keyboard/focus/dialog/status 계약과 360/768/1024/1440 반응형 품질을 적용함.

**Architecture:** 기존 router와 feature canonical owner는 유지함. 새 `app/accessibility-dialog.js`는 modal visibility를 소유하지 않고 focus trap, Escape 요청, trigger focus 복귀만 제공하며, 각 기존 owner가 명시적으로 activate/deactivate를 호출함. 화면별 정보 위계와 overflow 수정은 기존 HTML/JS/CSS 소유 파일 안에서 처리하고 API·Supabase·권한·세션 구조는 변경하지 않음.

**Tech Stack:** GitHub Pages, vanilla JavaScript/CSS, Playwright 1.55 Chromium, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-17-web2-ux-accessibility-design.md`

## Global Constraints

- Task 6 Design System 1.0 token/primitive 계약을 유지함.
- `app-router.js`가 view 전환과 active navigation을 단독 소유함.
- feature owner가 modal open/close와 저장 상태를 계속 소유함.
- `accessibility-dialog.js`는 `hidden` class 또는 `aria-hidden` 값을 직접 변경하지 않음.
- MutationObserver, setTimeout, runtime style injection으로 접근성/레이아웃을 후행 보정하지 않음.
- API, Supabase schema, authorization, RLS, session/runtime 데이터 흐름을 변경하지 않음.
- 현재 활성 nav는 `aria-current="page"`, 비활성 nav는 `aria-current` 속성이 없어야 함.
- production modal은 `role="dialog"`, `aria-modal="true"`, 유효한 `aria-labelledby`를 가져야 함.
- icon-only button은 `aria-label`을 가져야 함.
- 저장 진행은 `disabled` + `aria-busy="true"`, 일반 상태는 `role="status"`/`aria-live="polite"`, 오류는 `role="alert"` 의미를 사용함.
- canonical QA viewport는 360×800, 768×1024, 1024×768, 1440×900임.
- document-level horizontal overflow, mobile dock/fixed footer에 가려지는 핵심 control, modal footer clipping을 허용하지 않음.
- 관련 E2E와 구조검사가 green이 되기 전 main에 병합하지 않음.

---

### Task 1: 접근성 계약을 실패하는 E2E로 먼저 고정

**Files:**
- Create: `tests/app-e2e/accessibility-ux.spec.mjs`
- Modify: `.github/workflows/app-e2e-check.yml`
- Test: `tests/app-e2e/ui-system.spec.mjs`

**Interfaces:**
- Consumes: 기존 Supabase mock/login pattern, `#appView`, `.app-nav`, static modal IDs
- Produces: nav current-state, dialog semantics, icon accessible name, focus return, viewport overflow 회귀계약

- [ ] **Step 1: `accessibility-ux.spec.mjs`에 공용 mock/sign-in helper를 작성함**

`ui-system.spec.mjs`의 mock pattern을 복사하되 user/workspace/tasks/events/spaces/documents/meetings/pages는 최소 fixture만 제공함. 로그인 완료 조건은 `#appView` visible + `.kptu-ui-ready` class로 둠.

```js
async function signIn(page){
  await page.goto(loginEntry(page.url()));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}
```

- [ ] **Step 2: nav current-state 실패 테스트를 추가함**

```js
test('active navigation exposes aria-current',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('.app-nav [data-view="tasks"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.app-nav [data-view="home"]')).not.toHaveAttribute('aria-current');
});
```

Expected before implementation: FAIL because router currently toggles `.active` only.

- [ ] **Step 3: dialog semantics/focus/escape/restore 실패 테스트를 추가함**

```js
test('task dialog traps focus, closes on Escape, and restores trigger focus',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('[data-view="tasks"]').click();
  const trigger=page.locator('#newTaskBtn');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#taskModal');
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  const labelledby=await modal.getAttribute('aria-labelledby');
  expect(labelledby).toBeTruthy();
  await expect(page.locator('#'+labelledby)).toBeVisible();
  await expect(page.locator('#taskTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});
```

- [ ] **Step 4: icon accessible name 실패 테스트를 추가함**

```js
test('symbol-only controls have accessible names',async({page})=>{
  await boot(page,{width:1024,height:768});
  await expect(page.locator('#prevMonthBtn')).toHaveAttribute('aria-label','이전 달');
  await expect(page.locator('#nextMonthBtn')).toHaveAttribute('aria-label','다음 달');
  await expect(page.locator('#taskModal [data-close="taskModal"]')).toHaveAttribute('aria-label','닫기');
});
```

- [ ] **Step 5: 4개 viewport에서 document overflow 실패 테스트를 추가함**

```js
for(const viewport of [
  {width:360,height:800},
  {width:768,height:1024},
  {width:1024,height:768},
  {width:1440,height:900}
]){
  test(`core views do not overflow at ${viewport.width}`,async({page})=>{
    await boot(page,viewport);
    for(const view of ['home','calendar','tasks','projects','library','meetings','pages','team']){
      await page.locator(`[data-view="${view}"]`).first().click();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,view).toBeLessThanOrEqual(1);
    }
  });
}
```

- [ ] **Step 6: 새 테스트를 workflow 실행 목록에 포함하고 PR CI에서 실패를 확인함**

`.github/workflows/app-e2e-check.yml`에서 `design-system.spec.mjs` 다음에 `tests/app-e2e/accessibility-ux.spec.mjs`를 추가함.

Expected: nav/dialog/icon 관련 신규 검사가 실패하고 기존 기능 검사는 유지됨.

- [ ] **Step 7: 커밋**

```bash
git add tests/app-e2e/accessibility-ux.spec.mjs .github/workflows/app-e2e-check.yml
git commit -m "test: define Task 7 accessibility UX contracts"
```

---

### Task 2: 공통 dialog focus helper와 navigation semantics 구현

**Files:**
- Create: `app/accessibility-dialog.js`
- Modify: `app/loader-v2.js`
- Modify: `app/app-router.js`
- Modify: `app/index.html`
- Modify: `app/base-ui.css`
- Test: `tests/app-e2e/accessibility-ux.spec.mjs`

**Interfaces:**
- Produces: `window.KPTUA11y.dialog.activate(modal, options)`
- Produces: `window.KPTUA11y.dialog.deactivate(modal, options)`
- `activate` options: `{trigger?:Element, initialFocus?:Element|string|null, onRequestClose?:()=>void}`
- `deactivate` options: `{restoreFocus?:boolean, fallbackFocus?:Element|string|null}`
- Consumes: existing owner-controlled modal visibility and `aria-hidden`

- [ ] **Step 1: helper unit behavior를 브라우저 E2E에 먼저 추가함**

Tab 순환 검사:

```js
await page.locator('#newTaskBtn').click();
const modal=page.locator('#taskModal');
const first=page.locator('#taskTitle');
const last=modal.locator('[data-close="taskModal"]');
await first.focus();
await page.keyboard.press('Shift+Tab');
await expect(last).toBeFocused();
await page.keyboard.press('Tab');
await expect(first).toBeFocused();
```

- [ ] **Step 2: `accessibility-dialog.js`를 최소 구현함**

```js
(()=>{
  if(window.KPTUA11y?.dialog)return;
  const state=new WeakMap();
  let active=null;
  const focusable='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const resolve=(modal,value)=>typeof value==='string'?modal.querySelector(value):value;
  const items=modal=>[...modal.querySelectorAll(focusable)].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);
  function activate(modal,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){
    if(!modal)return;
    state.set(modal,{trigger,onRequestClose});
    active=modal;
    const target=resolve(modal,initialFocus)||items(modal)[0]||modal;
    if(target===modal&&!modal.hasAttribute('tabindex'))modal.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
  }
  function deactivate(modal,{restoreFocus=true,fallbackFocus=null}={}){
    const saved=state.get(modal);
    state.delete(modal);
    if(active===modal)active=null;
    if(!restoreFocus)return;
    const target=saved?.trigger?.isConnected?saved.trigger:(typeof fallbackFocus==='string'?document.querySelector(fallbackFocus):fallbackFocus);
    target?.focus?.({preventScroll:true});
  }
  document.addEventListener('keydown',e=>{
    if(!active||active.classList.contains('hidden'))return;
    if(e.key==='Escape'){
      const fn=state.get(active)?.onRequestClose;
      if(fn){e.preventDefault();fn()}
      return;
    }
    if(e.key!=='Tab')return;
    const list=items(active);if(!list.length){e.preventDefault();active.focus();return}
    const first=list[0],last=list[list.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });
  window.KPTUA11y={...(window.KPTUA11y||{}),dialog:{activate,deactivate}};
})();
```

Helper는 `.hidden` 또는 `aria-hidden`을 변경하지 않음.

- [ ] **Step 3: loader에서 team보다 먼저 helper를 import함**

`app-router.js` 이후, `team.js` 이전에:

```js
await import('./accessibility-dialog.js?v=1');
```

- [ ] **Step 4: router가 nav `aria-current`를 단독 동기화함**

`go()`의 active toggle을 다음 의미로 확장함.

```js
document.querySelectorAll('.app-nav .nav-btn').forEach(btn=>{
  const current=btn.dataset.view===view;
  btn.classList.toggle('active',current);
  if(current)btn.setAttribute('aria-current','page');
  else btn.removeAttribute('aria-current');
});
document.querySelectorAll('#ccMobileDock [data-cc-view]').forEach(btn=>{
  const current=btn.dataset.ccView===view;
  btn.classList.toggle('active',current);
  if(current)btn.setAttribute('aria-current','page');
  else btn.removeAttribute('aria-current');
});
```

- [ ] **Step 5: static modal semantics와 icon labels를 `index.html`에 적용함**

각 static modal에 고유 heading id를 부여함. 예:

```html
<div id="taskModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="taskModalTitle">
  <div class="modal-card small-card">
    <div class="modal-head"><div><div class="eyebrow">TASK</div><h2 id="taskModalTitle">할 일 추가</h2></div>
    <button class="icon-btn" data-close="taskModal" type="button" aria-label="닫기">×</button></div>
```

`#prevMonthBtn`에는 `aria-label="이전 달"`, `#nextMonthBtn`에는 `aria-label="다음 달"`을 설정함.

- [ ] **Step 6: 공통 focus indicator를 링크/nav까지 확장함**

`base-ui.css`에서 기존 button/input focus rule을 다음 selector family까지 확장함.

```css
a:focus-visible,.nav-btn:focus-visible,[role="button"]:focus-visible{
  outline:2px solid var(--kptu-info);
  outline-offset:2px;
}
.modal-card:focus{outline:none}
```

- [ ] **Step 7: Task 2 테스트를 실행해 nav/icon/static dialog semantics가 PASS인지 확인함**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs --browser=chromium --workers=1 --reporter=line
```

Focus restore는 owner wiring 전까지 해당 assertion이 계속 FAIL해도 됨. nav/icon/static semantics는 PASS해야 함.

- [ ] **Step 8: 커밋**

```bash
git add app/accessibility-dialog.js app/loader-v2.js app/app-router.js app/index.html app/base-ui.css
git commit -m "feat: add shared dialog accessibility foundation"
```

---

### Task 3: Team core modal과 저장 상태를 helper에 연결

**Files:**
- Modify: `app/team.js`
- Modify: `app/index.html`
- Test: `tests/app-e2e/accessibility-ux.spec.mjs`
- Test: existing calendar/task/library/meeting/page flows

**Interfaces:**
- Consumes: `KPTUA11y.dialog.activate/deactivate`
- Produces: `openModal(id,{trigger,initialFocus,onRequestClose})`, `closeModal(id,{restoreFocus})`

- [ ] **Step 1: static core modal focus restore 실패 검사를 event/task/document/meeting/page/invite/group에 추가함**

대표 task 외에 각 trigger → close button click → trigger focus 복귀를 최소 1회씩 확인함.

- [ ] **Step 2: `team.js`의 `openModal/closeModal` signature를 확장함**

```js
function openModal(id,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){
  const m=$('#'+id);if(!m)return;
  m.classList.remove('hidden');
  m.setAttribute('aria-hidden','false');
  const close=onRequestClose||(()=>closeModal(id));
  window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus,onRequestClose:close});
}
function closeModal(id,{restoreFocus=true}={}){
  const m=$('#'+id);if(!m)return;
  m.classList.add('hidden');
  m.setAttribute('aria-hidden','true');
  window.KPTUA11y?.dialog.deactivate(m,{restoreFocus,fallbackFocus:'#appView .view-panel:not(.hidden) h2'});
}
```

- [ ] **Step 3: core modal openers에 첫 focus target을 명시함**

```js
openModal('eventModal',{initialFocus:'#eventTitle'});
openModal('taskModal',{initialFocus:'#taskTitle'});
openModal('documentModal',{initialFocus:'#docTitle'});
openModal('meetingModal',{initialFocus:'#meetingTitle'});
openModal('editorModal',{initialFocus:'#pageTitle'});
```

Invite/group도 첫 input으로 지정함.

- [ ] **Step 4: 상태 helper가 semantic role을 동기화하도록 확장함**

기존 `setStatus`를 다음처럼 바꿈.

```js
function setStatus(el,msg,type=''){
  if(!el)return;
  el.textContent=msg||'';
  el.className='status'+(type?' '+type:'');
  if(type==='error'){
    el.setAttribute('role','alert');
    el.removeAttribute('aria-live');
  }else{
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
  }
}
```

- [ ] **Step 5: save button busy helper를 추가하고 core saves에 적용함**

```js
function setBusy(button,busy){
  if(!button)return;
  button.disabled=!!busy;
  if(busy)button.setAttribute('aria-busy','true');
  else button.removeAttribute('aria-busy');
}
```

`saveEvent/saveTask/saveDocument/saveMeeting/savePage/createInvite/saveGroup`에서 `try/finally`로 해당 primary action busy를 복구함. API payload/권한 로직은 수정하지 않음.

- [ ] **Step 6: save/busy E2E를 추가함**

API 응답을 지연시켜 저장 버튼이 disabled + aria-busy인 것을 확인하고, 성공/실패 후 모두 해제되는지 검증함.

- [ ] **Step 7: core 기능 회귀와 접근성 E2E를 실행함**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs tests/app-e2e/workspace.spec.mjs tests/app-e2e/meeting-entry.spec.mjs tests/app-e2e/page-core-structure.spec.mjs --browser=chromium --workers=1 --reporter=line
```

Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add app/team.js app/index.html tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: wire core dialogs and busy states to accessibility contracts"
```

---

### Task 4: 고빈도 Home·Calendar·Tasks 정보 위계와 keyboard UX 정리

**Files:**
- Modify: `app/home-task.css`
- Modify: `app/calendar-ui.css`
- Modify: `app/task-layout.js`
- Modify: `app/task-layout.css`
- Modify: `app/index.html`
- Test: `tests/app-e2e/accessibility-ux.spec.mjs`
- Test: `tests/app-e2e/ui-system.spec.mjs`

**Interfaces:**
- Consumes: Design System tokens, router current-state, dialog helper
- Produces: labelled filters, 360px-safe section headers/toolbars, keyboard-safe task action order

- [ ] **Step 1: Tasks filter labels가 없는 현재 상태를 실패 테스트로 고정함**

```js
await page.locator('[data-view="tasks"]').click();
await expect(page.locator('label[for="taskScope"]')).toHaveCount(1);
await expect(page.locator('label[for="taskStatus"]')).toHaveCount(1);
```

Library/Pages search/filter labels는 Task 5에서 별도 적용함.

- [ ] **Step 2: Tasks toolbar에 visible 또는 visually-hidden label을 추가함**

`index.html`:

```html
<div class="toolbar filter-toolbar">
  <label class="sr-only" for="taskScope">할 일 범위</label>
  <select id="taskScope">...</select>
  <label class="sr-only" for="taskStatus">할 일 상태</label>
  <select id="taskStatus">...</select>
</div>
```

`base-ui.css`에 공통 `.sr-only`를 추가함.

- [ ] **Step 3: Home stat cards의 이름을 숫자와 함께 읽을 수 있는지 검사하고 불필요한 중복 metadata를 CSS로 축소함**

button 내부 visible text는 유지하고 별도 중복 `aria-label`은 추가하지 않음. `home-task.css`에서는 360px에서 card text/button이 잘리지 않도록 min-width와 overflow를 점검함.

- [ ] **Step 4: Calendar month toolbar에 group semantics를 부여함**

```html
<div class="calendar-toolbar" role="group" aria-labelledby="monthTitle">...</div>
```

`monthTitle`은 text가 갱신되므로 별도 duplicate label을 만들지 않음.

- [ ] **Step 5: task rows의 keyboard reading/action 순서를 유지하고 destructive action accessible name을 대상 포함 형태로 생성함**

`task-layout.js`에서 삭제 버튼을 예를 들어 다음처럼 생성함.

```js
<button class="mini tl-delete" data-tl-delete="${esc(t.id)}" type="button" aria-label="${esc(t.title||'제목 없음')} 삭제">삭제</button>
```

완료/수정은 visible text가 명확하므로 중복 aria-label을 추가하지 않음.

- [ ] **Step 6: 360×800에서 Home/Calendar/Tasks overflow와 primary action 가시성을 검사함**

각 화면 진입 후 `#newEventBtn`, `#newTaskBtn` bounding box가 viewport 안에 있고 document horizontal overflow가 1px 이하인지 검증함.

- [ ] **Step 7: 관련 E2E 실행**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs tests/app-e2e/ui-system.spec.mjs tests/app-e2e/calendar-move.spec.mjs tests/app-e2e/task-layout-groups.spec.mjs --browser=chromium --workers=1 --reporter=line
```

- [ ] **Step 8: 커밋**

```bash
git add app/index.html app/base-ui.css app/home-task.css app/calendar-ui.css app/task-layout.js app/task-layout.css tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: improve high-frequency workspace UX"
```

---

### Task 5: Projects·Library·Meetings·Pages의 labels/dialog/status 정리

**Files:**
- Modify: `app/project-system-v3.js`
- Modify: `app/project-system-v3.css`
- Modify: `app/library-upload.js`
- Modify: `app/meeting-round-detail.js`
- Modify: `app/page-save-controller.js`
- Modify: `app/page-builder.js`
- Modify: `app/index.html`
- Test: feature-specific E2E + `accessibility-ux.spec.mjs`

**Interfaces:**
- Consumes: `KPTUA11y.dialog.activate/deactivate`, Design System state primitives
- Produces: feature-owned dynamic modal focus contract, labelled search/filter, busy/error semantics

- [ ] **Step 1: Library/Pages filter label 실패 테스트를 추가함**

```js
await page.locator('[data-view="library"]').click();
await expect(page.locator('label[for="documentSearch"]')).toHaveCount(1);
await expect(page.locator('label[for="documentProject"]')).toHaveCount(1);
await page.locator('[data-view="pages"]').click();
await expect(page.locator('label[for="pageSearch"]')).toHaveCount(1);
await expect(page.locator('label[for="pageFilter"]')).toHaveCount(1);
```

- [ ] **Step 2: `index.html`의 Library/Pages toolbar에 `.sr-only` label을 추가함**

검색 placeholder는 유지하되 label을 semantic source로 사용함.

- [ ] **Step 3: `project-system-v3.js`의 detail/create modal open/close 지점을 helper에 연결함**

각 기존 `classList.remove('hidden')` 직후:

```js
window.KPTUA11y?.dialog.activate(modal,{
  trigger:document.activeElement,
  initialFocus:modal.querySelector('input,button,select,textarea'),
  onRequestClose:()=>existingCloseFunction()
});
```

기존 close 함수에서 visibility 변경 후 `dialog.deactivate(modal)`을 호출함. 새로운 close owner를 만들지 않음.

- [ ] **Step 4: meeting detail/profile-style dynamic overlays도 동일 패턴으로 연결함**

`meeting-round-detail.js`가 modal/overlay를 생성하는 경우 생성 markup에 `role="dialog"`, `aria-modal="true"`, unique heading id + `aria-labelledby`를 함께 생성함. 닫기 button에 `aria-label="닫기"`를 부여함.

- [ ] **Step 5: Library upload와 Page save의 기존 saving flag를 semantic busy 상태와 연결함**

기존 중복제출/partial failure 로직을 유지하면서 버튼에만 다음 의미를 추가함.

```js
button.disabled=true;
button.setAttribute('aria-busy','true');
// finally
button.disabled=false;
button.removeAttribute('aria-busy');
```

오류 text container는 `role="alert"`, 성공/보조 상태는 `role="status"`로 동기화함. API 호출 방식은 변경하지 않음.

- [ ] **Step 6: Project child menu keyboard 검사를 추가함**

summary/button 기반 기존 구조에서 Enter/Space로 열리고 panel 내부 첫 actionable control로 Tab 이동이 가능한지 검증함. 강제 focus 이동은 하지 않음.

- [ ] **Step 7: feature 회귀 E2E 실행**

```bash
npx playwright test \
  tests/app-e2e/accessibility-ux.spec.mjs \
  tests/app-e2e/project-system-v3.spec.mjs \
  tests/app-e2e/project-v3-structure.spec.mjs \
  tests/app-e2e/library-upload-failure.spec.mjs \
  tests/app-e2e/meeting-entry.spec.mjs \
  tests/app-e2e/page-builder.spec.mjs \
  tests/app-e2e/page-core-structure.spec.mjs \
  tests/app-e2e/runtime-recovery.spec.mjs \
  --browser=chromium --workers=1 --reporter=line
```

- [ ] **Step 8: 커밋**

```bash
git add app/project-system-v3.js app/project-system-v3.css app/library-upload.js app/meeting-round-detail.js app/page-save-controller.js app/page-builder.js app/index.html tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: align project and content flows with accessibility contracts"
```

---

### Task 6: Team·Profile·Suborganizations와 상태/관리 action 접근성 정리

**Files:**
- Modify: `app/team-member-overview.js`
- Modify: `app/team-member-management.js`
- Modify: `app/team-profile-view.js`
- Modify: `app/profile-settings.js`
- Modify: `app/suborganizations.js`
- Modify: `app/suborganization-filters.js`
- Modify: corresponding CSS only where overflow/focus clipping is found
- Test: profile/team/suborganization E2E

**Interfaces:**
- Consumes: dialog helper, router/nav semantics, `.sr-only`, Design System focus/state rules
- Produces: management/view action semantic distinction and focus-safe profile/org overlays

- [ ] **Step 1: hidden admin-only controls가 keyboard focus 대상이 아닌지 E2E를 추가함**

viewer fixture로 로그인해 `#inviteBtn`, `#newGroupBtn`가 `.hidden`이며 Tab sequence에서 focus되지 않는지 검증함.

- [ ] **Step 2: profile/team modal markup에 dialog contract를 적용함**

동적 markup은 unique heading id를 생성해 `aria-labelledby`에 연결함. 기존 routed profile view라면 dialog role을 붙이지 않고 heading landmark만 정리함.

- [ ] **Step 3: destructive 관리 action accessible name에 대상명을 포함함**

예: 산하조직 삭제 button visible text가 단순 `삭제`라면 `aria-label="${조직명} 삭제"`를 추가함. 권한 판단/hidden 로직은 변경하지 않음.

- [ ] **Step 4: suborganization filter inputs에 programmatic labels를 보장함**

visible label이 있으면 `for/id`를 연결하고, UI상 label을 추가하기 부적절한 search/filter만 `.sr-only` label을 사용함.

- [ ] **Step 5: profile save/error states에 busy/status semantic을 연결함**

기존 저장 함수와 API는 그대로 두고 submit/button와 status element 속성만 동기화함.

- [ ] **Step 6: 관련 회귀 E2E 실행**

```bash
npx playwright test \
  tests/app-e2e/accessibility-ux.spec.mjs \
  tests/app-e2e/profile-workplaces.spec.mjs \
  tests/app-e2e/security-org-affiliations.spec.mjs \
  tests/app-e2e/suborganization-filters.spec.mjs \
  --browser=chromium --workers=1 --reporter=line
```

실제 repository test filename이 `suborganization-filters.spec.mjs`와 다르면 workflow에서 실행 중인 기존 정확한 파일명을 사용하고 plan 문서도 같은 커밋에서 그 이름으로 수정함. 새 테스트를 임의로 복제하지 않음.

- [ ] **Step 7: 커밋**

```bash
git add app/team-member-overview.js app/team-member-management.js app/team-profile-view.js app/profile-settings.js app/suborganizations.js app/suborganization-filters.js tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: improve people and organization accessibility"
```

---

### Task 7: 4-viewport responsive gate, cache chain, 전체 회귀검증과 PR

**Files:**
- Modify: `tests/app-e2e/accessibility-ux.spec.mjs`
- Modify: `tests/app-e2e/ui-system.spec.mjs`
- Modify: `tests/app-e2e/mobile-ux-shell.spec.mjs`
- Modify: `tests/app-e2e/desktop-layout.spec.mjs`
- Modify: `.github/workflows/app-smoke-check.yml` if static accessibility invariants are stable
- Modify: `app/styles.css` for changed CSS cache versions
- Modify: `app/loader-v2.js` for changed JS cache versions
- Modify: `app/app.js` / `app/index.html` only if upstream cache reference must bump

**Interfaces:**
- Consumes: Tasks 1–6 complete UI/accessibility contracts
- Produces: Task 7 production regression gate and exact all-green PR head

- [ ] **Step 1: 4-viewport 전 화면 helper를 완성함**

```js
async function assertNoDocumentOverflow(page,view){
  await page.locator(`[data-view="${view}"]`).first().click();
  const result=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,
    client:document.documentElement.clientWidth
  }));
  expect(result.scroll-result.client,view).toBeLessThanOrEqual(1);
}
```

Home/Calendar/Tasks/Projects/Library/Meetings/Pages/Team/Profile 계열 진입 가능한 view를 360/768/1024/1440에서 검사함.

- [ ] **Step 2: modal clipping 검사를 360/768에 추가함**

Task modal을 열고 `.modal-card`의 top/bottom이 viewport 또는 내부 scroll contract를 만족하는지 확인함. footer/저장 button은 `scrollIntoView()` 후 mobile dock 위에 표시돼야 함.

- [ ] **Step 3: keyboard-only smoke flow를 추가함**

Tasks view에서 Tab으로 primary action에 도달 → Enter로 modal open → Tab 순환 → Escape close → trigger focus 복귀를 mouse click 없이 수행함.

- [ ] **Step 4: stable static invariant만 smoke에 추가함**

`app/accessibility-dialog.js`에 MutationObserver/setTimeout이 없고 loader가 helper를 정확히 한 번 import하는지 검사함.

```bash
grep -q "accessibility-dialog.js?v=1" app/loader-v2.js
! grep -q "MutationObserver\|setTimeout" app/accessibility-dialog.js
```

HTML 전체에 aria 속성이 있다고 단순 grep하는 취약한 검사는 추가하지 않음. semantic behavior는 Playwright가 담당함.

- [ ] **Step 5: 모든 수정 CSS/JS cache version을 실제 변경 파일 기준으로 bump함**

`styles.css` import version, `loader-v2.js` feature import version, 상위 `app.js`/`index.html` reference를 현재 repository cache chain 규칙과 맞춤. smoke의 hard-coded version 계약도 정확한 새 값으로 함께 갱신함.

- [ ] **Step 6: 전체 App browser E2E를 실행함**

PR CI의 `App browser E2E check` 전체가 green이어야 함. 신규 접근성 테스트를 빼거나 assertion을 약화해 green으로 만들지 않음.

- [ ] **Step 7: 관련 구조/security/runtime CI를 확인함**

최소:
- App smoke check
- App browser E2E check
- Router ready E2E
- Page management E2E
- Runtime recovery E2E if touched path triggers it
- Browser storage audit
- Public workspace auth E2E
- Profile single-render check
- Suborganization filters E2E
- Collaboration ownership check
- Workplace detail static UI check

Path-filter로 실행되지 않은 검사는 해당 소유 파일이 이번 PR에서 변경됐는지 확인해 필요할 때만 수동 dispatch/동등 검증함.

- [ ] **Step 8: main과 diff를 검토함**

허용 범위: accessibility helper, 기존 owner의 semantic/focus hook, HTML labels/roles, CSS overflow/focus fixes, tests/workflows/cache refs, spec/plan 문서. API/RLS/Supabase migration/runtime auth 변경이 섞여 있으면 분리함.

- [ ] **Step 9: Draft PR을 생성하고 exact all-green head에서 ready-for-review 후 squash merge함**

PR title:

```text
Improve Web2 UX and accessibility contracts
```

merge 시 expected head SHA를 사용함. merge 후 main commit과 push CI를 다시 확인함.

## Self-Review

- Spec coverage: navigation current-state, icon names, dialog semantics/focus/Escape/restore, status/busy, focus visibility, 화면별 hierarchy, Team/Profile/Suborganizations, 360/768/1024/1440 responsive, keyboard-only, overflow, cache/CI가 Tasks 1–7에 모두 대응함.
- Placeholder scan: TBD/TODO/"later" 단계 없음. 각 code-changing step에 구체 interface 또는 code pattern을 포함함.
- Interface consistency: helper는 전 task에서 `window.KPTUA11y.dialog.activate/deactivate`로 동일하며 visibility를 변경하지 않음. router가 nav current-state를 단독 소유함.
- Scope check: 새로운 기능, 데이터 모델, auth/RLS, 성능 최적화는 포함하지 않음.
- Risk control: 동적 modal의 실제 owner 함수명이 파일별로 다르므로 구현 시 기존 close function을 그대로 callback으로 넘기고 새 close owner를 만들지 않음.
