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

### Task 1: 실패하는 UX·접근성 계약부터 고정

**Files:**
- Create: `tests/app-e2e/accessibility-ux.spec.mjs`
- Modify: `.github/workflows/app-e2e-check.yml`

**Interfaces:**
- Consumes: 기존 Supabase mock/login pattern, `#appView`, `.app-nav`, static modal IDs
- Produces: nav current-state, dialog semantics, icon accessible name, focus restore, viewport overflow 회귀계약

- [ ] **Step 1: `ui-system.spec.mjs`의 Supabase mock/login 패턴을 재사용해 `boot(page,viewport)` helper를 작성함.**

```js
async function boot(page,viewport){
  await page.setViewportSize(viewport);
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}
```

- [ ] **Step 2: nav current-state가 현재 CSS class만 있고 semantic state는 없어 실패하는 테스트를 추가함.**

```js
test('active navigation exposes aria-current',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('.app-nav [data-view="tasks"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.app-nav [data-view="home"]')).not.toHaveAttribute('aria-current');
});
```

- [ ] **Step 3: task modal semantics/focus/Escape/restore가 실패하는 테스트를 추가함.**

```js
test('task dialog traps focus and restores its trigger',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('[data-view="tasks"]').click();
  const trigger=page.locator('#newTaskBtn');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#taskModal');
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  await expect(page.locator('#taskTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});
```

- [ ] **Step 4: symbol-only button accessible name 실패 테스트를 추가함.**

```js
await expect(page.locator('#prevMonthBtn')).toHaveAttribute('aria-label','이전 달');
await expect(page.locator('#nextMonthBtn')).toHaveAttribute('aria-label','다음 달');
await expect(page.locator('#taskModal [data-close="taskModal"]')).toHaveAttribute('aria-label','닫기');
```

- [ ] **Step 5: 360/768/1024/1440에서 core view horizontal overflow를 검사함.**

```js
for(const viewport of [
  {width:360,height:800},{width:768,height:1024},
  {width:1024,height:768},{width:1440,height:900}
]){
  for(const view of ['home','calendar','tasks','projects','library','meetings','pages','team']){
    await page.locator(`[data-view="${view}"]`).first().click();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow,`${viewport.width}:${view}`).toBeLessThanOrEqual(1);
  }
}
```

- [ ] **Step 6: `.github/workflows/app-e2e-check.yml`에 `tests/app-e2e/accessibility-ux.spec.mjs`를 추가하고 PR CI에서 신규 계약이 실제로 실패하는 것을 확인함.**

- [ ] **Step 7: 커밋함.**

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
- Produces: `window.KPTUA11y.dialog.activate(modal,{trigger,initialFocus,onRequestClose})`
- Produces: `window.KPTUA11y.dialog.deactivate(modal,{restoreFocus,fallbackFocus})`
- Consumes: owner-controlled modal visibility and `aria-hidden`

- [ ] **Step 1: Tab/Shift+Tab 순환을 Task 1 테스트에 추가해 현재 실패를 확인함.**

```js
await page.locator('#taskTitle').focus();
await page.keyboard.press('Shift+Tab');
await expect(page.locator('#taskModal [data-close="taskModal"]')).toBeFocused();
```

- [ ] **Step 2: `app/accessibility-dialog.js`를 아래 계약으로 구현함.**

```js
(()=>{
  if(window.KPTUA11y?.dialog)return;
  const state=new WeakMap();
  let active=null;
  const focusable='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const resolve=(modal,v)=>typeof v==='string'?modal.querySelector(v):v;
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
    const fallback=typeof fallbackFocus==='string'?document.querySelector(fallbackFocus):fallbackFocus;
    const target=saved?.trigger?.isConnected?saved.trigger:fallback;
    target?.focus?.({preventScroll:true});
  }
  document.addEventListener('keydown',e=>{
    if(!active||active.classList.contains('hidden'))return;
    if(e.key==='Escape'){
      const close=state.get(active)?.onRequestClose;
      if(close){e.preventDefault();close()}
      return;
    }
    if(e.key!=='Tab')return;
    const list=items(active);
    if(!list.length){e.preventDefault();active.focus();return}
    const first=list[0],last=list[list.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });
  window.KPTUA11y={...(window.KPTUA11y||{}),dialog:{activate,deactivate}};
})();
```

- [ ] **Step 3: `loader-v2.js`에서 `app-router.js` 이후, `team.js` 이전에 `await import('./accessibility-dialog.js?v=1');`를 추가함.**

- [ ] **Step 4: `app-router.js::go()`가 `.active`와 `aria-current`를 동시에 단독 동기화하도록 수정함.**

