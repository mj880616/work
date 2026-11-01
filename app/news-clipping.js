import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {fitChipRows} from './chip-rows.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {claimedSince} from './row-swipe.js';
import {ALL, TABS, PAGE_SIZE, KEYWORD_MAX_CHARS, DEFAULT_LIMITS, REGIONS, laneFilter, tabAt, keepTab, groupItems, itemView, openResult, errorNote, fillResult, cleanWord, normalizeCatalog, normalizeLimits, sourceNote} from './news-clipping-model.mjs';
// NEWS-클리핑 화면 C1(설계 docs/design/news-clipping.md, 명진 11/01 22:34): '뉴스 클리핑'(?view=news). #newsView의 유일한 그리기 주인.
// - 한 목록: 채널 기사 + 서버가 찾은 기사 = 하나의 스크랩(꼬리표 '채널'/'자동'). 칩 [전체·채널·자동], 폰은 좌우로 밀어 칩 이동.
// - 줄: '꼬리표 · 매체 · 시각' / 제목 / 한 문장 요약(늘 보임) / 본문 접기(<details>, 펼칠 때 서버 줄에서 읽고 없으면 [본문 열기]=news-feed open)
//   / 외국어는 [번역](news-feed translate, 저장본이 있으면 다시 부르지 않고 [원문 보기]와 오감) / [원문](새 창). 유료 기사는 공개 요약만 + 원문.
// - ⋯: [지금 채우기](news-feed fill_now) · [키워드 고치기](app_news_keywords) · [매체 켜고 끄기](app_outside_sources의 news- 키).
//   키워드·매체 칸은 같은 화면 안 한 칸이고 뒤로가기 한 번 = 목록(KPTURouter.layer).
// - 저장은 모두 서버(작업공간 소유자 RLS · Edge는 사용자 로그인 확인). 기기 저장 없음. 하루 횟수는 서버 상수가 정하고 catalog limits로 받는다.
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 기사 제목·본문·주소를 남기지 않는다.

