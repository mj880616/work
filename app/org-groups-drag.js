// MULTI-다른담당자맞춤 ②(시안 PR 2522, 명진 11/13 13:51 'ㅇ'·15:30 'ㅇㅋ'): 조직 보고 화면에서 묶음 만들기·이름 바꾸기·묶음 풀기·끌어 옮기기.
// - 값은 내 프로필 화면 기억 org_order 하나(view-prefs.js, 새 저장소 없음). 고치는 규칙은 org-order-edit.mjs 한 곳.
// - 조직이 하나도 없는 묶음은 값에 둘 수 없어(서버 검사) '빈 묶음'으로 이 탭 메모리에만 두고, 조직을 끌어 넣는 순간 값에 넣는다.
// - 끌기: 손잡이 ⋮⋮(조직 줄·묶음 머리)를 누른 채 움직인다(마우스·손가락 같은 포인터 이벤트). 놓는 자리는 가는 줄로 보인다.
//   키보드: 손잡이에서 Alt+↑·Alt+↓(자료실 폴더 끌기와 같은 규칙). [위로]/[아래로] 단추는 없다.
// - 이 파일은 목록 HTML의 묶음 칸·손잡이와 끌기 동작만 맡는다. 목록 전체 renderer는 suborganizations.js renderTeam 하나다.
import {sectionsOf, moveOrg, moveGroup, renameGroup, ungroup, groupNameProblem, orderValue, TAIL_GROUP} from './org-order-edit.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
const MOVE_PX = 6;

let deps = null, pending = [], pendingScope = '', drag = null, menu = null, menuGroup = null;
const prefsOrder = () => globalThis.window?.KPTUViewPrefs?.get?.('org_order') ?? null;
const scopeNow = () => { const c = globalThis.window?.KPTURuntime?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
function pendingNow() { const s = scopeNow(); if (s !== pendingScope) { pendingScope = s; pending = []; } return pending; }

export const hasPending = () => pendingNow().length > 0;
const savedNames = () => (prefsOrder()?.groups || []).map(g => String(g?.name ?? ''));
const allNames = () => [...savedNames(), ...pendingNow()];

const grip = (kind, name, label) => `<button type="button" class="icon-btn so-grip" data-so-grip="${kind}" data-so-name="${esc(name)}" aria-label="${esc(label)} 옮기기" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" title="끌어서 옮기기 · Alt+↑↓"></button>`;

// 묶음 칸 HTML. row(o) = suborganizations.js의 조직 줄 HTML(그대로), 손잡이는 줄 맨 앞에 끼운다.
export function sectionsHtml(list, row) {
  const sections = sectionsOf(list, prefsOrder(), pendingNow());
  const withGrip = o => row(o).replace(/^<div class="so-row([^"]*)"([^>]*)>/, (m, cls, rest) => `<div class="so-row${cls} has-grip"${rest}>${grip('org', o.name, o.name)}`);
  return sections.map(s => {
    const own = s.kind !== 'tail', key = s.kind === 'tail' ? '' : s.name;
    const head = `<div class="so-group-heading">${own ? grip('group', s.name, `${s.name} 묶음`) : ''}<span>${esc(s.name)}</span><span class="so-group-count">${s.orgs.length}곳</span>${own ? `<button type="button" class="icon-btn so-group-more" data-so-group-more="${esc(s.name)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(s.name)} 묶음 메뉴"></button>` : ''}</div>`;
    const empty = !s.orgs.length ? `<div class="so-group-empty" data-so-drop-empty>${s.kind === 'pending' ? '여기로 끌어 넣기 · 넣으면 저장돼요' : '여기로 끌어 넣기'}</div>` : '';
    return `<div class="so-org-group" data-so-group="${esc(key)}" data-so-group-kind="${s.kind}"><div class="so-group-card">${head}${s.orgs.map(withGrip).join('')}${empty}</div></div>`;
  }).join('');
}