```js
document.querySelectorAll('.app-nav .nav-btn').forEach(btn=>{
  const current=btn.dataset.view===view;
  btn.classList.toggle('active',current);
  if(current)btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
});
```

Mobile dock `[data-cc-view]`에도 동일 규칙을 적용함.

- [ ] **Step 5: `index.html` static modal에 `role="dialog"`, `aria-modal="true"`, heading id, `aria-labelledby`를 추가하고 `×`, `‹`, `›` button에 각각 `닫기`, `이전 달`, `다음 달` aria-label을 추가함.**

- [ ] **Step 6: `base-ui.css`에 `.sr-only`와 link/nav/role-button focus-visible 계약을 추가함.**

```css
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
a:focus-visible,.nav-btn:focus-visible,[role="button"]:focus-visible{outline:2px solid var(--kptu-info);outline-offset:2px}
```

- [ ] **Step 7: `accessibility-ux.spec.mjs`를 실행해 nav/icon/static dialog semantics가 PASS하는지 확인함. Focus restore는 Task 3 전까지 FAIL 가능함.**

- [ ] **Step 8: 커밋함.**

```bash
git add app/accessibility-dialog.js app/loader-v2.js app/app-router.js app/index.html app/base-ui.css
git commit -m "feat: add shared dialog accessibility foundation"
```

---

### Task 3: `team.js` core modal·status·busy 계약 연결

**Files:**
- Modify: `app/team.js`
- Modify: `app/index.html`
- Test: `tests/app-e2e/accessibility-ux.spec.mjs`
- Test: `tests/app-e2e/workspace.spec.mjs`
- Test: `tests/app-e2e/meeting-entry.spec.mjs`
- Test: `tests/app-e2e/page-core-structure.spec.mjs`

**Interfaces:**
- Consumes: `KPTUA11y.dialog.activate/deactivate`
- Produces: expanded `openModal(id,{trigger,initialFocus,onRequestClose})`, `closeModal(id,{restoreFocus})`

- [ ] **Step 1: event/task/document/meeting/editor/invite/group trigger → close → trigger focus 복귀 검사를 추가함.**

- [ ] **Step 2: 현재 `team.js`의 `openModal/closeModal`을 아래처럼 확장함.**

```js
function openModal(id,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){
  const m=$('#'+id);if(!m)return;
  m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus,onRequestClose:onRequestClose||(()=>closeModal(id))});
}
function closeModal(id,{restoreFocus=true}={}){
  const m=$('#'+id);if(!m)return;
  m.classList.add('hidden');m.setAttribute('aria-hidden','true');
  window.KPTUA11y?.dialog.deactivate(m,{restoreFocus,fallbackFocus:'#appView .view-panel:not(.hidden) h2'});
}
```

- [ ] **Step 3: 기존 opener가 첫 입력을 명시하도록 수정함.**

```js
openModal('eventModal',{initialFocus:'#eventTitle'});
openModal('taskModal',{initialFocus:'#taskTitle'});
openModal('documentModal',{initialFocus:'#docTitle'});
openModal('meetingModal',{initialFocus:'#meetingTitle'});
openModal('editorModal',{initialFocus:'#pageTitle'});
```

`inviteModal`, `groupModal`도 각각 첫 input selector를 지정함.

- [ ] **Step 4: 현재 `setStatus(el,msg,type)`가 semantic role을 함께 동기화하도록 수정함.**

```js
function setStatus(el,msg,type=''){
  if(!el)return;
  el.textContent=msg||'';el.className='status'+(type?' '+type:'');
  if(type==='error'){el.setAttribute('role','alert');el.removeAttribute('aria-live')}
  else{el.setAttribute('role','status');el.setAttribute('aria-live','polite')}
}
```

- [ ] **Step 5: `setBusy(button,busy)` helper를 추가하고 `saveEvent`, `saveTask`, `saveDocument`, `saveMeeting`, `savePage`, `createInvite`, `saveGroup`의 existing try/catch를 try/finally로 감싸 disabled/aria-busy를 정확히 복구함. API body와 권한 로직은 바꾸지 않음.**

- [ ] **Step 6: API 응답 지연 fixture로 저장 중 `disabled + aria-busy=true`, 성공/실패 후 해제를 검증함.**

