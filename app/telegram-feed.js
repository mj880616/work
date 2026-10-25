// TG-소식메뉴 4단계 (docs/design/call-telegram-feed.md 10절 시안 (나)(다), 12절 결정): the 텔레그램 소식 screen (?view=telegram, sidebar
// bottom). This module is the only renderer of #telegramView, drawn like a chat room: head '텔레그램 소식' + "오늘 n개 중 중요한 m개 ·
// 방 k곳" + room filter, the pin strip, small centered day labels, then bubbles (round room initial, room name in its toned colour,
// one or two summary lines, time · 원문 n). A short press opens the original messages (PC right pane 2/3, phone one router layer).
// Touch (TG-카드밀기): swipe a card right for a small [보관] on its left, left for a small [삭제] on its right (the card steps aside by
// the button width, only after a clearly sideways move so up-down scrolling is untouched); a tap on the button moves the card out of
// the list with a one-line '보관했어요 · 되돌리기'. 보관 goes to the '보관함 n' at the top (restore there), 삭제 to the '휴지통 m' (hidden_at,
// restore only, never emptied by itself; the Drive original is never touched). A long press (feed-hold.js) opens [고정 · 요약 복사 ·
// 보관 · 삭제 · 원문 보기] right below the pressed spot. PC: the ⋯ shows only on mouse-over (or keyboard focus), a right-click opens the
// same menu at the pointer (context-menu.js). Pin, 보관 and 삭제 are saved on the server (feed-data.js: owner RLS REST for pin, the DB
// function app_feed_set_state for the three states). Room colours are not stored: feed-model.mjs roomTone picks one of six from room_key.
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {createFeedHold} from './feed-hold.js';
import {mountSplitResize} from './split-resize.js';
import {groupByDay, hhmm, dayLabel, telegramLines, telegramToday, telegramHeadText, roomsOf, roomTone, roomInitial, pinnedOf, missingTable, kstDay,
  swipeIntent, swipeOffset, swipeSettle, swipeOpenOffset, feedBucket, feedActions, feedDoneText, FEED_ACTIONS} from './feed-model.mjs';
import {readTelegramFeed, readDays, readRaw, readOrganizations, setPinned, setFeedState, scopeOf} from './feed-data.js';
import {summaryCopyText} from './summary-copy-model.mjs';
import {copyButtonHtml, copySummary} from './summary-copy.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const phone = window.matchMedia('(max-width:760px)');
const MORE = '<span aria-hidden="true">⋯</span>';
// 버튼 안 그림(글자색을 따라가는 선 그림, 색은 CSS 토큰).
const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  archive:svg('<path d="M3.5 7h17v4h-17z"/><path d="M5.5 11v8h13v-8"/><path d="M10 15h4"/>'),
  trash:svg('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>'),
  restore:svg('<path d="M4 9h10a5 5 0 010 10H8"/><path d="M8 5L4 9l4 4"/>'),
};
const UNDO_MS = 8000;

// state.mode: live (소식) | archive (보관함) | trash (휴지통). state.swipe: the one card left open {id, side}. undo: {id, to, text} for the bottom line.
let state = fresh(), run = 0, layer = null, shelfLayer = null, undo = null, undoTimer = 0;
function fresh() { return {owner:'', loaded:false, missing:false, error:'', rows:[], archived:[], trashed:[], archiveReady:true, mode:'live', swipe:null, days:[], orgs:[], mine:new Set(), room:'', selected:null, raw:new Map(), link:null, status:'', busy:false}; }

