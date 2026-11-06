// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5·6절, 명진 결정 11/05 시안 A) + S51-26 FAMILY-노트로(11/06 08:26 '2'·08:35 'ㅇ',
// 시안 docs/design/mockups/family-forget-panel.html): 홈 [하루]의 '잊지 말기' 칸 하나(한 겹).
// - 운영자 기능 family가 있을 때만 그린다(서버 app_my_features).
// - 머리 줄 '잊지 말기 n · AI가 뽑음 · 노트 열기 ›'(톤다운 노랑). 제안이 없으면 한 줄 '잊지 말기 · 새 제안 없음 · 노트 열기 ›'.
// - 제안 줄 = 내용 한 줄 + 아래 작은 줄(왼쪽 말한 때·출처·날짜, 오른쪽 작은 [할 일로][일정으로][노트로] ✕). '확정'은 꼬리표 없이, 예정·확인만 작은 글자.
//   누르기 전에는 아무것도 만들지 않는다. [할 일로]·[일정으로]는 그 창에서 저장돼야, [노트로]는 그 창에서 보내야 상태가 바뀐다. [×]는 5초 되돌리기.
// - 남긴 줄은 노트('잊지 말기' 노트, family-note-send.js)에 있다. 칸 안에 [기억] 모음은 없다.
// - 업무일지·주간보고·오늘 한 일·홈 요약 숫자에는 섞지 않는다. 글은 모두 esc()로 글자로만 그린다. 기기 저장 없음.
// 이 파일이 이 칸의 유일한 renderer다.
import {FIRM_LABEL, draftOf, metaLine, noteLine, openedFromPush, suggestions} from './family-notes-model.mjs';
import {decide, hasFamily, readNotes} from './family-notes-data.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const UNDO_MS = 5000;
const OPEN = '<button type="button" class="home-family-open" data-family-open>노트 열기 ›</button>';

export function mountHomeFamily(host, {rt = window.KPTURuntime, win = window} = {}) {
  if (!host) return null;
  let state = {phase: 'off', notes: [], busy: '', status: '', undo: null};
  let run = 0, undoTimer = 0, feature = {ws: '', on: false}, pushShown = false;
  const ws = () => rt.context?.read?.()?.workspace?.id || '';

  function noteRow(n) {
    const busy = state.busy === n.id ? ' disabled' : '';
    const firm = FIRM_LABEL[n.firmness] ? `<span class="home-family-firm">${esc(FIRM_LABEL[n.firmness])}</span> ` : '';
    return `<li class="home-family-item" data-family-note="${esc(n.id)}"><p class="home-family-body">${firm}${esc(n.body)}</p>`
      + `<div class="home-family-row2"><span class="home-family-meta">${esc(metaLine(n))}</span>`
      + `<span class="home-family-acts" role="group" aria-label="${esc(n.body)}">`
      + `<button type="button" class="home-family-act" data-family-act="task"${busy}>할 일로</button>`
      + `<button type="button" class="home-family-act" data-family-act="event"${busy}>일정으로</button>`
      + `<button type="button" class="home-family-act" data-family-act="note"${busy}>노트로</button>`
      + `<button type="button" class="home-family-act home-family-x" data-family-act="dismissed" aria-label="제안 지우기: ${esc(n.body)}"${busy}>×</button></span></div></li>`;
  }
  function render() {
    if (state.phase !== 'ready') { host.hidden = true; host.replaceChildren(); return; }
    const fresh = suggestions(state.notes);
    const undo = state.undo ? ` <button type="button" class="home-family-open" data-family-undo>되돌리기</button>` : '';
    const status = `<p class="home-family-status" role="status" aria-live="polite">${esc(state.status)}${undo}</p>`;
    host.hidden = false;
    if (!fresh.length) {
      host.innerHTML = `<div class="home-family-head is-one"><span class="home-family-title">잊지 말기</span><span class="home-family-faint">· 새 제안 없음 ·</span>${OPEN}</div>${status}`;
      return;
    }
    host.innerHTML = `<div class="home-family-head"><span class="home-family-title">잊지 말기</span><span class="home-family-n">${fresh.length}</span><span class="home-family-faint">· AI가 뽑음 ·</span>${OPEN}</div>`
      + `<ul class="home-family-list">${fresh.map(noteRow).join('')}</ul>${status}`;
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
      set({phase: 'ready', notes});
      // 폰 알림을 눌러 연 홈(family=1): 칸이 보이게 한 번 옮긴다.
      if (!pushShown && openedFromPush(win.location?.search)) { pushShown = true; host.scrollIntoView?.({block: 'nearest'}); }
    } catch {
      if (mine === run) set({phase: 'off', notes: []}); // 못 읽으면 칸을 그리지 않는다(업무 화면에 오류 줄을 남기지 않음)
    }
  }
  async function change(id, status, say) {
    const workspace = ws();
    set({busy: id, status: ''});
    try {
      await decide(rt, workspace, id, status);
      state.notes = state.notes.filter(n => n.id !== id);
      set({busy: '', status: say});
      return true;
    } catch {
      set({busy: '', status: '저장하지 못했어요. 다시 눌러 주세요'});
      return false;
    }
  }
  async function act(note, kind, trigger) {
    const draft = draftOf(note);
    if (kind === 'dismissed') {
      if (!(await change(note.id, 'dismissed', '지웠어요'))) return;
      clearTimeout(undoTimer);
      set({undo: note});
      undoTimer = setTimeout(() => set({undo: null, status: ''}), UNDO_MS);
      return;
    }
    if (kind === 'note') {
      try {
        const {openFamilyNoteSend} = await import('./family-note-send.js');
        await openFamilyNoteSend({rt, line: noteLine(note), body: note.body, trigger,
          onSent: ({folderName}) => void change(note.id, 'kept', folderName ? `'${folderName}' 폴더 노트에 넣었어요` : '노트에 넣었어요')});
      } catch { set({status: '노트로 보내는 창을 열지 못했어요'}); }
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
  host.addEventListener('click', async event => {
    const b = event.target.closest?.('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if ('familyOpen' in b.dataset) {
      try { const {openListNote} = await import('./family-note-send.js'); await openListNote(rt); } catch { set({status: '노트를 열지 못했어요'}); }
      return;
    }
    if ('familyUndo' in b.dataset) {
      const n = state.undo; clearTimeout(undoTimer); set({undo: null});
      if (!n) return;
      try { await decide(rt, ws(), n.id, 'new'); state.notes = [{...n, status: 'new'}, ...state.notes]; set({status: '되돌렸어요'}); }
      catch { set({status: '되돌리지 못했어요'}); }
      return;
    }
    const row = b.closest('[data-family-note]'), note = row && state.notes.find(n => n.id === row.dataset.familyNote);
    if (note && b.dataset.familyAct) await act(note, b.dataset.familyAct, b);
  });
  win.addEventListener('kptu:session-changed', () => { run++; feature = {ws: '', on: false}; clearTimeout(undoTimer); state = {phase: 'off', notes: [], busy: '', status: '', undo: null}; render(); });
  return {refresh, state: () => state};
}
