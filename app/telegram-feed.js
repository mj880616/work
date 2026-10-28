// TG-방날짜묶기 4-가 (docs/design/tg-room-day-group.md 2절, 시안 mockups/tg-room-day-group.html): 텔레그램 소식 화면(?view=telegram, 사이드바 맨 아래).
// 이 모듈이 #telegramView의 유일한 renderer다. 머리줄 '텔레그램 소식' + "오늘 n개 중 중요한 m개 · 방 k곳" + 방 거르기, 고정 띠, 작은 가운데 날짜,
// 그 아래 "방 한 줄"(방 머리글자·방 이름·그날 내용 한 줄·소식 n·원문 n). 줄을 누르면 방 상세가 열린다(PC 오른쪽 2/3, 폰 router layer 한 칸):
// ← 방 이름 [텔레그램에서 열기], ‹ 날짜 ›(그 방의 앞뒤 날), 맨 위 요약 3~4줄(AI가 쓴 하루 요약, 없는 날은 소식 제목 모음), 그날 소식(시각·원문 n·⋯).
// 소식 줄은 눌러 원문을 펼치고 ⋯ 메뉴(고정·요약 복사·조직 연결·삭제)만 있다. 삭제는 휴지통(hidden_at, 자동으로 비우지 않음)이고 머리줄 ⋯ → 휴지통에서 되살린다.
// 읽기: DB 함수 app_feed_room_day_lines(14일씩) + 소유자 읽기 표(feed-data.js), 규칙은 tg-day-model.mjs. 소식 삭제·되살리기는 DB 함수 app_feed_set_state.
// TG-발언자이름: 원문에 이름을 입히고([이름 붙이기]) 머리줄 ⋯ → '보낸 사람 이름'에서 관리한다(tg-sender-model.mjs, tg-sender-data.js). 방 색은 저장하지 않는다(feed-model.mjs roomTone).
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {createFeedHold} from './feed-hold.js';
import {mountSplitResize} from './split-resize.js';
import {hhmm, dayLabel, telegramLines, telegramToday, telegramHeadText, roomTone, roomInitial, pinnedOf, missingTable, kstDay} from './feed-model.mjs';
import {readDays, readRaw, readOrganizations, setPinned, setFeedState, scopeOf, readRoomDayLines, readRoomDay, readTitleRows, readPinnedItems, readTrashedItems,
  readFeedFolders, readFeedRooms, readTrashedDays, setRoom, setRoomDay, createFolder, renameFolder, deleteFolder, readSummaryEdits, editSummary} from './feed-data.js';
import {summaryCopyText} from './summary-copy-model.mjs';
import {copyButtonHtml, copySummary} from './summary-copy.js';
import {copyText} from './copy-text.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';
import {buildIndex, rawRows, peopleRows, chipsOf, cleanName, linkKey, dayShort, NAME_ERROR_TEXT, SENDER_FAIL_TEXT, MERGE_NOTE, MERGE_BOTH_KEYED} from './tg-sender-model.mjs';
import {readSenders, setSenderName, mergeSenders, forgetSender} from './tg-sender-data.js';
import {lineOf, rdKey, splitRdKey, liveLines, groupLines, neighborDays, daysNeedingTitles, titleIndex, lineText, daySummary, openTarget, COPY_NOTE,
  firstWindow, olderWindow, reachedEnd, chunksOf, cleanFolderName, FOLDER_ERROR_TEXT, archivedRooms, withRoomState,
  swipeIntent, swipeEdge, swipeOffset, swipeSettle, swipeOpenOffset, allowOf, SWIPE_ACTIONS, ACTION_LABEL,
  SUMEDIT, SUMEDIT_TEXT, editMap, itemTarget, dayTarget, itemSummary, isItemEdited, applyLineEdit, dayEdit, cleanSummaryInput, cleanDayInput, dayPatch, sumEditErrorText, linesToText, rawFoldable, rawMoreKey} from './tg-day-model.mjs';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const UNDO_MS = 8000;
// 버튼 안 그림(글자색을 따라가는 선 그림, 색은 CSS 토큰).
const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  folder:svg('<path d="M3.5 7.5h6l2 2h9v9h-17z"/>'),
  archive:svg('<path d="M3.5 7h17v4h-17z"/><path d="M5.5 11v8h13v-8"/><path d="M10 15h4"/>'),
  unarchive:svg('<path d="M4 9h10a5 5 0 010 10H8"/><path d="M8 5L4 9l4 4"/>'),
  trash:svg('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>'),
};

// state.mode: live (방·날 목록) | archive (보관함) | trash (휴지통) | senders (보낸 사람 이름). state.folder: 칸 줄에서 고른 폴더('' = 전체). state.swipe: 열려 있는 줄 {key, side}. state.sel: 열린 방 상세 {room, day}. state.open: 원문을 펼친 소식 ID.
let state = fresh(), run = 0, layer = null, shelfLayer = null, editLayer = null, undo = null, undoTimer = 0;
function fresh() { return {owner:'', loaded:false, missing:false, error:'', lines:[], from:'', end:false, titles:new Map(), pins:[], trashed:[], trashedDays:[], folders:[], rooms:new Map(), folder:'', swipe:null, fedit:null, mode:'live', days:[], orgs:[], mine:new Set(), sel:null, open:new Set(), more:new Set(), dcache:new Map(), raw:new Map(), link:null, senders:null, sidx:null, sedit:null, sman:null, edits:null, se:null, note:'', status:'', busy:false}; }

function install() {
  if ($('#telegramView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="telegramView" class="view-panel feed-view hidden" aria-labelledby="tgTitle"><h2 id="tgTitle" class="a11y-only">텔레그램 소식</h2><div class="feed-split" id="tgSplit"><div class="feed-list" id="tgList"></div><section class="feed-pane" id="tgDetail" aria-label="텔레그램 방 상세"></section></div></section>`);
}
install();
const view = () => $('#telegramView');
const itemOf = id => { for (const d of state.dcache.values()) { const r = d.items?.find(x => x.id === id); if (r) return r; } return state.pins.find(r => r.id === id) || state.trashed.find(r => r.id === id) || null; };
const lineAt = (room, day) => state.lines.find(l => l.room_key === room && l.day === day) || null;
const selKey = () => (state.sel ? rdKey(state.sel.room, state.sel.day) : '');
const detailOf = () => state.dcache.get(selKey()) || null;
// TG-요약고치기: edits = 고친 요약(Map) 또는 null(표를 읽지 못함: 고치기 입구를 보이지 않는다). se = 열려 있는 고치기 상자 {kind:'item'|'day', ...}.
const editsOn = () => state.edits instanceof Map;
const sumOf = r => itemSummary(r, state.edits);
const lineView = l => applyLineEdit(l, state.edits);
const labelOfRoom = key => state.rooms.get(key)?.room_label || state.lines.find(l => l.room_key === key)?.room_label || key;


// ---------- data
async function readLines(from, to) { return (await readRoomDayLines(chunksOf(from, to), rt)).map(lineOf).filter(Boolean); }
async function load() {
  const owner = scopeOf(rt), me = ++run; if (!state.loaded) paint();
  const today = kstDay(), first = firstWindow(today), from = state.from && state.from < first.from ? state.from : first.from;
  try {
    const [lines, days, orgs, senders, pins, trashed, folders, rooms, trashedDays, edits] = await Promise.all([readLines(from, today), readDays('telegram', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()})), readSenders(rt).catch(() => null), readPinnedItems(rt).catch(() => []), readTrashedItems(rt).catch(() => []),
      readFeedFolders(rt).catch(() => []), readFeedRooms(rt).catch(() => new Map()), readTrashedDays(rt).catch(() => []), readSummaryEdits(rt).then(editMap).catch(() => null)]);
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, missing:false, error:'', lines:withRoomState(lines, rooms), from, end:reachedEnd(from, today), pins, trashed, trashedDays, folders, rooms, days, orgs:orgs.orgs, mine:orgs.mine, edits, se:null, dcache:new Map(), swipe:null});
    setSenders(senders);
    if (state.folder && !folders.some(f => f.id === state.folder)) state.folder = '';
    if (state.mode === 'trash' && !trashed.length && !trashedDays.length) leaveShelf();
    if (state.mode === 'archive' && !archivedRooms(rooms, state.lines).length) leaveShelf();
  } catch (error) {
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, lines:[], pins:[], trashed:[], missing:missingTable(error), error:missingTable(error) ? '' : '텔레그램 소식을 불러오지 못했어요.'});
  }
  paint();
  if (state.sel) void ensureDetail(); void fillTitles(me);
}
// 요약 한 줄이 없는 날의 소식 제목을 따로 읽어 목록 줄에 채운다(읽지 못하면 줄 글이 빈 채로 둔다).
async function fillTitles(me) {
  const days = daysNeedingTitles(state.lines); if (!days.length) return;
  try { const rows = await readTitleRows(days, rt); if (me !== run) return; state.titles = titleIndex(rows); paintList(); } catch {}
}
async function extend() {
  const today = kstDay(), win = olderWindow(state.from, today), me = run, owner = scopeOf(rt);
  if (!win) { state.end = true; return false; }
  const lines = await readLines(win.from, win.to); if (me !== run || owner !== scopeOf(rt)) return false;
  state.lines = [...state.lines, ...withRoomState(lines, state.rooms)]; state.from = win.from; state.end = reachedEnd(win.from, today);
  void fillTitles(me); return true;
}
function setSenders(data) { state.senders = data; state.sidx = data ? buildIndex(data.senders, data.links) : null; }
async function reloadSenders() {
  const owner = scopeOf(rt);
  try { const data = await readSenders(rt); if (owner === scopeOf(rt)) setSenders(data); return true; } catch { return false; }
}
async function ensureDetail() {
  const sel = state.sel; if (!sel) return; const key = selKey(); if (state.dcache.get(key)?.items || state.dcache.get(key)?.loading) return;
  state.dcache.set(key, {loading:true}); const me = run;
  try { const d = await readRoomDay(sel.room, sel.day, rt); if (me !== run) return; state.dcache.set(key, d); }
  catch { if (me !== run) return; state.dcache.set(key, {error:true}); }
  if (selKey() === key) paintDetail();
}
async function loadRaw(id) {
  if (state.raw.has(id)) return;
  state.raw.set(id, {loading:true});
  try { const r = await readRaw(id, rt); state.raw.set(id, {raw_text:r?.raw_text || null}); }
  catch { state.raw.set(id, {error:true}); }
  if (state.open.has(id)) paintDetail();
}

