// SEARCH-전체검색 S-3·S-4: 전체 검색 화면의 유일한 renderer(설계 docs/design/global-search.md 4절).
// - PC(1024px~): 상단 줄 칸 자리([data-search-slot], topbar-actions.js 소유)에 검색칸만 붙이고, 칸 아래 결과 창을 연다.
// - 검색 결과 전용 화면(?view=search&q=…&kind=…): 이 모듈이 #searchView를 만들고 그린다. 폰·761~1023px에서는 같은 화면이
//   전체 화면 검색이다(왼쪽 위 ←, 메뉴 창 맨 위 검색칸이 입구). 홈에는 검색칸이 없다.
// - 결과 창·전용 화면·전체 화면은 같은 그리기 함수(paint)로 그린다. 형광은 textContent 조각 + <mark>(HTML 삽입 없음).
// - 결과를 누르면 source 칸 기준으로 원본 화면의 기존 여는 함수를 부른다. 상단 줄 ←→(앱 안 이동 기록)로 돌아온다.
// 저장하는 것 없음(최근 검색어 기억 안 함, 결정 7). 로그인이 바뀌면 메모리를 비운다.
import {parseQuery, QUERY_MESSAGES, errorMessage, highlightParts, buildGroups, chipOptions, countLabel, GROUPS, groupOf, serverKindOf,
  groupKeyOfServer, openTarget, dateLabel, placeLabel, STATE_LABEL, PREVIEW, PAGE, byRecent} from './global-search-model.mjs';
import * as data from './global-search-data.js';
import {renderFilterChips} from './filter-chips.js';
import {placeAnchored, clearAnchored, followAnchor} from './anchored-popup.js';
import {requestBasketNote, requestNoteDocOpen, requestTaskOpen} from './basket-note-tasks.js';
import {requestLibraryDocument} from './basket-library-send.js';

