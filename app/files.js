import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {claimedSince} from './row-swipe.js';
import {requestLibraryDocument} from './basket-library-send.js';
import {slotBox, slotImg, slotFailed} from './img-slot.js';
import {SOURCES, SOURCE_NAME, SHELVES, SHELF_NAME, PHONE_TABS, PHONE_TAB_NAME, SYNC_EVERY_MS, SHELF_LIMIT, FIND_LIMIT, FIND_WAIT_MS,
  TEXT_PREVIEW_BYTES, PDF_FIRST_PAGES, SORTS, SORT_NAME, kindOf, kindLabel, kindIcon, previewKind, sizeText, countText, dayText, fullTime,
  recentGroups, syncText, sortRows, validSort, rowKey, applyChanges, touchesCounts, trailNames, trailIds, pathText, folderKey, treeRows,
  placeOf, whereOf, tabAt, cleanQuery, findSummary, errorText, moveCheck, pickRange, groupBySource, touchedFolders, moveTargetOk,
  trashAsk, writeDoneText, writeErrorText} from './files-model.mjs';
import {askConfirm, askText, notify} from './small-notice.js';
import {checkFileBase, splitFileName, FILE_BASE_MAX} from './file-rename-name.mjs';
// FILES-클라우드탐색기 ④ 화면(설계 docs/design/files-explorer.md 4·5·6절, 명진 결정 F1~F9 11/02): 메뉴 '파일'(?view=files). #filesView의 유일한 그리기 주인.
// - 목록은 서버 색인(app_cloud_list·app_cloud_find·app_cloud_trail, owner + 운영자 기능 files일 때만 읽힘)에서 바로 그린다. 클라우드는 부르지 않는다.
// - 갱신(F2): 들어올 때 + 2분마다 + 창으로 돌아올 때 Edge cloud-files sync(서버가 2분 안이면 클라우드를 부르지 않음). 응답의 바뀐 줄만
//   지금 목록에 입힌다(applyChanges). 많이 바뀌면(reload) 지금 목록을 서버에서 다시 읽는다. 밤 한 번은 서버 예약(⑧).
// - 미리보기(오른쪽 칸 / 폰·폴드는 겹친 칸, 뒤로가기 한 번 = 닫힘): 사진 = 큰 썸네일, PDF = 원본, 오피스 = 서버가 PDF로 바꾼 것(F4),
//   PDF는 저장소에 고정한 pdf.js로 쪽마다 그린다. 글 = 앞 200KB. 그 밖은 이름·크기·위치만 + [열기](클라우드 보기 새 창).
// - 폰 첫 화면은 최근 파일(F9). 탭 [최근·폴더·별표], 좌우로 밀어 탭 이동. 폰은 보기·찾기·열기·공유.
// - 쓰기(S48-45 ⑤·⑦): 이름 바꾸기·새 폴더·옮기기(같은 클라우드는 200개까지, 원드라이브↔구글은 1개·200MB까지, F8)·휴지통(F1: 그 클라우드
//   휴지통, 확인 창 한 번). 모두 사람이 누른 것만 Edge cloud-files로 보내고(confirm:true), 서버가 로그인·주인·색인을 다시 본다.
//   고르기: PC는 Ctrl·⌘(하나씩)·Shift(이어서) 누르고 고르기, 폰은 꾹 누르기. 고르면 위에 한 줄 막대(옮기기·이름·휴지통·✕).
//   옮기기: [옮기기] → 옮길 폴더를 열고 [여기로 옮기기](잘라 붙이기와 같음). PC는 줄을 폴더(목록·나무)로 끌어 놓아도 된다.
//   PC 단축키: F2 이름 · Delete 휴지통 · Ctrl+A 모두 고르기 · Ctrl+X 옮기기 · Ctrl+V 여기로 옮기기 · Esc 고르기 풀기.
//   결과는 서버가 돌려준 바뀐 줄로 지금 목록을 고친다(sync와 같은 applyChanges, 다시 그리기 주인은 이 파일 하나).
// 저장은 서버만: 목록은 이 탭 메모리(열린 동안만), 받은 그림·PDF는 blob: 주소(메모리)로만 두고 화면을 떠나면 놓는다. 기기 저장 없음.
// 파일 이름은 모두 글자로만 그린다(esc). 로그에 파일 이름·id를 남기지 않는다.

