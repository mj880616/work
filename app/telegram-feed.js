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
// function app_feed_set_state for the three states). TG-발언자이름: the raw view shows names instead of A·B (tg-sender-model.mjs: 직접 이름 →
// 나 → 수집기 이름 → A), [이름 붙이기] under an unnamed label, and the head ⋯ → '보낸 사람 이름' list (고치기·합치기·지우기; tg-sender-data.js, DB
// functions app_tg_sender_*). If the name tables are empty or cannot be read, the screen stays A·B. Room colours are not stored: feed-model.mjs roomTone picks one of six from room_key.
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
import {buildIndex, rawRows, peopleRows, chipsOf, cleanName, linkKey, dayShort, NAME_ERROR_TEXT, SENDER_FAIL_TEXT, MERGE_NOTE, MERGE_BOTH_KEYED} from './tg-sender-model.mjs';
import {readSenders, setSenderName, mergeSenders, forgetSender} from './tg-sender-data.js';

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
let state = fresh(), run = 0, layer = null, shelfLayer = null, editLayer = null, undo = null, undoTimer = 0;
function fresh() { return {owner:'', loaded:false, missing:false, error:'', rows:[], archived:[], trashed:[], archiveReady:true, mode:'live', swipe:null, days:[], orgs:[], mine:new Set(), room:'', selected:null, raw:new Map(), link:null, senders:null, sidx:null, sedit:null, sman:null, status:'', busy:false}; }

function install() {
  if ($('#telegramView')) return;
  $('#appView')?.insertAdjacentHTML('beforeend', `<section id="telegramView" class="view-panel feed-view hidden" aria-labelledby="tgTitle"><h2 id="tgTitle" class="a11y-only">텔레그램 소식</h2><div class="feed-split" id="tgSplit"><div class="feed-list" id="tgList"></div><section class="feed-pane" id="tgDetail" aria-label="텔레그램 원문"></section></div></section>`);
}
install();
const view = () => $('#telegramView');
const rowOf = id => state.rows.find(r => r.id === id) || state.archived.find(r => r.id === id) || state.trashed.find(r => r.id === id) || null;
const listOf = mode => (mode === 'archive' ? state.archived : mode === 'trash' ? state.trashed : state.rows);
const isShelf = () => state.mode === 'archive' || state.mode === 'trash';
const shown = () => (state.mode !== 'live' ? listOf(state.mode) : state.room ? state.rows.filter(r => r.room_key === state.room) : state.rows);

