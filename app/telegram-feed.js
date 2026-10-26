// TG-방날짜묶기 4-가 (docs/design/tg-room-day-group.md 2절, 시안 mockups/tg-room-day-group.html): 텔레그램 소식 화면(?view=telegram, 사이드바 맨 아래).
// 이 모듈이 #telegramView의 유일한 renderer다. 머리줄 '텔레그램 소식' + "오늘 n개 중 중요한 m개 · 방 k곳" + 방 거르기, 고정 띠, 작은 가운데 날짜,
// 그 아래 "방 한 줄"(방 머리글자·방 이름·그날 내용 한 줄·소식 n·원문 n). 줄을 누르면 방 상세가 열린다(PC 오른쪽 2/3, 폰 router layer 한 칸):
// ← 방 이름 [텔레그램에서 열기], ‹ 날짜 ›(그 방의 앞뒤 날), 맨 위 요약 3~4줄(AI가 쓴 하루 요약, 없는 날은 소식 제목 모음), 그날 소식(시각·원문 n·⋯).
// 소식 줄은 눌러 원문을 펼치고 ⋯ 메뉴(고정·요약 복사·조직 연결·삭제)만 있다. 삭제는 휴지통(hidden_at, 자동으로 비우지 않음)이고 머리줄 ⋯ → 휴지통에서 되살린다.
// 읽기: DB 함수 app_feed_room_day_lines(14일씩) + 소유자 읽기 표(feed-data.js), 규칙은 tg-day-model.mjs. 소식 삭제·되살리기는 DB 함수 app_feed_set_state.
// TG-발언자이름: 원문에 이름을 입히고([이름 붙이기]) 머리줄 ⋯ → '보낸 사람 이름'에서 관리한다(tg-sender-model.mjs, tg-sender-data.js). 방 색은 저장하지 않는다(feed-model.mjs roomTone).
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {mountSplitResize} from './split-resize.js';
import {hhmm, dayLabel, telegramLines, telegramToday, telegramHeadText, roomTone, roomInitial, pinnedOf, missingTable, kstDay} from './feed-model.mjs';
import {readDays, readRaw, readOrganizations, setPinned, setFeedState, scopeOf, readRoomDayLines, readRoomDay, readTitleRows, readPinnedItems, readTrashedItems} from './feed-data.js';
import {summaryCopyText} from './summary-copy-model.mjs';
import {copyButtonHtml, copySummary} from './summary-copy.js';
import {copyText} from './copy-text.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';
import {buildIndex, rawRows, peopleRows, chipsOf, cleanName, linkKey, dayShort, NAME_ERROR_TEXT, SENDER_FAIL_TEXT, MERGE_NOTE, MERGE_BOTH_KEYED} from './tg-sender-model.mjs';
import {readSenders, setSenderName, mergeSenders, forgetSender} from './tg-sender-data.js';
import {lineOf, rdKey, splitRdKey, liveLines, groupLines, roomsOfLines, neighborDays, daysNeedingTitles, titleIndex, lineText, daySummary, openTarget, COPY_NOTE,
  firstWindow, olderWindow, reachedEnd, chunksOf} from './tg-day-model.mjs';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const MORE = '<span aria-hidden="true">⋯</span>';
const UNDO_MS = 8000;

// state.mode: live (방·날 목록) | trash (휴지통) | senders (보낸 사람 이름). state.sel: 열린 방 상세 {room, day}. state.open: 원문을 펼친 소식 ID.
let state = fresh(), run = 0, layer = null, shelfLayer = null, editLayer = null, undo = null, undoTimer = 0;
function fresh() { return {owner:'', loaded:false, missing:false, error:'', lines:[], from:'', end:false, titles:new Map(), pins:[], trashed:[], mode:'live', days:[], orgs:[], mine:new Set(), room:'', sel:null, open:new Set(), dcache:new Map(), raw:new Map(), link:null, senders:null, sidx:null, sedit:null, sman:null, note:'', status:'', busy:false}; }

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
const isShelf = () => state.mode === 'trash' || state.mode === 'senders';

