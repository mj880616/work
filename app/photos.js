// PHOTO-사진메뉴 1차(docs/design/photo-menu.md, 시안 photo-menu-mock.html): '사진' 메뉴(?view=photos). #photosView의 유일한 그리기 주인.
// 원드라이브 사진 색인(Edge onedrive-photos, 지금 서버의 'photos' 달 목록·'photo-delete')을 읽어 갤러리처럼 보여 준다.
// - 위 칩 줄: [사진] [달력] (설계 4절: 다음 단계 칩은 그 단계가 올 때 보인다) · 오른쪽 끝 거르기(전체·★)·[－][＋](일기와 같은 부품)·원드라이브 아이콘(od-link.js).
// - [사진]: 날짜 상관없이 최신순 격자 + 날짜 머리줄 '10월 27일 (월) · 14장'. 이번 달부터 한 달씩 거슬러 받는다(아래 끝에 닿으면 다음 달).
// - [달력]: 달 칸마다 그날 대표 사진(별표 있는 첫 장, 없으면 첫 장)과 장수. 칸을 누르면 [사진]의 그날 머리줄로.
// - 크게 보기: 일기와 같은 공용 부품 photo-strip.js(손동작·버튼줄 [☆][⇪][🗑][ⓘ], 명진 결정 07:45).
// - 여러 장 고르기: 길게 누르기(0.5초)로 시작, 공용 select-mode.js(뒤로가기 = 선택 해제). 위 줄 '✕ · n개 골랐음', 아래 [☆ 별표] [🗑 지우기].
// 별표는 app_diary_stars(일기 ★와 같은 것). 저장은 모두 서버(기기 저장 없음, 썸네일 사본은 기존 od-thumb-cache.js만).
import {odStatusCached, odPhotos, odPhotoElement, odDelete, forgetOdPhoto, odErrorText, odAuthStart, odSync, odSyncDelay, readStars, addStar, removeStar, starKey, takenLabel} from './diary-onedrive.js';
import {ownerScope} from './diary-data.js';
import {seoulParts} from './meeting-time.js';
import {SIZE_BUTTONS, WIDE_QUERY, paintGrid, paintButtons, changeCols, attachPinch} from './photo-grid-size.js';
import {openPhotoStrip, closePhotoStrip, photoStripOpen, photoStripNote, photoStripRefresh, photoStripReload} from './photo-strip.js';
import {UNDO_MS} from './photo-viewer-model.mjs';
import {odLinkButtonHtml, paintOdLink, createOdLinkMenu} from './od-link.js';
import {createSelectMode} from './select-mode.js';
import {notify} from './small-notice.js';
import {viewPrefs} from './view-prefs.js';
import {EMPTY_STOP, MAX_MONTHS, SELECT_MAX, validTab, monthKey, prevMonth, nextMonth, parseMonth, monthItems, groupByDay, dayHead, applyFilter, calendarMonth, starPlan, takePhoto, putPhoto} from './photos-model.mjs';