(() => {
if (window.KPTUNews) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const ITEM_COLS = 'id,lane,url,title,lang,publisher,source_key,keywords,published_at,scrapped_at,created_at,state,summary,body_kind,title_ko,translated_at,starred_at,folder_id';
const BODY_COLS = 'id,state,summary,body,body_kind,title,title_ko,body_ko,translated_at,publisher';
const SOURCE_COLS = 'source_key,enabled,last_ok_at,last_error';
const KEYWORD_COLS = 'word,enabled,created_at';
const PHONE = window.matchMedia('(max-width:760px)');

function install() {
  if (document.getElementById('newsView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="newsView" class="view-panel hidden" aria-labelledby="ncTitle">
<h2 id="ncTitle" class="screen-title">뉴스 클리핑</h2>
<div id="newsRoot" class="nc" data-mode="list">
<div class="nc-bar"><div class="nc-chips" data-nc-chips role="group" aria-label="기사 거르기"></div><button type="button" class="nc-more" data-nc-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="뉴스 클리핑 메뉴">${MORE}</button></div>
<p class="nc-when" data-nc-when role="status" hidden></p>
<div class="nc-list" data-nc-list aria-label="스크랩"></div>
<div class="nc-panel" data-nc-panel></div>
</div></section>`);
}
install();

const root = document.getElementById('newsRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const fresh = () => ({scope: '', tab: ALL, items: [], loaded: false, failed: false, end: true, more: false,
  open: new Set(), bodies: new Map(), ko: new Set(), busy: new Set(), notes: new Map(),
  limits: {...DEFAULT_LIMITS}, catalog: null, catalogFailed: false, sources: new Map(), sourcesLoaded: false, sourcesFailed: false,
  keywords: [], keywordsLoaded: false, keywordsFailed: false, saving: new Set(), panelNote: '', draft: '',
  mode: 'list', filling: false, fillNote: ''});
let state = fresh(), loadSeq = 0, layer = null;

// ---------- 서버 읽기·쓰기 ----------
const q = v => encodeURIComponent(v);
const edge = (action, body = {}, timeoutMs = 60000) => rt().api(`/functions/v1/news-feed?action=${action}`, {method: 'POST', body, singleFlight: false, timeoutMs});
function readItems(w, tab, offset) {
  return rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&hidden_at=is.null${laneFilter(tab)}&select=${ITEM_COLS}&order=created_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`, {singleFlight: false});
}
const readOne = (w, id, cols) => rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(id)}&select=${cols}&limit=1`, {singleFlight: false}).then(r => (Array.isArray(r) ? r[0] || null : null));
const readSources = w => rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=like.news-*&select=${SOURCE_COLS}`, {singleFlight: false});
const readKeywords = w => rt().api(`/rest/v1/app_news_keywords?workspace_id=eq.${q(w)}&select=${KEYWORD_COLS}&order=created_at.asc&limit=100`, {singleFlight: false});
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
function chipsHtml() {
  return TABS.map(t => `<button type="button" class="nc-chip" data-nc-tab="${t.id}" aria-pressed="${state.tab === t.id}">${esc(t.label)}</button>`).join('');
}

function bodyHtml(it, v) {
  const b = state.bodies.get(it.id);
  if (!b || b.loading) return waitHtml({rows: 3});
  if (b.failed) return failHtml({retry: 'data-nc-body-retry'});
  const ko = v.showingKo && b.body_ko;
  const text = ko ? b.body_ko : b.body;
  const note = state.notes.get(it.id) || '';
  const lead = b.body_kind === 'lead' ? '<p class="nc-faint">공개된 앞부분만</p>' : '';
  if (text) return `${lead}<p class="nc-text"${v.foreign && !ko ? ` lang="${esc(it.lang)}"` : ''}>${esc(text)}</p>`;
  return note ? `<p class="nc-faint">${esc(note)}</p>` : emptyHtml('본문 없음');
}

function itemHtml(it) {
  const v = itemView(it, {showKo: state.ko.has(it.id)});
  const meta = `<p class="nc-meta"><span class="nc-tag" data-tag="${it.lane === 'channel' ? 'channel' : 'auto'}">${esc(v.tag)}</span>${v.publisher ? `<span class="nc-src">${esc(v.publisher)}</span>` : ''}${v.time ? `<span class="nc-time">${esc(v.time)}</span>` : ''}${v.keywords.map(k => `<span class="nc-kw">${esc(k)}</span>`).join('')}</p>`;
  const sum = v.summary ? `<p class="nc-sum">${esc(v.summary)}</p>` : '';
  const note = v.note ? `<p class="nc-note" data-state="${esc(it.state)}">${esc(v.note)}</p>` : '';
  const open = v.canOpen && state.open.has(it.id);
  const fold = v.canOpen ? `<details class="nc-fold" data-nc-fold="${esc(it.id)}"${open ? ' open' : ''}><summary>본문</summary><div class="nc-body" data-nc-body="${esc(it.id)}">${open ? bodyHtml(it, v) : ''}</div></details>` : '';
  const busy = state.busy.has(it.id);
  const tr = v.foreign && v.canOpen ? `<button type="button" class="nc-act" data-nc-translate="${esc(it.id)}"${busy ? ' disabled aria-busy="true"' : ''}>${busy ? '번역 중' : v.showingKo ? '원문 보기' : '번역'}</button>` : '';
  const link = v.url ? `<a class="nc-link" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(v.title)} 원문 (새 창)">원문</a>` : '';
  const actNote = !open && state.notes.get(it.id) ? `<span class="nc-faint">${esc(state.notes.get(it.id))}</span>` : '';
  return `<article class="nc-item" data-nc-item="${esc(it.id)}">${meta}<h4 class="nc-title"${v.titleLang ? ` lang="${esc(v.titleLang)}"` : ''}>${esc(v.title)}</h4>${sum}${note}<div class="nc-foot">${fold}${tr}${link}${actNote}</div></article>`;
}

function listHtml() {
  if (!state.loaded) return state.failed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 6, h: 64});
  if (!state.items.length) return emptyHtml('기사 없음', {attrs: 'data-nc-empty'});
  const now = Date.now();
  const days = groupItems(state.items, now).map(g => `<section class="nc-day" aria-label="${esc(g.label)}"><h3 class="nc-day-head">${esc(g.label)}</h3>${g.items.map(itemHtml).join('')}</section>`).join('');
  const more = state.end ? '' : `<button type="button" class="nc-text-btn nc-more-items" data-nc-more-items${state.more ? ' disabled aria-busy="true"' : ''}>더 보기</button>`;
  return days + more;
}

