// MEMO-노트: the [노트] side of the basket tab. Notes are app_notes rows with kind=note (20261017052234), read and
// written through the existing owner-RLS REST paths in basket-data.js; there is no new save path.
// This module owns everything drawn into its host: list (search, newest change first) → read → edit.
// basket.js owns the [메모 | 노트] switch and decides when this host is shown.
import { readNoteDocs, saveNoteDoc, moveToBasket, noteState, validateNoteTitle, validateNoteBody } from './basket-data.js';
import { deleteNoteOriginal } from './basket-record-delete.js';
import { mountManualLink } from './basket-manual-link.js';
import { renderMarkdownInto, showPlainText, preloadMarkdown } from './markdown-view.js';
import { openMarkdownEditor, copyText } from './md-editor.js';
import { toTelegram } from './md-telegram.mjs';
import { driveFileUrl, fileSize } from './basket-upload.js';

const chipKinds = [['project','프로젝트'], ['organization','담당조직'], ['meeting','회의'], ['document','자료실']];
const day = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', dateStyle:'medium', timeStyle:'short'}).format(d); };
const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n');

export function mountNotes(host, {esc, rt = window.KPTURuntime, onOpenChange = () => {}, onMovedToBasket = () => {}}) {
  let notes = [], links = [], selected = null, editing = false, busy = false, epoch = 0, query = '', loaded = false, bigWriter = null, pendingOpen = null;
  // BUG-뒤로가기: an opened note is one router layer, so Back returns to the list at the same scroll.
  let layer = null, listScroll = 0;
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  host.innerHTML = `<div data-note-list><label class="note-search"><span class="a11y-only">노트 검색</span><input type="search" data-note-search placeholder="노트 검색" autocomplete="off" enterkeyhint="search"></label><p data-note-list-status role="status"></p><button type="button" data-note-retry hidden>다시 시도</button><div data-note-rows></div></div><div data-note-detail hidden></div>`;
  const list = host.querySelector('[data-note-list]'), detail = host.querySelector('[data-note-detail]'), status = host.querySelector('[data-note-list-status]');
  const sorted = () => notes.slice().sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || String(b.id).localeCompare(String(a.id)));
  const chips = note => links.filter(l => l.note_id === note.id && l.status === 'confirmed').map(link => {
    const [kind, label] = chipKinds.find(([key]) => link[key + '_id']) || ['other', '연결'];
    const name = link[kind]?.name || link[kind]?.title || link[kind]?.series_name || '연결 대상 없음';
    return `<span class="basket-chip" data-chip-kind="${esc(kind)}"><span class="basket-chip-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}</span>`;
  }).join('');
  const matches = note => !query || `${note.title || ''}\n${note.raw_text || ''}`.toLowerCase().includes(query);

  function renderList() {
    const visible = sorted().filter(matches);
    host.querySelector('[data-note-rows]').innerHTML = visible.map(note => {
      const preview = String(note.raw_text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ');
      const tags = chips(note);
      return `<button type="button" class="basket-row note-row" data-note-row="${esc(note.id)}"><b class="basket-title"><span class="note-dot" aria-hidden="true"></span>${esc([...(note.title || '노트')].slice(0, 80).join(''))}</b>${preview ? `<span class="basket-preview">${esc([...preview].slice(0, 120).join(''))}</span>` : ''}<time>고친 날 ${esc(day(note.updated_at))}</time>${note.attachments?.length ? `<span>첨부 ${note.attachments.length}개</span>` : ''}${tags ? `<span class="note-row-chips">${tags}</span>` : ''}</button>`;
    }).join('');
    if (!loaded) return;
    status.textContent = visible.length ? `${visible.length}개 노트` : query ? '찾는 노트가 없어요' : '아직 노트가 없어요. 바구니 메모의 ⋯ → [노트로 옮기기]로 만들 수 있어요.';
    status.toggleAttribute('data-basket-empty', !visible.length);
  }
  async function refresh() {
    if (busy) return;
    const run = ++epoch, owner = scope();
    status.textContent = '불러오는 중…'; host.querySelector('[data-note-retry]').hidden = true;
    try {
      const result = await readNoteDocs(rt);
      if (run !== epoch || owner !== scope()) return;
      notes = result.notes; links = result.links; loaded = true; renderList();
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
  const say = text => { const p = detail.querySelector('[data-basket-status]'); if (p) p.textContent = text; };
  const lock = value => { busy = value; detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => { el.disabled = value; }); if (!value) manual.controls(); };
  const noteMenu = () => detail.querySelector('#noteDocMenu');
  function setNoteMenu(open, {focus = false} = {}) {
    const menu = noteMenu(), button = detail.querySelector('[data-note-more]');
    if (!menu || menu.hidden === !open) return;
    menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button:not(:disabled)')?.focus(); else if (focus) button.focus();
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
    box.innerHTML = `${tags ? `<span class="basket-note-state">${tags}</span>` : `<span class="basket-note-state"><span class="basket-state-text">${esc(noteState(selected, links).status === '확정' ? '연결됨' : '연결 없음')}</span></span>`}<time>고친 날 ${esc(day(selected.updated_at))}</time>`;
    detail.querySelector('[data-note-attachments]').innerHTML = (selected.attachments || []).map(file => { const url = driveFileUrl(file.drive_file_id); return `<div class="library-selected-file"><div class="library-selected-file-main"><b>${esc(file.file_name)}</b><small>${esc(fileSize(file.size_bytes))}</small></div>${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">Drive에서 열기</a>` : '<span>링크를 확인할 수 없습니다.</span>'}</div>`; }).join('');
  }
  function paintRead() {
    const title = detail.querySelector('[data-note-read-title]'), text = detail.querySelector('[data-basket-read-text]'), raw = selected.raw_text || '';
    title.textContent = selected.title || '노트';
    text.classList.toggle('basket-read-empty', !raw);
    if (!raw) return showPlainText(text, '본문이 없는 노트입니다.');
    showPlainText(text, raw);
    const owner = scope(), id = selected.id;
    void renderMarkdownInto(text, raw, {isCurrent: () => owner === scope() && selected?.id === id && !editing});
  }
  function paintMode() {
    if (!selected) return;
    detail.querySelector('[data-note-read]').hidden = editing;
    detail.querySelector('[data-note-read-actions]').hidden = editing || manual.isOpen();
    detail.querySelector('[data-note-more-wrap]').hidden = editing; if (editing) setNoteMenu(false);
    detail.querySelector('[data-note-editor]').hidden = !editing; detail.querySelector('[data-note-edit-actions]').hidden = !editing;
  }
  function open(id, {focus = true} = {}) {
    if (!selected) listScroll = window.scrollY;
    selected = notes.find(n => n.id === id); if (!selected) return;
    layer ||= window.KPTURouter?.layer?.open('basket-notedoc', {close: () => !busy && close({fromBack:true})}) || null;
    ++epoch; editing = false; list.hidden = true; detail.hidden = false; onOpenChange(true);
    detail.innerHTML = `<div class="basket-detail-head"><button type="button" class="basket-back" data-note-close aria-label="노트 목록으로"><span aria-hidden="true">‹</span> 노트</button><div class="basket-note-more" data-note-more-wrap><button type="button" class="basket-more-trigger" data-note-more aria-label="이 노트 메뉴" aria-expanded="false" aria-controls="noteDocMenu"><span aria-hidden="true">⋯</span></button><div id="noteDocMenu" class="basket-more-menu" role="group" aria-label="이 노트" hidden><button type="button" data-note-to-basket>바구니로 돌리기</button><button type="button" class="basket-menu-danger" data-note-delete>삭제</button></div></div></div><div class="basket-read note-read" data-note-read><h3 class="note-read-title" data-note-read-title></h3><div class="basket-read-text" data-basket-read-text tabindex="-1" role="region" aria-label="노트 본문"></div><p class="basket-note-meta" data-note-meta></p></div><div class="basket-editor note-editor" data-note-editor hidden><label class="basket-text-label">노트 제목<input type="text" data-note-title-input autocomplete="off" enterkeyhint="next"></label><label class="basket-text-label">본문<textarea data-basket-text rows="14"></textarea></label><div class="basket-editor-tools"><button type="button" class="secondary" data-note-big-write>큰 창에서 수정</button></div></div><div data-note-attachments class="library-selected-files"></div><button type="button" data-note-reload hidden>노트 다시 불러오기</button><div class="basket-actions basket-read-actions" data-note-read-actions><button type="button" data-note-edit>고치기</button><button type="button" data-note-telegram>텔레그램용 복사</button><button type="button" class="primary" data-basket-link-open>연결하기</button></div><div data-basket-manual hidden></div><div class="basket-actions" data-note-edit-actions hidden><button type="button" class="primary" data-note-save>저장</button><button type="button" data-note-cancel>취소</button></div><p data-basket-status role="status"></p>`;
    manual.attach(detail.querySelector('[data-basket-manual]'));
    paintRead(); paintMeta(); paintMode();
    if (focus) detail.querySelector('[data-basket-read-text]').focus();
  }
  function close({focus = true, force = false, fromBack = false} = {}) {
    if (!selected) return true;
    if (!force && textDirty() && !window.confirm('고치던 노트를 버리고 목록으로 돌아갈까요?')) return false;
    if (!force && !textDirty() && manual.hasDraft() && !window.confirm('작성 중인 연결 입력을 버리고 목록으로 돌아갈까요?')) return false;
    bigWriter?.close({silent:true}); bigWriter = null;
    const id = selected.id; ++epoch; selected = null; editing = false; manual.reset();
    detail.replaceChildren(); detail.hidden = true; list.hidden = false; onOpenChange(false); renderList();
    const opened = layer; layer = null; if (!fromBack) opened?.close();
    if (window.KPTURouter?.current === 'basket') window.scrollTo({top:listScroll, behavior:'instant'});
    if (focus) (host.querySelector(`[data-note-row="${CSS.escape(id)}"]`) || host.querySelector('[data-note-search]'))?.focus({preventScroll:true});
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
    editing = false; if (!force) say(''); paintRead(); paintMode(); detail.querySelector('[data-basket-read-text]').focus();
  }
  // MD-편집기: the shared full-screen editor works on the body field; saving stays this view's [저장].
  function openBigWriter() {
    const field = fields().body, id = selected?.id;
    if (!selected || !editing || busy || !field) return;
    const same = () => editing && selected?.id === id && field.isConnected;
    bigWriter = openMarkdownEditor({text:field.value, title:'큰 창에서 수정',
      onInput: value => { if (same()) field.value = value; },
      onClose: value => { bigWriter = null; if (!same()) return; field.value = value; field.focus(); }});
  }
  async function save() {
    if (!selected || !editing || busy) return;
    const f = fields();
    if (!textDirty()) { say('저장된 노트입니다.'); finishEdit({force:true}); return; }
    const changes = {title:f.title.value, raw_text:f.body.value};
    try { validateNoteTitle(changes.title); validateNoteBody(changes.raw_text); } catch (error) { say(error.message); return; }
    const id = selected.id, run = ++epoch, owner = scope(); lock(true); say('저장 중…');
    try {
      const note = await saveNoteDoc(id, changes, rt);
      if (run !== epoch || owner !== scope()) return;
      notes = notes.map(n => n.id === id ? note : n); selected = note; renderList(); paintMeta();
      finishEdit({force:true}); say('노트를 저장했습니다.');
    } catch (error) {
      if (run !== epoch || owner !== scope()) return;
      say('저장하지 못했어요. 다시 시도해 주세요.');
    } finally { if (run === epoch) lock(false); else busy = false; }
  }
  async function telegram() {
    if (!selected) return;
    const ok = await copyText(toTelegram(`# ${selected.title || '노트'}\n\n${selected.raw_text || ''}`));
    say(ok ? '텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.' : '복사하지 못했어요. 다시 눌러 주세요.');
  }
  async function toBasket() {
    if (!selected || editing || busy) return;
    if (!window.confirm('이 노트를 바구니 메모로 돌릴까요? 제목은 지워지고 본문·첨부·연결은 그대로 남아요.')) return;
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
  async function remove() {
    if (!selected || editing || busy) return;
    const id = selected.id, run = ++epoch, owner = scope(); lock(true); say('');
    const current = () => run === epoch && owner === scope() && selected?.id === id && window.KPTURouter.current === 'basket';
    let result;
    try { result = await deleteNoteOriginal(id, {rt, isCurrent:current}); }
    catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. 노트 다시 불러오기로 실제 상태를 확인해 주세요.'}; }
    finally { busy = false; }
    if (!current() || result.status === 'stale') return;
    if (['deleted', 'missing'].includes(result.status)) {
      notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
      close({force:true}); status.textContent = String(result.message || '').replace('메모', '노트');
      return;
    }
    lock(false);
    if (result.status === 'cancelled') { detail.querySelector('[data-note-more]').focus(); return; }
    say(result.message);
    if (result.status === 'unknown') detail.querySelector('[data-note-reload]').hidden = false;
  }
  async function reload() {
    if (!selected) return;
    const id = selected.id, owner = scope(), run = ++epoch;
    try { const fresh = await readNoteDocs(rt); if (run !== epoch || owner !== scope()) return; notes = fresh.notes; links = fresh.links; renderList();
      if (notes.some(n => n.id === id)) open(id); else close({force:true}); }
    catch { if (run === epoch && owner === scope()) say('노트를 다시 불러오지 못했어요. 다시 시도해 주세요.'); }
  }

  host.addEventListener('input', e => { if (e.target.matches('[data-note-search]')) { query = e.target.value.trim().toLowerCase(); renderList(); } });
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !host.contains(b)) return;
    if (b.hasAttribute('data-note-more')) { setNoteMenu(noteMenu()?.hidden ?? false); return; }
    if (noteMenu()?.contains(b)) setNoteMenu(false, {focus:true});
    if (busy) return;
    if (b.hasAttribute('data-note-row')) open(b.dataset.noteRow);
    else if (b.hasAttribute('data-note-retry')) void refresh();
    else if (b.hasAttribute('data-note-close')) close();
    else if (b.hasAttribute('data-note-edit')) startEdit();
    else if (b.hasAttribute('data-note-cancel')) finishEdit();
    else if (b.hasAttribute('data-note-save')) void save();
    else if (b.hasAttribute('data-note-big-write')) openBigWriter();
    else if (b.hasAttribute('data-note-telegram')) void telegram();
    else if (b.hasAttribute('data-basket-link-open')) say(manual.open('link') || '');
    else if (b.hasAttribute('data-note-to-basket')) void toBasket();
    else if (b.hasAttribute('data-note-delete')) void remove();
    else if (b.hasAttribute('data-note-reload')) void reload();
  });
  host.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !selected || busy) return;
    e.preventDefault(); e.stopPropagation();
    if (noteMenu() && !noteMenu().hidden) setNoteMenu(false, {focus:true});
    else if (manual.isOpen()) manual.cancel();
    else if (editing) finishEdit();
    else close();
  });
  host.addEventListener('focusout', e => { const wrap = detail.querySelector('[data-note-more-wrap]'); if (wrap?.contains(e.target) && e.relatedTarget && !wrap.contains(e.relatedTarget)) setNoteMenu(false); });
  document.addEventListener('click', e => { const wrap = detail.querySelector('[data-note-more-wrap]'); if (wrap && noteMenu() && !noteMenu().hidden && !wrap.contains(e.target)) setNoteMenu(false); });

  return {
    // openId: a note just moved here from the basket opens once the list is read.
    show({openId = null} = {}) { void preloadMarkdown(); pendingOpen = openId; if (!selected) void refresh(); },
    close,
    reset() { const opened = layer; layer = null; opened?.close(); ++epoch; bigWriter?.close({silent:true}); bigWriter = null; selected = null; editing = false; busy = false; manual.reset(); notes = []; links = []; loaded = false; query = ''; detail.replaceChildren(); detail.hidden = true; list.hidden = false; host.querySelector('[data-note-search]').value = ''; host.querySelector('[data-note-rows]').replaceChildren(); status.textContent = ''; onOpenChange(false); },
    isBusy: () => busy,
    hasDraft: () => textDirty() || (!!selected && manual.hasDraft()),
    isOpen: () => !!selected,
  };
}
