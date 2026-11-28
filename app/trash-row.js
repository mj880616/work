// TRASH-줄그림단추(2026-11-28 명진 시안 '마'): 휴지통 줄의 공용 부품. 노트 휴지통(note-trash.js)·[파일] 클라우드 휴지통(files-trash.js)이 같은 줄·같은 고르기를 쓴다.
// 줄 한 칸 = [제목(한 줄 줄임표)] [지운 날(작은 회색)] [되살리기 그림 단추 ↶] [영구 삭제 그림 단추(휴지통·X)]. 글자 단추와 네모 ⋯ 칸은 없다.
// 꾹 눌러(PC는 Ctrl+클릭·Shift+클릭 — 기존 고르기 표준 S3) 고르기 모드: 줄 앞 동그라미, 위에 [모두 고르기]·[취소], 아래에 막대 'N개 고름 · 되살리기 · 영구 삭제'.
// 고르기 모드는 줄 그리기 자체가 달라진다(그림 단추 줄을 숨기지 않고 고르기 줄을 그린다 — display:none 땜질 아님). 상태 주인은 select-mode.js 하나.
// 이 파일은 그리기(HTML)와 누르기 연결만 한다. 서버 일은 부르는 화면이 한다(되살리기·영구 삭제 길은 화면마다 이미 있는 것 그대로).
import {createSelectMode} from './select-mode.js';
import {sbActHtml} from './select-bar-model.mjs';
import {partStyles} from './part-styles.js';
await partStyles('trash-row');

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// 16칸 선 그림(글자 색을 따름). 영구 삭제는 휴지통 + 안쪽 X.
export const TRASH_ROW_ICON = Object.freeze({
  restore: 'M5.2 3L2.6 5.6 5.2 8.2M2.8 5.6H9a4 4 0 0 1 0 8H6',
  purge: 'M3 4h10M6 4V2.5h4V4M4.5 4l.7 9h5.6l.7-9M6.9 7l2.2 3.4M9.1 7l-2.2 3.4',
});
const iconBtn = (key, label, attr, disabled) => `<button type="button" class="row-act nxt-q tr-ico tr-ico-${key}" ${attr} aria-label="${esc(label)}" title="${esc(label)}"${disabled ? ' disabled' : ''}>`
  + `<svg viewBox="0 0 16 16" width="17" height="17" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="${TRASH_ROW_ICON[key]}"/></svg></button>`;

// 줄 하나. id·name·whenText(보이는 날짜 글)·whenIso(datetime). picking이면 고르기 줄(그림 단추 없음), 아니면 보통 줄.
// canRestore·canPurge: 그 휴지통에서 할 수 있는 일(없는 일의 그림 단추는 그리지 않는다). busy: 서버 일하는 중(단추 꺼짐).
export function trashRowHtml({id, name, whenText = '', whenIso = '', busy = false, canRestore = true, canPurge = true, picking = false, picked = false, restoreHint = ''} = {}) {
  const title = name || '제목 없음';
  const main = `<span class="tr-main"><span class="tr-name">${esc(title)}</span>${whenText ? `<time class="tr-day" datetime="${esc(whenIso)}"><span class="a11y-only">삭제한 날 </span>${esc(whenText)}</time>` : ''}</span>`;
  if (picking) {
    return `<div class="tr-row tr-pick${picked ? ' is-picked' : ''}" role="option" aria-selected="${picked ? 'true' : 'false'}" tabindex="0" data-tr-row="${esc(id)}"><span class="tr-check" aria-hidden="true"></span>${main}</div>`;
  }
  return `<div class="tr-row" role="listitem" data-tr-row="${esc(id)}">${main}`
    + (canRestore ? iconBtn('restore', `되살리기: ${title}`, `data-tr-restore="${esc(id)}"`, busy || !!restoreHint) : '')
    + (canPurge ? iconBtn('purge', `영구 삭제: ${title}`, `data-tr-purge="${esc(id)}"`, busy) : '') + '</div>';
}
// 줄 묶음 바깥. 고르기 중에는 여러 개 선택하는 목록(listbox), 아니면 보통 목록.
export const trashListOpen = (label, picking = false) => (picking
  ? `<div class="tr-list" role="listbox" aria-multiselectable="true" aria-label="${esc(label)}">`
  : `<div class="tr-list" role="list" aria-label="${esc(label)}">`);

