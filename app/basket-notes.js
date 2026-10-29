import {waitInlineHtml, emptyHtml} from './wait-state.js';
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import { viewPrefs } from './view-prefs.js';
import { formatSeoulTime } from './meeting-time.js';
// MEMO-노트: the [노트] side of the basket tab. Notes are app_notes rows with kind=note (20261017052234), read and
// written through the existing owner-RLS REST paths in basket-data.js; there is no new save path.
// This module owns everything drawn into its host: list (search, newest change first) → read → edit. The list's own input
// (BASKET-노트입력창: the basket update input, home-quick.js, in its note mode) adds a note; its [크게] opens the shared
// note window (note-window.js, ED③ 노트).
// basket.js owns the [메모 | 노트] switch and decides when this host is shown.
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import { readNoteDocs, readNoteDoc, detachNoteFile, saveNoteDoc, moveToBasket, noteState, validateNoteTitle, validateNoteBody, sortNotes, notePinnedAt, setNotePinned, setNoteFolderRef, setNoteAiOff, setNoteBoard } from './basket-data.js';
// NOTE-비밀메모(17:23 결정): 비밀 모양 글이 든 노트는 줄 제목을 '비밀 메모'로(note-tree.mjs noteLineTitle), 메뉴 [AI에 보내지 않기]/[AI 제외 풀기](metadata.ai_off).
import { noteAiOff } from './note-secret.mjs';
// NOTE-탐색기(2026-10-28 09:24·10:34·11:01): 폴더 안 폴더(app_note_folders, 100단), 한 줄 노트, 끌어 옮기기·선택 모드·되돌리기.
import { readNoteFolders, createNoteFolder, updateNoteFolder, deleteNoteFolder } from './note-folders-data.js';
import { noteFolderId, noteFolderIdLegacy, foldersFromNames, noteLineTitle, noteLineDate, treeRows, paneRows, paneHead, folderPath, canMoveFolder, noteFolderErrorText, OUTSIDE, OUTSIDE_NAME, RECENT, RECENT_NAME, recentRows } from './note-tree.mjs';
import { FOLDER_DEPTH_LIMIT } from './folder-limits.mjs';
import { folderSiblings, nextSortOrder, cleanFolderName } from './library-tree.js';
import { pickerRows } from './library-move.mjs';
import { createMovePicker } from './library-move-picker.js';
import { folderPathHtml } from './folder-path.mjs';
import { createSelectMode } from './select-mode.js';
import { notify, askConfirm } from './small-notice.js';
import { deleteNoteOriginal } from './basket-record-delete.js';
import { mountManualLink } from './basket-manual-link.js';
import { renderMarkdownInto, showPlainText, preloadMarkdown } from './markdown-view.js';
import { copyText } from './copy-text.js';
import { flashDone } from './press-feedback.js'; // UI-눌림느낌: the pressed [복사] turns into '✓' for 1.5s
import { bigWindowOpen } from './big-window-open.js';
// ED③ 노트: the note's body is the new editor (note-body.js); its big window is note-window.js.
import { paintDoc, docCopy, mountEditField, notePhotos } from './note-body.js';
import { prepareSave } from './ed-window-model.mjs';
import { mountQuick } from './home-quick.js';
import { driveFileUrl, fileSize, createUploadBatch, uploadNoteFiles } from './basket-upload.js';
import { fileLine } from './meeting-compact.js';
import { pressFile, downloadFile, openInDrive, menuItemsHtml } from './file-actions.js';
import { openPhotoView } from './photo-view.js';
import { attachmentName } from './attachment-name.mjs';
import { paintHtmlAttachments } from './html-frame.js';
import { placeAnchored, followAnchor, clearAnchored, isWide } from './anchored-popup.js';
import { notePreview, noteCopyPayload, plainLines } from './note-preview.mjs';
// NOTE-보기3가지(요청함 10/29 15:05): [폴더|목록|포스트잇] 세 보기. 고른 보기는 서버(view_prefs.note_view), 포스트잇 자리는 노트 metadata.board.
import { mountNoteBoard } from './note-board.js';
import { folderTone } from './note-board-model.mjs';
import { noteMasked } from './note-secret.mjs';
import { noteMarkdown } from './note-markdown.mjs';
import { basketNoteOrigin, basketReturnHtml } from './basket-note-tasks.js';

