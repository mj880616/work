// ORG-쟁의단계 화면: ① 조직 상세의 '쟁의 단계' 한 줄(선택 + 달력 날짜 + 저장, 접힌 단계 이력) ② 쟁의 단계 관리 창.
// 데이터는 org-dispute-stage.js, 판정은 org-dispute-stage-model.mjs 한 곳. 표가 없으면(DB 적용 전) '준비 중' 한 줄만 보인다.
import {seoulDateKey} from './meeting-time.js';
import {loadDisputeState, ensureSeeded, peekDisputeState, saveOrgStage, addStage, renameStage, setStageFlag, reorderStages, deleteStage} from './org-dispute-stage.js';
import {stageOfOrg, sortStages, historyLines, reorderChanges, orgsAtStageText, stageNameProblem, STAGE_NAME_LIMIT, DEFAULT_STAGES} from './org-dispute-stage-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const today = () => seoulDateKey(Date.now());
const errText = e => (e && e.message) || String(e || '');

// ───────────── ① 조직 상세의 쟁의 단계 한 줄 ─────────────
let line = null; // {host, orgId, orgName, workspaceId, canEdit, rt, draft:{stageId,date,dateTouched}, busy, msg:{text,error}, run}

export function paintStageLine(opts) {
  const same = line && line.host === opts.host && line.orgId === opts.orgId;
  line = {draft: null, busy: false, msg: {text: '', error: false}, ...(same ? {draft: line.draft, msg: line.msg} : {}), ...opts, run: (line?.run || 0) + 1};
  bindLine(line.host);
  paintLine();
  const state = peekDisputeState();
  if (!state || state.status !== 'ready') {
    const mine = line.run;
    void loadDisputeState({rt: line.rt, workspaceId: line.workspaceId}).then(() => { if (line && line.run === mine) paintLine(); });
  }
}
export function clearStageLine() { if (line) line.host.replaceChildren(); line = null; }