- [ ] **Step 7: 아래 E2E를 실행함.**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs tests/app-e2e/workspace.spec.mjs tests/app-e2e/meeting-entry.spec.mjs tests/app-e2e/page-core-structure.spec.mjs --browser=chromium --workers=1 --reporter=line
```

- [ ] **Step 8: 커밋함.**

```bash
git add app/team.js app/index.html tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: wire core dialogs and busy states to accessibility contracts"
```

---

### Task 4: Home·Calendar·Tasks 고빈도 화면 UX 정리

**Files:**
- Modify: `app/index.html`
- Modify: `app/home-task.css`
- Modify: `app/calendar-ui.css`
- Modify: `app/task-layout.js`
- Modify: `app/task-layout.css`
- Test: `tests/app-e2e/accessibility-ux.spec.mjs`
- Test: `tests/app-e2e/ui-system.spec.mjs`
- Test: `tests/app-e2e/calendar-move.spec.mjs`
- Test: `tests/app-e2e/task-layout-groups.spec.mjs`

**Interfaces:**
- Consumes: `.sr-only`, router semantics, dialog helper
- Produces: labelled task filters, labelled month controls, target-specific destructive names, 360px-safe headers/toolbars

- [ ] **Step 1: `taskScope`, `taskStatus`에 programmatic label이 없음을 실패 테스트로 고정함.**

- [ ] **Step 2: Tasks toolbar에 다음 label을 추가함.**

```html
<label class="sr-only" for="taskScope">할 일 범위</label>
<select id="taskScope">...</select>
<label class="sr-only" for="taskStatus">할 일 상태</label>
<select id="taskStatus">...</select>
```

- [ ] **Step 3: Calendar month toolbar를 `role="group" aria-labelledby="monthTitle"`로 연결함.**

- [ ] **Step 4: `task-layout.js::card(t)`의 삭제 button에 `aria-label="${제목} 삭제"`를 추가함. 수정/완료는 visible text가 충분하므로 중복 aria-label을 추가하지 않음.**

- [ ] **Step 5: 360×800에서 Home stat-card, Calendar section-head/calendar grid, Tasks section-head/filter toolbar가 document-level overflow를 만들지 않게 기존 CSS만 최소 조정함. Primary action은 첫 viewport에서 유지함.**

- [ ] **Step 6: 관련 테스트를 실행함.**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs tests/app-e2e/ui-system.spec.mjs tests/app-e2e/calendar-move.spec.mjs tests/app-e2e/task-layout-groups.spec.mjs --browser=chromium --workers=1 --reporter=line
```

- [ ] **Step 7: 커밋함.**

```bash
git add app/index.html app/home-task.css app/calendar-ui.css app/task-layout.js app/task-layout.css tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: improve high-frequency workspace UX"
```

---

### Task 5: Projects·Library·Meetings·Pages dynamic flow 접근성 연결

**Files:**
- Modify: `app/project-system-v3.js`
- Modify: `app/library-upload.js`
- Modify: `app/meeting-round-detail.js`
- Modify: `app/page-save-controller.js`
- Modify: `app/page-builder.js`
- Modify: `app/index.html`
- Test: feature E2E + `tests/app-e2e/accessibility-ux.spec.mjs`

**Interfaces:**
- Consumes: `KPTUA11y.dialog.activate/deactivate`, `.sr-only`
- Produces: project `openModal/closeModal` focus contract, meeting `mrdOpen/mrdClose` focus contract, labelled Library/Pages filters, busy/error semantics

- [ ] **Step 1: Library/Pages search/filter label 실패 테스트를 추가함.**

```js
await expect(page.locator('label[for="documentSearch"]')).toHaveCount(1);
await expect(page.locator('label[for="documentProject"]')).toHaveCount(1);
await expect(page.locator('label[for="pageSearch"]')).toHaveCount(1);
await expect(page.locator('label[for="pageFilter"]')).toHaveCount(1);
```

- [ ] **Step 2: `index.html` Library/Pages toolbar에 `.sr-only` label을 추가함. Placeholder는 유지하되 label이 accessible name source가 되게 함.**

- [ ] **Step 3: `project-system-v3.js::ensureUi()`가 생성하는 모든 `.modal`에 role/aria-modal/aria-labelledby를 넣고 모든 `data-ps3-close` `×` button에 `aria-label="닫기"`를 추가함.**

- [ ] **Step 4: 현재 `project-system-v3.js::openModal(id)` / `closeModal(id)`을 Task 3의 team 패턴과 동일하게 확장하되, visibility 변경은 이 함수가 계속 소유함. `ps3CreateModal` first focus는 `#ps3CreateName`, detail은 `#ps3DetailModal .ps3-modal-head button`, workstream은 `#ps3WsTitle`, milestone은 `#ps3MilestoneTitle`을 사용함.**