// ---- 저장 ----
async function save(result, okText) {
  if (result.error) { deps.notify(result.error, {error: true}); return false; }
  if (!result.changed) { deps.rerender(); return true; }
  if (result.emptied && !pendingNow().includes(result.emptied)) pending.push(result.emptied); // 비게 된 묶음은 빈 묶음으로 남긴다
  const ok = await deps.writeOrder(orderValue(result.value));
  if (!ok) deps.notify('묶음을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true});
  else {
    pending = pendingNow().filter(n => !savedNames().includes(n));
    if (okText) deps.toast(okText);
  }
  deps.rerender();
  return ok;
}

function moveOrgTo(name, group, before) {
  const pend = pendingNow(), at = group && pend.includes(group) ? groupInsertIndex(group) : null;
  return save(moveOrg(prefsOrder(), name, {group, before}, at));
}
// 빈 묶음을 값에 넣을 자리: 화면에서 그 묶음 앞에 있는 값 묶음 수.
function groupInsertIndex(name) {
  const order = [...document.querySelectorAll('#soOrganizationList [data-so-group-kind="group"],#soOrganizationList [data-so-group-kind="pending"]')].map(el => el.dataset.soGroup);
  const saved = new Set(savedNames());
  let n = 0;
  for (const g of order) { if (g === name) return n; if (saved.has(g)) n++; }
  return n;
}

// ---- 묶음 만들기·이름 바꾸기·풀기 ----
export function addGroup(name) {
  const v = String(name ?? '').trim(), problem = groupNameProblem(v, allNames());
  if (problem) return problem;
  if (savedNames().length + pendingNow().length >= 12) return '묶음은 12개까지예요.';
  pending.push(v);
  deps.rerender();
  deps.toast('묶음을 만들었어요. 조직을 끌어 넣으면 저장돼요.');
  return null;
}
export function renameGroupNamed(from, to) {
  const v = String(to ?? '').trim();
  if (pendingNow().includes(from)) {
    const problem = groupNameProblem(v, allNames(), from);
    if (problem) return Promise.resolve(problem);
    pending = pending.map(n => (n === from ? v : n));
    deps.rerender();
    return Promise.resolve(null);
  }
  const index = savedNames().indexOf(from), r = renameGroup(prefsOrder(), index, v);
  if (r.error) return Promise.resolve(r.error);
  return save(r, '묶음 이름을 바꿨어요.').then(ok => (ok ? null : '저장하지 못했어요.'));
}
function ungroupNamed(name) {
  if (pendingNow().includes(name)) { pending = pending.filter(n => n !== name); deps.rerender(); deps.toast('묶음을 풀었어요.'); return; }
  void save(ungroup(prefsOrder(), savedNames().indexOf(name)), `묶음을 풀었어요. 조직은 '${TAIL_GROUP}'로 옮겼어요.`);
}

// ---- 끌기(포인터) ----
const list = () => document.querySelector('#soOrganizationList');
function clearMarks() {
  document.querySelectorAll('#soOrganizationList .so-drop-before,#soOrganizationList .so-drop-after,#soOrganizationList .so-drop-into,#soOrganizationList .so-dragging')
    .forEach(el => el.classList.remove('so-drop-before', 'so-drop-after', 'so-drop-into', 'so-dragging'));
}
// 손가락·마우스 아래 놓을 자리. 조직: {group(null=그 외), before, el, cls}. 묶음: {to, el, cls}.
function targetAt(x, y) {
  // 맨 위 줄 단추(PC는 목록 첫 줄 위에 겹쳐 있음) 같은 겹친 것은 건너뛰고 목록 안 것만 본다.
  const el = (document.elementsFromPoint?.(x, y) || [document.elementFromPoint(x, y)]).find(n => n?.closest?.('#soOrganizationList .so-org-group[data-so-group-kind]'));
  const card = el?.closest?.('#soOrganizationList .so-org-group[data-so-group-kind]');
  if (!card) return null;
  const kind = card.dataset.soGroupKind;
  if (drag.kind === 'group') {
    if (kind === 'tail' || card.dataset.soGroup === drag.name) return null;
    const r = card.getBoundingClientRect(), after = y > r.top + r.height / 2;
    return {card: card.dataset.soGroup, after, el: card, cls: after ? 'so-drop-after' : 'so-drop-before'};
  }
  const group = kind === 'tail' ? null : card.dataset.soGroup;
  if (kind === 'tail') return {group: null, before: null, el: card, cls: 'so-drop-into'};
  const rowEl = el.closest('.so-row[data-so-row]');
  if (!rowEl || !card.contains(rowEl)) return {group, before: null, el: card, cls: 'so-drop-into'};
  const name = rowEl.querySelector('[data-so-grip]')?.dataset.soName;
  const r = rowEl.getBoundingClientRect(), after = y > r.top + r.height / 2;
  if (name === drag.name) return null;
  if (!after) return {group, before: name, el: rowEl, cls: 'so-drop-before'};
  const next = rowEl.nextElementSibling?.matches?.('.so-row[data-so-row]') ? rowEl.nextElementSibling.querySelector('[data-so-grip]')?.dataset.soName : null;
  return {group, before: next && next !== drag.name ? next : null, el: rowEl, cls: 'so-drop-after'};
}
// 화면 위·아래 끝 가까이 들고 있으면 계속 굴린다(손을 멈춰도). 굴린 뒤 놓을 자리를 다시 본다.
let scrollTimer = 0, scrollStep = 0, lastPoint = null;
function scroller() {
  let box = list();
  while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  return box && box !== document.body ? box : document.scrollingElement || document.documentElement;
}
function autoScroll(y) {
  const edge = 56;
  scrollStep = y < edge ? -12 : y > innerHeight - edge ? 12 : 0;
  if (!scrollStep || scrollTimer) return;
  const tick = () => {
    if (!drag?.moving || !scrollStep) { scrollTimer = 0; return; }
    scroller().scrollBy(0, scrollStep);
    if (lastPoint) mark(lastPoint.x, lastPoint.y);
    scrollTimer = requestAnimationFrame(tick);
  };
  scrollTimer = requestAnimationFrame(tick);
}
function mark(x, y) {
  clearMarks();
  (drag.kind === 'group' ? drag.grip.closest('.so-org-group') : drag.grip.closest('.so-row'))?.classList.add('so-dragging');
  drag.target = targetAt(x, y);
  drag.target?.el.classList.add(drag.target.cls);
}
function onDown(e) {
  const g = e.target.closest?.('#soOrganizationList [data-so-grip]');
  if (!g || e.button > 0) return;
  e.preventDefault();
  drag = {kind: g.dataset.soGrip, name: g.dataset.soName, x: e.clientX, y: e.clientY, id: e.pointerId, grip: g, moving: false, target: null};
  try { g.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 문서 이벤트로 따라간다 */ }
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moving) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < MOVE_PX) return;
    drag.moving = true;
    // '그 외'가 비어 칸이 없으면 끄는 동안만 빈 칸을 붙인다(조직을 묶음에서 빼는 자리).
    if (drag.kind === 'org' && !list()?.querySelector('[data-so-group-kind="tail"]')) {
      const last = [...(list()?.querySelectorAll('.so-org-group[data-so-group-kind]') || [])].pop();
      last?.insertAdjacentHTML('afterend', `<div class="so-org-group so-tail-temp" data-so-group="" data-so-group-kind="tail"><div class="so-group-card"><div class="so-group-heading"><span>${TAIL_GROUP}</span><span class="so-group-count">0곳</span></div><div class="so-group-empty">여기로 끌어 묶음에서 빼기</div></div></div>`);
    }
    (drag.kind === 'group' ? drag.grip.closest('.so-org-group') : drag.grip.closest('.so-row'))?.classList.add('so-dragging');
    list()?.classList.add('is-dragging');
  }
  e.preventDefault();
  lastPoint = {x: e.clientX, y: e.clientY};
  autoScroll(e.clientY);
  mark(e.clientX, e.clientY);
}
function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null; scrollStep = 0; lastPoint = null;
  clearMarks(); list()?.classList.remove('is-dragging'); list()?.querySelector('.so-tail-temp')?.remove();
  if (!d.moving || !d.target) return;
  if (d.kind === 'group') {
    const names = savedNames(), from = names.indexOf(d.name);
    if (from < 0) { // 빈 묶음 자리 바꾸기: 메모리 순서만
      const all = pendingNow().filter(n => n !== d.name), at = all.indexOf(d.target.card);
      if (at >= 0) { all.splice(d.target.after ? at + 1 : at, 0, d.name); pending = all; deps.rerender(); }
      return;
    }
    let to = names.indexOf(d.target.card);
    if (to < 0) return;
    if (d.target.after) to += 1;
    if (to > from) to -= 1;
    void save(moveGroup(prefsOrder(), from, to));
    return;
  }
  void moveOrgTo(d.name, d.target.group, d.target.before);
}
function onCancel() { if (!drag) return; drag = null; scrollStep = 0; lastPoint = null; clearMarks(); list()?.classList.remove('is-dragging'); list()?.querySelector('.so-tail-temp')?.remove(); }