// 기본 단계가 아직 DB에 없으면(처음 쓰기 전) 선택지는 기본 11개 그대로 보여 주고(값 'seed:이름'), 저장할 때 ensureSeeded가 채운다.
const lineStages = state => state.stages.length ? sortStages(state.stages) : DEFAULT_STAGES.map(s => ({...s, id: 'seed:' + s.name}));
function paintLine() {
  if (!line) return;
  const {host, orgId, canEdit} = line, state = peekDisputeState();
  if (!state) { host.innerHTML = '<span class="wd-stage-k">쟁의 단계</span><span class="wd-stage-note">불러오는 중…</span>'; return; }
  if (state.status === 'preparing') { host.innerHTML = '<span class="wd-stage-k">쟁의 단계</span><span class="wd-stage-note" data-stage-preparing>준비 중</span>'; return; }
  if (state.status === 'error') { host.innerHTML = '<span class="wd-stage-k">쟁의 단계</span><span class="wd-stage-note" role="alert">불러오지 못했어요</span><button type="button" class="wd-stage-btn" data-stage-retry>다시 시도</button>'; return; }
  const stages = lineStages(state), cur = stageOfOrg(orgId, state.histories, stages);
  const draft = line.draft, stageId = draft?.stageId ?? cur.stage?.id ?? '', date = draft?.date ?? cur.date;
  const rows = state.histories.get(orgId) ?? [], hist = historyLines(rows, 20);
  const options = stages.map(s => `<option value="${esc(s.id)}"${s.id === stageId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  const controls = canEdit
    ? `<select class="wd-stage-select" data-stage-select aria-label="쟁의 단계">${options}</select><input class="wd-stage-date" type="date" data-stage-date value="${esc(date)}" aria-label="단계 날짜"><button type="button" class="wd-stage-btn" data-stage-save disabled>저장</button>`
    : `<span class="wd-stage-now">${esc(cur.name)}${cur.date ? ` · ${esc(cur.date)}` : ''}</span>`;
  host.innerHTML = `<span class="wd-stage-k">쟁의 단계</span>${controls}<span class="wd-stage-msg${line.msg.error ? ' error' : ''}" data-stage-msg role="${line.msg.error ? 'alert' : 'status'}">${esc(line.msg.text)}</span>`
    + (hist.length ? `<details class="wd-stage-hist"><summary>단계 이력 ${hist.length}</summary>${hist.map(h => `<div>${esc(h.date)} ${esc(h.name)}</div>`).join('')}</details>` : '');
  updateSave();
}

function updateSave() {
  if (!line) return;
  const state = peekDisputeState(); if (!state || state.status !== 'ready') return;
  const btn = line.host.querySelector('[data-stage-save]'); if (!btn) return;
  const cur = stageOfOrg(line.orgId, state.histories, lineStages(state));
  const select = line.host.querySelector('[data-stage-select]'), date = line.host.querySelector('[data-stage-date]');
  const changed = select.value !== (cur.stage?.id ?? '') || date.value !== cur.date;
  btn.disabled = line.busy || !changed || !date.value;
}

async function saveLine() {
  if (!line || line.busy) return;
  let state = peekDisputeState(); const host = line.host, mine = line;
  const picked = host.querySelector('[data-stage-select]').value, date = host.querySelector('[data-stage-date]').value;
  if (!state || !picked || !date) return;
  line.busy = true; host.querySelector('[data-stage-save]').disabled = true;
  setMsg('저장하는 중…');
  try {
    if (picked.startsWith('seed:')) state = await ensureSeeded({rt: line.rt, workspaceId: line.workspaceId});
    const stage = picked.startsWith('seed:') ? state.stages.find(s => s.name === picked.slice(5)) : state.stages.find(s => s.id === picked);
    if (!stage) throw new Error('단계를 찾지 못했어요.');
    await saveOrgStage({rt: line.rt, workspaceId: line.workspaceId, orgId: line.orgId, stage, date, history: state.histories.get(line.orgId) ?? []});
    if (line === mine) { line.draft = null; line.busy = false; line.msg = {text: '저장했어요.', error: false}; paintLine(); }
  } catch (e) {
    if (line === mine) { line.busy = false; line.msg = {text: `저장하지 못했어요. ${errText(e)}`, error: true}; paintLine(); }
  }
}
function setMsg(text, error = false) {
  if (!line) return; line.msg = {text, error};
  const el = line.host.querySelector('[data-stage-msg]'); if (el) { el.textContent = text; el.className = 'wd-stage-msg' + (error ? ' error' : ''); }
}

function bindLine(host) {
  if (host.dataset.stageBound) return; host.dataset.stageBound = '1';
  host.addEventListener('change', e => {
    if (!line) return;
    const select = e.target.closest('[data-stage-select]'), date = e.target.closest('[data-stage-date]');
    const state = peekDisputeState(); if (!state) return;
    const cur = stageOfOrg(line.orgId, state.histories, lineStages(state));
    if (select) {
      const input = host.querySelector('[data-stage-date]');
      // 다른 단계를 고르면 날짜는 오늘로(직접 고친 날짜가 없을 때). 원래 단계로 돌아오면 원래 날짜.
      if (select.value !== (cur.stage?.id ?? '')) { if (!line.draft?.dateTouched) input.value = today(); } else if (!line.draft?.dateTouched) input.value = cur.date;
    }
    line.draft = {stageId: host.querySelector('[data-stage-select]').value, date: host.querySelector('[data-stage-date]').value, dateTouched: !!date || !!line.draft?.dateTouched};
    setMsg(''); updateSave();
  });
  host.addEventListener('click', e => {
    if (e.target.closest('[data-stage-save]')) void saveLine();
    else if (e.target.closest('[data-stage-retry]') && line) { const mine = line; void loadDisputeState({rt: line.rt, workspaceId: line.workspaceId, force: true}).then(() => { if (line === mine) paintLine(); }); }
  });
}
window.addEventListener('kptu:dispute-stages-changed', () => { if (line && !line.busy && !line.host.contains(document.activeElement)) paintLine(); });

// ───────────── ② 쟁의 단계 관리 창 ─────────────
let mgr = null; // {workspaceId, rt, orgNames, ui:{id,mode,draft}, adding, addDraft, busy, msg}
const MODAL = 'soStageModal';
function installModal() {
  if (document.querySelector('#' + MODAL)) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="${MODAL}" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soStageHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soStageHeading">쟁의 단계 관리</h2></div><button class="icon-btn" data-so-close="${MODAL}" type="button" aria-label="닫기">×</button></div><div id="soStageBody" class="stg"></div></div></div>`);
}
export function openStageManager({workspaceId, rt = window.KPTURuntime, orgNames = () => new Map(), trigger = document.activeElement} = {}) {
  installModal();
  mgr = {workspaceId, rt, orgNames, ui: {id: null, mode: null, draft: ''}, adding: false, addDraft: '', busy: false, msg: {text: '', error: false}};
  const m = document.querySelector('#' + MODAL);
  m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false');
  window.KPTUA11y?.dialog.activate(m, {trigger, initialFocus: '#soStageBody', onRequestClose: closeStageManager});
  paintManager();
  const mine = mgr;
  void loadDisputeState({rt, workspaceId, force: true}).then(state => state.status === 'ready' ? ensureSeeded({rt, workspaceId}) : state).catch(e => { if (mgr === mine) say(errText(e), true); }).then(() => { if (mgr === mine) paintManager(); });
}
export function closeStageManager() {
  const m = document.querySelector('#' + MODAL); if (!m) return;
  m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true');
  window.KPTUA11y?.dialog.deactivate(m, {restoreFocus: true});
  mgr = null;
}