function install() {
  if ($('#telegramView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="telegramView" class="view-panel feed-view hidden" aria-labelledby="tgTitle"><h2 id="tgTitle" class="a11y-only">텔레그램 소식</h2><div class="feed-split" id="tgSplit"><div class="feed-list" id="tgList"></div><section class="feed-pane" id="tgDetail" aria-label="텔레그램 원문"></section></div></section>`);
}
install();
const view = () => $('#telegramView');
const rowOf = id => state.rows.find(r => r.id === id) || state.archived.find(r => r.id === id) || state.trashed.find(r => r.id === id) || null;
const listOf = mode => (mode === 'archive' ? state.archived : mode === 'trash' ? state.trashed : state.rows);
const shown = () => (state.mode !== 'live' ? listOf(state.mode) : state.room ? state.rows.filter(r => r.room_key === state.room) : state.rows);

// ---------- data
async function load() {
  const owner = scopeOf(rt), me = ++run; if (!state.loaded) paint();
  try {
    const [feed, days, orgs] = await Promise.all([readTelegramFeed(rt), readDays('telegram', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()}))]);
    if (me !== run || owner !== scopeOf(rt)) return;
    const rows = feed.rows;
    Object.assign(state, {owner, loaded:true, missing:false, error:'', rows, archived:feed.archived, trashed:feed.trashed, archiveReady:feed.archiveReady, swipe:null, days, orgs:orgs.orgs, mine:orgs.mine});
    if (state.mode !== 'live' && !listOf(state.mode).length) leaveShelf();
    if (state.room && !rows.some(r => r.room_key === state.room)) state.room = '';
    if (state.selected && !rowOf(state.selected)) closeDetail({quiet:true});
  } catch (error) {
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, rows:[], archived:[], trashed:[], swipe:null, missing:missingTable(error), error:missingTable(error) ? '' : '텔레그램 소식을 불러오지 못했어요.'});
  }
  paint();
}
async function loadRaw(id) {
  if (state.raw.has(id)) return;
  state.raw.set(id, {loading:true});
  try { const r = await readRaw(id, rt); state.raw.set(id, {raw_text:r?.raw_text || null}); }
  catch { state.raw.set(id, {error:true}); }
  if (state.selected === id) paintDetail();
}