// ---------- paint (the only renderer of #telegramView)
function paint() {
  const root = view(); if (!root) return;
  const wide = pc.matches, open = !!state.sel;
  paintList(); paintDetail();
  $('#tgList').hidden = !wide && open; $('#tgDetail').hidden = !wide && !open;
  const l = state.sel && lineAt(state.sel.room, state.sel.day);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:wide && state.sel ? (l?.room_label || '') || null : null}}));
  mountSplitResize({container:$('#tgSplit'), name:'telegram', inherit:'tasks', label:'텔레그램 소식과 방 상세 칸 폭 조절', list:() => $('#tgList'), pane:() => $('#tgDetail'), active:() => pc.matches && !view()?.classList.contains('hidden')});
}
const statusHtml = () => esc(state.status);
const undoHtml = () => (undo ? `<div class="feed-undo" role="status" data-tg-undobar><span>${esc(undo.text)}</span><span aria-hidden="true">·</span><button type="button" class="feed-undo-btn" data-tg-undo>되돌리기</button></div>` : '');
function chipsHtml() {
  const archived = archivedRooms(state.rooms, state.lines).length;
  const chip = (attr, on, text, cls = '') => `<button type="button" class="feed-chip${cls}" ${attr} aria-pressed="${on}">${esc(text)}</button>`;
  const folders = state.folders.map(f => chip(`data-tg-folder="${esc(f.id)}"`, state.folder === f.id, f.name)).join('');
  const fm = state.folder ? `<button type="button" class="feed-more feed-folder-more" data-ctx="off" data-tg-folder-more aria-haspopup="true" aria-expanded="false" aria-label="폴더 메뉴">${MORE}</button>` : '';
  return `<div class="feed-chiprow" role="group" aria-label="폴더">${chip('data-tg-folder=""', !state.folder, '전체')}${folders}${fm}<button type="button" class="feed-chip is-add" data-tg-folder-add>+ 폴더</button><button type="button" class="feed-chip is-box" data-tg-shelf="archive">보관함 ${archived}</button></div>`;
}
// 폴더 만들기·이름 바꾸기·지우기 상자(칸 줄 바로 아래). create 때 room이 있으면 만든 폴더에 그 방을 넣는다.
function feditHtml() {
  const e = state.fedit; if (!e) return '';
  if (e.kind === 'delete') {
    const f = state.folders.find(x => x.id === e.id);
    return `<div class="feed-sbox" data-tg-fedit data-enter-save="[data-tg-fedit-save]"><p class="feed-sbox-title">'${esc(f?.name || '')}' 폴더를 지울까요?</p><p class="feed-sbox-note">폴더만 지워져요. 안에 있던 방과 소식은 그대로 전체에 남아요.</p>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(e.status)}</span><button type="button" class="feed-small" data-tg-fedit-cancel${e.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-tg-fedit-save${e.busy ? ' disabled' : ''}>지우기</button></div></div>`;
  }
  return `<div class="feed-sbox" data-tg-fedit data-enter-save="[data-tg-fedit-save]"><p class="feed-sbox-title">${e.kind === 'rename' ? '폴더 이름 바꾸기' : e.room ? `'${esc(labelOfRoom(e.room))}' 방을 넣을 새 폴더` : '새 폴더'}</p>
<input type="text" class="feed-edit-input" data-tg-fedit-input value="${esc(e.value)}" placeholder="폴더 이름 (20자까지)" aria-label="폴더 이름" autocomplete="off"${e.busy ? ' disabled' : ''}>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(e.status)}</span><button type="button" class="feed-small" data-tg-fedit-cancel${e.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-tg-fedit-save${e.busy ? ' disabled' : ''}>저장</button></div></div>`;
}
const trashCount = () => state.trashed.length + state.trashedDays.length;
function headHtml() {
  if (state.mode === 'senders') {
    const n = state.senders ? state.senders.senders.length : 0;
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">보낸 사람 이름${state.senders ? ` · ${n}명` : ''}</span></div>`;
  }
  if (state.mode === 'archive') {
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">보관함 ${archivedRooms(state.rooms, state.lines).length}</span></div><p class="feed-note" data-tg-archive-note>방 단위로 보관해요. 보관한 방도 수집·요약은 계속돼요.</p>`;
  }
  if (state.mode === 'trash') {
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">휴지통 ${trashCount()}</span></div><p class="feed-note" data-tg-trash-note>Web2 목록에서만 뺀 것이에요. 원문은 Drive에 그대로 있어요. 직접 비우기 전까지 남아요.</p>`;
  }
  const today = telegramToday(state.days, kstDay());
  const failed = today?.failed ? ` · 판정 실패 ${today.failed}` : '';
  const ready = state.loaded && !state.missing && !state.error;
  const more = ready ? `<button type="button" class="feed-more" data-tg-head-more aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴">${MORE}</button>` : '';
  return `<div class="feed-head"><span class="feed-head-title screen-title" aria-hidden="true">텔레그램 소식</span><span class="feed-head-sub" data-tg-today>${ready ? esc(telegramHeadText(today) + failed) : ''}</span>${more}</div>${ready ? chipsHtml() + feditHtml() : ''}`;
}
// 줄 밀기: 버튼은 닫혀 있으면 보이지도 눌리지도 않는다. mode: live | archive.
const actBtn = (side, kind, open) => `<button type="button" class="feed-act feed-act-${kind}" data-tg-act-btn="${side}" data-tg-kind="${kind}" tabindex="-1"${open === side ? '' : ' aria-hidden="true"'} aria-label="${ACTION_LABEL[kind]}">${ICON[kind === 'unarchive' ? 'unarchive' : kind]}<span>${ACTION_LABEL[kind]}</span></button>`;
function swipeRow(key, mode, room, day, inner) {
  const acts = SWIPE_ACTIONS[mode], open = state.swipe?.key === key ? state.swipe.side : '';
  const group = side => (acts[side].length ? `<div class="feed-acts feed-acts-${side}">${acts[side].map(k => actBtn(side, k, open)).join('')}</div>` : '');
  return `<div class="feed-swipe${acts.start.length > 1 ? ' is-two' : ''}" data-tg-swipe="${esc(key)}" data-mode="${mode}" data-room="${esc(room)}" data-day="${esc(day)}"${open ? ` data-side="${open}"` : ''}>${group('start')}${group('end')}${inner}</div>`;
}
function rowHtml(l) {
  const key = rdKey(l.room_key, l.day), on = key === selKey(), text = lineText(lineView(l), state.titles);
  return swipeRow(key, 'live', l.room_key, l.day, `<div class="feed-rd feed-r${roomTone(l.room_key)}${on ? ' is-selected' : ''}" data-tg-rd="${esc(key)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(l.room_label))}</span><button type="button" class="feed-rdb" data-tg-rdopen="${esc(key)}"${on ? ' aria-current="true"' : ''}><span class="feed-rn">${esc(l.room_label)}</span><span class="feed-rl">${esc(text)}</span><span class="feed-ft"><span>소식 ${l.item_count}</span><span>원문 ${l.raw_count}</span></span></button><button type="button" class="feed-hov" data-tg-rdmore="${esc(key)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(l.room_label)} 메뉴">${MORE}</button></div>`);
}
// 보관함의 방 한 줄: 방 이름 · 최근 날 · 한 줄 · [꺼내기]. 줄을 누르면 가장 최근 날의 방 상세가 열린다.
function archiveRowHtml(r) {
  const l = r.last, key = l ? rdKey(l.room_key, l.day) : '', text = l ? lineText(lineView(l), state.titles) : '', on = !!key && key === selKey();
  const body = `<span class="feed-rn">${esc(r.room_label)}</span><span class="feed-rl">${l ? `최근 ${esc(dayLabel(l.day))}${text ? ' · ' + esc(text) : ''}` : '불러온 기간에 소식이 없어요'}</span>`;
  return swipeRow('room:' + r.room_key, 'archive', r.room_key, l?.day || '', `<div class="feed-rd feed-r${roomTone(r.room_key)}${on ? ' is-selected' : ''}" data-tg-arow="${esc(r.room_key)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(r.room_label))}</span>${key ? `<button type="button" class="feed-rdb" data-tg-rdopen="${esc(key)}"${on ? ' aria-current="true"' : ''}>${body}</button>` : `<div class="feed-rdb">${body}</div>`}<button type="button" class="feed-small" data-tg-unarchive="${esc(r.room_key)}">꺼내기</button></div>`);
}
function trashRowHtml(r) {
  return `<div class="feed-rd feed-r${roomTone(r.room_key)}" data-tg-trow="${esc(r.id)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(r.room_label))}</span><div class="feed-rdb"><span class="feed-rn">${esc(r.room_label)} · ${esc(dayLabel(r.day))} ${esc(hhmm(r.occurred_at))}</span><span class="feed-rl">${esc(sumOf(r) || r.title || '')}</span></div><button type="button" class="feed-small" data-tg-restore="${esc(r.id)}">되살리기</button></div>`;
}
function trashDayRowHtml(d) {
  const key = rdKey(d.room_key, d.day);
  return `<div class="feed-rd feed-r${roomTone(d.room_key)}" data-tg-tdrow="${esc(key)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(labelOfRoom(d.room_key)))}</span><div class="feed-rdb"><span class="feed-rn">${esc(labelOfRoom(d.room_key))}</span><span class="feed-rl">${esc(dayLabel(d.day))} 하루 전체</span></div><button type="button" class="feed-small" data-tg-restore-day="${esc(key)}">되살리기</button></div>`;
}
function paintList() {
  const box = $('#tgList');
  if (!state.loaded) { box.innerHTML = headHtml() + '<p class="feed-empty" role="status">불러오는 중…</p>'; return; }
  if (state.missing) { box.innerHTML = headHtml() + '<p class="feed-empty" data-tg-empty="ready">준비 중이에요. 텔레그램 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = headHtml() + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-tg-retry>다시 시도</button></p>`; return; }
  const tail = `<p class="feed-status" data-tg-status role="status">${statusHtml()}</p>` + (state.sel ? '' : undoHtml());
  if (state.mode === 'senders') { box.innerHTML = headHtml() + sendersBodyHtml() + `<p class="feed-status" data-tg-status role="status">${statusHtml()}</p>`; return; }
  if (state.mode === 'archive') { box.innerHTML = headHtml() + `<div class="feed-feed" data-tg-archive>${archivedRooms(state.rooms, state.lines).map(archiveRowHtml).join('')}</div>` + tail; return; }
  if (state.mode === 'trash') {
    const days = state.trashedDays.length ? `<div class="feed-grp">삭제한 날 ${state.trashedDays.length}</div>${state.trashedDays.map(trashDayRowHtml).join('')}` : '', items = state.trashed.length ? `<div class="feed-grp">삭제한 소식 ${state.trashed.length}</div>${state.trashed.map(trashRowHtml).join('')}` : '';
    box.innerHTML = headHtml() + `<div class="feed-feed">${days}${items}</div>` + tail; return;
  }
  const lines = liveLines(state.lines, {folder:state.folder}), pins = pinnedOf(state.pins);
  const pinbar = pins.length ? `<button type="button" class="feed-pinbar" data-tg-pin-open="${esc(pins[0].id)}" data-tg-pinbar><span class="feed-pt">${esc(pins[0].room_label)} · ${esc(sumOf(pins[0]) || pins[0].title || '')}</span><span class="feed-cnt">고정 ${pins.length}</span></button>` : '';
  const groups = groupLines(lines);
  const none = state.folder ? '이 폴더에 넣은 방의 소식이 아직 없어요.' : '아직 받은 텔레그램 소식이 없어요.';
  const feed = groups.length ? groups.map(g => `<div class="feed-day feed-day-center" data-tg-day="${esc(g.day)}">${esc(dayLabel(g.day))}</div>${g.rows.map(rowHtml).join('')}`).join('') : `<p class="feed-empty" data-tg-empty="none">${none}</p>`;
  const older = state.end ? '' : '<div class="feed-older"><button type="button" class="feed-text-btn" data-tg-older>이전 날 더 보기</button></div>';
  box.innerHTML = headHtml() + pinbar + `<div class="feed-feed">${feed}</div>${older}` + tail;
}
function openLinkHtml(line, summary) {
  const t = openTarget({room_key:state.sel.room, chat_username:line?.chat_username, open_ref:summary?.openRef});
  if (t.kind === 'link') return `<a class="feed-open" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-tg-openlink>텔레그램에서 열기</a>`;
  return '<button type="button" class="feed-open" data-tg-opencopy>텔레그램에서 열기</button>';
}
// 고치기 상자(그 자리에서 입력으로 바뀜): 아래 오른쪽 [취소][저장 Ctrl+↵], 아래 왼쪽 작은 [AI 원래 요약으로](고친 값이 있을 때만).
function sumeditHtml(se) {
  const dis = se.busy ? ' disabled' : '';
  const head = se.kind === 'day' ? `<input type="text" class="feed-edit-input" data-tg-se-head data-enter-field="single" autocomplete="off" aria-label="목록에 보이는 한 줄" placeholder="목록에 보이는 한 줄 (${SUMEDIT.HEADLINE_MAX}자까지)" value="${esc(se.headline)}"${dis}>` : '';
  const rows = se.kind === 'day' ? Math.min(10, Math.max(4, se.value.split('\n').length + 1)) : 3;
  const area = `<textarea class="feed-edit-input feed-se-area" data-tg-se-text rows="${rows}" aria-label="${se.kind === 'day' ? '그날 요약 (한 줄에 요약 한 줄)' : '요약'}" autocomplete="off"${dis}>${esc(se.value)}</textarea>`;
  const orig = se.edited ? `<button type="button" class="feed-text-btn feed-se-orig" data-tg-se-orig${dis}>AI 원래 요약으로</button>` : '';
  return `<div class="feed-se" data-tg-se data-enter-save="[data-tg-se-save]">${head}${area}<div class="feed-se-actions">${orig}<span class="feed-status" role="status">${esc(se.status)}</span><button type="button" class="feed-small" data-tg-se-cancel${dis}>취소</button><button type="button" class="feed-small primary" data-tg-se-save${dis}>저장</button></div></div>`;
}
function itemHtml(r) {
  if (state.se?.kind === 'item' && state.se.id === r.id) return `<div class="feed-di is-open" data-tg-di="${esc(r.id)}"><div class="feed-di-row"><span class="feed-at">${esc(hhmm(r.occurred_at))}</span><div class="feed-se-wrap">${sumeditHtml(state.se)}</div></div></div>`;
  const on = state.open.has(r.id);
  const body = on ? `${state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'tg') : ''}${rawHtml(r)}` : '';
  return `<div class="feed-di${on ? ' is-open' : ''}" data-tg-di="${esc(r.id)}"><div class="feed-di-row"><span class="feed-at">${esc(hhmm(r.occurred_at))}</span><button type="button" class="feed-dib" data-tg-open="${esc(r.id)}" aria-expanded="${on}"><span class="feed-tx">${esc(sumOf(r) || r.title || '')}</span><span class="feed-ft"><span>원문 ${Number(r.raw_count) || 0}</span>${isItemEdited(r, state.edits) ? '<span class="feed-edited">고침</span>' : ''}${r.pinned_at ? '<span class="feed-pin">고정</span>' : ''}${r.organization_id ? `<span>${esc(orgName(state.orgs, r.organization_id) || '')}</span>` : ''}</span></button><button type="button" class="feed-more" data-tg-more="${esc(r.id)}" aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴">${MORE}</button></div>${body}</div>`;
}
function rawHtml(r) {
  const raw = state.raw.get(r.id);
  if (!raw || raw.loading) return '<p class="feed-faint" role="status">원문을 불러오는 중…</p>';
  if (raw.error) return '<p class="feed-faint">원문을 불러오지 못했어요.</p>';
  if (!raw.raw_text) return '<p class="feed-faint">Web2에 남은 원문이 없어요. 원본은 Drive에 있어요.</p>';
  const canName = !!state.senders && !!r.room_key && !!r.day, rows = rawRows(telegramLines(raw.raw_text), state.sidx, r.room_key, r.day, {canName});
  const editing = state.sedit?.kind === 'raw' && state.sedit.rowId === r.id ? state.sedit.label : '';
  return `<div class="feed-raw${canName ? ' feed-raw-wide' : ''}" data-tg-raw>${rows.map((l, i) => rawLineHtml(l, editing, rawMoreKey(r.id, i))).join('')}</div>`;
}
function paintDetail() {
  const box = $('#tgDetail'), sel = state.sel;
  if (!sel) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 방을 누르면 그날 소식이 보여요.</p>'; return; }
  const d = detailOf(), line = lineAt(sel.room, sel.day), items = d?.items || [];
  const label = line?.room_label || items[0]?.room_label || '텔레그램 방', nb = neighborDays(state.lines, sel.room, sel.day);
  const back = pc.matches ? '' : '<button type="button" class="back-text" data-tg-back>‹ 소식</button>';
  const dedit = dayEdit(state.edits, sel.room, sel.day), sum = d?.items ? daySummary(d.parts, items, {partsKnown:d.parts !== null, edit:dedit}) : null;
  const head = `<div class="feed-detail-head">${back}<span class="feed-detail-name feed-r${roomTone(sel.room)}"><span class="feed-rn">${esc(label)}</span></span>${openLinkHtml(line, sum)}</div>`;
  const nav = `<div class="feed-daynav"><button type="button" class="feed-nav" data-tg-nav="prev" aria-label="이전 날"${nb.prev || !state.end ? '' : ' disabled'}>‹</button><span class="feed-navday" data-tg-navday>${esc(dayLabel(sel.day))}</span><button type="button" class="feed-nav" data-tg-nav="next" aria-label="다음 날"${nb.next ? '' : ' disabled'}>›</button></div>`;
  const note = state.note ? `<p class="feed-notice" role="status" data-tg-note>${esc(state.note)}</p>` : '';
  let body;
  if (!d || d.loading) body = '<p class="feed-faint" role="status">불러오는 중…</p>';
  else if (d.error) body = '<p class="feed-faint">이 방의 소식을 불러오지 못했어요.</p>';
  else {
    const title = sel.day === kstDay() ? '오늘 요약' : '그날 요약';
    const editing = state.se?.kind === 'day' && state.se.room === sel.room && state.se.day === sel.day;
    const lines = editing ? sumeditHtml(state.se) : sum.lines.length ? `${sum.shown.map(t => `<p class="feed-dl">${esc(t)}</p>`).join('')}${sum.rest.length ? `<details class="feed-sumrest"><summary>더 보기</summary>${sum.rest.map(t => `<p class="feed-dl">${esc(t)}</p>`).join('')}</details>` : ''}` : '<p class="feed-faint">요약이 없어요.</p>';
    const kind = sum.kind === 'titles' ? `${sum.old ? ' <span class="feed-badge" data-tg-old>AI 요약 이전 날</span>' : ''}` : '';
    const mark = dedit ? ' <span class="feed-edited">고침</span>' : '';
    const pen = editsOn() && !editing && sum.kind !== 'none' ? '<button type="button" class="copy-mini" data-tg-sumedit-day aria-label="요약 고치기" title="요약 고치기"><span aria-hidden="true">✎</span></button>' : '';
    const sumBox = `<div class="feed-daybox" data-tg-daybox data-kind="${sum.kind}"><div class="feed-k-row"><p class="feed-k">${title}${kind}${mark}</p><span class="feed-k-btns">${pen}${sum.lines.length && !editing ? copyButtonHtml('data-tg-daycopy') : ''}</span></div>${lines}</div>`;
    body = sumBox + (items.length ? `<div class="feed-ditems">${items.map(itemHtml).join('')}</div>` : '<p class="feed-faint">이 날 남은 소식이 없어요.</p>');
  }
  box.innerHTML = `${head}${nav}${note}<div class="feed-detail" data-tg-detail="${esc(selKey())}">${body}<p class="feed-status" data-tg-detail-status role="status">${statusHtml()}</p></div>${undoHtml()}`;
  fitRawFolds(box);
}

// 한 줄: 시간 · 말한 사람(이름 > 나 > 수집기 이름 > A) · 글. 이름 없는 라벨의 그 날 첫 줄에만 [이름 붙이기]. 편집 중이면 그 줄 바로 아래에 이름 상자.
// 접기 후보 중 실제로 6줄 안에 다 들어간 글(폴드 펼침 폭, PC 세 칸)은 [더보기]를 감춘다. 그린 직후 같은 그리기 안에서 한 번 잰다.
function fitRawFolds(box) {
  for (const b of box.querySelectorAll('[data-tg-rt-more][aria-expanded="false"]')) {
    const t = b.previousElementSibling;
    if (t && t.scrollHeight <= t.clientHeight + 1) { b.hidden = true; t.classList.remove('is-fold'); }
  }
}
// TG-원문폰배치: 폰(760px 이하)에서는 '시각 · 이름' 작은 한 줄 아래 글이 화면 폭 전체. 긴 글은 6줄로 접고 [더보기](펼친 상태는 state.more, 메모리만). PC는 세 칸 그대로.
function rawLineHtml(l, editing, moreKey) {
  const k = l.shown.kind, cls = `feed-who${k === 'label' ? '' : ' is-named'}${k === 'self' ? ' is-self' : ''}${l.same ? ' is-same' : ''}`;
  const fold = rawFoldable(l.text), more = fold && state.more.has(moreKey);
  const tag = l.tag ? `<button type="button" class="feed-whotag" data-tg-name-open="${esc(l.who)}" aria-label="${esc(l.who)} 이름 붙이기">이름 붙이기</button>` : '';
  const row = `<div class="feed-rm"><span class="feed-at">${esc(l.at)}</span><span class="${cls}" title="${esc(l.shown.text)}">${esc(l.shown.text)}${tag}</span><span class="feed-rt${fold ? ` is-fold${more ? ' is-more' : ''}` : ''}">${l.forwarded ? '<span class="feed-faint">(전달)</span> ' : ''}${esc(l.text)}</span>${fold ? `<button type="button" class="feed-rt-more" data-tg-rt-more="${esc(moreKey)}" aria-expanded="${more}">${more ? '접기' : '더보기'}</button>` : ''}</div>`;
  return l.tag && editing === l.who ? row + sboxHtml() : row;
}

// ---------- 보낸 사람 이름 (TG-발언자이름)
const roomLabelOf = key => state.lines.find(l => l.room_key === key)?.room_label || '다른 방';
const peopleList = () => (state.senders ? peopleRows(state.senders.senders, state.senders.links, roomLabelOf) : []);
const personOf = id => peopleList().find(p => p.id === id) || null;
const paintEdit = () => { if (state.sedit?.kind === 'person') paintList(); else paintDetail(); };
function sboxHtml() {
  const e = state.sedit; if (!e) return '';
  const chips = chipsOf(peopleList(), e.excludeId);
  const chipHtml = chips.length ? `<div class="feed-chips" role="group" aria-label="이미 있는 사람">${chips.map(c => `<button type="button" class="feed-chip" data-tg-sbox-chip="${esc(c.id)}" aria-pressed="${c.id === e.chipId}"${e.busy ? ' disabled' : ''}>${esc(c.text)}</button>`).join('')}</div>` : '';
  const scope = e.keyed ? '<span class="feed-scope">같은 사람의 다른 소식에도 보입니다</span>' : '<span class="feed-scope is-one">이 방 이 날 소식에만 적용돼요</span>';
  return `<div class="feed-sbox" data-tg-sbox data-enter-save="[data-tg-sbox-save]"><p class="feed-sbox-title">${esc(e.title)}</p>${scope}
<input type="text" class="feed-edit-input" data-tg-sbox-input value="${esc(e.value)}" placeholder="${e.allowEmpty ? '비우면 직접 붙인 이름을 지워요' : '이름 (40자까지)'}" aria-label="이름" autocomplete="off"${e.busy ? ' disabled' : ''}>${chipHtml}
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(e.status)}</span><button type="button" class="feed-small" data-tg-sbox-cancel${e.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-tg-sbox-save${e.busy ? ' disabled' : ''}>저장</button></div></div>`;
}
function manHtml(p, people) {
  const m = state.sman; if (!m) return '';
  if (m.kind === 'forget') {
    return `<div class="feed-sbox" data-tg-sman><p class="feed-sbox-title">'${esc(p.unnamed ? '이름 없음' : p.shown.text)}' 이름표를 지울까요?</p><p class="feed-sbox-note">소식 글은 그대로예요. 이 사람이 나온 ${p.rooms ? '곳은' : '자리는'} 다시 A·B로 보여요.</p>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(m.status)}</span><button type="button" class="feed-small" data-tg-sman-cancel${m.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-tg-sman-save${m.busy ? ' disabled' : ''}>지우기</button></div></div>`;
  }
  const others = people.filter(x => x.id !== p.id), to = others.find(x => x.id === m.to);
  const opts = others.map(x => `<option value="${esc(x.id)}"${x.id === m.to ? ' selected' : ''}>${esc(x.unnamed ? `이름 없음 · ${x.roomLabel} ${dayShort(x.last?.day)}` : x.shown.text)}</option>`).join('');
  return `<div class="feed-sbox" data-tg-sman data-enter-save="[data-tg-sman-save]"><p class="feed-sbox-title">다른 사람과 합치기</p>
<label class="feed-link-label" for="tgMergeTo">이 사람을 어느 사람 쪽으로 합칠까요</label>
<select id="tgMergeTo" class="feed-select" data-tg-sman-to${m.busy ? ' disabled' : ''}><option value="">고르세요</option>${opts}</select>
<p class="feed-sbox-note">${esc(MERGE_NOTE)}${p.keyed && to?.keyed ? ` <strong>${esc(MERGE_BOTH_KEYED)}</strong>` : ''}</p>
<div class="feed-link-actions"><span class="feed-status" role="status">${esc(m.status)}</span><button type="button" class="feed-small" data-tg-sman-cancel${m.busy ? ' disabled' : ''}>취소</button><button type="button" class="feed-small primary" data-tg-sman-save${m.busy || !to ? ' disabled' : ''}>합치기</button></div></div>`;
}
function personHtml(p, people) {
  const panel = state.sedit?.kind === 'person' && state.sedit.personId === p.id ? sboxHtml() : state.sman?.id === p.id ? manHtml(p, people) : '';
  const day = dayShort(p.last?.day);
  const nm = p.unnamed ? `이름 없음 · ${esc(p.roomLabel || '연결된 소식 없음')}` : esc(p.shown.text);
  const src = p.source ? `<span class="feed-psrc${p.source === '직접' ? ' is-hand' : ''}">${p.source}</span>` : '';
  const mt = p.unnamed ? day : [p.rooms ? `방 ${p.rooms}` : '', day].filter(Boolean).join(' · ');
  const tag = p.unnamed ? `<button type="button" class="feed-whotag" data-tg-person-name="${esc(p.id)}">이름 붙이기</button>` : '';
  const name = p.unnamed ? '이름 없음' : p.shown.text;
  return `<div class="feed-person${p.unnamed ? ' is-un' : ''}" data-tg-person="${esc(p.id)}"><span class="feed-pnm">${nm}</span>${src}<span class="feed-pmt">${esc(mt)}</span>${tag}<button type="button" class="feed-more" data-tg-person-more="${esc(p.id)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(name)} 메뉴">${MORE}</button></div>${panel}`;
}
function sendersBodyHtml() {
  if (!state.senders) return '<p class="feed-empty" data-tg-empty="senders" role="status">이름표를 아직 불러오지 못했어요. 소식은 A·B로 보여요. <button type="button" class="feed-text-btn" data-tg-retry>다시 시도</button></p>';
  const people = peopleList();
  if (!people.length) return '<p class="feed-empty" data-tg-empty="senders">아직 붙인 이름이 없어요. 소식 원문에서 A 옆 [이름 붙이기]를 누르면 여기에 모여요.</p>';
  const un = people.filter(p => p.unnamed), named = people.filter(p => !p.unnamed);
  const group = (title, list) => (list.length ? `<div class="feed-grp">${title}</div>${list.map(p => personHtml(p, people)).join('')}` : '');
  return `<div class="feed-people" data-tg-people>${group(`이름 없음 ${un.length}명 <span class="feed-faint">(A·B로 보임)</span>`, un)}${group(`이름 있음 ${named.length}명`, named)}</div>`;
}
function startRawEdit(label, id) {
  const r = itemOf(id); if (!r || !state.senders || !r.room_key || !r.day || state.busy) return;
  const sender = state.sidx?.byLink.get(linkKey(r.room_key, r.day, label)) || null;
  state.sman = null;
  state.sedit = {kind:'raw', rowId:r.id, room_key:r.room_key, day:r.day, label, title:`${label}에 이름 붙이기`, value:'', chipId:'', keyed:!!sender?.keyed, excludeId:sender?.id || '', allowEmpty:false, status:'', busy:false};
  editLayer ||= window.KPTURouter?.layer?.open('telegram-sender-edit', {close:() => { editLayer = null; if (state.sedit?.kind === 'raw') { state.sedit = null; paintDetail(); } return true; }}) || null;
  paintDetail(); $('#tgDetail [data-tg-sbox-input]')?.focus({preventScroll:false});
}
function startPersonEdit(id) {
  const p = personOf(id); if (!p || state.busy) return;
  if (!p.last) { state.status = '이 사람이 나온 소식이 없어서 이름을 붙일 수 없어요.'; paintList(); return; }
  endEdit(); state.sman = null;
  state.sedit = {kind:'person', personId:id, room_key:p.last.room_key, day:p.last.day, label:p.last.label, title:p.unnamed ? '이름 붙이기' : '이름 고치기', value:p.hasName ? p.shown.text : '', chipId:'', keyed:p.keyed, excludeId:id, allowEmpty:p.hasName, status:'', busy:false};
  state.status = ''; paintList(); $('#tgList [data-tg-sbox-input]')?.focus({preventScroll:false});
}
function startMan(id, kind) {
  if (!personOf(id) || state.busy) return;
  endEdit(); state.sman = {id, kind, to:'', status:'', busy:false}; state.status = ''; paintList();
  $(`#tgList [data-tg-sman] ${kind === 'merge' ? '[data-tg-sman-to]' : '[data-tg-sman-save]'}`)?.focus({preventScroll:false});
}
// 이름 상자·합치기·지우기 창을 닫는다(저장하지 않음). 폰의 뒤로가기도 같은 길로 닫힌다.
function endEdit() { state.sedit = null; const l = editLayer; editLayer = null; l?.close(); }
function cancelPanel() {
  const kind = state.sedit?.kind, person = state.sedit?.personId || state.sman?.id; state.sman = null; endEdit();
  if (kind === 'raw') { paintDetail(); $('#tgDetail [data-tg-name-open]')?.focus({preventScroll:true}); }
  else { paintList(); $(`#tgList [data-tg-person="${CSS.escape(person || '')}"] button`)?.focus({preventScroll:true}); }
}
function saveName() {
  const e = state.sedit; if (!e || e.busy || state.busy) return;
  const c = cleanName(e.value), clear = e.allowEmpty && !String(e.value).trim();
  if (!c.ok && !clear) { e.status = NAME_ERROR_TEXT[c.error]; paintEdit(); return; }
  e.busy = true; e.status = ''; paintEdit();
  return guarded(async current => {
    const res = await setSenderName(e.room_key, e.day, e.label, clear ? '' : c.name, rt); if (!current()) return;
    if (!res.ok) { e.busy = false; e.status = SENDER_FAIL_TEXT[res.error] || SENDER_FAIL_TEXT.REFUSED; if (res.error === 'GONE' || res.error === 'UNKNOWN') await reloadSenders(); return; }
    // 이미 있는 사람을 칩으로 골랐고 이번에 새로 생긴 열쇠 없는 사람이면 그 사람에게 합친다(열쇠가 사라질 일이 없는 경우만).
    let note = '';
    if (!clear && e.chipId && res.keyed === false && res.id && res.id !== e.chipId) { const m = await mergeSenders(res.id, e.chipId, rt); if (!current()) return; if (!m.ok) note = ' 같은 사람으로 묶지는 못했어요.'; }
    const ok = await reloadSenders(); if (!current()) return;
    state.sedit = null; const l = editLayer; editLayer = null; l?.close();
    state.status = (clear ? '직접 붙인 이름을 지웠어요.' : '이름을 붙였어요.') + note + (ok ? '' : ' 목록은 다시 불러오지 못했어요.');
  }).then(() => { if (!state.sedit) (state.mode === 'senders' ? $('#tgList [data-tg-shelf-back]') : $('#tgDetail [data-tg-more]'))?.focus({preventScroll:true}); });
}
function saveMan() {
  const m = state.sman; if (!m || m.busy || state.busy) return; const p = personOf(m.id); if (!p) return;
  if (m.kind === 'merge' && !m.to) return;
  m.busy = true; m.status = ''; paintList();
  return guarded(async current => {
    const res = m.kind === 'merge' ? await mergeSenders(m.id, m.to, rt) : await forgetSender(m.id, rt); if (!current()) return;
    if (!res.ok) { m.busy = false; m.status = SENDER_FAIL_TEXT[res.error] || SENDER_FAIL_TEXT.REFUSED; if (res.error === 'GONE' || res.error === 'UNKNOWN') await reloadSenders(); return; }
    const ok = await reloadSenders(); if (!current()) return;
    state.sman = null; state.status = (m.kind === 'merge' ? '합쳤어요.' : '이름표를 지웠어요.') + (ok ? '' : ' 목록은 다시 불러오지 못했어요.');
  }).then(() => { if (!state.sman) $('#tgList [data-tg-shelf-back]')?.focus({preventScroll:true}); });
}

// ---------- actions
// 방 상세 열기. item: 열자마자 원문을 펼칠 소식. 폰은 router layer 한 칸(뒤로가기 = 목록).
function select(room, day, item = '') {
  if (state.link && !dropLink()) return;
  if (state.sedit?.kind === 'raw') endEdit();
  state.sel = {room, day}; state.status = ''; state.note = ''; state.open = new Set(item ? [item] : []); state.more = new Set(); undo = null;
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('telegram-day', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
  paint(); void ensureDetail().then(() => { if (item) void loadRaw(item); });
  (pc.matches ? $(`#tgList [data-tg-rdopen="${CSS.escape(rdKey(room, day))}"]`) : $('#tgDetail [data-tg-back]'))?.focus({preventScroll:true});
}
function closeDetail({fromBack = false, quiet = false} = {}) {
  const key = selKey(); state.sel = null; state.link = null; state.note = ''; state.open = new Set(); state.more = new Set(); if (state.sedit?.kind === 'raw') endEdit();
  const l = layer; layer = null; if (!fromBack) l?.close();
  if (quiet) return;
  paint(); $(`#tgList [data-tg-rdopen="${CSS.escape(key)}"]`)?.focus({preventScroll:true});
}
// ‹ ›: 그 방의 앞뒤 날. 더 오래된 날이 아직 안 읽혔으면 이전 창을 읽어 가며 찾는다(한계 120일).
async function navDay(dir) {
  const sel = state.sel; if (!sel || state.busy) return;
  if (state.link && !dropLink()) return;
  let nb = neighborDays(state.lines, sel.room, sel.day);
  if (dir === 'prev' && !nb.prev) {
    state.busy = true; state.status = '이전 날을 찾는 중…'; paintDetail();
    try { while (!nb.prev && !state.end && await extend()) nb = neighborDays(state.lines, sel.room, sel.day); }
    catch { state.status = '이전 날을 불러오지 못했어요.'; }
    state.busy = false; if (state.sel !== sel) return;
    if (!nb.prev) { if (state.status === '이전 날을 찾는 중…') state.status = '더 이전 소식이 없어요.'; paint(); return; }
    state.status = '';
  }
  const day = dir === 'prev' ? nb.prev : nb.next; if (!day) return;
  if (state.sedit?.kind === 'raw') endEdit();
  state.sel = {room:sel.room, day}; state.open = new Set(); state.more = new Set(); state.link = null; state.note = ''; state.status = '';
  paint(); void ensureDetail();
}
function dropLink() { const r = itemOf(state.link?.rowId), changed = state.link && r && state.link.summary.trim() !== newLinkBox(r).summary.trim(); if (changed && !window.confirm('쓰던 요약을 버릴까요?')) return false; state.link = null; return true; }
const replaceRow = saved => {
  for (const d of state.dcache.values()) if (d.items) d.items = d.items.map(r => r.id === saved.id ? {...r, ...saved} : r);
  state.pins = state.pins.map(r => r.id === saved.id ? {...r, ...saved} : r);
};
async function guarded(fn) {
  if (state.busy) return; const owner = scopeOf(rt); state.busy = true;
  try { await fn(() => owner === scopeOf(rt)); } finally { state.busy = false; if (owner === scopeOf(rt)) paint(); }
}
const gone = () => { state.status = '이 소식이 그사이 사라졌어요. 목록을 다시 불러왔어요.'; return load(); };
function pin(r) {
  return guarded(async current => {
    try {
      const saved = await setPinned(r.id, !r.pinned_at, rt); if (!current()) return; if (!saved) return void await gone();
      replaceRow(saved); state.pins = saved.pinned_at ? [...state.pins.filter(x => x.id !== saved.id), saved] : state.pins.filter(x => x.id !== saved.id);
      state.status = saved.pinned_at ? '고정했어요.' : '고정을 풀었어요.';
    } catch { if (current()) state.status = '저장하지 못했어요. 다시 시도해 주세요.'; }
  });
}
const MOVE_FAIL = {
  UNAVAILABLE:'이 기능이 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  REFUSED:'저장하지 못했어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'저장했는지 확인하지 못했어요. 목록을 다시 불러왔어요.',
};
function armUndo() {
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undo = null; view()?.querySelector('[data-tg-undobar]')?.remove(); }, UNDO_MS);
}
const setUndo = (text, fn) => { undo = {text, fn}; armUndo(); };
// 소식 한 줄 삭제(휴지통). 목록·상세에서 바로 빠지고 '삭제했어요 · 되돌리기' 한 줄이 하단바 위에 뜬다.
function trashItem(r) {
  return guarded(async current => {
    const saved = await setFeedState(r.id, 'trashed', rt); if (!current()) return;
    if (!saved.ok) { if (saved.error === 'GONE') return void await gone(); state.status = MOVE_FAIL[saved.error] || MOVE_FAIL.REFUSED; if (saved.error === 'UNKNOWN') void load(); return; }
    state.status = ''; const key = rdKey(r.room_key, r.day), d = state.dcache.get(key);
    if (d?.items) d.items = d.items.filter(x => x.id !== r.id);
    state.pins = state.pins.filter(x => x.id !== r.id); state.open.delete(r.id); if (state.link?.rowId === r.id) state.link = null;
    state.trashed = [{...r, hidden_at:saved.hidden_at || new Date().toISOString()}, ...state.trashed];
    const line = lineAt(r.room_key, r.day);
    if (line) { line.item_count = Math.max(0, line.item_count - 1); line.raw_count = Math.max(0, line.raw_count - (Number(r.raw_count) || 0)); if (!line.item_count) state.lines = state.lines.filter(x => x !== line); }
    if (selKey() === key && !(d?.items?.length)) closeDetail({quiet:true});
    setUndo('삭제했어요', () => restoreItem(r.id, true));
  });
}
function restoreItem(id, fromUndo = false) {
  return guarded(async current => {
    const saved = await setFeedState(id, 'active', rt); if (!current()) return;
    if (!saved.ok) { state.status = saved.error === 'GONE' ? '이 소식이 그사이 사라졌어요.' : fromUndo ? '되돌리지 못했어요. 다시 시도해 주세요.' : (MOVE_FAIL[saved.error] || MOVE_FAIL.REFUSED); return; }
    state.status = fromUndo ? '되돌렸어요.' : '되살렸어요.'; await load();
  });
}
function restore() {
  const u = undo; if (!u) return; undo = null; clearTimeout(undoTimer);
  return u.fn();
}
// ---------- 방 폴더·보관, 날 줄 삭제 (DB 함수로만 저장, 화면은 저장이 끝난 뒤에 바꾼다)
const roomRow = room => state.rooms.get(room) || {room_label:labelOfRoom(room), folder_id:null, archived_at:null};
const folderName = id => state.folders.find(f => f.id === id)?.name || '';
const ROOM_FAIL = {...MOVE_FAIL, GONE:'이 방을 찾지 못했어요. 목록을 다시 불러왔어요.'};
function applyRooms(rooms) { state.rooms = rooms; state.lines = withRoomState(state.lines, rooms); state.swipe = null; }
// 방의 폴더·보관을 정하고 되돌리기 줄을 건다(guarded 안에서 부른다). 성공하면 true.
async function roomCore(room, folder, archived, text, current, isUndo = false) {
  const prev = roomRow(room), saved = await setRoom(room, folder, archived, rt); if (!current()) return false;
  if (!saved.ok) { state.status = ROOM_FAIL[saved.error] || ROOM_FAIL.REFUSED; if (saved.error === 'UNKNOWN' || saved.error === 'GONE') void load(); return false; }
  const rooms = new Map(state.rooms); rooms.set(room, {...prev, folder_id:folder || null, archived_at:archived ? (prev.archived_at || new Date().toISOString()) : null});
  applyRooms(rooms);
  if (state.mode === 'archive' && !archivedRooms(rooms, state.lines).length) leaveShelf();
  if (isUndo) { state.status = '되돌렸어요.'; undo = null; }
  else { state.status = ''; setUndo(text, () => guarded(c => roomCore(room, prev.folder_id, !!prev.archived_at, '', c, true))); }
  return true;
}
const moveRoom = (room, folder, archived, text) => guarded(current => roomCore(room, folder, archived, text, current));
function trashDay(room, day) {
  return guarded(async current => {
    const saved = await setRoomDay(room, day, 'trashed', rt); if (!current()) return;
    if (!saved.ok) { state.status = ROOM_FAIL[saved.error] || ROOM_FAIL.REFUSED; if (saved.error === 'UNKNOWN' || saved.error === 'GONE') void load(); return; }
    const at = new Date().toISOString();
    state.lines = state.lines.map(l => (l.room_key === room && l.day === day ? {...l, day_hidden_at:at} : l));
    state.trashedDays = [{room_key:room, day, hidden_at:at}, ...state.trashedDays.filter(d => !(d.room_key === room && d.day === day))];
    state.swipe = null; state.status = '';
    if (state.sel?.room === room && state.sel.day === day) closeDetail({quiet:true});
    setUndo('삭제했어요', () => restoreDay(room, day, true));
  });
}
function restoreDay(room, day, fromUndo = false) {
  return guarded(async current => {
    const saved = await setRoomDay(room, day, 'active', rt); if (!current()) return;
    if (!saved.ok) { state.status = saved.error === 'GONE' ? '이 날 줄이 그사이 사라졌어요.' : fromUndo ? '되돌리지 못했어요. 다시 시도해 주세요.' : (ROOM_FAIL[saved.error] || ROOM_FAIL.REFUSED); return; }
    state.status = fromUndo ? '되돌렸어요.' : '되살렸어요.'; undo = null; await load();
  });
}
// ---------- 폴더 만들기·이름 바꾸기·지우기
function startFolderEdit(kind, extra = {}) {
  state.swipe = null; if (state.mode !== 'live') return;
  state.fedit = {kind, value:kind === 'rename' ? folderName(state.folder) : '', id:state.folder, room:'', status:'', busy:false, ...extra};
  paintList(); const box = $('#tgList [data-tg-fedit]'); box?.scrollIntoView?.({block:'nearest'}); ($('#tgList [data-tg-fedit-input]') || $('#tgList [data-tg-fedit-save]'))?.focus({preventScroll:true});
}
function cancelFolderEdit() { state.fedit = null; paintList(); }
function saveFolder() {
  const e = state.fedit; if (!e || e.busy || state.busy) return;
  const fail = res => { if (res.error === 'GONE' || res.error === 'UNKNOWN') { state.fedit = null; state.status = FOLDER_ERROR_TEXT[res.error]; void load(); } else { e.busy = false; e.status = FOLDER_ERROR_TEXT[res.error] || FOLDER_ERROR_TEXT.REFUSED; } };
  if (e.kind === 'delete') {
    e.busy = true; paintList();
    return guarded(async current => {
      const res = await deleteFolder(e.id, rt); if (!current()) return; if (!res.ok) return void fail(res);
      state.folders = state.folders.filter(f => f.id !== e.id); const rooms = new Map(state.rooms);
      for (const [k, r] of rooms) if (r.folder_id === e.id) rooms.set(k, {...r, folder_id:null});
      applyRooms(rooms); if (state.folder === e.id) state.folder = ''; state.fedit = null; state.status = '폴더를 지웠어요. 방은 그대로 전체에 있어요.';
    }).then(() => $('#tgList [data-tg-folder=""]')?.focus({preventScroll:true}));
  }
  const c = cleanFolderName(e.value);
  if (!c.ok) { e.status = FOLDER_ERROR_TEXT[c.error]; paintList(); $('#tgList [data-tg-fedit-input]')?.focus({preventScroll:true}); return; }
  e.busy = true; e.status = ''; paintList();
  return guarded(async current => {
    const res = e.kind === 'rename' ? await renameFolder(e.id, c.name, rt) : await createFolder(c.name, rt); if (!current()) return; if (!res.ok) return void fail(res);
    const id = res.id || e.id, name = res.name || c.name;
    state.folders = e.kind === 'rename' ? state.folders.map(f => (f.id === id ? {...f, name} : f)) : [...state.folders, {id, name, sort_order:Number.MAX_SAFE_INTEGER}];
    state.fedit = null; state.status = e.kind === 'rename' ? '이름을 바꿨어요.' : '폴더를 만들었어요.';
    if (e.kind === 'create') { if (e.room) await roomCore(e.room, id, !!roomRow(e.room).archived_at, `'${name}'에 넣었어요`, current); else state.folder = id; }
  }).then(() => $('#tgList [data-tg-folder-add]')?.focus({preventScroll:true}));
}
// 휴지통·보낸 사람 이름 보기 (폰 뒤로가기는 소식 목록으로: router layer 한 칸).
function enterShelf(mode) {
  if (state.link && !dropLink()) return;
  if (state.sel) closeDetail({quiet:true});
  state.mode = mode; state.status = ''; state.sedit = null; state.sman = null;
  shelfLayer ||= window.KPTURouter?.layer?.open('telegram-shelf', {close:() => { shelfLayer = null; state.mode = 'live'; state.sedit = null; state.sman = null; paint(); return true; }}) || null;
  paint(); $('#tgList [data-tg-shelf-back]')?.focus({preventScroll:true});
}
function leaveShelf() { const l = shelfLayer; shelfLayer = null; state.mode = 'live'; state.sedit = null; state.sman = null; l?.close(); }
const tgText = r => summaryCopyText({title:r.room_label, meta:[dayLabel(r.day), hhmm(r.occurred_at)].filter(Boolean).join(' '), body:[sumOf(r)]});
const dayText = () => {
  const d = detailOf(), sel = state.sel; if (!d?.items || !sel) return '';
  return summaryCopyText({title:lineAt(sel.room, sel.day)?.room_label || d.items[0]?.room_label || '', meta:dayLabel(sel.day), body:daySummary(d.parts, d.items, {partsKnown:d.parts !== null, edit:dayEdit(state.edits, sel.room, sel.day)}).lines});
};
const say = text => { state.status = text; for (const el of view()?.querySelectorAll('[data-tg-status],[data-tg-detail-status]') || []) el.innerHTML = statusHtml(); };
const copyTg = (text, button = null) => copySummary(text, {say, current:() => state.status, button});
function startLink(r) { if (!state.open.has(r.id)) { state.open.add(r.id); void loadRaw(r.id); } state.link = newLinkBox(r); paintDetail(); $('#tgDetail [data-tg-link-pick]')?.focus({preventScroll:true}); }
function saveLink() {
  const r = itemOf(state.link?.rowId), box = state.link; if (!r || !box) return;
  box.busy = true; paintDetail();
  return guarded(async current => {
    try { const res = await saveLinkBox(r, box, rt); if (!current()) return; if (!res.saved) return void await gone(); replaceRow(res.saved); state.link = null; state.status = res.text; window.dispatchEvent(new Event('kptu:basket-links-changed')); }
    catch { if (current()) { box.busy = false; box.status = '연결하지 못했어요. 다시 시도해 주세요.'; } }
  }).then(() => $('#tgDetail [data-tg-more]')?.focus({preventScroll:true}));
}
// [텔레그램에서 열기]가 방 주소로 열 수 없을 때: 방 이름을 복사하고 앱 첫 화면을 열고 안내 한 줄(설계 6.3절).
async function openByCopy() {
  const sel = state.sel; if (!sel) return;
  const label = lineAt(sel.room, sel.day)?.room_label || detailOf()?.items?.[0]?.room_label || '';
  const ok = label ? await copyText(label) : false;
  state.note = ok ? COPY_NOTE : '방 이름을 복사하지 못했어요. 텔레그램 첫 화면에서 방 이름을 직접 검색해 주세요.';
  window.open('tg://', '_blank', 'noopener');
  paintDetail();
}

