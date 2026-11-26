// S69-27 노트 휴지통(사용자 11/24 "지운 노트 어디서봐? 휴지통 보여야함"): 노트 [삭제]는 이미 휴지통으로 간다(basket-record-delete.js
// deleteNoteToTrash, DB 20261026100000_trash_notes_db.sql). 그 노트를 노트 [폴더] 보기 안에서 본다 — 왼쪽 나무(폰은 첫 화면 폴더 상자) 맨 아래
// '휴지통 N' 줄, 누르면 오른쪽(폰은 '그 폴더만' 상자)에 지운 노트(제목·지운 날짜), 줄마다 [되돌리기]와 ⋯ [영구 삭제].
// 서버 길은 사업 관리 휴지통 탭(project-system-v3.js)과 같은 app_trash_list / app_trash_restore / app_trash_purge('note')뿐이고 같은 문구를 쓴다.
// 휴지통 종류 'note'에는 정리함 업데이트도 들어 있어 여기서는 노트(note_kind 'note')만 보인다(업데이트는 사업 관리 휴지통 탭 그대로).
// 그리기 주인은 이 파일 하나(껍데기 basket-notes.js renderList가 paint를 부른다). 상태는 화면 메모리만(기기 저장 없음).
import {ftTrashRowHtml, ftFocusHtml} from './folder-tree-ui.mjs';
import {readTrashKind, restoreFromTrashKind, purgeFromTrashKind} from './trash-rpc.js';
import {TRASH_STATE, TRASH_TEXT, purgeConfirmText, restoredText} from './project-trash-model.mjs';
import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {formatSeoulTime} from './meeting-time.js';
import {askConfirm, notify} from './small-notice.js';

export const NOTE_TRASH = 'note-trash';
export const NOTE_TRASH_NAME = '휴지통';
export const isTrashAt = v => v === NOTE_TRASH;
// 휴지통 줄에 보일 것: 노트만(업데이트 빼기). 가장 최근에 지운 것이 위(normalizeTrashRows 순서 그대로).
export const noteTrashRows = rows => (Array.isArray(rows) ? rows.filter(r => r && r.kind === 'note' && r.note_kind === 'note') : []);
const deletedDay = value => { const d = new Date(value || ''); return Number.isNaN(d.getTime()) ? '' : formatSeoulTime(d, {year:'numeric', month:'numeric', day:'numeric'}); };
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';