(() => {
if (window.KPTUPhotos) return;
const rt = window.KPTURuntime;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HOLD_MS = 500, HOLD_MOVE = 10;

function install() {
  if (document.getElementById('photosView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', '<section id="photosView" class="view-panel view-wide hidden" aria-label="사진"><div id="photosRoot" class="photos"></div></section>');
}
install();
const root = document.getElementById('photosRoot');
if (!root) return;
root.innerHTML = `<div class="photos-bar" data-photos-bar><div class="photos-chips" role="group" aria-label="사진 보기"><button type="button" class="photos-chip" data-photos-tab="all" aria-pressed="true">사진</button><button type="button" class="photos-chip" data-photos-tab="calendar" aria-pressed="false">달력</button></div><span class="photos-sp"></span><select class="photos-filter" data-photos-filter aria-label="거르기"><option value="all">전체</option><option value="star">★</option></select>${SIZE_BUTTONS}${odLinkButtonHtml()}</div><div class="photos-sel" data-photos-sel hidden><button type="button" class="photos-sel-x" data-photos-sel-off aria-label="선택 끝내기">✕</button><span data-photos-sel-count>0개 골랐음</span></div><p class="photos-note" data-photos-note role="status"></p><div class="photos-body" data-photos-body></div><div class="photos-act" data-photos-act role="group" aria-label="고른 사진" hidden><button type="button" data-photos-act-star><span aria-hidden="true">☆</span> 별표</button><button type="button" class="photos-danger" data-photos-act-delete><span aria-hidden="true">🗑</span> 지우기</button></div>`;
const $ = sel => root.querySelector(sel);
const body = $('[data-photos-body]'), noteEl = $('[data-photos-note]'), linkBtn = $('[data-od-link]');

const OD_NONE = {configured:false, connected:false, folder:null, canDelete:false};
let owner = ownerScope(rt), run = 0;
let od = {...OD_NONE}, odFault = false, odReady = false;
let tab = 'all', filter = 'all';
// 받은 달: key → {data, stars:Set}. 사진 보기는 cursor(다음에 받을 달)부터 거슬러 받는다.
let months = new Map(), cursor = null, empties = 0, ended = false, loading = null, failed = '';
let calCursor = null, shown = [], tabLayer = null, syncing = false;
const starSet = new Set(), starBusy = new Set();
const isStarred = item => starSet.has(starKey(item.source, item.key));
const select = createSelectMode({layer:'photos-select', onBack:() => paintSelect()});
const thisMonth = () => { const p = seoulParts(new Date()); return {year:p.year, month:p.month}; };
const current = r => r === run && owner === ownerScope(rt);
const note = text => { noteEl.textContent = text || ''; };

// ---- 서버 읽기 ----
async function ensureOd(force = false) {
  try {
    od = {...OD_NONE, ...(await odStatusCached(rt, {force}))};
  } catch { od = {...OD_NONE, failed:true}; }
  odReady = true; paintOdLink(linkBtn, od, odFault);
  return od;
}
async function loadMonth(ym, r) {
  const key = monthKey(ym.year, ym.month);
  if (months.has(key)) return months.get(key);
  const [data, stars] = await Promise.all([odPhotos(rt, ym.year, ym.month), readStars(ym.year, ym.month, rt).catch(() => null)]);
  if (!current(r)) return null;
  for (const s of stars || []) if (s.source === 'onedrive') starSet.add(starKey(s.source, s.item_key));
  // 그 달 날짜만 둔다(서버도 달로 거르지만, 같은 사진이 두 달에 겹쳐 그려지지 않게 한 번 더).
  for (const day of Object.keys(data.days || {})) if (!day.startsWith(key + '-')) delete data.days[day];
  const entry = {data, ym};
  months.set(key, entry);
  return entry;
}
// 원드라이브에서 바뀐 것을 서버 색인에 이어 받는다(일기와 같은 서버 동작 'sync', 이 접속에서 한 번). 새로 받은 것이 있으면 처음부터 다시 그린다.
let syncDone = false;
async function startSync(r) {
  if (syncing || syncDone || !od.connected || !od.folder) return;
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
    if (current(r) && saw) { note(''); reset(); render(); }
  } catch (error) { if (current(r)) note(`사진 목록을 다 받지 못했어요: ${odErrorText(error)}`); }
  finally { syncing = false; }
}
// 다음 달 한 묶음: 사진이 있는 달이 나오거나 끝에 닿을 때까지 거슬러 받는다.
function loadMore() {
  if (loading || ended || !od.connected || !od.folder) return loading;
  const r = run;
  loading = (async () => {
    try {
      cursor ||= thisMonth();
      for (let guard = 0; guard < 12 && !ended; guard++) {
        const entry = await loadMonth(cursor, r);
        if (!entry) return;
        cursor = prevMonth(cursor);
        if (months.size >= MAX_MONTHS) ended = true;
        if (monthItems(entry.data).length) { empties = 0; break; }
        if (++empties >= EMPTY_STOP) ended = true;
      }
      failed = '';
    } catch (error) {
      if (!current(r)) return;
      failed = odErrorText(error); odFault = true; paintOdLink(linkBtn, od, odFault);
    } finally { if (current(r)) loading = null; }
    if (current(r)) renderAll();
  })();
  return loading;
}

// ---- 그리기 ----
// 이어 받은 달만(이번 달 ~ cursor 바로 위). [달력]에서 따로 본 먼 달은 이어 받기가 거기 닿을 때 끼운다(중간이 비지 않게).
function allItems() {
  const out = [], edge = cursor ? monthKey(cursor.year, cursor.month) : null;
  if (!edge) return out;
  for (const {data} of [...months.values()].filter(e => monthKey(e.ym.year, e.ym.month) > edge).sort((a, b) => monthKey(b.ym.year, b.ym.month).localeCompare(monthKey(a.ym.year, a.ym.month)))) out.push(...monthItems(data));
  return applyFilter(out, filter, isStarred);
}
function gate() {
  if (!odReady) return '<p class="photos-muted">불러오는 중…</p>';
  if (od.failed) return '<p class="photos-muted">원드라이브 상태를 읽지 못했어요. <button type="button" class="mini" data-photos-retry>다시</button></p>';
  if (!od.configured || !od.connected) return `<p class="photos-muted">원드라이브 연결 뒤 쓸 수 있어요${od.configured ? ' <button type="button" class="mini" data-photos-connect>연결</button>' : ''}</p>`;
  if (!od.folder) return '<p class="photos-muted">사진을 읽을 폴더를 고른 뒤 쓸 수 있어요 <button type="button" class="mini" data-photos-to-diary>폴더 고르기</button></p>';
  return '';
}
function gridOf(items, start) {
  const grid = document.createElement('div');
  grid.className = 'diary-grid photos-grid'; grid.dataset.diaryGrid = '';
  paintGrid(grid); attachPinch(grid, sizeChanged);
  items.forEach((item, k) => {
    const i = start + k, on = isStarred(item);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'diary-grid-item'; b.dataset.photosOpen = String(i);
    b.setAttribute('aria-label', `${dayHead(item.day)} 사진${on ? ', 별표' : ''}`);
    b.append(odPhotoElement(item, 'small', {label:'', rt}));
    const mark = document.createElement('span'); mark.className = 'diary-star-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '★'; mark.hidden = !on;
    const pick = document.createElement('span'); pick.className = 'photos-pick'; pick.setAttribute('aria-hidden', 'true');
    b.append(mark, pick); grid.append(b);
  });
  return grid;
}
function renderAll() {
  const g = gate();
  if (g) { shown = []; body.innerHTML = g; return; }
  shown = allItems();
  const frag = document.createDocumentFragment();
  let i = 0;
  for (const group of groupByDay(shown)) {
    const head = document.createElement('div');
    head.className = 'photos-day'; head.dataset.photosDay = group.day;
    head.innerHTML = `<b>${esc(dayHead(group.day))}</b><span>· ${group.items.length}장</span><button type="button" class="photos-day-pick" data-photos-day-pick="${esc(group.day)}" aria-label="${esc(dayHead(group.day))} 모두 고르기" hidden></button>`;
    frag.append(head, gridOf(group.items, i));
    i += group.items.length;
  }
  const foot = document.createElement('p');
  foot.className = 'photos-muted photos-foot'; foot.dataset.photosFoot = '';
  foot.innerHTML = failed ? `사진을 읽지 못했어요: ${esc(failed)} <button type="button" class="mini" data-photos-more>다시</button>`
    : ended ? (shown.length ? '' : (filter === 'star' ? '별표한 사진이 없어요.' : '사진이 없어요.')) : '불러오는 중…';
  frag.append(foot);
  body.replaceChildren(frag);
  paintButtons(root); paintSelect();
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
  const ym = calCursor, r = run, key = monthKey(ym.year, ym.month);
  const headHtml = `<div class="photos-cal-head"><button type="button" class="mini" data-photos-cal="-1" aria-label="이전 달">‹</button><b>${ym.year}년 ${ym.month + 1}월</b><button type="button" class="mini" data-photos-cal="1" aria-label="다음 달">›</button></div>`;
  let entry = months.get(key);
  if (!entry) {
    body.innerHTML = `${headHtml}<p class="photos-muted">불러오는 중…</p>`;
    try { entry = await loadMonth(ym, r); } catch (error) { if (current(r) && tab === 'calendar' && calCursor === ym) body.innerHTML = `${headHtml}<p class="photos-muted">사진을 읽지 못했어요: ${esc(odErrorText(error))}</p>`; return; }
    if (!entry || !current(r) || tab !== 'calendar' || calCursor !== ym) return;
  }
  const {lead, cells} = calendarMonth(ym, entry.data, isStarred);
  const grid = document.createElement('div');
  grid.className = 'photos-cal';
  for (const w of ['일', '월', '화', '수', '목', '금', '토']) grid.append(Object.assign(document.createElement('span'), {className:'photos-cal-w', textContent:w}));
  for (let k = 0; k < lead; k++) grid.append(Object.assign(document.createElement('span'), {className:'photos-cal-cell is-blank'}));
  for (const c of cells) {
    const cell = document.createElement(c.count ? 'button' : 'span');
    cell.className = 'photos-cal-cell';
    if (c.count) { cell.type = 'button'; cell.dataset.photosCalDay = c.day; cell.setAttribute('aria-label', `${dayHead(c.day)}, 사진 ${c.count}장`); cell.append(odPhotoElement(c.rep, 'small', {label:'', rt})); }
    cell.append(Object.assign(document.createElement('span'), {className:'photos-cal-n', textContent:String(c.n)}));
    if (c.count) cell.append(Object.assign(document.createElement('span'), {className:'photos-cal-c', textContent:String(c.count)}));
    grid.append(cell);
  }
  body.innerHTML = headHtml; body.append(grid);
}
function render() {
  root.querySelectorAll('[data-photos-tab]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.photosTab === tab)));
  const listTools = tab === 'all';
  $('[data-photos-filter]').hidden = !listTools; root.querySelector('.photo-size').hidden = !listTools;
  if (tab === 'calendar') { select.stop(); paintSelect(); renderCalendar(); return; }
  renderAll();
  if (!gate() && !months.size) loadMore();
}
function sizeChanged() { root.querySelectorAll('[data-diary-grid]').forEach(paintGrid); paintButtons(root); }
globalThis.matchMedia?.(WIDE_QUERY)?.addEventListener?.('change', () => paintButtons(root));
function paintStars() {
  root.querySelectorAll('[data-photos-open]').forEach(b => {
    const item = shown[Number(b.dataset.photosOpen)]; if (!item) return;
    const on = isStarred(item), mark = b.querySelector('.diary-star-mark'); if (mark) mark.hidden = !on;
    b.setAttribute('aria-label', `${dayHead(item.day)} 사진${on ? ', 별표' : ''}`);
  });
  photoStripRefresh();
}

// ---- 별표 ----
async function setStar(item, on) {
  const k = starKey(item.source, item.key);
  if (starBusy.has(k) || isStarred(item) === on) return true;
  starBusy.add(k);
  if (on) starSet.add(k); else starSet.delete(k);
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

// ---- 크게 보기 ----
const whenText = item => `${dayHead(item.day)}${takenLabel(item) ? ' ' + takenLabel(item) : ''}`;
const monthOfItem = item => months.get(item.day.slice(0, 7));
function takeItem(item) {
  const t = takePhoto(monthOfItem(item)?.data, item);
  if (t) renderAll();
  return t;
}
const restoreItem = t => { putPhoto(t); if (current(run)) renderAll(); };
async function commitItem(t, {keepalive = false} = {}) {
  try { await odDelete(rt, t.photo.id, {keepalive}); forgetOdPhoto(t.photo.id); }
  catch (error) { if (error?.message === 'onedrive_item_missing') { forgetOdPhoto(t.photo.id); return; } throw error; }
}
function openViewer(index) {
  if (photoStripOpen()) return;
  openPhotoStrip({host:root, list:() => shown, index, title:'사진', layerName:'photos-photo',
    element:(item, size, opts) => odPhotoElement(item, size, {...opts, rt}), label:(item, i) => `사진 ${i + 1}`, when:whenText,
    info:item => [['찍은 때', whenText(item)], ['파일', item.name], ['출처', '원드라이브']],
    original:() => ({text:'원드라이브 앱에서 받아 주세요'}),
    isStarred, toggleStar,
    deletable:() => ({ok:od.canDelete, title:od.canDelete ? '원드라이브 휴지통으로' : '지우려면 원드라이브를 다시 연결해 주세요'}),
    take:takeItem, restore:restoreItem, commit:commitItem,
    errorText:error => `지우지 못했어요: ${odErrorText(error)}`, onError:note,
    onClose:({starChanged, restore}) => { if (starChanged && filter === 'star' && restore) renderAll(); }});
}

// ---- 여러 장 고르기 ----
function paintSelect() {
  const on = select.active && tab === 'all';
  $('[data-photos-sel]').hidden = !on; $('[data-photos-act]').hidden = !on;
  $('[data-photos-sel-count]').textContent = `${select.size}개 골랐음`;
  root.classList.toggle('is-selecting', on);
  root.querySelectorAll('[data-photos-open]').forEach(b => {
    const item = shown[Number(b.dataset.photosOpen)];
    const picked = on && !!item && select.has(item.id);
    b.classList.toggle('is-picked', picked);
    if (on) b.setAttribute('aria-pressed', String(picked)); else b.removeAttribute('aria-pressed');
  });
  root.querySelectorAll('[data-photos-day-pick]').forEach(b => {
    b.hidden = !on;
    const ids = shown.filter(x => x.day === b.dataset.photosDayPick).map(x => x.id);
    b.setAttribute('aria-pressed', String(on && ids.length > 0 && ids.every(id => select.has(id))));
  });
  const act = $('[data-photos-act-delete]'); act.disabled = !od.canDelete || !select.size;
  $('[data-photos-act-star]').disabled = !select.size;
}
const pickedItems = () => shown.filter(x => select.has(x.id));
function startSelect(item) { select.start([item.id], item.id); paintSelect(); }
async function starPicked() {
  const plan = starPlan(pickedItems(), isStarred);
  const results = await Promise.all(plan.items.map(item => { const p = setStar(item, plan.on); return p; }));
  paintStars();
  const bad = results.filter(ok => !ok).length;
  notify(bad ? `별표를 ${bad}장 저장하지 못했어요.` : plan.on ? `${plan.items.length}장 별표했어요` : `${plan.items.length}장 별표를 풀었어요`, {error:!!bad});
  select.stop(); paintSelect();
  if (filter === 'star') renderAll();
}
let batch = null;
async function commitBatch({keepalive = false} = {}) {
  const b = batch; if (!b) return;
  batch = null; clearTimeout(b.timer);
  const failedOnes = [];
  for (const t of b.taken) { try { await commitItem(t, {keepalive}); } catch { failedOnes.push(t); } }
  if (failedOnes.length) { failedOnes.forEach(putPhoto); if (current(b.run)) renderAll(); notify(`${failedOnes.length}장을 지우지 못했어요.`, {error:true}); }
}
function deletePicked() {
  if (!od.canDelete) return;
  const items = pickedItems().slice(0, SELECT_MAX);
  if (!items.length) return;
  if (batch) commitBatch();
  const taken = items.map(item => takePhoto(monthOfItem(item)?.data, item)).filter(Boolean);
  select.stop();
  renderAll();
  const b = {taken, run, timer:setTimeout(() => commitBatch(), UNDO_MS)};
  batch = b;
  const more = pickedItems().length > items.length ? ` (한 번에 ${SELECT_MAX}장까지)` : '';
  notify(`${taken.length}장을 휴지통으로 옮겼어요${more}`, {ms:UNDO_MS, record:false, undo:() => {
    if (batch !== b) return;
    batch = null; clearTimeout(b.timer); b.taken.slice().reverse().forEach(putPhoto); if (current(b.run)) renderAll();
  }});
}
window.addEventListener('pagehide', () => { if (batch) commitBatch({keepalive:true}); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && batch) commitBatch({keepalive:true}); });

// 길게 누르기(0.5초, 손가락이 10px 넘게 움직이면 취소)로 선택 모드를 켠다. 켠 뒤 바로 오는 누르기는 먹는다.
let hold = null, ateClick = false;
body.addEventListener('pointerdown', e => {
  ateClick = false;
  const b = e.target.closest('[data-photos-open]'); if (!b || select.active || e.button > 0) return;
  hold = {b, x:e.clientX, y:e.clientY, timer:setTimeout(() => { const item = shown[Number(b.dataset.photosOpen)]; hold = null; if (!item) return; ateClick = true; navigator.vibrate?.(15); startSelect(item); }, HOLD_MS)};
});
const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
body.addEventListener('pointermove', e => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_MOVE) cancelHold(); });
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) body.addEventListener(t, cancelHold);
body.addEventListener('contextmenu', e => { if (e.target.closest('[data-photos-open]')) e.preventDefault(); });