function orgsAt(stageId, state) {
  const names = mgr.orgNames(), out = [];
  for (const orgId of state.histories.keys()) if (stageOfOrg(orgId, state.histories, state.stages).stage?.id === stageId) out.push(names.get(orgId) || '다른 조직');
  return out.sort((a, b) => a.localeCompare(b, 'ko'));
}

function rowHtml(s, state) {
  const ui = mgr.ui, mine = ui.id === s.id, busy = mgr.busy ? ' disabled' : '';
  const name = esc(s.name);
  let flags;
  if (s.is_default) flags = '<span class="stg-tag">기본</span>';
  else flags = `<button type="button" class="stg-sw${s.is_struggle ? ' on' : ''}" data-stg-flag="struggle" aria-pressed="${s.is_struggle}"${busy}>투쟁 중</button>${s.is_ending ? `<button type="button" class="stg-sw end" data-stg-flag="ending" aria-pressed="true"${busy}>끝남</button>` : ''}`;
  let extra = '';
  if (mine && ui.mode === 'menu') {
    extra = `<div class="stg-sub"><button type="button" class="stg-link" data-stg-rename${busy}>이름 바꾸기</button>${s.is_default ? '' : `<button type="button" class="stg-link" data-stg-flag="ending" data-stg-menu${busy}>끝남 ${s.is_ending ? '끄기' : '켜기'}</button><button type="button" class="stg-link danger" data-stg-delete${busy}>지우기</button>`}</div>`;
  } else if (mine && ui.mode === 'rename') {
    extra = `<form class="stg-sub" data-stg-rename-form data-enter-save><input class="stg-input" data-stg-rename-input maxlength="${STAGE_NAME_LIMIT}" value="${esc(ui.draft)}" aria-label="새 이름" autocomplete="off"><button type="submit" class="stg-link" data-enter-save-submit${busy}>저장</button><button type="button" class="stg-link" data-stg-cancel>취소</button></form>`;
  } else if (mine && ui.mode === 'confirm') {
    const names = ui.orgNames || [];
    const lead = names.length ? `${esc(orgsAtStageText(names))} 지우면 ‘${esc(state.stages.find(x => x.is_default)?.name)}’ 단계로 옮겨요.` : `‘${name}’ 단계를 지울까요?`;
    extra = `<div class="stg-sub stg-confirm" role="group" aria-label="지우기 확인"><span>${lead}</span><button type="button" class="stg-link danger" data-stg-delete-yes${busy}>지우기</button><button type="button" class="stg-link" data-stg-cancel>취소</button></div>`;
  }
  return `<li class="stg-row" data-stg-row="${esc(s.id)}"><div class="stg-line"><button type="button" class="stg-grip" data-stg-grip aria-label="${name} 순서 바꾸기(끌거나 위·아래 화살표)">⋮⋮</button><span class="stg-name">${name}</span>${flags}<button type="button" class="stg-more" data-stg-more aria-label="${name} 더보기" aria-expanded="${mine && !!ui.mode}">⋯</button></div>${extra}</li>`;
}