// ---------- TG-요약고치기: 열기 · 저장 · AI 원래 요약으로. 저장은 서버(app_feed_summary_edit)뿐이고 이 기기에만 남기는 저장은 없다.
function startSumEdit(kind, target) {
  if (!editsOn() || state.busy || state.se?.busy) return;
  if (state.link && !dropLink()) return;
  if (kind === 'item') {
    const r = target; if (!r?.id) return;
    state.se = {kind, id:r.id, value:sumOf(r), edited:isItemEdited(r, state.edits), status:''};
  } else {
    const sel = state.sel, d = detailOf(); if (!sel || !d?.items) return;
    const e = dayEdit(state.edits, sel.room, sel.day), sum = daySummary(d.parts, d.items, {partsKnown:d.parts !== null, edit:e}), line = lineAt(sel.room, sel.day);
    state.se = {kind, room:sel.room, day:sel.day, value:linesToText(sum.lines), headline:lineView(line || {})?.headline || '', edited:!!e, status:''};
  }
  state.open.delete(state.se.id); paintDetail(); ($('#tgDetail [data-tg-se-text]'))?.focus({preventScroll:true});
}
function cancelSumEdit() { if (!state.se || state.se.busy) return; const was = state.se; state.se = null; paintDetail(); focusAfterSumEdit(was); }
function focusAfterSumEdit(was) { (was.kind === 'day' ? $('#tgDetail [data-tg-sumedit-day]') : $('#tgDetail [data-tg-more]'))?.focus({preventScroll:true}); }
const seArgs = se => (se.kind === 'item' ? {item:se.id} : {room:se.room, day:se.day});
// 서버가 돌려준 그 target의 고친 값 전부로 Map을 바꾸고 다시 그린다(빈 값이면 AI 값으로 돌아간 것).
function applySavedEdit(res) {
  const next = new Map(state.edits), vals = editMap([{target:res.target, vals:res.vals}]).get(res.target);
  if (vals) next.set(res.target, vals); else next.delete(res.target);
  state.edits = next; state.se = null;
}
function saveSumEdit() {
  const se = state.se; if (!se || se.busy || state.busy) return;
  let patch;
  if (se.kind === 'item') {
    const c = cleanSummaryInput(se.value);
    if (!c.ok) { se.status = sumEditErrorText(c.error); paintDetail(); $('#tgDetail [data-tg-se-text]')?.focus({preventScroll:true}); return; }
    const r = itemOf(se.id); patch = c.value === oneLineOf(sumOf(r)) ? {} : {summary:c.value};
  } else {
    const c = cleanDayInput({headline:se.headline, text:se.value});
    if (!c.ok) { se.status = sumEditErrorText(c.error); paintDetail(); (c.error === 'LONG_HEADLINE' ? $('#tgDetail [data-tg-se-head]') : $('#tgDetail [data-tg-se-text]'))?.focus({preventScroll:true}); return; }
    const d = detailOf(), e = dayEdit(state.edits, se.room, se.day), cur = daySummary(d?.parts, d?.items || [], {partsKnown:d?.parts !== null, edit:e});
    patch = dayPatch({headline:lineView(lineAt(se.room, se.day) || {})?.headline || '', lines:cur.lines}, c);
  }
  if (!Object.keys(patch).length) { const was = se; state.se = null; state.status = SUMEDIT_TEXT.noop; paintDetail(); focusAfterSumEdit(was); return; }
  return runSumEdit(se, patch, SUMEDIT_TEXT.done);
}
function resetSumEdit() {
  const se = state.se; if (!se || se.busy || state.busy) return;
  const e = se.kind === 'item' ? state.edits.get(itemTarget(se.id)) : dayEdit(state.edits, se.room, se.day);
  const keys = Object.keys(e || {}); if (!keys.length) { cancelSumEdit(); return; }
  return runSumEdit(se, {reset:keys}, SUMEDIT_TEXT.reset);
}
function runSumEdit(se, patch, doneText) {
  se.busy = true; se.status = ''; paintDetail();
  return guarded(async current => {
    const res = await editSummary({...seArgs(se), patch}, rt); if (!current()) return;
    if (!res.ok) {
      if (res.error === 'GONE' || res.error === 'UNKNOWN') { state.se = null; state.status = SUMEDIT_TEXT[res.error]; void load(); return; }
      se.busy = false; se.status = sumEditErrorText(res.error); return;
    }
    applySavedEdit(res); state.status = doneText;
  }).then(() => { paint(); (state.se ? $('#tgDetail [data-tg-se-text]') : (se.kind === 'day' ? $('#tgDetail [data-tg-sumedit-day]') : $('#tgDetail [data-tg-more]')))?.focus({preventScroll:true}); });
}
const oneLineOf = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// 소식 줄 ⋯ 메뉴(상세 안, 밀기 없음) · 머리줄 ⋯ 메뉴.
const menu = createAnchoredMenu({id:'tgMenu', className:'feed-menu', label:'소식 메뉴', historyKey:'kptuTelegramMenu',
  key:t => (t.hasAttribute('data-tg-head-more') ? 'head:' : 'item:' + t.dataset.tgMore),
  render:id => {
    if (id === 'head:') return `<button type="button" data-tg-act="senders">보낸 사람 이름</button>${trashCount() ? `<button type="button" data-tg-act="trash-view">휴지통 ${trashCount()}</button>` : ''}`;
    const r = itemOf(id.slice(id.indexOf(':') + 1)); if (!r) return '';
    const copy = tgText(r) ? '<button type="button" data-tg-act="copy">요약 복사</button>' : '';
    const fix = editsOn() && r.id ? '<button type="button" data-tg-act="sumedit">요약 고치기</button>' : '';
    return `<button type="button" data-tg-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button>${copy}${fix}<button type="button" data-tg-act="link">조직 연결</button><button type="button" class="feed-menu-danger" data-tg-act="trash">삭제</button>`;
  },
  onAction:(button, active) => {
    const act = button.dataset.tgAct;
    if (active.id === 'head:') { if (act === 'senders') enterShelf('senders'); else if (act === 'trash-view') enterShelf('trash'); return; }
    const r = itemOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return;
    if (act === 'pin') void pin(r); else if (act === 'trash') void trashItem(r); else if (act === 'copy') void copyTg(tgText(r)); else if (act === 'link') startLink(r); else if (act === 'sumedit') startSumEdit('item', r);
  }});
