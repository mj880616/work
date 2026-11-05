// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5·6절, 명진 결정 11/05 시안 A): 홈 [하루]의 '잊지 말기' 작은 칸 하나.
// - 운영자 기능 family가 있을 때만 그린다(서버 app_my_features). 줄이 하나도 없으면 칸을 그리지 않는다.
// - 칸 안에서 [제안 n | 기억] 전환. 제안마다 [할 일로](Google 할 일 창, 제목만 채움) [일정으로](일정 창, 캘린더는 창에서 고름) [기억만] [×](5초 되돌리기).
//   누르기 전에는 아무것도 만들지 않는다. [할 일로]·[일정으로]는 그 창에서 저장돼야 상태가 바뀐다.
// - '기억'은 세 묶음(좋아함·싫어함 / 하자고 한 것·부탁 / 기념일·선물 거리). 하자고 한 것은 동그라미로 했음/안 했음, 한 것은 접힘.
// - 업무일지·주간보고·오늘 한 일·홈 요약 숫자에는 섞지 않는다. 글은 모두 esc()로 글자로만 그린다. 기기 저장 없음.
// 이 파일이 이 칸의 유일한 renderer다.
import {FIRM_LABEL, KIND_LABEL, draftOf, memoryGroups, metaLine, openedFromPush, shortDay, suggestions} from './family-notes-model.mjs';
import {decide, hasFamily, markDone, readNotes} from './family-notes-data.js';
import {emptyHtml} from './wait-state.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TAG = {firm: 'is-firm', planned: 'is-plan', unclear: 'is-unclear'};
const UNDO_MS = 5000;