(() => {
'use strict';
if (window.KPTUGlobalSearch) return;
const DEBOUNCE = 250, PC = window.matchMedia('(min-width:1024px)');
const router = () => window.KPTURouter;

// ---------- 상태(이 탭 메모리만) ----------
let state = fresh();
let seq = 0, timer = 0;
function fresh() {
  return {text: '', words: [], hint: '', phase: 'idle', error: '', groups: null, server: null, kind: 'all',
    kindRows: null, kindTotal: 0, kindCapped: false, kindOffset: 0, kindMore: false, kindBusy: false, local: null};
}

// ---------- 아이콘 ----------
const ICON = {
  update: 'M4 5h16v11H9l-5 4z', note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5', task: 'M4 12l5 5L20 6',
  document: 'M4 4h16v5H4zM5 9v11h14V9M10 13h4', meeting: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5', schedule: 'M5 5h14v16H5zM8 3v4m8-4v4M5 10h14',
  work: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5', project: 'M3 7h7l2 2h9v12H3zM3 7V4h7l2 3',
  organization: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4'
};
function icon(name, cls = 'gs-icon') {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', cls);
  path.setAttribute('d', ICON[name] || ICON.search); svg.append(path); return svg;
}
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
function marked(text, words, cls) {
  const box = el('span', cls);
  for (const part of highlightParts(text, words)) box.append(part.mark ? el('mark', 'gs-mark', part.text) : document.createTextNode(part.text));
  return box;
}

// ---------- 찾기 ----------
function setText(text) {
  state.text = String(text ?? '');
  syncInputs();
  clearTimeout(timer);
  const parsed = parseQuery(state.text);
  if (state.text.trim()) { void data.loadEvents().then(repaintLocal); void data.loadTasks().then(repaintLocal); }
  if (parsed.error) {
    seq++;
    Object.assign(state, {words: [], groups: null, server: null, phase: state.text.trim() ? 'hint' : 'idle',
      hint: state.text.trim() ? QUERY_MESSAGES[parsed.error] : '', error: '', kindRows: null});
    paintAll(); return;
  }
  state.hint = '';
  if (parsed.words.join(' ') === state.words.join(' ') && state.phase === 'ready') { paintAll(); return; }
  state.phase = 'loading'; state.words = parsed.words; paintAll();
  timer = setTimeout(() => run(parsed.query), DEBOUNCE);
}
async function run(query) {
  const mine = ++seq;
  try {
    const r = await data.searchRecords(query, {per: PREVIEW});
    if (mine !== seq) return;
    state.server = r.groups; state.words = r.words?.length ? r.words : state.words;
    state.phase = 'ready'; state.error = '';
    rebuild();
    if (state.kind !== 'all') await loadKind(state.kind, {reset: true, mine});
  } catch (e) {
    if (mine !== seq) return;
    state.phase = 'error'; state.error = errorMessage(e); state.groups = null;
  }
  if (mine === seq) paintAll();
}
function rebuild() {
  const local = data.localMatches(state.words);
  state.local = local;
  state.groups = state.server ? buildGroups(state.server, {task: local.task, schedule: local.schedule}, PREVIEW) : null;
}
function repaintLocal() { if (state.phase !== 'ready') return; rebuild(); if (state.kind !== 'all') mergeKind(); paintAll(); }

// 한 종류 모두 보기: 서버 종류는 PAGE줄씩 이어 읽고, 브라우저 묶음(할 일·Google 일정)은 이미 거른 전부를 섞는다.
let kindServer = [];
async function loadKind(key, {reset = false, mine = seq} = {}) {
  const kind = serverKindOf(key);
  if (reset) { kindServer = []; state.kindOffset = 0; state.kindMore = false; state.kindTotal = 0; state.kindCapped = false; }
  if (kind && state.words.length) {
    state.kindBusy = true; paintAll();
    try {
      const r = await data.searchRecords(state.words.join(' '), {per: PAGE, kind, offset: state.kindOffset});
      if (mine !== seq || state.kind !== key) return;
      const g = r.groups.get(kind);
      kindServer = [...kindServer, ...(g?.items || [])];
      state.kindOffset = kindServer.length; state.kindTotal = g?.total || 0; state.kindCapped = !!g?.capped;
      state.kindMore = kindServer.length < Math.min(state.kindTotal, 200);
    } catch (e) {
      if (mine !== seq) return;
      state.error = errorMessage(e);
    } finally { if (mine === seq) state.kindBusy = false; }
  }
  mergeKind();
  if (mine === seq) paintAll();
}
function mergeKind() {
  const key = state.kind, extra = state.local?.[key] || [];
  let rows = [...kindServer, ...extra].sort(byRecent);
  // 서버에 더 있는 동안은 마지막 서버 줄보다 오래된 브라우저 줄을 아직 보이지 않는다(순서가 어긋나지 않게).
  if (state.kindMore && kindServer.length) { const cut = Date.parse(kindServer.at(-1).occurred_at || '') || -Infinity; rows = rows.filter(r => (Date.parse(r.occurred_at || '') || -Infinity) >= cut); }
  state.kindRows = rows;
}
function chooseKind(key) {
  if (state.kind === key) return;
  state.kind = key; state.kindRows = null; state.error = state.phase === 'error' ? state.error : '';
  syncAddress();
  if (key === 'all') { paintAll(); return; }
  if (state.phase === 'ready') void loadKind(key, {reset: true}); else paintAll();
}

// ---------- 그리기(결과 창·전용 화면·전체 화면 공용) ----------
let optionSeq = 0;
function paint(host, where) {
  if (!host) return;
  const prevActive = host.querySelector('[role="option"].is-active')?.dataset.gsKey;
  host.replaceChildren();
  const box = el('div', 'gs-results');
  box.dataset.gsWhere = where;
  const statusLine = el('p', 'gs-status'); statusLine.setAttribute('role', 'status'); statusLine.setAttribute('aria-live', 'polite');
  if (state.phase === 'idle') {
    statusLine.textContent = '두 글자 이상 입력하면 업데이트·노트·할 일·자료실·회의 결과·일정을 함께 찾아요.';
    box.append(statusLine); host.append(box); return;
  }
  if (state.phase === 'hint') { statusLine.textContent = state.hint; box.append(statusLine); host.append(box); return; }
  if (state.groups) {
    const chips = el('div', 'gs-chips');
    const options = chipOptions(state.groups);
    if (state.kind !== 'all' && !options.some(o => o.value === state.kind)) {
      const g = state.groups.find(x => x.key === state.kind);
      options.push({value: state.kind, label: `${groupOf(state.kind)?.label || ''} ${countLabel(g?.total, g?.capped)}`});
    }
    renderFilterChips(chips, {options, value: state.kind, label: '찾을 종류', small: true, onChange: v => chooseKind(v)});
    box.append(chips);
  }
  if (state.phase === 'loading' && !state.groups) statusLine.textContent = '찾는 중…';
  else if (state.phase === 'error') statusLine.textContent = state.error;
  else if (state.phase === 'loading') statusLine.textContent = '찾는 중…';
  box.append(statusLine);
  const list = el('div', 'gs-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', '검색 결과');
  list.id = `gsList-${where}`;
  if (state.groups) {
    const groups = state.kind === 'all' ? state.groups.filter(g => g.total > 0)
      : [{...state.groups.find(g => g.key === state.kind), items: state.kindRows || [], kindMode: true}];
    if (!groups.length || (state.kind !== 'all' && !groups[0]?.items?.length && !state.kindBusy && state.kindRows)) {
      if (state.phase === 'ready') statusLine.textContent = '찾은 기록이 없어요.';
    }
    for (const g of groups) if (g?.key) list.append(groupNode(g, where));
    if (state.kind !== 'all' && state.kindBusy && !state.kindRows?.length) statusLine.textContent = '찾는 중…';
  }
  box.append(list);
  const notes = [];
  if (state.local?.eventsFailed) notes.push('일정은 이번에 찾지 못했어요.');
  if (state.local?.tasksFailed) notes.push('할 일은 이번에 찾지 못했어요.');
  if (state.groups) notes.push('할 일은 미완료와 최근 완료만, Google 일정은 지난 3개월~앞 6개월의 제목·장소만 찾아요. 더 오래된 일정은 달력에서 찾아 주세요.');
  for (const n of notes) box.append(el('p', 'gs-foot', n));
  host.append(box);
  const again = prevActive && host.querySelector(`[role="option"][data-gs-key="${CSS.escape(prevActive)}"]`);
  if (again) setActive(host, again, {scroll: false});
}
function groupNode(g, where) {
  const sec = el('section', 'gs-group'); sec.setAttribute('role', 'group'); sec.dataset.gsGroup = g.key;
  const band = el('div', 'gs-band'); band.id = `gsBand-${where}-${g.key}`;
  band.append(icon(groupOf(g.key)?.icon), el('b', 'gs-band-name', g.label || groupOf(g.key)?.label), el('span', 'gs-band-count', countLabel(g.total, g.capped)));
  sec.setAttribute('aria-labelledby', band.id); sec.append(band);
  for (const item of g.items || []) sec.append(rowNode(item, g.key, where));
  if (!g.kindMode && g.total > (g.items?.length || 0)) {
    const more = el('div', 'gs-more', `${countLabel(g.total, g.capped)}건 모두 보기`);
    more.setAttribute('role', 'option'); more.id = `gsOpt-${where}-${++optionSeq}`; more.dataset.gsKey = `more:${g.key}`; more.dataset.gsMore = g.key;
    sec.append(more);
  }
  if (g.kindMode && state.kindMore) {
    const more = el('div', 'gs-more', state.kindBusy ? '불러오는 중…' : '더 보기');
    more.setAttribute('role', 'option'); more.id = `gsOpt-${where}-${++optionSeq}`; more.dataset.gsKey = `next:${g.key}`; more.dataset.gsNext = g.key;
    sec.append(more);
  }
  return sec;
}
const rowsByKey = new Map();
function rowNode(item, key, where) {
  const row = el('div', 'gs-row'); row.setAttribute('role', 'option'); row.id = `gsOpt-${where}-${++optionSeq}`;
  const k = `${item.source}:${item.id}`; row.dataset.gsKey = k; rowsByKey.set(k, item);
  row.append(icon(groupOf(groupKeyOfServer(item.kind) || key)?.icon || groupOf(key)?.icon));
  const main = el('span', 'gs-row-main');
  const head = el('span', 'gs-row-head');
  head.append(marked(item.title, state.words, 'gs-row-title'));
  if (item.state && STATE_LABEL[item.state]) head.append(el('span', `gs-state gs-state-${item.state}`, STATE_LABEL[item.state]));
  main.append(head);
  const meta = [dateLabel(item), placeLabel(item)].filter(Boolean).join(' · ');
  if (meta) main.append(el('span', 'gs-row-meta', meta));
  if (item.snippet && item.matched_in !== 'title') {
    const snip = marked(item.snippet, state.words, 'gs-row-snippet');
    if (item.matched_in === 'attachment') snip.prepend(el('span', 'gs-row-where', '사진 글자 · '));
    main.append(snip);
  }
  row.append(main);
  return row;
}

// ---------- 활성 줄(↑↓) ----------
const options = host => [...(host?.querySelectorAll('[role="option"]') || [])];
function setActive(host, option, {scroll = true} = {}) {
  for (const o of options(host)) { o.classList.toggle('is-active', o === option); o.setAttribute('aria-selected', String(o === option)); }
  const input = inputFor(host);
  if (input) { if (option) input.setAttribute('aria-activedescendant', option.id); else input.removeAttribute('aria-activedescendant'); }
  if (option && scroll) option.scrollIntoView({block: 'nearest'});
}
function moveActive(host, step) {
  const list = options(host); if (!list.length) return;
  const at = list.findIndex(o => o.classList.contains('is-active'));
  const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + step));
  setActive(host, list[next]);
}
function activate(option) {
  if (!option) return;
  if (option.dataset.gsMore) { showAll(option.dataset.gsMore); return; }
  if (option.dataset.gsNext) { if (!state.kindBusy) void loadKind(option.dataset.gsNext); return; }
  const item = rowsByKey.get(option.dataset.gsKey);
  if (item) openItem(item);
}

