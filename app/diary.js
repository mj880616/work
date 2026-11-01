import {waitInlineHtml, emptyHtml} from './wait-state.js';
// JOURNAL-일기 1차: the [일기] side of the schedule tab (?view=diary). This module is the only renderer of #diaryRoot:
// month photo calendar → the chosen day below it (photos large, swipe sideways, and the text) → write/edit panel.
// Rows, photos and photo views go through diary-data.js (owner RLS + basket-files); deleting uses the basket's
// note-delete path (attachments to the Drive trash). Back closes the top open thing first (router layers).
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {seoulParts, seoulDate, addSeoulDays, seoulDateKey, formatSeoulTime} from './meeting-time.js';
import {readDiaryMonth, readDiaryDay, createDiary, saveDiaryText, removeDiaryPhoto, pruneDiaryPhotos, dropEmptyDiary, uploadDiaryPhotos, photoElement,
  diaryPhotos, diaryText, takeRequestedDay, todayKey, ownerScope, validateDiaryText, DIARY_MAX_PHOTOS, DIARY_COMMENT_MAX,
  photoComments, cleanComments, saveDiaryComments} from './diary-data.js';
import {SIZE_BUTTONS, WIDE_QUERY, paintGrid, paintButtons, changeCols, attachPinch} from './photo-grid-size.js';
import {putBack} from './photo-viewer-model.mjs';
// OD-크게보기: 크게 보기는 공용 부품(사진 메뉴와 같은 것).
import {openPhotoStrip, closePhotoStrip, photoStripOpen, photoStripNote, photoStripRefresh} from './photo-strip.js';
import {deleteNoteOriginal, offerUndoNotice} from './basket-record-delete.js';
import {notify as notifySmall} from './small-notice.js';
import {odStatusCached, odTakeWarmMonth, odDelete, odPhotos, odPhotoElement, odPrefetchMonth, clearOdPhotoCache, forgetOdPhoto, odKeepReconcile, odStartPrefetch, odStopPrefetch, odKeepCount, odKeepClear, odKeepForOwner,
  odErrorText, odMediaUrl, odSync, odSyncDelay, odFolderTree, readStars, addStar, removeStar, starKey, dayItems, takenLabel, takeOdReturn} from './diary-onedrive.js';
// ED③ 일기: the day's text is the new editor (ed-editor.js) inside this panel; the read view draws its saved form (ed-render). The photos,
// their comments, the calendar and the swipe stay as they were. Letters (raw_text) are still saved with it for every other reader.
import {renderDoc} from './ed-render.mjs';
import {diaryHasDoc, diaryStartDoc, joinDiaryDocs, diaryDocToStore, diaryDocError} from './diary-doc.mjs';
// JOURNAL-일기목록: [달력 / 목록] 바꾸기. 목록 칸은 diary-list.js가 그리고, 고른 보기는 서버(view_prefs.diary_view)에 기억한다(기기 저장 없음).
import {createDiaryList} from './diary-list.js';
import {viewPrefs} from './view-prefs.js';
// OD-연결아이콘: 원드라이브 연결 표시는 [오늘] 오른쪽 아이콘 하나 + 드롭다운(공용 부품, 사진 메뉴도 같은 부품).
import {odLinkButtonHtml, paintOdLink, createOdLinkMenu} from './od-link.js';
import {createOdSettings} from './od-settings.js';
// S46-20 사진 정리 ⑥(명진 11/01 01:04): 그날 폰 사진도 같은 격자에 '보여 주기만'(앱 다리로 폰 안에서만 읽음, 서버 저장 없음).
import {phonePhotos} from './phone-photos.js';
import {parseSources} from './photo-sources-model.mjs';
import {parsePhoneOff} from './phone-folders-model.mjs';
import {dayEndMs, phoneDayItems} from './time-photos-model.mjs';

