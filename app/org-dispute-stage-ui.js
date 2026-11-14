import {waitHtml, waitInlineHtml, failHtml} from './wait-state.js';
import {leAddHtml, leRowHtml, leInlineHtml, leMove} from './list-edit.mjs';
import {mountListEdit} from './list-edit.js';
import {askConfirm} from './small-notice.js';
// ORG-쟁의단계 화면: ① 조직 상세의 '쟁의 단계' 한 줄(선택 + 달력 날짜 + 저장, 접힌 단계 이력) ② 쟁의 단계 관리 창.
// 데이터는 org-dispute-stage.js, 판정은 org-dispute-stage-model.mjs 한 곳. 표가 없으면(DB 적용 전) '준비 중' 한 줄만 보인다.
import {seoulDateKey} from './meeting-time.js';
import {loadDisputeState, ensureSeeded, peekDisputeState, saveOrgStage, editHistoryRow, deleteHistoryRow, PERIOD_PENDING, addStage, renameStage, setStageFlag, reorderStages, deleteStage} from './org-dispute-stage.js';
import {stageOfOrg, sortStages, historyLines, reorderChanges, orgsAtStageText, stageNameProblem, periodProblem, STAGE_NAME_LIMIT, DEFAULT_STAGES} from './org-dispute-stage-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const today = () => seoulDateKey(Date.now());
const errText = e => (e && e.message) || String(e || '');

// ───────────── ① 조직 상세의 쟁의 단계 한 줄 ─────────────
// 저장 줄: [단계 ▾] [날짜] [~ 끝 날짜](선택, 누르면 달력 칸) [저장]. 접힌 '단계 이력'의 줄마다 ⋯ → [고치기](단계·날짜·끝 날짜)·[지우기](한 번 더 확인).
let line = null; // {host, orgId, orgName, workspaceId, canEdit, rt, draft:{stageId,date,end,endOpen,dateTouched}, hist:{id,mode,draft}, histOpen, busy, msg:{text,error}, run}
const NO_HIST = {id: null, mode: null, draft: null};