// ---------- 원본 열기(source 기준, 각 화면의 기존 여는 함수) ----------
let opening = 0;
async function openItem(item) {
  const target = openTarget(item);
  if (!target) return;
  const mine = ++opening;
  await closePanel();
  const r = router(); if (!r) return;
  const loader = window.KPTUViewLoader;
  try {
    await loader?.load?.(target.view);
    if (mine !== opening) return;
    if (target.view === 'basket') {
      if (target.note === 'doc') requestNoteDocOpen(target.id); else requestBasketNote(target.id);
      r.go('basket', {source: 'delegated'});
    } else if (target.view === 'library') { requestLibraryDocument(target.id); r.go('library', {source: 'delegated'}); }
    else if (target.view === 'tasks') { requestTaskOpen(target.id); r.go('tasks', {source: 'delegated'}); }
    else if (target.view === 'journal') { r.go('journal', {source: 'delegated'}); if (target.day) window.KPTUJournal?.show?.(target.day); }
    else if (target.view === 'projects') { r.go('projects', {source: 'delegated'}); await window.KPTUProjects?.open?.(target.id); }
    else if (target.view === 'team') { r.go('team', {source: 'delegated'}); await window.KPTUWorkplace?.open?.(target.id); }
    else if (target.view === 'meetings') {
      r.go('meetings', {source: 'delegated'});
      await window.__KPTU_MEETING_ROUND_DETAIL_READY__;
      await window.KPTUMeetingRoundDetail?.open?.(target.id);
    } else if (target.view === 'calendar') {
      r.go('calendar', {source: 'delegated'});
      await window.__KPTU_CALENDAR_INTERACTIONS_READY__;
      window.KPTUCalendarEvents?.open?.(target.id, target.calendarId);
    }
  } catch (e) { console.error('search open', e?.name || 'Error'); }
}

