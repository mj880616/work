import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {fitChipRows} from './chip-rows.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {claimedSince} from './row-swipe.js';
import {createOutsideSearch} from './outside-search.js';
import {ALL, GROUPS, PAGE_SIZE, normalizeCatalog, enabledKeys, ownSourceRows, chipsOf, subChipsOf, chipPressed, keysOf, keepChip, groupPosts, postView, bodyText, isFresh, sourceState, feedWhen} from './outside-statements-model.mjs';
import {viewPrefs} from './view-prefs.js';
import {mountSplitResize} from './split-resize.js';
import {hasNewsItem} from './news-request.mjs';
import {itemView} from './news-clipping-model.mjs';
import {NOW_TABS, keepNowTab, nowTabAt, itemKey, interestHit, dateText} from './now-model.mjs';
import {createNowDetail} from './now-detail.js';
import {createNowSaved} from './now-saved.js';
import {createNowInterests} from './now-interests.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {readOutsideMarks} from './now-marks.js';
// OUTSIDE-바깥성명 ④ 화면 1(설계 docs/design/outside-statements.md 4절, 12:43 시안): '바깥 성명' 화면(?view=outside). #outsideView의 유일한 그리기 주인.
// - [새로 온 것]: 칩 첫 줄(전체·묶음, 공용 chip-rows.js) + 묶음을 고르면 둘째 줄(그 묶음 단체) → 날짜 묶음 → 글마다 '단체 · 종류 · 시각' / 제목 / 한 문장 요약(늘 보임)
//   / 본문 접기(<details>, 국내는 펼칠 때 서버 문장 표에서 읽음, 외국은 한국어 요약 + 핵심 문장) / 작은 [원문](그 단체 페이지, 새 창).
//   2년 지난 글은 제목·요약만(설계 2절, Q7).
// - ⋯ → [단체 켜고 끄기]: 카탈로그(서버 outside-feed ?action=catalog) 단체마다 켬/끔 + 마지막으로 읽은 시각·실패 표시.
//   켬/끔은 서버 표 app_outside_sources에만 저장(기기 저장 없음). 폰·PC 모두 같은 화면 안 한 칸이고 뒤로가기 한 번 = 목록(KPTURouter.layer).
// - 들어오면 지난번 본 시각(app_outside_seen)을 읽어 그 뒤 받은 글에 작은 '새' 표시를 하고, 지금 시각으로 바꿔 둔다(서버 저장).
// - ⋯ → [지금 채우기]: 켠 단체를 바로 읽기(readNow)로 하나씩 한 번 읽는다(NEWS-클리핑 C1).
// - 탭 [새로 온 것]·[문장 찾기](S48-18): 탭 줄과 탭 상태는 이 모듈이 갖고(이 탭 메모리만), [문장 찾기] 칸 안은 outside-search.js가 그린다.
//   폰은 좌우 밀기로 탭 이동. 글은 서버 수집기만 넣는다(화면은 읽기·켜고 끄기·본 시각만 쓴다).
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 글 제목·본문을 남기지 않는다.
// OUTSIDE-글상세·관심환류 ③④(설계 12절, 명진 결정 11/01 23:16): 이 모듈이 'Now' 메뉴 껍데기다. 탭 [사회운동] [뉴스] [보관] [문장 찾기]와
//   목록 | 상세 두 칸(PC·폴드 펼침, 폭 끌기 서버 기억 split_ratio.now), 폰은 상세가 전체 화면(뒤로가기 = 목록, KPTURouter.layer)을 갖는다.
//   탭 상태는 이 모듈 하나(마지막 탭 서버 기억 view_prefs.now_tab). 각 탭 칸 안은 그 모듈이 그린다: [사회운동] 이 모듈, [뉴스] news-clipping.js,
//   [보관] now-saved.js, [문장 찾기] outside-search.js. 상세 칸은 now-detail.js 하나가 두 쪽 모두 그린다. 관심 주제 칸은 now-interests.js.
//   글 줄 전체가 눌린다(제목 단추가 줄을 덮음, Enter·터치). [원문 ↗]은 상세 위로 옮겼다.