(() => {
if (window.KPTUDiary) return;
const root = document.querySelector('#diaryRoot');
if (!root) return;
const rt = window.KPTURuntime;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const longDay = day => formatSeoulTime(day, {month:'long', day:'numeric', weekday:'long'});
const shortDay = day => formatSeoulTime(day, {month:'long', day:'numeric'});

root.innerHTML = `<div class="diary-head"><div class="diary-source diary-views" role="group" aria-label="일기 보기"><button type="button" data-diary-view="calendar" aria-pressed="true">달력</button><button type="button" data-diary-view="list" aria-pressed="false">목록</button></div><div class="diary-month-od"><div class="diary-month"><button type="button" class="mini" data-diary-prev aria-label="이전 달">‹</button><b data-diary-title aria-live="polite"></b><button type="button" class="mini" data-diary-next aria-label="다음 달">›</button><button type="button" class="mini" data-diary-today>오늘</button></div>${odLinkButtonHtml()}</div><div class="diary-lv-tools" data-diary-lv-tools hidden><div class="diary-source" role="group" aria-label="일기 고르기"><button type="button" data-diary-lv-filter="all" aria-pressed="true">전체</button><button type="button" data-diary-lv-filter="star" aria-pressed="false" aria-label="별표한 일기만">★</button></div><button type="button" class="mini diary-lv-find" data-diary-lv-find aria-pressed="false" aria-label="일기 찾기">🔍</button></div><button type="button" id="newDiaryBtn" class="primary" data-diary-new aria-label="일기 쓰기">+ 일기</button></div>
<p class="diary-status" data-diary-status role="status"></p><button type="button" class="secondary" data-diary-retry hidden>다시 시도</button>
<section class="diary-od" data-diary-od hidden aria-label="원드라이브 사진"></section><div class="diary-cal" data-diary-cal><div class="diary-week-head" aria-hidden="true">${['일','월','화','수','목','금','토'].map((d, i) => `<span${i === 0 ? ' class="sunday"' : i === 6 ? ' class="saturday"' : ''}>${d}</span>`).join('')}</div><div class="diary-days" data-diary-days></div></div>
<section class="diary-list" data-diary-list hidden aria-label="이 달 일기 목록"></section>
<section class="diary-all" data-diary-all hidden aria-label="일기 목록"></section>
<section class="diary-detail" data-diary-detail hidden aria-labelledby="diaryDetailTitle"></section>
<section class="diary-editor" data-diary-editor data-enter-save hidden aria-labelledby="diaryEditorTitle"></section>`;
const $ = selector => root.querySelector(selector);
const cal = $('[data-diary-cal]'), days = $('[data-diary-days]'), detail = $('[data-diary-detail]'), list = $('[data-diary-list]'), editor = $('[data-diary-editor]'), status = $('[data-diary-status]');

let cursor = seoulParts(new Date()), rows = new Map(), loadedMonth = '', epoch = 0, owner = ownerScope(rt);
let selected = null, source = 'all', dayLayer = null;
// JOURNAL-일기원드라이브 2단계: 연결 상태·이 달의 원드라이브 사진·이 달의 별표. 모두 메모리에만 둔다(저장은 서버).
const OD_NONE = {configured:false, connected:false, folder:null, canDelete:false};
let od = {...OD_NONE}, odStatusFlight = null, odMonth = null, odMessage = '';
// 원드라이브 설정 창: 사진 메뉴와 같은 공용 부품(od-settings.js, 명진 결정 4). 연결 상태·안내 한 줄·다시 읽기는 일기 것을 쓴다.
const odSettings = createOdSettings({rt, layerName:'diary-od', hint:'켠 폴더의 사진만 달력에 보여요. 하위 폴더도 함께 읽어요.',
  od:() => od, refresh:force => ensureOdStatus(force), paint:() => renderOdPanel(), message:text => { odMessage = text; }, fault:() => { odFault = true; },
  reload:() => loadMonth({force:true}), reset:({disconnected}) => { stopOdSync(); odSyncState.done = false; if (disconnected) odFault = false; }});
// 설정 창(위 폴더 아래 스위치 목록)과 사진 목록 받기. 모두 메모리에만 둔다(진행 상태는 서버 색인에 있다).

// OD-연결아이콘: odFault = 이번 접속에서 원드라이브 요청이 실패함(아이콘 빨간 점). odShowChosen = 이번 접속에서 고른 '일기에서 사진 보이기'
// (서버 view_prefs.diary_onedrive가 먼저 기억, DB 적용 전에는 서버가 거절(400)해 이번 접속 동안만 메모리로 유지). 기본은 보이기.
let odFault = false, odShowChosen = null;
const odShowOn = () => odShowChosen ?? (viewPrefs.get('diary_onedrive') !== false);
const odShown = () => (odShowOn() ? odMonth : null);
const odSyncState = {run:0, active:false, count:null, done:false, timer:0, wake:null};
let starSet = new Set(), starsState = 'loading', shown = [];
const starBusy = new Set();
const isStarred = item => starSet.has(starKey(item.source, item.key));
let edit = null, editLayer = null;
const monthKey = () => `${cursor.year}-${cursor.month}`;
// 날짜 글자가 아닌 값(모양이 틀린 행)은 어느 달에도 맞지 않게 한다(목록·달력이 오류로 멈추지 않게).
const monthOf = day => { const [y, m] = String(day ?? '').split('-').map(Number); return `${y}-${m - 1}`; };
const current = run => run === epoch && owner === ownerScope(rt);
// JOURNAL-일기목록: 지금 보기('calendar' | 'list'). 이번 접속에서 고른 값(chosenView)이 먼저, 없으면 서버 기억, 없으면 달력.
// DB 적용 전에는 서버가 diary_view를 거절(400)해 기억만 건너뛰고, 이번 접속 동안은 고른 보기를 메모리로 유지한다.
let chosenView = null, lastListDay = null, listDirty = false;
const savedView = () => { const v = viewPrefs.get('diary_view'); return v === 'list' ? 'list' : 'calendar'; };
const viewMode = () => chosenView || savedView();
const allHost = $('[data-diary-all]');
const listView = createDiaryList({host:allHost, rt, odReady:() => ensureOdStatus().then(() => !!(od.connected && od.folder && odShowOn())),
  onOpen:day => openFromList(day),
  onMarked:saved => { const row = rows.get(saved.journal_day); if (row && row.id === saved.id) rows.set(saved.journal_day, {...row, metadata:saved.metadata, updated_at:saved.updated_at}); }});

function renderMonth() {
  $('[data-diary-title]').textContent = `${cursor.year}년 ${cursor.month + 1}월`;
  const first = seoulDate(cursor.year, cursor.month), lead = seoulParts(first).weekday;
  const total = seoulParts(seoulDate(cursor.year, cursor.month + 1, 0)).day, today = todayKey();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(Object.assign(document.createElement('span'), {className:'diary-cell diary-blank'}));
  for (let n = 1; n <= total; n++) {
    const day = seoulDateKey(addSeoulDays(first, n - 1)), row = rows.get(day), photos = diaryPhotos(row), text = diaryText(row), odDay = odShown()?.days[day] || [];
    const cell = document.createElement('button');
    cell.type = 'button'; cell.className = 'diary-cell'; cell.dataset.diaryDay = day;
    if (day === today) { cell.setAttribute('aria-current', 'date'); cell.classList.add('ds-today'); }
    cell.setAttribute('aria-pressed', String(selected === day)); cell.classList.toggle('ds-day-sel', selected === day);
    cell.setAttribute('aria-label', `${shortDay(day)}${photos.length ? `, 사진 ${photos.length}장` : text ? ', 글' : ''}${odDay.length ? `, 원드라이브 사진 ${odDay.length}장` : ''}`);
    if (photos[0]) { cell.classList.add('has-photo'); cell.append(photoElement(row, photos[0], 'small', {label:'', link:false, retry:false})); }
    const num = document.createElement('span'); num.className = day === today ? 'diary-num ds-today-num' : 'diary-num'; num.textContent = String(n); cell.append(num);
    if (!photos.length && text) { const dot = document.createElement('span'); dot.className = 'diary-dot'; dot.dataset.diaryDot = ''; cell.append(dot); }
    if (odDay.length) { const dot = document.createElement('span'); dot.className = 'diary-dot diary-dot-od'; dot.dataset.diaryOdDot = ''; cell.append(dot); }
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
// 보기에 따라 보이는 칸을 맞춘다(달력: 달 이동·달력·이 달 목록 / 목록: 전체 목록). 날짜를 열었거나 쓰는 중이면 목록 칸은 숨는다.
function applyView() {
  const listMode = viewMode() === 'list';
  root.querySelectorAll('[data-diary-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.diaryView === viewMode())));
  $('.diary-month').hidden = listMode;
  $('[data-diary-lv-tools]').hidden = !listMode;
  root.querySelectorAll('[data-diary-lv-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.diaryLvFilter === listView.filter)));
  $('[data-diary-lv-find]').setAttribute('aria-pressed', String(listView.searching));
  if (!edit) cal.hidden = listMode;
  const showAll = listMode && !selected && !edit;
  if (showAll && allHost.hidden) { listView.show(); if (listDirty) { listDirty = false; listView.reload(); } if (lastListDay) { const day = lastListDay; lastListDay = null; requestAnimationFrame(() => listView.focusDay(day)); } }
  else if (!showAll && !allHost.hidden) listView.hide();
  // 목록 보기의 상태 줄은 목록 칸이 맡는다(달력의 '이 달에는 아직 일기가 없어요'를 보이지 않게).
  if (!edit) status.hidden = listMode && !selected;
  return listMode;
}
function setView(next) {
  if (next !== 'list' && next !== 'calendar') return;
  chosenView = next;
  viewPrefs.set('diary_view', next, {rejectable:true});
  if (selected) closeDetail(); else renderList();
}
// 목록의 줄 → 그날 일기(그 달을 읽고 연다). 뒤로가기·×는 목록으로 돌아온다(router layer 'diary-day').
function openFromList(day) {
  if (edit) return;
  const [y, m] = day.split('-').map(Number);
  lastListDay = day;
  if (y !== cursor.year || m - 1 !== cursor.month) cursor = {year:y, month:m - 1};
  loadMonth().then(() => { if (!edit && viewMode() === 'list' && monthKey() === monthOf(day)) selectDay(day, {focus:true}); });
}
function renderList() {
  const listMode = applyView();
  const days = [...rows.keys()].filter(day => monthOf(day) === monthKey() && rows.get(day)).sort().reverse();
  list.hidden = listMode || !!selected || !!edit || !days.length;
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
  status.innerHTML = waitInlineHtml(); $('[data-diary-retry]').hidden = true;
  rows = new Map(); odMonth = null; starSet = new Set(); starsState = 'loading'; renderMonth();
  loadOd(run, key, force);
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
  closeDetail(); writePlace(); loadMonth();
}

// NAV-새로고침제자리: the day open (?day=YYYY-MM-DD), or the month shown when it is not this month (?day=YYYY-MM), is written to the
// address (no history entry of its own; the open day keeps its layer entry), so a reload opens the same place.
function writePlace() {
  const t = seoulParts(new Date()), month = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  window.KPTURouter?.setPlace?.('diary', {day:selected || (t.year === cursor.year && t.month === cursor.month ? null : month)});
}
function selectDay(day, {focus = false} = {}) {
  selected = day; source = 'all';
  days.querySelectorAll('[data-diary-day]').forEach(cell => { const on = cell.dataset.diaryDay === day; cell.setAttribute('aria-pressed', String(on)); cell.classList.toggle('ds-day-sel', on); });
  renderDetail();
  // NAV-PC앞뒤통일: › (or the browser's forward) over the day's entry opens the same day again (reopen).
  dayLayer ||= window.KPTURouter?.layer?.open('diary-day', {close:() => { closeDetail({fromBack:true}); return true; }, reopen:() => selectDay(day)}) || null;
  writePlace();
  requestAnimationFrame(() => { detail.scrollIntoView({block:'nearest', behavior:'smooth'}); if (focus) (detail.querySelector('h3') || detail.querySelector('[data-diary-detail-close]'))?.focus(); });
}
// BUG-오늘버튼: [오늘] goes to this month (when needed) and chooses today, opening its detail like a tap on the day.
// Today already chosen stays as it is. Another month first loads this month, then chooses today if still here.
function goToday() {
  const t = seoulParts(new Date()), day = todayKey();
  if (t.year === cursor.year && t.month === cursor.month) { if (selected !== day) selectDay(day); return; }
  cursor = {year:t.year, month:t.month}; closeDetail(); writePlace();
  loadMonth().then(() => { if (!edit && !selected && loadedMonth === monthKey() && monthKey() === monthOf(day)) selectDay(day); });
}
// UI-상단줄제목: the open day goes to the PC top line's place (kptu:where-item, topbar-actions.js); null drops it.
const sendWhere = name => window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'diary', name}}));
// UI-중복제목삭제: with the PC top line (761px~) the open day is already named there, so the day panel's head has no title line of its own
// there (the element is not made; the panel is named by aria-label instead). Below that width the head keeps its title, as before.
const toplineWide = window.matchMedia?.('(min-width:761px)');
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
  days.querySelectorAll('[aria-pressed="true"]').forEach(cell => { cell.setAttribute('aria-pressed', 'false'); cell.classList.remove('ds-day-sel'); });
  if (!fromBack) writePlace();
  const opened = dayLayer; dayLayer = null; if (!fromBack) opened?.close();
  renderList();
}
function renderDetail() {
  if (!selected) return;
  sendWhere(longDay(selected));
  const row = rows.get(selected), text = diaryText(row), hasPhotos = dayItems(selected, row, odShown()).length + phoneShown(selected).length > 0;
  detail.hidden = false; list.hidden = true; if (!allHost.hidden) listView.hide();
  detail.innerHTML = `<div class="diary-panel-head"><button type="button" class="icon-btn" data-diary-detail-close aria-label="날짜 닫기">×</button></div>${row || hasPhotos ? `<div class="diary-photo-bar"><div class="diary-source" role="group" aria-label="사진 보기"><button type="button" data-diary-source="all" aria-pressed="${source === 'all'}">전체</button><button type="button" data-diary-source="star" aria-pressed="${source === 'star'}">별표</button></div>${SIZE_BUTTONS}</div><div data-diary-photos></div>` : ''}${row ? `${text ? `<div class="diary-text${diaryHasDoc(row) ? ' is-doc' : ''}" data-diary-text-view>${diaryHasDoc(row) ? '' : esc(text)}</div>` : ''}<div class="diary-actions"><button type="button" class="secondary" data-diary-edit>수정</button><button type="button" class="secondary diary-danger" data-diary-delete>일기 지우기</button></div>` : emptyHtml('일기 없음')}`;
  syncDetailTitle();
  const view = detail.querySelector('[data-diary-text-view]');
  if (view && diaryHasDoc(row)) view.replaceChildren(renderDoc(row.doc));
  renderPhotos();
  void loadPhoneDay(selected);
}
// ☆를 아직 쓸 수 없을 때의 안내. 원드라이브 준비 전에는 예전 안내 그대로.
// UI-기다림표시통일 2차: 별표를 읽는 동안은 글자 대신 회색 칸(starNoteHtml).
const starNote = () => !od.configured ? '원드라이브 연결 뒤 쓸 수 있어요' : starsState === 'loading' ? '' : '별표를 지금은 쓸 수 없어요';
const starNoteHtml = () => od.configured && starsState === 'loading' ? waitInlineHtml() : esc(starNote());
const itemElement = (item, size, opts) => item.kind === 'od' ? odPhotoElement(item, size, opts) : item.kind === 'phone' ? phone.element(item, size, opts) : photoElement(item.row, item.file, size, opts);
// S46-20 사진 정리 ⑥: 그날 폰 사진(폰 앱에서만, 사진 메뉴 출처 '폰 사진'이 켜졌을 때). 그날 끝 시각부터 거꾸로 한 쪽만 읽어 그날 것만 남긴다.
// 끈 폰 폴더는 빼고, 원드라이브에 같은 사진이 있으면 원드라이브 것만 보인다. 목록·그림은 이 화면 메모리에만 있다.
const phone = phonePhotos();
let phoneDay = {day:'', items:[], state:'idle'};
const phoneOnHere = () => phone.usable && parseSources(viewPrefs.get('photo_sources')).phone;
async function loadPhoneDay(day) {
  if (phoneDay.day === day && phoneDay.state !== 'idle') return;
  if (!phoneOnHere()) { phoneDay = {day, items:[], state:'off'}; return; }
  phoneDay = {day, items:[], state:'loading'};
  try {
    const s = await phone.hello();
    if (phoneDay.day !== day) return;
    if (s.access === 'none' || !s.key) { phoneDay = {day, items:[], state:'off'}; return; }
    const page = await phone.page({sort:'taken_desc', filter:'all', before:dayEndMs(day), limit:200, hide:[...parsePhoneOff(viewPrefs.get('phone_folders_off'))]});
    if (phoneDay.day !== day) return;
    phoneDay = {day, items:page.items.filter(it => it.day === day), state:'ready'};
  } catch { if (phoneDay.day === day) phoneDay = {day, items:[], state:'failed'}; return; }
  if (selected === day && !photoStripOpen() && !edit && phoneDay.items.length) renderDetail();
}
const phoneShown = day => (phoneDay.day === day && phoneDay.state === 'ready' ? phoneDayItems(phoneDay.items, day, odShown()?.days?.[day] || []) : []);
// The day's photos: the ones uploaded here, then the OneDrive ones of the day, as one small square grid. [별표] keeps the starred ones.
function renderPhotos() {
  const host = detail.querySelector('[data-diary-photos]');
  if (!host || !selected) return;
  const row = rows.get(selected), all = dayItems(selected, row, odShown()).concat(phoneShown(selected));
  if (source === 'star') {
    if (starsState !== 'ready') { shown = []; host.innerHTML = `<p class="diary-muted diary-star-note" data-diary-star-note>${starNoteHtml()}</p>`; return; }
    shown = all.filter(isStarred);
    if (!shown.length) {
      host.innerHTML = emptyHtml('별표 사진 없음', {attrs: 'data-diary-star-note'}).replace('</p>', `${od.configured && !od.connected ? ' <button type="button" class="secondary" data-od-connect>원드라이브 연결</button>' : ''}</p>`);
      return;
    }
  } else {
    shown = all;
    if (!shown.length) { host.innerHTML = emptyHtml('사진 없음'); return; }
  }
  // Small square grid (OD-사진크기: 한 줄 칸 수는 [－][＋]·두 손가락으로 고르고 서버에 기억, 기본 폰 4·넓은 화면 6); a photo opens full screen.
  const grid = document.createElement('div');
  grid.className = 'diary-grid'; grid.dataset.diaryGrid = '';
  paintGrid(grid); attachPinch(grid, sizeChanged);
  grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', `사진 ${shown.length}장`);
  shown.forEach((item, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'diary-grid-item'; button.dataset.diaryOpen = String(i);
    button.setAttribute('aria-label', `사진 ${i + 1} 크게 보기${isStarred(item) ? ', 별표' : ''}`);
    button.append(itemElement(item, 'small', {label:'', link:false}));
    const mark = document.createElement('span');
    mark.className = 'diary-star-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '★'; mark.hidden = !isStarred(item);
    button.append(mark); grid.append(button);
  });
  host.replaceChildren(grid);
  paintButtons(detail);
  // One short line per uploaded photo that has a comment (the full-screen view shows it under the photo too).
  const comments = photoComments(row), commented = shown.map((item, i) => ({i, text:item.kind === 'upload' ? comments[item.file.drive_file_id] : ''})).filter(item => item.text);
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
// 칸 수가 바뀌면 격자의 CSS 변수만 바꾼다(다시 그리지 않아 받은 그림·스크롤이 그대로).
function sizeChanged() { paintGrid(detail.querySelector('[data-diary-grid]')); paintButtons(detail); }
// 폴드를 펼치거나 접으면(넓은 화면 ↔ 좁은 화면) CSS가 칸 수를 바꾸고, [－][＋]의 끝 단계 표시만 다시 맞춘다.
globalThis.matchMedia?.(WIDE_QUERY)?.addEventListener?.('change', () => paintButtons(detail));
// A star changed: the marks on the grid and the full-screen view follow without rebuilding the grid (focus stays).
function paintStars() {
  detail.querySelectorAll('[data-diary-open]').forEach(button => {
    const i = Number(button.dataset.diaryOpen), item = shown[i];
    if (!item) return;
    const on = isStarred(item);
    const mark = button.querySelector('.diary-star-mark'); if (mark) mark.hidden = !on;
    button.setAttribute('aria-label', `사진 ${i + 1} 크게 보기${on ? ', 별표' : ''}`);
  });
  photoStripRefresh();
}
// ☆ saves at once (the server table is the only copy). A failed save puts the star back the way it was.
async function toggleStar(item) {
  if (!item) return;
  if (starsState !== 'ready') { viewerNote(starNote()); return; }
  const k = starKey(item.source, item.key);
  if (starBusy.has(k)) return;
  const was = starSet.has(k), scope = owner;
  starBusy.add(k);
  if (was) starSet.delete(k); else starSet.add(k);
  paintStars();
  try {
    if (was) await removeStar(item, rt); else await addStar({source:item.source, key:item.key, day:item.day}, rt);
    viewerNote('');
  } catch {
    if (scope === owner) { if (was) starSet.add(k); else starSet.delete(k); paintStars(); viewerNote('별표를 저장하지 못했어요. 다시 눌러 주세요.'); }
  } finally { starBusy.delete(k); }
}
const viewerNote = text => photoStripNote(text);

// Full-screen photo view (OD-크게보기 2026-10-28): 공용 부품 photo-strip.js(사진 메뉴와 같은 것). 이 화면은 목록·별표·지우기 상태만 넘긴다.
// 🗑(원드라이브 사진만)은 묻지 않고 목록에서 바로 빼고 '휴지통으로 옮겼어요 · 되돌리기'를 몇 초 보여 준 뒤 원드라이브 휴지통으로 보낸다.
const diaryStatus = text => { const el = root.querySelector('[data-diary-status]'); if (el) el.textContent = text; };
// 이 달 목록에서 그 사진을 빼고 원래 자리를 기억한다.
function takeFromMonth(item) {
  const list = odMonth?.days?.[item.day] || [], index = list.findIndex(p => p.id === item.id);
  if (index < 0) return null;
  const photo = list[index];
  odMonth.days[item.day] = list.filter(p => p.id !== item.id);
  if (!odMonth.days[item.day].length) delete odMonth.days[item.day];
  return {photo, index, day:item.day, month:odMonth, scope:owner};
}
function putBackMonth(p) {
  if (!p || odMonth !== p.month || owner !== p.scope) return false;
  odMonth.days[p.day] = putBack(odMonth.days[p.day], p.photo, p.index);
  return true;
}
// Drive 원본 내려받기 주소(file-actions.js driveDownloadUrl과 같은 모양). Drive 로그인이 필요한 주소라 그대로 링크로 둔다.
const originalHref = id => (typeof id === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(id) ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : '');
const whenText = item => `${shortDay(item.day)}${takenLabel(item) ? ' ' + takenLabel(item) : ''}`;
function openViewer(index) {
  openPhotoStrip({host:root, list:() => shown, index, title:`${shortDay(selected)} 사진`,
    element:itemElement, label:(item, i) => `${shortDay(selected)} 사진 ${i + 1}`, when:whenText,
    caption:item => (item.kind === 'upload' ? (photoComments(item.row)[item.file.drive_file_id] || '') : ''),
    info:item => [['찍은 때', whenText(item)], ['파일', item.kind === 'upload' ? (item.file?.file_name || '') : item.name], ['출처', item.kind === 'od' ? '원드라이브' : item.kind === 'phone' ? '폰' : '직접 올린 사진']],
    // [원본 내려받기]: 직접 올린 사진은 Drive 원본(Drive 로그인 필요). 원드라이브 사진은 원본을 넘기는 서버 동작이 아직 없어 원드라이브 앱에서 받는다.
    original:item => { const href = item.kind === 'upload' ? originalHref(item.file?.drive_file_id) : ''; return href ? {href} : {text:item.kind === 'phone' ? '폰 갤러리에 있어요' : '원드라이브 앱에서 받아 주세요'}; },
    // PHOTO-전체화면확대: 원드라이브 사진은 확대할 때 원본 해상도(받기 주소, 메모리에만). 직접 올린 사진은 큰 그림 그대로 확대.
    hires:item => (item.kind === 'od' && !item.video ? odMediaUrl(rt, item.id, 'download').then(r => r.url) : item.kind === 'phone' && !item.video ? Promise.resolve(phone.mediaUrl(item) || null) : null),
    isStarred, toggleStar,
    deletable:item => ({ok:item.kind === 'od' && od.canDelete, title:item.kind === 'od' ? (od.canDelete ? '원드라이브 휴지통으로' : '지우려면 원드라이브를 다시 연결해 주세요') : item.kind === 'phone' ? '폰 사진은 사진 메뉴에서 지워요' : '직접 올린 사진은 일기 [수정]에서 빼요'}),
    take:item => { const t = takeFromMonth(item); if (t) { renderMonth(); renderPhotos(); } return t; },
    restore:p => { if (putBackMonth(p)) { renderMonth(); if (selected === p.day && !edit) renderPhotos(); } },
    commit:async (p, {keepalive}) => {
      try { await odDelete(rt, p.photo.id, {keepalive}); forgetOdPhoto(p.photo.id); }
      catch (error) { if (error?.message === 'onedrive_item_missing') { forgetOdPhoto(p.photo.id); return; } throw error; }
    },
    errorText:error => `지우지 못했어요: ${odErrorText(error)}`, onError:diaryStatus,
    // [별표] list: photos un-starred in the full-screen view leave the list now.
    onClose:({starChanged, restore}) => { if (starChanged && source === 'star' && selected && restore) renderPhotos(); }});
}
const closeViewer = opts => closePhotoStrip(opts);
const odPanel = $('[data-diary-od]');
function ensureOdStatus(force = false) {
  if (force) odStatusFlight = null;
  // OD-미리받기: 앱을 켤 때 받아 둔 연결 상태가 있으면 그것을 쓴다(force면 서버에 다시 묻는다).
  odStatusFlight ||= odStatusCached(rt, {force}).then(next => { od = next; }, () => { od = {...OD_NONE, failed:true}; });
  return odStatusFlight;
}
async function loadOd(run, key, force = false) {
  const [year, month] = [cursor.year, cursor.month];
  await ensureOdStatus();
  if (!current(run)) return;
  const wantPhotos = od.connected && od.folder;
  // OD-미리받기: 처음 여는 달이 앱을 켤 때 받아 둔 이번 달이면 그 목록을 쓴다(다시 읽기는 늘 서버).
  const monthFlight = !wantPhotos ? Promise.resolve(null) : (!force && odTakeWarmMonth(rt, year, month)) || odPhotos(rt, year, month);
  const [photos, stars] = await Promise.allSettled([monthFlight, readStars(year, month, rt)]);
  if (!current(run) || key !== monthKey()) return;
  odMonth = photos.status === 'fulfilled' ? photos.value : null;
  starsState = stars.status === 'fulfilled' ? 'ready' : 'failed';
  starSet = new Set(stars.status === 'fulfilled' ? stars.value.map(r => starKey(r.source, r.item_key)) : []);
  if (photos.status === 'rejected') { odMessage = odErrorText(photos.reason); odFault = true; } else if (wantPhotos) odFault = false;
  // A bad row from the notes read must not turn this background step into an unhandled error (loadMonth reports that read itself).
  try {
    renderOdPanel(); renderMonth();
    if (selected && monthOf(selected) === key && !photoStripOpen() && !edit) renderDetail();
    // 이 달 날마다 앞 몇 장의 썸네일 주소를 가장 낮은 순서로 미리 받아 둔다(날짜를 누르면 바로 뜨게).
    if (odMonth) odPrefetchMonth(odMonth, {rt});
  } catch { /* shown by loadMonth's own status line */ }
  // OD-폰보관: 이 달 보관분을 최신 목록에 맞추고, 이번 달부터 거꾸로 작은 그림 미리 받기(이미 돌고 있으면 그대로).
  if (odMonth) {
    odKeepReconcile(year, month, odMonth, {rt});
    const today = todayKey(), ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7)) - 1;
    odStartPrefetch(ty, tm, ty === year && tm === month ? odMonth : null, {rt});
  }
  if (wantPhotos && current(run)) startOdSync();
}
function renderOdPanel() {
  paintOdLink(odLinkBtn, od, odFault);
  const keepScroll = odPanel.querySelector('.diary-od-tree')?.scrollTop || 0;
  const syncing = od.connected && od.folder && odSyncState.active ? `<p class="diary-od-sync" role="status" data-od-sync aria-label="사진 목록 받기">${waitInlineHtml()}${odSyncState.count === null ? '' : ` ${odSyncState.count}장`}</p>` : '';
  const truncated = od.connected && od.folder && odMonth?.truncated && odShowOn() ? '<p class="diary-od-sync">이 달 사진은 일부만 읽었어요.</p>' : '';
  const modal = odSettings.html();
  // 연결 표시는 아이콘이 맡고, 이 칸은 받는 중·안내·설정 창이 있을 때만 보인다(일기 쓰기 중에는 숨김).
  odPanel.hidden = !od.configured || !!edit || !(modal || syncing || truncated || odMessage);
  if (!od.configured) { odPanel.replaceChildren(); return; }
  odPanel.innerHTML = `${syncing}${truncated}${modal}<p class="diary-od-note" role="status">${modal ? '' : esc(odMessage)}</p>`;
  odPanel.querySelectorAll('button').forEach(b => { b.disabled = odSettings.busy; });
  if (modal && keepScroll) { const ul = odPanel.querySelector('.diary-od-tree'); if (ul) ul.scrollTop = keepScroll; }
  if (modal) { const note = odPanel.querySelector('[data-od-modal-note]'); if (note) note.textContent = odMessage; }
}
const odLinkBtn = $('[data-od-link]');
const odLinkMenu = createOdLinkMenu({id:'diaryOdMenu', historyKey:'kptuDiaryOdMenu', label:'원드라이브',
  model:() => ({od, fault:odFault, message:odFault ? odMessage : '', show:odShowOn()}), onAction:odLinkAct});
