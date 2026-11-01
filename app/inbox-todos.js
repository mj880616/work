import {waitHtml, emptyHtml} from './wait-state.js';
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
import {setHomeAsks} from './home-asks.js';
import {readInboxCandidates as readAllInbox, dismissCandidate, reopenCandidate, markNotMine, undoNotMine, markTasked, candidateToTask, validateTaskDraft, notPlanned,
  quickDue, dotDay, radarScope, ledgerRequestText, sourceText, RADAR_SOURCE_LABEL, markDone, logFeedback, dropFeedback, readFeedbackSince, TASK_TITLE_MAX} from './todo-radar-data.js';
import {weekBounds, weeklySummary, recentByOutcome} from './todo-feedback-model.mjs';
import {seoulDateKey} from './meeting-time.js';
import {dueLabel} from './task-due.mjs';
import {offerUndoNotice} from './basket-record-delete.js';
import {copyText} from './copy-text.js';
import {flashDone} from './press-feedback.js';
import {bindRowSwipe} from './row-swipe.js';

const CHANGED = 'kptu:todo-radar-changed';
export const INBOX_CHIPS = Object.freeze([['open', '처리 전'], ['tasked', '할 일로 보냄'], ['done', '이미 함'], ['dismissed', '무시함']]);
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
    render:() => '<button type="button" data-inbox-todo-menu="edit">고쳐서 할 일로</button><button type="button" data-inbox-todo-menu="not-mine">내 일 아님</button>',
    onAction:(button, active) => { const list = listOf(active.trigger); if (list) menuLists.get(list)?.(active.id, button.dataset.inboxTodoMenu); }});
  return rowMenu;
}
export function mountInboxTodos(host, {rt, esc, chips, onCount = () => {}, read, quietEmpty = false, hideSource = false, withPromises = true, openSource = () => {}, radarPromises = () => []}) {
  const readInboxCandidates = read || readAllInbox;
  let rows = [], state = 'loading', chip = 'open', run = 0, scope = radarScope(rt), status = '';
  const copied = new Set(), busy = new Set(), unknown = new Map(), unmarked = new Map(), dues = new Map(), rowStatus = new Map(), editing = new Map();
  // TODO-이미함·환류 5절: 정리함 본 목록(남의 read 없음)의 처리 전 칩 위에 '지난주 챙길 것 …' 한 줄. 결과 기록이 없거나 못 읽으면 안 그린다.
  let week = null;
  host.hidden = true;

  const openRows = () => notPlanned(rows.filter(r => r.status === 'open'), taskTitles());
  const handledRows = which => rows.filter(r => r.status === which).sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')));
  const shownRows = () => chip === 'open' ? openRows() : handledRows(chip);
  const count = () => state === 'ok' ? openRows().length : null;
  let told;
  // UI-앱안알림 3단계(A4): 정리함 본 목록(남의 읽기 read가 없는 것)은 '나한테 온 요청'(텔레그램 후보) 수를 메뉴 '홈' 표시에 알린다 —
  // 홈 요약 줄과 같은 기준(inbox-count.js openAsks)이고 새 읽기 없음. 여기서 처리하면 다른 화면에서도 표시가 바로 맞는다.
  const tellAsks = () => { if (!read && state === 'ok') setHomeAsks(openRows().filter(r => r.source_kind === 'telegram').length); };
  const tell = () => { tellAsks(); const next = count(); if (next !== told) { told = next; onCount(next); } };

  function paintChips() {
    if (!chips) return;
    for (const button of chips.querySelectorAll('[data-inbox-chip]')) button.setAttribute('aria-pressed', String(button.dataset.inboxChip === chip));
    const number = chips.querySelector('[data-inbox-chip-count]');
    if (number) number.textContent = count() === null ? '' : ' ' + count();
  }
  function doneLabel(c) {
    if (c.status === 'dismissed') return c.outcome === 'not_mine' ? '내 일 아님' : '무시함';
    if (c.status === 'done') { const day = c.decided_at && Number.isFinite(Date.parse(c.decided_at)) ? dotDay(seoulDateKey(new Date(c.decided_at))) : ''; return day ? `이미 함 · ${day}` : '이미 함'; }
    const task = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).find(t => t?.id === c.task_id);
    const due = c.task_due ? dotDay(c.task_due) : task ? dotDay(task.due || '') : '';
    return due ? `할 일로 보냄 · ${due}` : '할 일로 보냄';
  }
  function rowHtml(c) {
    const id = esc(c.id), isBusy = busy.has(c.id), open = c.status === 'open', source = sourceText(c);
    // HOME-업무일지홈 C: 제안 기한은 할 일 줄 공용 기한 글자(task-due.mjs dueLabel, 작은 진회색 .task-due-text). 기한 없으면 안 씀.
    const meta = esc(dotDay(c.source_day) + ' 기록') + (open && dueLabel(c.due) ? ` · <span class="task-due-text" data-inbox-todo-due>${esc(dueLabel(c.due))}</span>` : '');
    let right = '', below = '';
    if (!open) right = `<span class="inbox-todo-done">${esc(doneLabel(c))}</span>`;
    else if (unknown.has(c.id)) below = `<button type="button" class="inbox-todo-btn" data-inbox-todo-tasks>할 일 화면에서 확인</button>`;
    else if (unmarked.has(c.id)) below = `<button type="button" class="inbox-todo-btn" data-inbox-todo-mark="${id}"${isBusy ? ' disabled' : ''}>옮긴 것으로 표시</button>`;
    else if (editing.has(c.id)) {
      // ⋯ [고쳐서 할 일로]: 제목·기한을 고쳐 넣는다. 고친 제목은 결과 기록에 남아 다음 찾기의 말투 예시가 된다.
      const e = editing.get(c.id), dis = isBusy ? ' disabled' : '';
      below = `<form class="inbox-todo-edit" data-inbox-todo-edit="${id}"><input type="text" class="inbox-todo-edit-title" data-inbox-todo-edit-title maxlength="${TASK_TITLE_MAX}" value="${esc(e.title)}" aria-label="할 일 제목"${dis}><input type="date" class="inbox-todo-edit-due" data-inbox-todo-edit-due value="${esc(e.due)}" aria-label="기한"${dis}><button type="submit" class="inbox-todo-btn"${dis}>넣기</button><button type="button" class="inbox-todo-btn" data-inbox-todo-edit-cancel="${id}"${dis}>취소</button></form>`;
    } else {
      const dis = isBusy ? ' disabled' : '';
      right = `<span class="inbox-todo-actions"><button type="button" class="inbox-todo-btn" data-inbox-todo-task="${id}"${dis}>할 일로</button><button type="button" class="inbox-todo-btn" data-inbox-todo-done="${id}"${dis}>이미 함</button><button type="button" class="inbox-todo-btn" data-inbox-todo-dismiss="${id}"${dis}>무시</button><button type="button" class="inbox-todo-btn inbox-todo-more" data-inbox-todo-more="${id}" aria-label="더 보기" title="더 보기" aria-haspopup="true" aria-expanded="false"${dis}><span class="more-dots" aria-hidden="true">⋯</span></button></span>`;
    }
    const note = rowStatus.get(c.id) ? `<p class="inbox-todo-status" role="status">${esc(rowStatus.get(c.id))}</p>` : '';
    return `<li class="inbox-todo-row" data-inbox-todo-row="${id}" data-inbox-todo-status="${esc(c.status)}"><div class="inbox-todo-line">${hideSource ? '' : `<button type="button" class="inbox-todo-source" data-inbox-todo-source="${id}" aria-label="출처 열기: ${esc(source)}">${esc(source)}</button>`}<div class="inbox-todo-text"><span class="inbox-todo-summary">${esc(c.summary)}</span><span class="inbox-todo-meta">${meta}</span></div>${right}</div>${note}${below ? `<div class="inbox-todo-below">${below}</div>` : ''}</li>`;
  }
  const promises = () => withPromises && state === 'ok' && chip === 'open' ? radarPromises() : [];
  function promiseHtml(p, i) {
    const meta = esc(RADAR_SOURCE_LABEL[p.source_kind] || '') + (dueLabel(p.due) ? `${RADAR_SOURCE_LABEL[p.source_kind] ? ' · ' : ''}<span class="task-due-text">${esc(dueLabel(p.due))}</span>` : '');
    const label = copied.has(ledgerRequestText(p)) ? '복사함' : '원장으로';
    return `<li class="inbox-todo-row inbox-todo-promise" data-inbox-promise="${i}"><div class="inbox-todo-line"><span class="inbox-todo-source inbox-todo-tag">상대 약속</span><div class="inbox-todo-text"><span class="inbox-todo-summary">${esc(p.summary)}</span><span class="inbox-todo-meta">${meta}</span></div><span class="inbox-todo-actions"><button type="button" class="inbox-todo-btn" data-inbox-promise-ledger="${i}">${label}</button></span></div></li>`;
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
    else if (!list.length && !promises().length) body = quietEmpty ? '' : emptyHtml('없음', {attrs: 'data-inbox-todo-empty'});
    else body = `<ul class="inbox-todo-list" aria-label="챙길 것">${list.map(rowHtml).join('')}${promises().map(promiseHtml).join('')}</ul>`;
    host.innerHTML = `${weekHtml()}${body}<p class="inbox-todo-status" role="status" aria-live="polite" data-inbox-todo-line>${esc(status)}</p>`;
    if (focusAttr) host.querySelector(`[${focusAttr.name}="${CSS.escape(focusAttr.value)}"]`)?.focus({preventScroll: true});
  }

  function weekHtml() {
    if (read || chip !== 'open' || state !== 'ok' || !week) return '';
    const groups = recentByOutcome(week.rows);
    const inner = groups.map(g => `<p class="inbox-todo-week-head">${esc(g.label)}</p><ul class="inbox-todo-week-list">${g.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');
    return `<details class="inbox-todo-week" data-inbox-todo-week><summary>${esc(week.summary.text)}</summary>${inner}</details>`;
  }
  async function loadWeek() {
    if (read) return;
    const r = await readFeedbackSince(weekBounds().prev, rt);
    const summary = r.ok ? weeklySummary(r.rows) : null;
    week = summary ? {summary, rows:r.rows} : null;
  }
  async function load() {
    scope = radarScope(rt);
    const mine = ++run;
    const [result] = await Promise.all([readInboxCandidates(rt), loadWeek().catch(() => { week = null; })]);
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
    rowStatus.delete(c.id); c.status = 'dismissed'; c.outcome = 'dismissed'; c.decided_at = new Date().toISOString(); paint(); changed();
    const feedbackId = await logFeedback(c, 'dismissed', {rt});
    offerUndoNotice({text: '무시했어요.', onUndo: async () => {
      let back = false;
      try { back = await reopenCandidate(c.id, rt); } catch { back = false; }
      if (back) { if (feedbackId) await dropFeedback(feedbackId, rt); c.status = 'open'; c.decided_at = null; delete c.outcome; paint(); changed(); return {status: 'done', message: '다시 보이게 했어요.'}; }
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
    rowStatus.delete(c.id); c.status = 'dismissed'; c.outcome = 'not_mine'; c.decided_at = new Date().toISOString(); paint(); changed();
    offerUndoNotice({text: r.saved ? '내 일 아님으로 뺐어요. 다음 찾기부터 비슷한 것을 걸러요.' : '챙길 것에서 뺐어요.', onUndo: async () => {
      let back = false;
      try { back = await undoNotMine(c.id, r.exampleId, rt, r.feedbackId); } catch { back = false; }
      if (back) { c.status = 'open'; c.decided_at = null; delete c.outcome; paint(); changed(); return {status: 'done', message: '다시 보이게 했어요.'}; }
      return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
    }});
  }
  // TODO-이미함: [이미 함] — 할 일을 만들지 않고 빼고, 결과를 남긴다(다음 찾기에서 같은 일을 다시 올리지 않게). [되돌리기]로 둘 다 되돌린다.
  async function done(c) {
    busy.add(c.id); paint();
    let ok = false;
    try { ok = await markDone(c.id, rt); } catch { ok = false; }
    busy.delete(c.id);
    if (!ok) { rowStatus.set(c.id, '빼지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'done'; c.decided_at = new Date().toISOString(); paint(); changed();
    const feedbackId = await logFeedback(c, 'done', {rt});
    offerUndoNotice({text: '이미 한 일로 뺐어요.', onUndo: async () => {
      let back = false;
      try { back = await reopenCandidate(c.id, rt, 'done'); } catch { back = false; }
      if (back) { if (feedbackId) await dropFeedback(feedbackId, rt); c.status = 'open'; c.decided_at = null; paint(); changed(); return {status: 'done', message: '다시 보이게 했어요.'}; }
      return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'};
    }});
  }
  menuLists.set(host, (id, action) => {
    const c = byId(id); if (!c || c.status !== 'open' || busy.has(c.id)) return;
    status = '';
    if (action === 'not-mine') void notMine(c);
    else if (action === 'edit') {
      editing.set(c.id, {title: c.summary, due: quickDue(c, seoulDateKey())}); rowStatus.delete(c.id); paint();
      host.querySelector(`[data-inbox-todo-edit="${CSS.escape(c.id)}"] [data-inbox-todo-edit-title]`)?.focus();
    }
  });
  // [할 일로]: the suggested due when there is one, else today (the same as the home card's ✓). ⋯ [고쳐서 할 일로]는 draft를 넘긴다.
  async function toTask(c, edited = null) {
    const draft = edited || {title: c.summary, due: quickDue(c, seoulDateKey())};
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
    editing.delete(c.id);
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
    if (d.inboxTodoDone) { const c = byId(d.inboxTodoDone); if (c && c.status === 'open' && !busy.has(c.id)) { status = ''; await done(c); } return; }
    if (d.inboxTodoEditCancel) { editing.delete(d.inboxTodoEditCancel); rowStatus.delete(d.inboxTodoEditCancel); paint(); return; }
    if (d.inboxTodoMore) { if (!busy.has(d.inboxTodoMore)) inboxRowMenu().open(b); return; }
    if (d.inboxTodoTask) { const c = byId(d.inboxTodoTask); if (c && !busy.has(c.id)) { status = ''; rowStatus.delete(c.id); await toTask(c); } return; }
    if (d.inboxTodoMark) {
      const c = byId(d.inboxTodoMark), taskId = unmarked.get(d.inboxTodoMark); if (!c || !taskId) return;
      busy.add(c.id); paint();
      let ok = false; try { ok = await markTasked(c.id, taskId, rt, new Date(), dues.get(c.id) || null); } catch { ok = false; }
      busy.delete(c.id);
      if (ok) { void logFeedback(c, 'tasked', {rt}); unmarked.delete(c.id); rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = taskId; c.task_due = dues.get(c.id) || null; paint(); changed(); } else { rowStatus.set(c.id, '표시하지 못했어요. 다시 눌러 주세요.'); paint(); }
    }
  });
  host.addEventListener('input', event => {
    const form = event.target.closest('[data-inbox-todo-edit]'); const e = form && editing.get(form.dataset.inboxTodoEdit); if (!e) return;
    if (event.target.matches('[data-inbox-todo-edit-title]')) e.title = event.target.value;
    if (event.target.matches('[data-inbox-todo-edit-due]')) e.due = event.target.value;
  });
  host.addEventListener('submit', async event => {
    const form = event.target.closest('[data-inbox-todo-edit]'); if (!form) return;
    event.preventDefault();
    const c = byId(form.dataset.inboxTodoEdit), e = c && editing.get(c.id); if (!c || !e || busy.has(c.id)) return;
    const draft = {title: String(e.title).trim(), due: e.due || ''};
    const problem = validateTaskDraft(draft);
    if (problem) { rowStatus.set(c.id, problem); paint(); return; }
    status = ''; await toTask(c, draft);
  });
  // UI-목록밀기: 폰 챙길 것 줄 — 오른쪽으로 밀기 [무시](위쪽 '무시했어요 [되돌리기]', 기존 [무시] 길). 챙길 것은 지우는 길이 없어 왼쪽 밀기는 두지 않는다.
  bindRowSwipe(host, {row:'[data-inbox-todo-row]', enabled:() => state === 'ok',
    actions:el => { const c = byId(el.dataset.inboxTodoRow); return c && c.status === 'open' && !busy.has(c.id) ? {start:{key:'dismiss', label:'무시', tone:'warning'}, end:null} : null; },
    run:(key, el) => { const c = byId(el.dataset.inboxTodoRow); if (key === 'dismiss' && c && c.status === 'open' && !busy.has(c.id)) { status = ''; void dismiss(c); } }});
  chips?.addEventListener('click', event => {
    const b = event.target.closest('[data-inbox-chip]'); if (!b) return;
    chip = b.dataset.inboxChip; status = ''; paint();
  });
  window.addEventListener(CHANGED, event => {
    if (!host.isConnected || scope !== radarScope(rt)) return;
    if (event.detail?.reload && !busy.size) void load(); else paint();
  });
  // Decision 5 reads the task list the task module already has; the count follows it.
  for (const name of ['kptu:google-tasks-changed']) window.addEventListener(name, () => { if (state === 'ok') paint(); });
  window.addEventListener('kptu:session-changed', () => {
    if (scope === radarScope(rt)) return;
    run++; rows = []; state = 'loading'; chip = 'open'; status = ''; week = null; copied.clear(); busy.clear(); unknown.clear(); unmarked.clear(); rowStatus.clear(); editing.clear(); told = undefined; scope = radarScope(rt);
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