// ---- 원드라이브 아이콘(공용 부품). 연결·폴더 설정 창은 일기 화면에 있으므로 그쪽으로 보낸다. ----
const linkMenu = createOdLinkMenu({id:'photosOdMenu', historyKey:'kptuPhotosOdMenu', label:'원드라이브',
  model:() => ({od, fault:odFault, message:odFault && failed ? failed : '', show:viewPrefs.get('diary_onedrive') !== false}), onAction:linkAct});
async function connect() { try { window.location.assign(await odAuthStart(rt)); } catch (error) { note(`연결을 시작하지 못했어요: ${odErrorText(error)}`); } }
function linkAct(act) {
  if (act === 'connect' || act === 'reconnect') return connect();
  if (act === 'retry') { odFault = false; return ensureOd(true).then(() => { reset(); render(); }); }
  if (act === 'show') { viewPrefs.set('diary_onedrive', viewPrefs.get('diary_onedrive') === false, {rejectable:true}); return; }
  window.KPTURouter?.go?.('diary');
}

function setTab(next, {fromBack = false} = {}) {
  next = validTab(next);
  if (next === tab) return;
  tab = next;
  window.KPTURouter?.setPlace?.('photos', tab === 'all' ? {} : {tab});
  // 뒤로가기 = 이전 칩: [달력]은 라우터 겹 하나라 뒤로가면 [사진]으로 돌아온다.
  if (tab === 'calendar' && !tabLayer) tabLayer = window.KPTURouter?.layer?.open('photos-tab', {close:() => { tabLayer = null; setTab('all', {fromBack:true}); return true; }}) || null;
  if (tab === 'all' && tabLayer && !fromBack) { const l = tabLayer; tabLayer = null; l.close(); }
  render();
}
function goDay(day) {
  // [달력] 겹을 닫는 뒤로가기(popstate)가 스크롤을 되돌릴 수 있으므로, 그것이 끝난 뒤에 그날 머리줄로 간다.
  const settled = tabLayer ? new Promise(ok => { const t = setTimeout(ok, 400); window.addEventListener('popstate', () => { clearTimeout(t); setTimeout(ok, 0); }, {once:true}); }) : Promise.resolve();
  setTab('all');
  const ym = parseMonth(day.slice(0, 7)); if (!ym) return;
  const r = run, target = monthKey(ym.year, ym.month), find = () => body.querySelector(`[data-photos-day="${CSS.escape(day)}"]`);
  (async () => {
    // 그 달까지 이어 받는다(이미 받은 달은 서버에 다시 묻지 않는다).
    for (let i = 0; i < MAX_MONTHS && current(r) && !find() && !ended && !failed; i++) {
      if (cursor && monthKey(cursor.year, cursor.month) < target) break;
      const p = loadMore(); if (!p) break;
      await p;
    }
    await settled;
    if (current(r) && tab === 'all') requestAnimationFrame(() => find()?.scrollIntoView({block:'start'}));
  })();
}

