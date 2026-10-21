// JOURNAL-챙길것 1단계 + AI-서버연동 S5: the "챙길 것" box (docs/design/todo-radar.md 4·5·10·11절).
// One renderer per host element: the home card body (#homeView [data-home-card="radar"], below 주요 일정) and the journal box
// above the day card (#journalView [data-journal-radar]). home-read.js and journal.js only make the empty host and tell it
// the chosen day; everything inside is drawn here. Data and the server call are in todo-radar-data.js.
// - Finding runs on the server (ai-assist kind=todo_radar): once on the first open of the day in this tab (the server also
//   skips when it already looked today) and on [다시 찾기]. The screen never sends record text.
// - A candidate is only a candidate: [할 일로] makes one Google task through the existing create path; [무시] hides it
//   (5 s [되돌리기]). A counterpart promise is shown once with [원장으로 복사] and never stored.
// - Nothing is kept in browser storage. A table or function that is not deployed yet hides the box quietly (as PR 838 does for [AI 요약]).
import {readOpenCandidates, readWeekCandidates, readRadarState, findTodos, dismissCandidate, reopenCandidate, markTasked,
  candidateToTask, validateTaskDraft, notPlanned, ledgerRequestText, radarScope, RADAR_KIND_LABEL, RADAR_SOURCE_LABEL,
  HOME_ROWS, TASK_TITLE_MAX} from './todo-radar-data.js';
import {formatSeoulTime, seoulDateKey} from './meeting-time.js';
import {copyText} from './md-editor.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {requestBasketNote, requestNoteDocOpen} from './basket-note-tasks.js';