function paintManager() {
  const body = document.querySelector('#soStageBody'); if (!mgr || !body) return;
  const state = peekDisputeState();
  if (!state) { body.innerHTML = '<p class="stg-note" role="status">불러오는 중…</p>'; return; }
  if (state.status === 'preparing') { body.innerHTML = '<p class="stg-note" data-stage-preparing>쟁의 단계는 준비 중이에요.</p>'; return; }
  if (state.status === 'error') { body.innerHTML = '<p class="stg-note" role="alert">단계를 불러오지 못했어요.</p><button type="button" class="stg-link" data-stg-reload>다시 시도</button>'; return; }
  const stages = sortStages(state.stages), busy = mgr.busy ? ' disabled' : '';
  const add = mgr.adding
    ? `<form class="stg-add" data-stg-add-form data-enter-save><input class="stg-input" data-stg-add-input maxlength="${STAGE_NAME_LIMIT}" value="${esc(mgr.addDraft)}" placeholder="새 단계 이름" aria-label="새 단계 이름" autocomplete="off"><button type="submit" class="stg-link" data-enter-save-submit${busy}>추가</button><button type="button" class="stg-link" data-stg-add-cancel>취소</button></form>`
    : `<button type="button" class="stg-add-btn" data-stg-add${busy}>+ 단계</button>`;
  body.innerHTML = `<ul class="stg-list">${stages.map(s => rowHtml(s, state)).join('')}</ul>${add}<p class="stg-msg${mgr.msg.error ? ' error' : ''}" data-stg-msg role="${mgr.msg.error ? 'alert' : 'status'}">${esc(mgr.msg.text)}</p>`;
}
const say = (text, error = false) => { if (mgr) mgr.msg = {text, error}; };
const focusSel = sel => queueMicrotask(() => document.querySelector('#soStageBody ' + sel)?.focus({preventScroll: true}));

async function run(action, ok, focusAfter) {
  if (!mgr || mgr.busy) return;
  const mine = mgr; mine.busy = true; say('저장하는 중…'); paintManager();
  try { const result = await action(); if (mgr !== mine) return; mine.busy = false; say(typeof ok === 'function' ? ok(result) : ok); }
  catch (e) { if (mgr !== mine) return; mine.busy = false; say(errText(e) || '저장하지 못했어요.', true); }
  paintManager(); if (focusAfter) focusSel(focusAfter);
}

function stagesNow() { return sortStages(peekDisputeState()?.stages ?? []); }
const rowId = el => el.closest('[data-stg-row]')?.dataset.stgRow;

