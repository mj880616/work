// FAMILY-기억알림(시안 docs/design/mockups/family-note-remind.html ②③): 가족 '잊지 말기' 노트 줄의 ⋯ 메뉴 한 곳 — [노트에서 보기] [과거 기록으로].
// 홈 '가족 · 기억할 것' 칸(family-remind.js)과 노트 화면(가족 노트 ⋯ [줄 정리] → 줄 고르기, basket-notes.js)이 같은 메뉴·같은 길을 쓴다.
// [과거 기록으로]는 family-note-send.js moveToPast(지우지 않고 같은 폴더 '과거 기록' 노트로 옮김) → '과거 기록으로 옮겼어요 · 되돌리기'(공용 되돌리기 알림).
// 옮기거나 되돌리면 kptu:family-remind-changed를 보내 두 화면이 다시 읽는다. 기기 저장 없음.
import {createAnchoredMenu} from './anchored-menu.js';
import {offerUndoNotice} from './basket-record-delete.js';
import {esc} from './notice-box.mjs';
import {emptyHtml} from './wait-state.js';
import {seoulDateKey} from './meeting-time.js';
import {remindLines} from './family-remind-model.mjs';

export const REMIND_CHANGED = 'kptu:family-remind-changed';
let lineMenu = null, pickMenu = null, ctx = null, pickCtx = null;
const tell = () => window.dispatchEvent(new CustomEvent(REMIND_CHANGED));

async function moveOut(c) {
  const {moveToPast, undoPast} = await import('./family-note-send.js');
  let moved;
  try { moved = await moveToPast(c.rt, {noteId: c.noteId, text: c.text, today: seoulDateKey()}); }
  catch (error) { c.onFail?.(error?.code === 'line_missing' ? '그 줄이 노트에 없어요. 최신으로 맞췄어요.' : '과거 기록으로 옮기지 못했어요. 다시 눌러 주세요.'); if (error?.code === 'line_missing') tell(); return; }
  tell();
  c.onMoved?.('');
  offerUndoNotice({text: '과거 기록으로 옮겼어요', onUndo: async () => {
    try { await undoPast(c.rt, moved); } catch { return {status: 'failed', message: '되돌리지 못했어요. 다시 시도해 주세요.'}; }
    tell(); c.onUndone?.();
    return {status: 'done', message: '되돌렸어요.'};
  }});
}

// 줄 하나의 메뉴. c = {rt, noteId, text, row?, onOpen, onMoved, onUndone, onFail, inNote?}
export function openRemindMenu(trigger, c) {
  ctx = c;
  lineMenu ||= createAnchoredMenu({id: 'familyRemindMenu', className: 'radar-row-menu', label: '가족 기억할 것 줄 메뉴', historyKey: 'kptuFamilyRemindMenu',
    key: () => 'line', row: () => ctx?.row || null, boxWidth: 180,
    render: () => `${ctx?.inNote ? '' : '<button type="button" class="row-act" data-fam-menu="open">노트에서 보기</button>'}<button type="button" class="row-act" data-fam-menu="past">과거 기록으로</button>`,
    onAction: button => {
      const c2 = ctx; if (!c2) return;
      if (button.dataset.famMenu === 'open') c2.onOpen?.();
      else if (button.dataset.famMenu === 'past') void moveOut(c2);
    }});
  lineMenu.open(trigger);
}

// MENU-자리나머지: 홈 칸(family-remind.js)이 줄을 다시 그린 뒤 열린 줄 메뉴를 새 ⋯에 붙인다(anchored-menu keepMenus에 넘김).
// 메뉴가 표시하는 줄(ctx.row)도 떨어졌으면 새 ⋯가 든 줄로 함께 옮긴다(상자가 그 줄을 가리지 않게).
export const remindMenuFollower = {
  get active() { return lineMenu?.active || null; },
  follow(find) {
    const a = lineMenu?.active; if (!a || a.trigger.isConnected) return;
    const moveRow = !!ctx?.row && !ctx.row.isConnected;
    if (moveRow) ctx.row = null;
    lineMenu.follow((id, old) => { const next = find(id, old); if (next && moveRow && ctx) ctx.row = next.closest('li'); return next; });
  }
};

// 노트 화면(가족 '잊지 말기' 노트 ⋯ [줄 정리]): 그 노트의 줄을 고르는 작은 메뉴 → 고른 줄의 같은 메뉴(노트 안이라 [노트에서 보기]는 빼고 [과거 기록으로]).
export function openRemindLines(trigger, {rt, note, onDone = () => {}, onFail = () => {}}) {
  const lines = remindLines(note?.doc);
  pickCtx = {rt, note, lines, onDone, onFail};
  pickMenu ||= createAnchoredMenu({id: 'familyRemindLines', className: 'radar-row-menu fam-remind-pick', label: '줄 선택', historyKey: 'kptuFamilyRemindLines',
    key: () => 'lines', boxWidth: 280,
    render: () => (pickCtx?.lines.length ? pickCtx.lines.map(l => `<button type="button" class="row-act" data-fam-pick="${esc(l.key)}">${esc(l.text)}</button>`).join('')
      : emptyHtml()),
    onAction: (button, active) => {
      const p = pickCtx, line = p?.lines.find(l => l.key === button.dataset.famPick);
      if (!line) return;
      const at = active?.trigger?.isConnected ? active.trigger : trigger;
      setTimeout(() => openRemindMenu(at, {rt: p.rt, noteId: p.note.id, text: line.text, inNote: true, onMoved: () => p.onDone(), onUndone: () => p.onDone(), onFail: p.onFail}), 0);
    }});
  pickMenu.open(trigger);
}
