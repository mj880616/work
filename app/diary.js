// JOURNAL-일기 1차: the [일기] side of the schedule tab (?view=diary). This module is the only renderer of #diaryRoot:
// month photo calendar → the chosen day below it (photos large, swipe sideways, and the text) → write/edit panel.
// Rows, photos and photo views go through diary-data.js (owner RLS + basket-files); deleting uses the basket's
// note-delete path (attachments to the Drive trash). Back closes the top open thing first (router layers).
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {seoulParts, seoulDate, addSeoulDays, seoulDateKey, formatSeoulTime} from './meeting-time.js';
import {readDiaryMonth, readDiaryDay, createDiary, saveDiaryText, removeDiaryPhoto, dropEmptyDiary, uploadDiaryPhotos, photoElement,
  diaryPhotos, diaryText, takeRequestedDay, todayKey, ownerScope, validateDiaryText, DIARY_MAX_PHOTOS, DIARY_COMMENT_MAX,
  photoComments, cleanComments, saveDiaryComments} from './diary-data.js';
import {deleteNoteOriginal} from './basket-record-delete.js';
// ED③ 일기: the day's text is the new editor (ed-editor.js) inside this panel; the read view draws its saved form (ed-render). The photos,
// their comments, the calendar and the swipe stay as they were. Letters (raw_text) are still saved with it for every other reader.
import {renderDoc} from './ed-render.mjs';
import {diaryHasDoc, diaryStartDoc, joinDiaryDocs, diaryDocToStore, diaryDocError} from './diary-doc.mjs';