(() => {
if (window.KPTUFiles) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const FN = '/functions/v1/cloud-files';
const PHONE = window.matchMedia('(max-width:760px)');
const WIDE = window.matchMedia('(min-width:1200px)');
const PDF_LIB = new URL('./pdf-lib/pdfjs-dist-6.3.289/', import.meta.url);

function install() {
  if (document.getElementById('filesView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="filesView" class="view-panel hidden" aria-labelledby="fxTitle">
<h2 id="fxTitle" class="screen-title">파일</h2>
<div id="filesRoot" class="fx">
<div class="fx-top"><nav class="fx-crumb" data-fx-crumb aria-label="위치"></nav><input type="search" class="fx-search" data-fx-search placeholder="이름·자료실 글자 찾기" aria-label="파일 찾기" maxlength="200" autocomplete="off" enterkeyhint="search"><select class="fx-sort" data-fx-sort aria-label="정렬">${SORTS.map(k => `<option value="${k}">${SORT_NAME[k]}</option>`).join('')}</select><button type="button" class="fx-btn fx-mkdir" data-fx-mkdir hidden>새 폴더</button><button type="button" class="fx-sync" data-fx-sync title="지금 맞추기"></button></div>
<div class="fx-bar" data-fx-bar role="toolbar" aria-label="고른 것" hidden></div>
<div class="fx-tabs" data-fx-tabs role="tablist" aria-label="파일 보기">${PHONE_TABS.map(t => `<button type="button" role="tab" data-fx-tab="${t}" aria-selected="false">${PHONE_TAB_NAME[t]}</button>`).join('')}</div>
<p class="fx-note" data-fx-note role="status" hidden></p>
<div class="fx-cols"><nav class="fx-tree nx-tree" data-fx-tree aria-label="폴더"></nav><section class="fx-list" data-fx-list aria-label="파일 목록"></section><aside class="fx-prev" data-fx-prev aria-label="미리보기" hidden></aside></div>
</div></section>`);
}
install();

const root = document.getElementById('filesRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const fresh = () => ({scope: '', status: null, statusFailed: '', where: null, rows: [], loaded: false, failed: '', trail: [], sort: 'name', dir: 'asc',
  query: '', found: null, findFailed: '', children: new Map(), open: new Set(), sel: '', tab: 'recent', syncedAt: null, syncing: false,
  preview: null, picked: new Set(), anchor: '', clip: null, busy: ''});
let state = fresh(), listSeq = 0, findSeq = 0, findTimer = 0, syncTimer = 0, layer = null, entering = null;

// ---------- 서버 ----------
const rpc = (name, body) => rt().api(`/rest/v1/rpc/${name}`, {method: 'POST', body, singleFlight: false});
const edge = (action, body = {}) => rt().api(FN, {method: 'POST', body: {action, ...body}, singleFlight: false, timeoutMs: 30000});
const codeOf = e => String(e?.message || (e?.status ? 'http_' + e.status : '') || '');
// 그림·PDF·글 바이트(썸네일·원본·미리보기 PDF). 응답이 JSON이면 서버 오류 코드.
async function bytes(body, {range = ''} = {}) {
  const r = rt();
  if (!(await r.session.ensure())) throw Object.assign(new Error('session_required'), {status: 401});
  const token = r.session.read()?.access_token;
  if (!token) throw Object.assign(new Error('session_required'), {status: 401});
  const headers = {apikey: r.config.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
  if (range) headers.Range = range;
  const res = await fetch(r.config.url + FN, {method: 'POST', cache: 'no-store', headers, body: JSON.stringify(body)});
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || /json/.test(type)) {
    let code = ''; try { code = (await res.json())?.error || ''; } catch { /* 본문 없음 */ }
    throw Object.assign(new Error(code || `http_${res.status}`), {status: res.status});
  }
  return res.blob();
}

// ---------- 상태·목록 읽기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  dropPreview();
  state = fresh(); state.scope = scope;
}
const connected = () => SOURCES.filter(s => state.status?.[s]?.connected);
async function loadStatus() {
  const scope = state.scope;
  try {
    const d = await edge('status');
    if (state.scope !== scope) return;
    state.status = d && typeof d === 'object' ? d : {}; state.statusFailed = '';
    const times = SOURCES.map(s => Date.parse(d?.[s]?.synced_at || '')).filter(Number.isFinite);
    if (times.length) state.syncedAt = Math.min(...times);
  } catch (e) {
    if (state.scope !== scope) return;
    state.statusFailed = codeOf(e);
  }
}
function setWhere(where, {keepPreview = false} = {}) {
  const fromShelf = !!state.where?.shelf || !state.where;
  state.where = where; state.rows = []; state.loaded = false; state.failed = ''; state.trail = [];
  // 묶음은 저마다 기본 정렬(최근 = 바뀐 날, 큰 파일 = 크기, 그 밖 = 이름). 폴더 안에서 고른 정렬은 폴더를 옮겨도 그대로.
  if (where?.shelf) [state.sort, state.dir] = where.shelf === 'recent' ? ['modified', 'desc'] : where.shelf === 'big' ? ['size', 'desc'] : ['name', 'asc'];
  else if (fromShelf) [state.sort, state.dir] = ['name', 'asc'];
  if (!keepPreview) { state.sel = ''; closePreview(); }
  state.picked.clear(); state.anchor = '';
  if (where?.shelf && PHONE_TABS.includes(where.shelf)) state.tab = where.shelf;
  else if (where?.source) state.tab = 'folders';
  window.KPTURouter?.setPlace?.('files', placeOf(where));
  paint();
  return loadList();
}
async function loadList({quiet = false} = {}) {
  const where = state.where, scope = state.scope, seq = ++listSeq;
  if (!where) return;
  try {
    let rows, trail = [];
    if (where.shelf) rows = await rpc('app_cloud_find', {p_query: null, p_shelf: where.shelf, p_limit: SHELF_LIMIT});
    else {
      [rows, trail] = await Promise.all([
        rpc('app_cloud_list', {p_source: where.source, p_parent_id: where.parent}),
        where.parent ? rpc('app_cloud_trail', {p_source: where.source, p_item_id: where.parent}) : Promise.resolve([])]);
    }
    if (seq !== listSeq || state.scope !== scope) return;
    state.rows = Array.isArray(rows) ? rows : []; state.trail = Array.isArray(trail) ? trail : []; state.loaded = true; state.failed = '';
    if (where.source) {
      state.children.set(folderKey(where.source, where.parent), state.rows.filter(r => r.is_folder));
      // 위치 줄의 폴더(맨 위부터 지금 폴더까지)는 나무에서 펼쳐 둔다.
      for (const id of [null, ...trailIds(state.trail)]) state.open.add(folderKey(where.source, id));
    }
  } catch (e) {
    if (seq !== listSeq || state.scope !== scope) return;
    if (!quiet || !state.loaded) { state.failed = codeOf(e); state.loaded = false; }
  }
  paint();
}
async function loadChildren(source, parent) {
  const key = folderKey(source, parent), scope = state.scope;
  try {
    const rows = await rpc('app_cloud_list', {p_source: source, p_parent_id: parent});
    if (state.scope !== scope) return;
    state.children.set(key, (Array.isArray(rows) ? rows : []).filter(r => r.is_folder));
  } catch { if (state.scope === scope) state.children.set(key, []); }
  paintTree();
}

// ---------- 찾기(F7: 이름 + 자료실이 이미 읽은 글자) ----------
function setQuery(raw) {
  const q = cleanQuery(raw);
  clearTimeout(findTimer);
  if (q === state.query) return;
  state.query = q;
  if (!q) { state.found = null; state.findFailed = ''; findSeq++; paint(); return; }
  findTimer = setTimeout(() => find(q), FIND_WAIT_MS);
}
async function find(q) {
  const seq = ++findSeq, scope = state.scope;
  try {
    const rows = await rpc('app_cloud_find', {p_query: q, p_shelf: null, p_limit: FIND_LIMIT});
    if (seq !== findSeq || state.scope !== scope || state.query !== q) return;
    state.found = Array.isArray(rows) ? rows : []; state.findFailed = '';
  } catch (e) {
    if (seq !== findSeq || state.scope !== scope) return;
    state.found = []; state.findFailed = codeOf(e);
  }
  paint();
}

// ---------- 갱신(F2) ----------
async function sync({force = false} = {}) {
  if (state.syncing || !state.status || !connected().length) return;
  const scope = state.scope, where = state.where;
  state.syncing = true; paintTop();
  try {
    const d = await edge('sync', force ? {force: true} : {});
    if (state.scope !== scope) return;
    state.syncedAt = Date.now();
    if (SOURCES.some(s => d?.[s]?.more)) setTimeout(() => { if (state.scope === scope) sync(); }, 1500);
    if (state.where !== where || !state.loaded) return;
    const changed = Array.isArray(d?.changed) ? d.changed : [], removed = Array.isArray(d?.removed) ? d.removed : [];
    if (d?.reload || where?.shelf) { if (d?.reload || changed.length || removed.length) await loadList({quiet: true}); return; }
    if (!changed.length && !removed.length) return;
    if (touchesCounts(state.rows, where, changed, removed)) { await loadList({quiet: true}); return; }
    const next = applyChanges(state.rows, where, changed, removed);
    if (next !== state.rows) { state.rows = next; state.children.set(folderKey(where.source, where.parent), next.filter(r => r.is_folder)); paintList(); paintTree(); }
  } catch { /* 맞추기 실패는 다음 차례에 다시. 목록은 색인 그대로 */ }
  finally { if (state.scope === scope) { state.syncing = false; paintTop(); } }
}
function startTimer() { clearInterval(syncTimer); syncTimer = setInterval(() => { if (visible()) sync(); else paintTop(); }, SYNC_EVERY_MS); }
const visible = () => window.KPTURouter?.current === 'files' && document.visibilityState === 'visible';

// ---------- 그리기(이 화면의 유일한 그리기 주인) ----------
const shown = () => state.query ? (state.found || []) : sortRows(state.rows, state.sort, state.dir);
function paint() { paintTop(); paintBar(); paintTree(); paintList(); paintPreview(); }
function paintTop() {
  const crumb = $('[data-fx-crumb]');
  if (crumb) {
    const w = state.where;
    let html;
    if (state.query) html = `<span class="fx-crumb-now">${esc(state.found ? findSummary(state.found) : `'${state.query}' 찾기`)}</span>`;
    else if (!w) html = '<span class="fx-crumb-now">파일</span>';
    else if (w.shelf) html = `<span class="fx-crumb-now">${esc(SHELF_NAME[w.shelf])}</span>`;
    else {
      const names = trailNames(w.source, state.trail), ids = [null, ...trailIds(state.trail)];
      html = names.map((n, i) => i === names.length - 1
        ? `<span class="fx-crumb-now" aria-current="location">${esc(n)}</span>`
        : `<button type="button" class="fx-crumb-step" data-fx-go="${esc(w.source)}" data-fx-id="${esc(ids[i] || '')}">${esc(n)}</button>`).join('<span class="fx-crumb-sep" aria-hidden="true">›</span>');
      if (names.length > 1) html = `<button type="button" class="fx-up" data-fx-up aria-label="위 폴더">‹</button>` + html;
    }
    crumb.innerHTML = html;
  }
  const sort = $('[data-fx-sort]'); if (sort && sort.value !== state.sort) sort.value = state.sort;
  const s = $('[data-fx-sync]');
  if (s) {
    const scanning = SOURCES.some(x => state.status?.[x]?.scanning);
    s.textContent = state.syncing ? '맞추는 중' : scanning ? '목록 맞추는 중' : syncText(state.syncedAt) || '맞추기';
    s.disabled = state.syncing;
    s.hidden = !state.status || !connected().length;
  }
  const mk = $('[data-fx-mkdir]');
  if (mk) { mk.hidden = !state.where?.source || !!state.query; mk.disabled = !!state.busy; }
  for (const b of root?.querySelectorAll('[data-fx-tab]') || []) b.setAttribute('aria-selected', String(b.dataset.fxTab === state.tab));
  const note = $('[data-fx-note]');
  if (note) {
    const t = state.statusFailed ? errorText(state.statusFailed) : state.status && !connected().length ? '연결된 클라우드가 없습니다' : '';
    note.textContent = t; note.hidden = !t;
  }
}
function paintTree() {
  const tree = $('[data-fx-tree]');
  if (!tree) return;
  const rows = treeRows({sources: connected(), children: state.children, open: state.open});
  const w = state.where, curKey = !state.query && w ? (w.shelf ? 'shelf:' + w.shelf : folderKey(w.source, w.parent)) : '';
  tree.innerHTML = rows.map(r => {
    const cur = r.key === curKey ? ' nx-current' : '';
    if (r.type === 'shelf') return `<div class="nx-row fx-shelf${cur}"><button type="button" class="nx-main" data-fx-shelf="${r.shelf}"${cur ? ' aria-current="true"' : ''}><span class="nx-name">${esc(SHELF_NAME[r.shelf])}</span></button></div>`;
    const twist = r.hasKids ? `<button type="button" class="fx-twist" data-fx-twist="${esc(r.key)}" aria-expanded="${r.open}" aria-label="${r.open ? '접기' : '펼치기'}">${r.open ? '▾' : '▸'}</button>` : '<span class="fx-twist" aria-hidden="true"></span>';
    const name = r.type === 'root' ? SOURCE_NAME[r.source] : r.name;
    const num = r.type === 'folder' && Number.isFinite(Number(r.count)) ? `<span class="nx-num${Number(r.count) ? '' : ' fx-zero'}">${esc(countText(r.count))}</span>` : '';
    return `<div class="nx-row nx-folder${r.type === 'root' ? ' fx-root' : ''}${cur}" style="--nx-indent:${r.depth}" data-fx-drop="${esc(folderKey(r.source, r.id))}">${twist}<button type="button" class="nx-main" data-fx-go="${esc(r.source)}" data-fx-id="${esc(r.id || '')}"${cur ? ' aria-current="true"' : ''}><span class="nx-name">${esc(name)}</span>${num}</button></div>`;
  }).join('');
}
function rowHtml(r, {withPath = false} = {}) {
  const key = rowKey(r), sel = state.sel === key || state.picked.has(key), kind = kindOf(r);
  const picked = state.picked.has(key) ? ' fx-picked' : '', cut = state.clip?.keys.includes(key) ? ' fx-cut' : '';
  const drag = PHONE.matches ? '' : ' draggable="true"', drop = r.is_folder ? ` data-fx-drop="${esc(folderKey(r.source, r.item_id))}"` : '';
  const tags = [r.library_doc_id ? '자료실' : '', r.match_in === 'text' ? '글자 맞음' : ''].filter(Boolean).join(' · ');
  const tag = tags ? `<span class="fx-tag">${tags}</span>` : '';
  const star = r.starred ? '<span class="fx-star" aria-label="별표">★</span>' : '';
  const where = withPath ? pathText(r.source, r.folder_path) : '';
  const size = r.is_folder ? (Number.isFinite(Number(r.child_count)) && r.child_count !== null ? `${countText(r.child_count)}개` : '') : sizeText(r.size_bytes);
  const day = dayText(r.modified_at);
  return `<button type="button" class="fx-row${r.is_folder ? ' fx-folder' : ''}${picked}${cut}" data-fx-row="${esc(key)}" aria-selected="${sel}"${drag}${drop}>`
    + `<span class="fx-ico" data-kind="${kind}" aria-hidden="true">${esc(kindIcon(r))}</span>`
    + `<span class="fx-nm"><span class="fx-name">${esc(r.name)}</span>${star}${tag}</span>`
    + (withPath ? `<span class="fx-path">${esc(where)}</span>` : '')
    + `<span class="fx-day">${esc(day)}</span><span class="fx-size">${esc(size)}</span><span class="fx-kind">${esc(kindLabel(r))}</span>`
    + `<span class="fx-sub">${esc([withPath ? where : day, size].filter(Boolean).join(' · '))}</span></button>`;
}
function paintList() {
  const list = $('[data-fx-list]');
  if (!list) return;
  if (state.statusFailed && !state.status) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(state.statusFailed)}); return; }
  if (state.query) {
    if (state.findFailed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(state.findFailed)}); return; }
    if (!state.found) { list.innerHTML = waitHtml({rows: 4}); return; }
    list.innerHTML = state.found.length ? `<div class="fx-rows fx-with-path" role="list">${state.found.map(r => rowHtml(r, {withPath: true})).join('')}</div>` : emptyHtml('찾은 것 없음');
    list.dataset.fxMode = 'find';
    return;
  }
  const w = state.where;
  if (!w) { list.innerHTML = state.status && !connected().length ? emptyHtml('연결된 클라우드 없음') : waitHtml({rows: 4}); return; }
  if (state.failed) { list.innerHTML = failHtml({retry: 'data-fx-retry', text: errorText(state.failed)}); return; }
  if (!state.loaded) { list.innerHTML = waitHtml({rows: 4}); return; }
  const rows = shown();
  list.dataset.fxMode = w.shelf || 'folder';
  if (!rows.length) { list.innerHTML = emptyHtml(w.shelf ? `${SHELF_NAME[w.shelf]} 없음` : '빈 폴더'); return; }
  if (w.shelf === 'recent' && PHONE.matches && state.sort === 'modified' && state.dir === 'desc') {
    list.innerHTML = `<div class="fx-rows fx-with-path" role="list">${recentGroups(rows).map(g => `<div class="fx-day-head">${esc(g.label)}</div>${g.rows.map(r => rowHtml(r, {withPath: true})).join('')}`).join('')}</div>`;
    return;
  }
  list.innerHTML = `<div class="fx-head" aria-hidden="true"><span>이름</span>${w.shelf ? '<span>위치</span>' : ''}<span>바뀐 날</span><span>크기</span><span>종류</span></div>`
    + `<div class="fx-rows${w.shelf ? ' fx-with-path' : ''}" role="list">${rows.map(r => rowHtml(r, {withPath: !!w.shelf})).join('')}</div>`;
}

// ---------- 미리보기 ----------
const rowByKey = key => (state.query ? state.found || [] : state.rows).find(r => rowKey(r) === key) || null;
function dropPreview() {
  const p = state.preview;
  if (p?.url) URL.revokeObjectURL(p.url);
  if (p?.task) { try { p.task.destroy(); } catch { /* 이미 닫힘 */ } }
  state.preview = null;
}
function closePreview() { dropPreview(); const l = layer; layer = null; l?.close(); paintPreview(); }
function selectRow(key, {show = true} = {}) {
  const r = rowByKey(key);
  if (!r) return;
  state.sel = key;
  for (const b of root.querySelectorAll('[data-fx-row]')) b.setAttribute('aria-selected', String(b.dataset.fxRow === key || state.picked.has(b.dataset.fxRow)));
  if (show && !r.is_folder) openPreview(r);
}
async function openPreview(r) {
  if (state.preview?.key === rowKey(r)) { if (!WIDE.matches) openLayer(); paintPreview(); return; }
  dropPreview();
  const kind = previewKind(r), p = {key: rowKey(r), row: r, kind, status: kind === 'none' ? 'done' : 'wait', url: '', text: '', pages: 0, shown: 0, err: ''};
  state.preview = p;
  if (!WIDE.matches) openLayer();
  paintPreview();
  if (kind === 'none') return;
  try {
    if (kind === 'image') {
      const blob = await bytes({action: 'thumb', source: r.source, id: r.item_id, size: 'large'});
      if (state.preview !== p) return;
      p.url = URL.createObjectURL(blob);
    } else if (kind === 'text') {
      const blob = await bytes({action: 'media', source: r.source, id: r.item_id}, {range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}`});
      if (state.preview !== p) return;
      p.text = new TextDecoder('utf-8', {fatal: false}).decode(new Uint8Array(await blob.slice(0, TEXT_PREVIEW_BYTES).arrayBuffer()));
    } else {
      const blob = await bytes({action: kind === 'office' ? 'preview' : 'media', source: r.source, id: r.item_id});
      if (state.preview !== p) return;
      const lib = await pdfjs();
      p.task = lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: new URL('cmaps/', PDF_LIB).href, cMapPacked: true, isEvalSupported: false, disableFontFace: false, useSystemFonts: true, verbosity: 0});
      p.doc = await p.task.promise;
      if (state.preview !== p) return;
      p.pages = p.doc.numPages;
    }
    p.status = 'done';
  } catch (e) {
    if (state.preview !== p) return;
    p.status = 'fail'; p.err = codeOf(e);
  }
  paintPreview();
}
let pdfFlight = null;
function pdfjs() {
  if (!pdfFlight) pdfFlight = import(new URL('pdf.min.mjs', PDF_LIB).href).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', PDF_LIB).href;
    return lib;
  }).catch(err => { pdfFlight = null; throw err; });
  return pdfFlight;
}
// PDF 쪽 그리기. 한 번에 하나만 돈다(p.drawing). 그리는 칸(data-fx-pages)이 다시 만들어지면 처음 쪽부터 그 칸에 다시 그린다.
async function drawPages(p, upto) {
  if (!p.doc || p.drawing) { if (p.doc) p.want = Math.max(p.want || 0, upto); return; }
  p.drawing = true;
  try {
    for (;;) {
      const host = $('[data-fx-pages]');
      if (!host || state.preview !== p) return;
      if (host !== p.host) { p.host = host; p.shown = 0; host.replaceChildren(); }
      const goal = Math.min(Math.max(upto, p.want || 0), p.pages);
      if (p.shown >= goal) break;
      const n = p.shown + 1, page = await p.doc.getPage(n);
      if (state.preview !== p || p.host !== $('[data-fx-pages]')) continue;
      const width = Math.max(200, host.clientWidth || 300);
      const base = page.getViewport({scale: 1}), ratio = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({scale: (width / base.width) * ratio});
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.style.width = '100%'; canvas.className = 'fx-page'; canvas.setAttribute('aria-label', `${n}쪽`);
      await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
      if (state.preview !== p || p.host !== host) continue;
      host.append(canvas);
      p.shown = n;
    }
  } catch { /* 그리기 실패는 그 쪽까지만 보인다 */ }
  finally { p.drawing = false; }
  const more = $('[data-fx-more-pages]');
  if (more && state.preview === p) { more.hidden = p.shown >= p.pages; more.textContent = `다음 쪽 (${p.shown}/${p.pages})`; }
}
function openLayer() {
  root.dataset.fxPreview = 'open';
  layer ||= window.KPTURouter?.layer?.open('files-preview', {reopen: () => { if (state.preview) { root.dataset.fxPreview = 'open'; paintPreview(); } }, close: () => { layer = null; dropPreview(); paintPreview(); return true; }}) || null;
}
const canShare = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
function paintPreview() {
  const box = $('[data-fx-prev]');
  if (!box) return;
  const p = state.preview;
  if (!p) { box.hidden = true; box.innerHTML = ''; delete root.dataset.fxPreview; return; }
  box.hidden = false;
  const r = p.row, where = state.where?.source === r.source && !state.query && !state.where?.shelf ? trailNames(r.source, state.trail).join(' › ') : pathText(r.source, r.folder_path);
  let view = '';
  if (p.kind === 'image') view = '<div class="fx-pv-imgbox" data-fx-img></div>';
  else if (p.status === 'wait') view = waitInlineHtml();
  else if (p.status === 'fail') view = `<p class="fx-pv-note">${esc(errorText(p.err))}</p>`;
  else if (p.kind === 'text') view = `<pre class="fx-pv-text">${esc(p.text)}</pre>`;
  else if (p.kind === 'pdf' || p.kind === 'office') view = `<div class="fx-pages" data-fx-pages></div><button type="button" class="fx-btn" data-fx-more-pages hidden></button>`;
  // 그리고 있는 PDF 칸은 그대로 둔다(다시 그리면 쪽을 처음부터 다시 그려야 함).
  if (p.doc && p.host && p.host.isConnected && box.contains(p.host) && box.dataset.fxKey === p.key) return;
  box.dataset.fxKey = p.key;
  box.innerHTML = `<div class="fx-pv-head"><button type="button" class="fx-back" data-fx-close aria-label="미리보기 닫기">‹</button><span class="fx-pv-nm">${esc(r.name)}</span></div>`
    + `<div class="fx-pv-view">${view}</div>`
    + `<dl class="fx-pv-meta"><dt>위치</dt><dd>${esc(where)}</dd><dt>크기</dt><dd>${esc(sizeText(r.size_bytes))}</dd><dt>바뀐 날</dt><dd>${esc(fullTime(r.modified_at))}</dd><dt>종류</dt><dd>${esc(kindLabel(r))}</dd></dl>`
    + `<div class="fx-pv-acts"><button type="button" class="fx-btn" data-fx-open>열기</button><button type="button" class="fx-btn" data-fx-down>받기</button>`
    + (canShare() ? '<button type="button" class="fx-btn fx-share" data-fx-share>공유</button>' : '')
    + (r.library_doc_id ? `<button type="button" class="fx-btn" data-fx-library="${esc(r.library_doc_id)}">자료실에서 보기</button>` : '')
    + `<button type="button" class="fx-btn" data-fx-rename-one>이름</button><button type="button" class="fx-btn" data-fx-cut-one>옮기기</button>`
    + `<button type="button" class="fx-btn fx-danger" data-fx-trash-one>휴지통</button></div>`;
  if (p.doc) { p.host = null; drawPages(p, Math.max(PDF_FIRST_PAGES, p.want || 0)); }
  // 사진: 공용 그림 칸(img-slot.js) — 받는 중 회색, 못 받으면 ↻(그 사진만 다시 받기).
  const imgBox = box.querySelector('[data-fx-img]');
  if (imgBox) {
    slotBox(imgBox);
    if (p.status === 'done' && p.url) { const img = document.createElement('img'); img.className = 'fx-pv-img'; img.alt = r.name; slotImg(imgBox, img, p.url); }
    else if (p.status === 'fail') slotFailed(imgBox, () => { if (state.preview === p) { dropPreview(); openPreview(r); } }, p.err);
  }
}
function note(text) { const n = $('[data-fx-note]'); if (n) { n.textContent = text; n.hidden = !text; } }
// 열기: 클라우드 보기 화면 새 창. 창은 누른 순간 열어 두고(팝업 막힘 피함) 주소를 받으면 넣는다.
async function openCloud(r) {
  const win = window.open('about:blank', '_blank');
  try {
    const d = await edge('open-url', {source: r.source, id: r.item_id});
    if (!d?.url) throw new Error('open_unavailable');
    if (win) { win.opener = null; win.location.href = d.url; } else window.open(d.url, '_blank', 'noopener');
  } catch (e) { win?.close(); note(errorText(codeOf(e))); }
}
async function download(r, {share = false} = {}) {
  try {
    const blob = await bytes({action: 'media', source: r.source, id: r.item_id});
    if (share) {
      const file = new File([blob], r.name, {type: blob.type || 'application/octet-stream'});
      if (navigator.canShare({files: [file]})) { await navigator.share({files: [file], title: r.name}); return; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = r.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (e) { if (e?.name !== 'AbortError') note(errorText(codeOf(e))); }
}

// ---------- 쓰기(S48-45 ⑤·⑦) ----------
const pickedRows = () => [...state.picked].map(rowByKey).filter(Boolean);
// 지금 손댈 줄: 고른 것이 있으면 그것, 없으면 미리보기·선택한 한 줄.
const actRows = () => { const p = pickedRows(); if (p.length) return p; const r = state.sel && rowByKey(state.sel); return r ? [r] : []; };
function paintBar() {
  const bar = $('[data-fx-bar]');
  if (!bar) return;
  const n = state.picked.size, clip = state.clip;
  if (state.busy) {
    bar.hidden = false;
    bar.innerHTML = `<span class="fx-bar-t" role="status">${esc(state.busy)}</span>`;
    return;
  }
  if (clip) {
    const here = state.where?.source && !state.query ? {source: state.where.source, parent: state.where.parent} : null;
    const ok = here && moveTargetOk(clip.rows, here);
    bar.hidden = false;
    bar.innerHTML = `<span class="fx-bar-t">${clip.rows.length}개 옮기는 중 · ${ok ? '이 폴더로' : '옮길 폴더를 여세요'}</span>`
      + `<button type="button" class="fx-btn" data-fx-paste${ok ? '' : ' disabled'}>여기로 옮기기</button><button type="button" class="fx-btn" data-fx-uncut>취소</button>`;
    return;
  }
  bar.hidden = !n;
  if (!n) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<span class="fx-bar-t">${n}개 골라짐</span><button type="button" class="fx-btn" data-fx-cut>옮기기</button>`
    + (n === 1 ? '<button type="button" class="fx-btn" data-fx-rename>이름</button>' : '')
    + '<button type="button" class="fx-btn fx-danger" data-fx-trash>휴지통</button><button type="button" class="fx-btn" data-fx-unpick aria-label="고르기 풀기">✕</button>';
}
function paintPicks() {
  for (const b of root.querySelectorAll('[data-fx-row]')) {
    const on = state.picked.has(b.dataset.fxRow);
    b.classList.toggle('fx-picked', on);
    b.setAttribute('aria-selected', String(on || b.dataset.fxRow === state.sel));
  }
  paintBar();
}
function togglePick(key) {
  if (state.picked.has(key)) state.picked.delete(key); else state.picked.add(key);
  state.anchor = key; paintPicks();
}
function rangePick(key) {
  const keys = [...root.querySelectorAll('[data-fx-row]')].map(b => b.dataset.fxRow);
  for (const k of pickRange(keys, state.anchor || state.sel, key)) state.picked.add(k);
  paintPicks();
}
function unpick() { state.picked.clear(); state.anchor = ''; paintPicks(); }
// 서버가 돌려준 바뀐 줄을 지금 목록에 입힌다(sync와 같은 길). 찾기·묶음 화면은 서버에서 다시 읽는다.
async function applyWrite(d, touched = []) {
  const changed = Array.isArray(d?.changed) ? d.changed : [], removed = Array.isArray(d?.removed) ? d.removed : [];
  const gone = new Set(removed.map(x => `${x.source}:${x.id}`));
  for (const k of gone) state.picked.delete(k);
  if (state.preview && gone.has(state.preview.key)) closePreview();
  else if (state.preview) { const c = changed.find(x => rowKey(x) === state.preview.key); if (c) { state.preview.row = {...state.preview.row, ...c}; paintPreview(); } }
  for (const key of touched) if (state.children.has(key)) { const [source, ...rest] = key.split(':'); loadChildren(source, rest.join(':') || null); }
  if (state.query) { const q = state.query; state.query = ''; setQuery(q); return; }
  const w = state.where;
  if (!w || w.shelf || touchesCounts(state.rows, w, changed, removed)) { await loadList({quiet: true}); return; }
  const next = applyChanges(state.rows, w, changed, removed);
  if (next !== state.rows) { state.rows = next; paintList(); }
}
async function write(action, body, label, {timeoutMs = 60000} = {}) {
  if (state.busy) return null;
  const scope = state.scope;
  state.busy = label; paintBar(); paintTop();
  try {
    return await rt().api(FN, {method: 'POST', body: {action, ...body, confirm: true}, singleFlight: false, timeoutMs});
  } catch (e) {
    if (state.scope === scope) notify(writeErrorText(codeOf(e)), {error: true, record: false});
    return null;
  } finally {
    if (state.scope === scope) { state.busy = ''; paintBar(); paintTop(); }
  }
}
async function renameRow(r, anchor) {
  if (!r) return;
  const parts = r.is_folder ? {base: r.name, ext: ''} : splitFileName(r.name);
  const v = await askText(anchor, {text: '새 이름', value: parts.base, ok: '바꾸기', max: FILE_BASE_MAX});
  if (v === null) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  const name = chk.base + parts.ext;
  if (name === r.name) return;
  const d = await write('rename', {source: r.source, id: r.item_id, name}, '이름 바꾸는 중');
  if (d) { await applyWrite(d, touchedFolders([r])); notify(writeDoneText('rename'), {record: false}); }
}
async function makeFolder(anchor) {
  const w = state.where;
  if (!w?.source) return;
  const v = await askText(anchor, {text: '새 폴더 이름', value: '', ok: '만들기', max: FILE_BASE_MAX});
  if (v === null) return;
  const chk = checkFileBase(v);
  if (!chk.ok) { notify(chk.message, {error: true, record: false}); return; }
  const d = await write('mkdir', {source: w.source, parent: w.parent, name: chk.base}, '폴더 만드는 중');
  if (d) { await applyWrite(d, [folderKey(w.source, w.parent)]); notify(writeDoneText('mkdir'), {record: false}); }
}
async function trashRows(rows, anchor) {
  const list = rows.filter(Boolean);
  if (!list.length) return;
  const ask = trashAsk(list);
  if (!(await askConfirm(anchor, {text: ask.text, note: ask.note, ok: '휴지통으로', danger: true}))) return;
  let done = 0, failed = 0;
  for (const g of groupBySource(list)) {
    let ids = g.rows.map(r => r.item_id);
    while (ids.length) {
      const d = await write('trash', {source: g.source, ids}, `휴지통으로 보내는 중 (${done}/${list.length})`);
      if (!d) { failed += ids.length; break; }
      await applyWrite(d, touchedFolders(g.rows));
      failed += (d.failed || []).length;
      done += ids.length - (d.failed || []).length - (d.left || []).length;
      ids = Array.isArray(d.left) ? d.left : [];
    }
  }
  notify(writeDoneText('trash', {done, failed}), {error: !!failed, record: false});
}
function cutRows(rows) {
  const list = rows.filter(Boolean);
  const chk = moveCheck(list);
  if (!chk.ok) { notify(chk.reason, {error: true, record: false}); return; }
  state.clip = {rows: list, keys: list.map(rowKey)};
  state.picked.clear(); paintList(); paintBar();
}
function uncut() { state.clip = null; paintList(); paintBar(); }
// 옮기기: 같은 클라우드는 move(200개씩, 남은 것은 이어서), 다른 클라우드는 across(1개·200MB, 확인 한 번).
async function moveRows(rows, dest, anchor) {
  const list = rows.filter(Boolean);
  if (!moveTargetOk(list, dest)) return;
  const across = list[0].source !== dest.source;
  const chk = moveCheck(list, {across});
  if (!chk.ok) { notify(chk.reason, {error: true, record: false}); return; }
  const touched = touchedFolders(list, dest);
  if (across) {
    const r = list[0];
    const ok = await askConfirm(anchor, {text: `'${r.name}'을(를) ${SOURCE_NAME[dest.source]}로 옮길까요?`, ok: '옮기기',
      note: `똑같이 옮겨졌는지 맞춘 뒤 원본은 ${SOURCE_NAME[r.source]} 휴지통으로 보냅니다`});
    if (!ok) return;
    const d = await write('across', {source: r.source, id: r.item_id, to_source: dest.source, to: dest.parent}, '다른 클라우드로 옮기는 중', {timeoutMs: 400000});
    state.clip = null;
    if (d) { await applyWrite(d, touched); notify(writeDoneText('across', {kept: d.kept_original === true}), {error: d.kept_original === true, record: false}); }
    paintList(); paintBar();
    return;
  }
  let ids = list.map(r => r.item_id), done = 0, failed = 0;
  state.clip = null;
  while (ids.length) {
    const d = await write('move', {source: dest.source, ids, to: dest.parent}, `옮기는 중 (${done}/${list.length})`);
    if (!d) { failed += ids.length; break; }
    await applyWrite(d, touched);
    failed += (d.failed || []).length;
    done += ids.length - (d.failed || []).length - (d.left || []).length;
    ids = Array.isArray(d.left) ? d.left : [];
  }
  state.picked.clear();
  paintList(); paintBar();
  notify(writeDoneText('move', {done, failed}), {error: !!failed, record: false});
}
const hereDest = () => state.where?.source && !state.query ? {source: state.where.source, parent: state.where.parent ?? null} : null;
const destOf = key => { const [source, ...rest] = String(key || '').split(':'); return SOURCES.includes(source) ? {source, parent: rest.join(':') || null} : null; };

// ---------- 움직이기 ----------
function goFolder(source, id) {
  if (!SOURCES.includes(source)) return;
  if (state.query) { state.query = ''; state.found = null; const s = $('[data-fx-search]'); if (s) s.value = ''; }
  const parent = id || null;
  state.open.add(folderKey(source, parent));
  return setWhere({source, parent});
}
function goShelf(shelf) {
  if (state.query) { state.query = ''; state.found = null; const s = $('[data-fx-search]'); if (s) s.value = ''; }
  return setWhere({shelf});
}
function goUp() {
  const w = state.where;
  if (!w?.source || !w.parent) return;
  const ids = trailIds(state.trail);
  return goFolder(w.source, ids.length > 1 ? ids[ids.length - 2] : null);
}
function toggle(key) {
  if (state.open.has(key)) state.open.delete(key); else {
    state.open.add(key);
    const [source, ...rest] = key.split(':'), id = rest.join(':') || null;
    if (!state.children.has(key)) loadChildren(source, id);
  }
  paintTree();
  root.querySelector(`[data-fx-twist="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
}
function setTab(tab) {
  if (!PHONE_TABS.includes(tab)) return;
  state.tab = tab;
  if (tab === 'folders') { const s = connected()[0]; if (s) goFolder(state.where?.source || s, state.where?.source ? state.where.parent : null); else paint(); }
  else goShelf(tab);
}
function activate(key) {
  const r = rowByKey(key);
  if (!r) return;
  if (r.is_folder) goFolder(r.source, r.item_id); else selectRow(key);
}

root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-fx-row]')) {
    const key = b.dataset.fxRow;
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); togglePick(key); return; }
    if (event.shiftKey) { event.preventDefault(); rangePick(key); return; }
    if (state.picked.size && PHONE.matches) { togglePick(key); return; }
    if (state.picked.size) unpick();
    state.anchor = key;
    activate(key); return;
  }
  if (b.matches('[data-fx-mkdir]')) { makeFolder(b); return; }
  if (b.matches('[data-fx-cut]')) { cutRows(pickedRows()); return; }
  if (b.matches('[data-fx-rename]')) { renameRow(pickedRows()[0], b); return; }
  if (b.matches('[data-fx-trash]')) { trashRows(pickedRows(), b); return; }
  if (b.matches('[data-fx-unpick]')) { unpick(); return; }
  if (b.matches('[data-fx-paste]')) { const d = hereDest(); if (state.clip && d) moveRows(state.clip.rows, d, b); return; }
  if (b.matches('[data-fx-uncut]')) { uncut(); return; }
  if (b.matches('[data-fx-go]')) { goFolder(b.dataset.fxGo, b.dataset.fxId || null); return; }
  if (b.matches('[data-fx-shelf]')) { goShelf(b.dataset.fxShelf); return; }
  if (b.matches('[data-fx-twist]')) { toggle(b.dataset.fxTwist); return; }
  if (b.matches('[data-fx-up]')) { goUp(); return; }
  if (b.matches('[data-fx-tab]')) { setTab(b.dataset.fxTab); return; }
  if (b.matches('[data-fx-sync]')) { sync({force: true}); return; }
  if (b.matches('[data-fx-close]')) { closePreview(); return; }
  if (b.matches('[data-fx-more-pages]')) { const p = state.preview; if (p?.doc) drawPages(p, p.shown + PDF_FIRST_PAGES); return; }
  const p = state.preview;
  if (b.matches('[data-fx-open]') && p) { openCloud(p.row); return; }
  if (b.matches('[data-fx-down]') && p) { download(p.row); return; }
  if (b.matches('[data-fx-share]') && p) { download(p.row, {share: true}); return; }
  if (b.matches('[data-fx-rename-one]') && p) { renameRow(p.row, b); return; }
  if (b.matches('[data-fx-cut-one]') && p) { const r = p.row; closePreview(); cutRows([r]); return; }
  if (b.matches('[data-fx-trash-one]') && p) { trashRows([p.row], b); return; }
  if (b.matches('[data-fx-library]')) { requestLibraryDocument(b.dataset.fxLibrary); window.KPTURouter?.go?.('library', {source: 'delegated'}); return; }
  if (b.matches('[data-fx-retry]')) { if (!state.status) enter(true); else if (state.query) { const q = state.query; state.query = ''; setQuery(q); } else loadList(); }
});
root?.addEventListener('dblclick', event => {
  const b = event.target.closest('[data-fx-row]');
  const r = b && rowByKey(b.dataset.fxRow);
  if (r && !r.is_folder) openCloud(r);
});
root?.addEventListener('input', event => { if (event.target.matches('[data-fx-search]')) setQuery(event.target.value); });
root?.addEventListener('change', event => { if (event.target.matches('[data-fx-sort]')) { state.sort = validSort(event.target.value); state.dir = state.sort === 'name' ? 'asc' : 'desc'; paintList(); } });
// PC 단축키: ↑↓ 고르기 · Enter 열기(폴더는 들어가기) · Backspace 위 폴더 · / 찾기.
root?.addEventListener('keydown', event => {
  if (event.target.matches('input,select,textarea')) {
    if (event.key === 'Escape' && event.target.matches('[data-fx-search]') && event.target.value) { event.target.value = ''; setQuery(''); }
    return;
  }
  const rows = [...root.querySelectorAll('[data-fx-row]')];
  const mod = event.ctrlKey || event.metaKey, k = String(event.key).toLowerCase();
  if (event.key === 'F2') { const list = actRows(); if (list.length === 1) { event.preventDefault(); renameRow(list[0], event.target.closest('button') || root); } return; }
  if (event.key === 'Delete') { const list = actRows(); if (list.length) { event.preventDefault(); trashRows(list, event.target.closest('button') || root); } return; }
  if (mod && k === 'a' && rows.length) { event.preventDefault(); for (const b of rows) state.picked.add(b.dataset.fxRow); paintPicks(); return; }
  if (mod && k === 'x') { const list = actRows(); if (list.length) { event.preventDefault(); cutRows(list); } return; }
  if (mod && k === 'v') { const d = hereDest(); if (state.clip && d) { event.preventDefault(); moveRows(state.clip.rows, d, root.querySelector('[data-fx-bar]') || root); } return; }
  if (event.key === 'Escape' && (state.picked.size || state.clip)) { event.preventDefault(); if (state.clip) uncut(); else unpick(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.findIndex(b => b.dataset.fxRow === state.sel);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (event.key === 'ArrowDown' ? 1 : -1)))];
    next.focus(); selectRow(next.dataset.fxRow, {show: WIDE.matches});
  } else if (event.key === 'Enter' && event.target.matches('[data-fx-row]')) {
    event.preventDefault();
    const r = rowByKey(event.target.dataset.fxRow);
    if (r?.is_folder) goFolder(r.source, r.item_id); else if (r) { selectRow(rowKey(r), {show: false}); openCloud(r); }
  } else if (event.key === 'Backspace' && !state.query) { event.preventDefault(); goUp(); }
  else if (event.key === '/') { event.preventDefault(); $('[data-fx-search]')?.focus(); }
});
// 폰: 꾹 누르면 고르기(길게 누르면 브라우저가 contextmenu를 보낸다). PC 오른쪽 단추도 같은 고르기.
root?.addEventListener('contextmenu', event => {
  const b = event.target.closest('[data-fx-row]');
  if (!b || state.busy) return;
  event.preventDefault();
  togglePick(b.dataset.fxRow);
});
// PC: 줄을 폴더(목록의 폴더 줄·나무의 폴더)로 끌어 놓아 옮기기. 끈 줄이 고른 것 안이면 고른 것 모두.
let dragKeys = null;
root?.addEventListener('dragstart', event => {
  const b = event.target.closest?.('[data-fx-row]');
  if (!b || state.busy) { event.preventDefault?.(); return; }
  const key = b.dataset.fxRow;
  dragKeys = state.picked.has(key) ? [...state.picked] : [key];
  event.dataTransfer?.setData('text/plain', 'files-move');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});
