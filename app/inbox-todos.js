import {waitHtml} from './wait-state.js';
// BASKET-정리함이름: the 정리함's [챙길 것] side (basket.js owns the screen, this module owns what is inside the side).
// One list of the "챙길 것" candidates the server found in the Web2 records (todo-radar-data.js, table app_todo_candidates, the
// owner's own rows only). Chips narrow it: 처리 전 / 할 일로 보냄 / 무시함. Each open row has the source on the left (a small button that
// opens the record) and two small buttons on the right: [할 일로] (one Google task through the existing create path, then the row is
// marked) and [무시]. The counts the screen shows count the open rows only (decision 5: what is already a task by title is left out).
// INBOX-상대약속: under the open rows, the counterpart promises the radar's last finding returned (todo-radar.js radarPromises, the same data
// as the PC home card). Each has [원장으로] (copies the same 쓰기요청 text as the card's [원장으로 복사]). They are never stored and never counted.
// The home card and the work journal box (todo-radar.js) stay as they are; both sides tell each other through the same change
// event ('kptu:todo-radar-changed'). Nothing is kept in browser storage.
import {createAnchoredMenu} from './anchored-menu.js';
import {readInboxCandidates as readAllInbox, dismissCandidate, reopenCandidate, markNotMine, undoNotMine, markTasked, candidateToTask, validateTaskDraft, notPlanned,
  quickDue, dotDay, radarScope, ledgerRequestText, sourceText, RADAR_SOURCE_LABEL} from './todo-radar-data.js';
import {seoulDateKey} from './meeting-time.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {copyText} from './copy-text.js';
import {flashDone} from './press-feedback.js';

const CHANGED = 'kptu:todo-radar-changed';
export const INBOX_CHIPS = Object.freeze([['open', '처리 전'], ['tasked', '할 일로 보냄'], ['dismissed', '무시함']]);
const EMPTY = Object.freeze({open: '챙길 것 없음', tasked: '보낸 것 없음', dismissed: '무시한 것 없음'});
const taskTitles = () => (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);