const chipKinds = [['project','사업영역'], ['organization','담당조직'], ['meeting','사업 보고'], ['document','자료실'], ['bundle','참고']];
const day = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : formatSeoulTime(d, {year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}); };
// UI-바구니상세개편: [복사] on every note row and in the read view (same conversion as the write window's 텔레그램용 복사).
const MORE_ICON = '<span class="more-dots" aria-hidden="true">⋯</span>';
const PIN_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 2.5h4M7 2.5v4l-2.5 3h7L9 6.5v-4M8 9.5v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
function showToast(message) {
  const toast = document.querySelector('#toast'); if (!toast) return;
  toast.textContent = message; kptuHoldToast(toast);
}
export function mountNotes(host, {esc, rt = window.KPTURuntime, onOpenChange = () => {}, onMovedToBasket = () => {}}) {
  let linkOpen = false, notes = [], links = [], selected = null, editing = false, busy = false, epoch = 0, query = '', loaded = false, bigWriter = null, pendingOpen = null, pendingFolder = null;
  // BUG-뒤로가기: an openSet note is one router layer, so Back returns to the list at the same scroll.
  let layer = null, listScroll = 0;
  // NOTE-탐색기: folders (app_note_folders rows; before the DB is applied, read-only folders made from the names notes hold),
  // the entered folder (at; null = top), the open folders of the phone tree and the PC left tree (screen memory only; nothing is
  // stored on the device), and the selection (null = not in select mode; keys 'n:<note id>' and 'f:<folder id>').
  // 10/28 17:55 폰 '한 화면씩': at null = 첫 화면 폴더 목록, OUTSIDE = '폴더 없음' 노트, 폴더 id = 그 폴더 화면(겹 하나: 갤럭시 뒤로 = 폴더 목록). PC는 null = '최근'(폴더가 있을 때, NOTE-최근5개; 폴더가 없으면 '폴더 없음'), OUTSIDE = '폴더 없음'.
  let folders = [], foldersReady = false, foldersMissing = false, at = null, openSet = new Set(), folderLayer = null;
  // NOTE-탐색기 후속 ⑦: 선택 상태 코드는 자료실과 같은 공용 부품(select-mode.js). 한 겹(basket-note-select)을 열어 폰 뒤로가기가 선택 모드를 끈다.
  const pick = createSelectMode({layer:'basket-note-select', onBack:() => renderList()});
  // NOTE-보기3가지: 지금 보기. 처음은 서버에 기억한 값(없으면 폴더). 이번 접속에서 고른 뒤에는 늦게 온 서버 값으로 덮지 않는다.
  const VIEWS = ['folder', 'list', 'board'];
  const savedView = () => { const v = viewPrefs.get('note_view'); return VIEWS.includes(v) ? v : 'folder'; };
  let view = savedView(), viewChosen = false, board = null;
  window.addEventListener('kptu:view-prefs-ready', () => { if (viewChosen || view === savedView()) return; view = savedView(); if (loaded && !selected) renderList(); });
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  host.innerHTML = `<div data-note-list><div class="home-quick-placeholder" aria-hidden="true"></div><div class="note-list-head"><label class="note-search"><span class="a11y-only">노트 검색</span><input type="search" data-note-search placeholder="노트 검색" autocomplete="off" enterkeyhint="search"></label><span class="nv-switch" role="group" aria-label="노트 보기"><button type="button" data-note-view="folder" aria-pressed="true">폴더</button><button type="button" data-note-view="list" aria-pressed="false">목록</button><button type="button" data-note-view="board" aria-pressed="false">포스트잇</button></span><span class="a11y-only" data-nx-count aria-live="polite"></span><button type="button" class="basket-icon-button note-folder-more" data-note-folder-more data-ctx="off" aria-label="노트 목록 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div><div class="nx-select-bar" data-nx-select-bar role="toolbar" aria-label="고른 노트" hidden><span data-nx-select-count></span><button type="button" data-nx-sel-move>폴더로 옮기기</button><button type="button" data-nx-sel-delete>지우기</button><button type="button" data-nx-sel-all>전체 고르기</button><button type="button" class="nx-sel-close" data-nx-sel-close aria-label="선택 끝내기">✕</button></div><nav class="fp-path nx-where" data-nx-where aria-label="지금 위치" hidden></nav><p class="note-folder-status" data-note-folder-status role="status" hidden></p><div data-note-list-status role="status"></div><button type="button" data-note-retry hidden>다시 시도</button><div class="nx-body" data-nx-body><div class="nx-tree" data-nx-tree role="tree" aria-label="노트 폴더" hidden></div><div class="nx-pane"><div class="nx-here" data-nx-here hidden></div><div class="nx-recent" data-nx-recent role="group" aria-label="최근 노트" hidden></div><div data-note-rows id="noteRows" class="nx-rows"></div></div></div><div class="nb" data-note-board hidden></div></div><div data-note-detail hidden></div><div id="noteDocMenu" class="basket-more-menu note-pop-menu" role="group" aria-label="노트 메뉴" hidden></div>`;
  // BASKET-노트입력창 (2026-10-22 사용자 결정): notes are added like updates — the same input box at the top of the list on a PC
  // and docked above the tabs on a phone — instead of the old [+ 노트] (phone: floating ⊕).
  const quick = mountQuick({root:host.querySelector('[data-note-list]'), esc, noteOnly:true, view:'basket', idPrefix:'basketNote',
    onSaved:saved => noteAdded(saved, {open:false}), onBig:(text, upload) => openNew(text, upload), onFolder:trigger => openAddPicker(trigger)});
  const list = host.querySelector('[data-note-list]'), detail = host.querySelector('[data-note-detail]'), status = host.querySelector('[data-note-list-status]');
  // UI-노트고정: pinned notes first, then by last change.
  const sorted = () => sortNotes(notes);
  const chips = note => links.filter(l => l.note_id === note.id && l.status === 'confirmed').map(link => {
    const [kind, label] = chipKinds.find(([key]) => link[key + '_id']) || ['other', '연결'];
    const name = link[kind]?.name || link[kind]?.title || link[kind]?.series_name || '연결 대상 없음';
    return `<span class="basket-chip" data-chip-kind="${esc(kind)}"><span class="basket-chip-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}</span>`;
  }).join('');
  const matches = note => !query || `${note.title || ''}\n${note.raw_text || ''}`.toLowerCase().includes(query);
  const folderOf = note => foldersReady ? noteFolderId(note, folders) : noteFolderIdLegacy(note, folders);
  const folderById = id => folders.find(f => f.id === id) || null;
  const folderName = id => folderById(id)?.name || null;
  // NOTE-최근5개: 폴더가 하나라도 있으면 첫 화면 맨 위에 '최근'(폰: 폴더 목록 위 5줄, PC: 왼쪽 나무 맨 위 항목 = 처음 여는 곳).
  // 폴더가 없으면 노트가 이미 한 목록이라 따로 두지 않는다. 들어간 폴더 id는 at이 폴더일 때만(folderAt).
  const showRecent = () => folders.length > 0;
  const folderAt = () => at && at !== OUTSIDE && folderById(at) ? at : null;
  const wideList = window.matchMedia('(min-width:1024px)');
  const sortList = list => sortNotes(list);
  const isPicked = key => !!pick.has(key);
  const pickBox = key => `<span class="nx-pick" aria-hidden="true">${isPicked(key) ? '✓' : ''}</span>`;
  function folderRowHtml(r, {tree = false} = {}) {
    const key = 'f:' + r.id, current = tree && at === r.id;
    return `<div class="nx-row nx-folder${isPicked(key) ? ' nx-picked' : ''}${current ? ' nx-current' : ''}" data-nx-folder="${esc(r.id)}" draggable="${canDrag() ? 'true' : 'false'}" style="--nx-indent:${r.indent}"${tree ? ' role="treeitem"' : ''}><button type="button" class="nx-main" data-nx-open="${esc(r.id)}"${tree ? ` aria-expanded="${r.open}"` : ''}${current ? ' aria-current="true"' : ''}>${pick.active ? pickBox(key) : ''}<span class="nx-ico" aria-hidden="true">${r.open || current ? '\u{1F4C2}' : '\u{1F4C1}'}</span><span class="nx-name">${esc(r.name)}</span><span class="nx-num" aria-label="노트 ${r.count}개">${r.count}</span></button><button type="button" class="basket-row-more nx-more" data-nx-folder-more="${esc(r.id)}" aria-label="${esc(r.name)} 폴더 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div>`;
  }
  // '폴더 없음'(17:45 ④, 옛 '폴더 밖'): 나무·폴더 목록 맨 아래, 바로 밑에 [+ 새 폴더](폴더 표가 있을 때).
  const outsideHere = () => at === OUTSIDE || (at === null && !showRecent());
  const outsideRowHtml = (r, {tree = false} = {}) => `<div class="nx-row nx-outside${tree && outsideHere() ? ' nx-current' : ''}" data-nx-outside style="--nx-indent:0"${tree ? ' role="treeitem"' : ''}><button type="button" class="nx-main" data-nx-open="${OUTSIDE}"${tree && outsideHere() ? ' aria-current="true"' : ''}><span class="nx-ico" aria-hidden="true">\u{1F5C2}</span><span class="nx-name">${OUTSIDE_NAME}</span><span class="nx-num" aria-label="노트 ${r.count}개">${r.count}</span></button></div>`;
  // PC 왼쪽 나무 맨 위 '최근'(누르면 오른쪽에 최근 5개). 끌어 놓을 곳이 아니다(폴더가 아님).
  const recentTreeRowHtml = () => `<div class="nx-row nx-recent-item${at === null ? ' nx-current' : ''}" data-nx-recent-item style="--nx-indent:0" role="treeitem"><button type="button" class="nx-main" data-nx-open="${RECENT}"${at === null ? ' aria-current="true"' : ''}><span class="nx-ico" aria-hidden="true">\u{1F552}</span><span class="nx-name">${RECENT_NAME}</span></button></div>`;
  const newFolderRowHtml = () => canEditFolders() && !pick.active ? '<button type="button" class="nx-new-folder" data-nx-new-top>+ 새 폴더</button>' : '';
  const canDrag = () => view === 'folder' && foldersReady && !query && wideList.matches;
  // ② one line: title (own → AI title → first line) + 📎 when files + date. No preview, no link chips.
  function noteRowHtml(r) {
    const note = r.note, title = noteLineTitle(note), name = [...title].slice(0, 40).join(''), key = 'n:' + note.id;
    return `<div class="basket-row-item note-row-item nx-row nx-note${isPicked(key) ? ' nx-picked' : ''}" data-nx-note="${esc(note.id)}"${r.recent ? ' data-nx-recent-row' : ''} draggable="${canDrag() ? 'true' : 'false'}" style="--nx-indent:${r.indent}"><button type="button" class="basket-row-more" data-note-row-more="${esc(note.id)}" aria-label="${esc(name)} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button><button type="button" class="basket-row note-row" data-note-row="${esc(note.id)}"${pick.active ? ` aria-pressed="${isPicked(key)}"` : ''}>${pick.active ? pickBox(key) : ''}<b class="basket-title">${notePinnedAt(note) ? `<span class="note-pin" data-note-pinned>${PIN_ICON}<span class="a11y-only">고정됨: </span></span>` : ''}<span class="basket-title-text">${esc([...title].slice(0, 80).join(''))}</span></b>${r.path ? `<span class="nx-path"${r.tone ? ` data-tone="${r.tone}"` : ''}${r.recent ? ' data-nx-recent-folder' : ''}>${r.recent ? '<span class="a11y-only">폴더: </span>' : ''}${esc(r.path)}</span>` : ''}${note.attachments?.length ? `<span class="nx-clip" aria-label="첨부 ${note.attachments.length}개">\u{1F4CE}</span>` : ''}<time datetime="${esc(note.updated_at || '')}" title="고친 날 ${esc(day(note.updated_at))}">${esc(noteLineDate(note.updated_at))}</time></button></div>`;
  }
  const rowHtml = (r, opts) => r.type === 'folder' ? folderRowHtml(r, opts) : r.type === 'outside' ? outsideRowHtml(r, opts) : noteRowHtml(r);
  function paintWhere() {
    const nav = host.querySelector('[data-nx-where]'), path = at ? folderPath(folders, at) : [];
    // NOTE-탐색기 후속 ⑧: 자료실과 같은 위치 줄 부품(folder-path.mjs, 모양 base-ui.css .fp-path). 17:45·17:55: 맨 위 폴더는 '개발 · 7' 한 줄로 충분해
    // 위치 줄은 폴더 안 폴더(2단 이상)일 때만 보인다.
    nav.hidden = path.length < 2 || !!query;
    nav.innerHTML = path.length >= 2 ? folderPathHtml({rootLabel:'노트', trail:path, attr:'data-nx-at', esc}) : '';
    // 위에 작게 '개발 · 7'(PC), 폰 폴더 화면은 '← 개발 · 7'. 폰 첫 화면(폴더 목록)·찾는 중에는 없음.
    const here = host.querySelector('[data-nx-here]'), wide = wideList.matches, show = view === 'folder' && !query && (wide || at !== null) && (wide || folders.length > 0 || at !== null);
    here.hidden = !show;
    if (!show) { here.replaceChildren(); return; }
    const h = wide && at === null && showRecent() ? {name:RECENT_NAME, count:recentRows({folders, notes, folderOf}).length} : paneHead({folders, notes, folderOf, at});
    here.innerHTML = `${wide ? '' : '<button type="button" class="nx-back" data-nx-back aria-label="폴더 목록으로">←</button>'}<span class="nx-here-name">${esc(h.name)}</span><span class="nx-here-num"> · ${h.count}</span>`;
  }
  function paintSelectBar() {
    const bar = host.querySelector('[data-nx-select-bar]');
    bar.hidden = !pick.active;
    if (pick.active) { host.querySelector('[data-nx-select-count]').textContent = `${pick.size}개 골랐음`; bar.querySelectorAll('[data-nx-sel-move],[data-nx-sel-delete]').forEach(b => { b.disabled = !pick.size || busy; }); }
    list.classList.toggle('nx-selecting', !!pick.active);
  }

  // NOTE-보기3가지 ③ 목록 보기: 모든 노트를 최근에 고친 순서로 한 줄씩, 오른쪽에 폴더 이름 꼬리표(폴더 색)와 날짜. 찾는 중이면 맞는 노트만.
  const byChange = (a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0) || String(b.id).localeCompare(String(a.id));
  const listViewRows = m => notes.filter(n => !m || m(n)).sort(byChange).map(note => { const fid = folderOf(note), name = fid ? folderName(fid) : null; return {type:'note', note, indent:0, path:name || '', tone:name ? folderTone(fid) : ''}; });
  // ④ 포스트잇 칸 글: 제목 + 앞 2~3줄 + 폴더 이름. 비밀 모양 노트(note-secret.mjs)는 본문 줄을 보이지 않는다(줄 제목과 같은 규칙).
  function boardText(note, fid) {
    const title = [...noteLineTitle(note)].slice(0, 60).join('');
    const lines = noteMasked(note) ? [] : plainLines(note.raw_text).filter((line, i) => !(i === 0 && line.trim() === title.trim())).slice(0, 3);
    return {title, text:[...lines.join('\n')].slice(0, 140).join(''), folder:fid ? folderName(fid) || '' : ''};
  }
  // 포스트잇 자리 저장: 옮긴 칸, 그리고 처음 옮길 때 아직 저장 안 된 칸들도 지금 보이던 자리 그대로(다른 칸이 튀지 않게). 실패하면 다시 그려 서버 자리로.
  const boardSaving = new Set();
  async function saveBoard(id, next, before) {
    const owner = scope(), jobs = [[id, next]];
    for (const [nid, p] of before) if (nid !== id && !p.saved && !boardSaving.has(nid)) jobs.push([nid, {x:p.x, y:p.y, r:p.r, z:p.z}]);
    const local = (nid, b) => { notes = notes.map(n => n.id === nid ? {...n, metadata:{...(n.metadata && typeof n.metadata === 'object' ? n.metadata : {}), board:b}} : n); };
    for (const [nid, b] of jobs) local(nid, b); // 화면은 바로 그 자리(서버 답을 기다리지 않음)
    let failed = 0;
    const work = jobs.map(([nid, b]) => async () => {
      const note = notes.find(n => n.id === nid); if (!note) return;
      boardSaving.add(nid);
      try { const saved = await setNoteBoard(note, b, rt); if (owner === scope() && saved?.metadata) notes = notes.map(n => n.id === nid ? {...n, metadata:saved.metadata} : n); }
      catch { failed++; } finally { boardSaving.delete(nid); }
    });
    for (let i = 0; i < work.length; i += 4) await Promise.all(work.slice(i, i + 4).map(run => run())); // 한 번에 넷씩
    if (owner !== scope()) return;
    if (failed) { showToast('포스트잇 자리를 저장하지 못했어요. 다시 불러올게요.'); await refresh(); }
  }
  function paintBoard(m) {
    const box = host.querySelector('[data-note-board]');
    board ??= mountNoteBoard(box, {esc, cardText:boardText, moreIcon:MORE_ICON, onMove:(id, next, before) => void saveBoard(id, next, before),
      onMenu:(btn, x, y) => { window.KPTUContextMenu?.pinAt?.(btn, x, y); rowMenu(btn); }});
    board.paint({notes, folderOf, visible:m ? new Set(notes.filter(m).map(n => n.id)) : null, pickActive:!!pick.active, isPicked:id => isPicked('n:' + id)});
  }
  function paintViewSwitch() {
    host.querySelectorAll('[data-note-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.noteView === view)));
    list.dataset.notesView = view;
    host.querySelector('[data-note-board]').hidden = view !== 'board';
    host.querySelector('[data-nx-body]').hidden = view === 'board';
  }
  // ① 보기 바꾸기: 서버에 기억(폰·PC 같음). DB 적용 전에는 거절되어 이번 접속만 기억한다(rejectable).
  function setView(next) {
    if (!VIEWS.includes(next) || next === view) return;
    viewChosen = true; view = next;
    if (view !== 'folder') at = null;
    viewPrefs.set('note_view', view, {rejectable:true});
    renderList();
    window.scrollTo({top:0, behavior:'instant'});
  }
  function renderList() {
    if (view !== 'folder') at = null;
    if (at && at !== OUTSIDE && !folderById(at)) at = null;
    if (!wideList.matches) syncFolderLayer();
    quick.setFolder(folderName(addTarget()));
    const wide = wideList.matches, tree = host.querySelector('[data-nx-tree]'), rowsBox = host.querySelector('[data-note-rows]'), recentBox = host.querySelector('[data-nx-recent]');
    const m = query ? matches : null;
    list.classList.toggle('nx-wide', wide);
    paintViewSwitch();
    if (view !== 'folder') {
      tree.hidden = true; tree.replaceChildren(); recentBox.hidden = true; recentBox.replaceChildren();
      if (view === 'list') rowsBox.innerHTML = listViewRows(m).map(r => rowHtml(r)).join('');
      else { rowsBox.replaceChildren(); paintBoard(m); }
    } else if (wide) {
      tree.hidden = false;
      const left = treeRows({folders, notes, folderOf, root:null, isOpen:id => openSet.has(id), foldersOnly:true});
      const outCount = notes.filter(n => folderOf(n) === null).length;
      // 17:45 ①②: 폴더는 왼쪽 나무에만, 오른쪽은 고른 폴더의 노트 한 줄씩.
      tree.innerHTML = (showRecent() ? recentTreeRowHtml() : '') + left.map(r => rowHtml(r, {tree:true})).join('') + outsideRowHtml({count:outCount}, {tree:true}) + newFolderRowHtml();
      // NOTE-최근5개: PC 처음(at null)은 오른쪽에 최근 5개(폴더가 있을 때). 찾는 중이면 지금처럼 맞는 노트 전부.
      const pc = !m && at === null && showRecent() ? recentRows({folders, notes, folderOf}) : paneRows({folders, notes, folderOf, at, matches:m, sort:sortList});
      rowsBox.innerHTML = pc.map(r => rowHtml(r)).join('');
      recentBox.hidden = true; recentBox.replaceChildren();
    } else {
      tree.hidden = true; tree.replaceChildren();
      // 17:55 폰 한 화면씩: 첫 화면 폴더 목록 → 누르면 그 폴더(하위 폴더 줄 먼저, 그다음 노트).
      const rows = paneRows({folders, notes, folderOf, at, matches:m, phone:true, sort:sortList});
      rowsBox.innerHTML = rows.map(r => rowHtml(r)).join('') + (!m && at === null && folders.length ? newFolderRowHtml() : '');
      // NOTE-최근5개: 폰 첫 화면(폴더 목록) 맨 위 '최근' 5줄(노트 한 줄과 같은 모양, 오른쪽에 작은 폴더 이름).
      const recent = !m && at === null && showRecent() ? recentRows({folders, notes, folderOf}) : [];
      recentBox.hidden = !recent.length;
      recentBox.innerHTML = recent.length ? `<div class="nx-sec" aria-hidden="true">${RECENT_NAME}</div>${recent.map(r => rowHtml(r)).join('')}` : '';
    }
    paintWhere(); paintSelectBar();
    host.querySelector('[data-nx-count]').textContent = loaded ? `노트 · ${notes.length}` : '';
    if (!loaded) return;
    // UI-일기손질 ⑤: an empty note list stays empty (no guide sentence); only a search with no hit says so.
    const hits = query ? notes.filter(matches).length : notes.length;
    status.innerHTML = query && !hits ? emptyHtml('맞는 노트 없음') : '';
    status.toggleAttribute('data-basket-empty', !hits);
  }
  wideList.addEventListener?.('change', () => { if (loaded && !selected) renderList(); });
  async function refresh() {
    if (busy) return;
    const run = ++epoch, owner = scope();
    status.innerHTML = waitInlineHtml(); host.querySelector('[data-note-retry]').hidden = true;
    try {
      const [result, fold] = await Promise.all([readNoteDocs(rt), readNoteFolders(rt)]);
      if (run !== epoch || owner !== scope()) return;
      notes = result.notes; links = result.links; loaded = true;
      foldersReady = fold.ready; foldersMissing = !!fold.missing; folders = fold.ready ? fold.folders : foldersFromNames(notes);
      // NAV-새로고침제자리: the folder entered before a reload (?folder=) is entered again once the folders are read.
      if (pendingFolder) { const id = pendingFolder; pendingFolder = null; if (id === OUTSIDE || folderById(id)) enter(id, {focus:false}); else renderList(); } else renderList();
      if (pendingOpen) { const id = pendingOpen; pendingOpen = null; if (notes.some(n => n.id === id)) open(id); }
    } catch {
      if (run !== epoch || owner !== scope()) return;
      notes = []; links = []; loaded = false; host.querySelector('[data-note-rows]').replaceChildren();
      status.textContent = '노트를 불러오지 못했어요. 다시 시도해 주세요.';
      host.querySelector('[data-note-retry]').hidden = false;
    }
  }

  // UI-상단줄제목: the open note's title goes to the PC top line's place (topbar-actions.js kptu:where-item); null drops it.
  const sendWhere = name => window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'basket', name, kind:'note'}}));
  // ED③ 노트: the body is the new editor (field, mounted by startEdit); the [마크다운] box is gone (결정 11 가; metadata.markdown is kept).
  let field = null, fieldBase = null;
  const fields = () => ({title: detail.querySelector('[data-note-title-input]')});
  const textDirty = () => { if (!selected || !editing) return false; const f = fields(); return f.title.value !== (selected.title || '') || !!field?.isChanged(); };
  // A note with only HTML hides its empty body box; focus then goes to the HTML area (or, with other files only, the file cards).
  const readFocus = () => { const text = detail.querySelector('[data-basket-read-text]'), views = detail.querySelector('[data-basket-html-views]');
    return !text.hidden ? text : views.childElementCount ? views : detail.querySelector('[data-note-attachments]'); };
  // The message goes to the open note's status line, or to the list's when the action came from a list row.
  const report = text => { if (selected) say(text); else status.textContent = text; };
  const say = text => { const p = detail.querySelector('[data-basket-status]'); if (p) p.textContent = text; };
  const lock = value => { busy = value; detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => { el.disabled = value; }); if (!value) manual.controls(); };
  // UI-노트메뉴정리: one ⋯ menu for the list rows and the open note. 고정/고정 해제 · 수정 · (연결하기 · 바구니로 돌리기) · 삭제,
  // in this order; the list rows leave out the two that need the open note. It opens where it was pressed (anchored-popup.js,
  // PC and phone alike: a small list under the ⋯, kept inside the window) and closes on Esc, outside press, or choosing.
  let menu = null;
  const menuEl = () => host.querySelector('#noteDocMenu');
  // NOTE-탐색기 ③ (11:01 결정): the row menu starts with [선택] (PC right-click and phone long-press open this same menu). In select
  // mode the menu of a picked row is for all picked ones. A folder row has its own menu; the list head ⋯ has [새 폴더]·[선택].
  // UI-모바일노트복사메뉴: on a phone a list row has no [복사] button; [복사] is in its ⋯ menu (PC keeps the button).
  // NOTE-파일붙이기: a file card's ⋯ has one item, [빼기] (the link only; the Drive file stays).
  const canEditFolders = () => foldersReady;
  const menuItems = (note, from) => {
    if (from === 'file') return [['data-note-file-detach', '빼기']];
    if (from === 'picked') return [['data-nx-sel-move', `${pick.size}개 — 폴더로 옮기기`], ['data-nx-sel-delete', '지우기', 'basket-menu-danger'], ['data-nx-sel-close', '선택 끝내기']];
    if (from === 'folder') return [['data-nx-select', '선택'], ['data-nx-enter', '이 폴더로 들어가기'], ...(canEditFolders() ? [['data-nx-new-in', '새 폴더'], ['data-nx-rename', '이름 바꾸기'], ['data-nx-move-folder', '옮기기…'], ['data-nx-delete-folder', '폴더 지우기', 'basket-menu-danger']] : [])];
    // FEAT-1029 ④: [성명·보도자료 초안] opens the draft window (press-draft.js); it saves a note only when [노트로 저장] is pressed.
    if (from === 'head') return [...(canEditFolders() ? [['data-nx-new-in', folderAt() ? '이 폴더에 새 폴더' : '새 폴더']] : []), ['data-nx-select', '선택'], ...(folderAt() ? [['data-nx-up', '위 폴더로']] : []), ['data-press-draft-open', '성명·보도자료 초안']];
    return [
      ...(from === 'list' ? [['data-nx-select', '선택']] : []),
      // 17:45 ③: 줄의 복사 아이콘은 없앴다 — 복사는 PC·폰 모두 이 메뉴(⋯·우클릭·꾹 누르기) 안.
      ...(from === 'list' && noteCopyPayload(note) ? [['data-note-copy', '복사']] : []),
      ['data-note-pin', notePinnedAt(note) ? '고정 해제' : '고정'], ['data-note-folder-move', '폴더로 옮기기'], ['data-note-edit', '수정'],
      ...(from === 'detail' ? [['data-basket-link-open', '연결하기'], ['data-note-to-basket', '정리함으로 돌리기']] : []),
      ['data-note-ai-off', noteAiOff(note) ? 'AI 제외 풀기' : 'AI에 보내지 않기'],
      ['data-note-delete', '삭제', 'basket-menu-danger']];
  };
  // FILE-누르면동작: a stored attachment as the shared file shape (file-actions.js).
  const noteFile = (note, fileId) => { const f = (note?.attachments || []).find(x => x.drive_file_id === fileId); return f ? {name: attachmentName(f), mime: f.mime_type, driveId: fileId, noteId: note.id} : null; };
  const fileFail = text => say(text);
  function pressNoteFile(el) {
    const file = noteFile(selected, el.closest('[data-note-file]')?.dataset.noteFile); if (!file) return;
    void pressFile(file, {viewPhoto: () => openPhotoView({row: selected, file: selected.attachments.find(x => x.drive_file_id === file.driveId), trigger: el}), onError: fileFail});
  }
  host.addEventListener('keydown', e => { const el = e.target.closest?.('[data-note-file] .file-line-main'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pressNoteFile(el); } });
  function closeMenu({focus = false} = {}) {
    if (!menu) return null;
    const closed = menu, el = menuEl(); menu = null; closed.stop();
    // The items stay in the (hidden) menu until the next open: basket.js's own click handler runs after this one and must still see the pressed button inside this host.
    el.hidden = true; clearAnchored(el);
    closed.trigger.setAttribute('aria-expanded', 'false');
    if (focus && closed.trigger.isConnected) closed.trigger.focus({preventScroll: true});
    return closed;
  }
  function openMenu(trigger, note, from, fileId = null, folderId = null) {
    if (!note && !['folder', 'head', 'picked'].includes(from)) return;
    if (menu?.trigger === trigger) { closeMenu({focus: true}); return; }
    closeMenu();
    const el = menuEl();
    el.setAttribute('aria-label', from === 'folder' || from === 'head' ? '폴더 메뉴' : from === 'file' ? '첨부 파일 메뉴' : from === 'picked' ? '고른 것 메뉴' : '노트 메뉴');
    el.innerHTML = (from === 'file' ? menuItemsHtml(noteFile(note, fileId)) : '') + menuItems(note, from).map(([attr, label, cls]) => `<button type="button" ${attr}${cls ? ` class="${cls}"` : ''}>${label}</button>`).join('');
    el.hidden = false;
    const place = () => placeAnchored(el, trigger, {maxWidth: 220, maxHeight: 320});
    place();
    menu = {noteId: note?.id ?? null, from, fileId, folderId, trigger, stop: followAnchor(el, trigger, {place, lost: () => closeMenu()})};
    trigger.setAttribute('aria-expanded', 'true');
    el.querySelector('button')?.focus({preventScroll: true});
  }
  const manual = mountManualLink({esc, rt, getNote:() => selected, getLinks:() => links, isBusy:() => busy, setBusy:lock,
    onLinked:linked, onNoteChanged:() => reload(), onModeChange:() => paintMode(), onTaskRecorded:() => {}, sheetId:'noteLinkChoice'});

  async function linked(noteId, targets) {
    for (const target of targets) {
      const key = target.kind === 'project' ? 'project_id' : target.kind === 'reference' ? 'bundle_id' : 'organization_id', named = target.kind === 'reference' ? 'bundle' : target.kind;
      if (!links.some(l => l.note_id === noteId && l[key] === target.target_id && l.status === 'confirmed')) links.push({note_id:noteId, status:'confirmed', [key]:target.target_id, [named]:{name:target.name}});
    }
    renderList(); if (selected?.id === noteId) paintMeta();
    const owner = scope();
    try { const fresh = await readNoteDocs(rt); if (owner !== scope()) return {ok:false, stale:true}; notes = fresh.notes; links = fresh.links; renderList();
      if (selected?.id === noteId) { selected = notes.find(n => n.id === noteId) || selected; paintMeta(); }
      return {ok:true}; }
    catch { return {ok:false}; }
  }
  function paintMeta() {
    if (!selected) return;
    const box = detail.querySelector('[data-note-meta]'), tags = chips(selected);
    const folder = folderName(folderOf(selected));
    box.innerHTML = `${folder ? `<span class="note-meta-folder" data-note-meta-folder>폴더 ${esc(folder)}</span>` : ''}${noteAiOff(selected) ? '<span class="note-meta-ai-off" data-note-meta-ai-off>AI 제외</span>' : ''}${tags ? `<span class="basket-note-state">${tags}</span>` : `<span class="basket-note-state"><span class="basket-state-text">${esc(noteState(selected, links).status === '확정' ? '분류 완료' : '연결 없음')}</span></span>`}<time>고친 날 ${esc(day(selected.updated_at))}</time>`;
    // UI-일기손질 ⑥: each attachment is the shared file line (meeting-compact.js) with a small [Drive에서 열기] at its end.
    // NOTE-파일붙이기: and a ⋯ after it whose one item, [빼기], takes the file off this note (the Drive file stays).
    // FILE-누르면동작: pressing the line acts by kind (file-actions.js); the small [Drive에서 열기] stays and the ⋯ holds [Drive에서 열기] [내려받기] [빼기].
    const attBox = detail.querySelector('[data-note-attachments]');
    attBox.innerHTML = (selected.attachments || []).map(file => {
      const url = driveFileUrl(file.drive_file_id), name = attachmentName(file);
      const link = url ? `<a class="file-line-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)} Drive에서 열기">Drive에서 열기</a>` : '<span class="file-line-state">링크를 확인할 수 없습니다.</span>';
      const more = `<button type="button" class="basket-icon-button note-file-more" data-note-file-more="${esc(file.drive_file_id)}" aria-label="${esc(name)} 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button>`;
      return fileLine({name, meta:fileSize(file.size_bytes), cls:'note-file-line', end:link + more, attrs:` data-note-file="${esc(file.drive_file_id)}"`});
    }).join('');
    attBox.querySelectorAll('.file-line-main').forEach(el => { el.setAttribute('role', 'button'); el.tabIndex = 0; });
  }
  // UI-상단줄제목: with the PC top line (1024px~) the open note's title is already in the place, so the head has no title line of its
  // own there (the element is not made); below that width it is made, as before.
  const toplineWide = window.matchMedia('(min-width:1024px)');
  function syncHeadTitle() {
    const main = detail.querySelector('[data-note-head-main]'); if (!main || !selected) return;
    const has = main.querySelector('[data-note-read-title]');
    if (toplineWide.matches) { has?.remove(); return; }
    if (has) return;
    const h = document.createElement('h3'); h.className = 'note-head-title'; h.dataset.noteReadTitle = ''; h.textContent = selected.title || '노트'; main.prepend(h);
  }
  toplineWide.addEventListener?.('change', syncHeadTitle);
  function paintRead() {
    syncHeadTitle();
    const title = detail.querySelector('[data-note-read-title]'), text = detail.querySelector('[data-basket-read-text]'), raw = selected.raw_text || '';
    if (title) title.textContent = selected.title || '노트';
    sendWhere(selected.title || '제목 없음');
    detail.querySelector('[data-note-telegram]').hidden = !noteCopyPayload(selected);
    const owner = scope(), id = selected.id;
    // BUG-노트HTML표시: .html attachments show in the same sandboxed frames as the memo read view (html-frame.js),
    // under the body text. A note whose only content is HTML has no "no body" sentence.
    const htmlCount = id ? paintHtmlAttachments(detail.querySelector('[data-basket-html-views]'), {noteId:id, attachments:selected.attachments, rt, isCurrent:() => owner === scope() && selected?.id === id}) : 0;
    // NOTE-파일붙이기: a note made of files only (any kind) shows just its file cards, without the "no body" box.
    const files = (selected.attachments || []).length;
    text.hidden = !raw && (htmlCount > 0 || files > 0);
    text.classList.toggle('basket-read-empty', !raw);
    if (!raw) return showPlainText(text, htmlCount || files ? '' : '본문이 없는 노트입니다.');
    // ED③ 노트: a note saved in the new editor reads its saved form (ed-render: headings, tables, colours, photos of this note).
    if (paintDoc(text, selected, {rt})) return;
    showPlainText(text, raw);
    // NOTE-마크다운선택: a note with 마크다운 off is shown exactly as written (no list, heading or indent made from its lines).
    text.dataset.noteView = noteMarkdown(selected) ? 'markdown' : 'plain';
    if (!noteMarkdown(selected)) return;
    void renderMarkdownInto(text, raw, {isCurrent: () => owner === scope() && selected?.id === id && !editing});
  }
  function paintMode() {
    if (!selected) return;
    detail.querySelector('[data-note-read]').hidden = editing;
    detail.querySelector('[data-note-head-main]').hidden = editing; if (editing) closeMenu();
    // The link form was openSet from the ⋯ menu; when it closes, focus goes back to the ⋯ (there is no [연결하기] button left to find).
    const linking = manual.isOpen(); if (linkOpen && !linking && !editing) detail.querySelector('[data-note-more]')?.focus({preventScroll:true}); linkOpen = linking;
    detail.querySelector('[data-note-editor]').hidden = !editing; detail.querySelector('[data-note-edit-actions]').hidden = !editing;
  }
  function showDetail() {
    // UI-기록아이콘: openSet from a project's or organization's record line, the note has no history entry of its own (one back
    // returns to that project or organization, like an update openSet from there) and shows "← (name)으로 돌아가기".
    const from = !!selected && !!basketNoteOrigin(selected.id, rt);
    if (!from) layer ||= window.KPTURouter?.layer?.open('basket-notedoc', {close: () => !busy && close({fromBack:true})}) || null;
    // NAV-새로고침제자리: the open note is written on its own entry (?doc=), so a reload reopens it; close drops it first.
    if (layer && selected) window.KPTURouter?.setPlace?.('basket', {doc:selected.id});
    ++epoch; dropField(); editing = false; linkOpen = false; list.hidden = true; detail.hidden = false; onOpenChange(true);
    // UI-엔터저장: title Enter / body Ctrl+Enter (PC) save through the shared rule (enter-save.js).
    detail.dataset.enterSave = '[data-note-save]';
    detail.innerHTML = `<div class="basket-detail-head"><button type="button" class="basket-back note-back" data-note-back aria-label="노트 목록으로"><span aria-hidden="true">‹</span> 노트</button><div class="note-head-main" data-note-head-main><button type="button" class="basket-icon-button" data-note-telegram aria-label="복사" title="복사">${COPY_ICON}</button><button type="button" class="basket-icon-button basket-more-trigger" data-note-more data-ctx="area" aria-label="이 노트 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div></div><div class="basket-read note-read" data-note-read><div class="basket-read-text" data-basket-read-text tabindex="-1" role="region" aria-label="노트 본문"></div><div class="basket-html-views" data-basket-html-views tabindex="-1" role="region" aria-label="HTML 첨부 화면"></div><p class="basket-note-meta" data-note-meta></p></div><div class="basket-editor note-editor" data-note-editor hidden><label class="basket-text-label">노트 제목<input type="text" data-note-title-input autocomplete="off" enterkeyhint="done"></label><div class="note-body-field" data-note-body-field role="group" aria-label="본문"></div></div><div data-note-attachments class="note-files" tabindex="-1" role="region" aria-label="첨부 파일"></div><button type="button" data-note-reload hidden>노트 다시 불러오기</button><div data-basket-manual hidden></div><div class="basket-actions note-edit-actions save-row save-row-sticky" data-note-edit-actions hidden><button type="button" class="secondary save-row-start" data-note-big-write>큰 창에서 수정</button><button type="button" class="secondary" data-note-cancel>취소</button><button type="button" class="primary" data-note-save>저장</button></div><p data-basket-status role="status"></p>`;
    if (from) detail.querySelector('.basket-detail-head')?.insertAdjacentHTML('afterend', basketReturnHtml(selected.id, rt));
    manual.attach(detail.querySelector('[data-basket-manual]'));
  }
  function open(id, {focus = true} = {}) {
    if (!selected) listScroll = window.scrollY;
    selected = notes.find(n => n.id === id); if (!selected) return;
    showDetail();
    paintRead(); paintMeta(); paintMode();
    if (focus) readFocus().focus();
  }
  // ED③ 노트: the new big window (note-window.js) with a title row, [폴더 ▾], [📎 첨부] and the line shortcuts. It saves a note (createNoteDoc
  // with its saved form) and closes; the saved note then opens here in its read view. Text closed without saving goes back into the input
  // as letters (this tab's memory only, never browser storage).
  async function openNew(text = '', upload = null) {
    if (selected || busy || bigWriter || bigWindowOpen()) return;
    const owner = scope();
    const {openNoteWindow} = await import('./note-window.js');
    if (owner !== scope() || selected || bigWriter) return;
    // NOTE-파일붙이기: the window's [📎 첨부] works on the note input's own files (a saved note empties them).
    bigWriter = openNoteWindow({text, title:'새 노트', rt, upload, noteFolder:{label:() => folderName(addTarget()) || OUTSIDE_NAME, open:trigger => openAddPicker(trigger)}, onClose:({saved, text:value}) => {
      bigWriter = null;
      if (owner !== scope()) return;
      quick.setText(saved ? '' : value);
      if (saved?.kind === 'note') { noteAdded(saved, {open:true}); return; }
      quick.focus();
    }});
    if (bigWriter) bigWriter.paint = () => bigWriter?.paintFolder?.();
  }
  // A new note (input [추가] or the write window) goes into the folder named on the input's [폴더 ▾] (addTarget): the folder chip
  // that is shown, unless another one was picked there; the list is read again.
  // From the write window it then opens; from the input the list stays (like an update added in the basket).
  function noteAdded(saved, {open}) {
    const into = addTarget(), owner = scope();
    if (into) { void putNewNote(saved, into, owner, open); return; }
    if (open) pendingOpen = saved.id;
    void refresh();
  }
  function close({focus = true, force = false, fromBack = false} = {}) {
    if (!selected) return true;
    if (!force && textDirty() && !window.confirm('고치던 노트를 버리고 목록으로 돌아갈까요?')) return false;
    if (!force && !textDirty() && manual.hasDraft() && !window.confirm('작성 중인 연결 입력을 버리고 목록으로 돌아갈까요?')) return false;
    bigWriter?.close({silent:true}); bigWriter = null; dropField();
    closeMenu(); const id = selected.id; ++epoch; selected = null; editing = false; manual.reset();
    detail.replaceChildren(); detail.hidden = true; list.hidden = false; sendWhere(null); onOpenChange(false); renderList();
    if (!fromBack) window.KPTURouter?.setPlace?.('basket', {doc:null});
    const openedLayer = layer; layer = null; if (!fromBack) openedLayer?.close();
    if (window.KPTURouter?.current === 'basket') window.scrollTo({top:listScroll, behavior:'instant'});
    if (focus) ((id ? host.querySelector(`[data-note-row="${CSS.escape(id)}"]`) : null) || host.querySelector('[data-note-search]'))?.focus({preventScroll:true});
    return true;
  }
  // ED③ 노트: [수정] opens the note in the new editor (an old note without doc is converted in memory only; nothing is written by opening).
  // The note's version (updated_at) at that moment is the save's guard: a note changed in another tab or device is refused (note_changed).
  async function startEdit() {
    if (!selected || editing || busy) return;
    editing = true; const f = fields(), id = selected.id, run = epoch; f.title.value = selected.title || ''; say('');
    fieldBase = selected.updated_at;
    paintMode(); f.title.focus();
    const host = detail.querySelector('[data-note-body-field]');
    try {
      const made = await mountEditField(host, selected, {photos:photosFor(id)});
      if (run !== epoch || !editing || selected?.id !== id || !host.isConnected) { made.destroy(); return; }
      field?.destroy(); field = made;
    } catch { if (run === epoch && editing) say('편집기를 열지 못했어요. 다시 눌러 주세요.'); }
  }
  const dropField = () => { field?.destroy(); field = null; fieldBase = null; };
  function finishEdit({force = false} = {}) {
    if (!selected || !editing) return;
    if (!force && textDirty() && !window.confirm('고치던 내용을 버리고 읽기 화면으로 돌아갈까요?')) return;
    bigWriter?.close({silent:true}); bigWriter = null;
    dropField();
    editing = false; if (!force) say(''); paintRead(); paintMode(); readFocus().focus();
  }
  // Photos in the text (사진·링크 넣기): a picture goes up as one of this note's attachments (Drive "노트 첨부", owner only) and is put in
  // as drive:<file id>. The note is read again afterwards so its cards and the editor see the new file.
  function photosFor(id) {
    return notePhotos({rt, getNote:() => selected?.id === id ? selected : null, upload: async files => {
      const note = selected?.id === id ? selected : null; if (!note) throw new Error('노트가 바뀌어 사진을 넣지 못했어요.');
      const batch = createUploadBatch(id, note.attachments || []);
      batch.entries = [...files].map(file => ({file, kind:'pending', label:'대기'}));
      await uploadNoteFiles(id, batch, {rt, isCurrent:() => selected?.id === id});
      const row = await readNoteDoc(id, rt);
      if (row && selected?.id === id) {
        // The new file moved the note's version: the edit keeps its guard on that new version (the photo upload is this edit's own change).
        if (fieldBase && Date.parse(row.updated_at) > Date.parse(fieldBase)) fieldBase = row.updated_at;
        notes = notes.map(n => n.id === id ? row : n); selected = row; renderList(); paintMeta();
      }
      return row?.attachments || batch.attachments;
    }});
  }
  // [큰 창에서 수정] (NOTE-큰창저장유지): the same edit in the new big window (note-window.js). Its save icon is this view's own save
  // (stay: the window stays and says 저장했어요); ✕ closes it (asking once when something changed after the last save). Closed right
  // after a save, the note shows its read view; otherwise the window's text goes back into the edit field.
  // NOTE-파일붙이기: [📎 첨부] under the text; chosen files go up with this note's id after the text is saved.
  let bigFiles = null;
  const pendingFiles = () => bigFiles ? bigFiles.entries.filter(entry => entry.kind !== 'success').length : 0;
  async function openBigWriter() {
    const id = selected?.id;
    if (!selected || !editing || busy || !field || bigWriter || bigWindowOpen()) return;
    const same = () => editing && selected?.id === id && !!field;
    bigFiles = createUploadBatch(id, selected.attachments || []);
    const {openNoteEditWindow} = await import('./note-window.js');
    if (!same() || bigWriter) return;
    // The window shows the note's title and [폴더 ▾] (the folder now, changeable); a changed title goes with the text save, a changed folder
    // is written after it (setNoteFolder, as [폴더로 옮기기]).
    const folder = windowFolderPick(folderOf(selected));
    bigWriter = openNoteEditWindow({value:field.getValue(), photos:photosFor(id), title:fields().title.value, folder,
      attach:{getBatch:() => bigFiles, isBusy:() => busy},
      save: async (value, text, extra) => {
        if (!same()) return {ok:false, message:'수정 화면이 바뀌어 저장하지 못했어요.'};
        field.setValue(value); fields().title.value = extra.title;
        const result = await save({stay:true});
        if (!result.ok || !same() || extra.folder === undefined || !selected || folderOf(selected) === extra.folder) return result;
        return moveFromWindow(extra.folder, result);
      },
      onClose: ({value, saved} = {}) => {
        bigWriter = null; bigFiles = null; if (!same()) return;
        field.setValue(value);
        if (saved && !textDirty()) finishEdit({force:true}); else field.focus();
      }});
  }
  // The big window's folder change, after its text was saved: the same write as [폴더로 옮기기] (a move does not touch updated_at, so the edit's guard stays).
  async function moveFromWindow(name, result) {
    const note = selected, run = ++epoch, owner = scope(); lock(true);
    try {
      const target = folderById(name), saved = await setNoteFolderRef(note, target, rt);
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 폴더 저장 결과를 확인하지 못했어요.'};
      applySaved(note.id, saved); renderList(); paintMeta();
      return {...result, message:target ? `저장했어요. '${target.name}' 폴더에 있어요.` : `저장했어요. '${OUTSIDE_NAME}'에 있어요.`};
    } catch (error) {
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 폴더 저장 결과를 확인하지 못했어요.'};
      return {ok:false, message:`글은 저장했지만 폴더를 옮기지 못했어요. ${error?.code === 'note_changed' ? error.message : '다시 눌러 주세요.'}`};
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // save() resolves {ok:true} or {ok:false, message}; the big window's save icon waits for it (same path as [저장]).
  // stay (the big window): the edit stays open after the save (NOTE-큰창저장유지); the window shows the message.
  // ED③ 노트: title, the letters taken out of the saved form (raw_text, for search·AI·journal) and the saved form (doc) go in one guarded write.
  async function save({stay = false} = {}) {
    if (!selected || !editing || busy) return {ok:false, message:'지금은 저장할 수 없어요.'};
    if (!field) { const message = '편집기를 여는 중이에요. 잠시 뒤 다시 눌러 주세요.'; say(message); return {ok:false, message}; }
    const f = fields(), files = stay ? pendingFiles() : 0;
    if (!textDirty() && !files) { if (stay) return {ok:true, message:'저장했어요'}; showToast('저장된 노트입니다.'); finishEdit({force:true}); return {ok:true}; }
    if (!textDirty()) return await saveFiles();
    const prep = prepareSave({value:field.getValue(), limit:100000});
    if (!prep.ok) { say(prep.message); return {ok:false, message:prep.message}; }
    const changes = {title:f.title.value, raw_text:prep.text, doc:prep.value, version:fieldBase};
    try { validateNoteTitle(changes.title); validateNoteBody(changes.raw_text); } catch (error) { say(error.message); return {ok:false, message:error.message}; }
    const id = selected.id, run = ++epoch, owner = scope(); lock(true); say('저장 중…');
    try {
      const note = await saveNoteDoc(id, changes, rt);
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      notes = notes.map(n => n.id === id ? note : n); selected = note; fieldBase = note.updated_at; field.markSaved(); renderList(); paintMeta();
      if (stay && files) { lock(false); return await saveFiles({textSaved:true}); }
      if (stay) { say(''); return {ok:true, message:'저장했어요'}; }
      finishEdit({force:true}); say(''); showToast('노트를 저장했습니다.');
      return {ok:true};
    } catch (error) {
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      const changed = error?.code === 'note_changed', message = changed ? error.message : '저장하지 못했어요. 다시 눌러 주세요.';
      say(changed ? message : '저장하지 못했어요. 다시 시도해 주세요.');
      if (changed) detail.querySelector('[data-note-reload]').hidden = false;
      return {ok:false, message};
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // The big window's files, after its text (if any) was saved. The note is read again afterwards so the cards and the list show
  // what the server stored, whatever happened to each file; the window then starts a fresh file batch.
  async function saveFiles({textSaved = false} = {}) {
    if (!selected || busy || !bigFiles) return {ok:false, message:'지금은 저장할 수 없어요.'};
    const id = selected.id, batch = bigFiles, run = ++epoch, owner = scope(), current = () => run === epoch && owner === scope() && selected?.id === id;
    lock(true); say('');
    let error = null;
    try { await uploadNoteFiles(id, batch, {rt, isCurrent:current, onChange:() => bigWriter?.renderFiles?.()}); }
    catch (e) { error = e; }
    let row = null;
    try { row = current() ? await readNoteDoc(id, rt) : null; } catch {}
    if (run === epoch) lock(false); else busy = false;
    if (!current()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
    if (row) { notes = notes.map(n => n.id === id ? row : n); selected = row; renderList(); paintMeta(); }
    if (bigFiles === batch) { bigFiles = createUploadBatch(id, (row || selected).attachments || []); bigWriter?.renderFiles?.(); }
    if (row && fieldBase && Date.parse(row.updated_at) > Date.parse(fieldBase)) fieldBase = row.updated_at;
    if (error) return {ok:false, message:`${textSaved ? '글은 저장했지만 ' : ''}첨부를 올리지 못했어요. ${error.message || ''}`.trim()};
    return {ok:true, message:textSaved ? '글과 첨부를 저장했어요' : '첨부를 저장했어요'};
  }
  // NOTE-파일붙이기 [빼기]: the file leaves this note only (detachNoteFile); the Drive file stays where it is.
  async function detachFile(note, fileId) {
    if (!note || busy) return;
    const file = (note.attachments || []).find(f => f?.drive_file_id === fileId); if (!file) return;
    const trigger = () => detail.querySelector(`[data-note-file-more="${CSS.escape(fileId)}"]`);
    if (!window.confirm(`'${attachmentName(file)}' 파일을 이 노트에서 뺄까요? Drive의 파일은 그대로 남아요.`)) { trigger()?.focus({preventScroll:true}); return; }
    const id = note.id, run = ++epoch, owner = scope(); lock(true); say('');
    try {
      const {row} = await detachNoteFile(id, fileId, rt);
      if (run !== epoch || owner !== scope()) return;
      if (row) { notes = notes.map(n => n.id === id ? row : n); if (selected?.id === id) selected = row; }
      renderList(); if (selected?.id === id) { if (!editing) paintRead(); paintMeta(); }
      showToast('파일을 노트에서 뺐어요. Drive에는 그대로 있어요.');
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      say(error?.code === 'note_changed' || error?.code === 'note_missing' ? error.message : '파일을 빼지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (run === epoch) lock(false); else busy = false;
      if (run === epoch && selected?.id === id) (detail.querySelector('[data-note-file-more]') || detail.querySelector('[data-note-attachments]'))?.focus({preventScroll:true});
    }
  }
  async function telegram(note = selected, button = null) {
    // ED③ 노트: a note with doc copies the new editor's 텔레그램 letters (ed-text toTelegram); without, the old conversion.
    const payload = docCopy(note) || noteCopyPayload(note); if (!payload) return;
    const ok = await copyText(payload.text);
    if (ok && button) flashDone(button); // UI-눌림느낌 (an element, or a getter for a button that is looked up after the menu closed)
    showToast(ok ? payload.done : '복사하지 못했어요. 다시 눌러 주세요.');
  }
  // UI-노트고정: [고정]/[고정 해제] in the note's ⋯. The list puts pinned notes on top.
  async function pin(target = selected) {
    if (!target || editing || busy) return;
    const note = target, pinned = !notePinnedAt(note), run = ++epoch, owner = scope(); lock(true); report('');
    try {
      const saved = await setNotePinned(note, pinned, rt);
      if (run !== epoch || owner !== scope()) return;
      notes = notes.map(n => n.id === note.id ? {...n, metadata:saved.metadata, updated_at:saved.updated_at} : n);
      if (selected?.id === note.id) selected = notes.find(n => n.id === note.id) || selected;
      renderList(); if (selected) paintRead();
      showToast(pinned ? '노트를 맨 위에 고정했어요.' : '고정을 풀었어요.');
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      report(error?.code === 'note_changed' ? error.message : pinned ? '고정하지 못했어요. 다시 시도해 주세요.' : '고정을 풀지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // NOTE-비밀메모: [AI에 보내지 않기] / [AI 제외 풀기] — metadata.ai_off만 쓴다(고치기 아님, updated_at 그대로).
  async function toggleAiOff(note) {
    if (!note || editing || busy) return;
    const off = !noteAiOff(note), run = ++epoch, owner = scope(); lock(true); report('');
    try {
      const saved = await setNoteAiOff(note, off, rt);
      if (run !== epoch || owner !== scope()) return;
      applySaved(note.id, saved); renderList(); if (selected?.id === note.id) { paintMeta(); }
      showToast(off ? '이 노트는 AI에 보내지 않아요.' : 'AI 제외를 풀었어요.');
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      report(error?.code === 'note_changed' ? error.message : '저장하지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // ---- NOTE-탐색기: 폴더 옮기기·새 폴더·이름·지우기·선택 모드·끌어 놓기 ----
  const applySaved = (id, saved) => {
    notes = notes.map(n => n.id === id ? {...n, metadata:saved.metadata, updated_at:saved.updated_at} : n);
    if (selected?.id === id) selected = notes.find(n => n.id === id) || selected;
  };
  function folderSay(text) { const p = host.querySelector('[data-note-folder-status]'); p.textContent = text; p.hidden = !text; }
  const notReady = () => { folderSay(foldersMissing ? '폴더 정리는 준비 중이에요. 지금은 폴더를 볼 수만 있어요.' : '폴더 목록을 읽지 못했어요. 다시 불러온 뒤 해 주세요.'); };
  // NOTE-추가폴더표시: the folder a NEW note goes into — the entered folder (at), unless another was picked on the input's [폴더 ▾]
  // while in that folder (screen memory only).
  let addPick = null;
  const addTarget = () => {
    if (addPick && addPick.at !== at) addPick = null;
    const id = addPick ? addPick.folder : at;
    return id && folderById(id) ? id : null;
  };
  const picker = createMovePicker({esc});
  // The shared folder list (library-move-picker.js; rows from library-move.mjs pickerRows, the same tree order and 100-level path).
  function pickRows(items, query) {
    const itemFolder = new Map(items.notes.map(n => [n.id, folderOf(n)]));
    const data = pickerRows({folders, docs:items.notes.map(n => ({id:n.id, project_id:null})), itemFolder, free:true, query});
    if (!items.folders.length) return data;
    const ok = r => items.folders.every(id => canMoveFolder(folders, id, r.id, FOLDER_DEPTH_LIMIT) && folderById(id)?.parent_id !== r.id);
    const mark = r => ok(r) ? {...r, current:false, enabled:true} : {...r, enabled:false, current:false, reason:'자기 안이나 지금 자리로는 옮길 수 없어요'};
    return {...data, recent:data.recent.map(mark), all:data.all.map(mark)};
  }
  function openMovePicker(anchor, items, {place = 'below'} = {}) {
    if (!canEditFolders()) { notReady(); return; }
    picker.open({anchor, place, history:!isWide(), canNew:true, canOut:true, rows:q => pickRows(items, q),
      onPick:id => moveItems(items, id), onOut:() => moveItems(items, null),
      onNew:async () => { const made = await newFolder(at === OUTSIDE ? null : at, {quiet:true}); if (made) await moveItems(items, made.id); }});
  }
  function openAddPicker(trigger) {
    if (!foldersReady || !folders.length) { addPick = null; quick.setFolder(null); if (!foldersReady) notReady(); return; }
    picker.open({anchor:trigger, place:'below', history:!isWide(), canNew:false, canOut:true, rows:q => pickerRows({folders, free:true, query:q}),
      onPick:id => { addPick = {at, folder:id}; quick.setFolder(folderName(addTarget())); bigWriter?.paint?.(); },
      onOut:() => { addPick = {at, folder:null}; quick.setFolder(null); bigWriter?.paint?.(); }});
  }
  // The big edit window's [폴더 ▾]: the same folder list; the window writes the change after its text save (moveFromWindow).
  function windowFolderPick(initial) {
    let value = initial, watchers = [];
    return {get:() => value, label:() => folderName(value) || OUTSIDE_NAME, watch:fn => watchers.push(fn), close:() => { void picker.close(); },
      open:trigger => { if (!canEditFolders()) { notReady(); return; }
        picker.open({anchor:trigger, place:'below', history:!isWide(), canNew:false, canOut:true, rows:q => pickerRows({folders, free:true, query:q}),
          onPick:id => { value = id; watchers.forEach(fn => fn()); }, onOut:() => { value = null; watchers.forEach(fn => fn()); }}); }};
  }
  // Notes written before the folder table (no metadata.folder_id) sit in the top folder of the same name. Before that folder is
  // renamed, moved or deleted they get its id, so they stay with it.
  async function adopt(folderId) {
    const f = folderById(folderId); if (!f) return;
    for (const n of notes.filter(x => folderOf(x) === folderId && !(x.metadata && typeof x.metadata.folder_id === 'string'))) {
      applySaved(n.id, await setNoteFolderRef(n, f, rt));
    }
  }
  // Moves notes and folders; one notice with [되돌리기] (Ctrl+Z too, small-notice.js) puts each back where it was.
  async function moveItems(items, targetId, {silent = false} = {}) {
    if (busy || !canEditFolders()) return;
    const target = targetId ? folderById(targetId) : null; if (targetId && !target) return;
    const owner = scope(), run = ++epoch, done = {notes:[], folders:[]}, total = items.notes.length + items.folders.length;
    let failed = 0; busy = true; paintSelectBar();
    try {
      for (const id of items.folders) {
        const f = folderById(id); if (!f || f.parent_id === targetId || !canMoveFolder(folders, id, targetId, FOLDER_DEPTH_LIMIT)) { if (f && f.parent_id !== targetId) failed++; continue; }
        try { if (!f.parent_id) await adopt(id); const row = await updateNoteFolder(id, {parent_id:targetId, sort_order:nextSortOrder(folderSiblings(folders, {free:true, parentId:targetId}))}, rt);
          if (owner !== scope()) return; folders = folders.map(x => x.id === id ? {...x, ...row} : x); done.folders.push({id, from:f.parent_id || null, order:f.sort_order}); if (targetId) openSet.add(targetId); }
        catch (error) { failed++; folderSay(noteFolderErrorText(error)); }
        if (total > 2) folderSay(`옮기는 중 ${done.notes.length + done.folders.length}/${total}`);
      }
      for (const id of items.notes) {
        const note = notes.find(n => n.id === id); if (!note) continue;
        const from = folderOf(note); if (from === targetId) continue;
        try { const saved = await setNoteFolderRef(note, target, rt); if (owner !== scope()) return; applySaved(id, saved); done.notes.push({id, from}); }
        catch { failed++; }
        if (total > 2) folderSay(`옮기는 중 ${done.notes.length + done.folders.length}/${total}`);
      }
    } finally { busy = false; }
    if (run === epoch) folderSay(failed ? `${failed}개는 옮기지 못했어요. 다시 해 주세요.` : '');
    if (pick.active) { if (failed) pick.items = new Set([...pick.items].filter(k => !done.notes.some(d => 'n:' + d.id === k) && !done.folders.some(d => 'f:' + d.id === k))); else pick.items = null; }
    renderList(); if (selected) paintMeta();
    const count = done.notes.length + done.folders.length;
    if (!count || silent) return;
    const where = target ? `📁 ${target.name}` : OUTSIDE_NAME;
    flash(done);
    notify(`옮겼어요 ${count}개 → ${where}`, {label:`폴더 옮기기 ${count}개`, undo:async () => {
      for (const d of done.notes) { const note = notes.find(n => n.id === d.id); if (note) applySaved(d.id, await setNoteFolderRef(note, d.from ? folderById(d.from) : null, rt)); }
      for (const d of done.folders) { const row = await updateNoteFolder(d.id, {parent_id:d.from, sort_order:d.order}, rt); folders = folders.map(x => x.id === d.id ? {...x, ...row} : x); }
      renderList(); return true;
    }});
  }
  const flash = done => requestAnimationFrame(() => { for (const d of done.notes) host.querySelector(`[data-nx-note="${CSS.escape(d.id)}"]`)?.classList.add('nx-flash'); for (const d of done.folders) host.querySelector(`[data-nx-folder="${CSS.escape(d.id)}"]`)?.classList.add('nx-flash'); });
  const askName = (text, value = '') => { const typed = window.prompt(`${text} (40자까지)`, value); if (typed === null) return null; const name = cleanFolderName(typed); if (!name) { folderSay('폴더 이름은 1~40자로 써 주세요.'); return null; } return name; };
  async function newFolder(parentId, {quiet = false} = {}) {
    if (!canEditFolders()) { notReady(); return null; }
    if (parentId && folderPath(folders, parentId).length >= FOLDER_DEPTH_LIMIT) { folderSay(`폴더는 ${FOLDER_DEPTH_LIMIT}단까지만 만들 수 있어요.`); return null; }
    const name = askName('새 폴더 이름'); if (!name) return null;
    try {
      const row = await createNoteFolder({name, parent_id:parentId || null, sort_order:nextSortOrder(folderSiblings(folders, {free:true, parentId:parentId || null}))}, rt);
      folders = [...folders, row]; if (parentId) openSet.add(parentId); folderSay(''); renderList();
      if (!quiet) notify(`'${name}' 폴더를 만들었어요.`);
      return row;
    } catch (error) { folderSay(noteFolderErrorText(error)); return null; }
  }
  async function renameFolder(id) {
    const f = folderById(id); if (!f || busy || !canEditFolders()) return;
    const name = askName('폴더 이름 바꾸기', f.name); if (!name || name === f.name) return;
    busy = true;
    try { if (!f.parent_id) await adopt(id); const row = await updateNoteFolder(id, {name}, rt); folders = folders.map(x => x.id === id ? {...x, ...row} : x); folderSay('');
      notify(`폴더 이름을 '${name}'(으)로 바꿨어요.`, {label:'폴더 이름 바꾸기', undo:async () => { const back = await updateNoteFolder(id, {name:f.name}, rt); folders = folders.map(x => x.id === id ? {...x, ...back} : x); renderList(); return true; }}); }
    catch (error) { folderSay(noteFolderErrorText(error)); }
    finally { busy = false; renderList(); }
  }
  // 폴더 지우기: 안의 노트는 한 단 위로(맨 위였으면 폴더 밖), 안의 폴더는 DB가 한 단 위로. [되돌리기]는 같은 id로 다시 만들어 되돌린다.
  async function deleteFolder(id, trigger) {
    const f = folderById(id); if (!f || busy || !canEditFolders()) return;
    const inside = notes.filter(n => folderOf(n) === id), kids = folders.filter(x => x.parent_id === id);
    const up = f.parent_id ? folderById(f.parent_id) : null;
    if (!await askConfirm(trigger, {text:`'${f.name}' 폴더를 지울까요?`, note:`노트 ${inside.length}개·폴더 ${kids.length}개는 ${up ? `'${up.name}'` : `'${OUTSIDE_NAME}'`}으로 가요. 노트는 지우지 않아요.`, ok:'지우기', danger:true})) return;
    busy = true; const moved = [];
    try {
      for (const n of inside) { applySaved(n.id, await setNoteFolderRef(n, up, rt)); moved.push(n.id); }
      await deleteNoteFolder(id, rt);
      folders = folders.filter(x => x.id !== id).map(x => x.parent_id === id ? {...x, parent_id:f.parent_id || null} : x);
      if (at === id) at = f.parent_id || null;
      folderSay('');
      notify(`'${f.name}' 폴더를 지웠어요.`, {label:'폴더 지우기', undo:async () => {
        const row = await createNoteFolder({id, name:f.name, parent_id:f.parent_id || null, sort_order:f.sort_order}, rt); folders = [...folders, row];
        for (const k of kids) { const back = await updateNoteFolder(k.id, {parent_id:id}, rt); folders = folders.map(x => x.id === k.id ? {...x, ...back} : x); }
        for (const nid of moved) { const note = notes.find(n => n.id === nid); if (note) applySaved(nid, await setNoteFolderRef(note, row, rt)); }
        renderList(); return true;
      }});
    } catch (error) { folderSay(moved.length ? `노트 ${moved.length}개는 옮겼지만 폴더를 지우지 못했어요. 다시 해 주세요.` : noteFolderErrorText(error)); }
    finally { busy = false; renderList(); }
  }
  // A new note written while a folder is entered (or picked on [폴더 ▾]) goes into it (one more metadata write after the save).
  async function putNewNote(saved, into, owner, open = true) {
    busy = true;
    try { await setNoteFolderRef(saved, folderById(into), rt); }
    catch { if (owner === scope()) folderSay(`노트는 저장했지만 '${folderName(into) || ''}' 폴더에 넣지 못했어요. 노트 ⋯의 [폴더로 옮기기]로 옮겨 주세요.`); }
    finally { busy = false; }
    if (owner !== scope()) return;
    if (open) pendingOpen = saved.id;
    void refresh();
  }
  // ---- 선택 모드: [선택]으로 켜고(그 줄이 골라짐), 줄을 누르면 고르기·풀기, Esc·뒤로가기·✕로 끝. ----
  function startSelect(key) {
    pick.start(key ? [key] : [], key || null);
    renderList();
  }
  function endSelect({fromBack = false} = {}) {
    if (pick.stop({fromBack})) renderList();
  }
  const togglePick = key => { if (!pick.active) return; pick.toggle([key]); renderList(); };
  const pickedItems = () => ({notes:[...(pick.items || [])].filter(k => k.startsWith('n:')).map(k => k.slice(2)), folders:[...(pick.items || [])].filter(k => k.startsWith('f:')).map(k => k.slice(2))});
  function selectAll() {
    if (!pick.active) return;
    const keys = [...host.querySelectorAll('[data-nx-recent] [data-nx-note], #noteRows [data-nx-note], #noteRows [data-nx-folder]')].map(el => el.dataset.nxNote ? 'n:' + el.dataset.nxNote : 'f:' + el.dataset.nxFolder);
    pick.toggle(keys, {anchor:false});
    renderList();
  }
  async function deletePicked(trigger) {
    const items = pickedItems(); if (!items.notes.length && !items.folders.length) return;
    if (items.folders.length) { folderSay('폴더는 폴더 ⋯의 [폴더 지우기]로 하나씩 지워 주세요. 노트만 함께 지울 수 있어요.'); return; }
    if (!await askConfirm(trigger, {text:`노트 ${items.notes.length}개를 지울까요?`, note:'휴지통으로 가요. 첨부 파일은 Drive에 그대로 남아요.', ok:'지우기', danger:true})) return;
    let ok = 0;
    for (const id of items.notes) {
      let result; busy = true;
      const alive = () => true;
      try { result = await deleteNoteOriginal(id, {rt, trash:true, confirmed:true, isCurrent:alive}); } catch { result = {status:'unknown'}; } finally { busy = false; }
      if (['deleted', 'missing'].includes(result?.status)) { ok++; notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id); pick.remove('n:' + id); }
      if (result?.status === 'cancelled') break;
    }
    if (pick.active && !pick.size) endSelect(); else renderList();
    notify(ok === items.notes.length ? `노트 ${ok}개를 지웠어요.` : `노트 ${ok}개를 지웠고 ${items.notes.length - ok}개는 지우지 못했어요.`);
  }
  // ---- 끌어 놓기: 노트·폴더 줄을 폴더 줄(또는 그 폴더의 노트 줄, '폴더 밖')에 놓으면 그 폴더로. 고른 것을 끌면 고른 것 모두. ----
  let drag = null;
  const dragItems = el => {
    const key = el.dataset.nxNote ? 'n:' + el.dataset.nxNote : 'f:' + el.dataset.nxFolder;
    if (pick.has(key) && pick.size > 1) return pickedItems();
    return el.dataset.nxNote ? {notes:[el.dataset.nxNote], folders:[]} : {notes:[], folders:[el.dataset.nxFolder]};
  };
  function dropTarget(el) {
    const row = el?.closest?.('[data-nx-folder],[data-nx-outside],[data-nx-note]'); if (!row || !host.contains(row)) return undefined;
    if (row.dataset.nxFolder) return row.dataset.nxFolder;
    if (row.hasAttribute('data-nx-outside')) return null;
    if (row.hasAttribute('data-nx-recent-row')) return undefined; // '최근' 줄은 폴더가 섞여 있어 놓을 곳이 아니다
    const note = notes.find(n => n.id === row.dataset.nxNote); return note ? folderOf(note) : undefined;
  }
  const clearDrop = () => host.querySelectorAll('.nx-drop').forEach(el => el.classList.remove('nx-drop'));
  function showDrop(target) {
    clearDrop(); if (target === undefined) return;
    host.querySelectorAll(target === null ? '[data-nx-outside]' : `[data-nx-folder="${CSS.escape(target)}"]`).forEach(el => el.classList.add('nx-drop'));
  }
  let hoverTimer = null, hoverId = null;
  function hoverOpen(target) {
    if (target === hoverId) return; clearTimeout(hoverTimer); hoverId = target;
    if (target && !openSet.has(target) && wideList.matches) hoverTimer = setTimeout(() => { if (drag && hoverId === target) { openSet.add(target); renderList(); showDrop(target); } }, 900); // PC: 끄는 동안 닫힌 왼쪽 나무 폴더 위에 머물면 열림
  }
  function edgeScroll(y) { const edge = 56; if (y < edge) window.scrollBy(0, -12); else if (y > innerHeight - edge) window.scrollBy(0, 12); }
  host.addEventListener('dragstart', e => {
    const row = e.target.closest?.('[data-nx-note],[data-nx-folder]'); if (!row || !host.contains(row) || !foldersReady || query || selected) return;
    drag = dragItems(row); row.classList.add('nx-dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } catch {}
  });
  host.addEventListener('dragover', e => { if (!drag) return; const t = dropTarget(e.target); showDrop(t); hoverOpen(t); edgeScroll(e.clientY); if (t !== undefined) e.preventDefault(); });
  host.addEventListener('drop', e => { if (!drag) return; const t = dropTarget(e.target), d = drag; drag = null; clearDrop(); if (t === undefined) return; e.preventDefault(); void moveItems(d, t); });
  host.addEventListener('dragend', () => { drag = null; clearDrop(); clearTimeout(hoverTimer); hoverId = null; host.querySelectorAll('.nx-dragging').forEach(el => el.classList.remove('nx-dragging')); });
  // 폰: 줄을 꾹 눌렀다 떼면 우클릭과 같은 메뉴(맨 위 [선택]), 꾹 누른 채 움직이면 끌기. 잡기 전에 움직이면 그대로 스크롤.
  const LONG_MS = 450, SLOP = 8, MOVED = 12;
  let touch = null, suppressUntil = 0;
  // 끄는 동안 닫힌 폴더가 열리면(목록을 다시 그림) 잡은 줄은 화면에서 빠지지만 손가락 사건은 그 줄로 계속 온다(터치 대상은 처음 누른 요소).
  // 그래서 움직임·뗌은 목록(host)이 아니라 잡은 줄 자체에서 듣는다(빠진 줄의 사건은 목록까지 올라오지 않음).
  const cancelTouch = () => { if (touch?.timer) clearTimeout(touch.timer); const row = touch?.row; touch = null; row?.removeEventListener('touchmove', onTouchMove); row?.removeEventListener('touchend', onTouchEnd); row?.removeEventListener('touchcancel', onTouchCancel); };
  const onTouchMove = e => {
    if (!touch?.grabbed) return; if (e.cancelable) e.preventDefault();
    const p = e.touches[0]; if (!p) return;
    if (Math.hypot(p.clientX - touch.x, p.clientY - touch.y) > MOVED) touch.moved = true;
    // 17:55: 폰에서는 끌어 옮기지 않는다(꾹 누르기 메뉴·선택 모드의 [폴더로 옮기기]). 잡은 뒤 움직이면 메뉴 없이 놓는다.
  };
  const onTouchEnd = e => {
    if (!touch) return; if (!touch.grabbed) { cancelTouch(); return; }
    if (e.cancelable) e.preventDefault();
    const {row, moved} = touch; row.classList.remove('nx-grabbed'); clearDrop(); cancelTouch(); suppressUntil = Date.now() + 600;
    if (moved) return;
    const btn = row.querySelector(':scope > .basket-row-more, :scope > .nx-more');
    if (btn) { const r = row.getBoundingClientRect(); window.KPTUContextMenu?.pinAt?.(btn, r.left + Math.min(r.width / 2, 48), r.top + r.height / 2); rowMenu(btn); }
  };
  const onTouchCancel = () => { if (touch?.grabbed) { touch.row.classList.remove('nx-grabbed'); clearDrop(); } cancelTouch(); };
  host.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !e.isPrimary || selected) return;
    const row = e.target.closest?.('[data-nx-note],[data-nx-folder]'); if (!row || !host.contains(row) || e.target.closest('.basket-row-more,.basket-row-copy')) return;
    cancelTouch();
    row.addEventListener('touchmove', onTouchMove, {passive:false}); row.addEventListener('touchend', onTouchEnd); row.addEventListener('touchcancel', onTouchCancel);
    touch = {row, x:e.clientX, y:e.clientY, grabbed:false, moved:false, target:undefined, timer:setTimeout(() => { if (!touch || touch.row !== row) return; touch.grabbed = true; row.classList.add('nx-grabbed'); try { navigator.vibrate?.(12); } catch {} }, LONG_MS)};
  });
  host.addEventListener('pointermove', e => { if (touch && !touch.grabbed && e.pointerType === 'touch' && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > SLOP) cancelTouch(); });
  host.addEventListener('pointercancel', e => { if (e.pointerType === 'touch' && touch && !touch.grabbed) cancelTouch(); });
  host.addEventListener('contextmenu', e => { if (touch || Date.now() < suppressUntil) e.preventDefault(); }, true);
  host.addEventListener('click', e => { if (Date.now() < suppressUntil && e.target.closest?.('[data-nx-note],[data-nx-folder]')) { e.preventDefault(); e.stopPropagation(); } }, true);
  // A row's ⋯ (pressed, right-clicked or long-pressed): in select mode a picked row's menu is for all picked ones.
  function rowMenu(b) {
    if (busy || selected) return;
    const noteId = b.dataset.noteRowMore, folderId = b.dataset.nxFolderMore;
    const key = noteId ? 'n:' + noteId : 'f:' + folderId;
    if (pick.active) { if (!pick.has(key)) { pick.add(key); renderList(); b = host.querySelector(noteId ? `[data-note-row-more="${CSS.escape(noteId)}"]` : `[data-nx-folder-more="${CSS.escape(folderId)}"]`) || b; } openMenu(b, null, 'picked'); return; }
    if (noteId) openMenu(b, notes.find(n => n.id === noteId), 'list');
    else openMenu(b, null, 'folder', null, folderId);
  }
  async function toBasket() {
    if (!selected || editing || busy) return;
    if (!await askConfirm(host.querySelector('[data-note-to-basket]') || document.activeElement, {text:'이 노트를 정리함 업데이트로 돌릴까요?', note:'제목은 지워지고 본문·첨부·연결은 그대로 남아요.', ok:'돌리기'})) return;
    if (!selected || editing || busy) return;
    const note = selected, run = ++epoch, owner = scope(); lock(true); say('');
    try {
      await moveToBasket(note, rt);
      if (run !== epoch || owner !== scope()) return;
      notes = notes.filter(n => n.id !== note.id); links = links.filter(l => l.note_id !== note.id);
      busy = false; close({force:true, focus:false}); status.textContent = '정리함으로 돌렸어요.'; onMovedToBasket(note.id);
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      say(/정리함/.test(error?.message || '') ? error.message : '정리함으로 돌리지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch && selected) lock(false); else busy = false; }
  }
  // [삭제] from the open note or from a list row: the same confirmation (what goes with it) and the same delete path.
  async function remove(id = selected?.id) {
    if (!id || editing || busy) return;
    const fromList = !selected, run = ++epoch, owner = scope(); lock(true); report('');
    const current = () => run === epoch && owner === scope() && window.KPTURouter.current === 'basket' && (fromList ? !selected : selected?.id === id);
    let result;
    // NOTE-파일붙이기 (2026-10-22 사용자 결정): deleting a note removes it and its links; its files stay in Drive.
    try { result = await deleteNoteOriginal(id, {rt, isCurrent:current, trash:true}); }
    catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. 노트 다시 불러오기로 실제 상태를 확인해 주세요.'}; }
    finally { busy = false; }
    if (!current() || result.status === 'stale') return;
    if (['deleted', 'missing'].includes(result.status)) {
      notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
      const message = String(result.message || '').replace('업데이트', '노트');
      if (fromList) { renderList(); if (message) status.textContent = message; host.querySelector('[data-note-search]')?.focus({preventScroll:true}); return; }
      close({force:true}); if (message) status.textContent = message;
      return;
    }
    lock(false);
    if (result.status === 'cancelled') { (fromList ? host.querySelector(`[data-note-row-more="${CSS.escape(id)}"]`) : detail.querySelector('[data-note-more]'))?.focus(); return; }
    report(result.message);
    if (result.status === 'unknown' && !fromList) detail.querySelector('[data-note-reload]').hidden = false;
  }
  async function reload() {
    if (!selected) return;
    const id = selected.id, owner = scope(), run = ++epoch;
    try { const fresh = await readNoteDocs(rt); if (run !== epoch || owner !== scope()) return; notes = fresh.notes; links = fresh.links; renderList();
      if (notes.some(n => n.id === id)) open(id); else close({force:true}); }
    catch { if (run === epoch && owner === scope()) say('노트를 다시 불러오지 못했어요. 다시 시도해 주세요.'); }
  }

  host.addEventListener('input', e => { if (e.target.matches('[data-note-search]')) { query = e.target.value.trim().toLowerCase(); renderList(); } });
  // A menu item acts on the note the menu was openSet for (a list row's note need not be open).
  function menuAction(b, from) {
    if (from.from === 'picked') {
      if (b.hasAttribute('data-nx-sel-move')) openMovePicker(from.trigger, pickedItems());
      else if (b.hasAttribute('data-nx-sel-delete')) void deletePicked(from.trigger);
      else if (b.hasAttribute('data-nx-sel-close')) endSelect();
      return;
    }
    if (from.from === 'folder' || from.from === 'head') {
      const id = from.from === 'folder' ? from.folderId : at === OUTSIDE ? null : at;
      if (b.hasAttribute('data-press-draft-open')) { const trigger = from.trigger; void import('./press-draft.js').then(m => m.openPressDraft({trigger})); return; }
      if (b.hasAttribute('data-nx-select')) startSelect(from.from === 'folder' ? 'f:' + id : null);
      else if (b.hasAttribute('data-nx-enter')) enter(id);
      else if (b.hasAttribute('data-nx-up')) enter(folderById(at)?.parent_id || null);
      else if (b.hasAttribute('data-nx-new-in')) void newFolder(id);
      else if (b.hasAttribute('data-nx-rename')) void renameFolder(id);
      else if (b.hasAttribute('data-nx-move-folder')) openMovePicker(from.trigger, {notes:[], folders:[id]});
      else if (b.hasAttribute('data-nx-delete-folder')) void deleteFolder(id, from.trigger);
      return;
    }
    const note = notes.find(n => n.id === from.noteId); if (!note) return;
    if (b.dataset.fileMenu) { const file = noteFile(note, from.fileId); if (file) { if (b.dataset.fileMenu === 'open') openInDrive(file, {onError: fileFail}); else void downloadFile(file, {onError: fileFail}); } return; }
    if (b.hasAttribute('data-note-file-detach')) void detachFile(note, from.fileId);
    else if (b.hasAttribute('data-note-copy')) void telegram(note, from.trigger); // UI-눌림느낌: the menu is closed, so the row's ⋯ shows the ✓
    else if (b.hasAttribute('data-note-ai-off')) void toggleAiOff(note);
    else if (b.hasAttribute('data-note-pin')) void pin(note);
    else if (b.hasAttribute('data-nx-select')) startSelect('n:' + note.id);
    else if (b.hasAttribute('data-note-folder-move')) openMovePicker(from.trigger, {notes:[note.id], folders:[]});
    else if (b.hasAttribute('data-note-edit')) { if (selected?.id !== note.id) open(note.id, {focus:false}); startEdit(); }
    else if (b.hasAttribute('data-basket-link-open')) say(manual.open('link') || '');
    else if (b.hasAttribute('data-note-to-basket')) void toBasket();
    else if (b.hasAttribute('data-note-delete')) void remove(note.id);
  }
  host.addEventListener('click', e => {
    const line = e.target.closest('[data-note-file] .file-line-main'); if (line && host.contains(line)) { closeMenu(); pressNoteFile(line); return; }
    const b = e.target.closest('button'); if (!b || b.disabled || !host.contains(b)) return;
    if (b.closest('#noteDocMenu')) { const from = closeMenu({focus:true}); if (from && !busy) menuAction(b, from); return; }
    if (b.hasAttribute('data-note-more')) { if (!busy && selected && !editing) openMenu(b, selected, 'detail'); return; }
    if (b.hasAttribute('data-note-file-more')) { if (!busy && selected) openMenu(b, selected, 'file', b.dataset.noteFileMore); return; }
    if (b.hasAttribute('data-note-folder-more')) { if (!busy && !selected) openMenu(b, null, pick.active ? 'picked' : 'head'); return; }
    if (b.hasAttribute('data-note-row-more') || b.hasAttribute('data-nx-folder-more')) { rowMenu(b); return; }
    closeMenu();
    if (busy) return;
    if (b.hasAttribute('data-note-view')) { setView(b.dataset.noteView); return; }
    if (b.hasAttribute('data-note-row')) { if (pick.active) togglePick('n:' + b.dataset.noteRow); else open(b.dataset.noteRow); }
    else if (b.hasAttribute('data-nx-open')) pressFolder(b.dataset.nxOpen, e);
    else if (b.hasAttribute('data-nx-at')) enter(b.dataset.nxAt || null);
    else if (b.hasAttribute('data-nx-back')) up();
    else if (b.hasAttribute('data-nx-new-top')) void newFolder(null);
    else if (b.hasAttribute('data-nx-sel-move')) openMovePicker(b, pickedItems());
    else if (b.hasAttribute('data-nx-sel-delete')) void deletePicked(b);
    else if (b.hasAttribute('data-nx-sel-all')) selectAll();
    else if (b.hasAttribute('data-nx-sel-close')) endSelect();
    else if (b.hasAttribute('data-note-retry')) void refresh();
    else if (b.hasAttribute('data-note-cancel')) finishEdit();
    else if (b.hasAttribute('data-note-save')) void save();
    else if (b.hasAttribute('data-note-big-write')) openBigWriter();
    else if (b.hasAttribute('data-note-telegram')) void telegram(selected, b);
    else if (b.hasAttribute('data-note-back')) close(); // UI-화면정리 C: 폰 노트 읽기·수정의 '‹ 노트'(정리함 상세의 '‹ 정리함'과 같은 모양)
    else if (b.hasAttribute('data-note-reload')) void reload();
  });
  // 폴더 줄: 선택 모드면 고르기. PC는 오른쪽에 그 폴더 노트(왼쪽 나무에서 열림, 고른 폴더를 다시 누르면 접기·펴기),
  // 폰(17:55 한 화면씩)은 그 폴더 화면으로 들어간다('폴더 없음'도 한 화면).
  function pressFolder(id, e) {
    if (id === OUTSIDE) { enter(OUTSIDE); return; }
    if (id === RECENT) { enter(null); return; }
    if (pick.active) { togglePick('f:' + id); return; }
    if (wideList.matches) { if (e?.target?.closest?.('[data-nx-tree]') && at === id) { if (openSet.has(id)) openSet.delete(id); else openSet.add(id); } else openSet.add(id); }
    enter(id);
  }
  // 들어가기(10:34 ②): 그 폴더만 보이고 위에 '이름 · 장수'(2단 이상이면 위치 줄도). 폴더 위쪽은 왼쪽 나무에서 열어 둔다.
  function enter(id, {focus = true} = {}) {
    at = id === OUTSIDE ? OUTSIDE : id && folderById(id) ? id : null;
    for (const f of at && at !== OUTSIDE ? folderPath(folders, at) : []) openSet.add(f.id);
    renderList();
    // NAV-새로고침제자리: the folder entered is written to the address (?folder=, no entry of its own) after the list is drawn, so on a
    // phone it lands on the folder screen's own layer entry and Back to the folder list leaves it out. A reload enters it again.
    window.KPTURouter?.setPlace?.('basket', {folder:at});
    if (focus) (at !== null ? host.querySelector('#noteRows [data-note-row], #noteRows [data-nx-open]') || host.querySelector('[data-nx-back]') : host.querySelector('#noteRows [data-nx-open]') || host.querySelector('[data-note-search]'))?.focus({preventScroll:true});
    if (!wideList.matches) window.scrollTo({top:0, behavior:'instant'});
  }
  // 폰 '←': 한 단계 위(맨 위 폴더·'폴더 없음'이면 첫 화면 폴더 목록).
  function up() { enter(at && at !== OUTSIDE ? folderById(at)?.parent_id || null : null); }
  // 폰 폴더 화면은 라우터 한 겹: 갤럭시 뒤로가기 = 첫 화면 폴더 목록(선택 모드·열린 노트 겹이 있으면 그것부터 닫힘).
  function syncFolderLayer() {
    if (at !== null && !folderLayer) folderLayer = window.KPTURouter?.layer?.open('basket-note-folder', {close: () => { folderLayer = null; endSelect(); at = null; renderList(); return true; }}) || null;
    else if (at === null && folderLayer) { const l = folderLayer; folderLayer = null; l.close(); }
  }
  host.addEventListener('keydown', e => {
    if (e.key === 'F2' && !selected && !e.target.closest('input,textarea,[contenteditable]')) { const row = e.target.closest('[data-nx-folder]'); if (row) { e.preventDefault(); void renameFolder(row.dataset.nxFolder); return; } }
    if (e.key !== 'Escape') return;
    if (menu) { e.preventDefault(); e.stopPropagation(); closeMenu({focus:true}); return; }
    if (pick.active && !selected) { e.preventDefault(); e.stopPropagation(); endSelect(); return; }
    if (!selected || busy) return;
    e.preventDefault(); e.stopPropagation();
    if (manual.isOpen()) manual.cancel();
    else if (editing) finishEdit();
    else close();
  });
  // NOTE-보기3가지 ①: 폰은 좌우로 밀어 세 보기 전환(왼쪽으로 밀면 폴더 → 목록 → 포스트잇). 포스트잇 보드 위는 보드 이동이라 빼고,
  // 보드에서는 위쪽 줄(검색 칸 줄)에서 밀거나 전환 단추를 누른다. 꾹 눌러 잡은 줄·선택 모드·열린 노트·글 칸에서는 밀기를 보지 않는다.
  let swipe = null;
  list.addEventListener('touchstart', e => {
    swipe = null;
    if (e.touches.length !== 1 || wideList.matches || selected || pick.active || e.target.closest('[data-nb-scroll],input,textarea,[contenteditable]')) return;
    const p = e.touches[0]; swipe = {x:p.clientX, y:p.clientY, t:Date.now()};
  }, {passive:true});
  list.addEventListener('touchend', e => {
    const s = swipe; swipe = null;
    if (!s || touch?.grabbed || !e.changedTouches.length) return;
    const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.t > 800) return;
    const i = VIEWS.indexOf(view) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < VIEWS.length) { suppressUntil = Date.now() + 400; setView(VIEWS[i]); }
  }, {passive:true});
  list.addEventListener('touchcancel', () => { swipe = null; }, {passive:true});
  // Leaving the menu by keyboard, or pressing anywhere outside it and its ⋯, closes it.
  host.addEventListener('focusout', e => { const el = menuEl(); if (menu && e.relatedTarget && !el.contains(e.relatedTarget) && e.relatedTarget !== menu.trigger) closeMenu(); });
  document.addEventListener('click', e => { if (menu && !menuEl().contains(e.target) && !menu.trigger.contains(e.target)) closeMenu(); });

  return {
    // openId: a note just moved here from the basket opens once the list is read.
    // 휴지통에서 되돌린 노트를 목록에 다시 올린다(열어 둔 노트·편집 중이면 건드리지 않는다).
    reload() { if (loaded && !selected && !busy) void refresh(); },
    show({openId = null, folder = null} = {}) { void preloadMarkdown(); pendingOpen = openId; pendingFolder = folder; if (!folder && at) window.KPTURouter?.setPlace?.('basket', {folder:at}); if (!selected) void refresh(); },
    close,
    reset() { closeMenu(); void picker.close(); addPick = null; endSelect(); at = null; openSet = new Set(); { const l = folderLayer; folderLayer = null; l?.close(); } folders = []; foldersReady = false; folderSay(''); const openedLayer = layer; layer = null; openedLayer?.close(); ++epoch; bigWriter?.close({silent:true}); bigWriter = null; dropField(); selected = null; sendWhere(null); editing = false; busy = false; manual.reset(); notes = []; links = []; loaded = false; query = ''; detail.replaceChildren(); detail.hidden = true; list.hidden = false; host.querySelector('[data-note-search]').value = ''; host.querySelector('[data-note-rows]').replaceChildren(); status.textContent = ''; onOpenChange(false); },
    isBusy: () => busy,
    hasDraft: () => textDirty() || (!!selected && manual.hasDraft()),
    isOpen: () => !!selected,
  };
}