const dropAt = event => {
  const t = event.target.closest?.('[data-fx-drop]');
  if (!t || !dragKeys) return null;
  const dest = destOf(t.dataset.fxDrop), rows = dragKeys.map(rowByKey).filter(Boolean);
  return dest && moveTargetOk(rows, dest) ? {t, dest, rows} : null;
};
root?.addEventListener('dragover', event => {
  const hit = dropAt(event);
  for (const el of root.querySelectorAll('.fx-drop-on')) if (el !== hit?.t) el.classList.remove('fx-drop-on');
  if (!hit) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  hit.t.classList.add('fx-drop-on');
});
root?.addEventListener('drop', event => {
  const hit = dropAt(event);
  for (const el of root.querySelectorAll('.fx-drop-on')) el.classList.remove('fx-drop-on');
  dragKeys = null;
  if (!hit) return;
  event.preventDefault();
  moveRows(hit.rows, hit.dest, hit.t);
});
root?.addEventListener('dragend', () => { dragKeys = null; for (const el of root.querySelectorAll('.fx-drop-on')) el.classList.remove('fx-drop-on'); });
// 폰: 좌우로 밀어 탭(최근·폴더·별표) 이동. 미리보기가 열려 있거나 입력 칸이면 하지 않는다.
let swipe = null;
root?.addEventListener('touchstart', e => {
  swipe = null;
  if (!PHONE.matches || state.preview || e.touches.length !== 1 || e.target.closest('input,select,.fx-tabs,.fx-prev')) return;
  const p = e.touches[0]; swipe = {x: p.clientX, y: p.clientY, t: Date.now()};
}, {passive: true});
root?.addEventListener('touchend', e => {
  const s = swipe; swipe = null;
  if (!s || !e.changedTouches.length || claimedSince(s.t)) return;
  const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.t > 800) return;
  const next = tabAt(state.tab, dx < 0 ? 1 : -1);
  if (next) setTab(next);
}, {passive: true});
root?.addEventListener('touchcancel', () => { swipe = null; }, {passive: true});
document.addEventListener('visibilitychange', () => { if (visible()) sync(); });