const panelHead = (title, count) => `<div class="nc-panel-head"><button type="button" class="nc-back" data-nc-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>${esc(title)}</b>${count ? `<span class="nc-faint">${esc(count)}</span>` : ''}</div>`;
const switchHtml = (attr, val, on, name, busy) => `<button type="button" class="nc-switch" role="switch" ${attr}="${esc(val)}" aria-checked="${on}"${busy ? ' disabled' : ''}><span class="nc-switch-dot" aria-hidden="true"></span><span class="nc-switch-name">${esc(name)}</span></button>`;
const panelFail = () => (state.panelNote ? `<p class="nc-panel-note" role="status">${esc(state.panelNote)}</p>` : '');

function keywordsHtml() {
  const max = state.limits.keywords;
  const head = panelHead('키워드 고치기', state.keywordsLoaded ? `${state.keywords.length}/${max} · 하루 ${state.limits.keyword_items}개까지` : '');
  if (!state.keywordsLoaded) return head + (state.keywordsFailed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 4}));
  const full = state.keywords.length >= max;
  const add = `<form class="nc-kw-add" data-nc-kw-form><input type="text" data-nc-kw-input maxlength="${KEYWORD_MAX_CHARS}" placeholder="키워드" aria-label="새 키워드" value="${esc(state.draft)}"${full ? ' disabled' : ''}><button type="submit" class="secondary nc-kw-add-btn"${full ? ' disabled' : ''}>더하기</button></form>`;
  const rows = state.keywords.map(k => `<div class="nc-row">${switchHtml('data-nc-kw', k.word, k.enabled === true, k.word, state.saving.has('kw:' + k.word))}<button type="button" class="nc-del" data-nc-kw-del="${esc(k.word)}" aria-label="${esc(k.word)} 지우기"${state.saving.has('kw:' + k.word) ? ' disabled' : ''}><span aria-hidden="true">×</span></button></div>`).join('');
  return head + add + panelFail() + (rows || emptyHtml('키워드 없음'));
}

function sourcesHtml() {
  const on = [...state.sources.values()].filter(r => r.enabled === true).length;
  const head = panelHead('매체 켜고 끄기', state.catalog && state.sourcesLoaded ? `켬 ${on}` : '');
  if (!state.catalog || !state.sourcesLoaded) return head + (state.catalogFailed || state.sourcesFailed ? failHtml({retry: 'data-nc-retry'}) : waitHtml({rows: 6}));
  const groups = REGIONS.map(g => {
    const members = state.catalog.filter(s => s.region === g.key);
    if (!members.length) return '';
    return `<section class="nc-group" aria-label="${esc(g.label)}"><h3 class="nc-group-head">${esc(g.label)}</h3>${members.map(s => {
      const row = state.sources.get(s.key), note = sourceNote(row);
      return `<div class="nc-row">${switchHtml('data-nc-source', s.key, row?.enabled === true, s.name, state.saving.has('src:' + s.key))}${note ? `<span class="nc-faint${row?.last_error ? ' is-bad' : ''}">${esc(note)}</span>` : ''}</div>`;
    }).join('')}</section>`;
  }).join('');
  return head + panelFail() + `<p class="nc-faint">매체 새 글은 제목만 받습니다</p>` + groups;
}

function paint() {
  if (!root) return;
  root.dataset.mode = state.mode;
  const bar = $('[data-nc-chips]');
  if (bar) {
    const toggle = bar.querySelector(':scope > [data-chip-rows-more]');
    [...bar.children].forEach(el => { if (el !== toggle) el.remove(); });
    bar.insertAdjacentHTML('afterbegin', chipsHtml());
    fitChipRows(bar, {key: 'news', keep: el => el.getAttribute('aria-pressed') === 'true'});
  }
  const when = $('[data-nc-when]');
  if (when) {
    if (state.mode === 'list' && state.filling) when.innerHTML = `<span>채우는 중</span> ${waitInlineHtml()}`;
    else when.textContent = state.mode === 'list' ? state.fillNote : '';
    when.hidden = !(state.mode === 'list' && (state.filling || state.fillNote));
  }
  const list = $('[data-nc-list]'), panel = $('[data-nc-panel]');
  if (state.mode === 'keywords') { panel.innerHTML = keywordsHtml(); list.replaceChildren(); }
  else if (state.mode === 'sources') { panel.innerHTML = sourcesHtml(); list.replaceChildren(); }
  else { list.innerHTML = listHtml(); panel.replaceChildren(); }
}
// 기사 한 줄만 다시 그린다(다른 줄의 펼침·스크롤은 그대로).
function paintItem(id) {
  const it = state.items.find(x => x.id === id), el = root?.querySelector(`[data-nc-item="${CSS.escape(id)}"]`);
  if (!it || !el) return;
  const focusTr = document.activeElement?.matches?.(`[data-nc-translate="${CSS.escape(id)}"]`);
  el.outerHTML = itemHtml(it);
  if (focusTr) root.querySelector(`[data-nc-translate="${CSS.escape(id)}"]`)?.focus({preventScroll: true});
}

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
  } catch {
    if (seq !== loadSeq) return;
    if (!append) state.failed = true;
  } finally {
    if (seq === loadSeq) { state.more = false; paint(); }
  }
}
async function loadCatalog() {
  if (state.catalog) return;
  try {
    const data = await edge('catalog', {}, 20000);
    state.catalog = normalizeCatalog(data); state.limits = normalizeLimits(data); state.catalogFailed = false;
  } catch { state.catalogFailed = true; }
}
let entering = null;
async function load() {
  const scope = state.scope;
  await Promise.allSettled([loadCatalog(), loadItems({keep: true})]);
  if (scope !== state.scope) return;
  paint();
}
function enter() {
  resetIfOwnerChanged();
  paint();
  entering ||= load().catch(() => {}).finally(() => { entering = null; });
  return entering;
}