// ---------- data
async function load() {
  const owner = scopeOf(rt), me = ++run; if (!state.loaded) paint();
  try {
    const [feed, days, orgs, senders] = await Promise.all([readTelegramFeed(rt), readDays('telegram', rt).catch(() => []), readOrganizations(rt).catch(() => ({orgs:[], mine:new Set()})), readSenders(rt).catch(() => null)]);
    if (me !== run || owner !== scopeOf(rt)) return;
    const rows = feed.rows;
    Object.assign(state, {owner, loaded:true, missing:false, error:'', rows, archived:feed.archived, trashed:feed.trashed, archiveReady:feed.archiveReady, swipe:null, days, orgs:orgs.orgs, mine:orgs.mine});
    setSenders(senders);
    if (isShelf() && !listOf(state.mode).length) leaveShelf();
    if (state.room && !rows.some(r => r.room_key === state.room)) state.room = '';
    if (state.selected && !rowOf(state.selected)) closeDetail({quiet:true});
  } catch (error) {
    if (me !== run || owner !== scopeOf(rt)) return;
    Object.assign(state, {owner, loaded:true, rows:[], archived:[], trashed:[], swipe:null, missing:missingTable(error), error:missingTable(error) ? '' : '텔레그램 소식을 불러오지 못했어요.'});
  }
  paint();
}
// 이름표: null이면 읽지 못한 것(A·B 그대로, [이름 붙이기] 없음). 빈 표는 {senders:[], links:[]}.
function setSenders(data) { state.senders = data; state.sidx = data ? buildIndex(data.senders, data.links) : null; }
async function reloadSenders() {
  const owner = scopeOf(rt);
  try { const data = await readSenders(rt); if (owner === scopeOf(rt)) setSenders(data); return true; } catch { return false; }
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
  if (state.mode === 'senders') {
    const n = state.senders ? state.senders.senders.length : 0;
    return `<div class="feed-head"><button type="button" class="back-text" data-tg-shelf-back>‹ 소식</button><span class="feed-head-title">보낸 사람 이름${state.senders ? ` · ${n}명` : ''}</span></div>`;
  }
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
  const more = ready ? `<button type="button" class="feed-more" data-tg-head-more aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴">${MORE}</button>` : '';
  return `<div class="feed-head"><span class="feed-head-title" aria-hidden="true">텔레그램 소식</span><span class="feed-head-sub" data-tg-today>${ready ? esc(telegramHeadText(today) + failed) : ''}</span>${shelves}${state.loaded && !state.missing ? filter : ''}${more}</div>`;
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
  if (state.mode === 'senders') { box.innerHTML = headHtml() + sendersBodyHtml() + `<p class="feed-status" data-tg-status role="status">${statusHtml()}</p>`; return; }
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
  else {
    const canName = !!state.senders && !!r.room_key && !!r.day, rows = rawRows(telegramLines(raw.raw_text), state.sidx, r.room_key, r.day, {canName});
    const editing = state.sedit?.kind === 'raw' && state.sedit.rowId === r.id ? state.sedit.label : '';
    lines = `<div class="feed-raw${canName ? ' feed-raw-wide' : ''}" data-tg-raw>${rows.map(l => rawLineHtml(l, editing)).join('')}</div>`;
  }
  const link = state.link?.rowId === r.id ? linkBoxHtml(state.link, state.orgs, 'tg') : '';
  box.innerHTML = `<div class="feed-detail-head">${back}<span class="feed-head-sub" data-tg-raw-sub>${esc(sub)}${r.pinned_at ? ' · 고정' : ''}</span><button type="button" class="feed-more" data-tg-detail-more data-ctx="area" aria-haspopup="true" aria-expanded="false" aria-label="소식 메뉴"${state.busy ? ' disabled' : ''}>${MORE}</button></div>
<div class="feed-detail" data-tg-detail="${esc(r.id)}"><div class="feed-sum-row"><p class="feed-sum">${esc(r.summary || '')}</p>${tgText(r) ? copyButtonHtml('data-tg-copy') : ''}</div>${link}${lines}<p class="feed-status" data-tg-detail-status role="status">${statusHtml()}</p></div>`;
}

// 한 줄: 시간 · 말한 사람(이름 > 나 > 수집기 이름 > A) · 글. 이름 없는 라벨의 그 날 첫 줄에만 [이름 붙이기]. 편집 중이면 그 줄 바로 아래에 이름 상자.
function rawLineHtml(l, editing) {
  const k = l.shown.kind, cls = `feed-who${k === 'label' ? '' : ' is-named'}${k === 'self' ? ' is-self' : ''}${l.same ? ' is-same' : ''}`;
  const tag = l.tag ? `<button type="button" class="feed-whotag" data-tg-name-open="${esc(l.who)}" aria-label="${esc(l.who)} 이름 붙이기">이름 붙이기</button>` : '';
  const row = `<div class="feed-rm"><span class="feed-at">${esc(l.at)}</span><span class="${cls}" title="${esc(l.shown.text)}">${esc(l.shown.text)}${tag}</span><span class="feed-rt">${l.forwarded ? '<span class="feed-faint">(전달)</span> ' : ''}${esc(l.text)}</span></div>`;
  return l.tag && editing === l.who ? row + sboxHtml() : row;
}

