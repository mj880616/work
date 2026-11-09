// FORGET-노트고르기(요청함 11/09 13:34, 시안 docs/design/mockups/forget-note-pick.html, 명진 13:37·13:38 결정): 잊지 말기 [노트] 창 제목 줄 앞
// [새 노트 ▾] 단추와 그 아래 작은 고르기 창. 이 파일이 그 단추·작은 창·흐린 마지막 두 줄의 유일한 renderer다.
// - 작은 창: '＋ 새 노트로'(가족 줄은 그 위 '잊지 말기 노트에 더하기') · 노트 이름 찾기 · 최근 노트 · 폴더별 노트.
//   줄은 노트 보드 노트 고르기와 같은 부품(noteTreeRowHtml, 폴더 나무 note-tree.mjs treeRows, basket.css .nbb-pick 줄 모양)이다.
// - 노트 목록은 기존 소유자 RLS 읽기 길(app_notes kind=note)로 창을 열 때 서버에서 읽는다. '최근 노트'는 서버의 고친 때 순(기기 저장 없음).
// - 가족 줄(family)은 AI가 읽지 않는 노트(ai_export_allowed=false)만 읽고 보인다. 저장 함수(note-append.js appendToNote)도 다시 확인한다.
// - 자리는 공용 placeAnchored·followAnchor(단추 바로 아래, 모자라면 위). 닫기: Esc·바깥 누르기·고르기·폰 뒤로가기(라우터 한 겹).
import {iconNode} from './tree-icons.js';
import {noteLineTitle, OUTSIDE, OUTSIDE_NAME} from './note-tree.mjs';
import {noteTreeRowHtml} from './note-tree-row.js';
import {placeAnchored, followAnchor, clearAnchored, bottomInset} from './anchored-popup.js';
import {emptyHtml, waitInlineHtml, failHtml} from './wait-state.js';
import {readNoteFolders} from './note-folders-data.js';
import {pickSections, tailLines, folderNameOf} from './note-pick.mjs';
import {shortFolder} from './note-window.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const enc = encodeURIComponent;
export const LIST_PICK = '잊지 말기 노트에 더하기';

const wsOf = rt => rt.context?.read?.()?.workspace?.id || '';
// 고르기 창에 보일 노트(고친 때 최근 순). 가족 줄은 AI가 읽지 않는 노트만 서버에서 읽는다.
export async function readPickNotes(rt, {family = false} = {}) {
  const ws = wsOf(rt);
  if (!ws) return [];
  const rows = await rt.api(`/rest/v1/app_notes?workspace_id=eq.${enc(ws)}&kind=eq.note${family ? '&ai_export_allowed=is.false' : ''}&select=id,title,raw_text,updated_at,created_at,ai_export_allowed,metadata&order=updated_at.desc&limit=1000`, {singleFlight: false});
  return Array.isArray(rows) ? rows : [];
}