function odLinkAct(act) {
  if (act === 'connect' || act === 'reconnect') return odSettings.connect();
  if (act === 'folder') return odSettings.run(odSettings.startBrowse);
  if (act === 'subfolders') return odSettings.open ? undefined : odSettings.run(odSettings.openTree);
  if (act === 'show') return setOdShow(!odShowOn());
  if (act === 'disconnect') return odSettings.disconnect();
  if (act === 'retry') return ensureOdStatus(true).then(() => loadMonth({force:true}));
}
// 일기에서 원드라이브 사진 보이기: 끄면 달력 점·그날 사진에서 원드라이브 사진만 빠진다(직접 올린 사진은 늘 보임). 서버에 기억한다.
function setOdShow(on) {
  odShowChosen = on;
  viewPrefs.set('diary_onedrive', on, {rejectable:true});
  renderOdPanel(); renderMonth();
  if (selected && !photoStripOpen() && !edit) renderDetail();
  // 목록 보기는 달마다 원드라이브 목록을 기억하므로 비우고 다시 그린다.
  listView.reset(); listDirty = true;
  if (!allHost.hidden) { listView.hide(); applyView(); }
}
// 사진 목록 받기: 서버가 more:false라고 할 때까지 반복. 429면 retry_after초, 409면 5초 뒤. 화면을 떠나면 멈춘다.
function stopOdSync() {
  odSyncState.run++; odSyncState.active = false; odSyncState.count = null; clearTimeout(odSyncState.timer); odSyncState.wake?.(); odSyncState.wake = null;
}
const odSleep = ms => new Promise(resolve => { odSyncState.wake = resolve; odSyncState.timer = setTimeout(resolve, ms); });
async function startOdSync() {
  if (!od.connected || !od.folder || odSyncState.active || odSyncState.done) return;
  const my = ++odSyncState.run;
  odSyncState.active = true; odSyncState.count = null;
  let saw = false;
  renderOdPanel();
  try {
    for (;;) {
      let step;
      try { step = await odSync(rt); } catch (error) {
        if (odSyncState.run !== my) return;
        const wait = odSyncDelay(error);
        if (wait === null) { odMessage = odErrorText(error); odFault = true; break; }
        saw = true; await odSleep(wait);
        if (odSyncState.run !== my) return;
        continue;
      }
      if (odSyncState.run !== my) return;
      if (step.more || step.indexing) saw = true;
      try { const tree = await odFolderTree(rt); if (odSyncState.run === my) odSyncState.count = tree.top.total; } catch { /* 장수는 없어도 된다 */ }
      if (odSyncState.run !== my) return;
      renderOdPanel();
      if (!step.more) { odSyncState.done = true; break; }
    }
  } finally {
    if (odSyncState.run === my) { odSyncState.active = false; odSyncState.count = null; renderOdPanel(); }
  }
  if (odSyncState.run === my && saw && odSyncState.done) loadMonth({force:true});
}
// Write / edit panel. One diary per day: a day that already has one always opens it to edit.
const commentsChanged = () => { const now = cleanLive(), was = edit.startComments; const keys = new Set([...Object.keys(now), ...Object.keys(was)]); return [...keys].some(key => (now[key] || '') !== (was[key] || '')); };
// The typed comments of the photos already on the day, trimmed to one line; an over-long one is cut by cleanComments' error.
const cleanLive = () => { const out = {}; for (const [id, text] of Object.entries(edit.comments)) { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); if (line) out[id] = line; } return out; };
// The text changed since the editor opened (or since the last save). Opening an old diary writes nothing: it is converted in memory.
const textChanged = () => !!edit?.field && JSON.stringify(edit.field.getValue()) !== edit.baseJson;
const dirty = () => !!edit && (edit.pending.length > 0 || textChanged() || commentsChanged());
const EDITOR_LOADING = '\u0000wait'; // UI-기다림표시통일 2차: 편집기를 받는 동안 상태 줄은 글자 없는 회색 칸
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
  if (!allHost.hidden) listView.hide();
  renderEditor(EDITOR_LOADING); renderOdPanel();
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
    // Clear only our own loading line: a notice shown meanwhile (e.g. the 20-photo limit) stays.
    if (!session.busy && editor.querySelector('[data-diary-editor-status]')?.dataset.diaryEditorWait === '1') setEditorStatus('');
  } catch { if (edit === session) setEditorStatus('편집기를 불러오지 못했어요. 닫고 다시 열어 주세요.'); }
}
function dropField() {
  if (boxLayer) { const layer = boxLayer; boxLayer = null; layer.close(); }
  try { edit?.field?.destroy(); } catch { /* the editor is gone with the panel */ }
}
function renderEditor(message = '') {
  const {row, day} = edit, photos = diaryPhotos(row), count = photos.length + edit.pending.length;
  editor.hidden = false;
  // UI-버튼통일(2026-10-28 19:16 시안 승인): 위 줄 제목 · [⋯](일기 지우기) · ✕(테두리 없음). 날짜는 달력이 열리는 공용 칸 하나(이름표 없음, app/date-field.js)이고
  // 그 옆에 작은 [📷 사진 0/20]. 글 칸도 이름표 없이 편집기만. 아래 줄은 오른쪽에 [취소](작은 버튼)·[저장](진한 버튼 하나).
  editor.innerHTML = `<div class="diary-panel-head"><h3 id="diaryEditorTitle" tabindex="-1">${row ? '일기 수정' : '일기 쓰기'}</h3><span class="diary-head-ends">${row ? '<span class="diary-head-menu-wrap"><button type="button" class="icon-btn diary-head-more" data-diary-editor-more aria-haspopup="true" aria-expanded="false" aria-controls="diaryEditorMenu" aria-label="일기 관리"><span class="more-dots" aria-hidden="true">⋯</span></button><span id="diaryEditorMenu" class="diary-lv-menu diary-head-menu" role="group" aria-label="일기 관리" data-diary-editor-menu hidden><button type="button" class="diary-menu-danger" data-diary-delete>일기 지우기</button></span></span>' : ''}<button type="button" class="icon-btn" data-diary-editor-close aria-label="일기 창 닫기">×</button></span></div>
<div class="diary-edit-top"><input type="date" data-diary-date value="${esc(day)}" min="2000-01-01" max="2100-12-31" aria-label="일기 날짜"${row ? ' disabled' : ''}><input id="diaryPhotoInput" class="a11y-only" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" data-diary-input><button type="button" class="secondary diary-photo-pick" data-diary-pick aria-controls="diaryPhotoInput" aria-label="사진 고르기, ${count}장 / 최대 ${DIARY_MAX_PHOTOS}장"${count >= DIARY_MAX_PHOTOS ? ' disabled' : ''}><span aria-hidden="true">📷</span> 사진 <span data-diary-count>${count}/${DIARY_MAX_PHOTOS}</span></button></div>
<div class="diary-thumbs" data-diary-thumbs></div>
<div class="diary-doc"><div data-diary-doc-slot></div></div>
<p class="diary-editor-status" data-diary-editor-status role="status" aria-live="polite"></p>
<div class="diary-actions save-row save-row-sticky"><button type="button" class="secondary" data-diary-editor-close>취소</button><button type="button" class="primary" data-diary-save data-enter-save-submit>저장</button></div>`;
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
const setEditorStatus = message => { const line = editor.querySelector('[data-diary-editor-status]'); if (!line) return; if (message === EDITOR_LOADING) line.innerHTML = waitInlineHtml(); else line.textContent = message; line.dataset.diaryEditorWait = message === EDITOR_LOADING ? '1' : ''; };
function releasePending() { edit?.pending.forEach(entry => URL.revokeObjectURL(entry.url)); }
function closeEditor({fromBack = false, force = false} = {}) {
  if (!edit) return true;
  if (edit.busy) return false;
  if (!force && dirty() && !window.confirm('쓰던 일기를 저장하지 않고 닫을까요?')) return false;
  releasePending(); dropField(); edit = null; editor.hidden = true; editor.replaceChildren(); listDirty = true;
  cal.hidden = false; renderList(); renderOdPanel(); $('[data-diary-new]').hidden = false; $('.diary-head').hidden = false; status.hidden = false;
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
const pruneNote = pruned => !pruned ? '사진을 뺐어요. Drive 원본은 나중에 정리해요.'
  : pruned.trashed ? '사진을 뺐어요. Drive 원본은 휴지통으로 보냈어요.'
  : pruned.kept ? '사진을 뺐어요. 다른 기록이 같은 파일을 쓰고 있어 Drive 원본은 남겨요.' : '사진을 뺐어요. Drive 원본은 나중에 정리해요.';
async function removePhoto(fileId) {
  if (!edit?.row || edit.busy) return;
  if (!window.confirm('이 사진을 일기에서 뺄까요? Drive 원본은 휴지통으로 보내요(30일 안에 복구 가능).')) return;
  edit.busy = true; renderEditor('사진을 빼는 중…');
  let row;
  try {
    row = await removeDiaryPhoto(edit.row, fileId, rt);
  } catch (error) {
    edit.busy = false; return renderEditor(error?.message && !error.status ? error.message : '사진을 빼지 못했어요. 다시 시도해 주세요.');
  }
  rows.set(row.journal_day, row); edit.row = row;
  delete edit.comments[fileId]; delete edit.startComments[fileId];
  renderMonth();
  // The photo is out of the day for good now; its Drive original goes to the Drive trash (best effort, never throws).
  const pruned = await pruneDiaryPhotos([fileId], {rt});
  if (!edit) return;
  edit.busy = false; renderEditor(pruneNote(pruned));
}
// UI-버튼통일 ①(2026-10-28 19:16, 08:28 지우기 방식과 같게): [일기 지우기](쓰기 창 ⋯ 안·날짜 칸)는 묻지 않고 바로 화면에서 빼고
// 위쪽 작은 알림 '일기를 지웠어요 · [되돌리기]'(공용 offerUndoNotice, PC Ctrl+Z 포함)를 띄운다. 일기는 하루 1행이라 서버 휴지통 대상이 아니므로
// 실제 지우기(note-delete — 사진은 Drive 휴지통)는 알림이 닫힐 때(2초, 올려 두면 멈춤·다른 알림이 뜨면 바로) 보낸다. [되돌리기]면 아무것도 보내지 않는다.
// 알림이 떠 있는 동안 페이지를 닫으면 보내지 못해 일기는 남는다(잃는 쪽이 아니라 남는 쪽). 서버가 실패하면 그 날을 되살리고 알린다.
let pendingDelete = null;
const DIARY_DELETED = '일기를 지웠어요.';
function restoreDiaryRow(row) {
  if (!rows.has(row.journal_day)) rows.set(row.journal_day, row);
  listDirty = true; renderMonth();
}
async function commitDiaryDelete(job) {
  if (job.done || job.undone) return;
  // 로그인이 바뀌었으면 보내지 않는다(일기는 남음).
  if (job.owner !== ownerScope(rt)) { job.undone = true; clearInterval(job.watch); window.removeEventListener('pagehide', job.leave); if (pendingDelete === job) pendingDelete = null; return; }
  job.done = true; clearInterval(job.watch); window.removeEventListener('pagehide', job.leave);
  if (pendingDelete === job) pendingDelete = null;
  const result = await deleteNoteOriginal(job.row.id, {rt, confirmed:true});
  if (job.owner !== ownerScope(rt) || ['deleted', 'missing', 'stale'].includes(result.status)) return;
  restoreDiaryRow(job.row);
  notifySmall(`${shortDay(job.row.journal_day)} 일기를 지우지 못해 되살렸어요. ${String(result.message || '').replace(/업데이트/g, '일기')}`.trim(), {error:true});
}
// [⋯] 작은 목록: 쓰기 창 머리줄 안에 붙어 열린다(뒤로 가기 기록을 쓰지 않아 쓰기 창의 뒤로 가기와 엉키지 않는다). 바깥을 누르거나 Esc면 닫힌다.
function toggleEditorMenu(button, open = !button.nextElementSibling || button.nextElementSibling.hidden) {
  const menu = button.nextElementSibling;
  if (!menu?.matches?.('[data-diary-editor-menu]')) return;
  menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('button')?.focus({preventScroll:true});
}
document.addEventListener('click', event => {
  const open = editor?.querySelector?.('[data-diary-editor-menu]:not([hidden])');
  if (open && !open.parentElement.contains(event.target)) toggleEditorMenu(open.previousElementSibling, false);
}, true);
document.addEventListener('keydown', event => {
  const open = editor?.querySelector?.('[data-diary-editor-menu]:not([hidden])');
  if (open && event.key === 'Escape') { event.preventDefault(); toggleEditorMenu(open.previousElementSibling, false); open.previousElementSibling?.focus({preventScroll:true}); }
});
async function removeDiary(row) {
  if (!row || edit?.busy) return;
  if (pendingDelete) await commitDiaryDelete(pendingDelete);
  const day = row.journal_day;
  rows.delete(day); listView.dropDay(day); listDirty = true;
  if (edit) closeEditor({force:true});
  closeDetail(); renderMonth();
  const job = {row, owner:ownerScope(rt), done:false, undone:false};
  pendingDelete = job;
  const box = offerUndoNotice({text:`${shortDay(day)} ${DIARY_DELETED}`, onUndo:async () => {
    if (job.done) return {status:'failed', message:'이미 지워져 되돌리지 못했어요.'};
    job.undone = true; clearInterval(job.watch); window.removeEventListener('pagehide', job.leave);
    if (pendingDelete === job) pendingDelete = null;
    if (job.owner !== ownerScope(rt)) return {status:'stale'};
    restoreDiaryRow(row);
    return {status:'restored', message:'일기를 되돌렸어요.'};
  }});
  if (!box) return commitDiaryDelete(job);
  job.leave = () => { void commitDiaryDelete(job); };
  window.addEventListener('pagehide', job.leave);
  job.watch = setInterval(() => { if (!box.isConnected) void commitDiaryDelete(job); }, 250);
}

root.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !root.contains(button) || button.disabled) return;
  if (button.matches('[data-diary-day]')) return selected === button.dataset.diaryDay ? closeDetail() : selectDay(button.dataset.diaryDay);
  if (button.matches('[data-diary-list-day]')) return selectDay(button.dataset.diaryListDay, {focus:true});
  if (button.matches('[data-diary-view]')) return setView(button.dataset.diaryView);
  if (button.matches('[data-diary-lv-filter]')) { listView.setFilter(button.dataset.diaryLvFilter); return applyView(); }
  if (button.matches('[data-diary-lv-find]')) { listView.toggleSearch(); return applyView(); }
  if (button.matches('[data-diary-prev]')) return moveMonth(-1);
  if (button.matches('[data-diary-next]')) return moveMonth(1);
  if (button.matches('[data-diary-today]')) return goToday();
  if (button.matches('[data-diary-retry]')) return loadMonth({force:true});
  // UI-일기손질 ③: the shared [+] writes the chosen day (edits it when it has one), or today when no day is chosen.
  if (button.matches('[data-diary-new]')) return openEditor(selected || todayKey());
  if (button.matches('[data-diary-detail-close]')) return closeDetail();
  if (button.matches('[data-diary-source]')) { source = button.dataset.diarySource; return renderDetail(); }
  if (button.matches('[data-photo-size]')) { if (changeCols(Number(button.dataset.photoSize))) sizeChanged(); return; }
  if (button.matches('[data-diary-open]')) return openViewer(Number(button.dataset.diaryOpen));
  if (button.matches('[data-od-link]')) return odLinkMenu.open(button);
  if (odSettings.click(button, odPanel)) return;
  if (button.matches('[data-diary-edit]')) return openEditor(selected);
  if (button.matches('[data-diary-editor-more]')) return toggleEditorMenu(button);
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
  stopOdSync(); odSettings.drop(); renderOdPanel();
  dayLayer = null; editLayer = null;
  if (selected) closeDetail({fromBack:true});
  // 다른 화면에서 일기가 바뀌었을 수 있으니 목록은 다음에 돌아올 때 다시 읽는다.
  listView.hide(); listDirty = true;
});
window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt); epoch++;
  odStopPrefetch(); odKeepForOwner(rt);
  closeViewer({fromBack:true, restore:false});
  stopOdSync(); odSyncState.done = false; od = {...OD_NONE}; odStatusFlight = null; odMonth = null; odSettings.setOpen(false); odSettings.drop(); odMessage = ''; odFault = false; odShowChosen = null; starSet = new Set(); starsState = 'loading'; clearOdPhotoCache(); renderOdPanel();
  if (edit) { releasePending(); dropField(); edit = null; editor.hidden = true; editor.replaceChildren(); cal.hidden = false; $('.diary-head').hidden = false; $('[data-diary-new]').hidden = false; status.hidden = false; }
  editLayer = null; dayLayer = null; selected = null; sendWhere(null); detail.hidden = true; rows = new Map(); loadedMonth = ''; chosenView = null; lastListDay = null; listView.hide(); listView.reset(); renderMonth();
});
function enter() {
  const back = takeOdReturn();
  if (back) ensureOdStatus().then(() => odSettings.finishReturn(back));
  const placed = window.KPTURouter?.place?.('diary')?.day || '';
  const day = takeRequestedDay(rt) || (/^\d{4}-\d{2}-\d{2}$/.test(placed) ? placed : null);
  if (!day && /^\d{4}-\d{2}$/.test(placed)) {
    const [y, m] = placed.split('-').map(Number);
    if (m >= 1 && m <= 12 && (y !== cursor.year || m - 1 !== cursor.month)) { cursor = {year:y, month:m - 1}; closeDetail(); writePlace(); }
  }
  if (day) {
    const [y, m] = day.split('-').map(Number);
    if (y !== cursor.year || m - 1 !== cursor.month) { cursor = {year:y, month:m - 1}; closeDetail(); }
    loadMonth().then(() => selectDay(day, {focus:true}));
    return;
  }
  writePlace(); loadMonth();
}
window.KPTURouter?.on?.('diary', enter);
window.KPTUDiary = {refresh:() => loadMonth({force:true})};
if (window.KPTURouter?.current === 'diary') enter();
})();
