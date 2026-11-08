import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {createMovePicker} from './library-move-picker.js';
import {pickerRows} from './library-move.mjs';
import {folderSiblings, nextSortOrder, cleanFolderName, folderErrorText} from './library-tree.js';
import {treeRows, folderPath, OUTSIDE, OUTSIDE_NAME} from './note-tree.mjs';
import {FOLDER_DEPTH_LIMIT} from './folder-limits.mjs';
import {askConfirm} from './small-notice.js';
import {treeIconHtml} from './tree-icons.js';
import {takeNewsItem} from './news-request.mjs';
import {signalBody} from './now-model.mjs';
import {ensureReads, onReads, readState} from './news-reads.js';
import {dayHtml} from './news-row.mjs';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {ALL, STAR, PAGE_SIZE, KEYWORD_MAX_CHARS, DEFAULT_LIMITS, REGIONS, laneFilter, orderOf, groupItems, errorNote, fillResult, needsAutoFill, cleanWord, normalizeCatalog, normalizeLimits, sourceNote, sourceOn, enabledSourceKeys, itemFolderId} from './news-clipping-model.mjs';
// NEWS-클리핑 화면 C1·C2(설계 docs/design/news-clipping.md) → OUTSIDE-글상세 ③(11/01 23:16) → S51-8 News [언론] 탭 칸(#nowPanelNews 안 #newsRoot)의 유일한 그리기 주인.
// - 한 목록: 채널 기사 + 서버가 찾은 기사 = 하나의 스크랩. 탭 줄·좌우 밀기·위 찾기 칸·[매체 ▾]·⋯·상세 칸은 껍데기(outside-statements.js)가 갖는다.
// - 칸(같은 화면 안, 뒤로가기 한 번 = 목록, KPTURouter.layer): [키워드 고치기](app_news_keywords) · [언론 매체 켜고 끄기](app_outside_sources의 news- 키)
//   · [별표 폴더](별표 기사 + 폴더 트리 note-tree.mjs treeRows, 폴더 고르기 창 library-move-picker.js, 폴더 ⋯: 안에 폴더·이름 바꾸기·지우기).
// - [지금 채우기]는 news-feed fill_now. 목록을 열 때 읽기 전 채널 기사가 있으면 10분에 한 번 저절로.
// - 메모(= 노트, metadata.news_item_id)는 공용 상세(now-detail.js). 노트 [기사로 가기]는 news-request.mjs로 이 칸에서 그 기사 상세를 연다.
// - 저장은 모두 서버(작업공간 소유자 RLS · Edge는 사용자 로그인 확인). 기기 저장 없음. 하루 횟수는 서버 상수가 정하고 catalog limits로 받는다.
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 기사 제목·본문·주소를 남기지 않는다. 별표는 환류 기록 한 줄을 남긴다.
// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.1절): 이 칸은 News [언론] 탭. 칩 줄([전체]·[별표])과 이 칸의 ⋯는 없앴다.
//   - 줄은 다른 탭과 같은 제목 중심 모양(news-row.mjs, 껍데기 KPTUNow.rowOf) — 요약·본문 접기·번역·메모는 목록에서 빼고 상세에서 본다.
//   - 매체 거르기는 껍데기 [매체: 전체 ▾](KPTUNow.newsKeys), 제목 거르기는 위 찾기 칸(KPTUNow.query). 안 읽은 글 굵게(news-reads.js).
//   - 껍데기 ⋯가 act()로 부르는 칸: [지금 채우기]·[언론 매체 켜고 끄기]·[키워드 고치기]·[별표 폴더](옛 [별표] 칩의 폴더 트리, 같은 화면 안 한 칸).
//   - 언론 카탈로그·켠 매체는 meta()로 껍데기에 준다(매체 고르기·색).

