// FAMILY-기억알림(요청함 11/12 10:40, 시안 docs/design/mockups/family-note-remind.html ①②③, 명진 10:47 "나"): '잊지 말기' 화면 맨 위
// '가족 · 기억할 것 n/전체' 칸. 가족 '잊지 말기' 노트(가장 최근에 고친 것 하나)의 줄 3줄을 날마다 바꿔 보인다(오래 못 본 줄 먼저).
// - [↻ 다른 줄]: 다음 3줄. [노트 열기 ›]: 그 노트. 줄 ⋯: [노트에서 보기] [과거 기록으로] — 노트 화면(가족 노트)의 [줄 정리]와 같은 메뉴(family-remind-menu.js).
// - [과거 기록으로]: 그 줄을 같은 폴더 '과거 기록' 노트로 옮긴다(family-note-send.js moveToPast, 지우지 않음) → '과거 기록으로 옮겼어요 · 되돌리기'.
// - 본 기록은 서버(노트 metadata.remind, basket-data.js setNoteRemind). 기기 저장 없음. 가족 노트가 없거나 비면 칸을 그리지 않는다.
// - AI를 쓰지 않고, 이 칸의 글은 어디에도 넘기지 않는다(보이기만). 이 파일이 이 칸의 유일한 renderer다.
import {esc} from './notice-box.mjs';
import {seoulDateKey} from './meeting-time.js';
import {readRemind, remindLines, pickToday, pickOther} from './family-remind-model.mjs';
import {openRemindMenu} from './family-remind-menu.js';

export function mountFamilyRemind(host, {rt = window.KPTURuntime, win = window} = {}) {
  if (!host) return null;
  let note = null, picks = [], total = 0, run = 0, status = '';
  const ws = () => rt.context?.read?.()?.workspace?.id || '';

  function paint() {
    if (!note || !picks.length) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    // 공용 상자(notice-box: .nbx 머리 줄·줄·⋯·상태 줄) 그대로. 이 칸 CSS는 자리만 정한다(basket.css).
    const other = total > picks.length ? '<button type="button" class="row-act" data-fam-other>↻ 다른 줄</button>' : '';
    host.innerHTML = `<div class="nbx-head"><span class="nbx-title">가족 · 기억할 것</span><span class="nbx-faint">${picks.length}/${total}</span><span class="nbx-acts">${other}<button type="button" class="row-act" data-fam-open>노트 열기 ›</button></span></div>`
      + `<ul class="nbx-list">${picks.map(p => `<li class="nbx-item" data-fam-line="${esc(p.key)}"><p class="nbx-body fam-remind-text">${esc(p.text)}</p><button type="button" class="icon-btn nbx-more" data-fam-more="${esc(p.key)}" aria-label="${esc(`메뉴: ${p.text}`)}" aria-haspopup="true" aria-expanded="false"><span class="more-dots" aria-hidden="true">⋯</span></button></li>`).join('')}</ul>`
      + `<p class="nbx-status" role="status" aria-live="polite" data-fam-status>${esc(status)}</p>`;
  }
  async function save(next) {
    if (!next || !note) return;
    try {
      const {setNoteRemind} = await import('./basket-data.js');
      const saved = await setNoteRemind(note, next, rt);
      if (saved?.metadata && note?.id === saved.id) note = {...note, metadata: saved.metadata, updated_at: saved.updated_at || note.updated_at};
    } catch { /* 본 기록을 못 남기면 다음에 다시 고른다(화면은 그대로) */ }
  }
  async function refresh() {
    const mine = ++run, owner = ws();
    if (!owner) { note = null; picks = []; paint(); return; }
    let row = null;
    try { const {readRemindNote} = await import('./family-note-send.js'); row = await readRemindNote(rt); } catch { row = null; }
    if (mine !== run || owner !== ws()) return;
    note = row;
    const lines = row ? remindLines(row.doc) : [];
    const got = pickToday(lines, readRemind(row?.metadata), seoulDateKey());
    picks = got.picks; total = got.total;
    paint();
    if (got.next) await save({...got.next});
  }
  async function other() {
    if (!note) return;
    const got = pickOther(remindLines(note.doc), readRemind(note.metadata), seoulDateKey());
    picks = got.picks; total = got.total; status = ''; paint();
    await save(got.next);
  }
  async function openNote() {
    if (!note?.id) return;
    const tasks = await import('./basket-note-tasks.js');
    tasks.requestNoteDocOpen(note.id, rt);
    win.KPTURouter?.go?.('basket', {source: 'delegated'});
  }
  host.addEventListener('click', event => {
    const b = event.target.closest?.('button');
    if (!b || !host.contains(b) || b.disabled) return;
    if (b.dataset.famOther !== undefined) { void other(); return; }
    if (b.dataset.famOpen !== undefined) { void openNote(); return; }
    const key = b.dataset.famMore;
    const line = key && picks.find(p => p.key === key);
    if (line) openRemindMenu(b, {rt, noteId: note.id, text: line.text, row: b.closest('li'),
      onOpen: () => void openNote(),
      onMoved: () => { status = ''; },
      onUndone: () => { status = ''; },
      onFail: message => { status = message; paint(); }});
  });
  win.addEventListener('kptu:session-changed', () => { run++; note = null; picks = []; total = 0; status = ''; paint(); });
  // 노트 화면에서 줄을 옮기거나 노트를 고치면 다시 읽는다(family-remind-menu.js가 보냄).
  win.addEventListener('kptu:family-remind-changed', () => { if (host.isConnected) void refresh(); });
  paint();
  return {refresh};
}