// ---------- data
async function readLines(from, to) { return (await readRoomDayLines(chunksOf(from, to), rt)).map(lineOf).filter(Boolean); }
async function load() {
  const owner = scopeOf(rt), me = ++run; if (!state.loaded) paint();
  const today = kstDay(), first = firstWindow(today), from = state.from && state.from < first.from ? state.from : first.from;
  try {
    const [lines, days, orgs, senders, pins, trashed] = await Promise.all([readLines(from, today), readDays('telegram', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()})), readSenders(rt).catch(() => null), readPinnedItems(rt).catch(() => []), readTrashedItems(rt).catch(() => [])]);
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, missing:false, error:'', lines, from, end:reachedEnd(from, today), pins, trashed, days, orgs:orgs.orgs, mine:orgs.mine, dcache:new Map()});
    setSenders(senders);
    if (state.mode === 'trash' && !trashed.length) leaveShelf();
    if (state.room && !lines.some(l => l.room_key === state.room)) state.room = '';
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
  state.lines = [...state.lines, ...lines]; state.from = win.from; state.end = reachedEnd(win.from, today);
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
  mountSplitResize({container:$('#tgSplit'), name:'tasks', label:'텔레그램 소식과 방 상세 칸 폭 조절', list:() => $('#tgList'), pane:() => $('#tgDetail'), active:() => pc.matches && !view()?.classList.contains('hidden')});
}
const statusHtml = () => esc(state.status);
const undoHtml = () => (undo ? `<div class="feed-undo" role="status" data-tg-undobar><span>${esc(undo.text)}</span><span aria-hidden="true">·</span><button type="button" class="feed-undo-btn" data-tg-undo>되돌리기</button></div>` : '');
function headHtml() {
  if (state.mode === 'senders') {
    const n = state.senders ? state.senders.senders.length : 0;
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">보낸 사람 이름${state.senders ? ` · ${n}명` : ''}</span></div>`;
  }
  if (state.mode === 'trash') {
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">휴지통 ${state.trashed.length}</span></div><p class="feed-note" data-tg-trash-note>Web2 목록에서만 뺀 소식이에요. 원문은 Drive에 그대로 있어요. 직접 비우기 전까지 남아요.</p>`;
  }
  const today = telegramToday(state.days, kstDay()), rooms = roomsOfLines(liveLines(state.lines));
  const filter = rooms.length > 1 || state.room ? `<select class="feed-select" data-tg-room aria-label="방 거르기"><option value="">모든 방</option>${rooms.map(x => `<option value="${esc(x.key)}"${x.key === state.room ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : '';
  const failed = today?.failed ? ` · 판정 실패 ${today.failed}` : '';
  const ready = state.loaded && !state.missing && !state.error;
  const more = ready ? `<button type="button" class="feed-more" data-tg-head-more aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴">${MORE}</button>` : '';
  return `<div class="feed-head"><span class="feed-head-title" aria-hidden="true">텔레그램 소식</span><span class="feed-head-sub" data-tg-today>${ready ? esc(telegramHeadText(today) + failed) : ''}</span>${state.loaded && !state.missing ? filter : ''}${more}</div>`;
}
function rowHtml(l) {
  const key = rdKey(l.room_key, l.day), on = key === selKey(), text = lineText(l, state.titles);
  return `<div class="feed-rd feed-r${roomTone(l.room_key)}${on ? ' is-selected' : ''}" data-tg-rd="${esc(key)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(l.room_label))}</span><button type="button" class="feed-rdb" data-tg-rdopen="${esc(key)}"${on ? ' aria-current="true"' : ''}><span class="feed-rn">${esc(l.room_label)}</span><span class="feed-rl">${esc(text)}</span><span class="feed-ft"><span>소식 ${l.item_count}</span><span>원문 ${l.raw_count}</span></span></button></div>`;
}
function trashRowHtml(r) {
  return `<div class="feed-rd feed-r${roomTone(r.room_key)}" data-tg-trow="${esc(r.id)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(r.room_label))}</span><div class="feed-rdb"><span class="feed-rn">${esc(r.room_label)} · ${esc(dayLabel(r.day))} ${esc(hhmm(r.occurred_at))}</span><span class="feed-rl">${esc(r.summary || r.title || '')}</span></div><button type="button" class="feed-small" data-tg-restore="${esc(r.id)}">되살리기</button></div>`;
}
function paintList() {
  const box = $('#tgList');
  if (!state.loaded) { box.innerHTML = headHtml() + '<p class="feed-empty" role="status">불러오는 중…</p>'; return; }
  if (state.missing) { box.innerHTML = headHtml() + '<p class="feed-empty" data-tg-empty="ready">준비 중이에요. 텔레그램 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = headHtml() + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-tg-retry>다시 시도</button></p>`; return; }
  if (state.mode === 'senders') { box.innerHTML = headHtml() + sendersBodyHtml() + `<p class="feed-status" data-tg-status role="status">${statusHtml()}</p>`; return; }
  if (state.mode === 'trash') { box.innerHTML = headHtml() + `<div class="feed-feed">${state.trashed.map(trashRowHtml).join('')}</div><p class="feed-status" data-tg-status role="status">${statusHtml()}</p>` + undoHtml(); return; }
  const lines = liveLines(state.lines, {room:state.room}), pins = pinnedOf(state.pins);
  const pinbar = pins.length ? `<button type="button" class="feed-pinbar" data-tg-pin-open="${esc(pins[0].id)}" data-tg-pinbar><span class="feed-pt">${esc(pins[0].room_label)} · ${esc(pins[0].summary || pins[0].title || '')}</span><span class="feed-cnt">고정 ${pins.length}</span></button>` : '';
  const groups = groupLines(lines);
  const feed = groups.length ? groups.map(g => `<div class="feed-day feed-day-center" data-tg-day="${esc(g.day)}">${esc(dayLabel(g.day))}</div>${g.rows.map(rowHtml).join('')}`).join('') : '<p class="feed-empty" data-tg-empty="none">아직 받은 텔레그램 소식이 없어요.</p>';
  const older = state.end ? '' : '<div class="feed-older"><button type="button" class="feed-text-btn" data-tg-older>이전 날 더 보기</button></div>';
  box.innerHTML = headHtml() + pinbar + `<div class="feed-feed">${feed}</div>${older}<p class="feed-status" data-tg-status role="status">${statusHtml()}</p>` + (state.sel ? '' : undoHtml());
}
function openLinkHtml(line, summary) {
  const t = openTarget({room_key:state.sel.room, chat_username:line?.chat_username, open_ref:summary?.openRef});
  if (t.kind === 'link') return `<a class="feed-open" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" data-tg-openlink>텔레그램에서 열기</a>`;
  return '<button type="button" class="feed-open" data-tg-opencopy>텔레그램에서 열기</button>';
}
function itemHtml(r) {
  const on = state.open.has(r.id);
  const body = on ? `${state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'tg') : ''}${rawHtml(r)}` : '';
  return `<div class="feed-di${on ? ' is-open' : ''}" data-tg-di="${esc(r.id)}"><div class="feed-di-row"><span class="feed-at">${esc(hhmm(r.occurred_at))}</span><button type="button" class="feed-dib" data-tg-open="${esc(r.id)}" aria-expanded="${on}"><span class="feed-tx">${esc(r.summary || r.title || '')}</span><span class="feed-ft"><span>원문 ${Number(r.raw_count) || 0}</span>${r.pinned_at ? '<span class="feed-pin">고정</span>' : ''}${r.organization_id ? `<span>${esc(orgName(state.orgs, r.organization_id) || '')}</span>` : ''}</span></button><button type="button" class="feed-more" data-tg-more="${esc(r.id)}" aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴">${MORE}</button></div>${body}</div>`;
}
function rawHtml(r) {
  const raw = state.raw.get(r.id);
  if (!raw || raw.loading) return '<p class="feed-faint" role="status">원문을 불러오는 중…</p>';
  if (raw.error) return '<p class="feed-faint">원문을 불러오지 못했어요.</p>';
  if (!raw.raw_text) return '<p class="feed-faint">Web2에 남은 원문이 없어요. 원본은 Drive에 있어요.</p>';
  const canName = !!state.senders && !!r.room_key && !!r.day, rows = rawRows(telegramLines(raw.raw_text), state.sidx, r.room_key, r.day, {canName});
  const editing = state.sedit?.kind === 'raw' && state.sedit.rowId === r.id ? state.sedit.label : '';
  return `<div class="feed-raw${canName ? ' feed-raw-wide' : ''}" data-tg-raw>${rows.map(l => rawLineHtml(l, editing)).join('')}</div>`;
}
function paintDetail() {
  const box = $('#tgDetail'), sel = state.sel;
  if (!sel) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 방을 누르면 그날 소식이 보여요.</p>'; return; }
  const d = detailOf(), line = lineAt(sel.room, sel.day), items = d?.items || [];
  const label = line?.room_label || items[0]?.room_label || '텔레그램 방', nb = neighborDays(state.lines, sel.room, sel.day);
  const back = pc.matches ? '' : '<button type="button" class="back-text" data-tg-back>‹ 소식</button>';
  const sum = d?.items ? daySummary(d.parts, items, {partsKnown:d.parts !== null}) : null;
  const head = `<div class="feed-detail-head">${back}<span class="feed-detail-name feed-r${roomTone(sel.room)}"><span class="feed-rn">${esc(label)}</span></span>${openLinkHtml(line, sum)}</div>`;
  const nav = `<div class="feed-daynav"><button type="button" class="feed-nav" data-tg-nav="prev" aria-label="이전 날"${nb.prev || !state.end ? '' : ' disabled'}>‹</button><span class="feed-navday" data-tg-navday>${esc(dayLabel(sel.day))}</span><button type="button" class="feed-nav" data-tg-nav="next" aria-label="다음 날"${nb.next ? '' : ' disabled'}>›</button></div>`;
  const note = state.note ? `<p class="feed-notice" role="status" data-tg-note>${esc(state.note)}</p>` : '';
  let body;
  if (!d || d.loading) body = '<p class="feed-faint" role="status">불러오는 중…</p>';
  else if (d.error) body = '<p class="feed-faint">이 방의 소식을 불러오지 못했어요.</p>';
  else {
    const title = sel.day === kstDay() ? '오늘 요약' : '그날 요약';
    const lines = sum.lines.length ? `${sum.shown.map(t => `<p class="feed-dl">${esc(t)}</p>`).join('')}${sum.rest.length ? `<details class="feed-sumrest"><summary>더 보기</summary>${sum.rest.map(t => `<p class="feed-dl">${esc(t)}</p>`).join('')}</details>` : ''}` : '<p class="feed-faint">요약이 없어요.</p>';
    const kind = sum.kind === 'titles' ? `${sum.old ? ' <span class="feed-badge" data-tg-old>AI 요약 이전 날</span>' : ''}` : '';
    const sumBox = `<div class="feed-daybox" data-tg-daybox data-kind="${sum.kind}"><div class="feed-k-row"><p class="feed-k">${title}${kind}</p>${sum.lines.length ? copyButtonHtml('data-tg-daycopy') : ''}</div>${lines}</div>`;
    body = sumBox + (items.length ? `<div class="feed-ditems">${items.map(itemHtml).join('')}</div>` : '<p class="feed-faint">이 날 남은 소식이 없어요.</p>');
  }
  box.innerHTML = `${head}${nav}${note}<div class="feed-detail" data-tg-detail="${esc(selKey())}">${body}<p class="feed-status" data-tg-detail-status role="status">${statusHtml()}</p></div>${undoHtml()}`;
}

// 한 줄: 시간 · 말한 사람(이름 > 나 > 수집기 이름 > A) · 글. 이름 없는 라벨의 그 날 첫 줄에만 [이름 붙이기]. 편집 중이면 그 줄 바로 아래에 이름 상자.
function rawLineHtml(l, editing) {
  const k = l.shown.kind, cls = `feed-who${k === 'label' ? '' : ' is-named'}${k === 'self' ? ' is-self' : ''}${l.same ? ' is-same' : ''}`;
  const tag = l.tag ? `<button type="button" class="feed-whotag" data-tg-name-open="${esc(l.who)}" aria-label="${esc(l.who)} 이름 붙이기">이름 붙이기</button>` : '';
  const row = `<div class="feed-rm"><span class="feed-at">${esc(l.at)}</span><span class="${cls}" title="${esc(l.shown.text)}">${esc(l.shown.text)}${tag}</span><span class="feed-rt">${l.forwarded ? '<span class="feed-faint">(전달)</span> ' : ''}${esc(l.text)}</span></div>`;
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
  state.sel = {room, day}; state.status = ''; state.note = ''; state.open = new Set(item ? [item] : []); undo = null;
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('telegram-day', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
  paint(); void ensureDetail().then(() => { if (item) void loadRaw(item); });
  (pc.matches ? $(`#tgList [data-tg-rdopen="${CSS.escape(rdKey(room, day))}"]`) : $('#tgDetail [data-tg-back]'))?.focus({preventScroll:true});
}
function closeDetail({fromBack = false, quiet = false} = {}) {
  const key = selKey(); state.sel = null; state.link = null; state.note = ''; state.open = new Set(); if (state.sedit?.kind === 'raw') endEdit();
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
  state.sel = {room:sel.room, day}; state.open = new Set(); state.link = null; state.note = ''; state.status = '';
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
// 휴지통·보낸 사람 이름 보기 (폰 뒤로가기는 소식 목록으로: router layer 한 칸).
function enterShelf(mode) {
  if (state.link && !dropLink()) return;
  if (state.sel) closeDetail({quiet:true});
  state.mode = mode; state.status = ''; state.sedit = null; state.sman = null;
  shelfLayer ||= window.KPTURouter?.layer?.open('telegram-shelf', {close:() => { shelfLayer = null; state.mode = 'live'; state.sedit = null; state.sman = null; paint(); return true; }}) || null;
  paint(); $('#tgList [data-tg-shelf-back]')?.focus({preventScroll:true});
}
function leaveShelf() { const l = shelfLayer; shelfLayer = null; state.mode = 'live'; state.sedit = null; state.sman = null; l?.close(); }
const tgText = r => summaryCopyText({title:r.room_label, meta:[dayLabel(r.day), hhmm(r.occurred_at)].filter(Boolean).join(' '), body:[r.summary]});
const dayText = () => {
  const d = detailOf(), sel = state.sel; if (!d?.items || !sel) return '';
  return summaryCopyText({title:lineAt(sel.room, sel.day)?.room_label || d.items[0]?.room_label || '', meta:dayLabel(sel.day), body:daySummary(d.parts, d.items, {partsKnown:d.parts !== null}).lines});
};
const say = text => { state.status = text; for (const el of view()?.querySelectorAll('[data-tg-status],[data-tg-detail-status]') || []) el.innerHTML = statusHtml(); };
const copyTg = text => copySummary(text, {say, current:() => state.status});
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

// 소식 줄 ⋯ 메뉴(상세 안, 밀기 없음) · 머리줄 ⋯ 메뉴.
const menu = createAnchoredMenu({id:'tgMenu', className:'feed-menu', label:'소식 메뉴', historyKey:'kptuTelegramMenu',
  key:t => (t.hasAttribute('data-tg-head-more') ? 'head:' : 'item:' + t.dataset.tgMore),
  render:id => {
    if (id === 'head:') return `<button type="button" data-tg-act="senders">보낸 사람 이름</button>${state.trashed.length ? `<button type="button" data-tg-act="trash-view">휴지통 ${state.trashed.length}</button>` : ''}`;
    const r = itemOf(id.slice(id.indexOf(':') + 1)); if (!r) return '';
    const copy = tgText(r) ? '<button type="button" data-tg-act="copy">요약 복사</button>' : '';
    return `<button type="button" data-tg-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button>${copy}<button type="button" data-tg-act="link">조직 연결</button><button type="button" class="feed-menu-danger" data-tg-act="trash">삭제</button>`;
  },
  onAction:(button, active) => {
    const act = button.dataset.tgAct;
    if (active.id === 'head:') { if (act === 'senders') enterShelf('senders'); else if (act === 'trash-view') enterShelf('trash'); return; }
    const r = itemOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return;
    if (act === 'pin') void pin(r); else if (act === 'trash') void trashItem(r); else if (act === 'copy') void copyTg(tgText(r)); else if (act === 'link') startLink(r);
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

function bind() {
  const root = view(); if (!root || root.dataset.tgBound) return; root.dataset.tgBound = '1';
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    const d = b.dataset;
    if (d.tgRdopen) { const k = splitRdKey(d.tgRdopen); if (k) select(k.room, k.day); }
    else if (d.tgPinOpen) { const r = itemOf(d.tgPinOpen); if (r) { select(r.room_key, r.day, r.id); } }
    else if (d.tgNav) void navDay(d.tgNav);
    else if (d.tgRestore) void restoreItem(d.tgRestore);
    else if (b.hasAttribute('data-tg-older')) { b.disabled = true; void extend().then(() => paintList()).catch(() => { state.status = '이전 날을 불러오지 못했어요.'; paintList(); }); }
    else if (b.hasAttribute('data-tg-shelf-back')) { leaveShelf(); paint(); }
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
    else if (b.hasAttribute('data-tg-daycopy')) void copyTg(dayText());
    else if (b.hasAttribute('data-tg-opencopy')) void openByCopy();
    else if (b.hasAttribute('data-tg-back')) { if (!state.link || dropLink()) closeDetail(); }
    else if (b.hasAttribute('data-tg-retry')) void load();
    else if (b.hasAttribute('data-tg-undo')) void restore();
    else if (b.hasAttribute('data-tg-link-pick')) { const box = state.link; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#tgDetail [data-tg-link-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-tg-link-cancel')) { state.link = null; paintDetail(); }
    else if (b.hasAttribute('data-tg-link-save')) void saveLink();
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.closest?.('[data-tg-sbox],[data-tg-sman]') && !e.defaultPrevented) { e.preventDefault(); cancelPanel(); } });
  root.addEventListener('change', e => {
    if (e.target.matches('[data-tg-sman-to]') && state.sman) { state.sman.to = e.target.value; paintList(); $('#tgList [data-tg-sman-to]')?.focus({preventScroll:true}); return; }
    if (e.target.matches('[data-tg-room]')) { state.room = e.target.value; paintList(); $('#tgList [data-tg-room]')?.focus({preventScroll:true}); }
  });
  root.addEventListener('input', e => {
    if (e.target.matches('[data-tg-link-text]') && state.link) state.link.summary = e.target.value;
    if (e.target.matches('[data-tg-sbox-input]') && state.sedit) { const v = e.target.value, chip = state.sedit.chipId && chipsOf(peopleList(), state.sedit.excludeId).find(x => x.id === state.sedit.chipId); state.sedit.value = v; if (!chip || chip.text !== v.trim()) state.sedit.chipId = ''; }
  });
}
bind();

window.addEventListener('kptu:view-changed', e => {
  if (e.detail?.view === 'telegram') { if (!state.loaded || state.owner !== scopeOf(rt)) void load(); else paint(); return; }
  layer = null; shelfLayer = null; editLayer = null; state.link = null; state.sedit = null; state.sman = null; state.mode = 'live'; menu.close?.(null, true); pmenu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; shelfLayer = null; editLayer = null; undo = null; clearTimeout(undoTimer); state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches && layer) { const l = layer; layer = null; l.close(); } paint(); } });
paint();
window.KPTUTelegramFeed = {reload:() => load()};