- [ ] **Step 5: `meeting-round-detail.js::mrdInstallModal()` markup에 `role="dialog" aria-modal="true" aria-labelledby="mrdTitle"`, `#mrdClose aria-label="닫기"`를 추가하고 `mrdOpen()`에서 `dialog.activate(...,{initialFocus:'#mrdClose',onRequestClose:mrdClose})`, `mrdClose()`에서 visibility 변경 후 `dialog.deactivate()`를 호출함.**

- [ ] **Step 6: `library-upload.js`와 `page-save-controller.js`의 기존 saving/single-flight state에 `aria-busy`를 연결함. 중복제출 방지와 partial save 로직은 변경하지 않음. 오류 status는 `role="alert"`, 일반 progress/success는 `role="status"`로 동기화함.**

- [ ] **Step 7: Project child `<details>` menu는 기존 native keyboard semantics를 유지하고 Enter/Space open + Tab 이동을 Playwright로 검증함. 별도 keydown 구현을 추가하지 않음.**

- [ ] **Step 8: 기능별 회귀검사를 실행함.**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs tests/app-e2e/project-system-v3.spec.mjs tests/app-e2e/project-v3-structure.spec.mjs tests/app-e2e/library-upload-failure.spec.mjs tests/app-e2e/meeting-entry.spec.mjs tests/app-e2e/page-builder.spec.mjs tests/app-e2e/page-core-structure.spec.mjs tests/app-e2e/runtime-recovery.spec.mjs --browser=chromium --workers=1 --reporter=line
```

- [ ] **Step 9: 커밋함.**

```bash
git add app/project-system-v3.js app/library-upload.js app/meeting-round-detail.js app/page-save-controller.js app/page-builder.js app/index.html tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: align project and content flows with accessibility contracts"
```

---

### Task 6: Team·Profile·Suborganizations 관리 UX 정리

**Files:**
- Modify: `app/profile-settings.js`
- Modify: `app/suborganizations.js`
- Modify: `app/suborganization-filters.js`
- Modify: feature CSS only when overflow/focus clipping is reproduced
- Test: `tests/app-e2e/profile-workplaces.spec.mjs`
- Test: `tests/app-e2e/security-org-affiliations.spec.mjs`
- Test: `tests/app-e2e/suborganization-filters.spec.mjs`
- Test: `tests/app-e2e/accessibility-ux.spec.mjs`

**Interfaces:**
- Consumes: dialog helper, `.sr-only`, Design System state/focus rules
- Produces: suborganization `open/close` focus contract, labelled filter toolbar, busy semantics, target-specific destructive names

- [ ] **Step 1: `suborganizations.js::installModals()`가 만드는 `soEditModal`, `soAssignModal`에 role/aria-modal/aria-labelledby를 추가하고 `data-so-close` button에 `aria-label="닫기"`를 추가함.**

- [ ] **Step 2: 현재 `open(id)` / `close(id)`를 helper에 연결함. `openEdit()`은 `#soEditName`, `openAssign()`은 `#soAssignMembers input`을 initial focus로 사용하고 Escape callback은 기존 `close(id)`를 호출함.**

- [ ] **Step 3: `renderTeam()`의 산하조직 삭제 button에 `aria-label="${o.name} 삭제"`를 추가함. 수정/담당자 지정은 visible text를 그대로 사용함.**

- [ ] **Step 4: `saveOrg()`와 `saveAssignees()`에서 기존 `btn.disabled`에 `aria-busy`를 동기화하고 `soEditStatus`, `soAssignStatus`는 error일 때 `role="alert"`, 진행일 때 `role="status"`를 사용함.**

- [ ] **Step 5: `suborganization-filters.js::installToolbar()`의 동적 markup을 다음 programmatic labels를 포함하도록 변경함.**

```html
<label class="sr-only" for="sofSearch">산하조직 검색</label>
<input id="sofSearch" ...>
<label class="sr-only" for="sofAssignee">담당자 필터</label>
<select id="sofAssignee">...</select>
<label class="sr-only" for="sofCouncil">협의회 필터</label>
<select id="sofCouncil">...</select>
<label class="sr-only" for="sofType">조직유형 필터</label>
<select id="sofType">...</select>
```

- [ ] **Step 6: `profile-settings.js::renderControls()`가 `savingWorkplaces`일 때 `#psSaveWorkplaces`에 `aria-busy="true"`, 완료 시 제거하도록 수정함. `saveProfile()`은 `#psSaveProfile`을 try/finally 동안 disabled + aria-busy로 처리함.**