// ---------- 전용 화면(#searchView) ----------
let view = null, viewInput = null, viewBody = null;
function installView() {
  if (view) return view;
  const app = document.querySelector('#appView'); if (!app) return null;
  view = el('section', 'view-panel hidden gs-view'); view.id = 'searchView'; view.setAttribute('aria-label', '검색'); view.dataset.swipeLock = '';
  const bar = el('div', 'gs-view-bar');
  const back = el('button', 'gs-back'); back.type = 'button'; back.setAttribute('aria-label', '검색 닫기'); back.append(el('span', null, '←')); back.firstChild.setAttribute('aria-hidden', 'true');
  back.addEventListener('click', () => { if (!router()?.back?.()) router()?.go?.('home', {source: 'delegated'}); });
  viewInput = makeInput('gsViewInput', 'gs-view-input');
  const head = el('h2', 'gs-view-title', '검색 결과');
  bar.append(back, viewInput.wrap, head);
  viewBody = el('div', 'gs-view-body');
  view.append(bar, viewBody);
  app.append(view);
  router()?.on?.('search', enterView);
  return view;
}
function enterView() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q'), kind = params.get('kind');
  if (q != null && q !== state.text) { state.kind = GROUPS.some(g => g.key === kind) ? kind : 'all'; setText(q); }
  else if (kind && kind !== state.kind && GROUPS.some(g => g.key === kind)) chooseKind(kind);
  syncAddress();
  paintAll();
  if (!PC.matches) requestAnimationFrame(() => { viewInput.input.focus({preventScroll: true}); });
}
function showAll(key) {
  state.kind = key; state.kindRows = null;
  if (state.phase === 'ready') void loadKind(key, {reset: true});
  if (router()?.current === 'search') { syncAddress(); paintAll(); return; }
  void closePanel().then(async () => {
    await window.KPTUViewLoader?.load?.('search');
    const u = new URL(location.href); u.searchParams.set('q', state.text.trim()); u.searchParams.set('kind', key);
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    router()?.go?.('search', {source: 'delegated'});
  });
}
// 검색 화면에 있는 동안 주소에 q·kind를 둔다(새로고침·뒤로 가기 복원). 다른 화면으로 가면 지운다.
function syncAddress() {
  if (router()?.current !== 'search') return;
  const u = new URL(location.href);
  if (state.text.trim()) u.searchParams.set('q', state.text.trim()); else u.searchParams.delete('q');
  if (state.kind !== 'all') u.searchParams.set('kind', state.kind); else u.searchParams.delete('kind');
  const next = u.pathname + u.search + u.hash;
  if (next !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', next);
}
window.addEventListener('kptu:view-changed', e => {
  if (e.detail?.view === 'search') return;
  const u = new URL(location.href);
  if (u.searchParams.has('q') || u.searchParams.has('kind')) { u.searchParams.delete('q'); u.searchParams.delete('kind'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
  if (panelOpen) void closePanel();
});

// ---------- 검색칸(상단 줄·전용 화면 공용 모양) ----------
const inputs = new Set();
function makeInput(id, cls) {
  const wrap = el('div', `gs-field ${cls}`);
  const label = el('label', 'a11y-only', '전체 검색'); label.htmlFor = id;
  const input = el('input', 'gs-input'); input.id = id; input.type = 'search'; input.placeholder = '전체 검색'; input.autocomplete = 'off';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  input.enterKeyHint = 'search'; input.spellcheck = false;
  wrap.append(icon('search', 'gs-field-icon'), label, input);
  const entry = {wrap, input};
  inputs.add(entry);
  input.addEventListener('input', () => { setText(input.value); if (input === slotInput?.input && router()?.current !== 'search') openPanel(); });
  input.addEventListener('keydown', e => onKey(e, input));
  return entry;
}
function syncInputs() { for (const {input} of inputs) if (input.value !== state.text && document.activeElement !== input) input.value = state.text; }
function hostFor(input) { return input === slotInput?.input && router()?.current !== 'search' ? panelBody : viewBody; }
function inputFor(host) { return host === panelBody ? slotInput?.input : host === viewBody ? (PC.matches && slotInput ? slotInput.input : viewInput?.input) : null; }
function onKey(e, input) {
  const host = hostFor(input);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (host === panelBody && !panelOpen) { if (state.text.trim()) openPanel(); return; }
    e.preventDefault(); moveActive(host, e.key === 'ArrowDown' ? 1 : -1); return;
  }
  if (e.key === 'Enter') {
    const active = host?.querySelector('[role="option"].is-active');
    e.preventDefault();
    if (active) activate(active);
    return;
  }
  if (e.key === 'Escape') {
    if (host === panelBody && panelOpen) { e.preventDefault(); e.stopPropagation(); void closePanel(); return; }
    if (input.value) { e.preventDefault(); input.value = ''; setText(''); }
  }
}

// ---------- 상단 줄 결과 창(PC) ----------
let slotInput = null, panel = null, panelBody = null, panelOpen = false, stopFollow = null, panelLayer = null;
function mountSlot() {
  const slot = document.querySelector('[data-search-slot]');
  if (!slot || slotInput) return;
  slotInput = makeInput('gsTopInput', 'gs-top-field');
  slot.append(slotInput.wrap);
  panel = el('div', 'gs-panel'); panel.id = 'gsPanel'; panel.hidden = true; panel.setAttribute('aria-label', '검색 결과 창');
  panelBody = el('div', 'gs-panel-body'); panel.append(panelBody);
  document.body.append(panel);
  slotInput.input.setAttribute('aria-controls', 'gsList-panel');
  slotInput.input.addEventListener('focus', () => { if (state.text.trim() && router()?.current !== 'search') openPanel(); });
  panel.addEventListener('mousedown', e => { if (e.target.closest('[role="option"],button')) e.preventDefault(); });
}
function placePanel() { if (panel && slotInput) placeAnchored(panel, slotInput.wrap, {maxWidth: 560, maxHeight: 560, minHeight: 200}); }
function openPanel() {
  if (!panel || panelOpen || !PC.matches || router()?.current === 'search') { paintAll(); return; }
  panelOpen = true; panel.hidden = false; slotInput.input.setAttribute('aria-expanded', 'true');
  placePanel();
  stopFollow = followAnchor(panel, slotInput.wrap, {place: placePanel, lost: () => void closePanel()});
  panelLayer = router()?.layer?.open?.('search-panel', {close: () => { panelLayer = null; hidePanel(); return true; }}) || null;
  paintAll();
}
function hidePanel() {
  if (!panelOpen) return;
  panelOpen = false; panel.hidden = true; clearAnchored(panel); stopFollow?.(); stopFollow = null;
  slotInput?.input.setAttribute('aria-expanded', 'false'); slotInput?.input.removeAttribute('aria-activedescendant');
}
// 닫고, 기록 1칸이 되돌아간 뒤 끝난다(다음 화면 이동이 되돌림과 섞이지 않게).
function closePanel() {
  const layer = panelLayer; panelLayer = null;
  const wasOpen = panelOpen; hidePanel();
  if (!wasOpen || !layer) return Promise.resolve();
  const onTop = history.state?.kptuLayers?.at?.(-1) === 'search-panel';
  return new Promise(resolve => {
    if (!onTop) { layer.close(); resolve(); return; }
    let done = false; const finish = () => { if (done) return; done = true; queueMicrotask(resolve); };
    window.addEventListener('popstate', finish, {once: true});
    setTimeout(finish, 600);
    layer.close();
  });
}
document.addEventListener('pointerdown', e => {
  if (!panelOpen) return;
  if (panel.contains(e.target) || slotInput?.wrap.contains(e.target)) return;
  void closePanel();
}, true);
PC.addEventListener('change', () => { if (!PC.matches && panelOpen) void closePanel(); paintAll(); });

function paintAll() {
  if (panelOpen) paint(panelBody, 'panel');
  if (view && router()?.current === 'search') paint(viewBody, 'view');
  const where = view?.querySelector('.gs-view-title');
  if (where) where.textContent = state.text.trim() ? `‘${state.text.trim()}’ 검색 결과` : '검색 결과';
}
// 결과 줄 누르기(결과 창·전용 화면 공용).
document.addEventListener('click', e => {
  const option = e.target.closest?.('.gs-panel [role="option"], #searchView [role="option"]');
  if (!option) return;
  e.preventDefault(); activate(option);
});

// ---------- 폰 메뉴 창 맨 위 검색칸(입구) ----------
function mountMenuEntry() {
  const host = document.querySelector('[data-search-entry]');
  if (!host || host.childElementCount) return;
  const button = el('button', 'gs-menu-entry'); button.type = 'button'; button.setAttribute('aria-label', '전체 검색 열기');
  button.append(icon('search', 'gs-field-icon'), el('span', null, '전체 검색'));
  // topbar-actions.js가 메뉴 판을 먼저 닫고 이 버튼을 다시 누른다(메뉴 판 규칙).
  button.addEventListener('click', async () => {
    if (window.KPTUMobileMenu?.isOpen?.()) return;
    await window.KPTUViewLoader?.load?.('search');
    router()?.go?.('search', {source: 'delegated'});
  });
  host.append(button);
}

window.addEventListener('kptu:session-changed', () => { seq++; clearTimeout(timer); state = fresh(); kindServer = []; rowsByKey.clear(); for (const {input} of inputs) input.value = ''; void closePanel(); paintAll(); });

mountSlot();
mountMenuEntry();
installView();
window.KPTUGlobalSearch = {set: setText, state: () => ({...state})};
window.__KPTU_GLOBAL_SEARCH_READY__ = Promise.resolve(true);
})();