// 보낸 사람 이름 목록의 줄마다 ⋯: 이름 고치기 · 다른 사람과 합치기 · 지우기.
const pmenu = createAnchoredMenu({id:'tgPersonMenu', className:'feed-menu', label:'보낸 사람 메뉴', historyKey:'kptuTelegramPersonMenu',
  key:t => 'person:' + t.dataset.tgPersonMore,
  render:id => {
    const p = personOf(id.slice(id.indexOf(':') + 1)); if (!p) return '';
    return `<button type="button" data-tg-pact="rename">${p.unnamed ? '이름 붙이기' : '이름 고치기'}</button>${peopleList().length > 1 ? '<button type="button" data-tg-pact="merge">다른 사람과 합치기</button>' : ''}<button type="button" class="feed-menu-danger" data-tg-pact="forget">지우기 <span class="feed-faint">소식 글은 그대로</span></button>`;
  },
  onAction:(button, active) => {
    const id = active.id.slice(active.id.indexOf(':') + 1), act = button.dataset.tgPact;
    if (act === 'rename') startPersonEdit(id); else if (act === 'merge') startMan(id, 'merge'); else if (act === 'forget') startMan(id, 'forget');
  }});

// 방 줄 ⋯ 메뉴(PC) · 길게 누르기(폰) · 오른쪽 클릭(PC): 폴더로 · 보관 · 삭제(그 날 한 줄만).
const rowKeyOf = t => { const w = t.closest('[data-tg-swipe]'); return w ? w.dataset.room + '|' + w.dataset.day : ''; };
let wantPicker = false;
const rmenu = createAnchoredMenu({id:'tgRowMenu', className:'feed-menu', label:'방 메뉴', historyKey:'kptuTelegramRowMenu',
  key:t => 'row:' + rowKeyOf(t),
  render:id => {
    const k = splitRdKey(id.slice(4)); if (!k || !lineAt(k.room, k.day)) return '';
    return `<button type="button" data-tg-ract="folder">폴더로</button><button type="button" data-tg-ract="archive">보관</button><button type="button" class="feed-menu-danger" data-tg-ract="trash">삭제 <span class="feed-faint">이 날 한 줄만</span></button>`;
  },
  onAction:(button, active) => {
    const k = splitRdKey(active.id.slice(4)); if (!k) return; const act = button.dataset.tgRact;
    if (act === 'folder') { wantPicker = true; fmenu.open(active.trigger); }
    else if (act === 'archive') void moveRoom(k.room, roomRow(k.room).folder_id, true, '보관했어요');
    else if (act === 'trash') void trashDay(k.room, k.day);
  },
  onClose:() => { if (wantPicker) { wantPicker = false; return; } hold.unpin(); }});
