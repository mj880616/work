// S69-27 노트 휴지통(명진 11/24 "지운 노트 어디서봐? 휴지통 보여야함"): 노트 [삭제]는 이미 휴지통으로 간다(basket-record-delete.js
// deleteNoteToTrash, DB 20261026100000_trash_notes_db.sql). 그 노트를 노트 [폴더] 보기 안에서 본다 — 왼쪽 나무(폰은 첫 화면 폴더 상자) 맨 아래
// '휴지통 N' 줄, 누르면 오른쪽(폰은 '그 폴더만' 상자)에 지운 노트(제목·지운 날짜), 줄마다 그림 단추 [되살리기]·[영구 삭제](공용 trash-row.js, 시안 '마').
// 꾹 눌러(PC Ctrl+클릭) 고르면 위 [모두 고르기]·[취소], 아래 막대 'N개 고름 · 되살리기 · 영구 삭제'(일괄도 줄마다 쓰는 서버 길 그대로, 한 개씩).
// 서버 길은 사업 관리 휴지통 탭(project-system-v3.js)과 같은 app_trash_list / app_trash_restore / app_trash_purge('note')뿐이고 같은 문구를 쓴다.
// 휴지통 종류 'note'에는 정리함 업데이트도 들어 있어 여기서는 노트(note_kind 'note')만 보인다(업데이트는 사업 관리 휴지통 탭 그대로).
// 그리기 주인은 이 파일 하나(껍데기 basket-notes.js renderList가 paint를 부른다). 상태는 화면 메모리만(기기 저장 없음).
import {ftTrashRowHtml, ftFocusHtml} from './folder-tree-ui.mjs';
import {readTrashKind, restoreFromTrashKind, purgeFromTrashKind} from './trash-rpc.js';
import {TRASH_STATE, TRASH_TEXT, purgeConfirmText, restoredText} from './project-trash-model.mjs';
import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {formatSeoulTime} from './meeting-time.js';
import {askConfirm, notify} from './small-notice.js';
import {bindRowSwipe} from './row-swipe.js';
import {trashRowHtml, trashListOpen, trashPickHeadHtml, trashPickBarHtml, bindTrashPick} from './trash-row.js';

export const NOTE_TRASH = 'note-trash';
export const NOTE_TRASH_NAME = '휴지통';
export const isTrashAt = v => v === NOTE_TRASH;
// 휴지통 줄에 보일 것: 노트만(업데이트 빼기). 가장 최근에 지운 것이 위(normalizeTrashRows 순서 그대로).
export const noteTrashRows = rows => (Array.isArray(rows) ? rows.filter(r => r && r.kind === 'note' && r.note_kind === 'note') : []);
const deletedDay = value => { const d = new Date(value || ''); return Number.isNaN(d.getTime()) ? '' : formatSeoulTime(d, {year:'numeric', month:'numeric', day:'numeric'}); };