(() => {
if (window.KPTUDiary) return;
const root = document.querySelector('#diaryRoot');
if (!root) return;
const rt = window.KPTURuntime;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const longDay = day => formatSeoulTime(day, {month:'long', day:'numeric', weekday:'long'});
const shortDay = day => formatSeoulTime(day, {month:'long', day:'numeric'});

root.innerHTML = `<div class="diary-head"><div class="diary-month"><button type="button" class="mini" data-diary-prev aria-label="이전 달">‹</button><b data-diary-title aria-live="polite"></b><button type="button" class="mini" data-diary-next aria-label="다음 달">›</button><button type="button" class="mini" data-diary-today>오늘</button></div><button type="button" id="newDiaryBtn" class="primary" data-diary-new aria-label="일기 쓰기">+ 일기</button></div>
<p class="diary-status" data-diary-status role="status"></p><button type="button" class="secondary" data-diary-retry hidden>다시 시도</button>
<div class="diary-cal" data-diary-cal><div class="diary-week-head" aria-hidden="true">${['일','월','화','수','목','금','토'].map((d, i) => `<span${i === 0 ? ' class="sunday"' : i === 6 ? ' class="saturday"' : ''}>${d}</span>`).join('')}</div><div class="diary-days" data-diary-days></div></div>
<section class="diary-list" data-diary-list hidden aria-label="이 달 일기 목록"></section>
<section class="diary-detail" data-diary-detail hidden aria-labelledby="diaryDetailTitle"></section>
<section class="diary-editor" data-diary-editor data-enter-save hidden aria-labelledby="diaryEditorTitle"></section>`;
const $ = selector => root.querySelector(selector);
const cal = $('[data-diary-cal]'), days = $('[data-diary-days]'), detail = $('[data-diary-detail]'), list = $('[data-diary-list]'), editor = $('[data-diary-editor]'), status = $('[data-diary-status]');

let cursor = seoulParts(new Date()), rows = new Map(), loadedMonth = '', epoch = 0, owner = ownerScope(rt);
let selected = null, source = 'all', dayLayer = null;
let edit = null, editLayer = null;
const monthKey = () => `${cursor.year}-${cursor.month}`;
const monthOf = day => { const [y, m] = day.split('-').map(Number); return `${y}-${m - 1}`; };
const current = run => run === epoch && owner === ownerScope(rt);

function renderMonth() {
  $('[data-diary-title]').textContent = `${cursor.year}년 ${cursor.month + 1}월`;
  const first = seoulDate(cursor.year, cursor.month), lead = seoulParts(first).weekday;
  const total = seoulParts(seoulDate(cursor.year, cursor.month + 1, 0)).day, today = todayKey();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(Object.assign(document.createElement('span'), {className:'diary-cell diary-blank'}));
  for (let n = 1; n <= total; n++) {
    const day = seoulDateKey(addSeoulDays(first, n - 1)), row = rows.get(day), photos = diaryPhotos(row), text = diaryText(row);
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'diary-cell'; cell.dataset.diaryDay = day;
    if (day === today) cell.setAttribute('aria-current', 'date');
    cell.setAttribute('aria-pressed', String(selected === day));
    cell.setAttribute('aria-label', `${shortDay(day)}${photos.length ? `, 사진 ${photos.length}장` : text ? ', 글' : ''}`);
    if (photos[0]) { cell.classList.add('has-photo'); cell.append(photoElement(row, photos[0], 'small', {label:'', link:false})); }
    const num = document.createElement('span'); num.className = 'diary-num'; num.textContent = String(n); cell.append(num);
    if (!photos.length && text) { const dot = document.createElement('span'); dot.className = 'diary-dot'; dot.dataset.diaryDot = ''; cell.append(dot); }
    cells.push(cell);
  }
  days.replaceChildren(...cells);
  renderList();
}
// Month list under the calendar: date + first line, newest first. A chosen day replaces it (the detail takes the same spot).
function firstLine(row) {
  const line = diaryText(row).split('\n').map(part => part.trim()).find(Boolean);
  if (line) return line;
  const n = diaryPhotos(row).length; return n ? `사진 ${n}장` : '';
}
function renderList() {
  const days = [...rows.keys()].filter(day => monthOf(day) === monthKey() && rows.get(day)).sort().reverse();
  list.hidden = !!selected || !!edit || !days.length;
  list.replaceChildren(...days.map(day => {
    const row = rows.get(day), item = document.createElement('button');
    item.type = 'button'; item.className = 'diary-list-item'; item.dataset.diaryListDay = day;
    const date = document.createElement('b'), line = document.createElement('span');
    date.textContent = shortDay(day); line.textContent = firstLine(row);
    item.append(date, line); return item;
  }));
}
async function loadMonth({force = false} = {}) {
  if (!force && loadedMonth === monthKey()) return renderMonth();
  const run = ++epoch, key = monthKey();
  status.textContent = '불러오는 중…'; $('[data-diary-retry]').hidden = true;
  rows = new Map(); renderMonth();
  try {
    const list = await readDiaryMonth(cursor.year, cursor.month, rt);
    if (!current(run)) return;
    rows = new Map((Array.isArray(list) ? list : []).map(row => [row.journal_day, row])); loadedMonth = key;
    status.textContent = rows.size ? '' : '이 달에는 아직 일기가 없어요. [+]로 사진이나 글을 남겨 보세요.';
    renderMonth();
    if (selected && monthOf(selected) === key) renderDetail();
  } catch {
    if (!current(run)) return;
    status.textContent = '일기를 불러오지 못했어요. 다시 시도해 주세요.'; $('[data-diary-retry]').hidden = false;
  }
}
function moveMonth(step) {
  const next = new Date(Date.UTC(cursor.year, cursor.month + step, 1));
  cursor = {year:next.getUTCFullYear(), month:next.getUTCMonth()};
  closeDetail(); loadMonth();
}

function selectDay(day, {focus = false} = {}) {
  selected = day; source = 'all';
  days.querySelectorAll('[data-diary-day]').forEach(cell => cell.setAttribute('aria-pressed', String(cell.dataset.diaryDay === day)));
  renderDetail();
  dayLayer ||= window.KPTURouter?.layer?.open('diary-day', {close:() => { closeDetail({fromBack:true}); return true; }}) || null;
  requestAnimationFrame(() => { detail.scrollIntoView({block:'nearest', behavior:'smooth'}); if (focus) (detail.querySelector('h3') || detail.querySelector('[data-diary-detail-close]'))?.focus(); });
}
// BUG-오늘버튼: [오늘] goes to this month (when needed) and chooses today, opening its detail like a tap on the day.
// Today already chosen stays as it is. Another month first loads this month, then chooses today if still here.
function goToday() {
  const t = seoulParts(new Date()), day = todayKey();
  if (t.year === cursor.year && t.month === cursor.month) { if (selected !== day) selectDay(day); return; }
  cursor = {year:t.year, month:t.month}; closeDetail();
  loadMonth().then(() => { if (!edit && !selected && loadedMonth === monthKey() && monthKey() === monthOf(day)) selectDay(day); });
}
// UI-상단줄제목: the open day goes to the PC top line's place (kptu:where-item, topbar-actions.js); null drops it.
const sendWhere = name => window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'diary', name}}));
// UI-중복제목삭제: with the PC top line (1024px~) the open day is already named there, so the day panel's head has no title line of its own
// there (the element is not made; the panel is named by aria-label instead). Below that width the head keeps its title, as before.
const toplineWide = window.matchMedia?.('(min-width:1024px)');
function syncDetailTitle() {
  const head = selected && detail.querySelector('.diary-panel-head'); if (!head) return;
  let title = head.querySelector('#diaryDetailTitle');
  if (toplineWide?.matches) { title?.remove(); detail.removeAttribute('aria-labelledby'); detail.setAttribute('aria-label', longDay(selected)); return; }
  if (!title) { title = document.createElement('h3'); title.id = 'diaryDetailTitle'; title.tabIndex = -1; head.prepend(title); }
  detail.removeAttribute('aria-label'); detail.setAttribute('aria-labelledby', 'diaryDetailTitle');
  title.textContent = longDay(selected);
}
toplineWide?.addEventListener?.('change', syncDetailTitle);
function closeDetail({fromBack = false} = {}) {
  closeViewer({fromBack, restore:false});
  selected = null; sendWhere(null); detail.hidden = true; detail.replaceChildren();
  days.querySelectorAll('[aria-pressed="true"]').forEach(cell => cell.setAttribute('aria-pressed', 'false'));
  const opened = dayLayer; dayLayer = null; if (!fromBack) opened?.close();
  renderList();
}
function renderDetail() {
  if (!selected) return;
  sendWhere(longDay(selected));
  const row = rows.get(selected), photos = diaryPhotos(row), text = diaryText(row);
  detail.hidden = false; list.hidden = true;
  detail.innerHTML = `<div class="diary-panel-head"><button type="button" class="icon-btn" data-diary-detail-close aria-label="날짜 닫기">×</button></div>${row ? `<div class="diary-source" role="group" aria-label="사진 보기"><button type="button" data-diary-source="all" aria-pressed="${source === 'all'}">전체</button><button type="button" data-diary-source="star" aria-pressed="${source === 'star'}">별표</button></div><div data-diary-photos></div>${text ? `<div class="diary-text${diaryHasDoc(row) ? ' is-doc' : ''}" data-diary-text-view>${diaryHasDoc(row) ? '' : esc(text)}</div>` : ''}<div class="diary-actions"><button type="button" class="secondary" data-diary-edit>수정</button><button type="button" class="secondary diary-danger" data-diary-delete>일기 지우기</button></div>` : `<p class="diary-muted">이 날 일기가 없어요.</p>`}`;
  syncDetailTitle();
  const view = detail.querySelector('[data-diary-text-view]');
  if (view && diaryHasDoc(row)) view.replaceChildren(renderDoc(row.doc));
  const host = detail.querySelector('[data-diary-photos]');
  if (!host) return;
  if (source === 'star') { host.innerHTML = '<p class="diary-muted diary-star-note" data-diary-star-note>원드라이브 연결 뒤 쓸 수 있어요</p>'; return; }
  if (!photos.length) { host.innerHTML = '<p class="diary-muted">직접 올린 사진이 없어요.</p>'; return; }
  // Small square grid (four a row on a phone); a photo opens full screen.
  const grid = document.createElement('div');
  grid.className = 'diary-grid'; grid.dataset.diaryGrid = '';
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `사진 ${photos.length}장`);
  photos.forEach((file, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'diary-grid-item'; button.dataset.diaryOpen = String(i);
    button.setAttribute('aria-label', `사진 ${i + 1} 크게 보기`);
    button.append(photoElement(row, file, 'small', {label:'', link:false}));
    grid.append(button);
  });
  host.append(grid);
  // One short line per photo that has a comment (the full-screen view shows it under the photo too).
  const comments = photoComments(row), commented = photos.map((file, i) => ({i, text:comments[file.drive_file_id]})).filter(item => item.text);
  if (commented.length) {
    const list = document.createElement('ul');
    list.className = 'diary-captions'; list.dataset.diaryCaptions = '';
    for (const {i, text} of commented) {
      const item = document.createElement('li'), label = document.createElement('b');
      label.textContent = `사진 ${i + 1}`; item.append(label, ' ', text); list.append(item);
    }
    host.append(list);
  }
}