- [ ] **Step 7: viewer fixture에서 admin-only controls가 hidden이며 Tab sequence에 들어오지 않는지, profile/suborganization destructive buttons의 accessible name이 대상을 포함하는지 E2E를 추가함.**

- [ ] **Step 8: 관련 테스트를 실행함.**

```bash
npx playwright test tests/app-e2e/accessibility-ux.spec.mjs tests/app-e2e/profile-workplaces.spec.mjs tests/app-e2e/security-org-affiliations.spec.mjs tests/app-e2e/suborganization-filters.spec.mjs --browser=chromium --workers=1 --reporter=line
```

- [ ] **Step 9: 커밋함.**

```bash
git add app/profile-settings.js app/suborganizations.js app/suborganization-filters.js tests/app-e2e/accessibility-ux.spec.mjs
git commit -m "feat: improve people and organization accessibility"
```

---

### Task 7: 4-viewport gate·cache chain·전체 회귀검증·PR

**Files:**
- Modify: `tests/app-e2e/accessibility-ux.spec.mjs`
- Modify: `tests/app-e2e/ui-system.spec.mjs`
- Modify: `tests/app-e2e/mobile-ux-shell.spec.mjs`
- Modify: `tests/app-e2e/desktop-layout.spec.mjs`
- Modify: `.github/workflows/app-smoke-check.yml`
- Modify: `app/styles.css`, `app/loader-v2.js` 및 필요한 상위 cache reference

**Interfaces:**
- Consumes: Tasks 1–6 complete contracts
- Produces: Task 7 production regression gate와 exact all-green PR head

- [ ] **Step 1: 360×800, 768×1024, 1024×768, 1440×900에서 Home/Calendar/Tasks/Projects/Library/Meetings/Pages/Team/Profile의 document-level horizontal overflow를 1px 이하로 검사함.**

- [ ] **Step 2: 360/768에서 task modal을 열고 `.modal-card` 내부 scroll, 저장 button 접근 가능성, mobile dock/footer 비가림을 검사함.**

- [ ] **Step 3: keyboard-only smoke flow를 추가함: Tasks view 진입 → Tab으로 `#newTaskBtn` → Enter → task modal → Tab/Shift+Tab 순환 → Escape → `#newTaskBtn` focus 복귀.**

- [ ] **Step 4: smoke에 helper 구조 invariant를 추가함.**

```bash
grep -q "accessibility-dialog.js?v=1" app/loader-v2.js
! grep -q "MutationObserver\|setTimeout" app/accessibility-dialog.js
```

Semantic behavior는 grep으로 복제하지 않고 Playwright가 검증함.

- [ ] **Step 5: 실제 수정된 CSS/JS의 cache version을 현재 체인 규칙대로 bump하고 smoke의 hard-coded version 계약도 같은 commit에서 갱신함.**

- [ ] **Step 6: PR의 App browser E2E 전체와 관련 전용 workflow를 확인함. 최소 확인 목록은 App smoke, App browser E2E, Router ready, Page management, Browser storage audit, Public workspace auth, Profile single-render, Suborganization filters, Collaboration ownership, Workplace detail static UI임. `runtime-client.js/page-save-controller.js/library-upload.js`가 변경돼 Runtime recovery workflow가 트리거되면 그것도 green이어야 함.**

- [ ] **Step 7: main 대비 diff를 검토해 API/RLS/Supabase migration/auth/session 구조 변경이 섞이지 않았는지 확인함.**

- [ ] **Step 8: Draft PR `Improve Web2 UX and accessibility contracts`를 만들고 all-green exact head SHA를 고정한 뒤 ready-for-review → squash merge함.**

- [ ] **Step 9: merge 후 main이 squash commit을 가리키는지와 main push CI가 다시 green인지 확인함.**

## Self-Review

- Spec coverage: navigation current-state, icon names, dialog semantics/focus/Escape/restore, status/busy, focus visibility, 고빈도 화면 hierarchy, Projects/Library/Meetings/Pages, Team/Profile/Suborganizations, 360/768/1024/1440 responsive, keyboard-only, overflow, cache/CI를 Tasks 1–7에 모두 배치함.
- Placeholder scan: TBD/TODO/조건부 파일명 없음. 실제 repository 함수명 `openModal/closeModal`, `mrdOpen/mrdClose`, `open/close`, `renderControls/saveProfile`을 계획에 사용함.
- Interface consistency: 전 task에서 helper interface는 `window.KPTUA11y.dialog.activate/deactivate`로 동일하며 visibility는 기존 owner가 변경함.
- Scope check: 신규 기능, DB/API/RLS, 인증/session, Task 8 성능 최적화는 포함하지 않음.