root.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b || !root.contains(b)) return;
  if (b.matches('[data-photos-open]')) {
    if (ateClick) { ateClick = false; return; }
    const item = shown[Number(b.dataset.photosOpen)]; if (!item) return;
    if (select.active) { if (event.shiftKey) select.range(shown.map(x => x.id), item.id); else select.toggle([item.id]); paintSelect(); return; }
    return openViewer(Number(b.dataset.photosOpen));
  }
  if (b.matches('[data-photos-tab]')) return setTab(b.dataset.photosTab);
  if (b.matches('[data-photo-size]')) { if (changeCols(Number(b.dataset.photoSize))) sizeChanged(); return; }
  if (b.matches('[data-od-link]')) return linkMenu.open(b);
  if (b.matches('[data-photos-sel-off]')) { select.stop(); return paintSelect(); }
  if (b.matches('[data-photos-day-pick]')) { select.toggle(shown.filter(x => x.day === b.dataset.photosDayPick).map(x => x.id), {anchor:false}); return paintSelect(); }
  if (b.matches('[data-photos-act-star]')) return starPicked();
  if (b.matches('[data-photos-act-delete]')) return deletePicked();
  if (b.matches('[data-photos-cal]')) { calCursor = Number(b.dataset.photosCal) < 0 ? prevMonth(calCursor) : nextMonth(calCursor); return renderCalendar(); }
  if (b.matches('[data-photos-cal-day]')) return goDay(b.dataset.photosCalDay);
  if (b.matches('[data-photos-more]')) { failed = ''; renderAll(); return loadMore(); }
  if (b.matches('[data-photos-connect]')) return connect();
  if (b.matches('[data-photos-to-diary]')) return window.KPTURouter?.go?.('diary');
  if (b.matches('[data-photos-retry]')) return ensureOd(true).then(render);
});
root.addEventListener('change', event => {
  if (event.target.matches('[data-photos-filter]')) { filter = event.target.value === 'star' ? 'star' : 'all'; select.stop(); renderAll(); }
});
root.addEventListener('keydown', event => {
  if (event.key === 'Escape' && select.active && !photoStripOpen()) { event.preventDefault(); select.stop(); paintSelect(); }
});

