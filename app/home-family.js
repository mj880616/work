// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5·6절, 명진 결정 11/05 시안 A) + S51-26 FAMILY-노트로(11/06 08:26 '2'·08:35 'ㅇ',
// 시안 docs/design/mockups/family-forget-panel.html): 홈 [하루]의 '잊지 말기' 칸 하나(한 겹).
// - 운영자 기능 family가 있을 때만 그린다(서버 app_my_features).
// - S52-09 UI-요청상자통일: 상자·줄·버튼은 홈 '나한테 온 요청'(asks-box.js)과 같은 공용 부품(notice-box.mjs) — 색만 다르다.
// - 머리 줄 '잊지 말기 n · AI가 뽑음 · 노트 열기 ›'(톤다운 노랑). 제안이 없으면 한 줄 '잊지 말기 · 새 제안 없음 · 노트 열기 ›'.
// - 제안 줄 = 내용 한 줄 + 아래 작은 줄(왼쪽 말한 때·출처·날짜, 오른쪽 작은 [할 일로][이미 함][일정으로][노트로] ✕). '확정'은 꼬리표 없이, 예정·확인만 작은 글자.
//   누르기 전에는 아무것도 만들지 않는다. [할 일로]·[일정으로]는 그 창에서 저장돼야, [노트로]는 그 창에서 보내야 상태가 바뀐다. [×]는 5초 되돌리기.
//   S51-30 [이미 함](시안 docs/design/mockups/family-forget-already-done.html): 창 없이 '잊지 말기' 노트에 체크된 줄('☑ …')을 더한 뒤 상태 kept,
//   5초 '이미 한 일로 표시함 · 되돌리기'(되돌리면 상태 new + 그 줄 하나 뺌). [×]는 기록 없이 빠지고, [이미 함]은 노트에 했다는 기록이 남는다.
// - 남긴 줄은 노트('잊지 말기' 노트, family-note-send.js)에 있다. 칸 안에 [기억] 모음은 없다.
// - 업무일지·주간보고·오늘 한 일·홈 요약 숫자에는 섞지 않는다. 글은 모두 esc()로 글자로만 그린다. 기기 저장 없음.
// 이 파일이 이 칸의 유일한 renderer다.
import {FIRM_LABEL, draftOf, metaLine, noteLine, openedFromPush, suggestions} from './family-notes-model.mjs';
import {decide, hasFamily, readNotes} from './family-notes-data.js';
import {NB_UNDO_MS, boxHtml, esc, headHtml, markBox, rowHtml} from './notice-box.mjs';

const UNDO_MS = NB_UNDO_MS;
const OPEN = {attr: 'data-family-open', label: '노트 열기 ›'};

export function mountHomeFamily(host, {rt = window.KPTURuntime, win = window} = {}) {
  if (!host) return null;
  let state = {phase: 'off', notes: [], busy: '', status: '', undo: null};
  let run = 0, undoTimer = 0, feature = {ws: '', on: false}, pushShown = false;
  const ws = () => rt.context?.read?.()?.workspace?.id || '';
  markBox(host, 'forget');

  // S52-09 UI-요청상자통일: 상자·머리 줄·줄·버튼은 '나한테 온 요청'과 같은 공용 부품(notice-box.mjs). 색만 노랑.
  const noteRow = n => rowHtml({id: n.id, body: n.body, meta: metaLine(n), busy: state.busy === n.id,
    prefix: FIRM_LABEL[n.firmness] ? `<span class="nbx-tag">${esc(FIRM_LABEL[n.firmness])}</span> ` : ''});
  function render() {
    if (state.phase !== 'ready') { host.hidden = true; host.replaceChildren(); return; }
    const fresh = suggestions(state.notes);
    host.hidden = false;
    const head = headHtml({title: '잊지 말기', count: fresh.length, faint: fresh.length ? '· AI가 뽑음 ·' : '· 새 제안 없음 ·', open: OPEN});
    host.innerHTML = boxHtml({head, rows: fresh.map(noteRow), status: state.status, undo: !!state.undo});
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
  function startUndo(undo) {
    clearTimeout(undoTimer);
    set({undo});
    undoTimer = setTimeout(() => set({undo: null, status: ''}), UNDO_MS);
  }
  async function act(note, kind, trigger) {
    const draft = draftOf(note);
    if (kind === 'dismissed') {
      if (!(await change(note.id, 'dismissed', '지웠어요'))) return;
      clearTimeout(undoTimer);
      startUndo({note});
      return;
    }
    if (kind === 'done') {
      const line = noteLine(note, true);
      set({busy: note.id, status: ''});
      let sent;
      try {
        const {markDone} = await import('./family-note-send.js');
        sent = await markDone(rt, {line, body: note.body});
      } catch { set({busy: '', status: '노트에 남기지 못했어요. 다시 눌러 주세요'}); return; }
      if (!(await change(note.id, 'kept', '이미 한 일로 표시함'))) return;
      startUndo({note, done: {noteId: sent?.noteId || '', line}});
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
    if ('nbxUndo' in b.dataset) {
      const u = state.undo; clearTimeout(undoTimer); set({undo: null});
      if (!u) return;
      const n = u.note;
      try {
        await decide(rt, ws(), n.id, 'new');
        state.notes = [{...n, status: 'new'}, ...state.notes];
        // [이미 함]이면 노트에 더한 그 줄도 뺀다(못 빼면 제안만 돌아오고 알린다).
        if (u.done) {
          try { const {undoDone} = await import('./family-note-send.js'); await undoDone(rt, u.done); }
          catch { set({status: '제안은 돌렸지만 노트의 줄은 남았어요'}); return; }
        }
        set({status: '되돌렸어요'});
      }
      catch { set({status: '되돌리지 못했어요'}); }
      return;
    }
    const row = b.closest('[data-nbx-row]'), note = row && state.notes.find(n => n.id === row.dataset.nbxRow);
    if (note && b.dataset.nbxAct) await act(note, b.dataset.nbxAct, b);
  });
  win.addEventListener('kptu:session-changed', () => { run++; feature = {ws: '', on: false}; clearTimeout(undoTimer); state = {phase: 'off', notes: [], busy: '', status: '', undo: null}; render(); });
  return {refresh, state: () => state};
}