// ---------- paint (the only renderer of #telegramView)
function paint() {
  const root = view(); if (!root) return;
  const wide = pc.matches, open = !!state.selected;
  paintList(); paintDetail();
  $('#tgList').hidden = !wide && open; $('#tgDetail').hidden = !wide && !open;
  const r = rowOf(state.selected);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:wide && r ? r.room_label : null}}));
  mountSplitResize({container:$('#tgSplit'), name:'tasks', label:'텔레그램 소식과 원문 칸 폭 조절', list:() => $('#tgList'), pane:() => $('#tgDetail'), active:() => pc.matches && !view()?.classList.contains('hidden')});
}
const statusHtml = () => esc(state.status);
const undoHtml = () => (undo ? `<div class="feed-undo" role="status" data-tg-undobar><span>${esc(undo.text)}</span><span aria-hidden="true">·</span><button type="button" class="feed-undo-btn" data-tg-undo>되돌리기</button></div>` : '');
function headHtml() {
  if (state.mode !== 'live') {
    const trash = state.mode === 'trash';
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">${trash ? '휴지통' : '보관함'} ${listOf(state.mode).length}</span></div>`
      + (trash ? '<p class="feed-note" data-tg-trash-note>Web2 목록에서만 뺀 소식이에요. 원문은 Drive에 그대로 있어요. 자동으로 비우지 않아요.</p>' : '');
  }
  const today = telegramToday(state.days, kstDay());
  const rooms = roomsOf(state.rows);
  const filter = rooms.length > 1 || state.room ? `<select class="feed-select" data-tg-room aria-label="방 거르기"><option value="">모든 방</option>${rooms.map(x => `<option value="${esc(x.key)}"${x.key === state.room ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : '';
  const failed = today?.failed ? ` · 판정 실패 ${today.failed}` : '';
  const ready = state.loaded && !state.missing && !state.error;
  const shelves = ready ? (state.archiveReady && state.archived.length ? `<button type="button" class="feed-text-btn" data-tg-shelf="archive">보관함 ${state.archived.length}</button>` : '')
    + (state.trashed.length ? `<button type="button" class="feed-text-btn" data-tg-shelf="trash">휴지통 ${state.trashed.length}</button>` : '') : '';
  return `<div class="feed-head"><span class="feed-head-title" aria-hidden="true">텔레그램 소식</span><span class="feed-head-sub" data-tg-today>${ready ? esc(telegramHeadText(today) + failed) : ''}</span>${shelves}${state.loaded && !state.missing ? filter : ''}</div>`;
}
const actHtml = (side, kind, open) => (kind ? `<button type="button" class="feed-act feed-act-${kind}" data-tg-act-btn="${side}" data-tg-kind="${kind}" tabindex="-1"${open === side ? '' : ' aria-hidden="true"'} aria-label="${FEED_ACTIONS[kind].label}">${ICON[kind]}<span>${FEED_ACTIONS[kind].label}</span></button>` : '');
function bubbleHtml(r) {
  const tone = roomTone(r.room_key), on = r.id === state.selected;
  const acts = feedActions(state.mode, state.archiveReady), open = state.swipe?.id === r.id ? state.swipe.side : '';
  return `<div class="feed-swipe" data-tg-swipe="${esc(r.id)}"${open ? ` data-side="${open}"` : ''}>${actHtml('start', acts.start, open)}${actHtml('end', acts.end, open)}<div class="feed-msg feed-r${tone}${on ? ' is-selected' : ''}" data-tg-item="${esc(r.id)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(r.room_label))}</span><button type="button" class="feed-bub" data-tg-open="${esc(r.id)}"${on ? ' aria-current="true"' : ''}><span class="feed-rn">${esc(r.room_label)}${r.pinned_at ? ' <span class="feed-pin">고정</span>' : ''}</span><span class="feed-tx">${esc(r.summary || r.title || '')}</span><span class="feed-ft"><span>${esc(hhmm(r.occurred_at))}</span><span>원문 ${Number(r.raw_count) || 0}</span></span></button><button type="button" class="feed-hov" data-tg-more="${esc(r.id)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(r.room_label)} 소식 메뉴">${MORE}</button></div></div>`;
}
function paintList() {
  const box = $('#tgList');
  if (!state.loaded) { box.innerHTML = headHtml() + '<p class="feed-empty" role="status">불러오는 중…</p>'; return; }
  if (state.missing) { box.innerHTML = headHtml() + '<p class="feed-empty" data-tg-empty="ready">준비 중이에요. 텔레그램 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = headHtml() + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-tg-retry>다시 시도</button></p>`; return; }
  const rows = shown(), pins = state.mode === 'live' ? pinnedOf(rows) : [];
  const pinbar = pins.length ? `<button type="button" class="feed-pinbar" data-tg-open="${esc(pins[0].id)}" data-tg-pinbar><span class="feed-pt">${esc(pins[0].room_label)} · ${esc(pins[0].summary || pins[0].title || '')}</span><span class="feed-cnt">고정 ${pins.length}</span></button>` : '';
  const groups = groupByDay(rows);
  const feed = groups.length ? groups.map(g => `<div class="feed-day feed-day-center" data-tg-day="${esc(g.day)}">${esc(g.label)}</div>${g.items.map(bubbleHtml).join('')}`).join('') : '<p class="feed-empty" data-tg-empty="none">아직 받은 텔레그램 소식이 없어요.</p>';
  box.innerHTML = headHtml() + pinbar + `<div class="feed-feed">${feed}</div><p class="feed-status" data-tg-status role="status">${statusHtml()}</p>` + undoHtml();
}
function paintDetail() {
  const box = $('#tgDetail'), r = rowOf(state.selected);
  if (!r) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 소식을 누르면 원문이 보여요.</p>'; return; }
  const back = pc.matches ? '' : '<button type="button" class="back-text" data-tg-back>‹ 소식</button>';
  const org = orgName(state.orgs, r.organization_id);
  const sub = [r.room_label, dayLabel(r.day), `원문 ${Number(r.raw_count) || 0}`, org].filter(Boolean).join(' · ');
  const raw = state.raw.get(r.id);
  let lines;
  if (!raw || raw.loading) lines = '<p class="feed-faint" role="status">원문을 불러오는 중…</p>';
  else if (raw.error) lines = '<p class="feed-faint">원문을 불러오지 못했어요.</p>';
  else if (!raw.raw_text) lines = '<p class="feed-faint">Web2에 남은 원문이 없어요. 원본은 Drive에 있어요.</p>';
  else lines = `<div class="feed-raw" data-tg-raw>${telegramLines(raw.raw_text).map(l => `<div class="feed-rm"><span class="feed-at">${esc(l.at)}</span><span class="feed-who">${esc(l.who)}</span><span class="feed-rt">${l.forwarded ? '<span class="feed-faint">(전달)</span> ' : ''}${esc(l.text)}</span></div>`).join('')}</div>`;
  const link = state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'tg') : '';
  box.innerHTML = `<div class="feed-detail-head">${back}<span class="feed-head-sub" data-tg-raw-sub>${esc(sub)}${r.pinned_at ? ' · 고정' : ''}</span><button type="button" class="feed-more" data-tg-detail-more data-ctx="area" aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴"${state.busy ? ' disabled' : ''}>${MORE}</button></div>
<div class="feed-detail" data-tg-detail="${esc(r.id)}"><div class="feed-sum-row"><p class="feed-sum">${esc(r.summary || '')}</p>${tgText(r) ? copyButtonHtml('data-tg-copy') : ''}</div>${link}${lines}<p class="feed-status" data-tg-detail-status role="status">${statusHtml()}</p></div>`;
}

// ---------- actions
function select(id) {
  if (state.link && !dropLink()) return;
  state.selected = id; state.status = ''; undo = null;
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('telegram-raw', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
  paint(); void loadRaw(id);
  (pc.matches ? $(`#tgList [data-tg-open="${CSS.escape(id)}"]:not([data-tg-pinbar])`) : $('#tgDetail [data-tg-back]'))?.focus({preventScroll:true});
}
function closeDetail({fromBack = false, quiet = false} = {}) {
  const id = state.selected; state.selected = null; state.link = null;
  const l = layer; layer = null; if (!fromBack) l?.close();
  if (quiet) return;
  paint(); $(`#tgList [data-tg-open="${CSS.escape(id || '')}"]:not([data-tg-pinbar])`)?.focus({preventScroll:true});
}
function dropLink() { const r = rowOf(state.link?.rowId), changed = state.link && r && state.link.summary.trim() !== newLinkBox(r).summary.trim(); if (changed && !window.confirm('쓰던 요약을 버릴까요?')) return false; state.link = null; return true; }
const replaceRow = saved => { for (const k of ['rows', 'archived', 'trashed']) state[k] = state[k].map(r => r.id === saved.id ? {...r, ...saved} : r); };
async function guarded(fn) {
  if (state.busy) return; const owner = scopeOf(rt); state.busy = true;
  try { await fn(() => owner === scopeOf(rt)); } finally { state.busy = false; if (owner === scopeOf(rt)) paint(); }
}
const gone = () => { state.status = '이 소식이 그사이 사라졌어요. 목록을 다시 불러왔어요.'; return load(); };
function pin(r) {
  return guarded(async current => {
    try { const saved = await setPinned(r.id, !r.pinned_at, rt); if (!current()) return; if (!saved) return void await gone(); replaceRow(saved); state.status = saved.pinned_at ? '고정했어요.' : '고정을 풀었어요.'; }
    catch { if (current()) state.status = '저장하지 못했어요. 다시 시도해 주세요.'; }
  });
}
const MOVE_FAIL = {
  UNAVAILABLE:'보관 기능이 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  REFUSED:'저장하지 못했어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'저장했는지 확인하지 못했어요. 목록을 다시 불러왔어요.',
};
// A row lives in exactly one of the three lists (rows / archived / trashed); this puts the saved row into the right one.
function relocate(row, saved) {
  const next = {...row, archived_at:saved.archived_at, hidden_at:saved.hidden_at};
  state.rows = state.rows.filter(x => x.id !== row.id); state.archived = state.archived.filter(x => x.id !== row.id); state.trashed = state.trashed.filter(x => x.id !== row.id);
  const bucket = feedBucket(next);
  (bucket === 'archived' ? state.archived : bucket === 'trashed' ? state.trashed : state.rows).push(next);
  if (state.mode !== 'live' && !listOf(state.mode).length) leaveShelf();
}
function armUndo() {
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undo = null; view()?.querySelector('[data-tg-undobar]')?.remove(); }, UNDO_MS);
}
// kind: archive | trash | restore (feed-model.mjs FEED_ACTIONS). The one-line '보관했어요 · 되돌리기' sits above the bottom bar.
function moveTo(r, kind) {
  const was = feedBucket(r), back = was === 'archived' ? 'archived' : was === 'trashed' ? 'trashed' : 'active';
  return guarded(async current => {
    try {
      const saved = await setFeedState(r.id, FEED_ACTIONS[kind].to, rt, {archiveReady:state.archiveReady}); if (!current()) return;
      if (!saved.ok) { if (saved.error === 'GONE') return void await gone(); state.status = MOVE_FAIL[saved.error] || MOVE_FAIL.REFUSED; if (saved.error === 'UNKNOWN') void load(); return; }
      state.swipe = null; state.status = '';
      relocate(r, saved);
      if (kind !== 'restore' && state.selected === r.id) closeDetail({quiet:true});
      undo = {id:r.id, to:back, text:feedDoneText(kind)}; armUndo();
    } catch { if (current()) state.status = '저장하지 못했어요. 다시 시도해 주세요.'; }
  });
}
function restore() {
  const u = undo; if (!u) return; undo = null; clearTimeout(undoTimer);
  return guarded(async current => {
    try {
      const r = rowOf(u.id); if (!r) return void await gone();
      const saved = await setFeedState(u.id, u.to, rt, {archiveReady:state.archiveReady}); if (!current()) return;
      if (!saved.ok) { state.status = saved.error === 'GONE' ? '이 소식이 그사이 사라졌어요.' : '되돌리지 못했어요. 다시 시도해 주세요.'; return; }
      state.swipe = null; relocate(r, saved); state.status = '되돌렸어요.';
    } catch { if (current()) state.status = '되돌리지 못했어요. 다시 시도해 주세요.'; }
  });
}
// 보관함·휴지통 보기 (a phone's back button returns to the 소식 list: one router layer, like the raw view).
function enterShelf(mode) {
  if (state.link && !dropLink()) return;
  if (state.selected) closeDetail({quiet:true});
  state.mode = mode; state.swipe = null; state.status = '';
  shelfLayer ||= window.KPTURouter?.layer?.open('telegram-shelf', {close:() => { shelfLayer = null; state.mode = 'live'; state.swipe = null; paint(); return true; }}) || null;
  paint(); $('#tgList [data-tg-shelf-back]')?.focus({preventScroll:true});
}
function leaveShelf() { const l = shelfLayer; shelfLayer = null; state.mode = 'live'; state.swipe = null; l?.close(); }
const tgText = r => summaryCopyText({title:r.room_label, meta:[dayLabel(r.day), hhmm(r.occurred_at)].filter(Boolean).join(' '), body:[r.summary]});
const say = text => { state.status = text; for (const el of view()?.querySelectorAll('[data-tg-status],[data-tg-detail-status]') || []) el.innerHTML = statusHtml(); };
const copyTg = r => copySummary(tgText(r), {say, current:() => state.status});
function startLink(r) { if (state.selected !== r.id) select(r.id); state.link = newLinkBox(r); paintDetail(); $('#tgDetail [data-tg-link-pick]')?.focus({preventScroll:true}); }
function saveLink() {
  const r = rowOf(state.link?.rowId), box = state.link; if (!r || !box) return;
  box.busy = true; paintDetail();
  return guarded(async current => {
    try { const res = await saveLinkBox(r, box, rt); if (!current()) return; if (!res.saved) return void await gone(); replaceRow(res.saved); state.link = null; state.status = res.text; window.dispatchEvent(new Event('kptu:basket-links-changed')); }
    catch { if (current()) { box.busy = false; box.status = '연결하지 못했어요. 다시 시도해 주세요.'; } }
  }).then(() => $('#tgDetail [data-tg-detail-more]')?.focus({preventScroll:true}));
}