async function confirmDelete(move) {
  const {workspaceId, rt} = mgr, id = mgr.ui.id;
  const result = await deleteStage({rt, workspaceId, id, move});
  if (result?.ok) { mgr.ui = {id: null, mode: null, draft: ''}; return result; }
  if (result?.error === 'ORGS_AT_STAGE') {
    // 그 사이 조직이 그 단계로 옮겨 왔다: 알림을 다시 보여 주고 한 번 더 확인받는다.
    const names = mgr.orgNames(); mgr.ui = {id, mode: 'confirm', draft: '', orgNames: (result.organization_ids || []).map(x => names.get(x) || '다른 조직')};
    throw new Error('지금 이 단계에 조직이 있어요. 아래 알림을 확인해 주세요.');
  }
  mgr.ui = {id: null, mode: null, draft: ''};
  throw new Error(result?.error === 'DEFAULT_STAGE' ? '기본 단계는 지울 수 없어요.' : result?.error === 'NO_DEFAULT_STAGE' ? '기본 단계가 없어요.' : '지우지 못했어요.');
}

function onManagerClick(e) {
  if (!mgr) return;
  const state = peekDisputeState(), id = rowId(e.target), stage = id && stagesNow().find(s => s.id === id);
  const t = el => e.target.closest(el);
  if (t('[data-stg-reload]')) { void loadDisputeState({rt: mgr.rt, workspaceId: mgr.workspaceId, force: true}).then(paintManager); return; }
  if (t('[data-stg-more]') && stage) { mgr.ui = mgr.ui.id === id && mgr.ui.mode ? {id: null, mode: null, draft: ''} : {id, mode: 'menu', draft: stage.name}; say(''); paintManager(); focusSel(`[data-stg-row="${CSS.escape(id)}"] [data-stg-more]`); return; }
  if (t('[data-stg-cancel]')) { mgr.ui = {id: null, mode: null, draft: ''}; say(''); paintManager(); return; }
  if (t('[data-stg-rename]') && stage) { mgr.ui = {id, mode: 'rename', draft: stage.name}; paintManager(); focusSel('[data-stg-rename-input]'); return; }
  if (t('[data-stg-delete]') && stage) { mgr.ui = {id, mode: 'confirm', draft: '', orgNames: orgsAt(id, state)}; say(''); paintManager(); focusSel('[data-stg-delete-yes]'); return; }
  if (t('[data-stg-delete-yes]') && stage) { const move = (mgr.ui.orgNames || []).length > 0; void run(() => confirmDelete(move), r => r.moved ? `지웠어요. 조직 ${r.moved}곳은 기본 단계로 옮겼어요.` : '지웠어요.', '[data-stg-add]'); return; }
  const flag = t('[data-stg-flag]');
  if (flag && stage && !stage.is_default) {
    const which = flag.dataset.stgFlag, on = !(which === 'struggle' ? stage.is_struggle : stage.is_ending);
    mgr.ui = {id: null, mode: null, draft: ''};
    void run(() => setStageFlag({rt: mgr.rt, workspaceId: mgr.workspaceId, id, flag: which, on}), '', `[data-stg-row="${CSS.escape(id)}"] [data-stg-more]`); return;
  }
  if (t('[data-stg-add]')) { mgr.adding = true; mgr.addDraft = ''; say(''); paintManager(); focusSel('[data-stg-add-input]'); return; }
  if (t('[data-stg-add-cancel]')) { mgr.adding = false; say(''); paintManager(); focusSel('[data-stg-add]'); }
}
function onManagerSubmit(e) {
  if (!mgr) return; e.preventDefault();
  if (e.target.matches('[data-stg-add-form]')) {
    const name = e.target.querySelector('[data-stg-add-input]').value; mgr.addDraft = name;
    const problem = stageNameProblem(name, stagesNow());
    if (problem) { say(problem, true); paintManager(); focusSel('[data-stg-add-input]'); return; }
    mgr.adding = false;
    void run(() => addStage({rt: mgr.rt, workspaceId: mgr.workspaceId, name, stages: stagesNow()}), `‘${name.trim()}’ 단계를 추가했어요.`, '[data-stg-add]');
  } else if (e.target.matches('[data-stg-rename-form]')) {
    const id = mgr.ui.id, name = e.target.querySelector('[data-stg-rename-input]').value; mgr.ui.draft = name;
    const problem = stageNameProblem(name, stagesNow(), id);
    if (problem) { say(problem, true); paintManager(); focusSel('[data-stg-rename-input]'); return; }
    mgr.ui = {id: null, mode: null, draft: ''};
    void run(() => renameStage({rt: mgr.rt, workspaceId: mgr.workspaceId, id, name, stages: stagesNow()}), '이름을 바꿨어요. 지난 이력의 글자는 그때 이름 그대로 남아요.', `[data-stg-row="${CSS.escape(id)}"] [data-stg-more]`);
  }
}