// [폴더로]: 작은 폴더 목록 + 폴더에서 빼기 + 새 폴더. 밀기 버튼이나 ⋯를 누른 자리 아래에 뜬다.
const fmenu = createAnchoredMenu({id:'tgFolderPick', className:'feed-menu', label:'폴더 고르기', historyKey:'kptuTelegramFolderPick',
  key:t => 'pick:' + (t.closest('[data-tg-swipe]')?.dataset.room || ''),
  render:id => {
    const room = id.slice(5), cur = roomRow(room).folder_id || '';
    const list = state.folders.map(f => `<button type="button" data-tg-fpick="${esc(f.id)}"${f.id === cur ? ' aria-current="true"' : ''}>${f.id === cur ? '✓ ' : ''}${esc(f.name)}</button>`).join('');
    return `${list}${cur ? '<button type="button" data-tg-fpick="">폴더에서 빼기</button>' : ''}<button type="button" data-tg-fpick="+">+ 새 폴더</button>`;
  },
  onAction:(button, active) => {
    const room = active.id.slice(5), pick = button.dataset.tgFpick, archived = !!roomRow(room).archived_at;
    if (pick === '+') startFolderEdit('create', {room});
    else if (pick === '') void moveRoom(room, null, archived, '폴더에서 뺐어요');
    else void moveRoom(room, pick, archived, `'${folderName(pick)}'에 넣었어요`);
  },
  onClose:() => hold.unpin()});