(() => {
if (window.KPTUOutside) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body';
const SOURCE_COLS = 'source_key,enabled,last_ok_at,last_error';

const TABS_HTML = NOW_TABS.map((t, i) => `<button type="button" role="tab" id="osTab-${t.id}" data-os-tab="${t.id}" aria-selected="${i === 0}" aria-controls="${{outside: 'osPanelNew', news: 'nowPanelNews', saved: 'nowPanelSaved', search: 'osPanelSearch'}[t.id]}"${i ? ' tabindex="-1"' : ''}>${t.label}</button>`).join('');
function install() {
  if (document.getElementById('outsideView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="outsideView" class="view-panel hidden" aria-labelledby="osTitle">
<h2 id="osTitle" class="screen-title">Now</h2>
<div id="outsideRoot" class="os now" data-mode="list" data-tab="outside" data-detail="closed">
<div class="os-tabs" role="tablist" aria-label="Now 보기" data-os-tabs>${TABS_HTML}</div>
<div class="now-main" id="nowMain">
<p class="now-cand" data-now-cand hidden></p>
<div id="osPanelNew" role="tabpanel" aria-labelledby="osTab-outside" data-os-panel-new>
<p class="os-when" data-os-when hidden></p>
<div class="os-bar"><div class="os-chips" data-os-chips role="group" aria-label="묶음 거르기"></div><button type="button" class="os-more" data-os-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="사회운동 Now 메뉴">${MORE}</button></div>
<div class="os-chips os-subchips" data-os-subchips role="group" aria-label="단체 거르기" hidden></div>
<div class="os-list" data-os-list aria-label="새로 온 글"></div>
<div class="os-sources" data-os-sources aria-label="단체 켜고 끄기"></div>
</div>
<div id="nowPanelNews" role="tabpanel" aria-labelledby="osTab-news" data-now-panel-news hidden></div>
<div id="nowPanelSaved" class="now-saved" role="tabpanel" aria-labelledby="osTab-saved" data-now-panel-saved hidden></div>
<div id="osPanelSearch" class="osq" role="tabpanel" aria-labelledby="osTab-search" data-os-search hidden></div>
<div class="now-interests" data-now-interests hidden><div class="os-src-head"><button type="button" class="os-back" data-now-interests-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>관심 주제</b></div><div data-now-interests-box></div></div>
</div>
<div class="now-detail" id="nowDetail" data-now-detail aria-label="글 상세"></div>
</div></section>`);
}
install();

const root = document.getElementById('outsideRoot');
const $ = sel => root?.querySelector(sel);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const fresh = () => ({scope: '', catalog: null, catalogFailed: false, sources: new Map(), sourcesLoaded: false, sourcesFailed: false,
  posts: [], postsLoaded: false, postsFailed: false, end: true, more: false, seenAt: null, seenRead: false, chip: ALL,
  open: new Set(), bodies: new Map(), saving: new Set(), saveFailed: '', mode: 'list', reading: new Set(), readNote: new Map(), tab: '', tabSet: false, marks: new Map()});
let state = fresh(), loadSeq = 0, layer = null;

// ---------- 서버 읽기·쓰기(모두 작업공간 소유자 RLS · Edge는 사용자 로그인 확인) ----------
const q = v => encodeURIComponent(v);
async function readCatalog() {
  const data = await rt().api('/functions/v1/outside-feed?action=catalog', {method: 'POST', body: {}, singleFlight: false, timeoutMs: 20000});
  return normalizeCatalog(data);
}
// 뉴스 클리핑 매체(news- 키)는 같은 표에 있지만 이 화면 것이 아니다 → 서버에서 빼고 읽는다(화면 계산도 ownSourceRows로 한 번 더).
const readSources = w => rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=not.like.news-*&select=${SOURCE_COLS}`, {singleFlight: false});
const readSeen = w => rt().api(`/rest/v1/app_outside_seen?workspace_id=eq.${q(w)}&select=seen_at&limit=1`, {singleFlight: false});
function readPosts(w, keys, offset) {
  if (keys && !keys.length) return Promise.resolve([]);
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return rt().api(`/rest/v1/app_outside_posts?workspace_id=eq.${q(w)}${filter}&select=${POST_COLS}&order=published_at.desc.nullslast,fetched_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`, {singleFlight: false});
}
const readBody = (w, id) => rt().api(`/rest/v1/app_outside_sentences?post_id=eq.${q(id)}&workspace_id=eq.${q(w)}&select=idx,text&order=idx.asc&limit=3001`, {singleFlight: false});
// 바로 읽기(OUTSIDE-이름·바로읽기): 켠 단체 하나를 서버가 지금 한 번 읽는다(사용자 로그인·owner·켬 확인·하루 횟수는 서버).
const readNowApi = key => rt().api('/functions/v1/outside-feed?action=read_now', {method: 'POST', body: {source: key}, singleFlight: false, timeoutMs: 120000});
// 본 시각: 줄이 있으면 고치고, 없으면 넣는다(화면 권한은 넣기 workspace_id·seen_at, 고치기 seen_at·updated_at뿐).
async function writeSeen(w, at) {
  const rows = await rt().api(`/rest/v1/app_outside_seen?workspace_id=eq.${q(w)}&select=seen_at`, {method: 'PATCH', body: {seen_at: at, updated_at: at}, prefer: 'return=representation', singleFlight: false});
  if (Array.isArray(rows) && rows.length) return;
  await rt().api('/rest/v1/app_outside_seen', {method: 'POST', body: {workspace_id: w, seen_at: at}, prefer: 'return=minimal', singleFlight: false});
}
// 켜고 끄기: 줄이 있으면 enabled만 고치고, 없으면 새 줄(켬)을 넣는다.
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
const catalogOf = key => state.catalog?.find(s => s.key === key) || null;
const nameOf = key => catalogOf(key)?.name || key;
const enabledNow = () => enabledKeys([...state.sources.values()]);
const search = createOutsideSearch({box: $('[data-os-search]'), nameOf, workspaceOf,
  chipsOf: () => chipsOf(state.catalog || [], enabledNow()), keysOf: chip => keysOf(chip, state.catalog || [], enabledNow())});

// ---------- 상세·보관·관심 주제(공용 부품, 각 칸의 그리기 주인) ----------
const PC = window.matchMedia('(min-width:761px)');
const mainBox = root?.querySelector('#nowMain'), detailBox = root?.querySelector('[data-now-detail]');
// 글 하나 → 상세 머리(꼬리 줄·제목·원문). 사회운동 글과 뉴스 기사 두 쪽 모두 여기서(보관 탭·함께 볼 것도 같은 길).
function describe(type, row) {
  if (type === 'news') {
    const v = itemView(row || {});
    return {meta: [v.publisher, v.foreign ? '외국' : '국내', '기사', dateText(row?.published_at || row?.created_at)], title: v.title, origTitle: v.origTitle, titleLang: v.titleLang, lang: row?.lang || 'ko', url: v.url, lead: v.summary};
  }
  const v = postView(row || {});
  return {meta: [nameOf(row?.source_key), row?.lang === 'en' ? '외국' : '국내', v.kind, dateText(row?.published_at)], title: v.title, origTitle: v.origTitle, titleLang: row?.lang === 'en' && !row?.title_ko ? 'en' : '', lang: row?.lang || 'ko', url: v.url, lead: v.lead};
}
let detailLayer = null, interestsLayer = null, interestsAsk = 0;
const detail = createNowDetail({box: detailBox, topics: () => interests.topics(),
  onClose: () => closeDetail(),
  onChanged: (item, act) => {
    // 뉴스 별표·관심 없음은 뉴스 목록 줄과 같은 칸이라 그 목록을 다시 읽는다. 보관 탭은 늘 다시.
    if (item.type === 'news' && act !== 'memo') window.KPTUNews?.refresh?.();
    if (item.type === 'outside' && act !== 'memo' && act !== 'star') loadMarks().then(() => { if (state.mode === 'list' && state.tab === 'outside') paintList(); });
    if (state.tab === 'saved') saved.load();
  },
  onSignal: () => askInterests(),
  onRead: (item, row) => { const c = detail.current(); if (c && itemKey(c) === itemKey(item)) detail.setHead(describe('news', row)); window.KPTUNews?.refresh?.(); },
  onRelated: r => openRelated(r)});
const saved = createNowSaved({box: root?.querySelector('[data-now-panel-saved]'), describe, topics: () => interests.topics(),
  onOpen: (item, head) => openDetail(item, head), selected: () => { const c = detail.current(); return c ? itemKey(c) : ''; }, onListed: () => autoOpenTop(),
  onChanged: item => { if (item.type === 'news') window.KPTUNews?.refresh?.(); else loadMarks().then(() => { if (state.mode === 'list' && state.tab === 'outside') paintList(); }); }});
const interests = createNowInterests({box: root?.querySelector('[data-now-interests-box]'), onChanged: () => { paintCand(); if (state.mode === 'list' && state.tab === 'outside') paintList(); detail.paint(); }});
// 환류 기록이 쌓이면 서버가 후보를 만들지 정한다(10건 또는 저녁 6시 뒤 그날 처음 — 서버 규칙, AI를 안 부르면 한도도 안 씀). 화면은 1분에 한 번만 묻는다.
function askInterests() {
  if (Date.now() - interestsAsk < 60000) return;
  interestsAsk = Date.now();
  rt().api('/functions/v1/ai-assist', {method: 'POST', body: {kind: 'now_interests'}, singleFlight: false, timeoutMs: 60000})
    .then(r => { if (r?.added) interests.load(); }).catch(() => {});
}
function openDetail(item, head) {
  if (!item || !head) return;
  detail.open(item, head);
  if (root) root.dataset.detail = 'open';
  mountSplit();
  // 폰(좁은 화면): 상세가 전체 화면 — 뒤로가기 한 번 = 목록(라우터 겹). PC·폴드 펼침은 오른쪽 칸이라 겹 없음.
  if (!PC.matches) { detailLayer ||= window.KPTURouter?.layer?.open('now-detail', {reopen: () => openDetail(item, head), close: () => { detailLayer = null; closeDetail({fromLayer: true}); return true; }}) || null; window.scrollTo({top: 0, behavior: 'instant'}); }
  markOpen();
}
function closeDetail({fromLayer = false} = {}) {
  const was = detail.current();
  detail.close();
  if (root) root.dataset.detail = 'closed';
  mountSplit();
  if (!fromLayer) { const l = detailLayer; detailLayer = null; l?.close(); }
  markOpen();
  if (was) root?.querySelector(`[data-now-open="${CSS.escape(was.id)}"], [data-nc-open="${CSS.escape(was.id)}"], [data-ns-open="${CSS.escape(itemKey(was))}"]`)?.focus({preventScroll: true});
}
// 고른 줄 표시(PC 두 칸에서 어느 글이 열렸는지). 줄만 고친다(다시 그리지 않음).
function markOpen() {
  const c = detail.current(), key = c ? itemKey(c) : '';
  root?.querySelectorAll('.now-row').forEach(el => {
    const k = el.dataset.osPost ? `outside:${el.dataset.osPost}` : el.dataset.ncItem ? `news:${el.dataset.ncItem}` : el.dataset.nsRow || '';
    el.classList.toggle('is-open', !!key && k === key);
  });
}
async function openRelated(r) {
  if (r.kind === 'outside' || r.kind === 'news') {
    const w = workspaceOf();
    try {
      const rows = r.kind === 'news'
        ? await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(r.id)}&select=id,lane,url,title,lang,publisher,published_at,created_at,summary,title_ko&limit=1`, {singleFlight: false})
        : await rt().api(`/rest/v1/app_outside_posts?workspace_id=eq.${q(w)}&id=eq.${q(r.id)}&select=${POST_COLS}&limit=1`, {singleFlight: false});
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) openDetail({type: r.kind, id: row.id}, describe(r.kind, row));
    } catch { /* 못 읽으면 그대로 */ }
    return;
  }
  const view = {update: 'home', ledger: 'ledger', library: 'library'}[r.kind];
  if (view) window.KPTURouter?.go?.(view, {source: 'delegated'});
}
function mountSplit() {
  if (!root) return;
  mountSplitResize({container: root, name: 'now', label: '목록과 상세 칸 폭 조절', columns: [
    {el: () => mainBox, varName: '--ds-split-list', minVar: '--ds-split-list-min', minFallback: 320, share: 3, id: 'nowMain'},
    {el: () => detailBox, varName: '--ds-split-detail', minVar: '--ds-split-detail-min', minFallback: 320, share: 2},
  ], active: () => PC.matches && root.dataset.detail === 'open' && root.isConnected && !document.getElementById('outsideView')?.classList.contains('hidden')});
}

// ---------- 관심 주제 칸(같은 화면 안, 뒤로가기 한 번 = 목록) ----------
function openInterests() {
  if (state.mode === 'sources') { closeLayer(); state.mode = 'list'; }
  state.mode = 'interests';
  interestsLayer ||= window.KPTURouter?.layer?.open('now-interests', {reopen: () => openInterests(), close: () => { interestsLayer = null; backFromInterests(); return true; }}) || null;
  paint();
  interests.paint();
  interests.load();
  $('[data-now-interests-back]')?.focus({preventScroll: true});
}
function backFromInterests() {
  if (state.mode !== 'interests') return;
  state.mode = 'list';
  paint();
  root?.querySelector(`[data-os-tab="${state.tab || 'outside'}"]`)?.focus({preventScroll: true});
}

function chipsHtml(chips) {
  return chips.map(c => `<button type="button" class="os-chip" data-os-chip="${esc(c.id)}" aria-pressed="${chipPressed(c.id, state.chip, state.catalog)}">${esc(c.label)}</button>`).join('');
}

function bodyHtml(p, v) {
  if (v.body === 'foreign') {
    return `${v.origTitle ? `<p class="os-orig" lang="en">${esc(v.origTitle)}</p>` : ''}${v.summary ? `<p class="os-sum-full">${esc(v.summary)}</p>` : ''}${v.keys.length ? `<ul class="os-keys" aria-label="핵심 문장">${v.keys.map(k => `<li><span class="os-key-ko">${esc(k.ko)}</span><span class="os-key-orig" lang="en">${esc(k.orig)}</span></li>`).join('')}</ul>` : ''}`;
  }
  const b = state.bodies.get(p.id);
  if (!b || b.loading) return waitHtml({rows: 3});
  if (b.failed) return failHtml({retry: 'data-os-body-retry'});
  return b.text ? `<p class="os-text">${esc(b.text)}</p>` : emptyHtml('본문 없음');
}

function postHtml(p, now) {
  const v = postView(p, now);
  const isNew = state.seenRead && isFresh(p, state.seenAt);
  const meta = `<p class="os-meta">${isNew ? '<span class="os-new" aria-label="새 글">새</span>' : ''}<span class="os-src">${esc(nameOf(p.source_key))}</span>${v.tag ? `<span class="os-tag">${esc(v.tag)}</span>` : ''}${v.kind ? `<span>${esc(v.kind)}</span>` : ''}${v.time ? `<span class="os-time">${esc(v.time)}</span>` : ''}</p>`;
  const lead = v.lead ? `<p class="os-lead">${esc(v.lead)}</p>` : '';
  const open = v.body && state.open.has(p.id);
  const body = v.body ? `<details class="os-fold" data-os-fold="${esc(p.id)}"${open ? ' open' : ''}><summary>${v.body === 'foreign' ? '요약·핵심 문장' : '본문'}</summary><div class="os-body" data-os-body="${esc(p.id)}">${open ? bodyHtml(p, v) : ''}</div></details>` : '';
  // 확정 관심 주제에 걸린 글만 줄 끝 작은 표시(12.2 결정 ②, 순서는 시간순 그대로).
  const hit = interestHit([v.title, v.origTitle, v.summary], interests.topics());
  const sel = detail.current(), on = sel && itemKey(sel) === `outside:${p.id}`;
  return `<article class="os-post now-row${p.lang === 'en' ? ' is-foreign' : ''}${on ? ' is-open' : ''}" data-os-post="${esc(p.id)}">${meta}<h4 class="os-title"${p.lang === 'en' && !p.title_ko ? ' lang="en"' : ''}><button type="button" class="now-open" data-now-open="${esc(p.id)}">${esc(v.title)}</button></h4>${lead}${body || hit ? `<div class="os-foot">${body}${hit ? `<span class="now-hit">${esc(hit)}</span>` : ''}</div>` : ''}${hoverActsHtml({isSaved: markOf(p.id).archived})}</article>`;
}

function listHtml() {
  if (!state.postsLoaded) return state.postsFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6, h: 64});
  if (!state.posts.length) {
    if (!state.sourcesLoaded) return emptyHtml();
    if (!enabledNow().length) return `${emptyHtml('켠 단체 없음', {attrs: 'data-os-empty="none"'})}<button type="button" class="os-text-btn" data-os-open-sources>단체 켜고 끄기</button>`;
    return emptyHtml('새 글 없음', {attrs: 'data-os-empty="posts"'});
  }
  const now = Date.now(), shown = state.posts.filter(p => !markOf(p.id).dismissed);
  if (!shown.length) return `${emptyHtml('새 글 없음', {attrs: 'data-os-empty="posts"'})}${state.end ? '' : '<button type="button" class="os-text-btn os-more-posts" data-os-more-posts>더 보기</button>'}`;
  const days = groupPosts(shown, now).map(g => `<section class="os-day" aria-label="${esc(g.label)}"><h3 class="os-day-head">${esc(g.label)}</h3>${g.items.map(p => postHtml(p, now)).join('')}</section>`).join('');
  const more = state.end ? '' : `<button type="button" class="os-text-btn os-more-posts" data-os-more-posts${state.more ? ' disabled aria-busy="true"' : ''}>더 보기</button>`;
  return days + more;
}

function sourcesHtml() {
  const head = `<div class="os-src-head"><button type="button" class="os-back" data-os-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>단체 켜고 끄기</b><span class="os-faint" data-os-on-count>${state.catalog ? `켬 ${enabledNow().length}` : ''}</span></div>`;
  if (!state.catalog) return head + (state.catalogFailed || state.sourcesFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6}));
  if (!state.sourcesLoaded) return head + (state.sourcesFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6}));
  const groups = GROUPS.map(g => {
    const members = state.catalog.filter(s => s.group === g.key);
    if (!members.length) return '';
    return `<section class="os-src-group" aria-label="${esc(g.label)}"><h3 class="os-src-group-head">${esc(g.label)}</h3>${members.map(s => {
      const row = state.sources.get(s.key), on = row?.enabled === true, busy = state.saving.has(s.key);
      const reading = state.reading.has(s.key), note = reading ? '' : state.readNote.get(s.key) || sourceState(row);
      const bad = row?.last_error ? ' is-bad' : '';
      return `<div class="os-src-row"><button type="button" class="os-switch" role="switch" data-os-source="${esc(s.key)}" aria-checked="${on}"${busy ? ' disabled' : ''}><span class="os-switch-dot" aria-hidden="true"></span><span class="os-src-name">${esc(s.name)}</span></button>${reading ? `<span class="os-src-note" data-os-reading>${waitInlineHtml()}</span>` : note ? `<span class="os-src-note${bad}">${esc(note)}</span>` : ''}</div>`;
    }).join('')}</section>`;
  }).join('');
  return head + (state.saveFailed ? failHtml({text: '저장하지 못했습니다', reason: state.saveFailed}) : '') + groups;
}

// 탭 줄과 두 칸 보이기(단체 켜고 끄기 칸에서는 탭 줄을 감춘다). [문장 찾기] 칸 안은 outside-search.js가 그린다.
function paintTabs() {
  if (!root) return;
  const tab = state.tab || 'outside';
  root.dataset.tab = tab;
  const list = state.mode === 'list';
  const tabs = $('[data-os-tabs]'), panelNew = $('[data-os-panel-new]'), panelSearch = $('[data-os-search]');
  if (tabs) tabs.hidden = !list;
  root.querySelectorAll('[data-os-tab]').forEach(b => { const on = b.dataset.osTab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  // 단체 켜고 끄기 칸은 [사회운동] 칸 안이다.
  if (panelNew) panelNew.hidden = !(state.mode === 'sources' || (list && tab === 'outside'));
  if (panelSearch) panelSearch.hidden = !(list && tab === 'search');
  const news = $('[data-now-panel-news]'), saved = $('[data-now-panel-saved]'), intr = $('[data-now-interests]');
  if (news) news.hidden = !(list && tab === 'news');
  if (saved) saved.hidden = !(list && tab === 'saved');
  if (intr) intr.hidden = state.mode !== 'interests';
  paintCand();
}
// 관심 주제 후보가 있으면 목록 위 한 줄 '관심 주제 후보 n [보기]'(12.6).
function paintCand() {
  const line = $('[data-now-cand]');
  if (!line) return;
  const n = state.mode === 'list' ? interests.candidates() : 0;
  line.hidden = !n;
  line.innerHTML = n ? `<span>관심 주제 후보 ${n}</span><button type="button" class="os-text-btn" data-now-interests-open>보기</button>` : '';
}
// 탭 하나 보이기. save=true면 서버에 마지막 탭으로 기억(view_prefs.now_tab). [뉴스]·[보관]은 처음 보일 때 그 칸 주인이 불러온다.
function setTab(tab, {focus = false, save = true} = {}) {
  tab = keepNowTab(tab);
  const changed = state.tab !== tab;
  state.tab = tab; state.tabSet = true;
  paintTabs();
  if (changed && tab === 'search') { if (detail.current() && PC.matches) closeDetail(); search.paint(); }
  if (changed && tab === 'news') window.KPTUNews?.enter?.();
  if (changed && tab === 'saved') { saved.paint(); saved.load(); }
  if (save && viewPrefs.get('now_tab') !== tab) { viewPrefs.set('now_tab', tab, {rejectable: true}); void viewPrefs.flush?.(); }
  if (focus) root?.querySelector(`[data-os-tab="${tab}"]`)?.focus({preventScroll: true});
  autoOpenTop();
}

function paint() {
  if (!root) return;
  root.dataset.mode = state.mode;
  paintTabs();
  const chips = chipsOf(state.catalog || [], enabledNow());
  state.chip = keepChip(state.chip, [...chips, ...subChipsOf(state.catalog || [], enabledNow(), state.chip)]);
  const subs = subChipsOf(state.catalog || [], enabledNow(), state.chip);
  const bar = $('[data-os-chips]');
  if (bar) {
    // 칩 줄은 [전체] 하나뿐이면 감춘다(켠 단체가 없을 때).
    const html = chips.length > 1 ? chipsHtml(chips) : '';
    const toggle = bar.querySelector(':scope > [data-chip-rows-more]');
    [...bar.children].forEach(el => { if (el !== toggle) el.remove(); });
    bar.insertAdjacentHTML('afterbegin', html);
    bar.hidden = chips.length <= 1;
    if (!bar.hidden) fitChipRows(bar, {key: 'outside', keep: el => el.dataset.osChip === ALL || el.getAttribute('aria-pressed') === 'true'});
  }
  // 둘째 줄: 고른 묶음의 단체 낱개(묶음에 켠 단체가 둘 이상일 때만, 목록 칸에서만).
  const sub = $('[data-os-subchips]');
  if (sub) {
    const show = state.mode === 'list' && chips.length > 1 && subs.length > 0;
    sub.innerHTML = show ? chipsHtml(subs) : '';
    sub.hidden = !show;
  }
  // 위쪽 작은 줄: 마지막으로 읽은 시각 · 다음 읽기(켠 단체가 있을 때만, 목록 칸에서만).
  const when = $('[data-os-when]');
  if (when) {
    const reading = [...state.reading].map(nameOf).join(', ');
    // 바로 읽는 동안은 단체 이름 + 공용 작은 기다림 표시(wait-state.js), 아니면 마지막·다음 읽기 글.
    const text = state.mode !== 'list' || reading ? '' : state.sourcesLoaded ? feedWhen([...state.sources.values()]) : '';
    if (state.mode === 'list' && reading) when.innerHTML = `<span class="os-reading">${esc(reading)}</span> ${waitInlineHtml()}`;
    else when.textContent = text;
    when.hidden = !(text || (state.mode === 'list' && reading));
  }
  const list = $('[data-os-list]'), sources = $('[data-os-sources]');
  if (state.mode === 'sources') { sources.innerHTML = sourcesHtml(); list.replaceChildren(); }
  else { list.innerHTML = state.mode === 'list' ? listHtml() : ''; sources.replaceChildren(); }
  mountSplit();
}
function paintList() { const list = $('[data-os-list]'); if (list && state.mode === 'list') { list.innerHTML = listHtml(); autoOpenTop(); } }
// UI-Now PC정돈(명진 11/03 09:39): PC·폴드 펼침에서 상세 칸이 비어 안내문만 있지 않게 — 목록이 보이면 맨 위 글을 바로 연다(탭마다 이 화면에 들어온 뒤 한 번,
// 닫으면 다시 열지 않음). 글이 없는 탭([문장 찾기]·빈 목록)은 상세 칸을 열지 않고 목록이 폭을 쓴다(CSS가 data-detail="closed"일 때 한 칸).
const autoOpened = new Set();
function autoOpenTop() {
  if (!PC.matches || state.mode !== 'list' || detail.current() || autoOpened.has(state.tab)) return;
  const sel = {outside: '[data-os-list] .now-open', news: '[data-nc-list] .now-open', saved: '.now-saved-list .now-open'}[state.tab];
  const btn = sel && root?.querySelector(sel);
  if (!btn) return;
  autoOpened.add(state.tab); btn.click();
}
// 펼친 본문 한 칸만 다시 그린다(같은 그리기 함수, 다른 글의 펼침·스크롤은 그대로).
function paintBody(id) {
  const p = state.posts.find(x => x.id === id), box = root?.querySelector(`[data-os-body="${CSS.escape(id)}"]`);
  if (p && box) box.innerHTML = bodyHtml(p, postView(p));
}

// ---------- 불러오기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  closeLayer();
  state = fresh(); state.scope = scope;
  search.reset();
  detail.reset(); saved.reset(); interests.reset();
  if (root) root.dataset.detail = 'closed';
}

// 숨기거나 보관한 사회운동 글 표시(줄 밀기·상세 단추가 같은 서버 표시를 쓴다). 숨긴 글은 목록에서 감추고, 보관한 글은 오른쪽 밀기가 '보관 풀기'가 된다.
async function loadMarks() {
  const scope = state.scope;
  try {
    const rows = await readOutsideMarks();
    if (scope !== state.scope || !Array.isArray(rows)) return;
    state.marks = new Map(rows.map(r => [r.post_id, {archived: !!r.archived_at, dismissed: !!r.dismissed_at}]));
  } catch { /* 표시를 못 읽으면 목록은 그대로 */ }
}
const markOf = id => state.marks.get(id) || {archived: false, dismissed: false};
async function loadPosts({append = false, keep = false} = {}) {
  const w = workspaceOf(), seq = ++loadSeq;
  if (!w) return;
  const keys = keysOf(state.chip, state.catalog || [], enabledNow());
  if (append) { state.more = true; paint(); }
  else { state.postsFailed = false; if (!keep || !state.postsLoaded) { state.postsLoaded = false; state.posts = []; } paint(); }
  try {
    if (!append) await loadMarks();
    const rows = await readPosts(w, keys, append ? state.posts.length : 0);
    if (seq !== loadSeq) return;
    const got = Array.isArray(rows) ? rows : [];
    const page = got.slice(0, PAGE_SIZE);
    state.posts = append ? [...state.posts, ...page.filter(p => !state.posts.some(x => x.id === p.id))] : page;
    state.end = got.length <= PAGE_SIZE;
    state.postsLoaded = true;
  } catch {
    if (seq !== loadSeq) return;
    if (!append) state.postsFailed = true;
  } finally {
    if (seq === loadSeq) { state.more = false; paint(); }
  }
}

let entering = null;
async function load() {
  const w = workspaceOf();
  if (!w) return;
  const scope = state.scope;
  const [catalog, sources, seen] = await Promise.allSettled([
    state.catalog ? Promise.resolve(state.catalog) : readCatalog(),
    readSources(w),
    state.seenRead ? Promise.resolve(null) : readSeen(w),
  ]);
  if (scope !== state.scope) return;
  if (catalog.status === 'fulfilled') { state.catalog = catalog.value; state.catalogFailed = false; } else state.catalogFailed = true;
  if (sources.status === 'fulfilled' && Array.isArray(sources.value)) {
    state.sources = new Map(ownSourceRows(sources.value).map(r => [r.source_key, r]));
    state.sourcesLoaded = true; state.sourcesFailed = false;
  } else if (!state.sourcesLoaded) state.sourcesFailed = true;
  if (!state.seenRead && seen.status === 'fulfilled') {
    state.seenAt = Array.isArray(seen.value) ? seen.value[0]?.seen_at || null : null;
    state.seenRead = true;
    // 지금 본 것으로 둔다(새 표시는 이번에 연 동안 그대로 남는다). 실패해도 화면은 그대로.
    writeSeen(w, new Date().toISOString()).catch(() => {});
  }
  if (state.tab === 'search') search.paint(); // 단체 칩(카탈로그·켠 단체)이 늦게 오면 거르기 줄을 다시
  await loadPosts({keep: true});
}
function enter() {
  resetIfOwnerChanged();
  // 처음 들어올 때 탭: 노트 [기사로 가기]·옛 ?view=news 주소면 [뉴스], 아니면 서버에 기억한 마지막 탭(없으면 사회운동).
  const entry = window.KPTURouter?.takeEntry?.('outside');
  if (hasNewsItem() || entry?.tab === 'news') { state.tab = ''; setTab('news', {save: false}); }
  else if (!state.tabSet) {
    setTab(keepNowTab(viewPrefs.get('now_tab')), {save: false});
    // 화면 기억을 아직 서버에서 못 읽었으면(첫 로딩) 읽은 뒤 한 번 더 — 그사이 사용자가 탭을 고르면 그대로 둔다.
    if (viewPrefs.status?.() !== 'ok') state.tabSet = false;
  }
  // 다시 들어온 때도 보이는 탭 칸을 새로 읽는다([뉴스]는 그 모듈이, [보관]은 이 화면이).
  else if (state.tab === 'news') window.KPTUNews?.enter?.();
  else if (state.tab === 'saved') saved.load();
  if (!interests.loaded()) interests.load().then(() => { if (state.mode === 'list') paintList(); });
  askInterests();
  paint();
  entering ||= load().catch(() => {}).finally(() => { entering = null; });
  return entering;
}

// ---------- 단체 켜고 끄기 칸(같은 화면 안, 뒤로가기 한 번 = 목록) ----------
function openSources() {
  state.mode = 'sources'; state.saveFailed = '';
  layer ||= window.KPTURouter?.layer?.open('outside-sources', {reopen: () => openSources(), close: () => { layer = null; backToList(); return true; }}) || null;
  paint();
  window.scrollTo({top: 0, behavior: 'instant'});
  $('[data-os-back]')?.focus({preventScroll: true});
  if (!state.catalog || !state.sourcesLoaded) load().catch(() => {});
}
let listDirty = false;
function backToList() {
  if (state.mode !== 'sources') return;
  state.mode = 'list'; state.saveFailed = '';
  paint();
  $('[data-os-more]')?.focus({preventScroll: true});
  if (listDirty) { listDirty = false; loadPosts(); }
}
function closeLayer() { const l = layer; layer = null; l?.close(); }

async function toggleSource(key) {
  const w = workspaceOf();
  if (!w || state.saving.has(key) || !catalogOf(key)) return;
  const next = state.sources.get(key)?.enabled !== true;
  state.saving.add(key); state.saveFailed = ''; paint();
  try {
    const row = await writeSource(w, key, next);
    state.sources.set(key, row);
    listDirty = true;
    state.readNote.delete(key);
    if (next) readNow(key);
  } catch (e) {
    state.saveFailed = e?.status ? `HTTP ${e.status}` : '';
    if (!state.saveFailed) state.saveFailed = '잠시 뒤 다시';
  } finally {
    state.saving.delete(key);
    paint();
    root?.querySelector(`[data-os-source="${CSS.escape(key)}"]`)?.focus({preventScroll: true});
  }
}

// 켜면 그 단체만 바로 한 번 읽는다. 기다리는 동안 공용 작은 기다림 표시, 끝나면 단체 줄(마지막 읽은 시각)과 목록을 다시 읽는다.
// 실패해도 켬은 그대로이고 다음 예약 실행이 읽는다.
async function readNow(key) {
  if (state.reading.has(key)) return;
  const scope = state.scope;
  state.reading.add(key); paint();
  let note = '';
  try {
    const r = await readNowApi(key);
    // 공공운수노조는 하루 3번 예약 때만 읽는다(서버가 바로 읽기를 하지 않음, 명진 결정 11/01 16:49).
    if (r?.status === 'scheduled_only') note = '예약 때 읽음';
  } catch (e) {
    note = e?.status === 429 ? '오늘 바로 읽기를 다 씀 · 예약 때 읽음' : '바로 읽기 실패 · 예약 때 읽음';
  }
  if (scope !== state.scope) return;
  state.reading.delete(key);
  if (note) state.readNote.set(key, note);
  const w = workspaceOf();
  try {
    const rows = w ? await readSources(w) : null;
    if (scope !== state.scope) return;
    if (Array.isArray(rows)) state.sources = new Map(ownSourceRows(rows).map(r => [r.source_key, r]));
  } catch { /* 단체 줄은 그대로 */ }
  if (scope !== state.scope) return;
  if (state.mode === 'list') { listDirty = false; loadPosts({keep: true}); } else { listDirty = true; paint(); }
}

// [지금 채우기](NEWS-클리핑 C1, 명진 11/01 22:34): 켠 단체를 하나씩 바로 읽는다. 읽는 일은 켤 때와 같은 readNow(서버 read_now)이고
// 마지막으로 읽은 지 얼마 안 된 단체·하루 횟수는 서버가 거른다(새 읽기 길을 만들지 않음).
let filling = false;
async function fillNow() {
  if (filling) return;
  const scope = state.scope;
  filling = true;
  try {
    if (!state.sourcesLoaded) await load().catch(() => {});
    for (const key of enabledNow().filter(k => catalogOf(k))) { // news- 키(뉴스 클리핑 매체)는 같은 표에 있지만 이 화면 단체가 아님
      if (scope !== state.scope) break;
      await readNow(key);
    }
  } finally { filling = false; }
}

// ---------- 누르기 ----------
const menu = createAnchoredMenu({id: 'osMenu', className: 'topline-add-menu os-menu', label: '사회운동 메뉴', historyKey: 'kptuOutsideMenu', key: () => 'head',
  render: () => `<button type="button" data-os-act="fill"${filling ? ' disabled' : ''}>지금 채우기</button><button type="button" data-os-act="sources">단체 켜고 끄기</button><button type="button" data-os-act="interests">관심 주제</button>`,
  onAction: button => { const a = button.dataset.osAct; if (a === 'sources') openSources(); else if (a === 'fill') fillNow(); else if (a === 'interests') openInterests(); }});

root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-os-tab]')) { setTab(b.dataset.osTab); return; }
  if (b.matches('[data-now-open]')) { const p = state.posts.find(x => x.id === b.dataset.nowOpen); if (p) openDetail({type: 'outside', id: p.id}, describe('outside', p)); return; }
  if (b.matches('[data-now-interests-open]')) { openInterests(); return; }
  if (b.matches('[data-now-interests-back]')) { const l = interestsLayer; interestsLayer = null; l?.close(); backFromInterests(); return; }
  if (b.matches('[data-os-chip]')) {
    if (state.chip === b.dataset.osChip) return;
    state.chip = b.dataset.osChip; state.open.clear();
    loadPosts();
    return;
  }
  if (b.matches('[data-os-more]')) { menu.open(b); return; }
  if (b.matches('[data-os-open-sources]')) { openSources(); return; }
  if (b.matches('[data-os-back]')) { closeLayer(); backToList(); return; }
  if (b.matches('[data-os-source]')) { toggleSource(b.dataset.osSource); return; }
  if (b.matches('[data-os-more-posts]')) { loadPosts({append: true}); return; }
  if (b.matches('[data-os-retry]')) { load().catch(() => {}); paint(); return; }
  if (b.matches('[data-os-body-retry]')) { const id = b.closest('[data-os-body]')?.dataset.osBody; if (id) { state.bodies.delete(id); openBody(id); } }
});

async function openBody(id) {
  const p = state.posts.find(x => x.id === id), w = workspaceOf();
  if (!p || !w) return;
  if (postView(p).body !== 'sentences') { paintBody(id); return; }
  const have = state.bodies.get(id);
  if (have && !have.failed) { paintBody(id); return; }
  state.bodies.set(id, {loading: true}); paintBody(id);
  try {
    const rows = await readBody(w, id);
    state.bodies.set(id, {text: bodyText(Array.isArray(rows) ? rows : [])});
  } catch {
    state.bodies.set(id, {failed: true});
  }
  paintBody(id);
}
// <details>의 toggle은 거품이 오르지 않아 잡기 단계에서 받는다.
root?.addEventListener('toggle', event => {
  const d = event.target;
  if (!(d instanceof HTMLDetailsElement) || !d.matches('[data-os-fold]')) return;
  const id = d.dataset.osFold;
  if (d.open) { state.open.add(id); openBody(id); } else state.open.delete(id);
}, true);

// 탭 줄: 왼쪽·오른쪽 화살표로 탭 이동(WAI tablist).
root?.addEventListener('keydown', event => {
  if (!event.target.matches?.('[data-os-tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? NOW_TABS[0].id : event.key === 'End' ? NOW_TABS.at(-1).id : nowTabAt(state.tab, event.key === 'ArrowLeft' ? -1 : 1);
  if (next) setTab(next, {focus: true});
});
// 폰: 탭 줄 위에서만 좌우로 밀어 탭 이동(NOW-줄밀기, 명진 11/03: 글 줄 좌우 밀기는 숨기기·보관이 갖는다. 탭은 누르기로도 이동). 가로로 충분히 민 것만.
const PHONE = window.matchMedia('(max-width:760px)');
let swipe = null;
root?.addEventListener('touchstart', e => {
  swipe = null;
  if (!PHONE.matches || state.mode !== 'list' || root.dataset.detail === 'open' || e.touches.length !== 1 || !e.target.closest('[data-os-tabs]')) return;
  const p = e.touches[0]; swipe = {x: p.clientX, y: p.clientY, t: Date.now()};
}, {passive: true});
root?.addEventListener('touchend', e => {
  const s = swipe; swipe = null;
  if (!s || !e.changedTouches.length || claimedSince(s.t)) return;
  const p = e.changedTouches[0], dx = p.clientX - s.x, dy = p.clientY - s.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.t > 800) return;
  const next = nowTabAt(state.tab, dx < 0 ? 1 : -1);
  if (next) setTab(next);
}, {passive: true});
root?.addEventListener('touchcancel', () => { swipe = null; }, {passive: true});

// 글 줄 밀기·마우스 단추(왼쪽 = 숨기기, 오른쪽 = 보관). 사회운동 목록은 여기서, 뉴스 목록은 news-clipping.js, 보관 탭은 now-saved.js가 같은 부품(now-row-acts.js)을 붙인다.
bindNowRows(root?.querySelector('[data-os-list]'), {row: '[data-os-post]', itemOf: el => (el.dataset.osPost ? {type: 'outside', id: el.dataset.osPost} : null),
  isSaved: item => markOf(item.id).archived,
  changed: (item, kind, on) => {
    const m = {...markOf(item.id)};
    if (kind === 'hide') m.dismissed = on; else m.archived = on;
    state.marks.set(item.id, m);
    if (state.tab === 'saved') saved.load();
    paintList();
  }});
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'outside') return;
  // 다른 화면으로 가면 켜고 끄기 칸은 닫힌 것으로(라우터가 그 화면의 겹을 정리한다). 다음에 들어오면 목록부터, 새 표시는 다시 읽는다.
  layer = null; detailLayer = null; interestsLayer = null; autoOpened.clear();
  if (state.mode !== 'list') { state.mode = 'list'; listDirty = false; }
  state.seenRead = false; state.open.clear();
  if (detail.current()) { detail.close(); if (root) root.dataset.detail = 'closed'; }
});
window.KPTURouter?.on?.('outside', () => { enter(); });
window.addEventListener('kptu:view-prefs-ready', () => {
  if (state.tabSet || window.KPTURouter?.current !== 'outside') return;
  setTab(keepNowTab(viewPrefs.get('now_tab')), {save: false});
});
window.KPTUOutside = {refresh: () => load(), showNew: () => setTab('outside')}; // showNew: 알림 줄 '새 성명 n건' [보기](notice-outside.js)
// [뉴스] 탭 칸 주인(news-clipping.js)이 쓰는 입구: 상세 열기·머리 만들기·확정 관심 주제·환류 기록 뒤 후보 묻기·지금 탭.
window.KPTUNow = {
  open: (item, head) => openDetail(item, head), listed: () => autoOpenTop(), describe, topics: () => interests.topics(), selected: () => { const c = detail.current(); return c ? itemKey(c) : ''; },
  signaled: () => askInterests(), tab: () => state.tab, openInterests: () => openInterests(),
};
if (window.KPTURouter?.current === 'outside') enter();
})();