// 작은 고르기 창 하나. current: 지금 고른 것 {kind:'new'|'list'|'note', note?}. onPick(next) — next는 같은 모양({kind:'note', note, folderName}).
let open = null;
export function openNotePick({anchor, rt = window.KPTURuntime, family = false, current = {kind: 'new'}, onPick, onClosed = null}) {
  open?.close();
  const panel = document.createElement('div');
  panel.className = 'nbb-pick note-pick'; panel.dataset.notePick = '';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '넣을 노트 선택'); panel.tabIndex = -1;
  const top = (family ? `<button type="button" class="secondary note-pick-top" data-np-list aria-pressed="${current.kind === 'list'}">${esc(LIST_PICK)}</button>` : '')
    + `<button type="button" class="secondary note-pick-top" data-np-new aria-pressed="${current.kind === 'new'}">＋ 새 노트로</button>`;
  panel.innerHTML = `<div class="note-pick-tops">${top}</div><input type="search" class="nbb-pick-find" data-np-find placeholder="노트 이름 찾기" aria-label="노트 이름 찾기" autocomplete="off" enterkeyhint="search"><div class="nbb-pick-list" data-np-list-box role="group" aria-label="노트 목록">${waitInlineHtml()}</div>`;
  const popover = typeof panel.showPopover === 'function' && 'popover' in panel;
  if (popover) panel.setAttribute('popover', 'manual');
  // 큰 창(.modal) 안에 둔다: 창의 초점 가두기 안에서 움직이고, popover면 맨 위 겹(top layer)으로 그려진다.
  (anchor.closest('.modal') || document.body).append(panel);
  if (popover) { try { panel.showPopover(); } catch { panel.removeAttribute('popover'); } }
  const box = panel.querySelector('[data-np-list-box]'), find = panel.querySelector('[data-np-find]');
  const s = {notes: null, folders: [], q: '', open: new Set(), failed: false};
  const place = () => placeAnchored(panel, anchor, {maxWidth: 300, maxHeight: 420, minHeight: 200, bottomInset: bottomInset()});
  const paint = () => {
    if (s.failed) { box.innerHTML = failHtml({text: '노트를 불러오지 못했어요', retry: 'data-np-retry'}); place(); return; }
    if (!s.notes) { box.innerHTML = waitInlineHtml(); place(); return; }
    if (!s.folders.length) s.open.add(OUTSIDE);
    const {recent, tree} = pickSections({notes: s.notes, folders: s.folders, query: s.q, open: s.open, family});
    const now = current.kind === 'note' ? current.note?.id : '';
    const row = (r, tag = '') => noteTreeRowHtml(r, {folderAttr: 'np-folder', noteAttr: 'np-note', current: r.note?.id === now, tag});
    const parts = [];
    if (recent.length) parts.push(`<p class="note-pick-sec">최근 노트</p>${recent.map(r => row(r, r.path)).join('')}`);
    if (tree.length) parts.push(`${s.q || recent.length ? `<p class="note-pick-sec">${s.q ? '찾은 노트' : '폴더'}</p>` : ''}${tree.map(r => row(r)).join('')}`);
    box.innerHTML = parts.join('') || emptyHtml(s.q ? '맞는 노트 없음' : '노트 없음');
    place();
  };
  const pickNote = id => {
    const note = s.notes?.find(n => n.id === id);
    if (note) finish({kind: 'note', note, folderName: folderNameOf(note, s.folders)});
  };
  let layer = null, stop = null, closed = false;
  const outside = e => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
  function close({focus = false} = {}) {
    if (closed) return;
    closed = true; open = null;
    document.removeEventListener('pointerdown', outside, true);
    stop?.(); clearAnchored(panel);
    const l = layer; layer = null; l?.close();
    if (popover) { try { panel.hidePopover(); } catch { /* 이미 닫힘 */ } }
    panel.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (focus && anchor.isConnected) anchor.focus({preventScroll: true});
    onClosed?.();
  }
  function finish(next) { close({focus: true}); onPick(next); }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !panel.contains(b)) return;
    e.stopPropagation();
    if (b.hasAttribute('data-np-new')) finish({kind: 'new'});
    else if (b.hasAttribute('data-np-list')) finish({kind: 'list'});
    else if (b.dataset.npFolder) { const id = b.dataset.npFolder; if (s.open.has(id)) s.open.delete(id); else s.open.add(id); paint(); box.querySelector(`[data-np-folder="${CSS.escape(id)}"]`)?.focus({preventScroll: true}); }
    else if (b.dataset.npNote) pickNote(b.dataset.npNote);
    else if (b.hasAttribute('data-np-retry')) void load();
  });
  find.addEventListener('input', () => { s.q = find.value.trim().toLowerCase(); paint(); });
  find.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); const first = box.querySelector('[data-np-note]'); if (first) pickNote(first.dataset.npNote); }
    if (e.key === 'ArrowDown') { e.preventDefault(); box.querySelector('button')?.focus(); }
  });
  // Esc는 이 작은 창만 닫는다(큰 창까지 가지 않게, 잡는 단계에서 먼저 막음).
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close({focus: true}); return; }
    if (e.target === find || !(e.target instanceof Element)) return;
    const all = [...panel.querySelectorAll('button')], i = all.indexOf(e.target);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : null;
    if (i < 0 || to === null) return;
    e.preventDefault();
    if (to < 0) find.focus(); else all[Math.min(all.length - 1, to)]?.focus();
  }, true);
  async function load() {
    s.failed = false; s.notes = null; paint();
    try {
      const [notes, folders] = await Promise.all([readPickNotes(rt, {family}), readNoteFolders(rt).catch(() => ({ready: false, folders: []}))]);
      if (closed) return;
      s.notes = notes; s.folders = folders.ready ? folders.folders : [];
    } catch { if (closed) return; s.failed = true; }
    paint();
  }
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  stop = followAnchor(panel, anchor, {place, lost: () => { if (!anchor.isConnected) close(); }});
  layer = window.KPTURouter?.layer?.open('note-pick', {close: () => { layer = null; close({focus: true}); return true; }}) || null;
  paint();
  // 폰(손가락 화면)은 찾기 칸에 바로 초점을 두지 않는다(자판이 목록을 덮지 않게, library-move-picker.js와 같은 규칙).
  (matchMedia('(pointer:coarse)').matches ? panel : find).focus({preventScroll: true});
  void load();
  open = {close};
  return open;
}

