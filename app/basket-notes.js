// MEMO-노트: the [노트] side of the basket tab. Notes are app_notes rows with kind=note (20261017052234), read and
// written through the existing owner-RLS REST paths in basket-data.js; there is no new save path.
// This module owns everything drawn into its host: list (search, newest change first) → read → edit. [+] opens the shared
// write window (write-window.js) with [노트] chosen.
// basket.js owns the [메모 | 노트] switch and decides when this host is shown.
import { readNoteDocs, saveNoteDoc, moveToBasket, noteState, validateNoteTitle, validateNoteBody, sortNotes, notePinnedAt, setNotePinned, noteFolder, noteFolders, newFolderName, setNoteFolder, validateFolderName, NOTE_FOLDER_LIMITS } from './basket-data.js';
import { deleteNoteOriginal } from './basket-record-delete.js';
import { mountManualLink } from './basket-manual-link.js';
import { renderMarkdownInto, showPlainText, preloadMarkdown } from './markdown-view.js';
import { openMarkdownEditor, copyText } from './md-editor.js';
import { openWriteWindow } from './write-window.js';
import { toTelegram } from './md-telegram.mjs';
import { driveFileUrl, fileSize } from './basket-upload.js';
import { fileLine } from './meeting-compact.js';
import { paintHtmlAttachments } from './html-frame.js';
import { placeAnchored, followAnchor, clearAnchored } from './anchored-popup.js';
import { notePreview, noteCopyPayload } from './note-preview.mjs';
import { renderFilterChips } from './filter-chips.js';
import { createChoiceSheet } from './choice-sheet.js';
import { basketNoteOrigin, basketReturnHtml } from './basket-note-tasks.js';

