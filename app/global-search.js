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
import {requestLibraryDocument, requestLibrarySelection} from './basket-library-send.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {notify} from './small-notice.js';
import {looksSecret, SECRET_TITLE} from './note-secret.mjs';

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
  syncInputs(); syncAddress();
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
  resetFolders();
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
    statusLine.textContent = '두 글자 이상 입력하면 업데이트·노트·할 일·자료실·사업 보고·일정을 함께 찾아요.';
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
  if (folderAsk.size) void loadFolders();
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
// SEARCH-선택옮기기 ③(2026-10-28 10:44): 자료실 결과 줄마다 지금 들어 있는 폴더를 작게 '📁 회의자료'. 화면에 그린 자료의 폴더만 한 번에 읽는다
// (자료실과 같은 소유자 표 app_library_folder_items·app_library_folders, 읽기만). 검색할 때마다·자료가 바뀌면(옮긴 뒤) 다시 읽어 바로 바뀐다. 메모리만.
const docFolder = new Map(); let folderAsk = new Set(), folderSeq = 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resetFolders() { docFolder.clear(); folderAsk = new Set(); folderSeq++; }
async function loadFolders() {
  const ids = [...folderAsk].filter(id => !docFolder.has(id) && UUID.test(id)); folderAsk = new Set();
  const api = window.KPTURuntime?.api; if (!ids.length || typeof api !== 'function') return;
  const mine = folderSeq; for (const id of ids) docFolder.set(id, '');
  try {
    const items = await api(`/rest/v1/app_library_folder_items?document_id=in.(${ids.map(encodeURIComponent).join(',')})&select=document_id,folder_id`);
    const fids = [...new Set((Array.isArray(items) ? items : []).map(x => x.folder_id).filter(id => UUID.test(id || '')))];
    const folders = fids.length ? await api(`/rest/v1/app_library_folders?id=in.(${fids.map(encodeURIComponent).join(',')})&select=id,name`) : [];
    if (mine !== folderSeq) return;
    const name = new Map((Array.isArray(folders) ? folders : []).map(f => [f.id, String(f.name || '')]));
    let any = false; for (const x of items || []) if (name.get(x.folder_id)) { docFolder.set(x.document_id, name.get(x.folder_id)); any = true; }
    if (any) paintAll();
  } catch { /* 폴더 표시는 덤이다. 못 읽으면 표시 없이 둔다. */ }
}
window.addEventListener('kptu:documents-changed', () => { if (docFolder.size) { resetFolders(); if (state.groups) paintAll(); } });
window.addEventListener('kptu:session-changed', resetFolders);
function rowNode(item, key, where) {
  const row = el('div', 'gs-row'); row.setAttribute('role', 'option'); row.id = `gsOpt-${where}-${++optionSeq}`;
  const k = `${item.source}:${item.id}`; row.dataset.gsKey = k; rowsByKey.set(k, item);
  row.append(icon(groupOf(groupKeyOfServer(item.kind) || key)?.icon || groupOf(key)?.icon));
  const main = el('span', 'gs-row-main');
  const head = el('span', 'gs-row-head');
  // NOTE-비밀메모(17:23 결정): 비밀번호·토큰·키 모양 글이 보이는 노트 결과는 제목을 '비밀 메모'로 가리고 본문 조각은 보이지 않는다.
  const secret = item.source === 'note' && item.kind === 'note' && looksSecret(`${item.title || ''}\n${item.snippet || ''}`);
  head.append(secret ? el('span', 'gs-row-title', SECRET_TITLE) : marked(item.title, state.words, 'gs-row-title'));
  if (item.state && STATE_LABEL[item.state]) head.append(el('span', `gs-state gs-state-${item.state}`, STATE_LABEL[item.state]));
  if (item.source === 'document') { const f = docFolder.get(item.id); if (f) head.append(el('span', 'gs-row-folder', `📁 ${f}`)); else if (f === undefined) folderAsk.add(item.id); }
  main.append(head);
  const meta = [dateLabel(item), placeLabel(item)].filter(Boolean).join(' · ');
  if (meta) main.append(el('span', 'gs-row-meta', meta));
  if (item.snippet && item.matched_in !== 'title' && !secret) {
    const snip = marked(item.snippet, state.words, 'gs-row-snippet');
    // ② 첨부 안 글자: 자료(document)는 파일 안 글자(extracted_text), 메모는 사진 글자(ocr). 작은 글자 한 줄로만 밝힌다.
    if (item.matched_in === 'attachment') snip.prepend(el('span', 'gs-row-where', item.source === 'document' ? '파일 안 글자에서 찾음 · ' : '사진 글자 · '));
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
  view = el('section', 'view-panel hidden gs-view'); view.id = 'searchView'; view.setAttribute('aria-label', '검색');
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
  if (e.target.closest?.('.lu-move-picker')) return; // 노트 [폴더로 옮기기 ›]의 폴더 고르기 창(결과 창은 그대로 둔다)
  void closePanel();
}, true);
PC.addEventListener('change', () => { if (!PC.matches && panelOpen) void closePanel(); paintAll(); });