// 노트 창 제목 줄 앞 [새 노트 ▾] 단추 + 옆 '📁 폴더 · 끝에 더함' + 아래 흐린 마지막 두 줄.
// start: 처음 고른 것({kind:'new'} 업무 줄, {kind:'list'} 가족 줄). listNote(): 가족 줄 '잊지 말기' 노트(지금 폴더의 것, 없으면 null — 보낼 때 만든다).
// save(value, {value, text, heading}) → {noteId, folderName, message?}: 고른 곳에 쓰는 일(가족 줄은 family-note-send.js가 준다).
//   없으면 기존 노트 끝에 더하기(note-append.js appendToNote — 가족 노트 경계를 저장 함수에서 다시 확인하는 같은 길).
export function createNoteTarget({rt = window.KPTURuntime, family = false, start = {kind: 'new'}, listNote = () => null, listTitle = '잊지 말기', save = null} = {}) {
  let value = start;
  const watchers = [];
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.edwTarget = ''; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  const info = document.createElement('span'); info.className = 'edw-target-info'; info.dataset.edwTargetInfo = '';
  const tail = document.createElement('div'); tail.className = 'edw-target-tail'; tail.dataset.edwTargetTail = '';
  function paint() {
    const kind = value.kind, note = kind === 'note' ? value.note : kind === 'list' ? listNote() : null;
    const name = kind === 'new' ? '새 노트' : kind === 'list' ? listTitle : noteLineTitle(value.note);
    button.textContent = shortFolder(name) + ' ▾';
    button.title = kind === 'new' ? '넣을 곳: 새 노트' : `넣을 곳: '${name}' 노트 끝`;
    button.setAttribute('aria-label', kind === 'new' ? '넣을 곳: 새 노트, 바꾸기' : `넣을 곳: ${name} 노트 끝에 더함, 바꾸기`);
    button.classList.toggle('is-on', kind !== 'new');
    info.hidden = kind === 'new';
    if (kind === 'note') info.replaceChildren(iconNode('folder'), ` ${value.folderName || OUTSIDE_NAME} · 끝에 더함`);
    else info.textContent = '끝에 더함';
    const {lines, more} = tailLines(note);
    tail.hidden = kind === 'new' || !lines.length;
    tail.replaceChildren(...lines.map((line, i) => { const d = document.createElement('div'); d.textContent = (i === 0 && more ? '… ' : '') + line; return d; }));
  }
  button.addEventListener('click', () => {
    openNotePick({anchor: button, rt, family, current: value, onPick: next => { value = next; paint(); watchers.forEach(fn => fn(value)); }});
  });
  paint();
  return {
    button, info, tail, family,
    get: () => value,
    isNew: () => value.kind === 'new',
    watch: fn => { watchers.push(fn); },
    paint,
    async save(input) {
      if (save) return save(value, input);
      if (value.kind !== 'note' || !value.note?.id) throw new Error('넣을 노트를 다시 선택해 주세요.');
      const {appendToNote} = await import('./note-append.js');
      await appendToNote(rt, value.note.id, {doc: input.value, familyOnly: family});
      return {noteId: value.note.id, folderName: value.folderName || '', message: `'${[...noteLineTitle(value.note)].slice(0, 20).join('')}' 노트 끝에 더했어요.`};
    },
    close: () => open?.close(),
  };
}