// esc: 글자 지우기. rt: 서버. onChange(): 다시 그려 달라(껍데기 renderList). onRestored(): 되돌린 노트를 목록에 다시 올려 달라(껍데기 refresh).
// scope(): 지금 작업공간(늦게 온 답이 다른 작업공간 화면을 바꾸지 않게).
export function createNoteTrash({box, esc, rt = globalThis.window?.KPTURuntime, onChange = () => {}, onRestored = () => {}, scope = () => ''} = {}) {
  let state = TRASH_STATE.UNKNOWN, rows = null, busy = false, seq = 0;
  const pick = box ? bindTrashPick(box, {order:() => (rows || []).map(r => r.id), onChange:() => onChange(), layer:'note-trash-pick', enabled:() => !busy}) : null;
  const picking = () => !!pick?.select.active;
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
  // 줄 모양(시안 '마', 11/28): 제목·날짜 + 그림 단추 ↶ 되살리기·휴지통X 영구 삭제(공용 trash-row.js). 되살리기는 휴지통에서 꺼내기(ui-words.md).
  // 폰은 줄을 왼쪽으로 밀어도 같은 [되살리기][영구 삭제](다른 휴지통 줄과 같은 밀기 칸). 영구 삭제는 줄마다 묻는다.
  const rowHtml = r => trashRowHtml({id:r.id, name:r.name, whenText:deletedDay(r.deleted_at), whenIso:r.deleted_at || '', busy, picking:picking(), picked:!!pick?.select.has(r.id)});
  // '휴지통 비우기': 휴지통에 보이는 노트 전부를 영구 삭제(머리줄 오른쪽 작은 빨간 글자). 서버 길은 줄마다 쓰는 app_trash_purge 그대로.
  const emptyBtn = (cls = '') => `<button type="button" class="row-act nxt-q nxt-empty ${cls}" data-nxt-empty-all${busy || picking() ? ' disabled' : ''}>휴지통 비우기</button>`;
  function listHtml({bar = false} = {}) {
    if (state === TRASH_STATE.FAILED) return failHtml({retry:'data-nxt-retry', text:TRASH_TEXT.LOAD_FAILED});
    if (state === TRASH_STATE.MISSING) return emptyHtml(TRASH_TEXT.PREPARING);
    if (!rows) return waitHtml({rows:3, h:36});
    if (!rows.length) return emptyHtml('휴지통 비어 있음', {attrs:'data-nxt-empty'});
    const on = picking(), n = pick.select.size;
    return `${bar && !on ? `<div class="nxt-bar">${emptyBtn()}</div>` : ''}${on ? trashPickHeadHtml({total:rows.length, picked:n}) : ''}${trashListOpen('휴지통에 있는 노트', on)}${rows.map(rowHtml).join('')}</div>${on ? trashPickBarHtml({picked:n, busy}) : ''}`;
  }
  const ICON = '<span class="ft-ico ft-ico-trash" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></span>';
  // 그리기. at: 지금 자리(NOTE_TRASH일 때만 보인다), phone: 폰 '그 폴더만' 상자, query: 찾는 중이면 숨김, folderView: [폴더] 보기일 때만.
  function paint({at = null, phone = false, query = '', folderView = true} = {}) {
    if (!box) return;
    if (!folderView || query || at !== NOTE_TRASH) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    if (pick.select.active) { pick.select.prune(new Set((rows || []).map(r => r.id))); if (!pick.select.size) pick.select.stop(); }
    const n = count(), num = n === null ? '' : String(n);
    if (phone) { box.innerHTML = ftFocusHtml({back:{'data-nx-back':''}, trail:[{label:'노트', attrs:{'data-nx-at':''}}], name:NOTE_TRASH_NAME, icon:ICON, count:num, body:listHtml({bar:true}), attrs:{'data-nxt-focus':''}}); return; }
    box.innerHTML = `<div class="nxt-head">${ICON}<b>${NOTE_TRASH_NAME}</b>${num ? `<span class="nxt-n">${num}</span>` : ''}${rows && rows.length && !picking() ? emptyBtn('nxt-empty-head') : ''}</div>${listHtml()}`;
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
  // 비우기: 되돌릴 수 없다는 확인을 거친 뒤에만, 지금 보이는 노트를 하나씩 영구 삭제한다(서버가 줄마다 그 사람 휴지통의 노트인지 다시 확인).
  async function purgeAll(anchor) {
    if (busy || !rows || !rows.length) return;
    const ids = rows.map(r => r.id), n = ids.length;
    if (!(await askConfirm(anchor, {text:`휴지통의 노트 ${n}개를 영구 삭제할까요?`, note:'삭제하면 되돌릴 수 없어요.', ok:'영구 삭제', danger:true})) || busy) return;
    busy = true; onChange();
    const owner = scope();
    let done = 0, fail = '';
    try {
      for (const id of ids) {
        const r = await purgeFromTrashKind('note', id, rt);
        if (!r.ok) { fail = r.message; break; }
        done++;
        if (owner === scope()) rows = (rows || []).filter(x => x.id !== id);
      }
    } finally { busy = false; }
    if (owner !== scope()) return;
    notify(fail ? `${done}개를 영구 삭제했어요. ${fail}` : `노트 ${done}개를 영구 삭제했어요.`, {error:!!fail, record:false});
    onChange();
    void load().then(onChange);
  }
  // 고르기 막대: 고른 노트를 한 개씩(줄마다 쓰는 서버 길 그대로) 되살리거나 영구 삭제한다. 끝나면 고르기를 끝낸다.
  async function bulkRestore() {
    const ids = pick.ids(); if (busy || !ids.length) return;
    busy = true; onChange();
    const owner = scope();
    let done = 0, fail = '';
    try {
      for (const id of ids) {
        const r = await restoreFromTrashKind('note', id, rt);
        if (!r.ok) { fail = r.message; break; }
        done++;
        if (owner === scope()) rows = (rows || []).filter(x => x.id !== id);
      }
    } finally { busy = false; }
    if (owner !== scope()) return;
    pick.select.stop();
    notify(fail ? `${done}개를 되살렸어요. ${fail}` : `노트 ${done}개를 되살렸어요.`, {error:!!fail, record:false});
    if (done) { window.dispatchEvent(new Event('kptu:basket-links-changed')); onRestored(ids[0]); }
    onChange();
    void load().then(onChange);
  }
  async function bulkPurge(anchor) {
    const ids = pick.ids(); if (busy || !ids.length) return;
    if (!(await askConfirm(anchor, {text:`선택한 노트 ${ids.length}개를 영구 삭제할까요?`, note:'삭제하면 되돌릴 수 없어요.', ok:'영구 삭제', danger:true})) || busy) return;
    busy = true; onChange();
    const owner = scope();
    let done = 0, fail = '';
    try {
      for (const id of ids) {
        const r = await purgeFromTrashKind('note', id, rt);
        if (!r.ok) { fail = r.message; break; }
        done++;
        if (owner === scope()) rows = (rows || []).filter(x => x.id !== id);
      }
    } finally { busy = false; }
    if (owner !== scope()) return;
    pick.select.stop();
    notify(fail ? `${done}개를 영구 삭제했어요. ${fail}` : `노트 ${done}개를 영구 삭제했어요.`, {error:!!fail, record:false});
    onChange();
    void load().then(onChange);
  }
  // 폰 줄 밀기(왼쪽): [되살리기][영구 삭제]. 칸만 열고 누를 때만 한다(다른 휴지통 줄과 같은 공용 부품). 고르기 중에는 밀기를 끈다.
  if (box) bindRowSwipe(box, {row:'[data-tr-row]', enabled:() => !busy && !picking(),
    actions:() => ({start:null, end:[{key:'restore', label:'되살리기', tone:'info', icon:'undo'}, {key:'purge', label:'영구 삭제', tone:'danger', icon:'trash'}]}),
    run:(key, el) => { const id = el.dataset.trRow; if (key === 'restore') void restore(id, el); else if (key === 'purge') void purge(id, el); }});
  box?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !box.contains(b) || b.disabled) return;
    if (b.matches('[data-nxt-retry]')) { state = TRASH_STATE.UNKNOWN; rows = null; onChange(); void load().then(onChange); return; }
    if (b.matches('[data-nxt-empty-all]')) { void purgeAll(b); return; }
    if (b.matches('[data-tr-bulk-restore]')) { void bulkRestore(); return; }
    if (b.matches('[data-tr-bulk-purge]')) { void bulkPurge(b); return; }
    if (b.matches('[data-tr-restore]')) { void restore(b.dataset.trRestore, b); return; }
    if (b.matches('[data-tr-purge]')) { void purge(b.dataset.trPurge, b); }
  });
  return {load, count, navHtml, paint, isBusy:() => busy, reset() { seq++; pick?.select.stop(); state = TRASH_STATE.UNKNOWN; rows = null; busy = false; box?.replaceChildren(); if (box) box.hidden = true; }};
}