// ---------- 본문·번역 ----------
async function readBody(id) {
  const w = workspaceOf();
  const row = await readOne(w, id, BODY_COLS);
  if (!row) throw new Error('missing');
  const it = state.items.find(x => x.id === id);
  if (it) Object.assign(it, {state: row.state, summary: row.summary, body_kind: row.body_kind, title: row.title, title_ko: row.title_ko, translated_at: row.translated_at, publisher: row.publisher});
  state.bodies.set(id, {body: row.body || '', body_kind: row.body_kind || '', body_ko: row.body_ko || ''});
  return row;
}
async function openBody(id) {
  const it = state.items.find(x => x.id === id), scope = state.scope;
  if (!it || !workspaceOf()) return;
  const have = state.bodies.get(id);
  if (have && !have.failed && !have.loading) { paintItem(id); return; }
  state.bodies.set(id, {loading: true}); paintItem(id);
  try {
    const row = await readBody(id);
    if (scope !== state.scope) return;
    // 서버 줄에 본문이 없으면 [본문 열기]: 서버가 지금 한 번 읽어 저장한다(허용 주소·robots·유료벽 규칙은 서버).
    if (!row.body && row.state !== 'paywall') {
      let r = null;
      try { r = await edge('open', {id}); } catch (e) { state.notes.set(id, errorNote(e, '본문 열기')); }
      if (scope !== state.scope) return;
      if (r) {
        const res = openResult(r.status);
        if (res.note) state.notes.set(id, res.note);
        if (res.reload) await readBody(id);
      }
    }
  } catch {
    if (scope !== state.scope) return;
    state.bodies.set(id, {failed: true});
  }
  paintItem(id);
}
async function translate(id) {
  const it = state.items.find(x => x.id === id), scope = state.scope;
  if (!it || state.busy.has(id)) return;
  // 저장본이 있으면 다시 부르지 않고 번역·원문 보기만 오간다.
  if (it.translated_at) {
    if (state.ko.has(id)) state.ko.delete(id); else state.ko.add(id);
    if (state.open.has(id) && !state.bodies.get(id)?.body_ko && state.ko.has(id)) { state.bodies.delete(id); openBody(id); return; }
    paintItem(id); return;
  }
  state.busy.add(id); state.notes.delete(id); paintItem(id);
  try {
    await edge('translate', {id}, 120000);
    if (scope !== state.scope) return;
    await readBody(id);
    state.ko.add(id);
  } catch (e) {
    if (scope !== state.scope) return;
    state.notes.set(id, errorNote(e, '번역'));
  } finally {
    if (scope === state.scope) { state.busy.delete(id); paintItem(id); }
  }
}

