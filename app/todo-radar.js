import {waitHtml, waitInlineHtml} from './wait-state.js';
// UI-기다림표시통일 2차: 누른 뒤 기다리는 동안 상태 줄은 글자 없는 회색 칸(wait-state.js)
const RADAR_WAIT = '\u0000wait';
const radarStatusHtml = text => text === RADAR_WAIT ? waitInlineHtml() : esc(text);
// JOURNAL-챙길것 1단계 + AI-서버연동 S5: the "챙길 것" box (docs/design/todo-radar.md 4·5·10·11절).
// One renderer per host element: the home card body (#homeView [data-home-card="radar"], below 주요 일정) and the journal box
// above the day card (#journalView [data-journal-radar]). home-read.js and journal.js only make the empty host and tell it
// the chosen day; everything inside is drawn here. Data and the server call are in todo-radar-data.js.
// - Finding runs on the server (ai-assist kind=todo_radar): once on the first open of the day in this tab (the server also
//   skips when it already looked today) and on [다시 찾기]. The screen never sends record text.
// - A candidate is only a candidate: ✓/✎ make one Google task through the existing create path; ✕ dismisses it
//   (5 s [되돌리기]); both stay in '처리함' struck through (JOURNAL-챙길것화면). A counterpart promise is shown once with [원장으로 복사] and never stored.
// - Nothing is kept in browser storage. A table or function that is not deployed yet hides the box quietly (as PR 838 does for [AI 요약]).
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import {readHomeCandidates, readWeekCandidates, findTodos, dismissCandidate, reopenCandidate, markTasked,
  candidateToTask, validateTaskDraft, notPlanned, ledgerRequestText, radarScope, quickDue, dotDay, dueChoices,
  RADAR_SOURCE_LABEL, HOME_ROWS, TASK_TITLE_MAX} from './todo-radar-data.js';
import {formatSeoulTime, seoulDateKey, seoulDayStart, addSeoulDays} from './meeting-time.js';
import {copyText} from './copy-text.js';
import {flashDone} from './press-feedback.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {requestBasketNote, requestNoteDocOpen} from './basket-note-tasks.js';