function reset() {
  run++; months = new Map(); cursor = null; empties = 0; ended = false; loading = null; failed = ''; shown = []; starSet.clear(); io?.disconnect();
}
async function enter() {
  const placed = window.KPTURouter?.place?.('photos')?.tab;
  if (placed && validTab(placed) !== tab) { tab = validTab(placed); }
  if (!odReady) body.innerHTML = gate();
  await ensureOd();
  render();
  startSync(run);
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'photos') return;
  closePhotoStrip({fromBack:true, restore:false});
  tabLayer = null; select.stop({fromBack:true}); io?.disconnect();
  if (batch) commitBatch();
});
window.addEventListener('kptu:session-changed', () => {
  if (owner === ownerScope(rt)) return;
  owner = ownerScope(rt);
  closePhotoStrip({fromBack:true, restore:false});
  batch = null; reset(); syncDone = false; od = {...OD_NONE}; odReady = false; odFault = false; tab = 'all'; filter = 'all'; calCursor = null;
  $('[data-photos-filter]').value = 'all'; body.replaceChildren();
});
window.KPTURouter?.on?.('photos', enter);
window.KPTUPhotos = {refresh:() => { reset(); return ensureOd(true).then(render); }};
if (window.KPTURouter?.current === 'photos') enter();
})();