// 순서: 끌기(손가락·마우스)와 위·아래 화살표. 끝나면 바뀐 줄의 순서 값만 저장한다.
let drag = null;
function commitOrder(id, toIndex, focus = true) {
  const changes = reorderChanges(stagesNow(), id, toIndex);
  if (!changes.length) { paintManager(); if (focus) focusSel(`[data-stg-row="${CSS.escape(id)}"] [data-stg-grip]`); return; }
  void run(() => reorderStages({rt: mgr.rt, workspaceId: mgr.workspaceId, changes}), '순서를 바꿨어요.', `[data-stg-row="${CSS.escape(id)}"] [data-stg-grip]`);
}
function onGripDown(e) {
  const grip = e.target.closest('[data-stg-grip]'); if (!grip || !mgr || mgr.busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const li = grip.closest('[data-stg-row]'), list = li.parentElement;
  drag = {id: li.dataset.stgRow, li, list, pointer: e.pointerId, grip}; li.classList.add('dragging');
  grip.setPointerCapture?.(e.pointerId); e.preventDefault();
}
function onGripMove(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const rows = [...drag.list.children].filter(x => x !== drag.li);
  const after = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
  if (after) { if (drag.li.nextElementSibling !== after) drag.list.insertBefore(drag.li, after); } else drag.list.append(drag.li);
}
function onGripUp(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const {id, li, list, grip} = drag; drag = null; li.classList.remove('dragging'); grip.releasePointerCapture?.(e.pointerId);
  commitOrder(id, [...list.children].indexOf(li));
}
function onManagerKey(e) {
  const grip = e.target.closest?.('[data-stg-grip]');
  if (grip && mgr && !mgr.busy && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault(); const id = rowId(grip), list = stagesNow(), at = list.findIndex(s => s.id === id);
    commitOrder(id, at + (e.key === 'ArrowUp' ? -1 : 1));
  }
}
document.addEventListener('click', e => { if (e.target.closest(`#${MODAL}`)) onManagerClick(e); });
document.addEventListener('submit', e => { if (e.target.closest(`#${MODAL}`)) onManagerSubmit(e); });
document.addEventListener('keydown', e => { if (e.target.closest?.(`#${MODAL}`)) onManagerKey(e); });
document.addEventListener('pointerdown', e => { if (e.target.closest?.(`#${MODAL}`)) onGripDown(e); });
document.addEventListener('pointermove', e => { if (drag) onGripMove(e); });
document.addEventListener('pointerup', e => { if (drag) onGripUp(e); });
document.addEventListener('pointercancel', () => { if (drag) { drag.li.classList.remove('dragging'); drag = null; paintManager(); } });
document.addEventListener('input', e => {
  if (!mgr) return;
  if (e.target.matches?.('[data-stg-add-input]')) mgr.addDraft = e.target.value;
  else if (e.target.matches?.('[data-stg-rename-input]')) mgr.ui.draft = e.target.value;
});
window.addEventListener('kptu:dispute-stages-changed', () => { if (mgr && !mgr.busy && !document.querySelector(`#${MODAL} input:focus`)) paintManager(); });