// 키보드: 손잡이에서 Alt+↑↓. 조직은 화면 순서로 한 칸(묶음 경계를 넘으면 이웃 묶음 끝·앞으로, '그 외'는 가나다순이라 들어가기만).
function onKey(e) {
  const g = e.target.closest?.('#soOrganizationList [data-so-grip]');
  if (!g || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault();
  const up = e.key === 'ArrowUp', name = g.dataset.soName, kind = g.dataset.soGrip;
  const focusBack = () => requestAnimationFrame(() => [...document.querySelectorAll(`#soOrganizationList [data-so-grip="${kind}"]`)].find(b => b.dataset.soName === name)?.focus({preventScroll: false}));
  if (kind === 'group') {
    const names = savedNames(), from = names.indexOf(name);
    if (from < 0) return;
    void save(moveGroup(prefsOrder(), from, from + (up ? -1 : 1))).then(focusBack);
    return;
  }
  const cards = [...document.querySelectorAll('#soOrganizationList .so-org-group[data-so-group-kind]:not([data-so-group-kind="tail"])')];
  const card = g.closest('.so-org-group'), kindNow = card?.dataset.soGroupKind;
  const rows = card ? [...card.querySelectorAll('[data-so-grip="org"]')].map(b => b.dataset.soName) : [];
  if (kindNow === 'tail') { // '그 외' → 위 묶음 끝으로(↑만)
    const last = cards[cards.length - 1];
    if (up && last) void moveOrgTo(name, last.dataset.soGroup, null).then(focusBack);
    return;
  }
  const i = rows.indexOf(name), ci = cards.indexOf(card);
  if (up) {
    if (i > 0) void moveOrgTo(name, card.dataset.soGroup, rows[i - 1]).then(focusBack);
    else if (ci > 0) void moveOrgTo(name, cards[ci - 1].dataset.soGroup, null).then(focusBack);
  } else if (i < rows.length - 1) {
    void moveOrgTo(name, card.dataset.soGroup, rows[i + 2] ?? null).then(focusBack);
  } else if (ci < cards.length - 1) {
    const nextRows = [...cards[ci + 1].querySelectorAll('[data-so-grip="org"]')].map(b => b.dataset.soName);
    void moveOrgTo(name, cards[ci + 1].dataset.soGroup, nextRows[0] ?? null).then(focusBack);
  } else void moveOrgTo(name, null, null).then(focusBack);
}

// ---- 묶음 ⋯ 메뉴 ----
async function openGroupMenu(trigger) {
  const {createAnchoredMenu} = await import('./anchored-menu.js');
  menu ||= createAnchoredMenu({id: 'soGroupMenu', className: 'basket-link-menu so-team-menu', label: '묶음 메뉴', historyKey: 'kptuSoGroupMenu', key: () => 'group',
    render: () => deps.menuItem('data-so-group-rename', '이름 바꾸기') + deps.menuItem('data-so-group-ungroup', '묶음 풀기'), // 메뉴 글자 줄은 조직 보고 메뉴와 같은 틀
    onAction: (button, active) => {
      const name = menuGroup;
      if (button.matches('[data-so-group-rename]')) deps.openGroupEdit(name, active.trigger);
      else if (button.matches('[data-so-group-ungroup]')) ungroupNamed(name);
    }});
  menuGroup = trigger.dataset.soGroupMore;
  menu.open(trigger);
}

export function install(d) {
  deps = d;
  if (globalThis.window?.__KPTU_ORG_GROUPS_DRAG__) return;
  window.__KPTU_ORG_GROUPS_DRAG__ = true;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, {passive: false});
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', e => {
    const more = e.target.closest?.('#soOrganizationList [data-so-group-more]');
    if (more) { e.preventDefault(); e.stopPropagation(); void openGroupMenu(more).catch(err => console.error('group menu', err)); return; }
    // 손잡이 누름은 줄 열기·선택으로 이어지지 않는다.
    if (e.target.closest?.('#soOrganizationList [data-so-grip]')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('kptu:session-changed', () => { pending = []; pendingScope = ''; });
}