function paintAll() {
  if (panelOpen) paint(panelBody, 'panel');
  if (view && router()?.current === 'search') paint(viewBody, 'view');
  const where = view?.querySelector('.gs-view-title');
  if (where) where.textContent = state.text.trim() ? `‘${state.text.trim()}’ 검색 결과` : '검색 결과';
}
// SEARCH-선택옮기기(1차, LIB-후속1 ②): 자료실 결과 줄을 우클릭(폰은 꾹 누르기 = 브라우저 contextmenu)하면 작은 메뉴.
// 맨 위 [선택], 자료실 결과가 여럿이면 [자료실 결과 n개 모두 고르기], [열기]. 고르면 자료실 화면의 같은 선택 모드(같은 메뉴·폴더로 옮기기·분류 바꾸기·지우기)로
// 넘어가 그 자료들이 고른 채로 열린다(선택·옮기기 부품을 따로 만들지 않음).
// NOTE-탐색기 후속 ⑥(10:44 ②): 노트 결과 줄도 같은 메뉴를 연다. 노트는 노트 폴더, 자료실 자료는 자료실 폴더라 종류별로 나눠 묻는다 —
// 노트는 [폴더로 옮기기 ›]·[노트 결과 n개 폴더로 옮기기 ›]가 노트 화면과 같은 폴더 나무 고르기 창(note-folder-pick.js → library-move-picker.js)을 열어
// 그 자리에서 옮기고('옮겼어요 노트 n개 → 📁 이름 · 되돌리기'), 자료실 자료는 [자료실 결과 n개 모두 고르기](노트 줄 메뉴에도 있음)로 자료실 선택 모드에
// 넘겨 자료실 폴더를 고른다. 자료실 줄 메뉴는 그대로([선택]·[모두 고르기]·[열기]).
// 할 일·일정 등 폴더 없는 종류의 결과는 메뉴가 없다(고를 수 없음).
const docKeys = host => [...(host?.querySelectorAll('[role="option"][data-gs-key^="document:"]') || [])].map(o => o.dataset.gsKey);
const isNoteDoc = key => rowsByKey.get(key)?.source === 'note' && rowsByKey.get(key)?.kind === 'note';
const noteKeys = host => [...(host?.querySelectorAll('[role="option"][data-gs-key^="note:"]') || [])].map(o => o.dataset.gsKey).filter(isNoteDoc);
const resultsHost = key => document.querySelector(`[role="option"][data-gs-key="${CSS.escape(key)}"]`)?.closest('.gs-panel, #searchView');
let rowMenu = null;
function gsRowMenu() {
  if (rowMenu) return rowMenu;
  rowMenu = createAnchoredMenu({id: 'gsRowMenu', className: 'lu-more-panel gs-row-menu', label: '검색 결과 메뉴', historyKey: 'kptuSearchRowMenu',
    parent: t => t.closest('.gs-panel, #searchView') || document.body, key: t => t.dataset.gsKey,
    render: key => {
      const host = resultsHost(key), docs = docKeys(host), notes = noteKeys(host);
      if (isNoteDoc(key)) {
        return `<button type="button" data-gs-act="note-move">폴더로 옮기기 ›</button>${notes.length > 1 ? `<button type="button" data-gs-act="note-all">노트 결과 ${notes.length}개 폴더로 옮기기 ›</button>` : ''}${docs.length ? `<button type="button" data-gs-act="all">자료실 결과 ${docs.length}개 모두 고르기</button>` : ''}<button type="button" data-gs-act="open">열기</button>`;
      }
      return `<button type="button" data-gs-act="pick">선택</button>${docs.length > 1 ? `<button type="button" data-gs-act="all">자료실 결과 ${docs.length}개 모두 고르기</button>` : ''}<button type="button" data-gs-act="open">열기</button>`;
    },
    onAction: (button, active) => {
      const act = button.dataset.gsAct, option = active.trigger, item = rowsByKey.get(active.id);
      if (!item) return;
      if (act === 'open') { activate(option); return; }
      const host = option.closest('.gs-panel, #searchView');
      if (act === 'note-move' || act === 'note-all') {
        const keys = act === 'note-all' ? noteKeys(host) : [active.id];
        void moveNoteResults(option, keys.map(k => rowsByKey.get(k)?.id).filter(Boolean));
        return;
      }
      const keys = act === 'all' ? docKeys(host) : [active.id];
      void selectInLibrary(keys.map(k => rowsByKey.get(k)?.id).filter(Boolean));
    }});
  return rowMenu;
}
// 노트 결과를 노트 폴더로(그 자리에서). 폴더 표가 아직 없으면 노트 화면과 같은 안내 한 줄.
async function moveNoteResults(anchor, ids) {
  if (!ids.length) return;
  const rt = window.KPTURuntime, owner = rt?.session?.read?.()?.user?.id;
  const {loadNoteFolders, openNoteFolderPicker, moveNotesToFolder} = await import('./note-folder-pick.js');
  const {ready, folders} = await loadNoteFolders(rt).catch(() => ({ready: false, folders: []}));
  if (owner !== rt?.session?.read?.()?.user?.id || !anchor.isConnected) return;
  if (!ready) { notify('노트 폴더를 읽지 못했어요. 잠시 뒤 다시 해 주세요.', {error: true}); return; }
  openNoteFolderPicker({anchor, folders, onPick: async folder => {
    const result = await moveNotesToFolder(ids, folder, {rt, folders});
    if (owner !== rt?.session?.read?.()?.user?.id) return;
    const n = result.done.length;
    if (!n) { notify('노트를 옮기지 못했어요. 다시 해 주세요.', {error: true}); return; }
    window.dispatchEvent(new CustomEvent('kptu:basket-notes-restored'));
    notify(`옮겼어요 노트 ${n}개 → ${result.place}${result.failed.length ? ` · ${result.failed.length}개는 못 옮김` : ''}`, {label: `노트 폴더 옮기기 ${n}개`,
      undo: result.undo ? async () => { const ok = await result.undo(); window.dispatchEvent(new CustomEvent('kptu:basket-notes-restored')); return ok; } : null});
  }});
}
async function selectInLibrary(ids) {
  if (!ids.length) return;
  const mine = ++opening;
  await closePanel();
  const r = router(); if (!r) return;
  try { await window.KPTUViewLoader?.load?.('library'); } catch { return; }
  if (mine !== opening) return;
  requestLibrarySelection(ids); r.go('library', {source: 'delegated'});
}
document.addEventListener('contextmenu', e => {
  const option = e.target.closest?.('.gs-panel [role="option"][data-gs-key^="document:"], #searchView [role="option"][data-gs-key^="document:"], .gs-panel [role="option"][data-gs-key^="note:"], #searchView [role="option"][data-gs-key^="note:"]');
  if (!option || e.shiftKey || !rowsByKey.has(option.dataset.gsKey)) return;
  if (option.dataset.gsKey.startsWith('note:') && !isNoteDoc(option.dataset.gsKey)) return;
  e.preventDefault(); e.stopPropagation();
  window.KPTUContextMenu?.pinAt?.(option, e.clientX, e.clientY);
  gsRowMenu().open(option);
}, true);
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
