// TG-소식메뉴 4단계 (docs/design/call-telegram-feed.md 10절 시안 (나)(다), 12절 결정): the 텔레그램 소식 screen (?view=telegram, sidebar
// bottom). This module is the only renderer of #telegramView, drawn like a chat room: head '텔레그램 소식' + "오늘 n개 중 중요한 m개 ·
// 방 k곳" + room filter, the pin strip, small centered day labels, then bubbles (round room initial, room name in its toned colour,
// one or two summary lines, time · 원문 n). A short press opens the original messages (PC right pane 2/3, phone one router layer).
// Phone: a long press opens [고정 · 지우기 · 원문 보기] right below the pressed spot (no ⋯ on phones). PC: the ⋯ shows only on
// mouse-over (or keyboard focus), a right-click opens the same menu at the pointer (context-menu.js). Pin and hide are saved on the
// server (feed-data.js, owner RLS REST). Room colours are not stored: feed-model.mjs roomTone picks one of six from room_key.
import './enter-save.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {mountSplitResize} from './split-resize.js';
import {groupByDay, hhmm, dayLabel, telegramLines, telegramToday, telegramHeadText, roomsOf, roomTone, roomInitial, pinnedOf, missingTable, kstDay} from './feed-model.mjs';
import {readFeed, readDays, readRaw, readOrganizations, setPinned, setHidden, scopeOf} from './feed-data.js';
import {esc, newLinkBox, linkBoxHtml, openOrgPicker, saveLinkBox, orgName} from './feed-link.js';

const rt = window.KPTURuntime;
const $ = sel => document.querySelector(sel);
const pc = window.matchMedia('(min-width:1024px)');
const phone = window.matchMedia('(max-width:760px)');
const MORE = '<span aria-hidden="true">⋯</span>';
const HOLD_MS = 500, MOVE_PX = 10;

let state = fresh(), run = 0, layer = null, undo = null;
function fresh() { return {owner:'', loaded:false, missing:false, error:'', rows:[], days:[], orgs:[], mine:new Set(), room:'', selected:null, raw:new Map(), link:null, status:'', busy:false}; }