// 고르기 중 위쪽 한 줄: [모두 고르기](누르면 모두 고름·다시 누르면 모두 풀림) · [취소].
export const trashPickHeadHtml = ({total = 0, picked = 0} = {}) => {
  const all = total > 0 && picked >= total;
  return `<div class="tr-pickhead" data-tr-pickhead><button type="button" class="row-act nxt-q tr-text-btn" data-tr-all role="checkbox" aria-checked="${all ? 'true' : 'false'}">전체 선택</button>`
    + '<button type="button" class="row-act nxt-q tr-text-btn" data-tr-cancel>취소</button></div>';
};
// 고르기 중 아래 막대: 'N개 고름 · 되살리기 · 영구 삭제'. 막대는 고른 게 있을 때만 단추가 켜진다. canRestore·canPurge가 아닌 일은 두지 않는다.
export const trashPickBarHtml = ({picked = 0, busy = false, canRestore = true, canPurge = true} = {}) => {
  const off = busy || !picked ? ' disabled' : '';
  return `<div class="kptu-selbar tr-bar" data-tr-bar role="toolbar" aria-label="선택한 휴지통 항목"><span class="kptu-sb-count">${picked}개 선택</span><div class="kptu-sb-acts">`
    + (canRestore ? sbActHtml({attrs: `data-tr-bulk-restore${off}`, label: '되살리기', rank: 10}) : '')
    + (canPurge ? sbActHtml({attrs: `data-tr-bulk-purge${off}`, label: '영구 삭제', danger: true, rank: 20}) : '') + '</div></div>';
};

const HOLD_MS = 500, MOVE_PX = 10;
// 고르기 연결. box: 줄이 들어 있는 상자(여러 번 다시 그려도 상자는 그대로), order(): 지금 보이는 줄 id 차례, onChange(): 다시 그려 달라,
// layer: 폰 뒤로가기 한 겹 이름. 반환 select(select-mode.js)로 상태를 읽는다. 누르기 처리는 상자 하나에 한 번만 붙는다.
export function bindTrashPick(box, {order = () => [], onChange = () => {}, layer = 'trash-pick', enabled = () => true} = {}) {
  const select = createSelectMode({layer, onBack: onChange});
  let hold = null, swallow = false;
  const rowOf = e => e.target.closest?.('[data-tr-row]');
  const outside = e => !!e.target.closest?.('button,a,input,summary');
  box.addEventListener('pointerdown', e => {
    swallow = false;
    clearTimeout(hold?.timer); hold = null;
    if (e.pointerType !== 'touch' || !enabled()) return;
    const row = rowOf(e); if (!row || outside(e)) return;
    hold = {x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      hold = null; swallow = true;
      try { navigator.vibrate?.(10); } catch { /* 진동이 없는 기기 */ }
      select.hold([row.dataset.trRow]); onChange();
    }, HOLD_MS)};
  });
  const cancel = e => { if (!hold) return; if (e.type === 'pointermove' && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < MOVE_PX) return; clearTimeout(hold.timer); hold = null; };
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) box.addEventListener(t, cancel);
  // 손가락 꾹 누름의 기본 메뉴는 막는다(메뉴는 이 줄에 없음).
  box.addEventListener('contextmenu', e => { if (rowOf(e) && (e.pointerType === 'touch' || select.active)) e.preventDefault(); });
  // 손을 뗄 때 따라오는 click은 삼킨다(꾹 눌러 켠 그 줄이 곧바로 풀리지 않게).
  box.addEventListener('click', e => { if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  box.addEventListener('click', e => {
    const row = rowOf(e);
    if (e.target.closest?.('[data-tr-all]')) { toggleAll(); return; }
    if (e.target.closest?.('[data-tr-cancel]')) { select.stop(); onChange(); return; }
    if (!row || outside(e) || !enabled()) return;
    const id = row.dataset.trRow;
    if (select.active) { if (e.shiftKey) select.range(order(), id); else select.toggle([id]); if (!select.size) select.stop(); onChange(); return; }
    if (e.ctrlKey || e.metaKey) { select.start([id], id); onChange(); }
  });
  box.addEventListener('keydown', e => {
    if (!select.active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); select.stop(); onChange(); return; }
    const row = rowOf(e);
    if (row && (e.key === ' ' || e.key === 'Enter') && !outside(e)) { e.preventDefault(); select.toggle([row.dataset.trRow]); if (!select.size) select.stop(); onChange(); }
  });
  function toggleAll() {
    const ids = order(), all = ids.length > 0 && ids.every(id => select.has(id));
    if (all) { select.stop(); } else select.items = new Set(ids);
    onChange();
  }
  // Esc(PC) = 고르기 끝(S6). 초점이 상자 밖이어도 끝낸다.
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && select.active && box.isConnected && !e.defaultPrevented) { select.stop(); onChange(); } });
  return {select, ids: () => [...(select.items || [])]};
}