const femenu = createAnchoredMenu({id:'tgFolderMenu', className:'feed-menu', label:'폴더 메뉴', historyKey:'kptuTelegramFolderMenu',
  key:() => 'folder:' + state.folder,
  render:() => '<button type="button" data-tg-fact="rename">이름 바꾸기</button><button type="button" class="feed-menu-danger" data-tg-fact="delete">폴더 지우기 <span class="feed-faint">방은 그대로</span></button>',
  onAction:button => { if (state.folder) startFolderEdit(button.dataset.tgFact === 'rename' ? 'rename' : 'delete'); }});
const hold = createFeedHold({menu:rmenu, itemSelector:'[data-tg-rd]', moreSelector:'[data-tg-rdmore]', skipSelector:'[data-tg-act-btn],[data-tg-unarchive]', busy:() => state.busy, isPhone:() => !pc.matches});

// 줄 밀기(폰, 터치만): 가로로 분명히 밀었을 때만 반응하고 세로 스크롤·화면 가장자리 시작은 건드리지 않는다. 열린 줄은 하나뿐.
const swipeEl = key => [...view()?.querySelectorAll('[data-tg-swipe]') || []].find(el => el.dataset.tgSwipe === key) || null;
function syncSwipe(wrap, side) {
  if (side) wrap.dataset.side = side; else delete wrap.dataset.side;
  const inner = wrap.querySelector(':scope > .feed-rd'); if (inner) inner.style.transform = '';
  for (const b of wrap.querySelectorAll('[data-tg-act-btn]')) { const on = b.dataset.tgActBtn === side; if (on) b.removeAttribute('aria-hidden'); else b.setAttribute('aria-hidden', 'true'); b.tabIndex = on ? 0 : -1; }
}
function closeSwipe() {
  const open = state.swipe; if (!open) return; state.swipe = null;
  const el = swipeEl(open.key); if (el) syncSwipe(el, '');
}
let drag = null, swallow = false;
function bindSwipe(root) {
  root.addEventListener('pointerdown', e => {
    swallow = false;
    if (e.pointerType !== 'touch' || state.busy) return;
    const inner = e.target.closest('.feed-swipe > .feed-rd'); if (!inner || e.target.closest('[data-tg-act-btn]')) return;
    const wrap = inner.parentElement, key = wrap.dataset.tgSwipe;
    if (state.swipe && state.swipe.key !== key) closeSwipe();
    if (swipeEdge(e.clientX, innerWidth)) return;
    const mode = wrap.dataset.mode, allow = allowOf(mode), open = state.swipe?.key === key ? swipeOpenOffset(state.swipe.side, allow) : 0;
    drag = {id:e.pointerId, x:e.clientX, y:e.clientY, wrap, inner, key, allow, open, dx:0, on:false};
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      const intent = swipeIntent(dx, dy); if (intent === 'wait') return;
      if (intent === 'scroll') { drag = null; return; }
      drag.on = true; drag.inner.classList.add('is-drag'); try { drag.inner.setPointerCapture(e.pointerId); } catch {}
    }
    drag.dx = dx; drag.inner.style.transform = `translateX(${swipeOffset(dx, drag.open, drag.allow)}px)`;
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null;
    if (!d.on) return;
    swallow = true; d.inner.classList.remove('is-drag');
    const side = e.type === 'pointercancel' ? (state.swipe?.key === d.key ? state.swipe.side : '') : swipeSettle(swipeOffset(d.dx, d.open, d.allow), d.allow);
    state.swipe = side ? {key:d.key, side} : null; syncSwipe(d.wrap, side);
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  // 밀고 손을 뗄 때 따라오는 click은 삼킨다(줄이 열리는 것을 막는다).
  window.addEventListener('click', e => { if (swallow && root.contains(e.target)) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

function bind() {
  const root = view(); if (!root || root.dataset.tgBound) return; root.dataset.tgBound = '1';
  hold.bind(root); bindSwipe(root);
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    const d = b.dataset;
    if (state.swipe && !b.closest('[data-tg-act-btn]')) { const was = state.swipe.key; closeSwipe(); if (d.tgRdopen && b.closest('[data-tg-swipe]')?.dataset.tgSwipe === was) return; }
    if (d.tgActBtn) {
      const w = b.closest('[data-tg-swipe]'), room = w?.dataset.room, day = w?.dataset.day, kind = d.tgKind; if (!room) return;
      if (kind === 'folder') fmenu.open(b);
      else if (kind === 'archive') { closeSwipe(); void moveRoom(room, roomRow(room).folder_id, true, '보관했어요'); }
      else if (kind === 'unarchive') { closeSwipe(); void moveRoom(room, roomRow(room).folder_id, false, '꺼냈어요'); }
      else if (kind === 'trash' && day) { closeSwipe(); void trashDay(room, day); }
    }
    else if (d.tgUnarchive) void moveRoom(d.tgUnarchive, roomRow(d.tgUnarchive).folder_id, false, '꺼냈어요');
    else if (d.tgRdmore) rmenu.open(b);
    else if (b.hasAttribute('data-tg-folder-more')) femenu.open(b);
    else if (d.tgFolder !== undefined) { state.folder = d.tgFolder; state.fedit = null; paintList(); $(`#tgList [data-tg-folder="${CSS.escape(d.tgFolder)}"]`)?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-tg-folder-add')) startFolderEdit('create');
    else if (d.tgShelf) enterShelf(d.tgShelf);
    else if (b.hasAttribute('data-tg-fedit-cancel')) cancelFolderEdit();
    else if (b.hasAttribute('data-tg-fedit-save')) void saveFolder();
    else if (d.tgRestoreDay) { const k = splitRdKey(d.tgRestoreDay); if (k) void restoreDay(k.room, k.day); }
    else if (d.tgRdopen) { const k = splitRdKey(d.tgRdopen); if (k) select(k.room, k.day); }
    else if (d.tgPinOpen) { const r = itemOf(d.tgPinOpen); if (r) { select(r.room_key, r.day, r.id); } }
    else if (d.tgNav) void navDay(d.tgNav);
    else if (d.tgRestore) void restoreItem(d.tgRestore);
    else if (b.hasAttribute('data-tg-older')) { b.disabled = true; void extend().then(() => paintList()).catch(() => { state.status = '이전 날을 불러오지 못했어요.'; paintList(); }); }
    else if (b.hasAttribute('data-tg-shelf-back')) { leaveShelf(); paint(); }
    else if (d.tgRtMore) { const k = d.tgRtMore; if (state.more.has(k)) state.more.delete(k); else state.more.add(k); paintDetail(); $(`#tgDetail [data-tg-rt-more="${CSS.escape(k)}"]`)?.focus({preventScroll:true}); }
    else if (d.tgOpen) { const id = d.tgOpen; if (state.open.has(id)) { state.open.delete(id); if (state.link?.rowId === id && !dropLink()) { state.open.add(id); return; } if (state.sedit?.rowId === id) endEdit(); } else { state.open.add(id); void loadRaw(id); } paintDetail(); }
    else if (d.tgMore) menu.open(b);
    else if (b.hasAttribute('data-tg-head-more')) menu.open(b);
    else if (d.tgPersonMore) pmenu.open(b);
    else if (d.tgNameOpen) startRawEdit(d.tgNameOpen, b.closest('[data-tg-di]')?.dataset.tgDi);
    else if (d.tgPersonName) startPersonEdit(d.tgPersonName);
    else if (b.hasAttribute('data-tg-sbox-cancel') || b.hasAttribute('data-tg-sman-cancel')) cancelPanel();
    else if (b.hasAttribute('data-tg-sbox-save')) void saveName();
    else if (b.hasAttribute('data-tg-sman-save')) void saveMan();
    else if (d.tgSboxChip) { const e = state.sedit, c = chipsOf(peopleList(), e?.excludeId).find(x => x.id === d.tgSboxChip); if (e && c) { e.value = c.text; e.chipId = c.id; e.status = ''; paintEdit(); $(`${e.kind === 'person' ? '#tgList' : '#tgDetail'} [data-tg-sbox-input]`)?.focus({preventScroll:true}); } }
    else if (b.hasAttribute('data-tg-daycopy')) void copyTg(dayText(), b);
    else if (b.hasAttribute('data-tg-sumedit-day')) startSumEdit('day');
    else if (b.hasAttribute('data-tg-se-cancel')) cancelSumEdit();
    else if (b.hasAttribute('data-tg-se-save')) void saveSumEdit();
    else if (b.hasAttribute('data-tg-se-orig')) void resetSumEdit();
    else if (b.hasAttribute('data-tg-opencopy')) void openByCopy();
    else if (b.hasAttribute('data-tg-back')) { if (!state.link || dropLink()) closeDetail(); }
    else if (b.hasAttribute('data-tg-retry')) void load();
    else if (b.hasAttribute('data-tg-undo')) void restore();
    else if (b.hasAttribute('data-tg-link-pick')) { const box = state.link; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#tgDetail [data-tg-link-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-tg-link-cancel')) { state.link = null; paintDetail(); }
    else if (b.hasAttribute('data-tg-link-save')) void saveLink();
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.closest?.('[data-tg-sbox],[data-tg-sman],[data-tg-fedit],[data-tg-se]') && !e.defaultPrevented) { e.preventDefault(); if (e.target.closest('[data-tg-fedit]')) cancelFolderEdit(); else if (e.target.closest('[data-tg-se]')) cancelSumEdit(); else cancelPanel(); } });
  root.addEventListener('change', e => {
    if (e.target.matches('[data-tg-sman-to]') && state.sman) { state.sman.to = e.target.value; paintList(); $('#tgList [data-tg-sman-to]')?.focus({preventScroll:true}); return; }
  });
  root.addEventListener('input', e => {
    if (e.target.matches('[data-tg-fedit-input]') && state.fedit) state.fedit.value = e.target.value;
    if (e.target.matches('[data-tg-link-text]') && state.link) state.link.summary = e.target.value;
    if (e.target.matches('[data-tg-se-text]') && state.se) state.se.value = e.target.value;
    if (e.target.matches('[data-tg-se-head]') && state.se) state.se.headline = e.target.value;
    if (e.target.matches('[data-tg-sbox-input]') && state.sedit) { const v = e.target.value, chip = state.sedit.chipId && chipsOf(peopleList(), state.sedit.excludeId).find(x => x.id === state.sedit.chipId); state.sedit.value = v; if (!chip || chip.text !== v.trim()) state.sedit.chipId = ''; }
  });
}
bind();

window.addEventListener('kptu:view-changed', e => {
  if (e.detail?.view === 'telegram') { if (!state.loaded || state.owner !== scopeOf(rt)) void load(); else paint(); return; }
  layer = null; shelfLayer = null; editLayer = null; state.link = null; state.sedit = null; state.sman = null; state.fedit = null; state.se = null; state.swipe = null; state.mode = 'live'; menu.close?.(null, true); pmenu.close?.(null, true); rmenu.close?.(null, true); fmenu.close?.(null, true); femenu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; shelfLayer = null; editLayer = null; undo = null; clearTimeout(undoTimer); state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches && layer) { const l = layer; layer = null; l.close(); } paint(); } });
paint();
window.KPTUTelegramFeed = {reload:() => load()};