// ---------- 지금 채우기(채널 기사 대기 줄을 서버가 지금 채움) ----------
async function fillNow() {
  if (state.filling) return;
  const scope = state.scope;
  state.filling = true; state.fillNote = ''; paint();
  try {
    const r = await edge('fill_now', {}, 120000);
    if (scope !== state.scope) return;
    state.fillNote = fillResult(r);
  } catch (e) {
    if (scope !== state.scope) return;
    state.fillNote = errorNote(e, '지금 채우기');
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
  if (mode === 'keywords') {
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
  state.mode = 'list'; state.panelNote = '';
  paint();
  $('[data-nc-more]')?.focus({preventScroll: true});
  if (listDirty) { listDirty = false; loadItems({keep: true}); }
}
function closeLayer() { const l = layer; layer = null; l?.close(); }
const saveFailNote = e => (e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시');
function focusAfter(sel) { root?.querySelector(sel)?.focus({preventScroll: true}); }

async function toggleSource(key) {
  const w = workspaceOf(), tag = 'src:' + key;
  if (!w || state.saving.has(tag) || !state.catalog?.some(s => s.key === key)) return;
  const next = state.sources.get(key)?.enabled !== true;
  state.saving.add(tag); state.panelNote = ''; paint();
  try { state.sources.set(key, await writeSource(w, key, next)); listDirty = true; }
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

// ---------- 누르기·밀기 ----------
const menu = createAnchoredMenu({id: 'ncMenu', className: 'topline-add-menu nc-menu', label: '뉴스 클리핑 메뉴', historyKey: 'kptuNewsMenu', key: () => 'head',
  render: () => `<button type="button" data-nc-act="fill"${state.filling ? ' disabled' : ''}>지금 채우기 <span class="nc-faint">하루 ${state.limits.fill}번</span></button><button type="button" data-nc-act="keywords">키워드 고치기</button><button type="button" data-nc-act="sources">매체 켜고 끄기</button>`,
  onAction: button => { const a = button.dataset.ncAct; if (a === 'fill') fillNow(); else if (a === 'keywords' || a === 'sources') openPanel(a); }});

function setTab(tab) {
  const next = keepTab(tab);
  if (state.tab === next) return;
  state.tab = next; state.open.clear();
  loadItems();
}
root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-nc-tab]')) { setTab(b.dataset.ncTab); return; }
  if (b.matches('[data-nc-more]')) { menu.open(b); return; }
  if (b.matches('[data-nc-back]')) { closeLayer(); backToList(); return; }
  if (b.matches('[data-nc-translate]')) { translate(b.dataset.ncTranslate); return; }
  if (b.matches('[data-nc-source]')) { toggleSource(b.dataset.ncSource); return; }
  if (b.matches('[data-nc-kw]')) { toggleKeyword(b.dataset.ncKw); return; }
  if (b.matches('[data-nc-kw-del]')) { deleteKeyword(b.dataset.ncKwDel); return; }
  if (b.matches('[data-nc-more-items]')) { loadItems({append: true}); return; }
  if (b.matches('[data-nc-retry]')) { if (state.mode === 'list') load().catch(() => {}); else openPanel(state.mode); paint(); return; }
  if (b.matches('[data-nc-body-retry]')) { const id = b.closest('[data-nc-body]')?.dataset.ncBody; if (id) { state.bodies.delete(id); openBody(id); } }
});
root?.addEventListener('submit', event => {
  if (!event.target.matches('[data-nc-kw-form]')) return;
  event.preventDefault();
  addKeyword(event.target.querySelector('[data-nc-kw-input]')?.value);
});
root?.addEventListener('input', event => { if (event.target.matches('[data-nc-kw-input]')) state.draft = event.target.value; });
// <details>의 toggle은 거품이 오르지 않아 잡기 단계에서 받는다.
root?.addEventListener('toggle', event => {
  const d = event.target;
  if (!(d instanceof HTMLDetailsElement) || !d.matches('[data-nc-fold]')) return;
  const id = d.dataset.ncFold;
  if (d.open) { if (!state.open.has(id)) { state.open.add(id); openBody(id); } }
  else state.open.delete(id);
}, true);
// 폰: 목록에서 좌우로 밀어 칩(전체·채널·자동) 이동. 다른 부품이 잡은 줄 밀기·입력 칸·펼친 본문 글은 빼고, 가로로 충분히 민 것만.
let swipe = null;
root?.addEventListener('touchstart', e => {
  swipe = null;
  if (!PHONE.matches || state.mode !== 'list' || e.touches.length !== 1 || e.target.closest('input,textarea,[contenteditable],.nc-chips')) return;
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

window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'news') return;
  // 다른 화면으로 가면 키워드·매체 칸은 닫힌 것으로(라우터가 그 화면의 겹을 정리한다). 다음에 들어오면 목록부터.
  layer = null;
  if (state.mode !== 'list') { state.mode = 'list'; listDirty = true; }
  state.fillNote = '';
});
window.KPTURouter?.on?.('news', () => { enter(); });
window.KPTUNews = {refresh: () => load()};
if (window.KPTURouter?.current === 'news') enter();
})();