// esc: 글자 지우기. rt: 서버. onChange(): 다시 그려 달라(껍데기 renderList). onRestored(): 되돌린 노트를 목록에 다시 올려 달라(껍데기 refresh).
// scope(): 지금 작업공간(늦게 온 답이 다른 작업공간 화면을 바꾸지 않게).
export function createNoteTrash({box, esc, rt = globalThis.window?.KPTURuntime, onChange = () => {}, onRestored = () => {}, scope = () => ''} = {}) {
  let state = TRASH_STATE.UNKNOWN, rows = null, busy = false, seq = 0;
  async function load() {
    const run = ++seq, owner = scope();
    const r = await readTrashKind('note', rt);
    if (run !== seq || owner !== scope()) return;
    state = r.state; rows = state === TRASH_STATE.READY ? noteTrashRows(r.rows) : state === TRASH_STATE.MISSING ? [] : null;
  }
  const count = () => (state === TRASH_STATE.READY && rows ? rows.length : null);
  // 줄 하나(나무·폴더 상자 맨 아래, '+ 새 폴더' 위). 서버에 아직 노트 휴지통이 없으면(DB 적용 전) 줄도 없다.
  function navHtml({tree = false, at = null} = {}) {
    if (state === TRASH_STATE.MISSING) return '';
    const n = count();
    return ftTrashRowHtml({label:NOTE_TRASH_NAME, count:n === null ? '' : n, countLabel:n === null ? '' : `휴지통 노트 ${n}개`, current:tree && at === NOTE_TRASH, tree,
      attrs:{'data-nx-open':NOTE_TRASH, 'data-nx-trash-item':''}});
  }
  function rowHtml(r) {
    const name = r.name || '제목 없음', when = deletedDay(r.deleted_at);
    return `<div class="nxt-row" role="listitem" data-nxt-row="${esc(r.id)}"><span class="nxt-main"><span class="nxt-name">${esc(name)}</span>${when ? `<time class="nxt-day" datetime="${esc(r.deleted_at || '')}"><span class="a11y-only">삭제한 날 </span>${esc(when)}</time>` : ''}</span>`
      + `<button type="button" class="secondary nxt-restore" data-nxt-restore="${esc(r.id)}"${busy ? ' disabled' : ''}>되돌리기</button>`
      + `<details class="nxt-more"><summary class="icon-btn" aria-label="휴지통 관리: ${esc(name)}">${MORE}</summary><div class="nxt-more-panel" role="group" aria-label="휴지통 관리"><button type="button" class="danger nxt-purge" data-nxt-purge="${esc(r.id)}"${busy ? ' disabled' : ''}>영구 삭제</button></div></details></div>`;
  }
  function listHtml() {
    if (state === TRASH_STATE.FAILED) return failHtml({retry:'data-nxt-retry', text:TRASH_TEXT.LOAD_FAILED});
    if (state === TRASH_STATE.MISSING) return emptyHtml(TRASH_TEXT.PREPARING);
    if (!rows) return waitHtml({rows:3, h:36});
    return rows.length ? `<div class="nxt-list" role="list" aria-label="휴지통에 있는 노트">${rows.map(rowHtml).join('')}</div>` : emptyHtml('휴지통 비어 있음', {attrs:'data-nxt-empty'});
  }
  const ICON = '<span class="ft-ico ft-ico-trash" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>';
  // 그리기. at: 지금 자리(NOTE_TRASH일 때만 보인다), phone: 폰 '그 폴더만' 상자, query: 찾는 중이면 숨김, folderView: [폴더] 보기일 때만.
  function paint({at = null, phone = false, query = '', folderView = true} = {}) {
    if (!box) return;
    if (!folderView || query || at !== NOTE_TRASH) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const n = count(), num = n === null ? '' : String(n);
    if (phone) { box.innerHTML = ftFocusHtml({back:{'data-nx-back':''}, trail:[{label:'노트', attrs:{'data-nx-at':''}}], name:NOTE_TRASH_NAME, icon:ICON, count:num, body:listHtml(), attrs:{'data-nxt-focus':''}}); return; }
    box.innerHTML = `<div class="nxt-head">${ICON}<b>${NOTE_TRASH_NAME}</b>${num ? `<span class="nxt-n">${num}</span>` : ''}</div>${listHtml()}`;
  }
  const rowOf = id => (rows || []).find(r => r.id === id) || null;
  async function restore(id, anchor) {
    const row = rowOf(id); if (!row || busy) return;
    busy = true; onChange();
    const owner = scope();
    let r;
    try { r = await restoreFromTrashKind('note', id, rt); } finally { busy = false; }
    if (owner !== scope()) return;
    notify(r.ok ? restoredText('note').replace('글을', '노트를') : r.message, {error:!r.ok, record:false});
    if (r.ok) {
      rows = (rows || []).filter(x => x.id !== id);
      // 다른 화면(사업영역·담당조직 기록 줄 등)도 다시 읽게 — 노트를 지우고 되돌릴 때와 같은 공용 알림.
      window.dispatchEvent(new Event('kptu:basket-links-changed'));
      onRestored(id);
    }
    onChange();
    void load().then(onChange);
    anchor?.isConnected && anchor.focus?.({preventScroll:true});
  }
  async function purge(id, anchor) {
    const row = rowOf(id); if (!row || busy) return;
    const [ask, ...rest] = purgeConfirmText(row).split('\n');
    if (!(await askConfirm(anchor, {text:ask, note:rest.join(' '), ok:'영구 삭제', danger:true})) || busy || !rowOf(id)) return;
    busy = true; onChange();
    const owner = scope();
    let r;
    try { r = await purgeFromTrashKind('note', id, rt); } finally { busy = false; }
    if (owner !== scope()) return;
    notify(r.ok ? TRASH_TEXT.PURGED : r.message, {error:!r.ok, record:false});
    if (r.ok) rows = (rows || []).filter(x => x.id !== id);
    onChange();
    void load().then(onChange);
  }
  box?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b) || b.disabled) return;
    if (b.matches('[data-nxt-retry]')) { state = TRASH_STATE.UNKNOWN; rows = null; onChange(); void load().then(onChange); return; }
    if (b.matches('[data-nxt-restore]')) { void restore(b.dataset.nxtRestore, b); return; }
    if (b.matches('[data-nxt-purge]')) { b.closest('details')?.removeAttribute('open'); void purge(b.dataset.nxtPurge, b.closest('.nxt-row')?.querySelector('summary') || b); }
  });
  // 줄 우클릭(PC)은 공용 context-menu.js가 그 줄의 ⋯(summary)을 연다(role listitem 줄). ⋯ 판은 하나만 열린다. 바깥을 누르거나 Esc면 닫힌다.
  box?.addEventListener('toggle', e => { const d = e.target; if (d?.matches?.('details.nxt-more') && d.open) box.querySelectorAll('details.nxt-more[open]').forEach(x => { if (x !== d) x.open = false; }); }, true);
  globalThis.document?.addEventListener('click', e => { if (box && !e.target.closest?.('details.nxt-more')) box.querySelectorAll('details.nxt-more[open]').forEach(x => { x.open = false; }); });
  box?.addEventListener('keydown', e => { if (e.key !== 'Escape') return; const d = e.target.closest?.('details.nxt-more[open]'); if (!d) return; e.preventDefault(); e.stopPropagation(); d.open = false; d.querySelector('summary')?.focus(); });
  return {load, count, navHtml, paint, isBusy:() => busy, reset() { seq++; state = TRASH_STATE.UNKNOWN; rows = null; busy = false; box?.replaceChildren(); if (box) box.hidden = true; }};
}
