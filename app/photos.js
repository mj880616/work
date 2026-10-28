import {waitHtml, failHtml} from './wait-state.js';
// PHOTO-사진메뉴(docs/design/photo-menu.md, 시안 photo-menu-mock.html): '사진' 메뉴(?view=photos). #photosView의 유일한 그리기 주인.
// 원드라이브 사진·동영상 색인(Edge onedrive-photos, PR 1410: library·months·days·media-url·photo-delete·trash-*)을 읽어 갤러리처럼 보여 준다.
// - 위 칩 줄: [사진] [달력] [휴지통] · 오른쪽 끝 거르기(전체·★·동영상·스크린샷)·[－][＋]·원드라이브 아이콘(od-link.js).
//   거르기·칸 수는 서버 view_prefs.photo_view(명진 결정 6, 일기 칸 수와 따로). 칸 수는 폰 3~6·PC 5~12.
// - [사진]: 최신순 격자 120장씩(library cursor) + 날짜 머리줄. 오른쪽 끝 얇은 막대(months)를 끌면 달 말풍선 '2026.09', 놓으면 그 달로.
// - [달력]: 날마다 대표 사진·장수(days). 칸을 누르면 [사진]의 그날부터.
// - [휴지통](명진 결정 1): Web2에서 지운 사진('.Web2 휴지통' 폴더). 고르면 [되살리기]·[바로 지우기], 위 줄 [모두 비우기].
// - 크게 보기: 일기와 같은 공용 부품 photo-strip.js. 동영상은 ▶로 재생(media-url play, 주소는 메모리에만), [ⓘ] 판 [⤓ 원본 받기](media-url download).
// - 여러 장 고르기: 길게 누르기(0.5초)로 시작, 고른 뒤 좌우로 끌면 여러 칸(화면 끝 자동 스크롤). 아래 [☆ 별표] [⇪ 공유] [⤓ 받기] [🗑 지우기].
//   지우기는 묻지 않고 바로 빠지고 [되돌리기] 5초(명진 결정 7), 그 뒤 한 번에(ids ≤ 50) Web2 휴지통으로.
// - 원드라이브 설정 창(폴더 바꾸기·하위 폴더·연결 끊기)은 일기와 같은 공용 부품 od-settings.js로 이 화면 안에서 연다(결정 4). 연결 뒤에는 이 화면으로 돌아온다(결정 5).
// 별표는 app_diary_stars(일기 ★와 같은 것). 저장은 모두 서버(기기 저장 없음, 썸네일 사본은 기존 od-thumb-cache.js만).
import {odStatusCached, odPhotoElement, odDelete, odDeleteMany, forgetOdPhoto, odErrorText, odSync, odSyncDelay, odLibrary, odMonths, odDays, odMediaUrl,
  odTrashList, odTrashRestore, odTrashPurge, odPhotoBlob, readOdStars, addStar, removeStar, starKey, takenLabel, takeOdReturn} from './diary-onedrive.js';
import {ownerScope} from './diary-data.js';
import {seoulParts} from './meeting-time.js';
import {SIZE_BUTTONS, WIDE_QUERY, createGridSizer} from './photo-grid-size.js';
import {openPhotoStrip, closePhotoStrip, photoStripOpen, photoStripNote, photoStripRefresh} from './photo-strip.js';
import {UNDO_MS, shareFileName} from './photo-viewer-model.mjs';
import {photoFile} from './photo-share.js';
import {odLinkButtonHtml, paintOdLink, createOdLinkMenu} from './od-link.js';
import {createOdSettings} from './od-settings.js';
import {createSelectMode} from './select-mode.js';
import {notify, askConfirm} from './small-notice.js';
import {viewPrefs} from './view-prefs.js';
import {SELECT_MAX, PAGE_SIZE, STAR_CHUNK, FILTER_TEXT, DOWNLOAD_MAX, SHARE_MAX, validTab, validFilter, monthKey, prevMonth, nextMonth, groupByDay, dayHead, starPlan,
  colsFor, stepPhotoCols, parsePhotoView, toItem, appendItems, newestFirst, durationLabel, monthBar, monthAt, monthCursor, dayCursor, calendarFromDays, chunks, dragRange,
  takeItems, putItems} from './photos-model.mjs';