// Full-screen photo view: swipe sideways, "3 / 8", × and Back close it (router layer), ☆ is a place holder until OneDrive.
let viewer = null;
function openViewer(index) {
  const row = rows.get(selected), photos = diaryPhotos(row);
  if (!row || !photos[index] || viewer) return;
  const trigger = document.activeElement, box = document.createElement('div');
  box.className = 'diary-viewer'; box.dataset.diaryViewer = ''; box.dataset.swipeLock = '';
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', `${shortDay(selected)} 사진`);
  box.innerHTML = `<div class="diary-viewer-bar"><span class="diary-viewer-count" data-diary-viewer-count aria-live="polite"></span><button type="button" class="diary-viewer-star" data-diary-star aria-label="별표">☆</button><button type="button" class="diary-viewer-close" data-diary-viewer-close aria-label="크게 보기 닫기">×</button></div><div class="diary-viewer-strip" data-diary-viewer-strip tabindex="0"></div><p class="diary-viewer-caption" data-diary-viewer-caption></p><p class="diary-viewer-note" data-diary-viewer-note role="status"></p>`;
  const strip = box.querySelector('[data-diary-viewer-strip]'), count = box.querySelector('[data-diary-viewer-count]');
  photos.forEach((file, i) => {
    const slide = document.createElement('figure'); slide.className = 'diary-slide';
    slide.append(photoElement(row, file, 'large', {label:`${shortDay(selected)} 사진 ${i + 1}`}));
    strip.append(slide);
  });
  let at = index;
  const comments = photoComments(row), caption = box.querySelector('[data-diary-viewer-caption]');
  const show = () => { count.textContent = `${at + 1} / ${photos.length}`; caption.textContent = comments[photos[at].drive_file_id] || ''; };
  strip.addEventListener('scroll', () => { const next = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)); if (next !== at && photos[next]) { at = next; show(); } }, {passive:true});
  const step = dir => strip.scrollTo({left:Math.max(0, Math.min(photos.length - 1, at + dir)) * strip.clientWidth, behavior:'smooth'});
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeViewer(); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); }
  });
  box.addEventListener('click', event => {
    if (event.target.closest('[data-diary-viewer-close]')) closeViewer();
    else if (event.target.closest('[data-diary-star]')) box.querySelector('[data-diary-viewer-note]').textContent = '원드라이브 연결 뒤 쓸 수 있어요';
  });
  root.append(box);
  viewer = {box, trigger, layer:window.KPTURouter?.layer?.open('diary-photo', {close:() => { closeViewer({fromBack:true}); return true; }}) || null};
  document.documentElement.classList.add('diary-viewer-open');
  strip.scrollLeft = index * strip.clientWidth; show();
  box.querySelector('[data-diary-viewer-close]').focus();
}
function closeViewer({fromBack = false, restore = true} = {}) {
  if (!viewer) return;
  const {box, trigger, layer} = viewer; viewer = null;
  box.remove(); document.documentElement.classList.remove('diary-viewer-open');
  if (!fromBack) layer?.close();
  if (restore && trigger?.isConnected) trigger.focus();
}