// ---------- 들어오기 ----------
async function enter(force = false) {
  resetIfOwnerChanged();
  if (entering && !force) return entering;
  entering = (async () => {
    if (!state.status || force) { paint(); await loadStatus(); }
    const place = whereOf(window.KPTURouter?.place?.('files') || {});
    const first = connected();
    if (!state.where && first.length) {
      // F9: 폰 첫 화면은 최근 파일. PC·폴드도 같은 첫 화면(최근)이고, 나무에서 클라우드를 고른다.
      const want = place && (place.shelf || first.includes(place.source)) ? place : {shelf: 'recent'};
      if (want.source) state.open.add(folderKey(want.source, null));
      await setWhere(want);
    } else if (state.where) await loadList({quiet: true});
    paint();
    for (const s of first) if (!state.children.has(folderKey(s, null))) loadChildren(s, null);
    startTimer();
    sync();
  })().finally(() => { entering = null; });
  return entering;
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'files') return;
  // 다른 화면으로 가면 미리보기를 놓는다(받은 그림·PDF 메모리도). 맞추기 시계는 멈춘다.
  layer = null; dropPreview(); delete root?.dataset.fxPreview; clearInterval(syncTimer);
});
window.KPTURouter?.on?.('files', () => { enter(); });
window.KPTUFiles = {refresh: () => enter(true)};
if (window.KPTURouter?.current === 'files') enter();
})();