(() => {
if (window.KPTUPhotos) return;
const rt = window.KPTURuntime;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOLD_MS = 500, HOLD_MOVE = 10, DRAG_START = 12, EDGE = 56;

function install() {
  if (document.getElementById('photosView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="photosView" class="view-panel view-wide hidden" aria-label="사진"><div id="photosRoot" class="photos"></div></section>');
}
install();
const root = document.getElementById('photosRoot');
if (!root) return;
const filterOptions = Object.entries(FILTER_TEXT).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
root.innerHTML = `<div class="photos-bar" data-photos-bar><div class="photos-chips" role="group" aria-label="사진 보기"><button type="button" class="photos-chip" data-photos-tab="all" aria-pressed="true">사진</button><button type="button" class="photos-chip" data-photos-tab="calendar" aria-pressed="false">달력</button><button type="button" class="photos-chip" data-photos-tab="trash" aria-pressed="false">휴지통</button></div><span class="photos-sp"></span><select class="photos-filter" data-photos-filter aria-label="거르기">${filterOptions}</select>${SIZE_BUTTONS}${odLinkButtonHtml()}</div><div class="photos-sel" data-photos-sel hidden><button type="button" class="photos-sel-x" data-photos-sel-off aria-label="선택 끝내기">✕</button><span data-photos-sel-count>0개 골랐음</span></div><p class="photos-note" data-photos-note role="status"></p><div class="photos-od" data-photos-od></div><div class="photos-body" data-photos-body></div><div class="photos-rail" data-photos-rail role="slider" tabindex="0" aria-label="달 빠른 이동" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="" hidden><span class="photos-rail-thumb" data-photos-rail-thumb></span><span class="photos-rail-bubble" data-photos-rail-bubble hidden></span></div><div class="photos-act" data-photos-act role="group" aria-label="고른 사진" hidden><button type="button" data-photos-act-star><span aria-hidden="true">☆</span> 별표</button><button type="button" data-photos-act-share hidden><span aria-hidden="true">⇪</span> 공유</button><button type="button" data-photos-act-down><span aria-hidden="true">⤓</span> 받기</button><button type="button" class="photos-danger" data-photos-act-delete><span aria-hidden="true">🗑</span> 지우기</button></div><div class="photos-act" data-photos-trash-act role="group" aria-label="고른 휴지통 사진" hidden><button type="button" data-photos-restore><span aria-hidden="true">↺</span> 되살리기</button><button type="button" class="photos-danger" data-photos-purge><span aria-hidden="true">🗑</span> 바로 지우기</button></div>`;
const $ = sel => root.querySelector(sel);
const body = $('[data-photos-body]'), noteEl = $('[data-photos-note]'), linkBtn = $('[data-od-link]'), odHost = $('[data-photos-od]');
const rail = $('[data-photos-rail]'), bubble = $('[data-photos-rail-bubble]'), thumb = $('[data-photos-rail-thumb]');

const OD_NONE = {configured:false, connected:false, folder:null, canDelete:false};
let owner = ownerScope(rt), run = 0;
let od = {...OD_NONE}, odFault = false, odReady = false, odMessage = '';
let tab = 'all', filter = 'all', colsSaved = null, prefsRead = false;
// [사진] 목록: items(최신순), next(다음 쪽 cursor), from(막대·달력으로 건너뛴 시작 {cursor, label} 또는 null = 최신부터).
let items = [], next = null, ended = false, loading = null, failed = '', from = null, rendered = 0;
let bar = [], monthsFor = '', calCursor = null, calData = new Map(), tabLayer = null, syncing = false, syncDone = false;
let trash = null, trashFailed = '', trashBusy = false;
const starSet = new Set(), starDay = new Map(), starBusy = new Set();
let starsReady = null;
const isStarred = item => starSet.has(starKey(item.source, item.key));
const select = createSelectMode({layer:'photos-select', onBack:() => paintSelect()});
const thisMonth = () => { const p = seoulParts(new Date()); return {year:p.year, month:p.month}; };
const current = r => r === run && owner === ownerScope(rt);
const note = text => { noteEl.textContent = text || ''; };
const ready = () => odReady && od.connected && !!od.folder;

// ---- 칸 수(view_prefs.photo_view.cols, 일기와 따로) ----
function readPrefs() {
  if (prefsRead) return;
  prefsRead = true;
  const v = parsePhotoView(viewPrefs.get('photo_view'));
  filter = v.filter; colsSaved = v.cols;
  $('[data-photos-filter]').value = filter;
}
const savePrefs = () => viewPrefs.set('photo_view', {filter, ...(colsSaved ? {cols:colsSaved} : {})}, {rejectable:true});
const sizer = createGridSizer({current:wide => colsFor(wide, colsSaved), step:stepPhotoCols, save:(wide, n) => { colsSaved = n; savePrefs(); }});

// ---- 서버 읽기 ----
async function ensureOd(force = false) {
  try {
    od = {...OD_NONE, ...(await odStatusCached(rt, {force}))};
  } catch { od = {...OD_NONE, failed:true}; }
  odReady = true; paintOdLink(linkBtn, od, odFault);
  return od;
}
// 원드라이브 별표 전체(★ 거르기·별표 표시). 접속마다 한 번.
function ensureStars(r) {
  starsReady ||= readOdStars(rt).then(rows => {
    if (!current(r)) return;
    for (const s of rows) { const k = starKey('onedrive', s.item_key); starSet.add(k); starDay.set(s.item_key, String(s.taken_day || '')); }
  }, () => {});
  return starsReady;
}
const starIds = () => [...starSet].map(k => k.slice('onedrive:'.length));
// 원드라이브에서 바뀐 것을 서버 색인에 이어 받는다(일기와 같은 서버 동작 'sync', 이 접속에서 한 번). 새로 받은 것이 있으면 처음부터 다시 그린다.
async function startSync(r) {
  if (syncing || syncDone || !ready()) return;
  syncing = true;
  let saw = false;
  try {
    for (let i = 0; i < 500 && current(r); i++) {
      let step;
      try { step = await odSync(rt); }
      catch (error) { const wait = odSyncDelay(error); if (wait === null) throw error; saw = true; await new Promise(ok => setTimeout(ok, wait)); continue; }
      if (step.more || step.indexing) { if (!saw && current(r)) note('사진 목록 받는 중…'); saw = true; }
      if (!step.more) { syncDone = true; break; }
    }
    if (current(r) && saw) { note(''); resetList(); render(); }
  } catch (error) { if (current(r)) note(`사진 목록을 다 받지 못했어요: ${odErrorText(error)}`); }
  finally { syncing = false; }
}
// 다음 쪽. ★는 별표 id(500개씩)로 모두 받아 최신순으로 합친다(별표는 많지 않다).
function loadMore() {
  if (loading || ended || !ready()) return loading;
  const r = run;
  loading = (async () => {
    try {
      if (filter === 'star') {
        await ensureStars(r);
        const all = [];
        for (const ids of chunks(starIds(), STAR_CHUNK)) {
          let cursor = from?.cursor || null;
          for (let guard = 0; guard < 50; guard++) {
            const page = await odLibrary(rt, {filter:'star', starIds:ids, cursor, limit:200});
            if (!current(r)) return;
            all.push(...page.items); cursor = page.next;
            if (!cursor) break;
          }
        }
        items = appendItems(items, all.map(toItem).sort(newestFirst)); ended = true;
      } else {
        const page = await odLibrary(rt, {filter, cursor:next || from?.cursor || null, limit:PAGE_SIZE});
        if (!current(r)) return;
        items = appendItems(items, page.items.map(toItem)); next = page.next; ended = !page.next;
      }
      failed = '';
    } catch (error) {
      if (!current(r)) return;
      failed = odErrorText(error); odFault = true; paintOdLink(linkBtn, od, odFault);
    } finally { if (current(r)) loading = null; }
    if (current(r) && tab === 'all') { paintList(); loadBar(r); }
  })();
  return loading;
}
// 빠른 이동 막대의 달 눈금(거르기마다 한 번).
async function loadBar(r) {
  const want = filter;
  if (monthsFor === want) return;
  monthsFor = want;
  try {
    if (want === 'star') await ensureStars(r);
    const ids = want === 'star' ? starIds() : null;
    if (ids && (!ids.length || ids.length > STAR_CHUNK)) { bar = []; paintRail(); return; }
    const d = await odMonths(rt, {filter:want, starIds:ids});
    if (!current(r) || filter !== want) return;
    bar = monthBar(d.months); paintRail();
  } catch { if (current(r) && filter === want) { monthsFor = ''; bar = []; paintRail(); } }
}

// ---- 그리기 ----
function gate() {
  if (!odReady) return waitHtml({rows:4, h:72});
  if (od.failed) return '<p class="photos-muted">원드라이브 상태를 읽지 못했어요. <button type="button" class="mini" data-photos-retry>다시</button></p>';
  if (!od.configured || !od.connected) return `<p class="photos-muted">원드라이브 연결 뒤 쓸 수 있어요${od.configured ? ' <button type="button" class="mini" data-photos-connect>연결</button>' : ''}</p>`;
  if (!od.folder) return '<p class="photos-muted">사진을 읽을 폴더를 고른 뒤 쓸 수 있어요 <button type="button" class="mini" data-photos-folder>폴더 고르기</button></p>';
  return '';
}
function cell(item, i) {
  const on = isStarred(item);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'diary-grid-item'; b.dataset.photosOpen = String(i); b.dataset.photosId = item.id;
  b.setAttribute('aria-label', `${dayHead(item.day)} ${item.video ? '동영상' : '사진'}${on ? ', 별표' : ''}`);
  b.append(odPhotoElement(item, 'small', {label:'', rt}));
  const mark = document.createElement('span'); mark.className = 'diary-star-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '★'; mark.hidden = !on;
  const pick = document.createElement('span'); pick.className = 'photos-pick'; pick.setAttribute('aria-hidden', 'true');
  b.append(mark, pick);
  if (item.video) b.append(Object.assign(document.createElement('span'), {className:'photos-dur', textContent:`▶${durationLabel(item.duration_ms) ? ' ' + durationLabel(item.duration_ms) : ''}`}));
  return b;
}
function newGrid() {
  const grid = document.createElement('div');
  grid.className = 'diary-grid photos-grid'; grid.dataset.diaryGrid = '';
  sizer.paintGrid(grid); sizer.attachPinch(grid, sizeChanged);
  return grid;
}
function dayHeadEl(day, n) {
  const head = document.createElement('div');
  head.className = 'photos-day'; head.dataset.photosDay = day;
  head.innerHTML = `<b>${esc(dayHead(day))}</b><span data-photos-day-n>· ${n}장</span><button type="button" class="photos-day-pick" data-photos-day-pick="${esc(day)}" aria-label="${esc(dayHead(day))} 모두 고르기" hidden></button>`;
  return head;
}
// [사진] 목록 그리기. 처음이거나 목록이 줄었으면 통째로, 늘었으면 뒤에 이어 붙인다(받은 그림 그대로).
function paintList({full = false} = {}) {
  const g = gate();
  if (g) { rendered = 0; body.innerHTML = g; paintRail(); return; }
  let list = body.querySelector('[data-photos-list]');
  if (full || !list || rendered > items.length) {
    rendered = 0;
    const top = from ? `<p class="photos-muted photos-top">${esc(from.label)}부터 보는 중 · <button type="button" class="mini" data-photos-newest>최신으로</button></p>` : '';
    body.innerHTML = `${top}<div data-photos-list></div><p class="photos-muted photos-foot" data-photos-foot></p>`;
    list = body.querySelector('[data-photos-list]');
  }
  const counts = new Map();
  for (const it of items) counts.set(it.day, (counts.get(it.day) || 0) + 1);
  let i = rendered;
  for (const group of groupByDay(items.slice(rendered))) {
    const lastHead = list.lastElementChild?.previousElementSibling;
    let grid;
    if (lastHead?.dataset.photosDay === group.day) grid = list.lastElementChild;
    else { list.append(dayHeadEl(group.day, 0)); grid = newGrid(); list.append(grid); }
    for (const item of group.items) grid.append(cell(item, i++));
  }
  rendered = items.length;
  list.querySelectorAll('[data-photos-day]').forEach(h => { const n = h.querySelector('[data-photos-day-n]'); if (n) n.textContent = `· ${counts.get(h.dataset.photosDay) || 0}장`; });
  const foot = body.querySelector('[data-photos-foot]');
  foot.innerHTML = failed ? failHtml({retry: 'data-photos-more'})
    : ended ? (items.length ? '' : filter === 'all' ? '사진이 없어요.' : `${FILTER_TEXT[filter]} 사진이 없어요.`) : waitHtml({rows:2, h:72});
  sizer.paintButtons(root); paintSelect(); paintRail();
  watchFoot(foot);
}
let io = null;
function watchFoot(foot) {
  io?.disconnect();
  if (ended || failed || tab !== 'all') return;
  if (!('IntersectionObserver' in window)) { loadMore(); return; }
  io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore(); }, {rootMargin:'600px 0px'});
  io.observe(foot);
}
async function renderCalendar() {
  io?.disconnect();
  const g = gate();
  if (g) { body.innerHTML = g; return; }
  calCursor ||= thisMonth();
  const ym = calCursor, r = run, key = monthKey(ym.year, ym.month), want = filter;
  const headHtml = `<div class="photos-cal-head"><button type="button" class="mini" data-photos-cal="-1" aria-label="이전 달">‹</button><b>${ym.year}년 ${ym.month + 1}월</b><button type="button" class="mini" data-photos-cal="1" aria-label="다음 달">›</button></div>`;
  const cacheKey = `${want}:${key}`;
  let days = calData.get(cacheKey);
  if (!days) {
    body.innerHTML = `${headHtml}${waitHtml({rows:4, h:72})}`;
    try {
      await ensureStars(r);
      // 대표 사진은 별표한 것 먼저: 그 달 별표 id만 보낸다(500개까지).
      const ids = starIds().filter(id => (starDay.get(id) || '').startsWith(key + '-')).slice(0, STAR_CHUNK);
      if (want === 'star' && !ids.length) days = {};
      else days = (await odDays(rt, key, {filter:want, starIds:ids.length || want === 'star' ? ids : null})).days;
      calData.set(cacheKey, days);
    } catch (error) { if (current(r) && tab === 'calendar' && calCursor === ym) body.innerHTML = `${headHtml}<p class="photos-muted">사진을 읽지 못했어요: ${esc(odErrorText(error))}</p>`; return; }
    if (!current(r) || tab !== 'calendar' || calCursor !== ym || filter !== want) return;
  }
  const {lead, cells} = calendarFromDays(ym, days);
  const grid = document.createElement('div');
  grid.className = 'photos-cal';
  for (const w of ['일', '월', '화', '수', '목', '금', '토']) grid.append(Object.assign(document.createElement('span'), {className:'photos-cal-w', textContent:w}));
  for (let k = 0; k < lead; k++) grid.append(Object.assign(document.createElement('span'), {className:'photos-cal-cell is-blank'}));
  for (const c of cells) {
    const el = document.createElement(c.count ? 'button' : 'span');
    el.className = 'photos-cal-cell';
    if (c.count) { el.type = 'button'; el.dataset.photosCalDay = c.day; el.setAttribute('aria-label', `${dayHead(c.day)}, 사진 ${c.count}장`); el.append(odPhotoElement(c.rep, 'small', {label:'', rt, retry:false})); }
    el.append(Object.assign(document.createElement('span'), {className:'photos-cal-n', textContent:String(c.n)}));
    if (c.count) el.append(Object.assign(document.createElement('span'), {className:'photos-cal-c', textContent:String(c.count)}));
    grid.append(el);
  }
  body.innerHTML = headHtml; body.append(grid);
}
// [휴지통]: Web2에서 지운 사진. 열 때마다 서버가 30일 지난 것을 조금씩 원드라이브 휴지통으로 보낸다.
async function renderTrash({reload = false} = {}) {
  io?.disconnect();
  const g = gate();
  if (g) { body.innerHTML = g; return; }
  const r = run;
  if (!trash || reload) {
    body.innerHTML = waitHtml({rows:4, h:72});
    try { trash = (await odTrashList(rt)).items.map(p => ({...toItem(p), trashed_at:p.trashed_at, purge_at:p.purge_at})); trashFailed = ''; }
    catch (error) { if (!current(r)) return; trash = null; trashFailed = odErrorText(error); }
    if (!current(r) || tab !== 'trash') return;
  }
  if (!trash) { body.innerHTML = `<p class="photos-muted">휴지통을 읽지 못했어요: ${esc(trashFailed)} <button type="button" class="mini" data-photos-trash-retry>다시</button></p>`; return; }
  body.innerHTML = `<p class="photos-muted photos-top">30일 뒤 원드라이브 휴지통으로 가요${trash.length ? ' · <button type="button" class="mini" data-photos-purge-all>모두 비우기</button>' : ''}</p>${trash.length ? '' : '<p class="photos-muted">휴지통이 비어 있어요.</p>'}`;
  if (trash.length) { const grid = newGrid(); trash.forEach((item, i) => { const b = cell(item, i); b.dataset.photosTrash = ''; grid.append(b); }); body.append(grid); }
  sizer.paintButtons(root); paintSelect();
}
function render() {
  root.querySelectorAll('[data-photos-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.photosTab === tab)));
  $('[data-photos-filter]').hidden = tab === 'trash'; root.querySelector('.photo-size').hidden = tab === 'calendar';
  paintOd();
  if (tab === 'calendar') { select.stop(); paintSelect(); paintRail(); renderCalendar(); return; }
  if (tab === 'trash') { paintRail(); renderTrash(); return; }
  paintList({full:true});
  if (!gate() && !items.length && !ended) loadMore();
}
function sizeChanged() { root.querySelectorAll('[data-diary-grid]').forEach(sizer.paintGrid); sizer.paintButtons(root); }
globalThis.matchMedia?.(WIDE_QUERY)?.addEventListener?.('change', () => sizer.paintButtons(root));
const shownList = () => (tab === 'trash' ? trash || [] : items);
function paintStars() {
  root.querySelectorAll('[data-photos-open]').forEach(b => {
    const item = shownList()[Number(b.dataset.photosOpen)]; if (!item) return;
    const on = isStarred(item), mark = b.querySelector('.diary-star-mark'); if (mark) mark.hidden = !on;
    b.setAttribute('aria-label', `${dayHead(item.day)} ${item.video ? '동영상' : '사진'}${on ? ', 별표' : ''}`);
  });
  photoStripRefresh();
}

// ---- 빠른 이동 막대(오른쪽 끝, [사진]에서 달이 둘 이상일 때) ----
function paintRail() {
  const on = tab === 'all' && ready() && bar.length > 1 && !select.active;
  rail.hidden = !on;
  if (!on) return;
  const top = items.length ? items[0].day.slice(0, 7) : (from ? from.cursor.t.slice(0, 7) : '');
  const at = bar.find(m => m.key === top) || bar[0];
  railAt(bar.indexOf(at));
}
// 막대 손잡이 자리와 읽어 주는 값(달 순서 0 = 최신 달).
function railAt(k) {
  const m = bar[k]; if (!m) return;
  thumb.style.top = `${Math.round(m.from * 1000) / 10}%`;
  rail.setAttribute('aria-valuemax', String(bar.length - 1)); rail.setAttribute('aria-valuenow', String(k)); rail.setAttribute('aria-valuetext', m.label);
}
let railDrag = null;
const railMonth = y => { const r = rail.getBoundingClientRect(); return monthAt(bar, (y - r.top) / Math.max(1, r.height)); };
function showBubble(m, y) {
  if (!m) return;
  const r = rail.getBoundingClientRect();
  bubble.hidden = false; bubble.textContent = m.label; bubble.style.top = `${Math.max(0, Math.min(r.height - 20, y - r.top - 10))}px`;
  rail.setAttribute('aria-valuetext', m.label);
}
rail.addEventListener('pointerdown', e => { e.preventDefault(); rail.setPointerCapture?.(e.pointerId); railDrag = railMonth(e.clientY); showBubble(railDrag, e.clientY); });
rail.addEventListener('pointermove', e => { if (!railDrag) return; railDrag = railMonth(e.clientY); showBubble(railDrag, e.clientY); });
const railEnd = () => { const m = railDrag; railDrag = null; bubble.hidden = true; if (m) jumpMonth(m.key); };
rail.addEventListener('pointerup', railEnd);
rail.addEventListener('pointercancel', () => { railDrag = null; bubble.hidden = true; });
rail.addEventListener('keydown', e => {
  if (!['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key) || !bar.length) return;
  e.preventDefault();
  let k = Math.max(0, Math.min(bar.length - 1, Number(rail.getAttribute('aria-valuenow')) || 0));
  if (e.key === 'Enter') return jumpMonth(bar[k].key);
  k = Math.max(0, Math.min(bar.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)));
  railAt(k);
});
// 그 달(또는 그날)로: 이미 받은 목록에 있으면 거기로 스크롤, 없으면 그 자리부터 다시 받는다(위 줄 [최신으로]).
function jumpTo(prefix, cursor, label) {
  const find = () => body.querySelector(`[data-photos-day^="${CSS.escape(prefix)}"]`);
  const r = run;
  if (!find()) {
    select.stop(); from = {cursor, label}; items = []; next = null; ended = false; failed = ''; rendered = 0;
    paintList({full:true});
    const p = loadMore();
    Promise.resolve(p).then(() => { if (current(r) && tab === 'all') requestAnimationFrame(() => (find() || body).scrollIntoView({block:'start'})); });
    return;
  }
  requestAnimationFrame(() => find()?.scrollIntoView({block:'start'}));
}
const jumpMonth = key => jumpTo(key, monthCursor(key), key.replace('-', '.'));

// ---- 별표 ----
async function setStar(item, on) {
  const k = starKey(item.source, item.key);
  if (starBusy.has(k) || isStarred(item) === on) return true;
  starBusy.add(k);
  if (on) { starSet.add(k); starDay.set(item.key, item.day); } else starSet.delete(k);
  try { if (on) await addStar({source:item.source, key:item.key, day:item.day}, rt); else await removeStar(item, rt); return true; }
  catch { if (on) starSet.delete(k); else starSet.add(k); return false; }
  finally { starBusy.delete(k); }
}
async function toggleStar(item) {
  if (!item) return;
  const p = setStar(item, !isStarred(item));
  paintStars();
  if (!(await p)) { paintStars(); photoStripNote('별표를 저장하지 못했어요. 다시 눌러 주세요.'); }
}
const starsChanged = () => { if (filter === 'star') monthsFor = ''; calData.clear(); };

// ---- 크게 보기 ----
const whenText = item => `${dayHead(item.day)}${takenLabel(item) ? ' ' + takenLabel(item) : ''}`;
const takeOne = item => { const t = takeItems(items, [item.id]); if (!t.taken.length) return null; items = t.rest; paintList({full:true}); return t.taken; };
const restoreTaken = taken => { items = putItems(items, taken); if (current(run)) paintList({full:true}); };
async function commitOne(taken, {keepalive = false} = {}) {
  const id = taken[0].item.id;
  try { await odDelete(rt, id, {keepalive}); forgetOdPhoto(id); trash = null; }
  catch (error) { if (error?.message === 'onedrive_item_missing') { forgetOdPhoto(id); return; } throw error; }
}
// 원본 받기: 짧게 사는 주소로 브라우저가 바로 받는다(파일이 Web2 서버를 거치지 않음, 저장은 기기 받은 파일 폴더).
async function downloadOne(item) {
  try {
    const m = await odMediaUrl(rt, item.id, 'download');
    const a = Object.assign(document.createElement('a'), {href:m.url, rel:'noopener noreferrer', download:m.name || item.name || 'photo'});
    a.hidden = true; document.body.append(a); a.click(); a.remove();
    return true;
  } catch (error) {
    const text = `원본을 받지 못했어요: ${odErrorText(error)}`;
    if (photoStripOpen()) photoStripNote(text); else notify(text, {error:true});
    return false;
  }
}
function openViewer(index) {
  if (photoStripOpen()) return;
  openPhotoStrip({host:root, list:() => items, index, title:'사진', layerName:'photos-photo',
    element:(item, size, opts) => odPhotoElement(item, size, {...opts, rt}), label:(item, i) => `${item.video ? '동영상' : '사진'} ${i + 1}`, when:whenText,
    info:item => [['찍은 때', whenText(item)], ['파일', item.name], ['크기', item.width && item.height ? `${item.width} × ${item.height}` : ''], ['길이', durationLabel(item.duration_ms)], ['출처', '원드라이브']],
    original:() => ({download:true}), download:downloadOne,
    play:async item => (await odMediaUrl(rt, item.id, 'play')).url, badge:item => durationLabel(item.duration_ms),
    isStarred, toggleStar:item => { starsChanged(); return toggleStar(item); },
    deletable:() => ({ok:od.canDelete, title:od.canDelete ? 'Web2 휴지통으로' : '지우려면 원드라이브를 다시 연결해 주세요'}),
    take:takeOne, restore:restoreTaken, commit:commitOne,
    errorText:error => `지우지 못했어요: ${odErrorText(error)}`, onError:note,
    onClose:({starChanged, restore}) => { if (starChanged && filter === 'star' && restore) { items = items.filter(isStarred); paintList({full:true}); } }});
}

// ---- 여러 장 고르기 ----
const canShare = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
function paintSelect() {
  const on = select.active && tab !== 'calendar', inTrash = tab === 'trash';
  $('[data-photos-sel]').hidden = !on; $('[data-photos-act]').hidden = !on || inTrash; $('[data-photos-trash-act]').hidden = !on || !inTrash;
  $('[data-photos-sel-count]').textContent = `${select.size}개 골랐음`;
  root.classList.toggle('is-selecting', on);
  const list = shownList();
  root.querySelectorAll('[data-photos-open]').forEach(b => {
    const item = list[Number(b.dataset.photosOpen)];
    const picked = on && !!item && select.has(item.id);
    b.classList.toggle('is-picked', picked);
    if (on) b.setAttribute('aria-pressed', String(picked)); else b.removeAttribute('aria-pressed');
  });
  root.querySelectorAll('[data-photos-day-pick]').forEach(b => {
    b.hidden = !on;
    const ids = items.filter(x => x.day === b.dataset.photosDayPick).map(x => x.id);
    b.setAttribute('aria-pressed', String(on && ids.length > 0 && ids.every(id => select.has(id))));
  });
  const none = !select.size;
  $('[data-photos-act-delete]').disabled = !od.canDelete || none;
  $('[data-photos-act-star]').disabled = none; $('[data-photos-act-down]').disabled = none;
  const share = $('[data-photos-act-share]'); share.hidden = !canShare(); share.disabled = none;
  $('[data-photos-restore]').disabled = none || !od.canDelete; $('[data-photos-purge]').disabled = none || !od.canDelete;
  if (rail) paintRail();
}
const pickedItems = () => shownList().filter(x => select.has(x.id));
function startSelect(item) { select.start([item.id], item.id); paintSelect(); }
async function starPicked() {
  const plan = starPlan(pickedItems(), isStarred);
  const results = await Promise.all(plan.items.map(item => setStar(item, plan.on)));
  paintStars(); starsChanged();
  const bad = results.filter(ok => !ok).length;
  notify(bad ? `별표를 ${bad}장 저장하지 못했어요.` : plan.on ? `${plan.items.length}장 별표했어요` : `${plan.items.length}장 별표를 풀었어요`, {error:!!bad});
  select.stop(); paintSelect();
  if (filter === 'star') { items = items.filter(isStarred); paintList({full:true}); }
}
// 여러 장 받기: 원본 주소를 하나씩 받아 차례로(한 번에 20장까지).
async function downloadPicked() {
  const list = pickedItems(), some = list.slice(0, DOWNLOAD_MAX);
  if (!some.length) return;
  notify(`${some.length}장 받는 중…${list.length > some.length ? ` (한 번에 ${DOWNLOAD_MAX}장까지)` : ''}`);
  let bad = 0;
  for (const item of some) { if (!(await downloadOne(item))) bad++; await new Promise(ok => setTimeout(ok, 400)); }
  if (bad) notify(`${bad}장을 받지 못했어요.`, {error:true});
}
// 여러 장 공유: 큰 그림을 받아 기기 공유 창으로(동영상은 빼고, 20장까지). 받는 사이 누른 효력이 끝나면 한 번 더 누르게 한다(받은 것은 메모리에 그대로).
let shareReady = null;
async function sharePicked() {
  const list = pickedItems().filter(x => !x.video).slice(0, SHARE_MAX);
  if (!list.length) { notify('공유할 사진이 없어요(동영상은 [⤓ 받기]로).'); return; }
  const key = list.map(x => x.id).join(',');
  if (shareReady?.key !== key) {
    notify('사진 받는 중…', {ms:30000});
    const files = [];
    for (const item of list) {
      try { const blob = await odPhotoBlob(rt, item.id, 'large'); const f = blob && photoFile(blob, shareFileName(item, blob.type)); if (f) files.push(f); } catch { /* 빠진 장은 아래에서 센다 */ }
    }
    shareReady = {key, files};
  }
  const {files} = shareReady;
  if (!files.length) { notify('사진을 받지 못했어요. 잠시 뒤 다시 해 주세요.', {error:true}); return; }
  if (!navigator.canShare?.({files})) { notify('이 기기는 여러 장 공유를 못 해요. [⤓ 받기]로 받아 주세요.'); return; }
  try { await navigator.share({files}); shareReady = null; notify(`${files.length}장을 넘겼어요`); }
  catch (error) {
    if (error?.name === 'NotAllowedError') notify('사진을 다 받았어요. [⇪ 공유]를 한 번 더 눌러 주세요.');
    else if (error?.name !== 'AbortError') notify('공유하지 못했어요.', {error:true});
  }
}
let batch = null;
async function commitBatch({keepalive = false} = {}) {
  const b = batch; if (!b) return;
  batch = null; clearTimeout(b.timer);
  const back = [];
  try {
    const res = await odDeleteMany(rt, b.taken.map(t => t.item.id), {keepalive});
    const bad = new Set(Object.keys(res.failed).filter(id => res.failed[id] !== 'missing'));
    for (const t of b.taken) { if (bad.has(t.item.id)) back.push(t); else forgetOdPhoto(t.item.id); }
  } catch { back.push(...b.taken); }
  trash = null;
  if (back.length) { items = putItems(items, back); if (current(b.run)) paintList({full:true}); notify(`${back.length}장을 지우지 못했어요.`, {error:true}); }
}
function deletePicked() {
  if (!od.canDelete) return;
  const picked = pickedItems(), ids = picked.slice(0, SELECT_MAX).map(x => x.id);
  if (!ids.length) return;
  if (batch) commitBatch();
  const t = takeItems(items, ids);
  items = t.rest;
  select.stop();
  paintList({full:true});
  const b = {taken:t.taken, run, timer:setTimeout(() => commitBatch(), UNDO_MS)};
  batch = b;
  const more = picked.length > ids.length ? ` (한 번에 ${SELECT_MAX}장까지)` : '';
  notify(`${t.taken.length}장을 휴지통으로 옮겼어요${more}`, {ms:UNDO_MS, record:false, undo:() => {
    if (batch !== b) return;
    batch = null; clearTimeout(b.timer); items = putItems(items, b.taken); if (current(b.run)) paintList({full:true});
  }});
}
window.addEventListener('pagehide', () => { if (batch) commitBatch({keepalive:true}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && batch) commitBatch({keepalive:true}); });
// 휴지통: 되살리기·바로 지우기(원드라이브 휴지통으로, 작은 확인창 한 번).
async function trashRun(ids, act) {
  if (trashBusy || !ids.length) return;
  trashBusy = true;
  const done = [], bad = [];
  try {
    for (const part of chunks(ids, SELECT_MAX)) {
      try {
        const res = act === 'restore' ? await odTrashRestore(rt, part) : await odTrashPurge(rt, part);
        done.push(...(act === 'restore' ? res.restored : res.purged));
        bad.push(...Object.keys(res.failed));
      } catch { bad.push(...part); }
    }
  } finally { trashBusy = false; }
  const gone = new Set(done);
  if (trash) trash = trash.filter(x => !gone.has(x.id));
  if (act === 'restore' && done.length) { resetList(); calData.clear(); }
  else done.forEach(id => forgetOdPhoto(id));
  select.stop();
  if (tab === 'trash') renderTrash();
  notify(bad.length ? `${bad.length}장은 하지 못했어요.` : act === 'restore' ? `${done.length}장을 되살렸어요` : `${done.length}장을 원드라이브 휴지통으로 보냈어요`, {error:!!bad.length});
}
async function purgeAsk(anchor, ids) {
  if (!ids.length) return;
  if (!await askConfirm(anchor, {text:`${ids.length}장을 지금 원드라이브 휴지통으로 보낼까요?`, note:'원드라이브 휴지통에서 30일 더 꺼낼 수 있어요.', ok:'지우기', danger:true})) return;
  return trashRun(ids, 'purge');
}

// 길게 누르기(0.5초, 손가락이 10px 넘게 움직이면 취소)로 선택 모드를 켠다. 켠 뒤 바로 오는 누르기는 먹는다.
// 선택 모드에서 칸을 누른 채 좌우로 끌면 처음 칸부터 지금 칸까지 함께 고른다(위아래로 가면 화면 끝에서 저절로 넘어감).
let hold = null, ateClick = false, drag = null;
const itemOf = b => shownList()[Number(b?.dataset.photosOpen)];
body.addEventListener('pointerdown', e => {
  ateClick = false;
  const b = e.target.closest('[data-photos-open]'); if (!b || e.button > 0) return;
  const item = itemOf(b); if (!item) return;
  if (select.active) { drag = {anchor:item.id, x:e.clientX, y:e.clientY, base:new Set(select.items), add:!select.has(item.id), on:false, id:e.pointerId}; return; }
  hold = {b, x:e.clientX, y:e.clientY, timer:setTimeout(() => { hold = null; ateClick = true; navigator.vibrate?.(15); startSelect(item); }, HOLD_MS)};
});
const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
let scrollTimer = null, lastY = 0;
const stopAuto = () => { clearInterval(scrollTimer); scrollTimer = null; };
function dragTo(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('[data-photos-open]');
  const item = el && root.contains(el) ? itemOf(el) : null;
  if (!item) return;
  const span = dragRange(shownList().map(i => i.id), drag.anchor, item.id), next = new Set(drag.base);
  for (const id of span) { if (drag.add) next.add(id); else next.delete(id); }
  select.items = next; paintSelect();
}
body.addEventListener('pointermove', e => {
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_MOVE) cancelHold();
  if (!drag) return;
  if (!drag.on) {
    const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
    if (dy > DRAG_START && dy > dx && e.pointerType !== 'mouse') { drag = null; return; } // 세로 = 넘기기
    if (Math.max(dx, dy) < DRAG_START) return;
    drag.on = true; body.setPointerCapture?.(e.pointerId);
  }
  e.preventDefault(); ateClick = true; lastY = e.clientY;
  dragTo(e.clientX, e.clientY);
  const h = window.innerHeight, dir = e.clientY < EDGE ? -1 : e.clientY > h - EDGE ? 1 : 0;
  if (dir && !scrollTimer) { const x = e.clientX; scrollTimer = setInterval(() => { if (!drag) return stopAuto(); window.scrollBy(0, dir * 24); dragTo(x, lastY); }, 50); }
  else if (!dir) stopAuto();
});
const endDrag = () => { drag = null; stopAuto(); cancelHold(); };
for (const t of ['pointerup', 'pointercancel']) body.addEventListener(t, endDrag);
body.addEventListener('pointerleave', cancelHold);
body.addEventListener('contextmenu', e => { if (e.target.closest('[data-photos-open]')) e.preventDefault(); });

// ---- 원드라이브 아이콘·설정 창(공용 부품, 이 화면 안에서) ----
function paintOd() {
  odHost.innerHTML = settings.html();
  odHost.querySelectorAll('button').forEach(b => { b.disabled = settings.busy; });
  const modalNote = odHost.querySelector('[data-od-modal-note]');
  if (modalNote) modalNote.textContent = odMessage; else if (odMessage) note(odMessage);
}
function afterOdChange() { resetList(); trash = null; calData.clear(); syncDone = false; ensureOd(true).then(() => { render(); startSync(run); }); }
const settings = createOdSettings({rt, layerName:'photos-od', back:'photos', od:() => od, refresh:force => ensureOd(force), paint:paintOd,
  message:text => { odMessage = text; }, fault:() => { odFault = true; paintOdLink(linkBtn, od, odFault); }, reload:afterOdChange});
const linkMenu = createOdLinkMenu({id:'photosOdMenu', historyKey:'kptuPhotosOdMenu', label:'원드라이브',
  model:() => ({od, fault:odFault, message:odFault ? (failed || odMessage) : '', show:viewPrefs.get('diary_onedrive') !== false}), onAction:linkAct});
function linkAct(act) {
  if (act === 'connect' || act === 'reconnect') return settings.connect();
  if (act === 'retry') { odFault = false; return ensureOd(true).then(() => { resetList(); render(); }); }
  if (act === 'show') { viewPrefs.set('diary_onedrive', viewPrefs.get('diary_onedrive') === false, {rejectable:true}); return; }
  if (act === 'folder') return settings.run(settings.startBrowse);
  if (act === 'subfolders') return settings.open ? undefined : settings.run(settings.openTree);
  if (act === 'disconnect') return settings.disconnect();
}

function setTab(nextTab, {fromBack = false} = {}) {
  nextTab = validTab(nextTab);
  if (nextTab === tab) return;
  select.stop();
  tab = nextTab;
  window.KPTURouter?.setPlace?.('photos', tab === 'all' ? {} : {tab});
  // 뒤로가기 = 이전 칩: [달력]·[휴지통]은 라우터 겹 하나라 뒤로가면 [사진]으로 돌아온다.
  if (tab !== 'all' && !tabLayer) tabLayer = window.KPTURouter?.layer?.open('photos-tab', {close:() => { tabLayer = null; setTab('all', {fromBack:true}); return true; }}) || null;
  if (tab === 'all' && tabLayer && !fromBack) { const l = tabLayer; tabLayer = null; l.close(); }
  render();
}
function goDay(day) {
  // [달력] 겹을 닫는 뒤로가기(popstate)가 스크롤을 되돌릴 수 있으므로, 그것이 끝난 뒤에 그날로 간다.
  const settled = tabLayer ? new Promise(ok => { const t = setTimeout(ok, 400); window.addEventListener('popstate', () => { clearTimeout(t); setTimeout(ok, 0); }, {once:true}); }) : Promise.resolve();
  setTab('all');
  settled.then(() => { if (tab === 'all') jumpTo(day, dayCursor(day), dayHead(day)); });
}
function setFilter(v) {
  filter = validFilter(v); savePrefs();
  select.stop(); resetList(); calData.clear(); render();
}

root.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b || !root.contains(b)) return;
  if (b.matches('[data-photos-open]')) {
    if (ateClick) { ateClick = false; return; }
    const item = itemOf(b); if (!item) return;
    if (select.active) { if (event.shiftKey) select.range(shownList().map(x => x.id), item.id); else select.toggle([item.id]); paintSelect(); return; }
    if (tab === 'trash') return startSelect(item);
    return openViewer(Number(b.dataset.photosOpen));
  }
  if (odHost.contains(b) && settings.click(b, odHost)) return;
  if (b.matches('[data-photos-tab]')) return setTab(b.dataset.photosTab);
  if (b.matches('[data-photo-size]')) { if (sizer.changeCols(Number(b.dataset.photoSize))) sizeChanged(); return; }
  if (b.matches('[data-od-link]')) return linkMenu.open(b);
  if (b.matches('[data-photos-sel-off]')) { select.stop(); return paintSelect(); }
  if (b.matches('[data-photos-day-pick]')) { select.toggle(items.filter(x => x.day === b.dataset.photosDayPick).map(x => x.id), {anchor:false}); return paintSelect(); }
  if (b.matches('[data-photos-act-star]')) return starPicked();
  if (b.matches('[data-photos-act-share]')) return sharePicked();
  if (b.matches('[data-photos-act-down]')) return downloadPicked();
  if (b.matches('[data-photos-act-delete]')) return deletePicked();
  if (b.matches('[data-photos-restore]')) return trashRun(pickedItems().map(x => x.id), 'restore');
  if (b.matches('[data-photos-purge]')) return purgeAsk(b, pickedItems().map(x => x.id));
  if (b.matches('[data-photos-purge-all]')) return purgeAsk(b, (trash || []).map(x => x.id));
  if (b.matches('[data-photos-trash-retry]')) return renderTrash({reload:true});
  if (b.matches('[data-photos-cal]')) { calCursor = Number(b.dataset.photosCal) < 0 ? prevMonth(calCursor) : nextMonth(calCursor); return renderCalendar(); }
  if (b.matches('[data-photos-cal-day]')) return goDay(b.dataset.photosCalDay);
  if (b.matches('[data-photos-newest]')) { resetList(); render(); return window.scrollTo?.(0, 0); }
  if (b.matches('[data-photos-more]')) { failed = ''; paintList(); return loadMore(); }
  if (b.matches('[data-photos-connect]')) return settings.connect();
  if (b.matches('[data-photos-folder]')) return settings.run(settings.startBrowse);
  if (b.matches('[data-photos-retry]')) return ensureOd(true).then(render);
});
root.addEventListener('change', event => {
  if (event.target.matches('[data-photos-filter]')) setFilter(event.target.value);
});
root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && select.active && !photoStripOpen()) { event.preventDefault(); select.stop(); paintSelect(); }
});