// Write / edit panel. One diary per day: a day that already has one always opens it to edit.
const commentsChanged = () => { const now = cleanLive(), was = edit.startComments; const keys = new Set([...Object.keys(now), ...Object.keys(was)]); return [...keys].some(key => (now[key] || '') !== (was[key] || '')); };
// The typed comments of the photos already on the day, trimmed to one line; an over-long one is cut by cleanComments' error.
const cleanLive = () => { const out = {}; for (const [id, text] of Object.entries(edit.comments)) { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); if (line) out[id] = line; } return out; };
// The text changed since the editor opened (or since the last save). Opening an old diary writes nothing: it is converted in memory.
const textChanged = () => !!edit?.field && JSON.stringify(edit.field.getValue()) !== edit.baseJson;
const dirty = () => !!edit && (edit.pending.length > 0 || textChanged() || commentsChanged());
async function openEditor(day) {
  if (edit) return;
  let row = rows.get(day) || null;
  if (!row && loadedMonth !== monthOf(day)) {
    try { row = await readDiaryDay(day, rt); } catch { row = null; }
  }
  edit = {day, row, pending:[], busy:false, comments:photoComments(row), startComments:photoComments(row),
    host:document.createElement('div'), field:null, baseJson:'', startDoc:diaryStartDoc(row), baseRaw:row ? row.raw_text : null, baseDoc:row ? row.doc ?? null : null, hadRow:!!row};
  edit.host.className = 'diary-doc-host'; edit.host.dataset.diaryText = '';
  cal.hidden = true; detail.hidden = true; list.hidden = true; $('[data-diary-new]').hidden = true; $('.diary-head').hidden = true; status.hidden = true;
  renderEditor('편집기를 불러오는 중…');
  editLayer ||= window.KPTURouter?.layer?.open('diary-edit', {close:() => closeEditor({fromBack:true})}) || null;
  requestAnimationFrame(() => editor.querySelector('h3')?.focus());
  edit.mounting = mountField(edit);
}
// A small box of the editor (글자색, 표 칸 메뉴, ⌄) takes the phone's back button first, like the big window.
let boxLayer = null;
function onBox(open) {
  if (open) boxLayer ||= window.KPTURouter?.layer?.open('diary-edit-box', {close:() => { boxLayer = null; edit?.field?.closeBoxes(); return true; }}) || null;
  else if (boxLayer) { const layer = boxLayer; boxLayer = null; layer.close(); }
}
async function mountField(session) {
  try {
    const {createDocEditor} = await import('./ed-editor.js');
    if (edit !== session) return;
    const used = session.startDoc;
    const field = await createDocEditor({host:session.host, value:used, label:'일기 글', placeholder:'오늘 있었던 일을 적어 보세요(사진만 남겨도 돼요)', shortcuts:true, onBox});
    if (edit !== session) { field.destroy(); return; }
    if (session.startDoc !== used) field.setValue(session.startDoc);
    session.field = field; session.baseJson = JSON.stringify(field.getValue());
    if (session.pendingMerge) { field.setValue(session.pendingMerge); session.pendingMerge = null; }
    if (!session.busy) setEditorStatus('');
  } catch { if (edit === session) setEditorStatus('편집기를 불러오지 못했어요. 닫고 다시 열어 주세요.'); }
}
function dropField() {
  if (boxLayer) { const layer = boxLayer; boxLayer = null; layer.close(); }
  try { edit?.field?.destroy(); } catch { /* the editor is gone with the panel */ }
}
function renderEditor(message = '') {
  const {row, day} = edit, photos = diaryPhotos(row), count = photos.length + edit.pending.length;
  editor.hidden = false;
  editor.innerHTML = `<div class="diary-panel-head"><h3 id="diaryEditorTitle" tabindex="-1">${row ? '일기 수정' : '일기 쓰기'}</h3><button type="button" class="icon-btn" data-diary-editor-close aria-label="일기 창 닫기">×</button></div>
<label class="diary-field"><span>날짜</span><input type="date" data-diary-date value="${esc(day)}" min="2000-01-01" max="2100-12-31"${row ? ' disabled' : ''}></label>
<div class="diary-pick"><input id="diaryPhotoInput" class="a11y-only" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" data-diary-input><button type="button" class="secondary" data-diary-pick aria-controls="diaryPhotoInput"${count >= DIARY_MAX_PHOTOS ? ' disabled' : ''}>사진 고르기</button><small data-diary-count>${count}/${DIARY_MAX_PHOTOS}장 · 긴 변 2048px로 줄여 올려요</small></div>
<div class="diary-thumbs" data-diary-thumbs></div>
<div class="diary-field"><span id="diaryTextLabel">글</span><div data-diary-doc-slot></div></div>
<p class="diary-editor-status" data-diary-editor-status role="status" aria-live="polite"></p>
<div class="diary-actions"><button type="button" class="primary" data-diary-save data-enter-save-submit>저장</button>${row ? '<button type="button" class="secondary diary-danger" data-diary-delete>일기 지우기</button>' : ''}</div>`;
  editor.querySelector('[data-diary-doc-slot]').replaceWith(edit.host);
  const thumbs = editor.querySelector('[data-diary-thumbs]');
  // Each photo has a one-line optional comment under it (max 200 chars), typed text kept in edit state across redraws.
  const commentInput = (value, label, attribute, key) => {
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'diary-comment'; input.maxLength = DIARY_COMMENT_MAX; input.value = value || '';
    input.placeholder = '코멘트(선택)'; input.setAttribute('aria-label', `${label} 코멘트`); input.setAttribute(attribute, key);
    return input;
  };
  photos.forEach((file, i) => {
    const cell = document.createElement('div'); cell.className = 'diary-thumb-cell';
    const item = document.createElement('div'); item.className = 'diary-thumb'; item.dataset.diaryThumb = file.drive_file_id;
    item.append(photoElement(row, file, 'small', {label:`사진 ${i + 1}`}));
    const out = document.createElement('button'); out.type = 'button'; out.className = 'icon-btn'; out.dataset.diaryRemove = file.drive_file_id;
    out.setAttribute('aria-label', `사진 ${i + 1} 빼기`); out.textContent = '×'; item.append(out);
    cell.append(item, commentInput(edit.comments[file.drive_file_id], `사진 ${i + 1}`, 'data-diary-comment', file.drive_file_id)); thumbs.append(cell);
  });
  edit.pending.forEach((entry, i) => {
    const cell = document.createElement('div'); cell.className = 'diary-thumb-cell';
    const item = document.createElement('div'); item.className = 'diary-thumb pending'; item.dataset.diaryPending = String(i);
    const img = document.createElement('img'); img.alt = entry.file.name; img.src = entry.url; item.append(img);
    const out = document.createElement('button'); out.type = 'button'; out.className = 'icon-btn'; out.dataset.diaryUnpick = String(i);
    out.setAttribute('aria-label', `${entry.file.name} 선택 취소`); out.textContent = '×'; item.append(out);
    cell.append(item, commentInput(entry.comment, entry.file.name, 'data-diary-pending-comment', String(i))); thumbs.append(cell);
  });
  thumbs.hidden = !count;
  setEditorStatus(message);
  editor.querySelectorAll('button,input,textarea').forEach(control => { if (edit.busy && !control.matches('[data-diary-editor-close]') && !edit.host.contains(control)) control.disabled = true; });
  edit.host.toggleAttribute('inert', !!edit.busy);
}
const setEditorStatus = message => { const line = editor.querySelector('[data-diary-editor-status]'); if (line) line.textContent = message; };
function releasePending() { edit?.pending.forEach(entry => URL.revokeObjectURL(entry.url)); }
function closeEditor({fromBack = false, force = false} = {}) {
  if (!edit) return true;
  if (edit.busy) return false;
  if (!force && dirty() && !window.confirm('쓰던 일기를 저장하지 않고 닫을까요?')) return false;
  releasePending(); dropField(); edit = null; editor.hidden = true; editor.replaceChildren();
  cal.hidden = false; renderList(); $('[data-diary-new]').hidden = false; $('.diary-head').hidden = false; status.hidden = false;
  const opened = editLayer; editLayer = null; if (!fromBack) opened?.close();
  if (selected) renderDetail();
  return true;
}
function pick(files) {
  const have = diaryPhotos(edit.row).length + edit.pending.length, room = Math.max(0, DIARY_MAX_PHOTOS - have);
  const images = [...files].filter(file => /^image\//.test(file.type || '')), skipped = files.length - images.length;
  const taken = images.slice(0, room);
  edit.pending.push(...taken.map(file => ({file, url:URL.createObjectURL(file), comment:''})));
  const notes = [];
  if (images.length > room) notes.push(`일기 사진은 하루 ${DIARY_MAX_PHOTOS}장까지예요. ${images.length - room}장은 넣지 않았어요.`);
  if (skipped) notes.push(`사진이 아닌 파일 ${skipped}개는 넣지 않았어요.`);
  renderEditor(notes.join(' '));
}
async function changeDay(day) {
  if (!edit || edit.row || !day) return;
  edit.day = day;
  let existing = rows.get(day) || null;
  if (!existing) { try { existing = await readDiaryDay(day, rt); } catch { existing = null; } }
  if (!edit || edit.day !== day) return;
  if (existing) adoptExisting(existing, '이 날 일기가 이미 있어 수정으로 열었어요.');
}
// A typed text is kept: appended below the day's saved text.
function adoptExisting(row, message) {
  const typedValue = edit.field?.getValue() || null, typedText = (edit.field?.getText() || '').trim();
  const saved = diaryStartDoc(row), savedText = diaryText(row).trim();
  edit.row = row; edit.day = row.journal_day; edit.startDoc = saved; edit.comments = photoComments(row); edit.startComments = photoComments(row);
  edit.baseRaw = row.raw_text; edit.baseDoc = row.doc ?? null; edit.hadRow = true;
  rows.set(row.journal_day, row);
  renderEditor(message);
  const merged = typedText && typedText !== savedText ? joinDiaryDocs(saved, typedValue) : null;
  if (edit.field) {
    edit.field.setValue(saved); edit.baseJson = JSON.stringify(edit.field.getValue());
    if (merged) edit.field.setValue(merged);
  } else if (merged) edit.pendingMerge = merged;
}
async function save() {
  if (!edit || edit.busy) return;
  // [저장] pressed while the editor is still loading waits for it (a text field that is not there yet can not be saved from).
  if (!edit.field) { const session = edit; await session.mounting; if (edit !== session || !edit.field) return edit && setEditorStatus('편집기를 불러오지 못했어요. 닫고 다시 열어 주세요.'); }
  const text = edit.field.getText(), value = edit.field.getValue(), changed = textChanged(), day = edit.day;
  try { validateDiaryText(text); const bad = diaryDocError(diaryDocToStore(value, text)); if (bad) throw new Error(bad); cleanComments(edit.comments, diaryPhotos(edit.row)); edit.pending.forEach(entry => cleanComments({x:entry.comment}, [{drive_file_id:'x'}])); } catch (error) { return setEditorStatus(error.message); }
  if (!text.trim() && !edit.pending.length && !diaryPhotos(edit.row).length) return setEditorStatus('사진이나 글을 넣어 주세요.');
  const run = owner, mine = () => run === ownerScope(rt) && !!edit;
  edit.busy = true; renderEditor('저장하는 중…');
  let created = false, result = {done:0};
  try {
    if (!edit.row) {
      try { edit.row = await createDiary({day, text, doc:value}, rt); created = true; }
      catch (error) {
        if (error?.code !== 'diary_exists') throw error;
        const existing = await readDiaryDay(day, rt);
        edit.busy = false;
        if (existing && mine()) return adoptExisting(existing, error.message);
        throw error;
      }
    }
    const comments = {...cleanLive()};
    if (edit.pending.length) {
      const files = edit.pending.map(entry => entry.file), have = (edit.row.attachments || []).length;
      result = await uploadDiaryPhotos(edit.row, files, {rt, isCurrent:mine, onProgress:({done, total}) => setEditorStatus(`사진 올리는 중… ${done}/${total}장`)});
      if (!mine()) return;
      // The photos that went up are the last ones on the row, in the order they were picked: their comments follow them.
      (result.attachments || []).slice(have, have + result.done).forEach((file, i) => { const line = String(edit.pending[i]?.comment ?? '').replace(/\s+/g, ' ').trim(); if (line) comments[file.drive_file_id] = line; });
      edit.pending.splice(0, result.done).forEach(entry => URL.revokeObjectURL(entry.url));
    }
    let fresh = await readDiaryDay(day, rt);
    if (!mine()) return;
    const desired = text.trim() ? text : '';
    if (fresh && created && !fresh.attachments?.length && !desired) {
      // Nothing could be attached to a photo-only day: remove the empty row again.
      await dropEmptyDiary(fresh, rt).catch(() => {});
      fresh = null; edit.row = null;
    } else if (fresh && (created ? fresh.raw_text !== desired : changed) && (desired || fresh.attachments?.length)) {
      // A diary that was there when the editor opened is written only while its text is still what the editor opened: a diary changed on
      // another device is refused, nothing is overwritten (the phone shows the newer one after closing).
      if (!created && edit.hadRow && (fresh.raw_text !== edit.baseRaw || JSON.stringify(fresh.doc ?? null) !== JSON.stringify(edit.baseDoc ?? null))) {
        rows.set(day, fresh);
        throw Object.assign(new Error('일기 글이 그사이 다른 곳에서 바뀌었어요. 쓴 글을 복사해 두고, 닫았다가 다시 열어 확인해 주세요.'), {code:'note_changed'});
      }
      fresh = await saveDiaryText(fresh, text, rt, {doc:value, strict:true});
    }
    if (fresh) fresh = await saveDiaryComments(fresh, comments, rt);
    if (fresh) { rows.set(day, fresh); edit.row = fresh; edit.baseRaw = fresh.raw_text; edit.baseDoc = fresh.doc ?? null; edit.hadRow = true; edit.baseJson = JSON.stringify(value); edit.comments = photoComments(fresh); edit.startComments = photoComments(fresh); } else rows.delete(day);
    edit.busy = false;
    if (result.failed) {
      const done = result.done ? `${result.done}장은 올렸어요. ` : '';
      renderEditor(`${done}'${result.failed}'부터 올리지 못했어요. ${result.message} 남은 사진은 [저장]을 다시 누르면 이어서 올려요.`);
      return renderMonth();
    }
    closeEditor({force:true});
    if (monthOf(day) === monthKey()) { renderMonth(); selectDay(day); }
    else { const [y, m] = day.split('-').map(Number); cursor = {year:y, month:m - 1}; loadedMonth = ''; await loadMonth(); selectDay(day); }
    status.textContent = '일기를 저장했어요.';
  } catch (error) {
    if (!edit) return;
    edit.busy = false;
    renderEditor(error?.status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 저장해 주세요.' : error?.message && !error.status ? error.message : '일기를 저장하지 못했어요. 다시 시도해 주세요.');
  }
}
async function removePhoto(fileId) {
  if (!edit?.row || edit.busy) return;
  if (!window.confirm('이 사진을 일기에서 뺄까요? Drive "Web2 바구니" 폴더의 파일은 그대로 남아요.')) return;
  edit.busy = true; renderEditor('사진을 빼는 중…');
  try {
    const row = await removeDiaryPhoto(edit.row, fileId, rt);
    rows.set(row.journal_day, row); edit.row = row; edit.busy = false;
    delete edit.comments[fileId]; delete edit.startComments[fileId];
    renderEditor('사진을 뺐어요.'); renderMonth();
  } catch (error) {
    edit.busy = false; renderEditor(error?.message && !error.status ? error.message : '사진을 빼지 못했어요. 다시 시도해 주세요.');
  }
}
async function removeDiary(row) {
  if (!row || edit?.busy) return;
  const photos = diaryPhotos(row).length;
  const result = await deleteNoteOriginal(row.id, {rt, describe:() => `${shortDay(row.journal_day)} 일기를 지웁니다.${photos ? ` 사진 ${photos}장은 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).` : ''}`});
  if (!['deleted', 'missing'].includes(result.status)) {
    if (result.message) (edit ? setEditorStatus : text => { status.textContent = text; })(result.message.replace(/업데이트/g, '일기'));
    return;
  }
  rows.delete(row.journal_day);
  if (edit) closeEditor({force:true});
  closeDetail(); renderMonth();
  status.textContent = (result.message || '일기를 지웠어요.').replace(/업데이트/g, '일기');
}

root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !root.contains(button) || button.disabled) return;
  if (button.matches('[data-diary-day]')) return selected === button.dataset.diaryDay ? closeDetail() : selectDay(button.dataset.diaryDay);
  if (button.matches('[data-diary-list-day]')) return selectDay(button.dataset.diaryListDay, {focus:true});
  if (button.matches('[data-diary-prev]')) return moveMonth(-1);
  if (button.matches('[data-diary-next]')) return moveMonth(1);
  if (button.matches('[data-diary-today]')) return goToday();
  if (button.matches('[data-diary-retry]')) return loadMonth({force:true});
  // UI-일기손질 ③: the shared [+] writes the chosen day (edits it when it has one), or today when no day is chosen.
  if (button.matches('[data-diary-new]')) return openEditor(selected || todayKey());
  if (button.matches('[data-diary-detail-close]')) return closeDetail();
  if (button.matches('[data-diary-source]')) { source = button.dataset.diarySource; return renderDetail(); }
  if (button.matches('[data-diary-open]')) return openViewer(Number(button.dataset.diaryOpen));
  if (button.matches('[data-diary-edit]')) return openEditor(selected);
  if (button.matches('[data-diary-delete]')) return removeDiary(edit ? edit.row : rows.get(selected));
  if (button.matches('[data-diary-editor-close]')) return closeEditor();
  if (button.matches('[data-diary-pick]')) return editor.querySelector('[data-diary-input]')?.click();
  if (button.matches('[data-diary-unpick]')) { const [entry] = edit.pending.splice(Number(button.dataset.diaryUnpick), 1); if (entry) URL.revokeObjectURL(entry.url); renderEditor(); return; }
  if (button.matches('[data-diary-remove]')) return removePhoto(button.dataset.diaryRemove);
  if (button.matches('[data-diary-save]')) return save();
});
root.addEventListener('input', event => {
  if (!edit) return;
  if (event.target.matches('[data-diary-comment]')) edit.comments[event.target.dataset.diaryComment] = event.target.value;
  else if (event.target.matches('[data-diary-pending-comment]')) { const entry = edit.pending[Number(event.target.dataset.diaryPendingComment)]; if (entry) entry.comment = event.target.value; }
});
root.addEventListener('change', event => {
  if (event.target.matches('[data-diary-input]')) { const files = [...event.target.files || []]; event.target.value = ''; if (files.length && edit) pick(files); }
  if (event.target.matches('[data-diary-date]')) changeDay(event.target.value);
});