const chipKinds = [['project','프로젝트'], ['organization','담당조직'], ['meeting','회의'], ['document','자료실']];
const day = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', dateStyle:'medium', timeStyle:'short'}).format(d); };
// UI-바구니상세개편: [복사] on every note row and in the read view (same conversion as the write window's 텔레그램용 복사).
const MORE_ICON = '<span aria-hidden="true">⋯</span>';
const PIN_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 2.5h4M7 2.5v4l-2.5 3h7L9 6.5v-4M8 9.5v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
function showToast(message, ms = 3200) {
  const toast = document.querySelector('#toast'); if (!toast) return;
  toast.textContent = message; toast.classList.remove('hidden');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.add('hidden'), ms);
}
const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n');
export function mountNotes(host, {esc, rt = window.KPTURuntime, onOpenChange = () => {}, onMovedToBasket = () => {}}) {
  let linkOpen = false, notes = [], links = [], selected = null, editing = false, busy = false, epoch = 0, query = '', loaded = false, bigWriter = null, pendingOpen = null;
  // BUG-뒤로가기: an opened note is one router layer, so Back returns to the list at the same scroll.
  let layer = null, listScroll = 0;
  // UI-노트폴더: the folder row's choice ('all' · 'none' · 'f:<name>'), folders made from the folder ⋯ that hold no note yet
  // (this screen's memory only: a folder is kept by the notes in it), and an unfinished rename/delete ([다시 시도]).
  // The choice is also kept on this device only (never the server): one string per signed-in user under the per-owner cache
  // prefix that KPTURuntime drops on sign-out or owner change. A missing/deleted folder falls back to [전체] without a message.
  let folderView = 'all', draftFolders = [], folderJob = null, viewRestored = false;
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  const viewKey = () => { let id = ''; try { id = rt.context.read()?.user?.id || ''; } catch {} return id ? 'kptu_owner_cache:note-folder-v1:' + id : ''; };
  const saveView = () => { const key = viewKey(); if (!key) return; try { localStorage.setItem(key, folderView); } catch {} };
  const readView = () => { const key = viewKey(); if (!key) return 'all'; try { const v = localStorage.getItem(key); return typeof v === 'string' && /^(all|none|f:.+)$/.test(v) ? v : 'all'; } catch { return 'all'; } };
  host.innerHTML = `<div data-note-list><div class="note-list-head"><label class="note-search"><span class="a11y-only">노트 검색</span><input type="search" data-note-search placeholder="노트 검색" autocomplete="off" enterkeyhint="search"></label><button type="button" id="newNoteBtn" class="primary" data-note-new aria-label="새 노트">+ 노트</button></div><div class="note-folder-bar" data-note-folder-bar><div class="note-folder-filter" data-note-folder-filter></div><button type="button" class="basket-icon-button note-folder-more" data-note-folder-more aria-label="폴더 메뉴" title="폴더 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div><p class="note-folder-status" data-note-folder-status role="status" hidden></p><button type="button" class="secondary" data-note-folder-retry hidden>다시 시도</button><p data-note-list-status role="status"></p><button type="button" class="secondary" data-note-search-all hidden>전체에서 찾기</button><button type="button" data-note-retry hidden>다시 시도</button><div data-note-rows id="noteRows"></div></div><div data-note-detail hidden></div><div id="noteDocMenu" class="basket-more-menu note-pop-menu" role="group" aria-label="노트 메뉴" hidden></div>`;
  const list = host.querySelector('[data-note-list]'), detail = host.querySelector('[data-note-detail]'), status = host.querySelector('[data-note-list-status]');
  // UI-노트고정: pinned notes first, then by last change.
  const sorted = () => sortNotes(notes);
  const chips = note => links.filter(l => l.note_id === note.id && l.status === 'confirmed').map(link => {
    const [kind, label] = chipKinds.find(([key]) => link[key + '_id']) || ['other', '연결'];
    const name = link[kind]?.name || link[kind]?.title || link[kind]?.series_name || '연결 대상 없음';
    return `<span class="basket-chip" data-chip-kind="${esc(kind)}"><span class="basket-chip-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}</span>`;
  }).join('');
  const matches = note => !query || `${note.title || ''}\n${note.raw_text || ''}`.toLowerCase().includes(query);
  // UI-노트폴더 결정 4: filter by folder first, then the same pinned-first order (sortNotes) as before.
  const folders = () => noteFolders(notes, draftFolders);
  const viewFolder = () => folderView.startsWith('f:') ? folderView.slice(2) : null;
  const inView = note => folderView === 'all' || (folderView === 'none' ? !noteFolder(note) : noteFolder(note) === viewFolder());
  function paintFolders() {
    const names = folders();
    if ((folderView.startsWith('f:') && !names.includes(viewFolder())) || (folderView === 'none' && !names.length)) folderView = 'all';
    if (loaded) saveView();
    const options = [{value:'all', label:'전체'}, ...names.map(name => ({value:'f:' + name, label:name})), ...(names.length ? [{value:'none', label:'폴더 없음'}] : [])];
    renderFilterChips(host.querySelector('[data-note-folder-filter]'), {label:'노트 폴더', controls:'noteRows', value:folderView, options, onChange:value => { closeMenu(); folderView = value; renderList(); }});
  }

  function renderList() {
    paintFolders();
    const visible = sorted().filter(inView).filter(matches), showFolder = folderView === 'all';
    host.querySelector('[data-note-rows]').innerHTML = visible.map(note => {
      // UI-노트메뉴정리: a note without a title shows the start of its body in the title place; the preview is plain letters
      // (no markdown marks) and leaves out a body first line that repeats the title.
      const {shown, preview} = notePreview(note), name = [...shown].slice(0, 40).join('');
      const tags = chips(note), inFolder = showFolder && noteFolder(note);
      return `<div class="basket-row-item note-row-item"><button type="button" class="basket-row-copy" data-note-row-copy="${esc(note.id)}" aria-label="${esc(name)} 복사"${noteCopyPayload(note) ? '' : ' hidden'}>${COPY_ICON}</button><button type="button" class="basket-row-more" data-note-row-more="${esc(note.id)}" aria-label="${esc(name)} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button><button type="button" class="basket-row note-row" data-note-row="${esc(note.id)}"><b class="basket-title">${notePinnedAt(note) ? `<span class="note-pin" data-note-pinned>${PIN_ICON}<span class="a11y-only">고정됨: </span></span>` : '<span class="note-dot" aria-hidden="true"></span>'}<span class="basket-title-text">${esc([...shown].slice(0, 80).join(''))}</span></b>${preview ? `<span class="basket-preview">${esc([...preview].slice(0, 120).join(''))}</span>` : ''}<time>고친 날 ${esc(day(note.updated_at))}</time>${note.attachments?.length ? `<span>첨부 ${note.attachments.length}개</span>` : ''}${inFolder || tags ? `<span class="note-row-chips">${inFolder ? `<span class="note-row-folder" data-note-row-folder><span class="a11y-only">폴더: </span>${esc(inFolder)}</span>` : ''}${tags}</span>` : ''}</button></div>`;
    }).join('');
    if (!loaded) return;
    // UI-일기손질 ⑤: an empty note list stays empty (no guide sentence); only a search with no hit says so.
    const inFolderView = folderView !== 'all';
    status.textContent = visible.length ? `${visible.length}개 노트` : query ? (inFolderView ? '이 폴더에 찾는 노트가 없어요' : '찾는 노트가 없어요') : inFolderView ? '이 폴더에 노트가 없어요' : '';
    status.toggleAttribute('data-basket-empty', !visible.length);
    host.querySelector('[data-note-search-all]').hidden = !(query && inFolderView && !visible.length);
  }
  async function refresh() {
    if (busy) return;
    const run = ++epoch, owner = scope();
    status.textContent = '불러오는 중…'; host.querySelector('[data-note-retry]').hidden = true;
    try {
      const result = await readNoteDocs(rt);
      if (run !== epoch || owner !== scope()) return;
      notes = result.notes; links = result.links; loaded = true;
      if (!viewRestored) { viewRestored = true; folderView = readView(); }
      renderList();
      if (pendingOpen) { const id = pendingOpen; pendingOpen = null; if (notes.some(n => n.id === id)) open(id); }
    } catch {
      if (run !== epoch || owner !== scope()) return;
      notes = []; links = []; loaded = false; host.querySelector('[data-note-rows]').replaceChildren();
      status.textContent = '노트를 불러오지 못했어요. 다시 시도해 주세요.';
      host.querySelector('[data-note-retry]').hidden = false;
    }
  }

  const fields = () => ({title: detail.querySelector('[data-note-title-input]'), body: detail.querySelector('[data-basket-text]')});
  const textDirty = () => { if (!selected || !editing) return false; const f = fields(); return f.title.value !== (selected.title || '') || f.body.value !== normalize(selected.raw_text); };
  // A note with only HTML hides its empty body box; focus then goes to the HTML area.
  const readFocus = () => { const text = detail.querySelector('[data-basket-read-text]'); return text.hidden ? detail.querySelector('[data-basket-html-views]') : text; };
  // The message goes to the open note's status line, or to the list's when the action came from a list row.
  const report = text => { if (selected) say(text); else status.textContent = text; };
  const say = text => { const p = detail.querySelector('[data-basket-status]'); if (p) p.textContent = text; };
  const lock = value => { busy = value; detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => { el.disabled = value; }); if (!value) manual.controls(); };
  // UI-노트메뉴정리: one ⋯ menu for the list rows and the open note. 고정/고정 해제 · 수정 · (연결하기 · 바구니로 돌리기) · 삭제,
  // in this order; the list rows leave out the two that need the open note. It opens where it was pressed (anchored-popup.js,
  // PC and phone alike: a small list under the ⋯, kept inside the window) and closes on Esc, outside press, or choosing.
  let menu = null;
  const menuEl = () => host.querySelector('#noteDocMenu');
  // UI-노트폴더: [폴더로 옮기기] comes right after [고정]. The folder row's ⋯ uses the same menu: [새 폴더] and, with a folder
  // chosen, [이름 바꾸기]·[폴더 지우기].
  const menuItems = (note, from) => from === 'folder' ? [['data-note-folder-new', '새 폴더'], ...(viewFolder() ? [['data-note-folder-rename', '폴더 이름 바꾸기'], ['data-note-folder-delete', '폴더 지우기', 'basket-menu-danger']] : [])] : [
    ['data-note-pin', notePinnedAt(note) ? '고정 해제' : '고정'], ['data-note-folder-move', '폴더로 옮기기'], ['data-note-edit', '수정'],
    ...(from === 'detail' ? [['data-basket-link-open', '연결하기'], ['data-note-to-basket', '바구니로 돌리기']] : []),
    ['data-note-delete', '삭제', 'basket-menu-danger']];
  function closeMenu({focus = false} = {}) {
    if (!menu) return null;
    const closed = menu, el = menuEl(); menu = null; closed.stop();
    // The items stay in the (hidden) menu until the next open: basket.js's own click handler runs after this one and must still see the pressed button inside this host.
    el.hidden = true; clearAnchored(el);
    closed.trigger.setAttribute('aria-expanded', 'false');
    if (focus && closed.trigger.isConnected) closed.trigger.focus({preventScroll: true});
    return closed;
  }
  function openMenu(trigger, note, from) {
    if (!note && from !== 'folder') return;
    if (menu?.trigger === trigger) { closeMenu({focus: true}); return; }
    closeMenu();
    const el = menuEl();
    el.setAttribute('aria-label', from === 'folder' ? '폴더 메뉴' : '노트 메뉴');
    el.innerHTML = menuItems(note, from).map(([attr, label, cls]) => `<button type="button" ${attr}${cls ? ` class="${cls}"` : ''}>${label}</button>`).join('');
    el.hidden = false;
    const place = () => placeAnchored(el, trigger, {maxWidth: 220, maxHeight: 320});
    place();
    menu = {noteId: note?.id ?? null, from, trigger, stop: followAnchor(el, trigger, {place, lost: () => closeMenu()})};
    trigger.setAttribute('aria-expanded', 'true');
    el.querySelector('button')?.focus({preventScroll: true});
  }
  const manual = mountManualLink({esc, rt, getNote:() => selected, getLinks:() => links, isBusy:() => busy, setBusy:lock,
    onLinked:linked, onNoteChanged:() => reload(), onModeChange:() => paintMode(), onTaskRecorded:() => {}, sheetId:'noteLinkChoice'});

  async function linked(noteId, targets) {
    for (const target of targets) {
      const key = target.kind === 'project' ? 'project_id' : 'organization_id';
      if (!links.some(l => l.note_id === noteId && l[key] === target.target_id && l.status === 'confirmed')) links.push({note_id:noteId, status:'confirmed', [key]:target.target_id, [target.kind]:{name:target.name}});
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
    const folder = noteFolder(selected);
    box.innerHTML = `${folder ? `<span class="note-meta-folder" data-note-meta-folder>폴더 ${esc(folder)}</span>` : ''}${tags ? `<span class="basket-note-state">${tags}</span>` : `<span class="basket-note-state"><span class="basket-state-text">${esc(noteState(selected, links).status === '확정' ? '분류 완료' : '연결 없음')}</span></span>`}<time>고친 날 ${esc(day(selected.updated_at))}</time>`;
    // UI-일기손질 ⑥: each attachment is the shared file line (meeting-compact.js) with a small [Drive에서 열기] at its end.
    detail.querySelector('[data-note-attachments]').innerHTML = (selected.attachments || []).map(file => {
      const url = driveFileUrl(file.drive_file_id), name = file.file_name || '첨부';
      const end = url ? `<a class="file-line-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)} Drive에서 열기">Drive에서 열기</a>` : '<span class="file-line-state">링크를 확인할 수 없습니다.</span>';
      return fileLine({name, meta:fileSize(file.size_bytes), cls:'note-file-line', end});
    }).join('');
  }
  function paintRead() {
    const title = detail.querySelector('[data-note-read-title]'), text = detail.querySelector('[data-basket-read-text]'), raw = selected.raw_text || '';
    title.textContent = selected.title || '노트';
    detail.querySelector('[data-note-telegram]').hidden = !noteCopyPayload(selected);
    const owner = scope(), id = selected.id;
    // BUG-노트HTML표시: .html attachments show in the same sandboxed frames as the memo read view (html-frame.js),
    // under the body text. A note whose only content is HTML has no "no body" sentence.
    const htmlCount = id ? paintHtmlAttachments(detail.querySelector('[data-basket-html-views]'), {noteId:id, attachments:selected.attachments, rt, isCurrent:() => owner === scope() && selected?.id === id}) : 0;
    text.hidden = !raw && htmlCount > 0;
    text.classList.toggle('basket-read-empty', !raw);
    if (!raw) return showPlainText(text, htmlCount ? '' : '본문이 없는 노트입니다.');
    showPlainText(text, raw);
    void renderMarkdownInto(text, raw, {isCurrent: () => owner === scope() && selected?.id === id && !editing});
  }
  function paintMode() {
    if (!selected) return;
    detail.querySelector('[data-note-read]').hidden = editing;
    detail.querySelector('[data-note-head-main]').hidden = editing; if (editing) closeMenu();
    // The link form was opened from the ⋯ menu; when it closes, focus goes back to the ⋯ (there is no [연결하기] button left to find).
    const linking = manual.isOpen(); if (linkOpen && !linking && !editing) detail.querySelector('[data-note-more]')?.focus({preventScroll:true}); linkOpen = linking;
    detail.querySelector('[data-note-editor]').hidden = !editing; detail.querySelector('[data-note-edit-actions]').hidden = !editing;
  }
  function showDetail() {
    // UI-기록아이콘: opened from a project's or organization's record line, the note has no history entry of its own (one back
    // returns to that project or organization, like an update opened from there) and shows "← (name)으로 돌아가기".
    const from = !!selected && !!basketNoteOrigin(selected.id, rt);
    if (!from) layer ||= window.KPTURouter?.layer?.open('basket-notedoc', {close: () => !busy && close({fromBack:true})}) || null;
    ++epoch; editing = false; linkOpen = false; list.hidden = true; detail.hidden = false; onOpenChange(true);
    detail.innerHTML = `<div class="basket-detail-head"><button type="button" class="basket-back" data-note-close aria-label="노트 목록으로"><span aria-hidden="true">‹</span> 노트</button><div class="note-head-main" data-note-head-main><h3 class="note-head-title" data-note-read-title></h3><button type="button" class="basket-icon-button" data-note-telegram aria-label="복사" title="복사">${COPY_ICON}</button><button type="button" class="basket-icon-button basket-more-trigger" data-note-more aria-label="이 노트 메뉴" title="메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="noteDocMenu">${MORE_ICON}</button></div></div><div class="basket-read note-read" data-note-read><div class="basket-read-text" data-basket-read-text tabindex="-1" role="region" aria-label="노트 본문"></div><div class="basket-html-views" data-basket-html-views tabindex="-1" role="region" aria-label="HTML 첨부 화면"></div><p class="basket-note-meta" data-note-meta></p></div><div class="basket-editor note-editor" data-note-editor hidden><label class="basket-text-label">노트 제목<input type="text" data-note-title-input autocomplete="off" enterkeyhint="next"></label><label class="basket-text-label">본문<textarea data-basket-text rows="14"></textarea></label></div><div data-note-attachments class="note-files"></div><button type="button" data-note-reload hidden>노트 다시 불러오기</button><div data-basket-manual hidden></div><div class="basket-actions note-edit-actions" data-note-edit-actions hidden><button type="button" class="secondary" data-note-big-write>큰 창에서 수정</button><button type="button" class="primary" data-note-save>저장</button><button type="button" data-note-cancel>취소</button></div><p data-basket-status role="status"></p>`;
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
  // [+] (BASKET-업데이트통합 PR 2): the one write window (write-window.js) with [노트] preselected — the same window as menu
  // [쓰기]. It saves through createNoteDoc (or, switched to 업데이트, the basket or a chosen place) and closes; a saved note
  // then opens here in its read view. The note side keeps no draft of its own.
  // Text closed without saving (× or phone back) stays in this tab's memory for the next [+] only (never in browser storage).
  let newDraft = '';
  function openNew() {
    if (selected || busy || bigWriter) return;
    const owner = scope();
    bigWriter = openWriteWindow({text:newDraft, kind:'note', title:'새 노트', rt, onClose:(value, {saved}) => {
      bigWriter = null;
      if (saved) newDraft = '';
      if (saved?.kind === 'note') { const into = viewFolder(); if (into) void putNewNote(saved, into, owner); else { pendingOpen = saved.id; void refresh(); } return; }
      if (saved) { onMovedToBasket(); return; }
      newDraft = owner === scope() && value.trim() ? value : '';
      if (newDraft) status.textContent = '저장하지 않은 글은 [+ 노트]를 다시 누르면 이어서 쓸 수 있어요.';
      host.querySelector('[data-note-new]')?.focus({preventScroll:true});
    }});
  }
  function close({focus = true, force = false, fromBack = false} = {}) {
    if (!selected) return true;
    if (!force && textDirty() && !window.confirm('고치던 노트를 버리고 목록으로 돌아갈까요?')) return false;
    if (!force && !textDirty() && manual.hasDraft() && !window.confirm('작성 중인 연결 입력을 버리고 목록으로 돌아갈까요?')) return false;
    bigWriter?.close({silent:true}); bigWriter = null;
    closeMenu(); const id = selected.id; ++epoch; selected = null; editing = false; manual.reset();
    detail.replaceChildren(); detail.hidden = true; list.hidden = false; onOpenChange(false); renderList();
    const opened = layer; layer = null; if (!fromBack) opened?.close();
    if (window.KPTURouter?.current === 'basket') window.scrollTo({top:listScroll, behavior:'instant'});
    if (focus) ((id ? host.querySelector(`[data-note-row="${CSS.escape(id)}"]`) : host.querySelector('[data-note-new]')) || host.querySelector('[data-note-search]'))?.focus({preventScroll:true});
    return true;
  }
  function startEdit() {
    if (!selected || editing || busy) return;
    editing = true; const f = fields(); f.title.value = selected.title || ''; f.body.value = normalize(selected.raw_text); say('');
    paintMode(); f.title.focus();
  }
  function finishEdit({force = false} = {}) {
    if (!selected || !editing) return;
    if (!force && textDirty() && !window.confirm('고치던 내용을 버리고 읽기 화면으로 돌아갈까요?')) return;
    bigWriter?.close({silent:true}); bigWriter = null;
    editing = false; if (!force) say(''); paintRead(); paintMode(); readFocus().focus();
  }
  // MD-편집기: the shared full-screen editor works on the body field. Its one save icon is this view's own [저장]
  // (save below): it saves and closes (저장하고 닫기), and stays with a message on failure.
  function openBigWriter() {
    const field = fields().body, id = selected?.id;
    if (!selected || !editing || busy || !field) return;
    const same = () => editing && selected?.id === id && field.isConnected;
    bigWriter = openMarkdownEditor({text:field.value, title:'큰 창에서 수정',
      save:{aria:'노트 저장', run: async value => { if (!same()) return {ok:false, message:'수정 화면이 바뀌어 저장하지 못했어요.'}; field.value = value; return save(); }},
      onInput: value => { if (same()) field.value = value; },
      onClose: value => { bigWriter = null; if (!same()) return; field.value = value; field.focus(); }});
  }
  // save() resolves {ok:true} or {ok:false, message}; the big window's save icon waits for it (same path as [저장]).
  async function save() {
    if (!selected || !editing || busy) return {ok:false, message:'지금은 저장할 수 없어요.'};
    const f = fields();
    if (!textDirty()) { showToast('저장된 노트입니다.'); finishEdit({force:true}); return {ok:true}; }
    const changes = {title:f.title.value, raw_text:f.body.value};
    try { validateNoteTitle(changes.title); validateNoteBody(changes.raw_text); } catch (error) { say(error.message); return {ok:false, message:error.message}; }
    const id = selected.id, run = ++epoch, owner = scope(); lock(true); say('저장 중…');
    try {
      const note = await saveNoteDoc(id, changes, rt);
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      notes = notes.map(n => n.id === id ? note : n); selected = note; renderList(); paintMeta();
      finishEdit({force:true}); say(''); showToast('노트를 저장했습니다.');
      return {ok:true};
    } catch (error) {
      if (run !== epoch || owner !== scope()) return {ok:false, message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      say('저장하지 못했어요. 다시 시도해 주세요.');
      return {ok:false, message:'저장하지 못했어요. 다시 눌러 주세요.'};
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  async function telegram(note = selected) {
    const payload = noteCopyPayload(note); if (!payload) return;
    const ok = await copyText(payload.text);
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
  // UI-노트폴더 4.1: [폴더로 옮기기] opens the shared choice sheet (choice-sheet.js; a small list under the ⋯ on a PC, a bottom
  // sheet on a phone): the folders, "폴더 없음", and [+ 새 폴더]. Choosing saves at once (metadata.folder only).
  let folderTarget = null;
  const folderRow = (value, label, pressed) => `<button type="button" class="home-choice-row home-choice-pick" data-sheet-value="${esc(value)}" aria-pressed="${pressed}"><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${esc(label)}</span></button>`;
  const folderSheet = createChoiceSheet({id:'noteFolderChoice', titleId:'noteFolderChoiceTitle', historyKey:'noteFolderSheet',
    canOpen:() => !!folderTarget && !busy && host.isConnected, choices:async () => {},
    render:() => { const now = noteFolder(folderTarget);
      return {title:'폴더로 옮기기', html:[...folders().map(name => folderRow('f:' + name, name, now === name)), folderRow('none', '폴더 없음', !now), folderRow('new', '+ 새 폴더', false)].join('')}; },
    onSelect:(kind, value) => { const note = folderTarget; void folderSheet.close().then(() => chooseFolder(note, value)); }});
  const askFolderName = (text, value = '') => window.prompt(`${text} (${NOTE_FOLDER_LIMITS.name}자까지)`, value);
  const applySaved = (id, saved) => {
    notes = notes.map(n => n.id === id ? {...n, metadata:saved.metadata, updated_at:saved.updated_at} : n);
    if (selected?.id === id) selected = notes.find(n => n.id === id) || selected;
  };
  function folderSay(text, {retry = false} = {}) {
    const p = host.querySelector('[data-note-folder-status]'); p.textContent = text; p.hidden = !text;
    host.querySelector('[data-note-folder-retry]').hidden = !retry;
  }
  async function chooseFolder(note, value) {
    if (!note || busy) return;
    let name = null;
    if (value === 'new') {
      const typed = askFolderName('새 폴더 이름'); if (typed === null) return;
      try { name = newFolderName(typed, folders()).name; } catch (error) { report(error.message); return; }
    } else if (value.startsWith('f:')) name = value.slice(2);
    const run = ++epoch, owner = scope(); lock(true); report('');
    try {
      const saved = await setNoteFolder(note, name, rt);
      if (run !== epoch || owner !== scope()) return;
      applySaved(note.id, saved); renderList(); if (selected) paintMeta();
      showToast(name ? `'${name}' 폴더로 옮겼어요.` : "'폴더 없음'으로 옮겼어요.");
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      report(error?.code === 'note_changed' ? error.message : '폴더를 옮기지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  // A note written while one folder is shown goes into that folder (one more metadata write after the note is saved).
  async function putNewNote(saved, into, owner) {
    busy = true;
    try { await setNoteFolder(saved, into, rt); }
    catch { if (owner === scope()) folderSay(`노트는 저장했지만 '${into}' 폴더에 넣지 못했어요. 노트 ⋯의 [폴더로 옮기기]로 옮겨 주세요.`); }
    finally { busy = false; }
    if (owner !== scope()) return;
    pendingOpen = saved.id; void refresh();
  }
  // UI-노트폴더 4.2: the folder row's ⋯. A new folder is kept on this screen until a note is moved in (no stored folder list).
  function newFolder() {
    const typed = askFolderName('새 폴더 이름'); if (typed === null) return;
    let made; try { made = newFolderName(typed, folders()); } catch (error) { folderSay(error.message); return; }
    if (made.isNew) draftFolders = [...draftFolders, made.name];
    folderView = 'f:' + made.name; renderList();
    folderSay(made.isNew ? `'${made.name}' 폴더를 만들었어요. 노트 ⋯의 [폴더로 옮기기]로 노트를 넣으면 남아요.` : `'${made.name}' 폴더가 이미 있어요.`);
  }
  function renameFolder() {
    const from = viewFolder(); if (!from || busy) return;
    const typed = askFolderName('폴더 이름 바꾸기', from); if (typed === null) return;
    let to; try { to = validateFolderName(typed); } catch (error) { folderSay(error.message); return; }
    if (to === from) return;
    if (folders().includes(to)) { folderSay(`'${to}' 폴더가 이미 있어요. 다른 이름을 써 주세요.`); return; }
    draftFolders = draftFolders.map(name => name === from ? to : name);
    void runFolderJob({type:'rename', from, to, ids:notes.filter(n => noteFolder(n) === from).map(n => n.id)});
  }
  function deleteFolder() {
    const from = viewFolder(); if (!from || busy) return;
    const ids = notes.filter(n => noteFolder(n) === from).map(n => n.id);
    if (!window.confirm(`'${from}' 폴더를 지울까요? 노트 ${ids.length}개는 '폴더 없음'으로 가요.`)) return;
    draftFolders = draftFolders.filter(name => name !== from);
    void runFolderJob({type:'delete', from, to:null, ids});
  }
  // Rename and delete write note by note (design 결정 1 ②). A part that failed stays in folderJob; [다시 시도] runs only those
  // notes again (a note already in the new place is left as it is; one moved elsewhere in between is skipped).
  async function runFolderJob(job) {
    const owner = scope(), run = ++epoch, total = job.total ?? job.ids.length, rename = job.type === 'rename', failed = [];
    let skipped = 0; busy = true; folderJob = null;
    folderSay(rename ? '폴더 이름을 바꾸는 중…' : '폴더를 지우는 중…');
    for (const id of job.ids) {
      const note = notes.find(n => n.id === id); if (!note) continue;
      try { const saved = await setNoteFolder(note, job.to, rt, {from:job.from}); if (run !== epoch || owner !== scope()) return; applySaved(id, saved); }
      catch (error) { if (run !== epoch || owner !== scope()) return; if (error?.code === 'folder_moved') skipped++; else failed.push(id); }
    }
    busy = false;
    folderView = rename ? 'f:' + job.to : failed.length ? 'f:' + job.from : 'all';
    renderList();
    if (failed.length) {
      folderJob = {...job, ids:failed, total};
      folderSay(`노트 ${total}개 중 ${total - failed.length}개만 ${rename ? '바뀌었어요' : '옮겼어요'}. [다시 시도]를 누르면 나머지 ${failed.length}개를 마저 ${rename ? '바꿔요' : '옮겨요'}.`, {retry:true});
      host.querySelector('[data-note-folder-retry]').focus({preventScroll:true});
    } else {
      folderSay('');
      showToast(rename ? `폴더 이름을 '${job.to}'(으)로 바꿨어요.` : `'${job.from}' 폴더를 지웠어요. 노트는 '폴더 없음'에 있어요.`);
    }
    if (skipped) void refresh();
  }
  async function toBasket() {
    if (!selected || editing || busy) return;
    if (!window.confirm('이 노트를 바구니 업데이트로 돌릴까요? 제목은 지워지고 본문·첨부·연결은 그대로 남아요.')) return;
    const note = selected, run = ++epoch, owner = scope(); lock(true); say('');
    try {
      await moveToBasket(note, rt);
      if (run !== epoch || owner !== scope()) return;
      notes = notes.filter(n => n.id !== note.id); links = links.filter(l => l.note_id !== note.id);
      busy = false; close({force:true, focus:false}); status.textContent = '바구니로 돌렸어요.'; onMovedToBasket(note.id);
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      say(/바구니/.test(error?.message || '') ? error.message : '바구니로 돌리지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch && selected) lock(false); else busy = false; }
  }
  // [삭제] from the open note or from a list row: the same confirmation (what goes with it) and the same delete path.
  async function remove(id = selected?.id) {
    if (!id || editing || busy) return;
    const fromList = !selected, run = ++epoch, owner = scope(); lock(true); report('');
    const current = () => run === epoch && owner === scope() && window.KPTURouter.current === 'basket' && (fromList ? !selected : selected?.id === id);
    let result;
    try { result = await deleteNoteOriginal(id, {rt, isCurrent:current}); }
    catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. 노트 다시 불러오기로 실제 상태를 확인해 주세요.'}; }
    finally { busy = false; }
    if (!current() || result.status === 'stale') return;
    if (['deleted', 'missing'].includes(result.status)) {
      notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
      const message = String(result.message || '').replace('업데이트', '노트');
      if (fromList) { renderList(); status.textContent = message; host.querySelector('[data-note-new]')?.focus({preventScroll:true}); return; }
      close({force:true}); status.textContent = message;
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
  // A menu item acts on the note the menu was opened for (a list row's note need not be open).
  function menuAction(b, from) {
    if (from.from === 'folder') {
      if (b.hasAttribute('data-note-folder-new')) newFolder();
      else if (b.hasAttribute('data-note-folder-rename')) renameFolder();
      else if (b.hasAttribute('data-note-folder-delete')) deleteFolder();
      return;
    }
    const note = notes.find(n => n.id === from.noteId); if (!note) return;
    if (b.hasAttribute('data-note-pin')) void pin(note);
    else if (b.hasAttribute('data-note-folder-move')) { folderTarget = note; void folderSheet.open('folder', from.trigger); }
    else if (b.hasAttribute('data-note-edit')) { if (selected?.id !== note.id) open(note.id, {focus:false}); startEdit(); }
    else if (b.hasAttribute('data-basket-link-open')) say(manual.open('link') || '');
    else if (b.hasAttribute('data-note-to-basket')) void toBasket();
    else if (b.hasAttribute('data-note-delete')) void remove(note.id);
  }
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !host.contains(b)) return;
    if (b.closest('#noteDocMenu')) { const from = closeMenu({focus:true}); if (from && !busy) menuAction(b, from); return; }
    if (b.hasAttribute('data-note-more')) { if (!busy && selected && !editing) openMenu(b, selected, 'detail'); return; }
    if (b.hasAttribute('data-note-folder-more')) { if (!busy && !selected) openMenu(b, null, 'folder'); return; }
    if (b.hasAttribute('data-note-row-more')) { if (!busy && !selected) openMenu(b, notes.find(n => n.id === b.dataset.noteRowMore), 'list'); return; }
    closeMenu();
    if (busy) return;
    if (b.hasAttribute('data-note-row-copy')) { void telegram(notes.find(n => n.id === b.dataset.noteRowCopy)); return; }
    if (b.hasAttribute('data-note-row')) open(b.dataset.noteRow);
    else if (b.hasAttribute('data-note-new')) openNew();
    else if (b.hasAttribute('data-note-retry')) void refresh();
    else if (b.hasAttribute('data-note-folder-retry')) { if (folderJob) void runFolderJob(folderJob); }
    else if (b.hasAttribute('data-note-search-all')) { folderView = 'all'; renderList(); host.querySelector('[data-note-search]').focus({preventScroll:true}); }
    else if (b.hasAttribute('data-note-close')) close();
    else if (b.hasAttribute('data-note-cancel')) finishEdit();
    else if (b.hasAttribute('data-note-save')) void save();
    else if (b.hasAttribute('data-note-big-write')) openBigWriter();
    else if (b.hasAttribute('data-note-telegram')) void telegram();
    else if (b.hasAttribute('data-note-reload')) void reload();
  });
  host.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menu) { e.preventDefault(); e.stopPropagation(); closeMenu({focus:true}); return; }
    if (!selected || busy) return;
    e.preventDefault(); e.stopPropagation();
    if (manual.isOpen()) manual.cancel();
    else if (editing) finishEdit();
    else close();
  });
  // Leaving the menu by keyboard, or pressing anywhere outside it and its ⋯, closes it.
  host.addEventListener('focusout', e => { const el = menuEl(); if (menu && e.relatedTarget && !el.contains(e.relatedTarget) && e.relatedTarget !== menu.trigger) closeMenu(); });
  document.addEventListener('click', e => { if (menu && !menuEl().contains(e.target) && !menu.trigger.contains(e.target)) closeMenu(); });

  return {
    // openId: a note just moved here from the basket opens once the list is read.
    show({openId = null} = {}) { void preloadMarkdown(); pendingOpen = openId; if (!selected) void refresh(); },
    close,
    reset() { closeMenu(); void folderSheet.close(); folderTarget = null; folderView = 'all'; viewRestored = false; draftFolders = []; folderJob = null; folderSay(''); newDraft = ''; const opened = layer; layer = null; opened?.close(); ++epoch; bigWriter?.close({silent:true}); bigWriter = null; selected = null; editing = false; busy = false; manual.reset(); notes = []; links = []; loaded = false; query = ''; detail.replaceChildren(); detail.hidden = true; list.hidden = false; host.querySelector('[data-note-search]').value = ''; host.querySelector('[data-note-rows]').replaceChildren(); status.textContent = ''; onOpenChange(false); },
    isBusy: () => busy,
    hasDraft: () => textDirty() || (!!selected && manual.hasDraft()),
    isOpen: () => !!selected,
  };
}