const rt = window.KPTURuntime;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const clock = value => formatSeoulTime(value, {hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const stamp = value => formatSeoulTime(value, {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const CHANGED = 'kptu:todo-radar-changed';

// Shared by every host in this tab, for the signed-in owner only.
// dueOf: the due each candidate was put in with in this tab (kept for a failed mark; the saved value is the candidate's task_due, older rows fall back to the task view's copy).
const shared = {scope:'', autoDay:'', fnMissing:false, finding:null, promises:[], status:'', checkedAt:null, partial:false, dueOf:new Map()};
function sameScope() {
  const scope = radarScope(rt);
  if (shared.scope !== scope) Object.assign(shared, {scope, autoDay:'', fnMissing:false, finding:null, promises:[], status:'', checkedAt:null, partial:false, dueOf:new Map()});
  return scope;
}
// reload:true when candidates changed (other hosts read again); false when only the shared status line changed.
const notify = (reload = true) => window.dispatchEvent(new CustomEvent(CHANGED, {detail:{reload}}));
const toast = message => { const box = document.querySelector('#toast'); if (!box) return; box.textContent = message; kptuHoldToast(box); };
// Titles of tasks that are not done, from the task view's own copy (decision 5: do not show what is already a task).
const taskTitles = () => (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);

async function find(mode) {
  const scope = sameScope();
  if (shared.finding) return shared.finding;
  shared.status = RADAR_WAIT; notify(false);
  shared.finding = findTodos(mode).then(result => {
    if (scope !== radarScope(rt)) return result;
    if (!result.ok && result.code === 'not_ready') shared.fnMissing = true;
    if (result.ok) { shared.checkedAt = result.checkedAt; shared.partial = result.partial; }
    if (result.ok && !result.skipped) shared.promises = result.promises;
    shared.status = result.ok ? (result.skipped ? '' : result.added ? `새로 ${result.added}개 찾았어요.` : '새로 찾은 것은 없어요.') : result.message;
    return result;
  }).then(result => { shared.finding = null; if (scope === radarScope(rt)) notify(result.ok && !result.skipped); return result; },
    error => { shared.finding = null; if (scope === radarScope(rt)) notify(false); throw error; });
  return shared.finding;
}

// 정리함 [챙길 것] shows the same promises (INBOX-상대약속): read-only view of what the last finding in this tab returned.
// Same scope guard as the radar itself; nothing is stored, so after a reload they are gone until the next finding.
export function radarPromises() { sameScope(); return shared.promises; }
// BASKET-정리함한화면: the 정리함 top line shows the same last-find time and has the same [다시 찾기] (one finder for every place).
export function radarFindState() { sameScope(); return {checkedAt: shared.checkedAt, finding: !!shared.finding, status: shared.status, missing: shared.fnMissing}; }
export const radarFindAgain = () => find('again');
export const radarClock = value => clock(value);

export function openSource(c) {
  const go = view => window.KPTURouter?.go?.(view, {source:'delegated'});
  if (c.source_kind === 'basket') { requestBasketNote(c.source_id, rt); go('basket'); return; }
  if (c.source_kind === 'note') { requestNoteDocOpen(c.source_id, rt); go('basket'); return; }
  if (c.source_kind === 'work') { go('journal'); return; }
  const open = async () => {
    if (c.source_kind === 'meeting') {
      await window.KPTUViewLoader?.prepare?.('meetings'); await import('./meeting-round-detail.js');
      if (!(await window.__KPTU_MEETING_ROUND_DETAIL_READY__)) throw new Error('meeting');
      await window.KPTUMeetingRoundDetail.open(c.source_id);
    } else if (c.source_kind === 'org_update' && c.organization_id) {
      await window.KPTUViewLoader.load('team'); await window.KPTUWorkplace.open(c.organization_id);
    } else if (c.source_kind === 'project_update' && c.project_id) {
      await window.KPTUViewLoader.load('projects'); await window.KPTUProjects.open(c.project_id);
    }
  };
  open().catch(() => toast('출처를 열지 못했어요. 다시 시도해 주세요.'));
}

// place: 'home' (open candidates + what was handled today) or 'journal' (candidates whose source is the chosen day).
// JOURNAL-챙길것화면: one look for both places (and phone/PC). Each row is two lines — the title, then a grey line with the
// source and the AI's suggested due (▾ opens the evidence). Three small buttons on the right: ✓ straight to a task (due =
// suggested due, else today), ✎ edit in place (title + 오늘/내일/제안 기한/기한 없음), ✕ dismiss. Handled rows are struck
// through, keep '할 일로 넣음 · 10.23' or '무시함', and fold below the open ones in '처리함 N ▸'. The first 4 open rows show,
// the rest behind 'N건 더 ›'. The count next to the title is the open count only.
export function mountRadar(host, {place}) {
  if (!host) return null;
  let rows = [], state = 'loading', all = false, doneOpen = false, edit = null, run = 0, scope = sameScope();
  let day = seoulDateKey(), week = {from:day, to:day}, visible = true;
  const busy = new Set(), unknown = new Map(), unmarked = new Map(), rowStatus = new Map(), why = new Set();
  const life = new AbortController(), on = {signal:life.signal};
  host.hidden = true;

  async function load() {
    scope = sameScope();
    const mine = ++run;
    // One read of the candidates; a table that does not exist yet keeps the box hidden and asks the server nothing.
    const list = await (place === 'home' ? readHomeCandidates(seoulDayStart(new Date()).toISOString(), rt) : readWeekCandidates(week.from, week.to, rt));
    if (mine !== run || scope !== radarScope(rt)) return;
    if (list.missing) { state = 'missing'; paint(); return; }
    state = list.ok ? 'ok' : 'failed';
    rows = list.ok ? list.rows : [];
    paint();
    // D7: the first open of the day in this tab asks the server once; the server skips when it already looked today.
    const today = seoulDateKey();
    if (state === 'ok' && !shared.fnMissing && shared.autoDay !== today) {
      shared.autoDay = today;
      await find('auto');
    }
  }

  // Open rows (not already a task by title, decision 5) and handled rows, newest decision first.
  function openRows() {
    const list = place === 'home' ? rows : rows.filter(r => r.source_day === day);
    return notPlanned(list.filter(r => r.status === 'open'), taskTitles());
  }
  function doneRows() {
    const list = place === 'home' ? rows : rows.filter(r => r.source_day === day);
    return list.filter(r => r.status !== 'open').sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || '')));
  }
  let lastKey = '', drawn = '';
  const shownKey = () => openRows().map(r => r.id).join(',');
  const dayPromises = () => place === 'home' ? shared.promises : shared.promises.filter(p => p.source_day === day);
  // The due a handled row was put in with: the saved task_due, else this tab's own record, else the task's due in the task view's copy.
  function taskedDue(c) {
    if (c.task_due) return c.task_due;
    if (shared.dueOf.has(c.id)) return shared.dueOf.get(c.id);
    const task = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).find(t => t?.id === c.task_id);
    return task ? (task.due || '') : null;
  }
  function doneLabel(c) {
    if (c.status === 'dismissed') return '무시함';
    const due = taskedDue(c);
    return due === null ? '할 일로 넣음' : `할 일로 넣음 · ${due ? dotDay(due) : '기한 없음'}`;
  }

  function editHtml(c) {
    const id = esc(c.id), isBusy = busy.has(c.id), dis = isBusy ? ' disabled' : '';
    const today = seoulDateKey(), tomorrow = seoulDateKey(addSeoulDays(today, 1));
    const chips = dueChoices(c, today, tomorrow).map(o => `<button type="button" class="radar-chip" data-radar-due-pick="${esc(o.key)}" data-due="${esc(o.due)}" aria-pressed="${edit.pick === o.key}"${dis}>${esc(o.label)}</button>`).join('');
    return `<form class="radar-edit" data-radar-edit="${id}" novalidate><label>할 일 제목<input type="text" data-radar-title maxlength="${TASK_TITLE_MAX}" value="${esc(edit.title)}"${dis}></label><div class="radar-due" role="group" aria-label="기한">${chips}</div><div class="radar-actions"><button type="submit" class="primary" data-radar-make="${id}"${isBusy ? ' disabled aria-busy="true"' : ''}>넣기</button><button type="button" data-radar-cancel="${id}"${dis}>취소</button></div></form>`;
  }
  function rowHtml(c) {
    const id = esc(c.id), isBusy = busy.has(c.id), open = c.status === 'open';
    const source = RADAR_SOURCE_LABEL[c.source_kind];
    const meta = open ? [source, c.due ? `제안 기한 ${dotDay(c.due)}` : ''].filter(Boolean).join(' · ') : `${doneLabel(c)} · ${source}`;
    const shownWhy = why.has(c.id);
    const more = c.evidence ? `<button type="button" class="radar-why" data-radar-why="${id}" aria-expanded="${shownWhy}" aria-label="근거 ${shownWhy ? '접기' : '보기'}">${shownWhy ? '▴' : '▾'}</button>` : '';
    let tools = '', below = '';
    if (open && edit?.id === c.id) below = editHtml(c);
    else if (open && unknown.has(c.id)) below = `<div class="radar-actions"><button type="button" data-radar-tasks="${id}">할 일 화면에서 확인</button></div>`;
    else if (open && unmarked.has(c.id)) below = `<div class="radar-actions"><button type="button" data-radar-mark="${id}"${isBusy ? ' disabled' : ''}>옮긴 것으로 표시</button></div>`;
    else if (open) {
      const dis = isBusy || edit ? ' disabled' : '';
      tools = `<span class="radar-tools"><button type="button" class="radar-tool" data-radar-quick="${id}" aria-label="바로 할 일로" title="바로 할 일로"${dis}>✓</button><button type="button" class="radar-tool" data-radar-task="${id}" aria-label="고쳐서 넣기" title="고쳐서 넣기"${dis}>✎</button><button type="button" class="radar-tool" data-radar-dismiss="${id}" aria-label="무시" title="무시"${dis}>✕</button></span>`;
    }
    const note = rowStatus.get(c.id) ? `<p class="radar-row-status" role="status">${esc(rowStatus.get(c.id))}</p>` : '';
    return `<li class="radar-row" data-radar-row="${id}" data-radar-status="${esc(c.status)}"><div class="radar-line"><div class="radar-text"><span class="radar-summary">${esc(c.summary)}</span><span class="radar-meta"><button type="button" class="radar-source" data-radar-source="${id}" aria-label="출처 열기: ${esc(source)}">${esc(meta)}</button>${more}</span></div>${tools}</div>${shownWhy ? `<p class="radar-evidence" data-radar-evidence>${esc(c.evidence)}</p>` : ''}${note}${below}</li>`;
  }
  function promiseHtml(p, i) {
    const meta = ['상대 약속', RADAR_SOURCE_LABEL[p.source_kind], p.due ? `기한 ${dotDay(p.due)}` : ''].filter(Boolean).join(' · ');
    return `<li class="radar-row radar-promise" data-radar-promise="${i}"><div class="radar-line"><div class="radar-text"><span class="radar-summary">${esc(p.summary)}</span><span class="radar-meta"><span>${esc(meta)}</span></span></div><span class="radar-tools"><button type="button" class="radar-link" data-radar-ledger="${i}">원장으로 복사</button></span></div></li>`;
  }

  function paint() {
    if (!visible || state === 'missing' || shared.fnMissing || !rt.context.read()?.workspace?.id) { host.hidden = true; host.replaceChildren(); drawn = ''; return; }
    const list = openRows(), done = doneRows(), promises = dayPromises();
    // Home: with nothing open, handled or promised the card folds away (todo-radar.md 5절); the journal box stays with [다시 찾기].
    if (place === 'home' && state !== 'failed' && !list.length && !done.length && !promises.length) { host.hidden = true; host.replaceChildren(); drawn = ''; lastKey = ''; return; }
    host.hidden = false;
    const focus = host.contains(document.activeElement) ? [...host.querySelectorAll('button,input')].indexOf(document.activeElement) : -1;
    const focusKey = document.activeElement && host.contains(document.activeElement) ? [...document.activeElement.attributes].find(a => a.name.startsWith('data-radar-'))?.name : '';
    const focusVal = focusKey ? document.activeElement.getAttribute(focusKey) : '';
    lastKey = list.map(r => r.id).join(',');
    // An open row being edited stays visible even when it is past the first four.
    const listed = all ? list : list.filter((r, i) => i < HOME_ROWS || edit?.id === r.id);
    const checked = shared.checkedAt ? `마지막 찾기 ${stamp(shared.checkedAt)}${shared.partial ? ' · 일부만 봤어요' : ''}` : shared.finding ? '' : '아직 찾지 않았어요';
    // Journal: a day with nothing to take care of folds the big box into one line (JOURNAL-다듬기).
    const quiet = place === 'journal' && state === 'ok' && !list.length && !done.length && !promises.length;
    host.classList.toggle('radar-collapsed', quiet);
    const titleId = place === 'home' ? 'home-radar-title' : 'journal-radar-title';
    const findBtn = `<button type="button" class="radar-find" data-radar-find${shared.finding ? ' disabled aria-busy="true"' : ''}>다시 찾기</button>`;
    const head = quiet
      ? `<header class="radar-head"><p class="radar-muted radar-quiet" data-radar-quiet id="${titleId}">챙길 것 없음${shared.checkedAt ? ` · 마지막 찾기 ${esc(clock(shared.checkedAt))}` : shared.finding ? '' : ' · 아직 찾지 않았어요'}</p>${findBtn}</header>`
      : place === 'home'
      ? `<header class="radar-head"><h3 id="${titleId}">챙길 것 <small data-home-count data-radar-count>${list.length || ''}</small></h3>${findBtn}</header>`
      : `<header class="radar-head"><h4 id="${titleId}">그날 나온 챙길 것 <small data-radar-count>${list.length || ''}</small></h4>${findBtn}</header>`;
    const empty = state === 'failed' ? `<p class="radar-muted">챙길 것을 불러오지 못했어요. <button type="button" class="radar-link" data-radar-retry>다시 시도</button></p>`
      : !list.length && !promises.length ? (state === 'loading' ? waitHtml({rows:2}) : `<p class="radar-muted">${place === 'home' ? '남은 챙길 것 없음' : '이 날 기록에서 나온 챙길 것 없음'}</p>`) : '';
    const hiddenCount = list.length - listed.length;
    const more = all && list.length > HOME_ROWS ? `<button type="button" class="radar-link" data-radar-all aria-expanded="true">접기</button>`
      : hiddenCount > 0 ? `<button type="button" class="radar-link" data-radar-all aria-expanded="false">${hiddenCount}건 더 ›</button>` : '';
    // 'N건 더 ›' and '처리함 N ▸' share one line so their 44px press ranges never overlap.
    const doneToggle = done.length ? `<button type="button" class="radar-link" data-radar-done-toggle aria-expanded="${doneOpen}">처리함 ${done.length} ${doneOpen ? '▾' : '▸'}</button>` : '';
    const foot = more || doneToggle ? `<div class="radar-foot">${more}${doneToggle}</div>` : '';
    const doneHtml = done.length ? `<div class="radar-done" data-radar-done>${doneOpen ? `<ul class="radar-list">${done.map(rowHtml).join('')}</ul>` : ''}</div>` : '';
    const body = quiet ? `<div data-home-body><p class="radar-status" data-radar-status-line role="status" aria-live="polite">${radarStatusHtml(shared.status)}</p></div>` : `<div data-home-body>${empty}${listed.length || promises.length ? `<ul class="radar-list" data-radar-open>${listed.map(rowHtml).join('')}${promises.map(promiseHtml).join('')}</ul>` : ''}${foot}${doneHtml}<p class="radar-muted radar-checked" data-radar-checked>${esc(checked)}</p><p class="radar-status" data-radar-status-line role="status" aria-live="polite">${radarStatusHtml(shared.status)}</p></div>`;
    host.setAttribute('aria-labelledby', titleId);
    host.dataset.state = state;
    // The same drawing is not redrawn, so a button is never replaced under a finger or the keyboard focus.
    if (drawn === head + body && host.firstChild) return;
    drawn = head + body;
    host.innerHTML = drawn;
    const again = focusKey ? host.querySelector(`[${focusKey}="${CSS.escape(focusVal)}"]`) : null;
    (again || (focus >= 0 ? host.querySelectorAll('button,input')[focus] : null))?.focus({preventScroll:true});
  }

  const byId = id => rows.find(r => r.id === id);
  async function dismiss(c) {
    busy.add(c.id); paint();
    let ok = false;
    try { ok = await dismissCandidate(c.id, rt); } catch { ok = false; }
    busy.delete(c.id);
    if (!ok) { rowStatus.set(c.id, '무시하지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'dismissed'; c.decided_at = new Date().toISOString(); paint(); notify(true);
    host.querySelector('[data-radar-find]')?.focus({preventScroll:true});
    offerUndoNotice({text:'챙길 것에서 뺐어요.', onUndo:async () => {
      let back = false;
      try { back = await reopenCandidate(c.id, rt); } catch { back = false; }
      if (back) { c.status = 'open'; c.decided_at = null; paint(); notify(true); return {status:'done', message:'다시 보이게 했어요.'}; }
      return {status:'failed', message:'되돌리지 못했어요. 다시 시도해 주세요.'};
    }});
  }
  // ✓ (draft = summary + quickDue) and ✎ [넣기] both end here: one Google task through the existing create path.
  async function commit(c, draft) {
    const problem = validateTaskDraft(draft);
    if (problem) { rowStatus.set(c.id, problem); paint(); host.querySelector('[data-radar-title]')?.focus(); return; }
    const mine = sameScope();
    busy.add(c.id); rowStatus.set(c.id, '넣는 중…'); paint();
    const result = await candidateToTask(c, draft);
    busy.delete(c.id);
    if (mine !== radarScope(rt)) return;
    if (result.status === 'unknown') { edit = null; unknown.set(c.id, true); rowStatus.set(c.id, '결과를 확인하지 못했어요. 새로 만들지 않았어요. 할 일 화면에서 확인해 주세요.'); paint(); return; }
    if (result.status === 'failed') { rowStatus.set(c.id, result.code === 'session_required' ? '로그인이 필요해요. 다시 로그인한 뒤 눌러 주세요.' : '할 일로 넣지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    edit = null;
    window.KPTUGoogleTasks?.invalidateAfterCreate?.(); window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
    if (result.status === 'marked_failed') { shared.dueOf.set(c.id, draft.due || ''); unmarked.set(c.id, result.task.id); rowStatus.set(c.id, '할 일은 만들었어요. 챙길 것에서 빼지 못했어요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = result.task.id; c.decided_at = new Date().toISOString(); c.task_due = draft.due || null;
    shared.dueOf.set(c.id, draft.due || '');
    const extra = [result.linkError ? '연결은 할 일 화면에서 확인해 주세요.' : '', result.recorded === false ? '업데이트에는 기록하지 못했어요.' : ''].filter(Boolean).join(' ');
    shared.status = `할 일로 넣었어요${draft.due ? ` · 기한 ${dotDay(draft.due)}` : ' · 기한 없음'}.${extra ? ' ' + extra : ''}`; toast('Google 할 일을 만들었어요.');
    paint(); notify(true); host.querySelector('[data-radar-find]')?.focus({preventScroll:true});
  }

  host.addEventListener('submit', event => {
    const form = event.target.closest('[data-radar-edit]'); if (!form) return;
    event.preventDefault(); const c = byId(form.dataset.radarEdit); if (!c || busy.has(c.id)) return;
    edit = {...edit, id:c.id, title:form.querySelector('[data-radar-title]').value};
    void commit(c, {title:edit.title, due:edit.due});
  });
  host.addEventListener('input', event => {
    if (!edit) return;
    if (event.target.matches('[data-radar-title]')) edit.title = event.target.value;
  });
  host.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || b.disabled || b.type === 'submit') return;
    const d = b.dataset;
    if ('radarFind' in d) { await find('again'); return; }
    if ('radarRetry' in d) { await load(); return; }
    if ('radarAll' in d) { all = !all; paint(); host.querySelector('[data-radar-all]')?.focus({preventScroll:true}); return; }
    if ('radarDoneToggle' in d) { doneOpen = !doneOpen; paint(); return; }
    if (d.radarWhy) { const id = d.radarWhy; if (why.has(id)) why.delete(id); else why.add(id); paint(); return; }
    if (d.radarDuePick) { if (!edit) return; edit.pick = d.radarDuePick; edit.due = d.due || ''; paint(); return; }
    if (d.radarQuick) { const c = byId(d.radarQuick); if (!c || busy.has(c.id) || edit) return; rowStatus.delete(c.id); await commit(c, {title:c.summary, due:quickDue(c, seoulDateKey())}); return; }
    if (d.radarSource) { const c = byId(d.radarSource); if (c) openSource(c); return; }
    if (d.radarTask) { const c = byId(d.radarTask); if (!c) return; const due = quickDue(c, seoulDateKey()); edit = {id:c.id, title:c.summary, due, pick:c.due ? 'suggested' : 'today'}; rowStatus.delete(c.id); paint(); host.querySelector('[data-radar-title]')?.focus(); return; }
    if (d.radarCancel) { const id = d.radarCancel; edit = null; rowStatus.delete(id); paint(); host.querySelector(`[data-radar-task="${CSS.escape(id)}"]`)?.focus(); return; }
    if (d.radarDismiss) { const c = byId(d.radarDismiss); if (c) await dismiss(c); return; }
    if (d.radarTasks) { window.KPTURouter?.go?.('tasks', {source:'delegated'}); return; }
    if (d.radarMark) {
      const c = byId(d.radarMark), taskId = unmarked.get(d.radarMark); if (!c || !taskId) return;
      busy.add(c.id); paint();
      let ok = false; try { ok = await markTasked(c.id, taskId, rt, new Date(), shared.dueOf.get(c.id) || null); } catch { ok = false; }
      busy.delete(c.id);
      if (ok) { unmarked.delete(c.id); rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = taskId; c.task_due = shared.dueOf.get(c.id) || null; notify(true); } else rowStatus.set(c.id, '표시하지 못했어요. 다시 눌러 주세요.');
      paint(); return;
    }
    if (d.radarLedger) {
      const p = dayPromises()[Number(d.radarLedger)]; if (!p) return;
      const ok = await copyText(ledgerRequestText(p));
      shared.status = ok ? '원장에 넣을 약속 문구를 복사했어요.' : '복사하지 못했어요.'; notify(false);
      if (ok) flashDone(() => host.querySelector(`[data-radar-ledger="${CSS.escape(d.radarLedger)}"]`)); // UI-눌림느낌: after the repaint, the new button says '✓ 복사됨'
    }
  }, on);
  window.addEventListener(CHANGED, event => {
    if (!host.isConnected || scope !== radarScope(rt)) return;
    if (event.detail?.reload && !busy.size && !edit) void load(); else paint();
  }, on);
  // Decision 5 reads the task list the task module already has; repaint when it arrives or changes (no extra request).
  // Only when the shown rows really change, so a row is never redrawn under a finger.
  for (const name of ['kptu:google-tasks-changed', 'kptu:home-ready']) window.addEventListener(name, () => {
    if (host.isConnected && state === 'ok' && !edit && shownKey() !== lastKey) paint();
  }, on);
  window.addEventListener('kptu:session-changed', () => {
    if (scope === radarScope(rt)) return;
    run++; rows = []; state = 'loading'; edit = null; all = false; doneOpen = false; busy.clear(); unknown.clear(); unmarked.clear(); rowStatus.clear(); why.clear();
    host.hidden = true; host.replaceChildren(); drawn = "";
  }, on);

  return {
    destroy: () => { run++; life.abort(); },
    refresh: () => load(),
    // The journal's [주간 정리] side hides the box; [하루] shows it again.
    setShown(value) { if (visible === !!value) return; visible = !!value; paint(); },
    setDay(next, from, to) {
      const weekChanged = from !== week.from || to !== week.to;
      day = next; week = {from, to}; edit = null;
      if (weekChanged || state !== 'ok') void load(); else paint();
    },
  };
}
