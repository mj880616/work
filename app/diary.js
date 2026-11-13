import {waitInlineHtml, emptyHtml} from './wait-state.js';
// JOURNAL-일기 1차: the [일기] side of the schedule tab (?view=diary). This module is the only renderer of #diaryRoot:
// month photo calendar → the chosen day below it (photos large, swipe sideways, and the text) → write/edit panel.
// Rows, photos and photo views go through diary-data.js (owner RLS + basket-files); deleting uses the basket's
// note-delete path (attachments to the Drive trash). Back closes the top open thing first (router layers).
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {seoulParts, seoulDate, addSeoulDays, seoulDateKey, formatSeoulTime} from './meeting-time.js';
import {readDiaryMonth, readDiaryDay, createDiary, saveDiaryText, removeDiaryPhoto, removeDiaryPhotos, moveDiaryDay, pruneDiaryPhotos, dropEmptyDiary, uploadDiaryPhoto, shrinkPhoto, diaryUploadText, photoElement,
  diaryPhotos, diaryText, takeRequestedDay, takeRequestedWrite, todayKey, ownerScope, validateDiaryText, DIARY_MAX_PHOTOS, DIARY_COMMENT_MAX,
  photoComments, cleanComments, saveDiaryComments} from './diary-data.js';
import {SIZE_BUTTONS, WIDE_QUERY, paintGrid, paintButtons, changeCols, attachPinch} from './photo-grid-size.js';
import {putBack} from './photo-viewer-model.mjs';
import {splitPictures} from './picture-file.mjs';
// UI-올리기진행표시: 고른 사진 칸 위 막대 + %, 위쪽 합계 줄, 실패 [다시](공용 부품 하나).
import {mountUploadRows, paintUploadOverlay, watchUploads, setUploadRetry, trackUpload, uploadJobs, announceDock} from './upload-progress.js';
// OD-크게보기: 크게 보기는 공용 부품(사진 메뉴와 같은 것).
import {openPhotoStrip, closePhotoStrip, photoStripOpen, photoStripNote, photoStripRefresh} from './photo-strip.js';
import {deleteNoteOriginal, offerUndoNotice} from './basket-record-delete.js';
import {notify as notifySmall, askConfirm} from './small-notice.js';
import {odStatusCached, odTakeWarmMonth, odDelete, odPhotos, odPhotoElement, odPrefetchMonth, clearOdPhotoCache, forgetOdPhoto, odKeepReconcile, odStartPrefetch, odStopPrefetch, odKeepCount, odKeepClear, odKeepForOwner,
  odErrorText, odMediaUrl, odSync, odSyncDelay, odFolderTree, readStars, addStar, removeStar, starKey, dayItems, takenLabel, takeOdReturn} from './diary-onedrive.js';
// ED③ 일기: the day's text is the new editor (ed-editor.js) inside this panel; the read view draws its saved form (ed-render). The photos,
// their comments, the calendar and the swipe stay as they were. Letters (raw_text) are still saved with it for every other reader.
import {renderDoc} from './ed-render.mjs';
import {mountLineWidth} from './line-width.js';
import {diaryHasDoc, diaryStartDoc, joinDiaryDocs, diaryDocToStore, diaryDocError} from './diary-doc.mjs';
import {plainToDocKeep} from './ed-markdown.mjs';
// JOURNAL-일기목록: [달력 / 목록] 바꾸기. 목록 칸은 diary-list.js가 그리고, 고른 보기는 서버(view_prefs.diary_view)에 기억한다(기기 저장 없음).
import {createDiaryList} from './diary-list.js';
import {doneLine, inDiaryPhoto} from './diary-list-model.mjs';
import {viewPrefs} from './view-prefs.js';
import {iconSvg, iconHtml} from './tree-icons.js';
import {photoContextLine} from './diary-context-model.mjs';
// OD-연결아이콘: 원드라이브 연결 표시는 [오늘] 오른쪽 아이콘 하나 + 드롭다운(공용 부품, 사진 메뉴도 같은 부품).
import {odLinkButtonHtml, paintOdLink, createOdLinkMenu} from './od-link.js';
import {createOdSettings} from './od-settings.js';
// S46-20 사진 정리 ⑥(명진 11/01 01:04): 그날 폰 사진도 같은 격자에 '보여 주기만'(앱 다리로 폰 안에서만 읽음, 서버 저장 없음).
import {phonePhotos} from './phone-photos.js';
import {readDeviceSources} from './photo-sources-device.js';
import {phoneHideList} from './phone-folders-sync.js';
import {dayEndMs, phoneDayItems} from './time-photos-model.mjs';