export function paintStageLine(opts) {
  const same = line && line.host === opts.host && line.orgId === opts.orgId;
  line = {draft: null, hist: NO_HIST, histOpen: false, busy: false, msg: {text: '', error: false}, ...(same ? {draft: line.draft, msg: line.msg, hist: line.hist, histOpen: line.histOpen} : {}), ...opts, run: (line?.run || 0) + 1};
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
  if (!state) { host.innerHTML = '<span class="wd-stage-k">쟁의 단계</span><span class="wd-stage-note">' + waitInlineHtml() + '</span>'; return; }
  if (state.status === 'preparing') { host.innerHTML = '<span class="wd-stage-k">쟁의 단계</span><span class="wd-stage-note" data-stage-preparing>준비 중</span>'; return; }
  if (state.status === 'error') { host.innerHTML = '<span class="wd-stage-k">쟁의 단계</span><span class="wd-stage-note" role="alert">불러오지 못했어요</span><button type="button" class="secondary wd-stage-btn" data-stage-retry>다시 시도</button>'; return; }
  const stages = lineStages(state), cur = stageOfOrg(orgId, state.histories, stages);
  const draft = line.draft, stageId = draft?.stageId ?? cur.stage?.id ?? '', date = draft?.date ?? cur.date;
  const end = draft ? draft.end ?? '' : cur.end, endOpen = !!(draft?.endOpen || end);
  const rows = state.histories.get(orgId) ?? [], hist = historyLines(rows, 20);
  const options = (picked, list = stages) => list.map(s => `<option value="${esc(s.id)}"${s.id === picked ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  const endControl = endOpen
    ? `<span class="wd-stage-tilde" aria-hidden="true">~</span><input class="wd-stage-date" type="date" data-stage-end value="${esc(end)}" min="${esc(date)}" aria-label="끝 날짜(선택, 비우면 하루)">`
    : '<button type="button" class="row-act wd-stage-end-btn" data-stage-end-open aria-label="끝 날짜 넣기(선택)">~ 끝 날짜</button>';
  const controls = canEdit
    ? `<select class="wd-stage-select" data-stage-select aria-label="쟁의 단계">${options(stageId)}</select><input class="wd-stage-date" type="date" data-stage-date value="${esc(date)}" aria-label="단계 날짜">${endControl}<button type="button" class="row-act wl-btn is-main wd-stage-save" data-stage-save disabled hidden>저장</button>`
    : `<span class="wd-stage-now">${esc(cur.name)}${cur.date ? ` · ${esc(cur.date)}${cur.end && cur.end !== cur.date ? ` ~ ${esc(cur.end)}` : ''}` : ''}</span>`;
  host.innerHTML = `<span class="wd-stage-k">쟁의 단계</span>${controls}<span class="wd-stage-msg${line.msg.error ? ' error' : ''}" data-stage-msg role="${line.msg.error ? 'alert' : 'status'}">${esc(line.msg.text)}</span>`
    + (hist.length ? `<details class="wd-stage-hist" data-stage-hist${line.histOpen ? ' open' : ''}><summary>단계 이력 ${hist.length}</summary>${hist.map(h => histRowHtml(h, stages, canEdit)).join('')}</details>` : '');
  updateSave();
}

// 이력 한 줄: '11.3 ~ 11.5 파업 찬반투표' + ⋯. 고르면 그 줄 아래에 [고치기]·[지우기] → 고치기 칸 또는 지우기 확인.
function histRowHtml(h, stages, canEdit) {
  const ui = line.hist, mine = ui.id === h.id, busy = line.busy ? ' disabled' : '';
  const label = `${h.date} ${h.name}`;
  const more = canEdit ? `<button type="button" class="icon-btn wd-stage-hmore" data-stage-hmore aria-label="${esc(label)} 메뉴" aria-expanded="${mine && !!ui.mode}"><span class="more-dots" aria-hidden="true">⋯</span></button>` : '';
  let extra = '';
  if (mine && ui.mode === 'menu') {
    extra = `<div class="wd-stage-hsub"><button type="button" class="stg-link" data-stage-hedit${busy}>수정</button><button type="button" class="stg-link danger" data-stage-hdel${busy}>삭제</button></div>`;
  } else if (mine && ui.mode === 'edit') {
    const d = ui.draft, list = stages.some(s => s.id === d.stageId) ? stages : [{id: d.stageId ?? '', name: h.name}, ...stages];
    const opts = list.map(s => `<option value="${esc(s.id)}"${s.id === d.stageId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    extra = `<form class="wd-stage-hsub wd-stage-hform" data-stage-hform novalidate><select class="wd-stage-select" data-stage-hselect aria-label="수정할 단계">${opts}</select><input class="wd-stage-date" type="date" data-stage-hdate value="${esc(d.start)}" aria-label="수정할 날짜" required><span class="wd-stage-tilde" aria-hidden="true">~</span><input class="wd-stage-date" type="date" data-stage-hend value="${esc(d.end)}" min="${esc(d.start)}" aria-label="수정할 끝 날짜(선택, 비우면 하루)"><span class="wl-btns btn-row"><button type="button" class="row-act wl-btn" data-stage-hcancel>취소</button><button type="submit" class="row-act wl-btn is-main"${busy}>저장</button></span></form>`;
  } else if (mine && ui.mode === 'confirm') {
    extra = `<div class="wd-stage-hsub stg-confirm" role="group" aria-label="이력 삭제 확인"><span>이 줄을 삭제할까요? 지금 단계는 남은 이력의 가장 나중 줄로 돌아가요.</span><span class="wl-btns btn-row"><button type="button" class="stg-link danger" data-stage-hdel-yes${busy}>삭제</button><button type="button" class="stg-link" data-stage-hcancel>취소</button></span></div>`;
  }
  return `<div class="wd-stage-hrow" data-stage-hrow="${esc(h.id)}"><div class="wd-stage-hline"><span class="wd-stage-htext">${esc(label)}</span>${more}</div>${extra}</div>`;
}

function updateSave() {
  if (!line) return;
  const state = peekDisputeState(); if (!state || state.status !== 'ready') return;
  const btn = line.host.querySelector('[data-stage-save]'); if (!btn) return;
  const cur = stageOfOrg(line.orgId, state.histories, lineStages(state));
  const select = line.host.querySelector('[data-stage-select]'), date = line.host.querySelector('[data-stage-date]'), end = line.host.querySelector('[data-stage-end]');
  const changed = select.value !== (cur.stage?.id ?? '') || date.value !== cur.date || (end?.value ?? cur.end) !== cur.end;
  // UI-화면정리 B ⑧: 담당조직 상세의 [저장]은 한 화면에 하나 — 단계 줄 [저장]은 바꾼 것이 있을 때만 그 줄에 나온다(꺼진 [저장]이 폰에서 혼자 둘째 줄을 차지하지 않게).
  btn.hidden = !changed && !line.busy;
  btn.disabled = line.busy || !changed || !date.value;
}

async function saveLine() {
  if (!line || line.busy) return;
  let state = peekDisputeState(); const host = line.host, mine = line;
  const picked = host.querySelector('[data-stage-select]').value, date = host.querySelector('[data-stage-date]').value, end = host.querySelector('[data-stage-end]')?.value || '';
  if (!state || !picked || !date) return;
  const problem = periodProblem(date, end);
  if (problem) { setMsg(problem, true); return; }
  line.busy = true; host.querySelector('[data-stage-save]').disabled = true;
  setMsg('저장하는 중…');
  try {
    if (picked.startsWith('seed:')) state = await ensureSeeded({rt: line.rt, workspaceId: line.workspaceId});
    const stage = picked.startsWith('seed:') ? state.stages.find(s => s.name === picked.slice(5)) : state.stages.find(s => s.id === picked);
    if (!stage) throw new Error('단계를 찾지 못했어요.');
    await saveOrgStage({rt: line.rt, workspaceId: line.workspaceId, orgId: line.orgId, stage, date, end, history: state.histories.get(line.orgId) ?? [], periodReady: state.periodReady !== false});
    if (line === mine) { line.draft = null; line.busy = false; line.msg = {text: '저장했어요.', error: false}; paintLine(); }
  } catch (e) {
    if (line === mine) { line.busy = false; line.msg = {text: `저장하지 못했어요. ${errText(e)}`, error: true}; paintLine(); }
  }
}
function setMsg(text, error = false) {
  if (!line) return; line.msg = {text, error};
  const el = line.host.querySelector('[data-stage-msg]'); if (el) { el.textContent = text; el.className = 'wd-stage-msg' + (error ? ' error' : ''); }
}

// 이력 고치기·지우기: 서버 저장 뒤 다시 읽어 그린다. 실패하면 그 줄의 칸을 그대로 두고 메시지만.
async function runHist(action, ok) {
  if (!line || line.busy) return;
  const mine = line; mine.busy = true; setMsg('저장하는 중…'); paintLine();
  try { await action(); if (line !== mine) return; mine.busy = false; mine.hist = NO_HIST; mine.msg = {text: ok, error: false}; }
  catch (e) { if (line !== mine) return; mine.busy = false; mine.msg = {text: errText(e) || '저장하지 못했어요.', error: true}; }
  paintLine();
  queueMicrotask(() => { if (line === mine) (mine.host.querySelector('[data-stage-hist] summary'))?.focus({preventScroll: true}); });
}
const histFocus = sel => queueMicrotask(() => line?.host.querySelector(sel)?.focus({preventScroll: true}));
function onHistClick(e, host) {
  const row = e.target.closest('[data-stage-hrow]'), id = row?.dataset.stageHrow, t = sel => e.target.closest(sel);
  if (!row || !line?.canEdit) return false;
  const state = peekDisputeState(); if (!state || state.status !== 'ready') return true;
  const h = (state.histories.get(line.orgId) ?? []).find(r => r.id === id); if (!h) return true;
  const sel = `[data-stage-hrow="${CSS.escape(id)}"]`;
  if (t('[data-stage-hmore]')) { line.hist = line.hist.id === id && line.hist.mode ? NO_HIST : {id, mode: 'menu', draft: null}; setMsg(''); paintLine(); histFocus(`${sel} [data-stage-hmore]`); return true; }
  if (t('[data-stage-hcancel]')) { line.hist = NO_HIST; setMsg(''); paintLine(); histFocus(`${sel} [data-stage-hmore]`); return true; }
  if (t('[data-stage-hedit]')) {
    if (state.periodReady === false) { line.hist = NO_HIST; line.msg = {text: PERIOD_PENDING, error: true}; paintLine(); return true; }
    line.hist = {id, mode: 'edit', draft: {stageId: h.stage_id, start: h.stage_date, end: h.end_date || ''}}; setMsg(''); paintLine(); histFocus(`${sel} [data-stage-hselect]`); return true;
  }
  if (t('[data-stage-hdel]')) { line.hist = {id, mode: 'confirm', draft: null}; setMsg(''); paintLine(); histFocus(`${sel} [data-stage-hdel-yes]`); return true; }
  if (t('[data-stage-hdel-yes]')) { void runHist(() => deleteHistoryRow({rt: line.rt, workspaceId: line.workspaceId, id}), '이력 한 줄을 삭제했어요.'); return true; }
  return !!t('.wd-stage-hsub');
}
function onHistSubmit(e) {
  const form = e.target.closest('[data-stage-hform]'); if (!form || !line) return;
  e.preventDefault();
  const state = peekDisputeState(); if (!state || state.status !== 'ready') return;
  const id = form.closest('[data-stage-hrow]').dataset.stageHrow;
  const stageId = form.querySelector('[data-stage-hselect]').value, date = form.querySelector('[data-stage-hdate]').value, end = form.querySelector('[data-stage-hend]').value;
  line.hist = {id, mode: 'edit', draft: {stageId, start: date, end}};
  const stage = state.stages.find(s => s.id === stageId);
  if (!stage) { setMsg('지금 단계 목록에 있는 단계를 선택해 주세요.', true); return; }
  if (!date) { setMsg('날짜를 확인해 주세요.', true); return; }
  const problem = periodProblem(date, end);
  if (problem) { setMsg(problem, true); form.querySelector('[data-stage-hend]').focus(); return; }
  void runHist(() => editHistoryRow({rt: line.rt, workspaceId: line.workspaceId, id, stage, date, end, periodReady: state.periodReady !== false}), '이력을 수정했어요.');
}

function bindLine(host) {
  if (host.dataset.stageBound) return; host.dataset.stageBound = '1';
  host.addEventListener('submit', onHistSubmit);
  host.addEventListener('toggle', e => { if (line && e.target.matches?.('[data-stage-hist]')) line.histOpen = e.target.open; }, true);
  host.addEventListener('input', e => {
    if (!line || !e.target.closest('[data-stage-hform]')) return;
    const form = e.target.closest('[data-stage-hform]');
    line.hist = {...line.hist, draft: {stageId: form.querySelector('[data-stage-hselect]').value, start: form.querySelector('[data-stage-hdate]').value, end: form.querySelector('[data-stage-hend]').value}};
    if (e.target.matches('[data-stage-hdate]')) form.querySelector('[data-stage-hend]').min = e.target.value;
  });
  host.addEventListener('change', e => {
    if (!line || e.target.closest('[data-stage-hform]')) return;
    const select = e.target.closest('[data-stage-select]'), date = e.target.closest('[data-stage-date]');
    const state = peekDisputeState(); if (!state) return;
    const cur = stageOfOrg(line.orgId, state.histories, lineStages(state));
    if (select) {
      const input = host.querySelector('[data-stage-date]');
      // 다른 단계를 고르면 날짜는 오늘로(직접 고친 날짜가 없을 때). 원래 단계로 돌아오면 원래 날짜.
      if (select.value !== (cur.stage?.id ?? '')) { if (!line.draft?.dateTouched) input.value = today(); } else if (!line.draft?.dateTouched) input.value = cur.date;
    }
    const endInput = host.querySelector('[data-stage-end]');
    if (endInput) endInput.min = host.querySelector('[data-stage-date]').value;
    line.draft = {stageId: host.querySelector('[data-stage-select]').value, date: host.querySelector('[data-stage-date]').value, end: endInput?.value ?? line.draft?.end ?? cur.end, endOpen: !!endInput, dateTouched: !!date || !!line.draft?.dateTouched};
    setMsg(''); updateSave();
  });
  host.addEventListener('click', e => {
    if (onHistClick(e, host)) return;
    if (e.target.closest('[data-stage-end-open]') && line) {
      const state = peekDisputeState(), cur = state?.status === 'ready' ? stageOfOrg(line.orgId, state.histories, lineStages(state)) : null;
      line.draft = {stageId: host.querySelector('[data-stage-select]')?.value ?? cur?.stage?.id ?? '', date: host.querySelector('[data-stage-date]')?.value ?? cur?.date ?? '', end: line.draft?.end ?? '', endOpen: true, dateTouched: !!line.draft?.dateTouched};
      paintLine(); histFocus('[data-stage-end]'); return;
    }
    if (e.target.closest('[data-stage-save]')) void saveLine();
    else if (e.target.closest('[data-stage-retry]') && line) { const mine = line; void loadDisputeState({rt: line.rt, workspaceId: line.workspaceId, force: true}).then(() => { if (line === mine) paintLine(); }); }
  });
}
window.addEventListener('kptu:dispute-stages-changed', () => { if (line && !line.busy && !line.host.contains(document.activeElement)) paintLine(); });

// ───────────── ② 쟁의 단계 관리 창 ─────────────
// S51-28 LIB-화면정리 ②(같은 종류 전수): 공용 '목록 고치기' 모양(list-edit.mjs·list-edit.js, 자료실 분류 고치기와 같음) —
// 맨 위 '새 단계 이름 [추가]', 줄 = ⠿ · 이름(누르면 그 자리 고침) · 꼬리표(기본·투쟁 중·끝남) · ⋯([이름 바꾸기]·[투쟁 중 켜기/끄기]·[끝남 켜기/끄기]·[지우기]).
// 지우기는 빨강 없이 한 번 묻기. ⠿ 끌기·키보드 위아래는 공용 reorder-drag.js. 기본 단계는 맨 앞 고정(끌기·지우기 없음).
let mgr = null; // {workspaceId, rt, orgNames, ui:{id,mode,draft}, addDraft, busy, msg}
const MODAL = 'soStageModal';
function installModal() {
  if (document.querySelector('#' + MODAL)) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="${MODAL}" class="modal le-modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soStageHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soStageHeading">쟁의 단계 관리<span class="le-count" data-le-count></span></h2></div><button class="icon-btn" data-so-close="${MODAL}" type="button" aria-label="닫기">×</button></div><div id="soStageBody" class="stg"></div></div></div>`);
  const body = document.querySelector('#soStageBody');
  mountListEdit(body, {key: 'stg', label: '쟁의 단계 수정', items: menuItems, onAct: onMenuAct,
    onMove: (id, index) => commitOrder(id, dragIndex(id, index)), onStep: (id, dir) => { const at = stagesNow().findIndex(x => x.id === id); commitOrder(id, Math.max(fixedCount(), at + dir)); },
    canDrag: id => !!mgr && !mgr.busy && !stagesNow().find(x => x.id === id)?.is_default});
}
export function openStageManager({workspaceId, rt = window.KPTURuntime, orgNames = () => new Map(), trigger = document.activeElement} = {}) {
  installModal();
  mgr = {workspaceId, rt, orgNames, ui: {id: null, mode: null, draft: ''}, addDraft: '', busy: false, msg: {text: '', error: false}};
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

function stageTags(s) {
  if (s.is_default) return '<span class="le-tag">기본</span>';
  return (s.is_struggle ? '<span class="le-tag" data-stg-tag="struggle">투쟁 중</span>' : '') + (s.is_ending ? '<span class="le-tag" data-stg-tag="ending">끝남</span>' : '');
}
function rowHtml(s) {
  const ui = mgr.ui, busy = mgr.busy;
  if (ui.id === s.id && ui.mode === 'rename') return leInlineHtml({id: s.id, label: `‘${s.name}’의 새 이름`, value: ui.draft, limit: STAGE_NAME_LIMIT, disabled: busy, formAttrs: {'data-stg-rename-form': true}, inputAttrs: {'data-stg-rename-input': true}});
  return leRowHtml({id: s.id, label: s.name, drag: !s.is_default, disabled: busy, extra: stageTags(s), rowAttrs: {'data-stg-row': s.id}});
}
function menuItems(id) {
  const s = stagesNow().find(x => x.id === id); if (!s) return [];
  if (s.is_default) return [{key: 'rename', label: '이름 바꾸기'}];
  return [{key: 'rename', label: '이름 바꾸기'}, {key: 'struggle', label: `투쟁 중 ${s.is_struggle ? '끄기' : '켜기'}`}, {key: 'ending', label: `끝남 ${s.is_ending ? '끄기' : '켜기'}`}, {key: 'delete', label: '삭제'}];
}

function paintManager() {
  const body = document.querySelector('#soStageBody'); if (!mgr || !body) return;
  const state = peekDisputeState(), count = document.querySelector(`#${MODAL} [data-le-count]`);
  if (count) count.textContent = state?.status === 'ready' ? `${state.stages.length}개` : '';
  if (!state) { body.innerHTML = waitHtml({rows:3}); return; }
  if (state.status === 'preparing') { body.innerHTML = '<p class="stg-note" data-stage-preparing>쟁의 단계는 준비 중이에요.</p>'; return; }
  if (state.status === 'error') { body.innerHTML = failHtml({retry: 'data-stg-reload'}); return; }
  const stages = sortStages(state.stages);
  body.innerHTML = leAddHtml({name: '새 단계 이름', value: mgr.addDraft, limit: STAGE_NAME_LIMIT, disabled: mgr.busy, formAttrs: {'data-stg-add-form': true}, inputAttrs: {'data-stg-add-input': true}})
    + `<ul class="le-list stg-list" data-reorder-list="stages">${stages.map(rowHtml).join('')}</ul><p class="le-status stg-msg${mgr.msg.error ? ' error' : ''}" data-stg-msg role="${mgr.msg.error ? 'alert' : 'status'}">${esc(mgr.msg.text)}</p>`;
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

async function confirmDelete(id, move) {
  const {workspaceId, rt} = mgr;
  const result = await deleteStage({rt, workspaceId, id, move});
  if (result?.ok) return result;
  // 그 사이 조직이 그 단계로 옮겨 왔다: 지우지 않고, 다시 [지우기]를 누르면 조직 이름과 함께 한 번 더 묻는다.
  if (result?.error === 'ORGS_AT_STAGE') throw new Error('지금 이 단계에 조직이 있어요. 다시 삭제를 누르면 옮길 조직을 보여 드려요.');
  throw new Error(result?.error === 'DEFAULT_STAGE' ? '기본 단계는 삭제할 수 없어요.' : result?.error === 'NO_DEFAULT_STAGE' ? '기본 단계가 없어요.' : '삭제하지 못했어요.');
}
const moreSel = id => `[data-le-menu="${CSS.escape(id)}"]`;
async function askDelete(id) {
  const state = peekDisputeState(), stage = stagesNow().find(x => x.id === id); if (!stage || stage.is_default) return;
  const names = orgsAt(id, state), base = state.stages.find(x => x.is_default)?.name;
  const text = names.length ? `${orgsAtStageText(names)} 삭제하면 ‘${base}’ 단계로 옮겨요.` : `‘${stage.name}’ 단계를 삭제할까요?`;
  const yes = await askConfirm(document.querySelector(`#soStageBody ${moreSel(id)}`) || document.querySelector('#soStageBody'), {text, ok: '삭제'});
  if (!yes || !mgr) return;
  void run(() => confirmDelete(id, names.length > 0), r => r.moved ? `삭제했어요. 조직 ${r.moved}곳은 기본 단계로 옮겼어요.` : '삭제했어요.', '[data-stg-add-input]');
}
function onMenuAct(id, act) {
  if (!mgr || mgr.busy) return;
  const stage = stagesNow().find(x => x.id === id); if (!stage) return;
  if (act === 'rename') { mgr.ui = {id, mode: 'rename', draft: stage.name}; say(''); paintManager(); focusSel('[data-stg-rename-input]'); return; }
  if (act === 'delete') { void askDelete(id); return; }
  if ((act === 'struggle' || act === 'ending') && !stage.is_default) {
    const on = !(act === 'struggle' ? stage.is_struggle : stage.is_ending);
    void run(() => setStageFlag({rt: mgr.rt, workspaceId: mgr.workspaceId, id, flag: act, on}), '', moreSel(id));
  }
}
function onManagerClick(e) {
  if (!mgr) return;
  const t = el => e.target.closest(el);
  if (t('[data-stg-reload]')) { void loadDisputeState({rt: mgr.rt, workspaceId: mgr.workspaceId, force: true}).then(paintManager); return; }
  const name = t('[data-le-rename]');
  if (name && !name.disabled) { const stage = stagesNow().find(x => x.id === name.dataset.leRename); if (stage) { mgr.ui = {id: stage.id, mode: 'rename', draft: stage.name}; say(''); paintManager(); focusSel('[data-stg-rename-input]'); } }
}
function onManagerSubmit(e) {
  if (!mgr) return; e.preventDefault();
  if (e.target.matches('[data-stg-add-form]')) {
    const name = e.target.querySelector('[data-stg-add-input]').value; mgr.addDraft = name;
    const problem = stageNameProblem(name, stagesNow());
    if (problem) { say(problem, true); paintManager(); focusSel('[data-stg-add-input]'); return; }
    mgr.addDraft = '';
    void run(() => addStage({rt: mgr.rt, workspaceId: mgr.workspaceId, name, stages: stagesNow()}), `‘${name.trim()}’ 단계를 추가했어요.`, '[data-stg-add-input]');
  } else if (e.target.matches('[data-stg-rename-form]')) {
    const id = mgr.ui.id, name = e.target.querySelector('[data-stg-rename-input]').value; mgr.ui.draft = name;
    if (name.trim() === stagesNow().find(x => x.id === id)?.name) { mgr.ui = {id: null, mode: null, draft: ''}; paintManager(); focusSel(`[data-le-rename="${CSS.escape(id)}"]`); return; }
    const problem = stageNameProblem(name, stagesNow(), id);
    if (problem) { say(problem, true); paintManager(); focusSel('[data-stg-rename-input]'); return; }
    mgr.ui = {id: null, mode: null, draft: ''};
    void run(() => renameStage({rt: mgr.rt, workspaceId: mgr.workspaceId, id, name, stages: stagesNow()}), '이름을 바꿨어요. 지난 이력의 글자는 그때 이름 그대로 남아요.', `[data-le-rename="${CSS.escape(id)}"]`);
  }
}
// 순서: 끌기(손가락·마우스, 공용 reorder-drag.js)와 위·아래 화살표. 끝나면 바뀐 줄의 순서 값만 저장한다.
// 끌기 자리(index)는 끌 수 있는 줄(기본 단계 뺌) 사이 자리라, 기본 단계를 앞에 둔 전체 목록의 자리로 바꾼다. 기본 단계 앞으로는 가지 않는다.
const fixedCount = () => stagesNow().filter(x => x.is_default).length;
function dragIndex(id, index) {
  const list = stagesNow(), fixed = list.filter(x => x.is_default).map(x => x.id), moved = leMove(list.filter(x => !x.is_default).map(x => x.id), id, index);
  return [...fixed, ...moved].indexOf(id);
}
function commitOrder(id, toIndex) {
  if (!mgr || mgr.busy) return;
  const changes = reorderChanges(stagesNow(), id, toIndex);
  if (!changes.length) { paintManager(); return; }
  void run(() => reorderStages({rt: mgr.rt, workspaceId: mgr.workspaceId, changes}), '순서를 바꿨어요.', `[data-reorder-id="${CSS.escape(id)}"] [data-reorder-handle]`);
}
function onManagerKey(e) {
  if (e.key === 'Escape' && mgr?.ui.mode === 'rename' && e.target.matches?.('[data-stg-rename-input]')) { e.preventDefault(); e.stopPropagation(); const id = mgr.ui.id; mgr.ui = {id: null, mode: null, draft: ''}; say(''); paintManager(); focusSel(`[data-le-rename="${CSS.escape(id)}"]`); }
}
document.addEventListener('click', e => { if (e.target.closest(`#${MODAL}`)) onManagerClick(e); });
document.addEventListener('submit', e => { if (e.target.closest(`#${MODAL}`)) onManagerSubmit(e); });
document.addEventListener('keydown', e => { if (e.target.closest?.(`#${MODAL}`)) onManagerKey(e); }, true);
document.addEventListener('input', e => {
  if (!mgr) return;
  if (e.target.matches?.('[data-stg-add-input]')) mgr.addDraft = e.target.value;
  else if (e.target.matches?.('[data-stg-rename-input]')) mgr.ui.draft = e.target.value;
});
window.addEventListener('kptu:dispute-stages-changed', () => { if (mgr && !mgr.busy && !document.querySelector(`#${MODAL} input:focus`)) paintManager(); });