// [사진] 목록만 비운다(별표·연결은 그대로). 받는 중이던 쪽은 버린다.
function resetList() {
  run++; items = []; next = null; ended = false; loading = null; failed = ''; from = null; rendered = 0; monthsFor = ''; bar = []; io?.disconnect();
}
async function enter() {
  readPrefs();
  const placed = window.KPTURouter?.place?.('photos')?.tab;
  if (placed && validTab(placed) !== tab) tab = validTab(placed);
  const back = takeOdReturn();
  if (!odReady) body.innerHTML = gate();
  await ensureOd();
  ensureStars(run).then(() => { if (tab === 'all') paintStars(); });
  render();
  if (back) settings.finishReturn(back).then(render);
  startSync(run);
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'photos') return;
  closePhotoStrip({fromBack:true, restore:false});
  tabLayer = null; select.stop({fromBack:true}); settings.drop(); odHost.replaceChildren(); io?.disconnect();
  if (batch) commitBatch();
});
window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt);
  closePhotoStrip({fromBack:true, restore:false});
  batch = null; resetList(); syncDone = false; od = {...OD_NONE}; odReady = false; odFault = false; odMessage = ''; tab = 'all'; filter = 'all'; colsSaved = null; prefsRead = false; calCursor = null;
  trash = null; calData.clear(); starSet.clear(); starDay.clear(); starsReady = null; shareReady = null; settings.drop();
  $('[data-photos-filter]').value = 'all'; body.replaceChildren(); odHost.replaceChildren();
});
window.KPTURouter?.on?.('photos', enter);
window.KPTUPhotos = {refresh:() => { resetList(); trash = null; calData.clear(); return ensureOd(true).then(render); }};
if (window.KPTURouter?.current === 'photos') enter();
})();