// ---------- 보낸 사람 이름 (TG-발언자이름)
const roomLabelOf = key => [...state.rows, ...state.archived, ...state.trashed].find(r => r.room_key === key)?.room_label || '다른 방';
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
function startRawEdit(label) {
  const r = rowOf(state.selected); if (!r || !state.senders || !r.room_key || !r.day || state.busy) return;
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
  }).then(() => { if (!state.sedit) (state.mode === 'senders' ? $('#tgList [data-tg-shelf-back]') : $('#tgDetail [data-tg-detail-more]'))?.focus({preventScroll:true}); });
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
function select(id) {
  if (state.link && !dropLink()) return;
  if (state.sedit?.kind === 'raw') endEdit();
  state.selected = id; state.status = ''; undo = null;
  if (!pc.matches) layer ||= window.KPTURouter?.layer?.open('telegram-raw', {close:() => { layer = null; closeDetail({fromBack:true}); return true; }}) || null;
  paint(); void loadRaw(id);
  (pc.matches ? $(`#tgList [data-tg-open="${CSS.escape(id)}"]:not([data-tg-pinbar])`) : $('#tgDetail [data-tg-back]'))?.focus({preventScroll:true});
}
function closeDetail({fromBack = false, quiet = false} = {}) {
  const id = state.selected; state.selected = null; state.link = null; if (state.sedit?.kind === 'raw') endEdit();
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
  if (isShelf() && !listOf(state.mode).length) leaveShelf();
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
  state.mode = mode; state.swipe = null; state.status = ''; state.sedit = null; state.sman = null;
  shelfLayer ||= window.KPTURouter?.layer?.open('telegram-shelf', {close:() => { shelfLayer = null; state.mode = 'live'; state.swipe = null; state.sedit = null; state.sman = null; paint(); return true; }}) || null;
  paint(); $('#tgList [data-tg-shelf-back]')?.focus({preventScroll:true});
}
function leaveShelf() { const l = shelfLayer; shelfLayer = null; state.mode = 'live'; state.swipe = null; state.sedit = null; state.sman = null; l?.close(); }
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
  key:t => (t.hasAttribute('data-tg-head-more') ? 'head:' : (t.dataset.tgMore ? 'item:' : 'detail:') + menuTarget(t)),
  render:id => {
    if (id === 'head:') return '<button type="button" data-tg-act="senders">보낸 사람 이름</button>';
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
    if (active.id === 'head:') { if (button.dataset.tgAct === 'senders') enterShelf('senders'); return; }
    const r = rowOf(active.id.slice(active.id.indexOf(':') + 1)); if (!r) return; const act = button.dataset.tgAct;
    if (act === 'pin') void pin(r); else if (FEED_ACTIONS[act]) void moveTo(r, act); else if (act === 'raw') select(r.id); else if (act === 'copy') void copyTg(r); else if (act === 'link') startLink(r);
  },
  onClose:() => hold.unpin()});
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
    else if (b.hasAttribute('data-tg-head-more')) menu.open(b);
    else if (d.tgPersonMore) pmenu.open(b);
    else if (d.tgNameOpen) startRawEdit(d.tgNameOpen);
    else if (d.tgPersonName) startPersonEdit(d.tgPersonName);
    else if (b.hasAttribute('data-tg-sbox-cancel') || b.hasAttribute('data-tg-sman-cancel')) cancelPanel();
    else if (b.hasAttribute('data-tg-sbox-save')) void saveName();
    else if (b.hasAttribute('data-tg-sman-save')) void saveMan();
    else if (d.tgSboxChip) { const e = state.sedit, c = chipsOf(peopleList(), e?.excludeId).find(x => x.id === d.tgSboxChip); if (e && c) { e.value = c.text; e.chipId = c.id; e.status = ''; paintEdit(); $(`${e.kind === 'person' ? '#tgList' : '#tgDetail'} [data-tg-sbox-input]`)?.focus({preventScroll:true}); } }
    else if (b.hasAttribute('data-tg-detail-more')) menu.open(b);
    else if (b.hasAttribute('data-tg-copy')) { const r = rowOf(state.selected); if (r) void copyTg(r); }
    else if (b.hasAttribute('data-tg-back')) { if (!state.link || dropLink()) closeDetail(); }
    else if (b.hasAttribute('data-tg-retry')) void load();
    else if (b.hasAttribute('data-tg-undo')) void restore();
    else if (b.hasAttribute('data-tg-link-pick')) { const box = state.link; if (box) void openOrgPicker(b, {orgs:state.orgs, mine:state.mine, selected:box.orgId, onPick:id => { box.orgId = id; paintDetail(); $('#tgDetail [data-tg-link-pick]')?.focus({preventScroll:true}); }}); }
    else if (b.hasAttribute('data-tg-link-cancel')) { state.link = null; paintDetail(); $('#tgDetail [data-tg-detail-more]')?.focus({preventScroll:true}); }
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
  layer = null; shelfLayer = null; editLayer = null; state.link = null; state.sedit = null; state.sman = null; state.mode = 'live'; state.swipe = null; menu.close?.(null, true); pmenu.close?.(null, true);
  window.dispatchEvent(new CustomEvent('kptu:where-item', {detail:{view:'telegram', name:null}}));
});
window.addEventListener('kptu:session-changed', () => { run++; layer = null; shelfLayer = null; editLayer = null; undo = null; clearTimeout(undoTimer); state = fresh(); if (view()) paint(); });
pc.addEventListener?.('change', () => { if (view() && !view().classList.contains('hidden')) { if (pc.matches && layer) { const l = layer; layer = null; l.close(); } paint(); } });
paint();
window.KPTUTelegramFeed = {reload:() => load()};