(() => {
if (window.KPTUNews) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const ITEM_COLS = 'id,lane,url,title,lang,publisher,source_key,keywords,published_at,scrapped_at,created_at,state,summary,body_kind,title_ko,translated_at,starred_at,folder_id';
const SOURCE_COLS = 'source_key,enabled,last_ok_at,last_error';
const KEYWORD_COLS = 'word,enabled,created_at';
const FOLDER_COLS = 'id,parent_id,name,sort_order';
const PHONE = window.matchMedia('(max-width:760px)');
const now = () => window.KPTUNow;

function install() {
  if (document.getElementById('newsRoot')) return;
  document.getElementById('nowPanelNews')?.insertAdjacentHTML('beforeend', `<div id="newsRoot" class="nc" data-mode="list">
<p class="nc-when" data-nc-when role="status" hidden></p>
<div class="nc-list" data-nc-list aria-label="언론 기사"></div>
<div class="nc-panel" data-nc-panel></div>
</div>`);
}
install();

const root = document.getElementById('newsRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const fresh = () => ({scope: '', tab: ALL, items: [], loaded: false, failed: false, end: true, more: false,
  busy: new Set(), notes: new Map(),
  limits: {...DEFAULT_LIMITS}, catalog: null, catalogFailed: false, sources: new Map(), sourcesLoaded: false, sourcesFailed: false,
  keywords: [], keywordsLoaded: false, keywordsFailed: false, saving: new Set(), panelNote: '', draft: '',
  mode: 'list', filling: false, fillNote: '',
  folders: [], foldersLoaded: false, foldersFailed: false, openFolders: new Set(), treeNote: '', focus: ''});
let state = fresh(), loadSeq = 0, layer = null;

// ---------- 서버 읽기·쓰기 ----------
const q = v => encodeURIComponent(v);
const edge = (action, body = {}, timeoutMs = 60000) => rt().api(`/functions/v1/news-feed?action=${action}`, {method: 'POST', body, singleFlight: false, timeoutMs});
// 목록 읽기. [언론] 목록은 껍데기가 고른 매체(news- 키)만, 별표 폴더 칸은 별표한 기사 전부.
function readItems(w, tab, offset) {
  const keys = tab === STAR ? null : now()?.newsKeys?.() ?? null;
  if (keys && !keys.length) return Promise.resolve([]);
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&hidden_at=is.null${laneFilter(tab)}${filter}&select=${ITEM_COLS}&order=${orderOf(tab)}&limit=${PAGE_SIZE + 1}&offset=${offset}`, {singleFlight: false});
}
const readOne = (w, id, cols) => rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(id)}&select=${cols}&limit=1`, {singleFlight: false}).then(r => (Array.isArray(r) ? r[0] || null : null));
const readSources = w => rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=like.news-*&select=${SOURCE_COLS}`, {singleFlight: false});
const readKeywords = w => rt().api(`/rest/v1/app_news_keywords?workspace_id=eq.${q(w)}&select=${KEYWORD_COLS}&order=created_at.asc&limit=100`, {singleFlight: false});
const readFolders = w => rt().api(`/rest/v1/app_news_folders?workspace_id=eq.${q(w)}&select=${FOLDER_COLS}&order=sort_order.asc&limit=1000`, {singleFlight: false});
async function patchItem(w, id, body) {
  const rows = await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(id)}&select=id,starred_at,folder_id`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.id !== id) throw new Error('save');
  return row;
}
// 환류 기록 한 줄(app_now_signals, 화면은 더하기만). 실패해도 누른 일은 그대로.
function signal(id, action) {
  const w = workspaceOf();
  if (!w) return;
  rt().api('/rest/v1/app_now_signals', {method: 'POST', body: signalBody(w, {type: 'news', id}, action), prefer: 'return=minimal', singleFlight: false})
    .then(() => now()?.signaled?.()).catch(() => {});
}
async function writeSource(w, key, enabled) {
  const at = new Date().toISOString();
  const rows = state.sources.has(key)
    ? await rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=eq.${q(key)}&select=${SOURCE_COLS}`, {method: 'PATCH', body: {enabled, updated_at: at}, prefer: 'return=representation', singleFlight: false})
    : await rt().api(`/rest/v1/app_outside_sources?select=${SOURCE_COLS}`, {method: 'POST', body: {workspace_id: w, source_key: key, enabled}, prefer: 'return=representation', singleFlight: false});
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.source_key !== key) throw new Error('save');
  return row;
}

// ---------- 그리기(이 화면의 유일한 renderer) ----------
const titleOk = it => { const t = now()?.query?.() || ''; return !t || String(now()?.describe?.('news', it)?.title || it.title || '').replace(/\s+/g, '').toLowerCase().includes(t.replace(/\s+/g, '').toLowerCase()); };
// 목록 줄: 제목 중심(껍데기 rowOf). 마우스 단추 [보관][숨기기]는 PC·중간 폭에서만(폰은 줄 밀기).
const itemHtml = it => now()?.rowOf?.('news', it, {openAttr: 'data-nc-open', rowAttr: 'data-nc-item', acts: hoverActsHtml({isSaved: !!it.starred_at})}) || '';
// 별표 폴더 칸의 줄: 같은 줄 + ☆(별표 빼기)·[폴더] 단추.
function treeItemHtml(it) {
  const starred = !!it.starred_at, fid = itemFolderId(it, state.folders), note = state.notes.get(it.id);
  const star = `<button type="button" class="nc-star" data-nc-star="${esc(it.id)}" aria-pressed="${starred}" aria-label="${starred ? '별표 빼기' : '별표'}" title="${starred ? '별표 빼기' : '별표'}"><span aria-hidden="true">${starred ? '★' : '☆'}</span></button>`;
  const folder = starred ? `<button type="button" class="nc-act" data-nc-folder="${esc(it.id)}">${esc(fid ? folderPath(state.folders, fid).map(f => f.name).join(' › ') : '폴더')}</button>` : '';
  return now()?.rowOf?.('news', it, {openAttr: 'data-nc-open', rowAttr: 'data-nc-item', acts: `<span class="nc-tree-acts">${folder}${star}${note ? `<span class="nc-faint">${esc(note)}</span>` : ''}</span>`}) || '';
}

function listHtml() {
  if (!state.loaded) return state.failed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 6, h: 44});
  const list = state.items.filter(titleOk);
  const more = state.end ? '' : `<button type="button" class="nc-text-btn nc-more-items" data-nc-more-items${state.more ? ' disabled aria-busy="true"' : ''}>더 보기</button>`;
  if (!list.length) return `${emptyHtml(state.items.length ? '제목에서 찾은 글 없음' : '기사 없음', {attrs: 'data-nc-empty'})}${more}`;
  const days = groupItems(list, Date.now()).map(g => dayHtml(g.label, g.items.map(itemHtml).join(''), g.items.filter(it => readState({type: 'news', id: it.id}) === false).length, esc)).join('');
  return days + more;
}

// 별표 폴더 칸: 폴더 트리(폴더 → 안 폴더·기사 들여쓰기, 맨 아래 '폴더 없음'). 폴더 줄 ⋯ = 안에 폴더·이름 바꾸기·지우기.
const folderOfItem = it => itemFolderId(it, state.folders);
function treeHtml() {
  const head = `<div class="nc-tree-head"><button type="button" class="nc-text-btn nc-new-folder" data-nc-new-folder>새 폴더</button>${state.treeNote ? `<span class="nc-panel-note" role="status">${esc(state.treeNote)}</span>` : ''}</div>`;
  if (!state.loaded) return head + (state.failed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 4}));
  if (!state.foldersLoaded) return head + (state.foldersFailed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 4})); // LOAD-끝있는불러오기: 못 읽으면 [다시]
  if (!state.items.length && !state.folders.length) return head + emptyHtml('별표한 기사 없음', {attrs: 'data-nc-empty'});
  const rows = treeRows({folders: state.folders, notes: state.items, folderOf: folderOfItem, isOpen: id => state.openFolders.has(id)});
  const html = rows.map(r => {
    if (r.type === 'note') return `<div class="nc-tree-item" style="--nc-indent:${r.indent}">${treeItemHtml(r.note)}</div>`;
    const name = r.type === 'outside' ? OUTSIDE_NAME : r.name;
    const more = r.type === 'folder' ? `<button type="button" class="nc-folder-more" data-nc-folder-more="${esc(r.id)}" data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="${esc(name)} 폴더 메뉴">${MORE}</button>` : '';
    return `<div class="nc-folder-row" style="--nc-indent:${r.indent}"><button type="button" class="nc-folder" data-nc-folder-toggle="${esc(r.id)}" aria-expanded="${!!r.open}">${treeIconHtml(r.type === 'outside' ? 'outside' : 'folder', {row: r, open: !!r.open, className: 'nc-caret'})}<span class="nc-folder-name">${esc(name)}</span><span class="nc-faint">${r.count}</span></button>${more}</div>`;
  }).join('');
  const more = state.end ? '' : `<button type="button" class="nc-text-btn nc-more-items" data-nc-more-items${state.more ? ' disabled aria-busy="true"' : ''}>더 보기</button>`;
  return head + html + more;
}

const panelHead = (title, count) => `<div class="nc-panel-head"><button type="button" class="nc-back" data-nc-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>${esc(title)}</b>${count ? `<span class="nc-faint">${esc(count)}</span>` : ''}</div>`;
const switchHtml = (attr, val, on, name, busy) => `<button type="button" class="nc-switch" role="switch" ${attr}="${esc(val)}" aria-checked="${on}"${busy ? ' disabled' : ''}><span class="nc-switch-dot" aria-hidden="true"></span><span class="nc-switch-name">${esc(name)}</span></button>`;
const panelFail = () => (state.panelNote ? `<p class="nc-panel-note" role="status">${esc(state.panelNote)}</p>` : '');

function keywordsHtml() {
  const max = state.limits.keywords;
  const head = panelHead('키워드 수정', state.keywordsLoaded ? `${state.keywords.length}/${max} · 하루 ${state.limits.keyword_items}개까지` : '');
  if (!state.keywordsLoaded) return head + (state.keywordsFailed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 4}));
  const full = state.keywords.length >= max;
  const add = `<form class="nc-kw-add" data-nc-kw-form><input type="text" data-nc-kw-input maxlength="${KEYWORD_MAX_CHARS}" placeholder="키워드" aria-label="새 키워드" value="${esc(state.draft)}"${full ? ' disabled' : ''}><button type="submit" class="secondary nc-kw-add-btn"${full ? ' disabled' : ''}>더하기</button></form>`;
  const rows = state.keywords.map(k => `<div class="nc-row">${switchHtml('data-nc-kw', k.word, k.enabled === true, k.word, state.saving.has('kw:' + k.word))}<button type="button" class="nc-del" data-nc-kw-del="${esc(k.word)}" aria-label="${esc(k.word)} 삭제"${state.saving.has('kw:' + k.word) ? ' disabled' : ''}><span aria-hidden="true">×</span></button></div>`).join('');
  return head + add + panelFail() + (rows || emptyHtml('키워드 없음'));
}

function sourcesHtml() {
  const on = enabledSourceKeys(state.catalog, state.sources).length;
  const head = panelHead('매체 선택', state.catalog && state.sourcesLoaded ? `켬 ${on}` : '');
  if (!state.catalog || !state.sourcesLoaded) return head + (state.catalogFailed || state.sourcesFailed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 6}));
  const groups = REGIONS.map(g => {
    const members = state.catalog.filter(s => s.region === g.key);
    if (!members.length) return '';
    return `<section class="nc-group" aria-label="${esc(g.label)}"><h3 class="nc-group-head">${esc(g.label)}</h3>${members.map(s => {
      const row = state.sources.get(s.key), note = sourceNote(row);
      return `<div class="nc-row">${switchHtml('data-nc-source', s.key, sourceOn(s, row), s.name, state.saving.has('src:' + s.key))}${note ? `<span class="nc-faint${row?.last_error ? ' is-bad' : ''}">${esc(note)}</span>` : ''}</div>`;
    }).join('')}</section>`;
  }).join('');
  return head + panelFail() + groups;
}

function paint() {
  if (!root) return;
  root.dataset.mode = state.mode;
  const when = $('[data-nc-when]');
  if (when) {
    if (state.mode === 'list' && state.filling) when.innerHTML = `<span>채우는 중</span> ${waitInlineHtml()}`;
    else when.textContent = state.mode === 'list' ? state.fillNote : '';
    when.hidden = !(state.mode === 'list' && (state.filling || state.fillNote));
  }
  const list = $('[data-nc-list]'), panel = $('[data-nc-panel]');
  if (state.mode === 'keywords') { panel.innerHTML = keywordsHtml(); list.replaceChildren(); }
  else if (state.mode === 'sources') { panel.innerHTML = sourcesHtml(); list.replaceChildren(); }
  else if (state.mode === 'folders') { panel.innerHTML = panelHead('별표 폴더', state.loaded ? `${state.items.length}` : '') + treeHtml(); list.replaceChildren(); }
  else { list.innerHTML = listHtml(); panel.replaceChildren(); now()?.listed?.(); }
}
// 읽음 표시가 오거나 바뀌면 이 칸을 다시 그린다(목록·별표 폴더 칸만).
onReads(() => { if (state.mode === 'list' || state.mode === 'folders') paint(); });

// ---------- 불러오기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  closeLayer();
  state = fresh(); state.scope = scope;
}
async function loadItems({append = false, keep = false} = {}) {
  const w = workspaceOf(), seq = ++loadSeq;
  if (!w) return;
  if (append) { state.more = true; paint(); }
  else { state.failed = false; if (!keep || !state.loaded) { state.loaded = false; state.items = []; } paint(); }
  try {
    const rows = await readItems(w, state.tab, append ? state.items.length : 0);
    if (seq !== loadSeq) return;
    const got = Array.isArray(rows) ? rows : [];
    const page = got.slice(0, PAGE_SIZE);
    state.items = append ? [...state.items, ...page.filter(p => !state.items.some(x => x.id === p.id))] : page;
    state.end = got.length <= PAGE_SIZE;
    state.loaded = true;
    void ensureReads(page.map(it => ({type: 'news', id: it.id})));
    if (state.tab === STAR || page.some(it => it.starred_at)) ensureFolders().then(ok => { if (ok && state.mode === 'folders') paint(); });
    if (!append) maybeAutoFill();
  } catch {
    if (seq !== loadSeq) return;
    if (!append) state.failed = true;
  } finally {
    if (seq === loadSeq) { state.more = false; paint(); }
  }
}
async function ensureFolders() {
  if (state.foldersLoaded) return true;
  state.foldersFailed = false;
  const w = workspaceOf(), scope = state.scope;
  try { const rows = await readFolders(w); if (scope !== state.scope) return false; state.folders = Array.isArray(rows) ? rows : []; state.foldersLoaded = true; state.foldersFailed = false; return true; }
  catch { if (scope === state.scope) state.foldersFailed = true; return false; }
}
async function loadCatalog() {
  if (state.catalog) return;
  try {
    const data = await edge('catalog', {}, 20000);
    state.catalog = normalizeCatalog(data); state.limits = normalizeLimits(data); state.catalogFailed = false;
  } catch { state.catalogFailed = true; }
}
async function loadSources() {
  const w = workspaceOf(), scope = state.scope;
  if (!w) return;
  try {
    const rows = await readSources(w);
    if (scope !== state.scope || !Array.isArray(rows)) return;
    state.sources = new Map(rows.filter(r => r && r.source_key).map(r => [r.source_key, r])); state.sourcesLoaded = true; state.sourcesFailed = false;
  } catch { if (scope === state.scope && !state.sourcesLoaded) state.sourcesFailed = true; }
}
// 껍데기에 주는 언론 매체 표: 카탈로그 + 켠 news- 키(매체 고르기·색·[전체] 거르기). 이 접속에서 한 번 읽고, 켜고 끄면 새로.
const metaOf = () => ({catalog: state.catalog || [], enabled: enabledSourceKeys(state.catalog, state.sources)});
let metaJob = null;
function meta() {
  resetIfOwnerChanged();
  if (state.catalog && state.sourcesLoaded) return Promise.resolve(metaOf());
  metaJob ||= Promise.allSettled([loadCatalog(), state.sourcesLoaded ? null : loadSources()]).then(() => { metaJob = null; return metaOf(); });
  return metaJob;
}
let entering = null;
async function load() {
  const scope = state.scope;
  await Promise.allSettled([meta().then(m => now()?.metaChanged?.(m)), loadItems({keep: true})]);
  if (scope !== state.scope) return;
  paint();
}
function enter() {
  resetIfOwnerChanged();
  const want = takeNewsItem();
  if (want) { closeLayer(); state.mode = 'list'; state.tab = ALL; state.focus = want; }
  paint();
  entering ||= load().catch(() => {}).finally(() => { entering = null; });
  return want ? entering.then(() => showFocus(want)) : entering;
}
// 노트의 [기사로 가기]: 그 기사를 목록 맨 위에 두고(첫 쪽에 없으면 한 줄 읽어 앞에), 상세를 연다(메모는 상세에 있다).
async function showFocus(id) {
  const w = workspaceOf(), scope = state.scope;
  if (!w || state.focus !== id) return;
  let it = state.items.find(x => x.id === id);
  if (!it) {
    try { const row = await readOne(w, id, ITEM_COLS); if (scope !== state.scope || !row) return; it = row; state.items = [row, ...state.items]; }
    catch { return; }
  }
  paint();
  root?.querySelector(`[data-nc-item="${CSS.escape(id)}"]`)?.scrollIntoView({block: 'start'});
  if (now()) now().open({type: 'news', id}, now().describe('news', it));
}

// ---------- 지금 채우기(채널 기사 대기 줄을 서버가 지금 채움) ----------
let lastAutoFill = NaN;
// 목록을 열었을 때 읽기 전 채널 기사가 보이면 새 것부터 몇 건 바로 채운다. 실패·한도는 조용히 넘기고 [지금 채우기]는 그대로 둔다.
function maybeAutoFill() {
  if (state.filling || !needsAutoFill(state.items, lastAutoFill, Date.now())) return;
  lastAutoFill = Date.now();
  fillNow({quiet: true});
}
async function fillNow({quiet = false} = {}) {
  if (state.filling) return;
  const scope = state.scope;
  state.filling = true; state.fillNote = ''; paint();
  try {
    const r = await edge('fill_now', {}, 120000);
    if (scope !== state.scope) return;
    state.fillNote = fillResult(r);
  } catch (e) {
    if (scope !== state.scope) return;
    state.fillNote = quiet ? '' : errorNote(e, '지금 채우기');
  } finally {
    if (scope === state.scope) { state.filling = false; paint(); loadItems({keep: true}); }
  }
}

// ---------- 키워드·매체 칸(같은 화면 안, 뒤로가기 한 번 = 목록) ----------
let listDirty = false;
async function openPanel(mode) {
  state.mode = mode; state.panelNote = '';
  layer ||= window.KPTURouter?.layer?.open('news-panel', {reopen: () => openPanel(state.mode === 'list' ? mode : state.mode), close: () => { layer = null; backToList(); return true; }}) || null;
  paint();
  window.scrollTo({top: 0, behavior: 'instant'});
  $('[data-nc-back]')?.focus({preventScroll: true});
  const w = workspaceOf(), scope = state.scope;
  if (!w) return;
  if (mode === 'folders') {
    // 별표 폴더 칸: 별표한 기사 전부 + 폴더 트리(옛 [별표] 칩). 닫으면 목록(고른 매체)으로 다시 읽는다.
    state.tab = STAR; state.treeNote = ''; state.openFolders.add(OUTSIDE); // '폴더 없음'은 펼친 채로 연다(방금 별표한 기사가 바로 보이게)
    await Promise.allSettled([ensureFolders(), loadItems()]);
  } else if (mode === 'keywords') {
    try { const rows = await readKeywords(w); if (scope !== state.scope) return; state.keywords = Array.isArray(rows) ? rows.filter(r => r && typeof r.word === 'string') : []; state.keywordsLoaded = true; state.keywordsFailed = false; }
    catch { if (scope === state.scope && !state.keywordsLoaded) state.keywordsFailed = true; }
    if (!state.catalog) await loadCatalog();
  } else {
    const [, rows] = await Promise.allSettled([loadCatalog(), readSources(w)]);
    if (scope !== state.scope) return;
    if (rows.status === 'fulfilled' && Array.isArray(rows.value)) { state.sources = new Map(rows.value.filter(r => r && r.source_key).map(r => [r.source_key, r])); state.sourcesLoaded = true; state.sourcesFailed = false; }
    else if (!state.sourcesLoaded) state.sourcesFailed = true;
  }
  if (state.mode === mode) paint();
}
function backToList() {
  if (state.mode === 'list') return;
  const fromFolders = state.mode === 'folders';
  state.mode = 'list'; state.panelNote = ''; state.tab = ALL;
  paint();
  document.querySelector('#outsideRoot [data-os-more]')?.focus({preventScroll: true});
  if (listDirty || fromFolders) { listDirty = false; loadItems({keep: !fromFolders}); }
}
function closeLayer() { const l = layer; layer = null; l?.close(); }
const saveFailNote = e => (e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시');
function focusAfter(sel) { root?.querySelector(sel)?.focus({preventScroll: true}); }

async function toggleSource(key) {
  const w = workspaceOf(), tag = 'src:' + key;
  if (!w || state.saving.has(tag) || !state.catalog?.some(s => s.key === key)) return;
  const next = !sourceOn(state.catalog.find(s => s.key === key), state.sources.get(key));
  state.saving.add(tag); state.panelNote = ''; paint();
  try { state.sources.set(key, await writeSource(w, key, next)); listDirty = true; now()?.metaChanged?.(metaOf()); }
  catch (e) { state.panelNote = saveFailNote(e); }
  finally { state.saving.delete(tag); paint(); focusAfter(`[data-nc-source="${CSS.escape(key)}"]`); }
}
async function addKeyword(raw) {
  const w = workspaceOf();
  if (!w) return;
  if (state.keywords.length >= state.limits.keywords) { state.panelNote = `키워드는 ${state.limits.keywords}개까지`; paint(); return; }
  const c = cleanWord(raw, state.keywords.map(k => k.word));
  if (!c.ok) { state.draft = String(raw ?? ''); state.panelNote = c.reason; paint(); focusAfter('[data-nc-kw-input]'); return; }
  const tag = 'kw:' + c.word;
  state.saving.add(tag); state.panelNote = ''; state.draft = '';
  try {
    const rows = await rt().api(`/rest/v1/app_news_keywords?select=${KEYWORD_COLS}`, {method: 'POST', body: {workspace_id: w, word: c.word, enabled: true}, prefer: 'return=representation', singleFlight: false});
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.word !== c.word) throw new Error('save');
    state.keywords = [...state.keywords, row];
  } catch (e) { state.draft = c.word; state.panelNote = e?.status === 409 ? '이미 있음' : saveFailNote(e); }
  finally { state.saving.delete(tag); paint(); focusAfter('[data-nc-kw-input]'); }
}
async function toggleKeyword(word) {
  const w = workspaceOf(), tag = 'kw:' + word, k = state.keywords.find(x => x.word === word);
  if (!w || !k || state.saving.has(tag)) return;
  state.saving.add(tag); state.panelNote = ''; paint();
  try {
    const rows = await rt().api(`/rest/v1/app_news_keywords?workspace_id=eq.${q(w)}&word=eq.${q(word)}&select=${KEYWORD_COLS}`, {method: 'PATCH', body: {enabled: k.enabled !== true, updated_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) throw new Error('save');
    Object.assign(k, row);
  } catch (e) { state.panelNote = saveFailNote(e); }
  finally { state.saving.delete(tag); paint(); focusAfter(`[data-nc-kw="${CSS.escape(word)}"]`); }
}
async function deleteKeyword(word) {
  const w = workspaceOf(), tag = 'kw:' + word;
  if (!w || state.saving.has(tag)) return;
  state.saving.add(tag); state.panelNote = ''; paint();
  try {
    await rt().api(`/rest/v1/app_news_keywords?workspace_id=eq.${q(w)}&word=eq.${q(word)}`, {method: 'DELETE', prefer: 'return=minimal', singleFlight: false});
    state.keywords = state.keywords.filter(k => k.word !== word);
  } catch (e) { state.panelNote = saveFailNote(e); }
  finally { state.saving.delete(tag); paint(); focusAfter('[data-nc-kw-input]'); }
}

// ---------- 별표·폴더(C2) ----------
let picker = null;
const folderPicker = () => (picker ||= createMovePicker({esc}));
async function toggleStar(id, trigger) {
  const w = workspaceOf(), it = state.items.find(x => x.id === id), scope = state.scope;
  if (!w || !it || state.busy.has('star:' + id)) return;
  const on = !it.starred_at;
  state.busy.add('star:' + id);
  try {
    // 별표를 빼면 폴더도 비운다(DB 검사: 폴더는 별표한 기사만).
    const row = await patchItem(w, id, on ? {starred_at: new Date().toISOString()} : {starred_at: null, folder_id: null});
    if (scope !== state.scope) return;
    Object.assign(it, row);
    signal(id, on ? 'star' : 'unstar');
    if (state.tab === STAR && !on) state.items = state.items.filter(x => x.id !== id);
  } catch (e) { if (scope === state.scope) state.notes.set(id, saveFailNote(e)); }
  finally { state.busy.delete('star:' + id); }
  if (scope !== state.scope) return;
  paint();
  // 별표하면 바로 폴더 고르기(고르지 않고 닫으면 '폴더 없음').
  if (on && it.starred_at) { await ensureFolders(); if (scope === state.scope) pickFolder(id, root?.querySelector(`[data-nc-star="${CSS.escape(id)}"]`) || trigger); }
  else root?.querySelector(`[data-nc-star="${CSS.escape(id)}"]`)?.focus({preventScroll: true});
}
// 글 줄 밀기·마우스 단추(NOW-줄밀기): 왼쪽 = 숨기기(hidden_at), 오른쪽 = 보관(= 별표, 다시 밀면 풀기). 사회운동·[보관] 탭과 같은 부품(now-row-acts.js).
bindNowRows(root?.querySelector('[data-nc-list]'), {row: '[data-nc-item]', itemOf: el => (el.dataset.ncItem ? {type: 'news', id: el.dataset.ncItem} : null),
  enabled: () => state.mode === 'list',
  isSaved: item => !!state.items.find(x => x.id === item.id)?.starred_at,
  changed: (item, kind, on) => {
    const it = state.items.find(x => x.id === item.id);
    if (kind === 'hide') { if (on) state.items = state.items.filter(x => x.id !== item.id); else load().catch(() => {}); }
    else if (it) { it.starred_at = on ? new Date().toISOString() : null; if (!on) it.folder_id = null; if (state.tab === STAR && !on) state.items = state.items.filter(x => x.id !== item.id); }
    else load().catch(() => {});
    paint();
  }});
async function putInFolder(id, folderId) {
  const w = workspaceOf(), it = state.items.find(x => x.id === id), scope = state.scope;
  if (!w || !it || !it.starred_at) return;
  try { const row = await patchItem(w, id, {folder_id: folderId}); if (scope !== state.scope) return; Object.assign(it, row); if (folderId) for (const f of folderPath(state.folders, folderId)) state.openFolders.add(f.id); }
  catch (e) { if (scope === state.scope) state.notes.set(id, saveFailNote(e)); }
  if (scope === state.scope) paint();
}
function pickFolder(id, anchor) {
  if (!anchor) return;
  folderPicker().open({anchor, place: 'below', history: PHONE.matches, canNew: true, canOut: true,
    rows: query => pickerRows({folders: state.folders, free: true, query}),
    onPick: fid => putInFolder(id, fid), onOut: () => putInFolder(id, null),
    onNew: async () => { const made = await newFolder(null); if (made) await putInFolder(id, made.id); }});
}
const askName = (text, value = '') => { const typed = window.prompt(`${text} (40자까지)`, value); if (typed === null) return null; const name = cleanFolderName(typed); if (!name) { state.treeNote = '폴더 이름은 1~40자로 써 주세요'; paint(); return null; } return name; };
async function newFolder(parentId) {
  const w = workspaceOf(), scope = state.scope;
  if (!w || !await ensureFolders()) return null;
  if (parentId && folderPath(state.folders, parentId).length >= FOLDER_DEPTH_LIMIT) { state.treeNote = `폴더는 ${FOLDER_DEPTH_LIMIT}단까지`; paint(); return null; }
  const name = askName('새 폴더 이름'); if (!name) return null;
  try {
    const rows = await rt().api(`/rest/v1/app_news_folders?select=${FOLDER_COLS}`, {method: 'POST', body: {workspace_id: w, parent_id: parentId || null, name, sort_order: nextSortOrder(folderSiblings(state.folders, {free: true, parentId: parentId || null}))}, prefer: 'return=representation', singleFlight: false});
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.id || scope !== state.scope) return null;
    state.folders = [...state.folders, row]; if (parentId) state.openFolders.add(parentId); state.treeNote = ''; paint();
    return row;
  } catch (e) { if (scope === state.scope) { state.treeNote = folderErrorText(e); paint(); } return null; }
}
async function renameFolder(id) {
  const w = workspaceOf(), f = state.folders.find(x => x.id === id), scope = state.scope;
  if (!w || !f) return;
  const name = askName('폴더 이름 바꾸기', f.name); if (!name || name === f.name) return;
  try {
    const rows = await rt().api(`/rest/v1/app_news_folders?workspace_id=eq.${q(w)}&id=eq.${q(id)}&select=${FOLDER_COLS}`, {method: 'PATCH', body: {name}, prefer: 'return=representation', singleFlight: false});
    const row = Array.isArray(rows) ? rows[0] : null; if (!row || scope !== state.scope) return;
    state.folders = state.folders.map(x => (x.id === id ? {...x, ...row} : x)); state.treeNote = '';
  } catch (e) { if (scope === state.scope) state.treeNote = folderErrorText(e); }
  if (scope === state.scope) paint();
}
// 폴더 지우기: 안의 폴더·기사는 DB가 한 단 위로 올린다(기사는 지우지 않음). 다 끝나면 폴더·기사를 다시 읽는다.
async function deleteFolder(id, trigger) {
  const w = workspaceOf(), f = state.folders.find(x => x.id === id), scope = state.scope;
  if (!w || !f) return;
  const up = f.parent_id ? state.folders.find(x => x.id === f.parent_id) : null;
  if (!await askConfirm(trigger, {text: `'${f.name}' 폴더를 삭제할까요?`, note: `안의 기사·폴더는 ${up ? `'${up.name}'` : `'${OUTSIDE_NAME}'`}(으)로 가요. 기사는 삭제하지 않아요.`, ok: '삭제', danger: true})) return;
  try {
    await rt().api(`/rest/v1/app_news_folders?workspace_id=eq.${q(w)}&id=eq.${q(id)}`, {method: 'DELETE', prefer: 'return=minimal', singleFlight: false});
    if (scope !== state.scope) return;
    state.foldersLoaded = false; state.treeNote = '';
    await ensureFolders(); loadItems({keep: true});
  } catch (e) { if (scope === state.scope) { state.treeNote = folderErrorText(e); paint(); } }
}
const folderMenu = createAnchoredMenu({id: 'ncFolderMenu', className: 'topline-add-menu nc-menu', label: '폴더 메뉴', historyKey: 'kptuNewsFolderMenu', key: b => b.dataset.ncFolderMore,
  render: () => '<button type="button" data-nc-fact="child">안에 폴더 만들기</button><button type="button" data-nc-fact="rename">이름 바꾸기</button><button type="button" data-nc-fact="delete">삭제</button>',
  onAction: (button, active) => { const trigger = active?.trigger, id = trigger?.dataset?.ncFolderMore; if (!id) return; const a = button.dataset.ncFact; if (a === 'child') newFolder(id); else if (a === 'rename') renameFolder(id); else if (a === 'delete') deleteFolder(id, trigger); }});

// ---------- 누르기·밀기 ----------
root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-nc-open]')) { const it = state.items.find(x => x.id === b.dataset.ncOpen); if (it && now()) now().open({type: 'news', id: it.id}, now().describe('news', it)); return; }
  if (b.matches('[data-nc-back]')) { closeLayer(); backToList(); return; }
  if (b.matches('[data-nc-star]')) { toggleStar(b.dataset.ncStar, b); return; }
  if (b.matches('[data-nc-folder]')) { const id = b.dataset.ncFolder; ensureFolders().then(ok => { if (ok) pickFolder(id, b); }); return; }
  if (b.matches('[data-nc-folder-toggle]')) { const id = b.dataset.ncFolderToggle; if (state.openFolders.has(id)) state.openFolders.delete(id); else state.openFolders.add(id); paint(); root.querySelector(`[data-nc-folder-toggle="${CSS.escape(id)}"]`)?.focus({preventScroll: true}); return; }
  if (b.matches('[data-nc-folder-more]')) { folderMenu.open(b); return; }
  if (b.matches('[data-nc-new-folder]')) { newFolder(null); return; }
  if (b.matches('[data-nc-source]')) { toggleSource(b.dataset.ncSource); return; }
  if (b.matches('[data-nc-kw]')) { toggleKeyword(b.dataset.ncKw); return; }
  if (b.matches('[data-nc-kw-del]')) { deleteKeyword(b.dataset.ncKwDel); return; }
  if (b.matches('[data-nc-more-items]')) { loadItems({append: true}); return; }
  if (b.matches('[data-nc-retry]')) { if (state.mode === 'list') load().catch(() => {}); else openPanel(state.mode); paint(); }
});
root?.addEventListener('submit', event => {
  if (!event.target.matches('[data-nc-kw-form]')) return;
  event.preventDefault();
  addKeyword(event.target.querySelector('[data-nc-kw-input]')?.value);
});
root?.addEventListener('input', event => { if (event.target.matches('[data-nc-kw-input]')) state.draft = event.target.value; });
// 좌우 밀기는 News 탭 이동(껍데기 outside-statements.js)이 갖는다.

window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'outside') return;
  // 다른 화면으로 가면 키워드·매체 칸은 닫힌 것으로(라우터가 그 화면의 겹을 정리한다). 다음에 들어오면 목록부터.
  layer = null;
  if (state.mode !== 'list') { state.mode = 'list'; listDirty = true; }
  state.fillNote = ''; state.focus = '';
});
// News 껍데기가 [언론] 탭을 보일 때 enter()를 부른다(라우터 화면 이름은 outside). 이 모듈이 늦게 불러와졌으면 지금 들어간다.
// act(): 껍데기 ⋯의 언론 쪽 항목. meta(): 언론 매체 표. repaint(): 위 찾기 칸 글자가 바뀌면 제목 거르기만 다시.
window.KPTUNews = {refresh: () => load(), enter: () => enter(), meta: () => meta(), repaint: () => { if (state.mode === 'list') paint(); },
  act: mode => { resetIfOwnerChanged(); if (mode === 'fill') fillNow(); else if (mode === 'sources' || mode === 'keywords' || mode === 'folders') openPanel(mode); }};
if (window.KPTURouter?.current === 'outside' && now()?.tab?.() === 'media') enter();
})();