function install() {
  if ($('#telegramView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="telegramView" class="view-panel feed-view hidden" aria-labelledby="tgTitle"><h2 id="tgTitle" class="a11y-only">텔레그램 소식</h2><div class="feed-split" id="tgSplit"><div class="feed-list" id="tgList"></div><section class="feed-pane" id="tgDetail" aria-label="텔레그램 원문"></section></div></section>`);
}
install();
const view = () => $('#telegramView');
const rowOf = id => state.rows.find(r => r.id === id) || null;
const shown = () => state.room ? state.rows.filter(r => r.room_key === state.room) : state.rows;

// ---------- data
async function load() {
  const owner = scopeOf(rt), me = ++run; if (!state.loaded) paint();
  try {
    const [rows, days, orgs] = await Promise.all([readFeed('telegram', rt), readDays('telegram', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()}))]);
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, missing:false, error:'', rows, days, orgs:orgs.orgs, mine:orgs.mine});
    if (state.room && !rows.some(r => r.room_key === state.room)) state.room = '';
    if (state.selected && !rowOf(state.selected)) closeDetail({quiet:true});
  } catch (error) {
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, rows:[], missing:missingTable(error), error:missingTable(error) ? '' : '텔레그램 소식을 불러오지 못했어요.'});
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
const statusHtml = () => esc(state.status) + (undo ? ' <button type="button" class="feed-text-btn" data-tg-undo>되돌리기</button>' : '');
function headHtml() {
  const today = telegramToday(state.days, kstDay());
  const rooms = roomsOf(state.rows);
  const filter = rooms.length > 1 || state.room ? `<select class="feed-select" data-tg-room aria-label="방 거르기"><option value="">모든 방</option>${rooms.map(x => `<option value="${esc(x.key)}"${x.key === state.room ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>` : '';
  const failed = today?.failed ? ` · 판정 실패 ${today.failed}` : '';
  return `<div class="feed-head"><span class="feed-head-title" aria-hidden="true">텔레그램 소식</span><span class="feed-head-sub" data-tg-today>${state.loaded && !state.missing && !state.error ? esc(telegramHeadText(today) + failed) : ''}</span>${state.loaded && !state.missing ? filter : ''}</div>`;
}
function bubbleHtml(r) {
  const tone = roomTone(r.room_key), on = r.id === state.selected;
  return `<div class="feed-msg feed-r${tone}${on ? ' is-selected' : ''}" data-tg-item="${esc(r.id)}"><span class="feed-dot" aria-hidden="true">${esc(roomInitial(r.room_label))}</span><button type="button" class="feed-bub" data-tg-open="${esc(r.id)}"${on ? ' aria-current="true"' : ''}><span class="feed-rn">${esc(r.room_label)}${r.pinned_at ? ' <span class="feed-pin">고정</span>' : ''}</span><span class="feed-tx">${esc(r.summary || r.title || '')}</span><span class="feed-ft"><span>${esc(hhmm(r.occurred_at))}</span><span>원문 ${Number(r.raw_count) || 0}</span></span></button><button type="button" class="feed-hov" data-tg-more="${esc(r.id)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(r.room_label)} 소식 메뉴">${MORE}</button></div>`;
}
function paintList() {
  const box = $('#tgList');
  if (!state.loaded) { box.innerHTML = headHtml() + '<p class="feed-empty" role="status">불러오는 중…</p>'; return; }
  if (state.missing) { box.innerHTML = headHtml() + '<p class="feed-empty" data-tg-empty="ready">준비 중이에요. 텔레그램 수집이 연결되면 여기에 보여요.</p>'; return; }
  if (state.error) { box.innerHTML = headHtml() + `<p class="feed-empty" role="status">${esc(state.error)} <button type="button" class="feed-text-btn" data-tg-retry>다시 시도</button></p>`; return; }
  const rows = shown(), pins = pinnedOf(rows);
  const pinbar = pins.length ? `<button type="button" class="feed-pinbar" data-tg-open="${esc(pins[0].id)}" data-tg-pinbar><span class="feed-pt">${esc(pins[0].room_label)} · ${esc(pins[0].summary || pins[0].title || '')}</span><span class="feed-cnt">고정 ${pins.length}</span></button>` : '';
  const groups = groupByDay(rows);
  const feed = groups.length ? groups.map(g => `<div class="feed-day feed-day-center" data-tg-day="${esc(g.day)}">${esc(g.label)}</div>${g.items.map(bubbleHtml).join('')}`).join('') : '<p class="feed-empty" data-tg-empty="none">아직 받은 텔레그램 소식이 없어요.</p>';
  box.innerHTML = headHtml() + pinbar + `<div class="feed-feed">${feed}</div><p class="feed-status" data-tg-status role="status">${statusHtml()}</p>`;
}
function paintDetail() {
  const box = $('#tgDetail'), r = rowOf(state.selected);
  if (!r) { box.innerHTML = '<p class="feed-empty feed-pane-empty">왼쪽에서 소식을 누르면 원문이 보여요.</p>'; return; }
  const back = pc.matches ? '' : '<button type="button" class="feed-text-btn feed-back" data-tg-back>‹ 소식</button>';
  const org = orgName(state.orgs, r.organization_id);
  const sub = [r.room_label, dayLabel(r.day), `원문 ${Number(r.raw_count) || 0}`, org].filter(Boolean).join(' · ');
  const raw = state.raw.get(r.id);
  let lines;
  if (!raw || raw.loading) lines = '<p class="feed-faint" role="status">원문을 불러오는 중…</p>';
  else if (raw.error) lines = '<p class="feed-faint">원문을 불러오지 못했어요.</p>';
  else if (!raw.raw_text) lines = '<p class="feed-faint">Web2에 남은 원문이 없어요. 원본은 Drive에 있어요.</p>';
  else lines = `<div class="feed-raw" data-tg-raw>${telegramLines(raw.raw_text).map(l => `<div class="feed-rm"><span class="feed-at">${esc(l.at)}</span><span class="feed-who">${esc(l.who)}</span><span class="feed-rt">${l.forwarded ? '<span class="feed-faint">(전달)</span> ' : ''}${esc(l.text)}</span></div>`).join('')}</div>`;
  const link = state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'tg') : '';
  box.innerHTML = `<div class="feed-detail-head">${back}<span class="feed-head-sub" data-tg-raw-sub>${esc(sub)}${r.pinned_at ? ' · 고정' : ''}</span><button type="button" class="feed-more" data-tg-detail-more aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴"${state.busy ? ' disabled' : ''}>${MORE}</button></div>
<div class="feed-detail" data-tg-detail="${esc(r.id)}"><p class="feed-sum">${esc(r.summary || '')}</p>${link}${lines}<p class="feed-status" data-tg-detail-status role="status">${statusHtml()}</p></div>`;
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
const replaceRow = saved => { state.rows = state.rows.map(r => r.id === saved.id ? {...r, ...saved} : r); };
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
function hide(r) {
  return guarded(async current => {
    try {
      const saved = await setHidden(r.id, true, rt); if (!current()) return; if (!saved) return void await gone();
      state.rows = state.rows.filter(x => x.id !== r.id); if (state.selected === r.id) closeDetail({quiet:true});
      undo = {id:r.id, row:{...r, hidden_at:null}}; state.status = '목록에서 지웠어요. 원문은 Drive에 있어요.';
    } catch { if (current()) state.status = '지우지 못했어요. 다시 시도해 주세요.'; }
  }).then(() => $('#tgList [data-tg-undo]')?.focus({preventScroll:true}));
}
function restore() {
  const u = undo; if (!u) return; undo = null;
  return guarded(async current => {
    try { const saved = await setHidden(u.id, false, rt); if (!current()) return; if (saved) { state.rows = [...state.rows, {...u.row, ...saved}]; state.status = '되돌렸어요.'; } else state.status = '되돌리지 못했어요.'; }
    catch { if (current()) state.status = '되돌리지 못했어요. 다시 시도해 주세요.'; }
  });
}
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
    return `<button type="button" data-tg-act="pin">${r.pinned_at ? '고정 풀기' : '고정'}</button><button type="button" class="feed-menu-danger" data-tg-act="hide">지우기 <span class="feed-faint">목록에서만</span></button>${inDetail ? '<button type="button" data-tg-act="link">조직 연결</button>' : '<button type="button" data-tg-act="raw">원문 보기</button>'}`;
  },
  onAction:(button, active) => {
    const r = rowOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return; const act = button.dataset.tgAct;
    if (act === 'pin') void pin(r); else if (act === 'hide') void hide(r); else if (act === 'raw') select(r.id); else if (act === 'link') startLink(r);
  },
  onClose:() => unpinAt()});
let pinnedAt = null;
function pinAt(trigger, x, y) {
  unpinAt();
  trigger.getBoundingClientRect = () => ({x, y, left:x, top:y, right:x + Math.min(200, innerWidth - 24), bottom:y, width:Math.min(200, innerWidth - 24), height:0, toJSON() { return this; }});
  pinnedAt = trigger;
}
function unpinAt() { if (pinnedAt) { delete pinnedAt.getBoundingClientRect; pinnedAt = null; } }

// Long press (touch only): HOLD_MS without moving MOVE_PX opens the menu; the click that follows the lift is swallowed.
let hold = null, swallowClick = false;
function bindHold(root) {
  root.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    const item = e.target.closest('[data-tg-item]'); if (!item || state.busy) return;
    const x = e.clientX, y = e.clientY;
    clearTimeout(hold?.timer);
    hold = {x, y, item, timer:setTimeout(() => {
      hold = null; swallowClick = true;
      const trigger = item.querySelector('[data-tg-more]'); if (!trigger) return;
      navigator.vibrate?.(10);
      pinAt(trigger, x, y + 4); menu.open(trigger);
    }, HOLD_MS)};
  });
  const cancel = e => { if (!hold) return; if (e.type === 'pointermove' && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < MOVE_PX) return; clearTimeout(hold.timer); hold = null; };
  root.addEventListener('pointermove', cancel); root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel);
  // The phone's own long-press menu (copy, select) does not open over a bubble; text elsewhere keeps it.
  root.addEventListener('contextmenu', e => { if (e.target.closest('[data-tg-item]') && (e.pointerType === 'touch' || phone.matches)) e.preventDefault(); });
  root.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

function bind() {
  const root = view(); if (!root || root.dataset.tgBound) return; root.dataset.tgBound = '1';
  bindHold(root);
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || !root.contains(b)) return;
    const d = b.dataset;
    if (d.tgOpen) select(d.tgOpen);
    else if (d.tgMore) menu.open(b);
    else if (b.hasAttribute('data-tg-detail-more')) menu.open(b);
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
  layer = null; state.link = null; menu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; undo = null; state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches && layer) { const l = layer; layer = null; l.close(); } paint(); } });
paint();
window.KPTUTelegramFeed = {reload:() => load()};