// One menu for the bubble (⋯ / right-click / long press) and the raw view's ⋯. A long press opens it under the pressed spot:
// the hidden ⋯ of that bubble reports a box at the finger while the menu is open (the same way context-menu.js pins a right-click).
const menuTarget = trigger => trigger.dataset.tgMore || state.selected;
const menu = createAnchoredMenu({id:'tgMenu', className:'feed-menu', label:'소식 메뉴', historyKey:'kptuTelegramMenu',
  key:t => (t.dataset.tgMore ? 'item:' : 'detail:') + menuTarget(t),
  render:id => {
    const r = rowOf(id.slice(id.indexOf(':') + 1)); if (!r) return '';
    const inDetail = id.startsWith('detail:');
    const bucket = feedBucket(r), copy = tgText(r) ? '<button type="button" data-tg-act="copy">요약 복사</button>' : '';
    const tail = inDetail ? '<button type="button" data-tg-act="link">조직 연결</button>' : '<button type="button" data-tg-act="raw">원문 보기</button>';
    const trash = '<button type="button" class="feed-menu-danger" data-tg-act="trash">삭제</button>';
    if (bucket === 'trashed') return `<button type="button" data-tg-act="restore">되살리기</button>${copy}${tail}`;
    if (bucket === 'archived') return `<button type="button" data-tg-act="restore">되살리기</button>${copy}${trash}${tail}`;
    return `<button type="button" data-tg-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button>${copy}${state.archiveReady ? '<button type="button" data-tg-act="archive">보관</button>' : ''}${trash}${tail}`;
  },
  onAction:(button, active) => {
    const r = rowOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return; const act = button.dataset.tgAct;
    if (act === 'pin') void pin(r); else if (FEED_ACTIONS[act]) void moveTo(r, act); else if (act === 'raw') select(r.id); else if (act === 'copy') void copyTg(r); else if (act === 'link') startLink(r);
  },
  onClose:() => hold.unpin()});