// MTG-후속할일후보: the same list can sit inside one 사업 보고 window. `read` swaps in the reader for that meeting's rows, `quietEmpty` draws nothing
// when there is nothing to handle, `hideSource` leaves out the source button (the window already is the source), and `withPromises:false` keeps the
// counterpart promises out (they belong to the home/정리함 lists).
// openSource / radarPromises come from todo-radar.js and are handed in by the 정리함 screen (basket.js): this module must not import todo-radar.js,
// whose source button opens the 사업 보고 window, because that window (meeting-round-detail.js) now uses this list (import cycle).
// TODO-내일만 6번: one ⋯ menu (shared anchored menu) for every mounted list; the list that holds the trigger handles the action.
// A list inside an open dialog (사업 보고 상세) keeps the menu inside that dialog.
const menuLists = new Map();
let rowMenu = null;
const listOf = trigger => [...menuLists.keys()].find(h => h.isConnected && h.contains(trigger));
function inboxRowMenu() {
  rowMenu ||= createAnchoredMenu({id:'inboxTodoRowMenu', className:'radar-row-menu', label:'챙길 것 줄 메뉴', historyKey:'kptuInboxTodoRowMenu',
    parent:trigger => trigger.closest('dialog,.modal') || document.body,
    key:trigger => trigger.dataset.inboxTodoMore, canOpen:trigger => !trigger.disabled && !!listOf(trigger),
    render:() => '<button type="button" data-inbox-todo-menu="not-mine">내 일 아님</button>',
    onAction:(button, active) => { const list = listOf(active.trigger); if (list) menuLists.get(list)?.(active.id, button.dataset.inboxTodoMenu); }});
  return rowMenu;
}
export function mountInboxTodos(host, {rt, esc, chips, onCount = () => {}, read, quietEmpty = false, hideSource = false, withPromises = true, openSource = () => {}, radarPromises = () => []}) {
  const readInboxCandidates = read || readAllInbox;
  let rows = [], state = 'loading', chip = 'open', run = 0, scope = radarScope(rt), status = '';
  const copied = new Set(), busy = new Set(), unknown = new Map(), unmarked = new Map(), dues = new Map(), rowStatus = new Map();
  host.hidden = true;

  const openRows = () => notPlanned(rows.filter(r => r.status === 'open'), taskTitles());
  const handledRows = which => rows.filter(r => r.status === which).sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')));
  const shownRows = () => chip === 'open' ? openRows() : handledRows(chip);
  const count = () => state === 'ok' ? openRows().length : null;
  let told;
  const tell = () => { const next = count(); if (next !== told) { told = next; onCount(next); } };

  function paintChips() {
    if (!chips) return;
    for (const button of chips.querySelectorAll('[data-inbox-chip]')) button.setAttribute('aria-pressed', String(button.dataset.inboxChip === chip));
    const number = chips.querySelector('[data-inbox-chip-count]');
    if (number) number.textContent = count() === null ? '' : ' ' + count();
  }
  function doneLabel(c) {
    if (c.status === 'dismissed') return '무시함';
    const task = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).find(t => t?.id === c.task_id);
    const due = c.task_due ? dotDay(c.task_due) : task ? dotDay(task.due || '') : '';
    return due ? `할 일로 보냄 · ${due}` : '할 일로 보냄';
  }
  function rowHtml(c) {
    const id = esc(c.id), isBusy = busy.has(c.id), open = c.status === 'open', source = sourceText(c);
    const meta = [dotDay(c.source_day) + ' 기록', open && c.due ? `제안 기한 ${dotDay(c.due)}` : ''].filter(Boolean).join(' · ');
    let right = '', below = '';
    if (!open) right = `<span class="inbox-todo-done">${esc(doneLabel(c))}</span>`;
    else if (unknown.has(c.id)) below = `<button type="button" class="inbox-todo-btn" data-inbox-todo-tasks>할 일 화면에서 확인</button>`;
    else if (unmarked.has(c.id)) below = `<button type="button" class="inbox-todo-btn" data-inbox-todo-mark="${id}"${isBusy ? ' disabled' : ''}>옮긴 것으로 표시</button>`;
    else {
      const dis = isBusy ? ' disabled' : '';
      right = `<span class="inbox-todo-actions"><button type="button" class="inbox-todo-btn" data-inbox-todo-task="${id}"${dis}>할 일로</button><button type="button" class="inbox-todo-btn" data-inbox-todo-dismiss="${id}"${dis}>무시</button><button type="button" class="inbox-todo-btn inbox-todo-more" data-inbox-todo-more="${id}" aria-label="더 보기" title="더 보기" aria-haspopup="true" aria-expanded="false"${dis}><span class="more-dots" aria-hidden="true">⋯</span></button></span>`;
    }
    const note = rowStatus.get(c.id) ? `<p class="inbox-todo-status" role="status">${esc(rowStatus.get(c.id))}</p>` : '';
    return `<li class="inbox-todo-row" data-inbox-todo-row="${id}" data-inbox-todo-status="${esc(c.status)}"><div class="inbox-todo-line">${hideSource ? '' : `<button type="button" class="inbox-todo-source" data-inbox-todo-source="${id}" aria-label="출처 열기: ${esc(source)}">${esc(source)}</button>`}<div class="inbox-todo-text"><span class="inbox-todo-summary">${esc(c.summary)}</span><span class="inbox-todo-meta">${esc(meta)}</span></div>${right}</div>${note}${below ? `<div class="inbox-todo-below">${below}</div>` : ''}</li>`;
  }
  const promises = () => withPromises && state === 'ok' && chip === 'open' ? radarPromises() : [];
  function promiseHtml(p, i) {
    const meta = [RADAR_SOURCE_LABEL[p.source_kind], p.due ? `기한 ${dotDay(p.due)}` : ''].filter(Boolean).join(' · ');
    const label = copied.has(ledgerRequestText(p)) ? '복사함' : '원장으로';
    return `<li class="inbox-todo-row inbox-todo-promise" data-inbox-promise="${i}"><div class="inbox-todo-line"><span class="inbox-todo-source inbox-todo-tag">상대 약속</span><div class="inbox-todo-text"><span class="inbox-todo-summary">${esc(p.summary)}</span><span class="inbox-todo-meta">${esc(meta)}</span></div><span class="inbox-todo-actions"><button type="button" class="inbox-todo-btn" data-inbox-promise-ledger="${i}">${label}</button></span></div></li>`;
  }
  function paint() {
    tell(); paintChips();
    if (host.hidden) return;
    const focusAttr = host.contains(document.activeElement) ? [...document.activeElement.attributes].find(a => a.name.startsWith('data-inbox-todo-')) : null;
    const list = shownRows();
    let body;
    if (quietEmpty && state !== 'ok') body = '';
    else if (state === 'missing') body = `<p class="inbox-todo-empty">챙길 것 기능이 아직 준비 중이에요.</p>`;
    else if (state === 'failed') body = `<p class="inbox-todo-empty">챙길 것을 불러오지 못했어요. <button type="button" class="inbox-todo-link" data-inbox-todo-retry>다시 시도</button></p>`;
    else if (state === 'loading') body = waitHtml({rows:2});
    else if (!list.length && !promises().length) body = quietEmpty ? '' : `<p class="inbox-todo-empty" data-inbox-todo-empty>${EMPTY[chip]}</p>`;
    else body = `<ul class="inbox-todo-list" aria-label="챙길 것">${list.map(rowHtml).join('')}${promises().map(promiseHtml).join('')}</ul>`;
    host.innerHTML = `${body}<p class="inbox-todo-status" role="status" aria-live="polite" data-inbox-todo-line>${esc(status)}</p>`;
    if (focusAttr) host.querySelector(`[${focusAttr.name}="${CSS.escape(focusAttr.value)}"]`)?.focus({preventScroll: true});
  }

  async function load() {
    scope = radarScope(rt);
    const mine = ++run;
    const result = await readInboxCandidates(rt);
    if (mine !== run || scope !== radarScope(rt)) return;
    if (result.missing) state = 'missing';
    else if (result.ok) { state = 'ok'; rows = result.rows; }
    else state = 'failed';
    paint();
  }
  const byId = id => rows.find(r => r.id === id);
  const changed = (reload = true) => window.dispatchEvent(new CustomEvent(CHANGED, {detail: {reload}}));

  async function dismiss(c) {
    busy.add(c.id); paint();
    let ok = false;
    try { ok = await dismissCandidate(c.id, rt); } catch { ok = false; }
    busy.delete(c.id);
    if (!ok) { rowStatus.set(c.id, '무시하지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'dismissed'; c.decided_at = new Date().toISOString(); paint(); changed();
    offerUndoNotice({text: '무시했어요.', onUndo: async () => {
      let back = false;
      try { back = await reopenCandidate(c.id, rt); } catch { back = false; }
      if (back) { c.status = 'open'; c.decided_at = null; paint(); changed(); return {status: 'done', message: '다시 보이게 했어요.'}; }
      return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
    }});
  }
  // [내 일 아님]: out like [무시], plus a "not mine" example the server uses next time; [되돌리기] undoes both.
  async function notMine(c) {
    busy.add(c.id); paint();
    let r = {ok: false};
    try { r = await markNotMine(c, rt); } catch { r = {ok: false}; }
    busy.delete(c.id);
    if (!r.ok) { rowStatus.set(c.id, '빼지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'dismissed'; c.decided_at = new Date().toISOString(); paint(); changed();
    offerUndoNotice({text: r.saved ? '내 일 아님으로 뺐어요. 다음 찾기부터 비슷한 것을 걸러요.' : '챙길 것에서 뺐어요.', onUndo: async () => {
      let back = false;
      try { back = await undoNotMine(c.id, r.exampleId, rt); } catch { back = false; }
      if (back) { c.status = 'open'; c.decided_at = null; paint(); changed(); return {status: 'done', message: '다시 보이게 했어요.'}; }
      return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
    }});
  }
  menuLists.set(host, (id, action) => { const c = byId(id); if (c && action === 'not-mine' && !busy.has(c.id)) { status = ''; void notMine(c); } });
  // [할 일로]: the suggested due when there is one, else today (the same as the home card's ✓).
  async function toTask(c) {
    const draft = {title: c.summary, due: quickDue(c, seoulDateKey())};
    const problem = validateTaskDraft(draft);
    if (problem) { rowStatus.set(c.id, problem); paint(); return; }
    const mine = radarScope(rt);
    busy.add(c.id); rowStatus.set(c.id, '넣는 중…'); paint();
    const result = await candidateToTask(c, draft);
    busy.delete(c.id);
    if (mine !== radarScope(rt)) return;
    if (result.status === 'unknown') { unknown.set(c.id, true); rowStatus.set(c.id, '결과를 확인하지 못했어요. 새로 만들지 않았어요. 할 일 화면에서 확인해 주세요.'); paint(); return; }
    if (result.status === 'failed') { rowStatus.set(c.id, result.code === 'session_required' ? '로그인이 필요해요. 다시 로그인한 뒤 눌러 주세요.' : '할 일로 넣지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    window.KPTUGoogleTasks?.invalidateAfterCreate?.(); window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
    if (result.status === 'marked_failed') { dues.set(c.id, draft.due || null); unmarked.set(c.id, result.task.id); rowStatus.set(c.id, '할 일은 만들었어요. 챙길 것에서 빼지 못했어요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = result.task.id; c.decided_at = new Date().toISOString(); c.task_due = draft.due || null;
    status = '할 일로 보냈어요.'; paint(); changed();
  }

  host.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.inboxPromiseLedger) {
      const p = radarPromises()[Number(d.inboxPromiseLedger)]; if (!p) return;
      const text = ledgerRequestText(p), ok = await copyText(text);
      if (ok) copied.add(text);
      status = ok ? '원장에 넣을 약속 문구를 복사했어요.' : '복사하지 못했어요.'; paint();
      if (ok) flashDone(() => host.querySelector(`[data-inbox-promise-ledger="${CSS.escape(d.inboxPromiseLedger)}"]`)); // UI-눌림느낌: after the repaint, the new button says '✓ 복사됨'
      return;
    }
    if ('inboxTodoRetry' in d) { state = 'loading'; paint(); await load(); return; }
    if ('inboxTodoTasks' in d) { window.KPTURouter?.go?.('tasks', {source: 'delegated'}); return; }
    if (d.inboxTodoSource) { const c = byId(d.inboxTodoSource); if (c) openSource(c); return; }
    if (d.inboxTodoDismiss) { const c = byId(d.inboxTodoDismiss); if (c && !busy.has(c.id)) { status = ''; await dismiss(c); } return; }
    if (d.inboxTodoMore) { if (!busy.has(d.inboxTodoMore)) inboxRowMenu().open(b); return; }
    if (d.inboxTodoTask) { const c = byId(d.inboxTodoTask); if (c && !busy.has(c.id)) { status = ''; rowStatus.delete(c.id); await toTask(c); } return; }
    if (d.inboxTodoMark) {
      const c = byId(d.inboxTodoMark), taskId = unmarked.get(d.inboxTodoMark); if (!c || !taskId) return;
      busy.add(c.id); paint();
      let ok = false; try { ok = await markTasked(c.id, taskId, rt, new Date(), dues.get(c.id) || null); } catch { ok = false; }
      busy.delete(c.id);
      if (ok) { unmarked.delete(c.id); rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = taskId; c.task_due = dues.get(c.id) || null; paint(); changed(); } else { rowStatus.set(c.id, '표시하지 못했어요. 다시 눌러 주세요.'); paint(); }
    }
  });
  chips?.addEventListener('click', event => {
    const b = event.target.closest('[data-inbox-chip]'); if (!b) return;
    chip = b.dataset.inboxChip; status = ''; paint();
  });
  window.addEventListener(CHANGED, event => {
    if (!host.isConnected || scope !== radarScope(rt)) return;
    if (event.detail?.reload && !busy.size) void load(); else paint();
  });
  // Decision 5 reads the task list the task module already has; the count follows it.
  for (const name of ['kptu:google-tasks-changed', 'kptu:home-ready']) window.addEventListener(name, () => { if (state === 'ok') paint(); });
  window.addEventListener('kptu:session-changed', () => {
    if (scope === radarScope(rt)) return;
    run++; rows = []; state = 'loading'; chip = 'open'; status = ''; copied.clear(); busy.clear(); unknown.clear(); unmarked.clear(); rowStatus.clear(); told = undefined; scope = radarScope(rt);
    host.replaceChildren(); paint();
  });

  return {
    // The side is shown or hidden by the screen; showing it reads again.
    show(value) { host.hidden = !value; if (value) { chip = 'open'; status = ''; paint(); void load(); } },
    // The count is also needed while the other side is shown, so the screen asks for a read without showing.
    refresh: () => load(),
    count,
  };
}