window.addEventListener('kptu:before-view-change', event => {
  if (window.KPTURouter?.current !== 'diary' || event.detail?.view === 'diary' || !edit) return;
  if (edit.busy || (dirty() && !window.confirm('쓰던 일기를 저장하지 않고 나갈까요?'))) { event.preventDefault(); return; }
  closeEditor({force:true, fromBack:true});
});
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'diary') return;
  // The router forgets the left view's layers; drop ours with them.
  closeViewer({fromBack:true, restore:false});
  dayLayer = null; editLayer = null;
  if (selected) closeDetail({fromBack:true});
});
window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt); epoch++;
  closeViewer({fromBack:true, restore:false});
  if (edit) { releasePending(); dropField(); edit = null; editor.hidden = true; editor.replaceChildren(); cal.hidden = false; $('.diary-head').hidden = false; $('[data-diary-new]').hidden = false; status.hidden = false; }
  editLayer = null; dayLayer = null; selected = null; sendWhere(null); detail.hidden = true; rows = new Map(); loadedMonth = ''; renderMonth();
});
function enter() {
  const day = takeRequestedDay(rt);
  if (day) {
    const [y, m] = day.split('-').map(Number);
    if (y !== cursor.year || m - 1 !== cursor.month) { cursor = {year:y, month:m - 1}; closeDetail(); }
    loadMonth().then(() => selectDay(day, {focus:true}));
    return;
  }
  loadMonth();
}
window.KPTURouter?.on?.('diary', enter);
window.KPTUDiary = {refresh:() => loadMonth({force:true})};
if (window.KPTURouter?.current === 'diary') enter();
})();