const hold = createFeedHold({menu, itemSelector:'[data-tg-item]', moreSelector:'[data-tg-more]', busy:() => state.busy, isPhone:() => phone.matches});
// ---------- 밀기 (touch only, TG-카드밀기). Rules (thresholds, offsets, who gets which button): feed-model.mjs. The card moves with
// the finger only after a clearly sideways move, so up-down scrolling (touch-action: pan-y) and the long press are untouched.
// Drag position is written to the card's own style; the open/closed look is CSS on data-side. One card stays open at a time.
let drag = null, swallowSwipeClick = false, swallowTimer = 0;
const swipeWrap = id => view()?.querySelector(`.feed-swipe[data-tg-swipe="${CSS.escape(id)}"]`);
const swipeAllow = () => { const a = feedActions(state.mode, state.archiveReady); return {start:!!a.start, end:!!a.end}; };
function syncSwipeAria(wrap, side) { for (const b of wrap.querySelectorAll('.feed-act')) { if (b.dataset.tgActBtn === side) b.removeAttribute('aria-hidden'); else b.setAttribute('aria-hidden', 'true'); } }
function setSide(wrap, side) { if (side) wrap.dataset.side = side; else delete wrap.dataset.side; syncSwipeAria(wrap, side); }
function closeSwipe() {
  const open = state.swipe; if (!open) return; state.swipe = null;
  const wrap = swipeWrap(open.id); if (wrap) setSide(wrap, '');
}
function bindSwipe(root) {
  root.addEventListener('pointerdown', e => {
    swallowSwipeClick = false; clearTimeout(swallowTimer);
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    const wrap = e.target.closest('.feed-swipe');
    if (state.swipe && state.swipe.id !== wrap?.dataset.tgSwipe) closeSwipe();
    if (!wrap || state.busy || e.target.closest('.feed-act')) return;
    const side = state.swipe?.id === wrap.dataset.tgSwipe ? state.swipe.side : '';
    drag = {pointerId:e.pointerId, id:wrap.dataset.tgSwipe, wrap, msg:wrap.querySelector('.feed-msg'), x:e.clientX, y:e.clientY, base:swipeOpenOffset(side), side, moving:false, offset:swipeOpenOffset(side)};
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moving) {
      const intent = swipeIntent(dx, dy);
      if (intent === 'wait') return;
      if (intent === 'scroll') { drag = null; return; }
      drag.moving = true; drag.wrap.classList.add('is-dragging');
    }
    drag.offset = swipeOffset(dx, drag.base, swipeAllow());
    drag.msg.style.transform = `translateX(${drag.offset}px)`;
    setSide(drag.wrap, drag.offset > 0 ? 'start' : drag.offset < 0 ? 'end' : '');
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag; drag = null;
    if (!d.moving) return;
    // The click that follows the lift belongs to the swipe, not to the card underneath.
    swallowSwipeClick = true; clearTimeout(swallowTimer); swallowTimer = setTimeout(() => { swallowSwipeClick = false; }, 400);
    const side = e.type === 'pointercancel' ? d.side : swipeSettle(d.offset);
    d.msg.style.transform = ''; d.wrap.classList.remove('is-dragging');
    state.swipe = side ? {id:d.id, side} : null; setSide(d.wrap, side);
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  window.addEventListener('click', e => { if (swallowSwipeClick && root.contains(e.target) && !e.target.closest('.feed-act')) { swallowSwipeClick = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

function bind() {
  const root = view(); if (!root || root.dataset.tgBound) return; root.dataset.tgBound = '1';
  hold.bind(root); bindSwipe(root);
  root.addEventListener('click', e => {
    const opened = state.swipe && e.target.closest(`.feed-swipe[data-tg-swipe="${CSS.escape(state.swipe.id)}"]`);
    if (opened && !e.target.closest('.feed-act')) { closeSwipe(); return; }
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    const d = b.dataset;
    if (d.tgActBtn) { const r = rowOf(b.closest('.feed-swipe')?.dataset.tgSwipe), kind = d.tgKind; if (r && FEED_ACTIONS[kind]) void moveTo(r, kind); }
    else if (d.tgShelf) enterShelf(d.tgShelf === 'trash' ? 'trash' : 'archive');
    else if (b.hasAttribute('data-tg-shelf-back')) { leaveShelf(); paint(); }
    else if (d.tgOpen) select(d.tgOpen);
    else if (d.tgMore) menu.open(b);
    else if (b.hasAttribute('data-tg-detail-more')) menu.open(b);
    else if (b.hasAttribute('data-tg-copy')) { const r = rowOf(state.selected); if (r) void copyTg(r); }
    else if (b.hasAttribute('data-tg-back')) { if (!state.link || dropLink()) closeDetail(); }
    else if (b.hasAttribute('data-tg-retry')) void load();
    else if (b.hasAttribute('data-tg-undo')) void restore();
    else if (b.hasAttribute('data-tg-link-pick')) { const box = state.link; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#tgDetail [data-tg-link-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-tg-link-cancel')) { state.link = null; paintDetail(); $('#tgDetail [data-tg-detail-more]')?.focus({preventScroll:true}); }
    else if (b.hasAttribute('data-tg-link-save')) void saveLink();
  });
  root.addEventListener('change', e => { if (e.target.matches('[data-tg-room]')) { state.room = e.target.value; paintList(); $('#tgList [data-tg-room]')?.focus({preventScroll:true}); } });
  root.addEventListener('input', e => { if (e.target.matches('[data-tg-link-text]') && state.link) state.link.summary = e.target.value; });
}
bind();

window.addEventListener('kptu:view-changed', e => {
  if (e.detail?.view === 'telegram') { if (!state.loaded || state.owner !== scopeOf(rt)) void load(); else paint(); return; }
  layer = null; shelfLayer = null; state.link = null; state.mode = 'live'; state.swipe = null; menu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; shelfLayer = null; undo = null; clearTimeout(undoTimer); state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches && layer) { const l = layer; layer = null; l.close(); } paint(); } });
paint();
window.KPTUTelegramFeed = {reload:() => load()};