(() => {
if (window.KPTUDiary) return;
const root = document.querySelector('#diaryRoot');
if (!root) return;
const rt = window.KPTURuntime;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const longDay = day => formatSeoulTime(day, {month:'long', day:'numeric', weekday:'long'});
const shortDay = day => formatSeoulTime(day, {month:'long', day:'numeric'});

root.innerHTML = `<div class="diary-head"><div class="diary-source diary-views ds-seg" role="group" aria-label="일기 보기"><button type="button" class="ds-seg-btn" data-diary-view="calendar" aria-pressed="true">달력</button><button type="button" class="ds-seg-btn" data-diary-view="list" aria-pressed="false">목록</button></div><div class="diary-month-od"><div class="diary-month"><button type="button" class="mini" data-diary-prev aria-label="이전 달">‹</button><b data-diary-title aria-live="polite"></b><button type="button" class="mini" data-diary-next aria-label="다음 달">›</button><button type="button" class="mini" data-diary-today>오늘</button></div>${odLinkButtonHtml()}</div><div class="diary-lv-tools" data-diary-lv-tools hidden><div class="diary-source ds-seg" role="group" aria-label="일기 선택"><button type="button" class="ds-seg-btn" data-diary-lv-filter="all" aria-pressed="true">전체</button><button type="button" class="ds-seg-btn" data-diary-lv-filter="star" aria-pressed="false" aria-label="별표한 일기만">★</button></div><button type="button" class="mini diary-lv-find" data-diary-lv-find aria-pressed="false" aria-label="일기 찾기">${iconSvg('search', {size: 15})}</button></div><button type="button" id="newDiaryBtn" class="primary" data-diary-new aria-label="일기 쓰기">+ 일기</button></div>
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
const odSettings = createOdSettings({rt, layerName:'diary-od', hint:'하위 폴더도 함께 읽어요.',
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

// JOURNAL-오늘한일달력 (S50-29, 요청함 11/02 13:17 덧붙임): 일기를 안 쓴 날도 그날 '오늘 한 일'이 있으면 달력 칸에 빈 동그라미, 이 달 목록에
// 그 날짜 줄('한 일 · 첫 줄')이 나온다. 홈에서 넣은 같은 자료를 읽기만(work-day-lines.js readDoneBetween — 두 벌 저장 없음, 메모리에만).
// 못 읽으면 일기만 그대로 그린다(안내를 더하지 않는다). 그날을 누르면 그날 창의 '오늘 한 일' 칸(paintDone)이 줄을 보인다.
let doneMonth = {key:'', days:new Map()};
const doneOf = day => (doneMonth.key === monthKey() ? doneMonth.days.get(day) : null) || [];
const doneSign = days => JSON.stringify([...days].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
function loadDoneMonth(run, key) {
  const first = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-01`, last = seoulDateKey(seoulDate(cursor.year, cursor.month + 1, 0));
  import('./work-day-lines.js').then(m => m.readDoneBetween(first, last, rt)).then(days => {
    if (!days || !current(run) || key !== monthKey()) return;
    const same = doneMonth.key === key && doneSign(doneMonth.days) === doneSign(days);
    doneMonth = {key, days};
    if (!same && !edit) renderMonth();
  }).catch(() => {});
}
let monthSign = '';
function renderMonth() {
  $('[data-diary-title]').textContent = `${cursor.year}년 ${cursor.month + 1}월`;
  const first = seoulDate(cursor.year, cursor.month), lead = seoulParts(first).weekday;
  const total = seoulParts(seoulDate(cursor.year, cursor.month + 1, 0)).day, today = todayKey();
  const info = [];
  for (let n = 1; n <= total; n++) {
    const day = seoulDateKey(addSeoulDays(first, n - 1)), row = rows.get(day), photos = diaryPhotos(row), odDay = odShown()?.days[day] || [];
    info.push({n, day, row, photos, text: !!diaryText(row), od: odDay.length, done: doneOf(day).length, photo: photos[0] ? `${row.id}:${photos[0].drive_file_id}` : ''});
  }
  // 달력은 일기·원드라이브·'오늘 한 일'이 따로따로 도착할 때마다 다시 그리라는 부름을 받는다. 그릴 내용이 지금 칸과 같으면 칸을 갈지 않는다 —
  // 누르려던 칸·그 칸의 사진이 같은 모양 새 칸으로 바뀌어 떨어져 나가지 않게(S51-19). 고른 날 표시는 selectDay·closeDetail이 칸에서 바로 맞춘다.
  const sign = JSON.stringify([lead, today, selected, info.map(i => [i.day, !!i.row, i.photo, i.photos.length, i.text, i.od, i.done])]);
  if (sign !== monthSign || days.childElementCount !== lead + total) {
    monthSign = sign;
    // 칸을 다시 만들 때도 칸의 사진은 같은 일기·같은 파일이면 앞서 만든 사진 칸을 옮겨 쓴다 — 새 사진 칸을 만들면 떨어져 나간 옛 칸도
    // 계속 사진을 읽고 다시 읽어 요청이 늘어난다.
    const shownPhotos = new Map([...days.querySelectorAll('.diary-cell > .diary-photo[data-diary-cell-photo]')].map(el => [el.dataset.diaryCellPhoto, el]));
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(Object.assign(document.createElement('span'), {className:'diary-cell diary-blank'}));
    for (const {n, day, row, photos, text, od, done, photo} of info) {
      const cell = document.createElement('button');
      cell.type = 'button'; cell.className = 'diary-cell'; cell.dataset.diaryDay = day;
      if (day === today) { cell.setAttribute('aria-current', 'date'); cell.classList.add('ds-today'); }
      cell.setAttribute('aria-pressed', String(selected === day)); cell.classList.toggle('ds-day-sel', selected === day);
      cell.setAttribute('aria-label', `${shortDay(day)}${photos.length ? `, 사진 ${photos.length}장` : text ? ', 글' : ''}${od ? `, 원드라이브 사진 ${od}장` : ''}${done ? `, 한 일 ${done}줄` : ''}`);
      if (photo) {
        cell.classList.add('has-photo');
        let box = shownPhotos.get(photo);
        if (box) shownPhotos.delete(photo);
        else { box = photoElement(row, photos[0], 'small', {label:'', link:false, retry:false}); box.dataset.diaryCellPhoto = photo; }
        cell.append(box);
      }
      const num = document.createElement('span'); num.className = day === today ? 'diary-num ds-day-num ds-today-num' : 'diary-num ds-day-num'; num.textContent = String(n); cell.append(num);
      if (!photos.length && text) { const dot = document.createElement('span'); dot.className = 'diary-dot'; dot.dataset.diaryDot = ''; cell.append(dot); }
      else if (!row && done) { const dot = document.createElement('span'); dot.className = 'diary-dot diary-dot-done'; dot.dataset.diaryDoneDot = ''; cell.append(dot); }
      if (od) { const dot = document.createElement('span'); dot.className = 'diary-dot diary-dot-od'; dot.dataset.diaryOdDot = ''; cell.append(dot); }
      cells.push(cell);
    }
    days.replaceChildren(...cells);
  }
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
  const doneDays = doneMonth.key === monthKey() ? [...doneMonth.days.keys()].filter(day => !rows.get(day)) : [];
  const days = [...new Set([...rows.keys()].filter(day => monthOf(day) === monthKey() && rows.get(day)).concat(doneDays))].sort().reverse();
  list.hidden = listMode || !!selected || !!edit || !days.length;
  list.replaceChildren(...days.map(day => {
    const row = rows.get(day), item = document.createElement('button');
    item.type = 'button'; item.className = 'diary-list-item'; item.dataset.diaryListDay = day;
    const date = document.createElement('b'), line = document.createElement('span');
    date.textContent = shortDay(day); line.textContent = row ? firstLine(row) : doneLine(doneOf(day));
    if (!row) { item.dataset.diaryListDone = ''; line.className = 'is-done'; }
    item.append(date, line); return item;
  }));
}
// quiet = 연 화면 유지(PERF-첫로딩, first-load.md 12절): 다 그린 같은 달로 돌아오면 보던 달력·열린 날을 그대로 두고,
// 뒤에서 이 달 일기를 다시 읽어 바뀐 것이 있을 때만 다시 그린다(기다림 표시 없음). 탭 메모리뿐.
async function loadMonth({force = false, quiet = false} = {}) {
  if (!force && loadedMonth === monthKey()) { renderMonth(); if (quiet) { void refreshMonth(); loadDoneMonth(epoch, monthKey()); } return; }
  const run = ++epoch, key = monthKey();
  loadDoneMonth(run, key);
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
let refreshSeq = 0;
const rowsSign = list => JSON.stringify([...list].map(row => [row.journal_day, row.id, row.updated_at]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
async function refreshMonth() {
  const run = epoch, key = monthKey(), mine = ++refreshSeq;
  // 쓰는 중·지우기 알림이 떠 있는 동안은 다시 읽지 않는다(고치던 글·되돌릴 날을 덮지 않게).
  const busy = () => edit || pendingDelete;
  if (busy()) return;
  let list;
  try { list = await readDiaryMonth(cursor.year, cursor.month, rt); } catch { return; } // 못 읽으면 보던 화면 그대로
  if (mine !== refreshSeq || !current(run) || key !== monthKey() || loadedMonth !== key || busy()) return;
  const next = Array.isArray(list) ? list : [];
  if (rowsSign(next) === rowsSign([...rows.values()])) return;
  rows = new Map(next.map(row => [row.journal_day, row])); listDirty = true;
  status.textContent = rows.size ? '' : '이 달에는 아직 일기가 없어요. [+]로 사진이나 글을 남겨 보세요.';
  renderMonth();
  if (selected && monthOf(selected) === key) renderDetail();
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
// JOURNAL-오늘한일업무개인: 그날 '오늘 한 일' 줄을 그날 보기·쓰기 창에도 보인다(홈에서 넣은 같은 자료를 읽기만, work-day-lines.js —
// 두 벌 저장 없음, 일기가 없는 날도). 날짜를 고를 때·쓰기 창을 열 때 한 번 읽고, 다시 그릴 때는 읽은 것을 쓴다(메모리에만).
let doneRead = {key:'', p:null};
function paintDone(slot, day, {fresh = false} = {}) {
  if (!slot || !day) return;
  const key = `${owner}|${day}`;
  if (fresh || doneRead.key !== key || !doneRead.p) doneRead = {key, p:import('./work-day-lines.js').then(m => m.readDayDone(day, rt).then(lines => ({m, lines})))};
  const p = doneRead.p;
  p.then(({m, lines}) => {
    if (!slot.isConnected || doneRead.p !== p) return;
    const section = m.dayDoneSection(day, lines);
    slot.replaceChildren(...(section ? [section] : []));
  }).catch(() => {});
}
// UI-PC손맛묶음(S56-52, 요청함 11/10 "우클릭: 일기 날짜 칸"): PC 달력 날짜 칸 우클릭 = 그날을 고르고(왼쪽 누름과 같은 selectDay) 그날 상세 ⋯ 메뉴를
// 누른 자리에 연다(상세 우클릭과 같은 메뉴·같은 공용 열기, context-menu.js openAt). 글·사진 없는 날은 그날 상세([일기 쓰기])만 연다. 브라우저 메뉴는 폰 폭·터치·Shift 등 공용 규칙 그대로.
days.addEventListener('contextmenu', e => {
  const cell = e.target instanceof Element ? e.target.closest('[data-diary-day]') : null;
  if (!cell || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.pointerType === 'touch' || !window.matchMedia('(min-width:761px)').matches) return;
  if (!window.KPTUContextMenu?.openAt) return;
  if (selected !== cell.dataset.diaryDay) selectDay(cell.dataset.diaryDay);
  const more = detail.querySelector('[data-diary-head-more]');
  e.preventDefault();
  // 글·사진이 없는 날은 상세에 ⋯가 없다(상세의 [일기 쓰기] 단추 하나) — 그날을 연 것으로 끝(브라우저 메뉴는 띄우지 않음).
  if (!more || !more.getClientRects().length) return;
  const r = cell.getBoundingClientRect();
  window.KPTUContextMenu.openAt(more, e.clientX || Math.round(r.left + r.width / 2), e.clientY || Math.round(r.bottom));
});
function selectDay(day, {focus = false} = {}) {
  doneRead = {key:'', p:null};
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
let diaryGrip = null;
function renderDetail() {
  if (!selected) return;
  sendWhere(longDay(selected));
  const row = rows.get(selected), text = diaryText(row), hasPhotos = dayItems(selected, row, odShown()).length + phoneShown(selected).length > 0;
  detail.hidden = false; list.hidden = true; if (!allHost.hidden) listView.hide();
  detail.innerHTML = `<div class="diary-panel-head"><span class="diary-head-ends">${row || hasPhotos ? detailMenuHtml() : ''}<button type="button" class="icon-btn" data-diary-detail-close aria-label="날짜 닫기">×</button></span></div><div class="diary-done" data-diary-done></div>${row || hasPhotos ? `<div class="diary-photo-bar"><div class="diary-source ds-seg" role="group" aria-label="사진 보기"><button type="button" class="ds-seg-btn" data-diary-source="all" aria-pressed="${source === 'all'}">전체</button><button type="button" class="ds-seg-btn" data-diary-source="star" aria-pressed="${source === 'star'}">별표</button></div>${SIZE_BUTTONS}</div><div data-diary-photos></div>${hasPhotos ? '<div class="diary-ctx-slot" data-diary-context-slot></div>' : ''}` : ''}${row ? `${text ? `<div class="diary-text${diaryHasDoc(row) ? ' is-doc' : ''}" data-diary-text-view>${diaryHasDoc(row) ? '' : esc(text)}</div>` : ''}<div class="diary-actions"><button type="button" class="secondary" data-diary-edit>수정</button><button type="button" class="secondary diary-danger" data-diary-delete>일기 삭제</button></div>` : emptyHtml('일기 없음')}`;
  syncDetailTitle();
  fillDetailMenu(row, hasPhotos);
  paintDone(detail.querySelector('[data-diary-done]'), selected);
  const view = detail.querySelector('[data-diary-text-view]');
  if (view && diaryHasDoc(row)) view.replaceChildren(renderDoc(row.doc));
  // NOTE-글폭(S61-21): 일기 읽기 글 줄도 노트와 같은 기본 폭(한 줄 약 40자)·같은 손잡이·같은 서버 값.
  diaryGrip?.destroy(); diaryGrip = view ? mountLineWidth({host:view, target:view}) : null;
  renderPhotos();
  if (hasPhotos) paintContext(detail.querySelector('[data-diary-context-slot]'), selected);
  void loadPhoneDay(selected);
}
// JOURNAL-일기원드라이브 10.6 '그날 맥락'(2026-11-10 명진 결정): 사진 있는 날에만 사진 격자 아래 접힌 한 줄(일정·회의만, diary-context.js).
// 업무일지와 같은 읽기를 그날 처음 열 때 한 번(주 단위 기억), 다시 그릴 때는 읽은 것을 쓴다(메모리에만). 펼침 상태도 이 접속 동안만 기억한다.
// 크게 보기 캡션은 찍은 시각과 일정·회의 시간을 맞춘 한 줄(photoContextLine). 맥락은 보여 주기만 하고 일기 글에 쓰지 않는다.
let dayContext = {key:'', p:null, entries:[]}, contextOpen = '';
function paintContext(slot, day) {
  if (!slot || !day) return;
  const key = `${owner}|${day}`;
  if (dayContext.key !== key || !dayContext.p) dayContext = {key, entries:[], p:import('./diary-context.js').then(m => m.readDayContext(day, rt).then(ctx => ({m, ctx})))};
  const read = dayContext, p = read.p;
  p.then(({m, ctx}) => {
    if (dayContext !== read) return;
    read.entries = ctx.entries;
    photoStripRefresh();
    if (!slot.isConnected) return;
    const box = m.contextSection(ctx.entries);
    if (box) {
      box.open = contextOpen === key;
      box.addEventListener('toggle', () => { contextOpen = box.open ? key : (contextOpen === key ? '' : contextOpen); });
      box.addEventListener('click', event => {
        const line = event.target.closest('[data-diary-context-open]'), entry = line && read.entries[Number(line.dataset.diaryContextOpen)];
        if (!entry) return;
        m.openContextEntry(entry).catch(() => diaryStatus('그 화면을 열지 못했어요. 다시 시도해 주세요.'));
      });
    }
    slot.replaceChildren(...(box ? [box] : []));
  }).catch(() => { if (dayContext === read) dayContext = {key:'', p:null, entries:[]}; });
}
// 달력에서 일정이 바뀌면(kptu:calendar-changed) 열린 날의 맥락을 다시 읽는다(diary-context.js forgetEvents로 주 단위 일정 기억을 비운다).
window.addEventListener('kptu:calendar-changed', () => {
  if (!dayContext.p) return;
  dayContext = {key:'', p:null, entries:[]};
  import('./diary-context.js').then(m => {
    m.forgetEvents();
    const slot = selected && detail.querySelector('[data-diary-context-slot]');
    if (slot) paintContext(slot, selected);
  }).catch(() => {});
});
const contextLine = item => (selected && item?.day === selected && dayContext.key === `${owner}|${selected}` ? photoContextLine(item, dayContext.entries) : '');
// ☆를 아직 쓸 수 없을 때의 안내. 원드라이브 준비 전에는 예전 안내 그대로.
// UI-기다림표시통일 2차: 별표를 읽는 동안은 글자 대신 회색 칸(starNoteHtml).
const starNote = () => !od.configured ? '원드라이브 연결 뒤 쓸 수 있어요' : starsState === 'loading' ? '' : '별표를 지금은 쓸 수 없어요';
const starNoteHtml = () => od.configured && starsState === 'loading' ? waitInlineHtml() : esc(starNote());
const itemElement = (item, size, opts) => item.kind === 'od' ? odPhotoElement(item, size, opts) : item.kind === 'phone' ? phone.element(item, size, opts) : photoElement(item.row, item.file, size, opts);
// S46-20 사진 정리 ⑥: 그날 폰 사진(폰 앱에서만, 사진 메뉴 출처 '폰 사진'이 켜졌을 때). 그날 끝 시각부터 거꾸로 한 쪽만 읽어 그날 것만 남긴다.
// 끈 폰 폴더는 빼고, 원드라이브에 같은 사진이 있으면 원드라이브 것만 보인다. 목록·그림은 이 화면 메모리에만 있다.
const phone = phonePhotos();
let phoneDay = {day:'', items:[], state:'idle'};
const phoneOnHere = () => phone.usable && readDeviceSources().phone;
async function loadPhoneDay(day) {
  if (phoneDay.day === day && phoneDay.state !== 'idle') return;
  if (!phoneOnHere()) { phoneDay = {day, items:[], state:'off'}; return; }
  phoneDay = {day, items:[], state:'loading'};
  try {
    const s = await phone.hello();
    if (phoneDay.day !== day) return;
    if (s.access === 'none' || !s.key) { phoneDay = {day, items:[], state:'off'}; return; }
    const page = await phone.page({sort:'taken_desc', filter:'all', before:dayEndMs(day), limit:200, hide:await phoneHideList(phone)});
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
    const inDiary = inDiaryPhoto(item, row);
    button.setAttribute('aria-label', `사진 ${i + 1} 크게 보기${inDiary ? ', 일기에 넣은 사진' : ''}${isStarred(item) ? ', 별표' : ''}`);
    button.append(itemElement(item, 'small', {label:'', link:false}));
    if (inDiary) { const inMark = document.createElement('span'); inMark.className = 'diary-in-mark'; inMark.setAttribute('aria-hidden', 'true'); inMark.textContent = '일기'; button.append(inMark); }
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
    button.setAttribute('aria-label', `사진 ${i + 1} 크게 보기${inDiaryPhoto(item, rows.get(selected)) ? ', 일기에 넣은 사진' : ''}${on ? ', 별표' : ''}`);
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
    caption:item => [item.kind === 'upload' ? (photoComments(item.row)[item.file.drive_file_id] || '') : '', contextLine(item)].filter(Boolean).join(' · '),
    info:item => [['찍은 때', whenText(item)], ['파일', item.kind === 'upload' ? (item.file?.file_name || '') : item.name], ['출처', item.kind === 'od' ? '원드라이브' : item.kind === 'phone' ? '폰' : '직접 올린 사진']],
    // [원본 내려받기]: 직접 올린 사진은 Drive 원본(Drive 로그인 필요). 원드라이브 사진은 원본을 넘기는 서버 동작이 아직 없어 원드라이브 앱에서 받는다.
    original:item => { const href = item.kind === 'upload' ? originalHref(item.file?.drive_file_id) : ''; return href ? {href} : {text:item.kind === 'phone' ? '폰 갤러리에 있어요' : '원드라이브 앱에서 받아 주세요'}; },
    // PHOTO-전체화면확대: 원드라이브 사진은 확대할 때 원본 해상도(받기 주소, 메모리에만). 직접 올린 사진은 큰 그림 그대로 확대.
    hires:item => (item.kind === 'od' && !item.video ? odMediaUrl(rt, item.id, 'download').then(r => r.url) : item.kind === 'phone' && !item.video ? Promise.resolve(phone.mediaUrl(item) || null) : null),
    isStarred, toggleStar,
    deletable:item => ({ok:item.kind === 'od' && od.canDelete, title:item.kind === 'od' ? (od.canDelete ? '원드라이브 휴지통으로' : '삭제하려면 원드라이브를 다시 연결해 주세요') : item.kind === 'phone' ? '폰 사진은 사진 메뉴에서 삭제해요' : '직접 올린 사진은 일기 [수정]에서 빼요'}),
    take:item => { const t = takeFromMonth(item); if (t) { renderMonth(); renderPhotos(); } return t; },
    restore:p => { if (putBackMonth(p)) { renderMonth(); if (selected === p.day && !edit) renderPhotos(); } },
    commit:async (p, {keepalive}) => {
      try { await odDelete(rt, p.photo.id, {keepalive}); forgetOdPhoto(p.photo.id); }
      catch (error) { if (error?.message === 'onedrive_item_missing') { forgetOdPhoto(p.photo.id); return; } throw error; }
    },
    errorText:error => `삭제하지 못했어요: ${odErrorText(error)}`, onError:diaryStatus,
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
const dirty = () => !!edit && (edit.pending.length > 0 || edit.dropped.length > 0 || textChanged() || commentsChanged());
const EDITOR_LOADING = '\u0000wait'; // UI-기다림표시통일 2차: 편집기를 받는 동안 상태 줄은 글자 없는 회색 칸
// line·onSaved: HOME-하루채우기 ③ [일기 쓰기] — 제안 한 줄을 글 칸에 채워(있던 일기면 그 아래 줄로) 연다. 저장하면 onSaved를 한 번 부른다.
async function openEditor(day, {line = '', onSaved = null} = {}) {
  if (edit) return;
  let row = rows.get(day) || null;
  if (!row && loadedMonth !== monthOf(day)) {
    try { row = await readDiaryDay(day, rt); } catch { row = null; }
  }
  edit = {day, row, pending:[], dropped:[], createdHere:false, pump:null, current:null, waiting:false, discarded:false, keepUploads:false, owner:ownerScope(rt), busy:false, comments:photoComments(row), startComments:photoComments(row),
    host:document.createElement('div'), field:null, baseJson:'', startDoc:diaryStartDoc(row), baseRaw:row ? row.raw_text : null, baseDoc:row ? row.doc ?? null : null, hadRow:!!row};
  edit.host.className = 'diary-doc-host'; edit.host.dataset.diaryText = '';
  // 채운 줄은 '바뀐 글'로 센다(처음 글 = 원래 일기, 채운 줄은 편집기가 뜬 뒤 넣음 — 그대로 [저장]만 눌러도 저장된다).
  if (String(line).trim()) edit.pendingMerge = joinDiaryDocs(edit.startDoc, plainToDocKeep(String(line).trim()));
  edit.onSaved = typeof onSaved === 'function' ? onSaved : null;
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
    const field = await createDocEditor({host:session.host, value:used, label:'일기 글', placeholder:'오늘 있었던 일을 적어 보세요(사진만 남겨도 돼요)', shortcuts:true, lineWidth:true, onBox,
      // S52-21 ④: 글 칸에 붙여 넣거나 끌어 놓은 사진은 글자(파일 이름)가 아니라 일기 사진으로 넣는다(고른 사진과 같은 길).
      onFiles:files => { if (edit === session && !session.busy) void pick(files); }});
    if (edit !== session) { field.destroy(); return; }
    if (session.startDoc !== used) field.setValue(session.startDoc);
    session.field = field; session.baseJson = JSON.stringify(field.getValue());
    if (session.pendingMerge) { field.setValue(session.pendingMerge); session.pendingMerge = null; }
    // Clear only our own loading line: a notice shown meanwhile (e.g. the 20-photo limit) stays.
    if (!session.busy && editor.querySelector('[data-diary-editor-status]')?.dataset.diaryEditorWait === '1') setEditorStatus('');
  } catch { if (edit === session) setEditorStatus('수정 화면을 불러오지 못했어요. 닫고 다시 열어 주세요.'); }
}
function dropField() {
  if (boxLayer) { const layer = boxLayer; boxLayer = null; layer.close(); }
  try { edit?.field?.destroy(); } catch { /* the editor is gone with the panel */ }
}
function renderEditor(message = '') {
  // S52-21: a diary made here only to hold the photos sent right away still reads as a new one (title, no ⋯, date can change).
  const {day} = edit, row = edit.createdHere ? null : edit.row, photos = keptPhotos(), count = photos.length + edit.pending.length;
  editor.hidden = false;
  // UI-버튼통일(2026-10-28 19:16 시안 승인): 위 줄 제목 · [⋯](일기 지우기) · ✕(테두리 없음). 날짜는 달력이 열리는 공용 칸 하나(이름표 없음, app/date-field.js)이고
  // 그 옆에 작은 [📷 사진 0/20]. 글 칸도 이름표 없이 편집기만. 아래 줄은 오른쪽에 [취소](작은 버튼)·[저장](진한 버튼 하나).
  editor.innerHTML = `<div class="diary-panel-head"><h3 id="diaryEditorTitle" tabindex="-1">${row ? '일기 수정' : '일기 쓰기'}</h3><span class="diary-head-ends">${row ? '<span class="diary-head-menu-wrap"><button type="button" class="icon-btn diary-head-more" data-diary-editor-more aria-haspopup="true" aria-expanded="false" aria-controls="diaryEditorMenu" aria-label="일기 관리"><span class="more-dots" aria-hidden="true">⋯</span></button><span id="diaryEditorMenu" class="diary-lv-menu diary-head-menu" role="group" aria-label="일기 관리" data-diary-editor-menu hidden><button type="button" class="diary-menu-danger" data-diary-delete>일기 삭제</button></span></span>' : ''}<button type="button" class="icon-btn" data-diary-editor-close aria-label="일기 창 닫기">×</button></span></div>
<div class="diary-edit-top"><input type="date" data-diary-date value="${esc(day)}" min="2000-01-01" max="2100-12-31" aria-label="일기 날짜"${dateLocked() ? ' disabled' : ''}><input id="diaryPhotoInput" class="a11y-only" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" data-diary-input><button type="button" class="secondary diary-photo-pick" data-diary-pick aria-controls="diaryPhotoInput" aria-label="사진 선택, ${count}장 / 최대 ${DIARY_MAX_PHOTOS}장"${count >= DIARY_MAX_PHOTOS ? ' disabled' : ''}>${iconHtml('camera')} 사진 <span data-diary-count>${count}/${DIARY_MAX_PHOTOS}</span></button></div>
<div class="diary-done" data-diary-done></div>
<div class="diary-thumbs" data-diary-thumbs></div>
<div data-diary-uploads hidden></div>
<div class="diary-doc"><div data-diary-doc-slot></div></div>
<p class="diary-editor-status" data-diary-editor-status role="status" aria-live="polite"></p>
<div class="diary-actions save-row save-row-sticky"><button type="button" class="secondary" data-diary-editor-close>취소</button><button type="button" class="primary" data-diary-save data-enter-save-submit>저장</button></div>`;
  editor.querySelector('[data-diary-doc-slot]').replaceWith(edit.host);
  paintDone(editor.querySelector('[data-diary-done]'), day);
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
    item.append(photoElement(edit.row, file, 'small', {label:`사진 ${i + 1}`}));
    const out = document.createElement('button'); out.type = 'button'; out.className = 'icon-btn'; out.dataset.diaryRemove = file.drive_file_id;
    out.setAttribute('aria-label', `사진 ${i + 1} 빼기`); out.textContent = '×'; item.append(out);
    cell.append(item, commentInput(edit.comments[file.drive_file_id], `사진 ${i + 1}`, 'data-diary-comment', file.drive_file_id)); thumbs.append(cell);
  });
  edit.pending.forEach((entry, i) => {
    const cell = document.createElement('div'); cell.className = 'diary-thumb-cell';
    const item = document.createElement('div'); item.className = 'diary-thumb' + (entry.up ? '' : ' pending'); item.dataset.diaryPending = String(i);
    const img = document.createElement('img'); img.alt = entry.file.name; img.src = entry.url; item.append(img);
    const out = document.createElement('button'); out.type = 'button'; out.className = 'icon-btn'; out.dataset.diaryUnpick = String(i);
    out.setAttribute('aria-label', `${entry.file.name} 선택 취소`); out.textContent = '×'; item.append(out);
    cell.append(item, commentInput(entry.comment, entry.file.name, 'data-diary-pending-comment', String(i))); thumbs.append(cell);
  });
  thumbs.hidden = !count;
  uploadRows?.destroy();
  uploadRows = mountUploadRows(editor.querySelector('[data-diary-uploads]'), {compact:true, has:job => !!edit?.pending.some(entry => entry.file === job.file)});
  paintPendingUploads();
  setEditorStatus(message);
  editor.querySelectorAll('button,input,textarea').forEach(control => { if (edit.busy && !control.matches('[data-diary-editor-close]') && !edit.host.contains(control)) control.disabled = true; });
  edit.host.toggleAttribute('inert', !!edit.busy);
}
const setEditorStatus = message => { const line = editor.querySelector('[data-diary-editor-status]'); if (!line) return; if (message === EDITOR_LOADING) line.innerHTML = waitInlineHtml(); else line.textContent = message; line.dataset.diaryEditorWait = message === EDITOR_LOADING ? '1' : ''; };
// 고른 사진 칸마다 그 사진의 올리기 막대 + %(보내는 동안만).
let uploadRows = null;
function paintPendingUploads() {
  if (!edit || editor.hidden) return;
  // 올라간 사진은 점선(올리기 전 표시)이 빠진다. 날짜는 올리는 동안 잠근다.
  editor.querySelectorAll('[data-diary-pending]').forEach(tile => { const entry = edit.pending[Number(tile.dataset.diaryPending)]; if (!entry) return; tile.classList.toggle('pending', !entry.up); paintUploadOverlay(tile, entry.file); });
  const date = editor.querySelector('[data-diary-date]'); if (date) date.disabled = dateLocked();
}
watchUploads(paintPendingUploads);
function releasePending() { edit?.pending.forEach(entry => URL.revokeObjectURL(entry.url)); }
// ── DIARY-사진바로올리기(S52-21, 요청함 11/07 16:16) ──
// 고른 사진은 고르자마자 올린다. [저장]은 글·코멘트만 쓰고, 아직 올리는 중이면 '사진 1/2 올리는 중 64%'로 무엇을 기다리는지 보인다.
// 보내기는 한 장씩: basket-files는 한 노트의 첨부를 읽은 그대로일 때만 저장하므로(비교 후 저장) 같은 일기에 둘을 동시에 보내면 늦은 쪽이
// 다 보낸 뒤 거절된다. 대신 다음 사진(2장까지)은 앞 사진을 보내는 동안 미리 줄여 둬 차례가 오면 바로 보낸다.
// 고른 사진 칸 entry = {file, url, comment, up:올라간 첨부|null, failed:'실패 이유'|'' , photo:줄이는 중(promise)|null}.
// 새 일기는 첫 사진을 올릴 때 그 날 일기를 먼저 만든다(createdHere — 글 없이 사진만 붙든 상태, 날짜는 아직 바꿀 수 있음).
// 저장하지 않고 닫으면(취소·✕·뒤로가기) 이 창에서 올린 사진을 일기에서 다시 빼고 Drive 원본은 휴지통으로 보낸다(pruneDiaryPhotos).
// 이 창에서 만든 일기면 일기째 지운다(기존 삭제 길 note-delete — 사진은 Drive 휴지통). 다 보낸 뒤 마무리 중인 사진은 서버가 이미
// 받았을 수 있어 끝까지 기다린 뒤 뺀다. 창(탭)을 닫아 버리면 이미 올라간 사진은 그 날 일기에 남는다(떠도는 파일은 없음).
const UPLOAD_AHEAD = 2;
// 이 창에서 올린 사진(아직 고른 칸에 있음)·뺀 사진의 Drive 파일 ID. 위의 '있던 사진' 칸에는 그리지 않는다.
const sessionIds = session => new Set([...session.pending.filter(entry => entry.up).map(entry => entry.up.drive_file_id), ...session.dropped]);
const keptPhotos = (session = edit) => { const mine = sessionIds(session); return diaryPhotos(session.row).filter(file => !mine.has(file.drive_file_id)); };
const dateLocked = () => !!edit && (edit.busy || !!edit.pump || (!!edit.row && !edit.createdHere));
// ── BIZ-저장먼저닫기 3차(S59-18, 요청함 'BIZ-저장먼저닫기' 할 일 4): [저장] 뒤 남은 사진은 창을 닫은 뒤 그 일기로 뒤에서 ──
// 줄은 새로 만들지 않는다: 이 창의 사진 줄(pumpUploads·runUploads — 한 장씩, 다음 사진 미리 줄이기)을 창이 닫힌 뒤에도 그대로 돌린다(session.behind).
// 화면을 옮겨도 끝까지 가고, 멈추는 것은 계정이 바뀔 때뿐(그때는 알리지도 않는다). 사진은 탭 메모리에만 있다. 차례를 기다리는 사진도 처음부터
// '대기' 표시로 만들어(같은 묶음) 하단바 위 한 줄이 '사진 n장 올리는 중 n%'로 끝까지 한 방향으로 간다. 끝은 그 한 줄 하나(announceDock):
// '일기에 사진 2장 올렸어요', 못 올렸으면 '일기에 사진 1장 못 올렸어요' + 까닭 + [다시 올리기](못 올린 것만, 누를 때까지 남음).
// 올라간 사진의 코멘트는 다 올린 뒤 한 번 쓴다(코멘트는 올라간 사진의 Drive ID에 붙으므로). 저장하지 않고 닫은 창과 달리 올린 사진을 다시 빼지 않는다.
const behindSessions = new Set();
window.addEventListener('kptu:before-reload', event => { if (event?.detail && [...behindSessions].some(session => session.pump)) event.detail.otherDraft = true; });
function sendBehind(session, list) {
  session.behind = true; behindSessions.add(session);
  session.note?.close(); session.note = null; session.failNote?.close(); session.failNote = null;
  const group = {sent:0};
  for (const entry of list) {
    entry.failed = ''; entry.behind = true;
    for (const job of uploadJobs()) if (job.file === entry.file && job.phase === 'failed') job.cancel();
    entry.job = trackUpload({file:entry.file, name:entry.file.name, size:entry.file.size, waiting:true, group});
  }
  session.hold = false;
  pumpUploads(session);
}
async function finishBehind(session) {
  if (session.owner !== ownerScope(rt)) { behindSessions.delete(session); return; }
  const done = session.pending.filter(entry => entry.behind && entry.up), left = session.pending.filter(entry => entry.behind && !entry.up);
  let extra = '';
  // 올라간 사진의 코멘트: 그 날 일기를 다시 읽어 그 사진 것만 더한다(다른 코멘트는 그대로).
  const comments = {};
  for (const entry of done) { const line = String(entry.comment ?? '').replace(/\s+/g, ' ').trim(); if (line) comments[entry.up.drive_file_id] = line; }
  try {
    let fresh = done.length ? await readDiaryDay(session.day, rt) : null;
    if (fresh && Object.keys(comments).length) fresh = await saveDiaryComments(fresh, {...photoComments(fresh), ...comments}, rt);
    if (session.owner !== ownerScope(rt)) { behindSessions.delete(session); return; }
    if (fresh) { rows.set(fresh.journal_day, fresh); listDirty = true; if (!edit) { renderMonth(); if (selected === fresh.journal_day) renderDetail(); } }
  } catch { extra = Object.keys(comments).length ? '사진 코멘트는 저장하지 못했어요. 일기를 열어 다시 적어 주세요.' : ''; }
  for (const entry of done) { entry.behind = false; URL.revokeObjectURL(entry.url); }
  session.pending = session.pending.filter(entry => !done.includes(entry));
  const head = `${shortDay(session.day)} 일기에 `;
  if (left.length) {
    const retry = () => { if (session.owner !== ownerScope(rt) || session.pump) return; session.note?.close(); session.note = null; sendBehind(session, session.pending.filter(entry => entry.behind && !entry.up)); };
    for (const entry of left) setUploadRetry(entry.file, retry);
    session.note = announceDock({text:`${head}사진 ${left.length}장 못 올렸어요`, note:[done.length ? `사진 ${done.length}장 올렸어요` : '', left[0].failed, extra].filter(Boolean).join(' · '), error:true, ms:0, files:[...left, ...done].map(entry => entry.file),
      actions:[{label:'다시 올리기', aria:'못 올린 사진 다시 올리기', run:retry}], onClose:why => { if (why === 'closed' && !session.pump) behindSessions.delete(session); }});
    return;
  }
  behindSessions.delete(session);
  const files = done.map(entry => entry.file);
  if (done.length) session.note = announceDock(extra ? {text:`${head}사진 ${done.length}장 올렸어요`, note:extra, error:true, ms:0, files} : {text:`${head}사진 ${done.length}장 올렸어요`, files});
}
function pumpUploads(session = edit) {
  if (!session || session.discarded || session.pump) return session?.pump || null;
  session.pump = (async () => {
    try { await runUploads(session); } catch { /* 한 장의 실패는 그 칸에 남고, 다른 일은 막지 않는다 */ }
    session.pump = null;
    if (session.discarded) await discardUploads(session);
    else if (session.behind && !session.hold) await finishBehind(session);
    else if (edit === session) paintPendingUploads();
  })();
  return session.pump;
}
async function runUploads(session) {
  const alive = () => !session.discarded && session.owner === ownerScope(rt);
  while (alive()) {
    // [저장]이 글을 쓰는 동안은 다음 사진을 보내지 않는다(같은 일기에 두 쓰기가 겹치면 서버가 늦은 쪽을 거절한다). 글이 저장되면 save()가 다시 돌린다.
    if (session.hold) return;
    const queue = session.pending.filter(entry => !entry.up && !entry.failed), entry = queue[0];
    if (!entry) return;
    // 다음 사진은 미리 줄여 둔다(줄이는 동안 실패는 그 사진 차례에 알린다).
    for (const next of queue.slice(0, UPLOAD_AHEAD)) if (!next.photo) { next.photo = shrinkPhoto(next.file); next.photo.catch(() => {}); }
    if (!session.row && !await makeRow(session)) return;
    if (session.hold) return;
    if (!alive() || !session.pending.includes(entry)) continue;
    session.current = entry;
    // 차례가 오면 바로 막대를 보인다(줄이기가 남아 있어도 0%부터). 창을 닫은 뒤 뒤에서 올리는 사진은 미리 만든 '대기' 표시를 쓴다(묶음 %가 끝까지 한 방향).
    const job = entry.job || trackUpload({file:entry.file, name:entry.file.name, size:entry.file.size});
    entry.job = null; job.start?.();
    if (edit === session) paintPendingUploads();
    try {
      const sent = await uploadDiaryPhoto(session.row, entry.photo, {rt, isCurrent:alive, source:entry.file, job});
      session.row = {...session.row, attachments:sent.attachments};
      if (!sent.added) throw Object.assign(new Error(), {code:'note_save_result_unknown'});
      entry.up = sent.added;
    } catch (error) {
      if (error?.code === 'upload_cancelled') { dropEntry(session, entry); continue; }
      if (job.phase === 'sending') job.fail(diaryUploadText(error));
      // 다 보낸 뒤 답을 못 받음: 일기를 다시 읽어 새로 붙은 사진이 하나면 그것이 이 사진이다(한 장씩 보내므로).
      if (error?.code === 'note_save_result_unknown' && alive() && await recoverUpload(session, entry)) { job.cancel(); continue; }
      entry.failed = diaryUploadText(error);
      setUploadRetry(entry.file, () => { if (edit !== session || !session.pending.includes(entry)) return; entry.failed = ''; pumpUploads(session); });
      if (edit === session && !session.busy && !session.behind) tellFailed(session);
    } finally {
      entry.photo = null;
      if (session.current === entry) session.current = null;
      if (edit === session) paintPendingUploads();
    }
  }
}
// UX-알림하나로(S59-21): 창이 열린 채 못 올린 사진도 실패·[다시 올리기]는 아래 한 줄 하나(창 상태 줄에 같은 말을 쓰지 않고, files로 맡겨
// 사진 칸 위 '실패'·올리는 줄의 '실패 [다시]'도 그리지 않는다). 못 올린 사진이 바뀌면(더 못 올림·뺌·다시 올림) 한 줄을 새로 쓴다.
function tellFailed(session) {
  session.failNote?.close(); session.failNote = null;
  const bad = session.pending.filter(entry => entry.failed && !entry.up);
  if (!bad.length || edit !== session || session.behind) return;
  const retry = () => { if (edit !== session || session.behind) return; for (const entry of bad) entry.failed = ''; pumpUploads(session); };
  session.failNote = announceDock({text:`사진 ${bad.length}장 못 올렸어요`, note:bad[0].failed, error:true, ms:0, files:bad.map(entry => entry.file),
    actions:[{label:'다시 올리기', aria:'못 올린 사진 다시 올리기', run:retry}]});
}
async function recoverUpload(session, entry) {
  try {
    const fresh = await readDiaryDay(session.day, rt);
    const known = new Set((session.row?.attachments || []).map(file => file.drive_file_id));
    const added = (fresh?.attachments || []).filter(file => !known.has(file.drive_file_id));
    if (!fresh || fresh.id !== session.row?.id || added.length !== 1) return false;
    session.row = {...session.row, attachments:fresh.attachments}; entry.up = added[0];
    return true;
  } catch { return false; }
}
// 새 일기: 첫 사진 차례에 그 날 일기를 만든다. 그 사이 다른 곳에서 그 날 일기가 생겼으면 그 일기를 열어 거기에 올린다.
async function makeRow(session) {
  try {
    const row = await createDiary({day:session.day}, rt);
    if (session.discarded || session.row) { session.row ||= row; session.createdHere = true; return !session.discarded; }
    session.row = row; session.createdHere = true;
    return true;
  } catch (error) {
    if (error?.code === 'diary_exists') {
      const existing = await readDiaryDay(session.day, rt).catch(() => null);
      if (existing && edit === session && !session.discarded) { adoptExisting(existing, error.message); return true; }
    }
    const message = diaryUploadText(error);
    for (const entry of session.pending) if (!entry.up) entry.failed ||= message;
    for (const entry of session.pending) setUploadRetry(entry.file, () => {});
    if (edit === session && !session.busy) setEditorStatus(`사진을 올릴 일기를 만들지 못했어요. ${message} [저장]을 누르면 다시 올려요.`);
    return false;
  }
}
// ✕(보내는 중 취소)·칸의 [선택 취소]: 그 사진을 고른 칸에서 뺀다. 이미 올라간 사진이면 [저장] 때 일기에서도 뺀다.
function dropEntry(session, entry) {
  const at = session.pending.indexOf(entry);
  if (at < 0) return;
  session.pending.splice(at, 1); URL.revokeObjectURL(entry.url);
  if (entry.up) session.dropped.push(entry.up.drive_file_id);
  for (const job of uploadJobs()) if (job.file === entry.file && (job.phase === 'sending' || job.phase === 'failed')) job.cancel();
  if (entry.failed && session.failNote) tellFailed(session); // 못 올린 사진을 뺐으면 아래 한 줄도 남은 것만
  if (edit === session && !editor.hidden) renderEditor(session.busy ? '저장하는 중…' : '');
}
// 저장하지 않고 닫은 창: 보내는 중인 사진은 멈추고(다 보낸 뒤 마무리 중인 것은 끝까지 기다림), 끝나면 올린 사진을 일기에서 뺀다.
function discardSession(session) {
  session.discarded = true; session.failNote?.close(); session.failNote = null;
  for (const job of uploadJobs()) if (session.pending.some(entry => entry.file === job.file) && (job.phase === 'sending' || job.phase === 'failed')) job.cancel();
  if (!session.pump) void discardUploads(session);
}
async function discardUploads(session) {
  if (session.keepUploads || session.owner !== ownerScope(rt)) return;
  const ids = [...sessionIds(session)];
  if (!session.createdHere && !ids.length) return;
  try {
    if (session.createdHere) {
      // 이 창에서 사진을 붙들려고 만든 일기(글은 아직 저장 전): 일기째 지운다(사진은 Drive 휴지통, 기존 note-delete 길).
      const result = await deleteNoteOriginal(session.row.id, {rt, confirmed:true});
      if (!['deleted', 'missing'].includes(result?.status)) throw new Error('delete');
      if (rows.get(session.day)?.id === session.row.id) { rows.delete(session.day); listDirty = true; renderMonth(); }
      return;
    }
    const fresh = await readDiaryDay(session.day, rt);
    const there = ids.filter(id => (fresh?.attachments || []).some(file => file.drive_file_id === id));
    if (!fresh || !there.length) return;
    const row = await removeDiaryPhotos(fresh, there, rt);
    if (session.owner !== ownerScope(rt)) return;
    rows.set(row.journal_day, row); listDirty = true; renderMonth();
    void pruneDiaryPhotos(there, {rt});
  } catch {
    if (session.owner === ownerScope(rt)) notifySmall(`${shortDay(session.day)} 일기에 올리던 사진을 다시 빼지 못했어요. 일기를 열어 확인해 주세요.`, {error:true});
  }
}
// 뒤로가기(fromBack)는 라우터가 그 자리에서 닫을지 정하므로 브라우저 기본 확인창으로 묻는다. [닫기] 버튼은 askCloseEditor가 작은 확인창으로 묻는다.
const CLOSE_TEXT = '쓰던 일기를 저장하지 않고 닫을까요?';
function closeEditor({fromBack = false, force = false} = {}) {
  if (!edit) return true;
  if (edit.busy) return false;
  if (!force && dirty() && !window.confirm(CLOSE_TEXT)) return false;
  const session = edit;
  releasePending(); dropField(); edit = null; if (!session.behind) discardSession(session); editor.hidden = true; editor.replaceChildren(); listDirty = true;
  cal.hidden = false; renderList(); renderOdPanel(); $('[data-diary-new]').hidden = false; $('.diary-head').hidden = false; status.hidden = false;
  const opened = editLayer; editLayer = null; if (!fromBack) opened?.close();
  if (selected) renderDetail();
  return true;
}
async function askCloseEditor(anchor) {
  if (!edit || edit.busy) return;
  const open = edit;
  if (dirty() && !await askConfirm(anchor, {text:CLOSE_TEXT, ok:'닫기', danger:true})) return;
  // 묻는 동안 저장이 시작됐거나 다른 일기로 바뀌었으면 닫지 않는다.
  if (edit !== open || edit.busy) return;
  closeEditor({force:true});
}
async function pick(files) {
  const open = edit;
  // UPLOAD-올리기안됨: a photo from the phone app can come with an empty type; splitPictures also looks at the name and first bytes.
  const {pictures:images} = await splitPictures(files);
  if (!edit || edit !== open) return;
  const have = keptPhotos().length + edit.pending.length, room = Math.max(0, DIARY_MAX_PHOTOS - have);
  const skipped = files.length - images.length;
  const taken = images.slice(0, room);
  edit.pending.push(...taken.map(file => ({file, url:URL.createObjectURL(file), comment:'', up:null, failed:'', photo:null})));
  const notes = [];
  if (images.length > room) notes.push(`일기 사진은 하루 ${DIARY_MAX_PHOTOS}장까지예요. ${images.length - room}장은 넣지 않았어요.`);
  if (skipped) notes.push(`사진이 아닌 파일 ${skipped}개는 넣지 않았어요.`);
  renderEditor(notes.join(' '));
  // S52-21: 고르자마자 올린다.
  if (taken.length) pumpUploads(edit);
}
async function changeDay(day) {
  if (edit?.createdHere && day) return moveMadeDay(day);
  if (!edit || edit.row || !day) return;
  edit.day = day;
  paintDone(editor.querySelector('[data-diary-done]'), day);
  let existing = rows.get(day) || null;
  if (!existing) { try { existing = await readDiaryDay(day, rt); } catch { existing = null; } }
  if (!edit || edit.day !== day) return;
  if (existing) adoptExisting(existing, '이 날 일기가 이미 있어 수정으로 열었어요.');
}
// S52-21: 이 창에서 사진을 붙들려고 만든 일기는 고른 날짜를 따라간다(그 날 일기가 이미 있으면 바꾸지 않음).
async function moveMadeDay(day) {
  const session = edit, input = editor.querySelector('[data-diary-date]');
  if (day === session.day) return;
  const back = message => { if (edit !== session) return; if (input) input.value = session.day; setEditorStatus(message); };
  if (session.pump || session.busy) return back('사진을 다 올린 뒤 날짜를 바꿔 주세요.');
  try {
    const fresh = await readDiaryDay(session.day, rt);
    if (!fresh || fresh.id !== session.row.id) throw new Error('일기를 다시 불러오지 못했어요. 닫고 다시 열어 주세요.');
    const moved = await moveDiaryDay(fresh, day, rt);
    if (edit !== session) return;
    session.row = moved; session.day = moved.journal_day;
    paintDone(editor.querySelector('[data-diary-done]'), session.day); setEditorStatus('');
  } catch (error) { back(error?.message && !error.status ? error.message : '날짜를 바꾸지 못했어요. 다시 시도해 주세요.'); }
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
  if (!edit.field) { const session = edit; await session.mounting; if (edit !== session || !edit.field) return edit && setEditorStatus('수정 화면을 불러오지 못했어요. 닫고 다시 열어 주세요.'); }
  const text = edit.field.getText(), value = edit.field.getValue(), changed = textChanged();
  try { validateDiaryText(text); const bad = diaryDocError(diaryDocToStore(value, text)); if (bad) throw new Error(bad); cleanComments(edit.comments, keptPhotos()); edit.pending.forEach(entry => cleanComments({x:entry.comment}, [{drive_file_id:'x'}])); } catch (error) { return setEditorStatus(error.message); }
  if (!text.trim() && !edit.pending.length && !keptPhotos().length) return setEditorStatus('사진이나 글을 넣어 주세요.');
  const session = edit, run = owner, mine = () => run === ownerScope(rt) && edit === session;
  session.busy = true;
  try {
    // BIZ-저장먼저닫기 3차(S59-18): 사진은 고를 때 이미 올라가고 있다. [저장]은 남은 사진을 다 기다리지 않는다 — 지금 보내는 한 장만
    // 끝나기를 기다리고(같은 일기에 두 쓰기가 겹치면 서버가 늦은 쪽을 거절한다) 다음 사진은 멈춘 채 글·코멘트를 저장한다. 저장되면 창을 닫고
    // 남은 사진(못 올린 것은 한 번 더)은 그 일기로 뒤에서 이어 올린다(sendBehind). 글 저장이 실패하면 창은 그대로이고 사진은 창에서 이어 올린다.
    session.hold = true;
    renderEditor('저장하는 중…');
    if (session.pump) { await session.pump; if (!mine()) return; }
    const day = session.day;
    let created = session.createdHere;
    if (!session.row) {
      try { session.row = await createDiary({day, text, doc:value}, rt); created = true; }
      catch (error) {
        if (error?.code !== 'diary_exists') throw error;
        const existing = await readDiaryDay(day, rt);
        session.busy = false; session.hold = false;
        if (existing && mine()) { adoptExisting(existing, error.message); pumpUploads(session); return; }
        throw error;
      }
    }
    let fresh = await readDiaryDay(day, rt);
    if (!mine()) return;
    // 올렸다가 ✕로 뺀 사진은 이제 일기에서도 뺀다(Drive 원본은 휴지통으로).
    const out = session.dropped.filter(id => (fresh?.attachments || []).some(file => file.drive_file_id === id));
    if (fresh && out.length) {
      const left = (fresh.attachments || []).filter(file => !out.includes(file.drive_file_id));
      if (!left.length && !text.trim() && created) { await deleteNoteOriginal(fresh.id, {rt, confirmed:true}); fresh = null; session.row = null; }
      else fresh = await removeDiaryPhotos(fresh, out, rt);
      void pruneDiaryPhotos(out, {rt});
    }
    session.dropped = [];
    if (!mine()) return;
    const comments = {...cleanLive()};
    for (const entry of session.pending) { const line = String(entry.comment ?? '').replace(/\s+/g, ' ').trim(); if (entry.up && line) comments[entry.up.drive_file_id] = line; }
    const desired = text.trim() ? text : '';
    if (fresh && created && !fresh.attachments?.length && !desired && !session.pending.some(entry => !entry.up)) {
      // Nothing could be attached to a photo-only day: remove the empty row again (사진이 아직 뒤에서 올라갈 차례면 그 일기에 붙이므로 남긴다).
      await dropEmptyDiary(fresh, rt).catch(() => {});
      fresh = null; session.row = null;
    } else if (fresh && (created ? fresh.raw_text !== desired : changed) && (desired || fresh.attachments?.length)) {
      // A diary that was there when the editor opened is written only while its text is still what the editor opened: a diary changed on
      // another device is refused, nothing is overwritten (the phone shows the newer one after closing).
      if (!created && session.hadRow && (fresh.raw_text !== session.baseRaw || JSON.stringify(fresh.doc ?? null) !== JSON.stringify(session.baseDoc ?? null))) {
        rows.set(day, fresh);
        throw Object.assign(new Error('일기 글이 그사이 다른 곳에서 바뀌었어요. 쓴 글을 복사해 두고, 닫았다가 다시 열어 확인해 주세요.'), {code:'note_changed'});
      }
      fresh = await saveDiaryText(fresh, text, rt, {doc:value, strict:true});
    }
    if (fresh) fresh = await saveDiaryComments(fresh, comments, rt);
    if (!mine()) return;
    // 올라간 사진은 이제 일기의 사진이다(창을 닫아도 빼지 않음). 못 올린 사진만 고른 칸에 남는다.
    session.pending = session.pending.filter(entry => { if (!entry.up) return true; URL.revokeObjectURL(entry.url); return false; });
    session.createdHere = false;
    if (fresh) { rows.set(day, fresh); session.row = fresh; session.baseRaw = fresh.raw_text; session.baseDoc = fresh.doc ?? null; session.hadRow = true; session.baseJson = JSON.stringify(value); session.comments = photoComments(fresh); session.startComments = photoComments(fresh); } else rows.delete(day);
    session.busy = false;
    if (session.onSaved && text.trim()) { const done = session.onSaved; session.onSaved = null; try { done(); } catch { /* 제안 지우기는 다음에 */ } }
    // 아직 올라가지 않은 사진(못 올린 것 포함)은 창을 닫은 뒤 그 일기로 뒤에서 이어 올린다.
    const left = session.pending.filter(entry => !entry.up);
    if (left.length) sendBehind(session, left); else session.hold = false;
    closeEditor({force:true});
    if (monthOf(day) === monthKey()) { renderMonth(); selectDay(day); }
    else { const [y, m] = day.split('-').map(Number); cursor = {year:y, month:m - 1}; loadedMonth = ''; await loadMonth(); selectDay(day); }
    status.textContent = '일기를 저장했어요.';
  } catch (error) {
    session.hold = false;
    if (edit !== session) return;
    session.busy = false;
    pumpUploads(session);
    renderEditor(error?.status === 401 ? '로그인이 필요해요. 다시 로그인한 뒤 저장해 주세요.' : error?.message && !error.status ? error.message : '일기를 저장하지 못했어요. 다시 시도해 주세요.');
  }
}
const pruneNote = pruned => !pruned ? '사진을 뺐어요. Drive 원본은 나중에 정리해요.'
  : pruned.trashed ? '사진을 뺐어요. Drive 원본은 휴지통으로 보냈어요.'
  : pruned.kept ? '사진을 뺐어요. 다른 기록이 같은 파일을 쓰고 있어 Drive 원본은 남겨요.' : '사진을 뺐어요. Drive 원본은 나중에 정리해요.';
async function removePhoto(fileId, anchor) {
  if (!edit?.row || edit.busy) return;
  const open = edit, day = edit.row;
  if (!await askConfirm(anchor, {text:'이 사진을 일기에서 뺄까요?', note:'Drive 원본은 휴지통으로 보내요(30일 안에 복구 가능).', ok:'빼기', danger:true})) return;
  if (edit !== open || edit.row !== day || edit.busy) return;
  edit.busy = true; renderEditor('사진을 빼는 중…');
  let row;
  try {
    // S52-21: 고른 사진을 올리는 중이면 다 올린 뒤 뺀다(같은 일기에 두 쓰기가 겹치지 않게). 올린 뒤라 일기를 다시 읽어 쓴다.
    while (open.pump) await open.pump;
    if (edit !== open) return;
    const fresh = open.pending.some(entry => entry.up) || open.dropped.length ? await readDiaryDay(open.day, rt) : open.row;
    if (edit !== open) return;
    if (!fresh) throw new Error('일기를 다시 불러오지 못했어요. 닫고 다시 열어 주세요.');
    row = await removeDiaryPhoto(fresh, fileId, rt);
  } catch (error) {
    edit.busy = false; return renderEditor(error?.message && !error.status ? error.message : '사진을 빼지 못했어요. 다시 시도해 주세요.');
  }
  if (edit !== open) return;
  if (!open.createdHere) rows.set(row.journal_day, row);
  edit.row = row;
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
const DIARY_DELETED = '일기를 삭제했어요.';
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
  notifySmall(`${shortDay(job.row.journal_day)} 일기를 삭제하지 못해 되살렸어요. ${String(result.message || '').replace(/업데이트/g, '일기')}`.trim(), {error:true});
}
// [⋯] 작은 목록: 쓰기 창 머리줄 안에 붙어 열린다. 바깥을 누르거나 Esc면 닫힌다.
// S47-18: 열려 있을 때 뒤로가기 = 메뉴만 닫기(공용 작은 메뉴 겹 KPTUMenuLayer, details-menu-back.js). 쓰기 창은 그대로.
// UI-우클릭빈곳전수 ①: 일기 상세 전체의 ⋯(data-ctx="area") — PC 우클릭은 공용 context-menu.js가 이 메뉴를 커서 자리에 연다.
// 항목은 아래 단추와 같은 일([수정]·[그날 사진 크게 보기]·[일기 삭제]); 아래 [수정][일기 삭제] 단추는 그대로 둔다.
function detailMenuHtml() {
  return `<span class="diary-head-menu-wrap"><button type="button" class="icon-btn diary-head-more" data-diary-head-more data-ctx="area" aria-haspopup="true" aria-expanded="false" aria-controls="diaryDetailMenu" aria-label="이 날 일기 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button><span id="diaryDetailMenu" class="diary-lv-menu diary-head-menu" role="group" aria-label="이 날 일기 메뉴" data-diary-head-menu hidden></span></span>`;
}
// 메뉴 항목은 버튼 6가지 모양이 아니라 작은 메뉴(diary-lv-menu) 줄 모양이라 이름표 없이 만든다(쓰기 창 머리줄 메뉴와 같은 모양).
function fillDetailMenu(row, hasPhotos) {
  const menu = detail.querySelector('[data-diary-head-menu]'); if (!menu) return;
  const item = (label, mark, danger = false) => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute(mark, ''); if (danger) b.className = 'diary-menu-danger'; b.textContent = label; return b; };
  menu.replaceChildren(item(row ? '수정' : '일기 쓰기', 'data-diary-menu-edit'), ...(hasPhotos ? [item('그날 사진 크게 보기', 'data-diary-view-photos')] : []), ...(row ? [item('일기 삭제', 'data-diary-menu-delete', true)] : []));
}
const HEAD_MENU = '[data-diary-editor-menu],[data-diary-head-menu]';
function toggleEditorMenu(button, open = !button.nextElementSibling || button.nextElementSibling.hidden) {
  const menu = button.nextElementSibling;
  if (!menu?.matches?.(HEAD_MENU)) return;
  menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
  if (open) { menu.querySelector('button')?.focus({preventScroll:true}); window.KPTUMenuLayer?.opened(menu, () => toggleEditorMenu(button, false)); }
  else window.KPTUMenuLayer?.closed(menu);
}
const openHeadMenu = () => editor?.querySelector?.('[data-diary-editor-menu]:not([hidden])') || detail?.querySelector?.('[data-diary-head-menu]:not([hidden])');
document.addEventListener('click', event => {
  const open = openHeadMenu();
  if (open && !open.parentElement.contains(event.target)) toggleEditorMenu(open.previousElementSibling, false);
}, true);
document.addEventListener('keydown', event => {
  const open = openHeadMenu();
  if (open && event.key === 'Escape') { event.preventDefault(); toggleEditorMenu(open.previousElementSibling, false); open.previousElementSibling?.focus({preventScroll:true}); }
});
async function removeDiary(row) {
  if (!row || edit?.busy) return;
  if (pendingDelete) await commitDiaryDelete(pendingDelete);
  const day = row.journal_day;
  rows.delete(day); listView.dropDay(day); listDirty = true;
  // S52-21: 이 창에서 올린 사진은 일기와 함께 지운다(따로 빼는 쓰기가 지우기와 겹치지 않게). [되돌리기]면 일기에 남는다.
  if (edit) { edit.keepUploads = true; closeEditor({force:true}); }
  closeDetail(); renderMonth();
  const job = {row, owner:ownerScope(rt), done:false, undone:false};
  pendingDelete = job;
  const box = offerUndoNotice({text:`${shortDay(day)} ${DIARY_DELETED}`, onUndo:async () => {
    if (job.done) return {status:'failed', message:'이미 삭제돼 되돌리지 못했어요.'};
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
  // 머리줄 ⋯ 메뉴의 항목을 고르면 메뉴부터 닫고 그 일을 한다.
  const headMenu = button.closest(HEAD_MENU); if (headMenu && !headMenu.hidden) toggleEditorMenu(headMenu.previousElementSibling, false);
  if (button.matches('[data-diary-view-photos]')) { if (shown.length) openViewer(0); return; }
  if (button.matches('[data-diary-menu-edit]')) return openEditor(selected);
  if (button.matches('[data-diary-menu-delete]')) return removeDiary(rows.get(selected));
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
  if (button.matches('[data-diary-editor-more],[data-diary-head-more]')) return toggleEditorMenu(button);
  if (button.matches('[data-diary-delete]')) return removeDiary(edit ? edit.row : rows.get(selected));
  if (button.matches('[data-diary-editor-close]')) return askCloseEditor(button);
  if (button.matches('[data-diary-pick]')) return editor.querySelector('[data-diary-input]')?.click();
  if (button.matches('[data-diary-unpick]')) { const entry = edit.pending[Number(button.dataset.diaryUnpick)]; if (entry && !edit.busy) dropEntry(edit, entry); return; }
  if (button.matches('[data-diary-remove]')) return removePhoto(button.dataset.diaryRemove, button);
  if (button.matches('[data-diary-save]')) return save();
});
root.addEventListener('input', event => {
  if (!edit) return;
  if (event.target.matches('[data-diary-comment]')) edit.comments[event.target.dataset.diaryComment] = event.target.value;
  else if (event.target.matches('[data-diary-pending-comment]')) { const entry = edit.pending[Number(event.target.dataset.diaryPendingComment)]; if (entry) entry.comment = event.target.value; }
});
root.addEventListener('change', event => {
  if (event.target.matches('[data-diary-input]')) { const files = [...event.target.files || []]; event.target.value = ''; if (files.length && edit) void pick(files); }
  if (event.target.matches('[data-diary-date]')) changeDay(event.target.value);
});

window.addEventListener('kptu:before-view-change', event => {
  if (window.KPTURouter?.current !== 'diary' || event.detail?.view === 'diary' || !edit) return;
  // 라우터가 이 자리에서 막을지 정하므로 브라우저 기본 확인창으로 묻는다(작은 확인창은 기다려야 해서 쓸 수 없음).
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
  editLayer = null; dayLayer = null; selected = null; sendWhere(null); detail.hidden = true; rows = new Map(); loadedMonth = ''; doneMonth = {key:'', days:new Map()}; chosenView = null; lastListDay = null; listView.hide(); listView.reset(); renderMonth();
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
    const write = takeRequestedWrite(day, rt);
    const [y, m] = day.split('-').map(Number);
    if (y !== cursor.year || m - 1 !== cursor.month) { cursor = {year:y, month:m - 1}; closeDetail(); }
    loadMonth().then(() => { selectDay(day, {focus:true}); if (write) void openEditor(day, {line:write.line, onSaved:write.onSaved}); });
    return;
  }
  writePlace(); loadMonth({quiet:true});
}
window.KPTURouter?.on?.('diary', enter);
window.KPTUDiary = {refresh:() => loadMonth({force:true})};
if (window.KPTURouter?.current === 'diary') enter();
})();