export function mountHomeFamily(host, {rt = window.KPTURuntime, win = window} = {}) {
  if (!host) return null;
  let state = {phase: 'off', notes: [], tab: 'new', open: false, busy: '', status: '', undo: null};
  let run = 0, undoTimer = 0, feature = {ws: '', on: false};
  const ws = () => rt.context?.read?.()?.workspace?.id || '';

  function noteRow(n) {
    const busy = state.busy === n.id ? ' disabled' : '';
    const label = n.body;
    return `<li class="home-family-item" data-family-note="${esc(n.id)}">`
      + `<div class="home-family-line"><span class="home-family-tag ${TAG[n.firmness] || ''}">${esc(FIRM_LABEL[n.firmness])}</span><span class="home-family-body">${esc(n.body)}</span></div>`
      + `<div class="home-family-meta">${esc(metaLine(n))}</div>`
      + `<div class="home-family-acts" role="group" aria-label="${esc(label)}">`
      + `<button type="button" class="mini" data-family-act="task"${busy}>할 일로</button>`
      + `<button type="button" class="mini" data-family-act="event"${busy}>일정으로</button>`
      + `<button type="button" class="mini" data-family-act="kept"${busy}>기억만</button>`
      + `<button type="button" class="mini home-family-x" data-family-act="dismissed" aria-label="제안 지우기: ${esc(label)}"${busy}>×</button></div></li>`;
  }
  function memoryRow(n, withDot) {
    const dot = withDot
      ? `<button type="button" class="home-family-dot${n.done ? ' is-on' : ''}" data-family-done="${esc(n.id)}" aria-pressed="${n.done ? 'true' : 'false'}" aria-label="${esc(n.done ? '안 했음으로' : '했음으로')}: ${esc(n.body)}"${state.busy === n.id ? ' disabled' : ''}></button>`
      : `<span class="home-family-tag is-kind">${esc(KIND_LABEL[n.kind])}</span>`;
    const src = n.driveUrl ? ` <a class="home-family-src" href="${esc(n.driveUrl)}" target="_blank" rel="noopener noreferrer">원본</a>` : '';
    return `<li class="home-family-mem">${dot}<span class="home-family-body">${esc(n.body)}</span><span class="home-family-day">${esc(n.saidWhen || shortDay(n.day))}${src}</span></li>`;
  }
  function memoryHtml() {
    const groups = memoryGroups(state.notes);
    if (!groups.length) return emptyHtml('기억 없음');
    return groups.map(g => {
      const dot = g.key === 'todo';
      const done = g.done.length ? `<details class="home-family-done"><summary>한 것 ${g.done.length}</summary><ul>${g.done.map(n => memoryRow(n, dot)).join('')}</ul></details>` : '';
      return `<section class="home-family-grp" data-family-group="${g.key}"><h5>${esc(g.label)}</h5><ul>${g.open.map(n => memoryRow(n, dot)).join('')}</ul>${done}</section>`;
    }).join('');
  }
  function render() {
    if (state.phase !== 'ready' || !state.notes.length) { host.hidden = true; host.replaceChildren(); return; }
    const fresh = suggestions(state.notes);
    const tab = state.tab === 'memory' || !fresh.length ? state.tab : 'new';
    const count = fresh.length ? ` <span class="home-family-n">${fresh.length}</span>` : '';
    const list = tab === 'memory' ? memoryHtml()
      : fresh.length ? `<ul class="home-family-list">${fresh.map(noteRow).join('')}</ul>` : emptyHtml('새 제안 없음');
    const undo = state.undo ? ` <button type="button" class="mini" data-family-undo>되돌리기</button>` : '';
    host.hidden = false;
    host.innerHTML = `<details class="home-family-box" data-family-box${state.open ? ' open' : ''}><summary>잊지 말기${count}</summary>`
      + `<div class="home-family-tabs" role="group" aria-label="잊지 말기 보기"><button type="button" class="mini" data-family-tab="new" aria-pressed="${tab === 'new'}">제안 ${fresh.length}</button><button type="button" class="mini" data-family-tab="memory" aria-pressed="${tab === 'memory'}">기억</button><span class="home-family-note">AI가 뽑음</span></div>`
      + list + `<p class="home-family-status" role="status" aria-live="polite">${esc(state.status)}${undo}</p></details>`;
  }
  const set = patch => { state = {...state, ...patch}; render(); };

  async function refresh() {
    const mine = ++run, workspace = ws();
    if (!workspace) { set({phase: 'off', notes: []}); return; }
    // 기능 여부는 작업공간마다 한 번만 묻는다(홈에 들어올 때마다 묻지 않음).
    if (feature.ws !== workspace) feature = {ws: workspace, on: await hasFamily(rt)};
    if (!feature.on) { if (mine === run) set({phase: 'off', notes: []}); return; }
    try {
      const notes = await readNotes(rt, workspace);
      if (mine !== run || workspace !== ws()) return;
      set({phase: 'ready', notes, open: state.open || openedFromPush(win.location?.search)});
    } catch {
      if (mine === run) set({phase: 'off', notes: []}); // 못 읽으면 칸을 그리지 않는다(업무 화면에 오류 줄을 남기지 않음)
    }
  }
  async function change(id, status, say) {
    const workspace = ws();
    set({busy: id, status: ''});
    try {
      await decide(rt, workspace, id, status);
      state.notes = state.notes.map(n => (n.id === id ? {...n, status} : n)).filter(n => n.status !== 'dismissed');
      set({busy: '', status: say});
      return true;
    } catch {
      set({busy: '', status: '저장하지 못했어요. 다시 눌러 주세요'});
      return false;
    }
  }
  async function act(note, kind) {
    const draft = draftOf(note);
    if (kind === 'kept') return void change(note.id, 'kept', '기억에 남겼어요');
    if (kind === 'dismissed') {
      if (!(await change(note.id, 'dismissed', '지웠어요'))) return;
      clearTimeout(undoTimer);
      set({undo: note});
      undoTimer = setTimeout(() => set({undo: null, status: ''}), UNDO_MS);
      return;
    }
    if (kind === 'task') {
      try {
        await Promise.all([import('./organization-order.js'), import('./google-tasks.js')]);
        window.KPTUGoogleTasks.openEditor(null, {title: draft.title, memo: draft.memo, onCreated: () => void change(note.id, 'tasked', '할 일로 만들었어요')});
      } catch { set({status: '할 일 창을 열지 못했어요'}); }
      return;
    }
    if (kind === 'event') {
      if (!window.KPTUEventCreate?.open) { set({status: '일정 창을 열지 못했어요'}); return; }
      window.KPTUEventCreate.open({title: draft.title, memo: draft.memo, onCreated: () => void change(note.id, 'scheduled', '일정으로 만들었어요')});
    }
  }
  host.addEventListener('toggle', event => { if (event.target?.matches?.('[data-family-box]')) state.open = event.target.open; }, true);
  host.addEventListener('click', async event => {
    const b = event.target.closest?.('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if (b.dataset.familyTab) { set({tab: b.dataset.familyTab}); host.querySelector(`[data-family-tab="${b.dataset.familyTab}"]`)?.focus({preventScroll: true}); return; }
    if ('familyUndo' in b.dataset) {
      const n = state.undo; clearTimeout(undoTimer); set({undo: null});
      if (!n) return;
      try { await decide(rt, ws(), n.id, 'new'); state.notes = [{...n, status: 'new'}, ...state.notes]; set({status: '되돌렸어요'}); }
      catch { set({status: '되돌리지 못했어요'}); }
      return;
    }
    if (b.dataset.familyDone) {
      const n = state.notes.find(x => x.id === b.dataset.familyDone);
      if (!n) return;
      set({busy: n.id});
      try { await markDone(rt, ws(), n, !n.done); state.notes = state.notes.map(x => (x.id === n.id ? {...x, done: !n.done} : x)); set({busy: '', status: n.done ? '안 했음으로 바꿨어요' : '했음으로 표시했어요'}); }
      catch { set({busy: '', status: '저장하지 못했어요'}); }
      return;
    }
    const row = b.closest('[data-family-note]'), note = row && state.notes.find(n => n.id === row.dataset.familyNote);
    if (note && b.dataset.familyAct) await act(note, b.dataset.familyAct);
  });
  win.addEventListener('kptu:session-changed', () => { run++; feature = {ws: '', on: false}; clearTimeout(undoTimer); state = {phase: 'off', notes: [], tab: 'new', open: false, busy: '', status: '', undo: null}; render(); });
  return {refresh, state: () => state};
}