const rt = window.KPTURuntime;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const shortDay = day => formatSeoulTime(day, {month:'numeric', day:'numeric'});
const stamp = value => formatSeoulTime(value, {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const CHANGED = 'kptu:todo-radar-changed';

// Shared by every host in this tab, for the signed-in owner only.
const shared = {scope:'', autoDay:'', fnMissing:false, finding:null, promises:[], status:'', checkedAt:null, partial:false};
function sameScope() {
  const scope = radarScope(rt);
  if (shared.scope !== scope) Object.assign(shared, {scope, autoDay:'', fnMissing:false, finding:null, promises:[], status:'', checkedAt:null, partial:false});
  return scope;
}
// reload:true when candidates changed (other hosts read again); false when only the shared status line changed.
const notify = (reload = true) => window.dispatchEvent(new CustomEvent(CHANGED, {detail:{reload}}));
const toast = message => { const box = document.querySelector('#toast'); if (!box) return; box.textContent = message; box.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.add('hidden'), 3200); };
// Titles of tasks that are not done, from the task view's own copy (decision 5: do not show what is already a task).
const taskTitles = () => (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);

async function find(mode) {
  const scope = sameScope();
  if (shared.finding) return shared.finding;
  shared.status = '챙길 것을 찾는 중…'; notify(false);
  shared.finding = findTodos(mode).then(result => {
    if (scope !== radarScope(rt)) return result;
    if (!result.ok && result.code === 'not_ready') shared.fnMissing = true;
    if (result.ok && !result.skipped) { shared.promises = result.promises; shared.partial = result.partial; }
    shared.status = result.ok ? (result.skipped ? '' : result.added ? `새로 ${result.added}개 찾았어요.` : '새로 찾은 것은 없어요.') : result.message;
    return result;
  }).then(result => { shared.finding = null; if (scope === radarScope(rt)) notify(result.ok && !result.skipped); return result; },
    error => { shared.finding = null; if (scope === radarScope(rt)) notify(false); throw error; });
  return shared.finding;
}

function openSource(c) {
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

const STATUS_LABEL = {open:'대기', tasked:'할 일로 옮김', dismissed:'무시함'};

// place: 'home' (every open candidate, 5 rows + [모두 보기]) or 'journal' (candidates whose source is the chosen day).
export function mountRadar(host, {place}) {
  if (!host) return null;
  let rows = [], state = 'loading', all = false, edit = null, run = 0, scope = sameScope();
  let day = seoulDateKey(), week = {from:day, to:day}, visible = true;
  const busy = new Set(), unknown = new Map(), unmarked = new Map(), rowStatus = new Map();
  const life = new AbortController(), on = {signal:life.signal};
  host.hidden = true;

  async function load() {
    scope = sameScope();
    const mine = ++run;
    const [list, info] = await Promise.all([place === 'home' ? readOpenCandidates(rt) : readWeekCandidates(week.from, week.to, rt), readRadarState(rt)]);
    if (mine !== run || scope !== radarScope(rt)) return;
    if (list.missing || info.missing) { state = 'missing'; paint(); return; }
    state = list.ok ? 'ok' : 'failed';
    rows = list.ok ? list.rows : [];
    if (info.ok) { shared.checkedAt = info.checkedAt; shared.partial = shared.partial || info.partial; }
    paint();
    // D7: the first open of the day in this tab asks the server once; the server skips when it already looked today.
    const today = seoulDateKey();
    if (state === 'ok' && !shared.fnMissing && shared.autoDay !== today) {
      shared.autoDay = today;
      const result = await find('auto');
    }
  }

  function visibleRows() {
    if (place === 'home') return notPlanned(rows.filter(r => r.status === 'open'), taskTitles());
    return rows.filter(r => r.source_day === day && (r.status !== 'open' || notPlanned([r], taskTitles()).length));
  }
  let lastKey = '', drawn = '';
  const shownKey = () => visibleRows().map(r => r.id).join(',');
  const dayPromises = () => place === 'home' ? shared.promises : shared.promises.filter(p => p.source_day === day);

  function rowHtml(c) {
    const meta = [`${RADAR_SOURCE_LABEL[c.source_kind]} ${shortDay(c.source_day)}`, c.due ? `기한 ${shortDay(c.due)}` : ''].filter(Boolean).join(' · ');
    const id = esc(c.id), isBusy = busy.has(c.id);
    let actions = '';
    if (c.status === 'open' && edit?.id === c.id) {
      actions = `<form class="radar-edit" data-radar-edit="${id}" novalidate><label>할 일 제목<input type="text" data-radar-title maxlength="${TASK_TITLE_MAX}" value="${esc(edit.title)}"${isBusy ? ' disabled' : ''}></label><label>기한<input type="date" data-radar-due value="${esc(edit.due || '')}"${isBusy ? ' disabled' : ''}></label><div class="radar-actions"><button type="submit" class="primary" data-radar-make="${id}"${isBusy ? ' disabled aria-busy="true"' : ''}>할 일 만들기</button><button type="button" data-radar-cancel="${id}"${isBusy ? ' disabled' : ''}>취소</button></div></form>`;
    } else if (c.status === 'open' && unknown.has(c.id)) {
      actions = `<div class="radar-actions"><button type="button" data-radar-tasks="${id}">할 일 화면에서 확인</button></div>`;
    } else if (c.status === 'open' && unmarked.has(c.id)) {
      actions = `<div class="radar-actions"><button type="button" data-radar-mark="${id}"${isBusy ? ' disabled' : ''}>옮긴 것으로 표시</button></div>`;
    } else if (c.status === 'open') {
      actions = `<div class="radar-actions"><button type="button" data-radar-task="${id}"${isBusy || edit ? ' disabled' : ''}>할 일로</button><button type="button" data-radar-dismiss="${id}"${isBusy || edit ? ' disabled' : ''}>무시</button></div>`;
    }
    const tag = place === 'journal' ? `<span class="radar-state" data-radar-state="${esc(c.status)}">${STATUS_LABEL[c.status]}</span>` : '';
    const note = rowStatus.get(c.id) ? `<p class="radar-row-status" role="status">${esc(rowStatus.get(c.id))}</p>` : '';
    return `<li class="radar-row" data-radar-row="${id}" data-radar-status="${esc(c.status)}"><div class="radar-line"><span class="radar-kind" data-radar-kind="${esc(c.kind)}">${RADAR_KIND_LABEL[c.kind]}</span><span class="radar-summary">${esc(c.summary)}</span>${tag}</div><div class="radar-meta"><button type="button" class="radar-source" data-radar-source="${id}" aria-label="출처 열기: ${esc(meta)}">${esc(meta)}</button></div>${c.evidence ? `<p class="radar-evidence">${esc(c.evidence)}</p>` : ''}${note}${actions}</li>`;
  }
  function promiseHtml(p, i) {
    return `<li class="radar-row radar-promise" data-radar-promise="${i}"><div class="radar-line"><span class="radar-kind" data-radar-kind="promise">상대 약속</span><span class="radar-summary">${esc(p.summary)}</span></div><div class="radar-meta"><span>${esc(RADAR_SOURCE_LABEL[p.source_kind])} ${esc(shortDay(p.source_day))}${p.due ? ' · 기한 ' + esc(shortDay(p.due)) : ''}</span></div><div class="radar-actions"><button type="button" data-radar-ledger="${i}">원장으로 복사</button></div></li>`;
  }

  function paint() {
    if (!visible || state === 'missing' || shared.fnMissing || !rt.context.read()?.workspace?.id) { host.hidden = true; host.replaceChildren(); drawn = ''; return; }
    host.hidden = false;
    const focus = host.contains(document.activeElement) ? [...host.querySelectorAll('button,input')].indexOf(document.activeElement) : -1;
    const focusKey = document.activeElement && host.contains(document.activeElement) ? [...document.activeElement.attributes].find(a => a.name.startsWith('data-radar-'))?.name : '';
    const focusVal = focusKey ? document.activeElement.getAttribute(focusKey) : '';
    const list = visibleRows(), promises = dayPromises();
    lastKey = list.map(r => r.id).join(',');
    const listed = place === 'home' && !all ? list.slice(0, HOME_ROWS) : list;
    const checked = shared.checkedAt ? `마지막 찾기 ${stamp(shared.checkedAt)}${shared.partial ? ' · 일부만 봤어요' : ''}` : '아직 찾지 않았어요';
    const titleId = place === 'home' ? 'home-radar-title' : 'journal-radar-title';
    const head = place === 'home'
      ? `<header><h3 id="${titleId}">챙길 것 <small data-home-count>${list.length || ''}</small></h3><button type="button" data-radar-find${shared.finding ? ' disabled aria-busy="true"' : ''}>다시 찾기</button></header>`
      : `<header class="radar-head"><h4 id="${titleId}">그날 나온 챙길 것 <small>${list.length || ''}</small></h4><button type="button" class="mini" data-radar-find${shared.finding ? ' disabled aria-busy="true"' : ''}>다시 찾기</button></header>`;
    const empty = state === 'failed' ? `<p class="radar-muted">챙길 것을 불러오지 못했어요. <button type="button" class="radar-link" data-radar-retry>다시 시도</button></p>`
      : !list.length && !promises.length ? `<p class="radar-muted">${state === 'loading' ? '불러오는 중…' : place === 'home' ? '챙길 것 없음' : '이 날 기록에서 나온 챙길 것 없음'}</p>` : '';
    const more = place === 'home' && list.length > HOME_ROWS ? `<button type="button" class="radar-link" data-radar-all aria-expanded="${all}">${all ? '접기' : `모두 보기 ${list.length}`}</button>` : '';
    const body = `<div data-home-body>${empty}${listed.length || promises.length ? `<ul class="radar-list">${listed.map(rowHtml).join('')}${promises.map(promiseHtml).join('')}</ul>` : ''}${more}<p class="radar-muted radar-checked" data-radar-checked>${esc(checked)}</p><p class="radar-status" data-radar-status-line role="status" aria-live="polite">${esc(shared.status)}</p></div>`;
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
  async function makeTask(c, form) {
    const title = form.querySelector('[data-radar-title]').value, due = form.querySelector('[data-radar-due]').value;
    edit = {id:c.id, title, due};
    const problem = validateTaskDraft({title, due});
    if (problem) { rowStatus.set(c.id, problem); paint(); host.querySelector('[data-radar-title]')?.focus(); return; }
    const mine = sameScope();
    busy.add(c.id); rowStatus.set(c.id, '만드는 중…'); paint();
    const result = await candidateToTask(c, {title, due});
    busy.delete(c.id);
    if (mine !== radarScope(rt)) return;
    if (result.status === 'unknown') { edit = null; unknown.set(c.id, true); rowStatus.set(c.id, '결과를 확인하지 못했어요. 새로 만들지 않았어요. 할 일 화면에서 확인해 주세요.'); paint(); return; }
    if (result.status === 'failed') { rowStatus.set(c.id, result.code === 'session_required' ? '로그인이 필요해요. 다시 로그인한 뒤 눌러 주세요.' : '할 일을 만들지 못했어요. 다시 눌러 주세요.'); paint(); return; }
    edit = null;
    window.KPTUGoogleTasks?.invalidateAfterCreate?.(); window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
    if (result.status === 'marked_failed') { unmarked.set(c.id, result.task.id); rowStatus.set(c.id, '할 일은 만들었어요. 챙길 것에서 빼지 못했어요.'); paint(); return; }
    rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = result.task.id;
    const extra = [result.linkError ? '연결은 할 일 화면에서 확인해 주세요.' : '', result.recorded === false ? '업데이트에는 기록하지 못했어요.' : ''].filter(Boolean).join(' ');
    shared.status = `할 일로 옮겼어요.${extra ? ' ' + extra : ''}`; toast('Google 할 일을 만들었어요.');
    paint(); notify(true); host.querySelector('[data-radar-find]')?.focus({preventScroll:true});
  }

  host.addEventListener('submit', event => {
    const form = event.target.closest('[data-radar-edit]'); if (!form) return;
    event.preventDefault(); const c = byId(form.dataset.radarEdit); if (c && !busy.has(c.id)) void makeTask(c, form);
  });
  host.addEventListener('input', event => {
    if (!edit) return;
    if (event.target.matches('[data-radar-title]')) edit.title = event.target.value;
    if (event.target.matches('[data-radar-due]')) edit.due = event.target.value;
  });
  host.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || b.disabled || b.type === 'submit') return;
    const d = b.dataset;
    if ('radarFind' in d) { await find('again'); return; }
    if ('radarRetry' in d) { await load(); return; }
    if ('radarAll' in d) { all = !all; paint(); return; }
    if (d.radarSource) { const c = byId(d.radarSource); if (c) openSource(c); return; }
    if (d.radarTask) { const c = byId(d.radarTask); if (!c) return; edit = {id:c.id, title:c.summary, due:c.due || ''}; rowStatus.delete(c.id); paint(); host.querySelector('[data-radar-title]')?.focus(); return; }
    if (d.radarCancel) { const id = d.radarCancel; edit = null; rowStatus.delete(id); paint(); host.querySelector(`[data-radar-task="${CSS.escape(id)}"]`)?.focus(); return; }
    if (d.radarDismiss) { const c = byId(d.radarDismiss); if (c) await dismiss(c); return; }
    if (d.radarTasks) { window.KPTURouter?.go?.('tasks', {source:'delegated'}); return; }
    if (d.radarMark) {
      const c = byId(d.radarMark), taskId = unmarked.get(d.radarMark); if (!c || !taskId) return;
      busy.add(c.id); paint();
      let ok = false; try { ok = await markTasked(c.id, taskId, rt); } catch { ok = false; }
      busy.delete(c.id);
      if (ok) { unmarked.delete(c.id); rowStatus.delete(c.id); c.status = 'tasked'; c.task_id = taskId; notify(true); } else rowStatus.set(c.id, '표시하지 못했어요. 다시 눌러 주세요.');
      paint(); return;
    }
    if (d.radarLedger) {
      const p = dayPromises()[Number(d.radarLedger)]; if (!p) return;
      const ok = await copyText(ledgerRequestText(p));
      shared.status = ok ? '쓰기요청 문구를 복사했어요. 원장에 붙여 넣어 주세요.' : '복사하지 못했어요.'; notify(false);
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
    run++; rows = []; state = 'loading'; edit = null; all = false; busy.clear(); unknown.clear(); unmarked.clear(); rowStatus.clear();
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
