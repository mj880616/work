import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {claimedSince} from './row-swipe.js';
import {createOutsideSearch} from './outside-search.js';
import {createMovePicker} from './library-move-picker.js';
import {GROUPS, PAGE_SIZE, normalizeCatalog, enabledKeys, ownSourceRows, groupPosts, postView, sourceState, feedWhen} from './outside-statements-model.mjs';
import {viewPrefs} from './view-prefs.js';
import {mountSplitResize} from './split-resize.js';
import {hasNewsItem, takeNewsTab} from './news-request.mjs';
import {itemView, whenOf} from './news-clipping-model.mjs';
import {NOW_TABS, SAVED_TAB_IDS, keepNowTab, nowTabAt, startTab, titleHit, itemKey, isUuid, interestHit, dateText, MEDIA_ALL, mediaRows, keepMedia, mediaName, outsideKeysOf, newsKeysOf, mergeFeed} from './now-model.mjs';
import {outsideColor, newsColor, colorVar, familyOfGroup, postTag, newsTag, tagLabel} from './news-colors.mjs';
import {rowHtml, dayHtml} from './news-row.mjs';
import {ensureReads, readState, markRead, onReads} from './news-reads.js';
import {createNowDetail} from './now-detail.js';
import {createNowSaved} from './now-saved.js';
import {createNowHighlights} from './now-highlights.js';
import {notify} from './small-notice.js';
import {createNowInterests} from './now-interests.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {readOutsideMarks} from './now-marks.js';
import {fillGestureArea} from './gesture-fill.js';
// OUTSIDE-바깥성명 ④ 화면 1(설계 docs/design/outside-statements.md 4절): #outsideView의 유일한 그리기 주인(News 메뉴 껍데기 — S51-17 P5에서 메뉴 이름 'News'·주소 ?view=news).
// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.1·6.3·6.4절, 시안 docs/design/mockups/news-overhaul.html ①·③):
// - 탭 [전체][사회운동][언론][보관](now-model.mjs NOW_TABS). 폰은 아래 떠 있는 탭 줄, 폴드 펼침(761~1199px)은 오른쪽 아래, PC(1200px~)는 위(명진 11/06 탭 자리 규칙).
//   좌우 밀기 = 탭 이동(글 줄 위 밀기는 숨기기·보관이 갖는다). 고른 탭은 서버 view_prefs.news_tab. news_tab이 없으면 옛 now_tab을 바꿔 한 번 옮긴다(옛 값은 지우지 않음).
// - 위 줄: 찾기 칸 하나 'News 찾기 — 제목·문장'(제목은 지금 보이는 목록에서 바로 거르고, Enter = 문장 찾기 app_outside_search·expand — 결과 칸은 outside-search.js)
//   + [매체: 전체 ▾](자료실 분류 창과 같은 부품 library-move-picker.js, 묶음 → 매체, 화면 메모리만) + ⋯(지금 채우기·단체 켜고 끄기·매체 켜고 끄기·키워드·별표 폴더·관심 주제).
// - 줄: 날짜 묶음 → 흰 상자 안 줄(news-row.mjs). 매체 색 띠·같은 색 이름·분류 꼬리표·시각·별표(news-colors.mjs). 안 읽은 글 굵게·읽은 글 흐리게(news-reads.js, 상세를 열면 읽음).
// - 각 탭 칸 안: [전체]·[사회운동] 이 모듈, [언론] news-clipping.js, [보관] now-saved.js, [밑줄] now-highlights.js(S53-5 — 원문에서 고른 글 모아보기, 마지막 탭으로 기억하지 않음). 상세 칸은 now-detail.js 하나(요약 · 시사점 · 원문 전체, S51-14 P4c — 연 글은 주소 ?item=). 관심 주제 칸은 now-interests.js.
// - 단체 켜고 끄기 칸: 카탈로그(서버 outside-feed ?action=catalog) 단체마다 켬/끔(서버 표 app_outside_sources) + 마지막으로 읽은 시각·실패 표시. 뒤로가기 한 번 = 목록(KPTURouter.layer).
// - 들어오면 본 시각(app_outside_seen, 알림 줄 '새 성명 n건'의 기준)을 지금 시각으로 바꿔 둔다(서버 저장). 줄의 '새' 표시는 읽음 굵기(news-reads.js)로 바뀌었다.
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 글 제목·본문을 남기지 않는다. 기기 저장 없음.

(() => {
if (window.KPTUOutside) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body,author';
const NEWS_COLS = 'id,lane,url,title,lang,publisher,source_key,published_at,scrapped_at,created_at,state,summary,body_kind,title_ko,starred_at';
const SOURCE_COLS = 'source_key,enabled,last_ok_at,last_error';
const PANEL = Object.freeze({all: 'nowPanelAll', movement: 'osPanelNew', media: 'nowPanelNews', archive: 'nowPanelSaved', marks: 'nowPanelMarks'});

const TABS_HTML = NOW_TABS.map((t, i) => `<button type="button" role="tab" class="ds-seg-btn" id="osTab-${t.id}" data-os-tab="${t.id}" aria-selected="${i === 0}" aria-controls="${PANEL[t.id]}"${i ? ' tabindex="-1"' : ''}>${t.label}</button>`).join('');
function install() {
  if (document.getElementById('outsideView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="outsideView" class="view-panel hidden" aria-labelledby="osTitle">
<h2 id="osTitle" class="screen-title">News</h2>
<div id="outsideRoot" class="os now" data-mode="list" data-tab="all" data-detail="closed">
<div class="os-tabs ds-seg" role="tablist" aria-label="News 보기" data-os-tabs>${TABS_HTML}</div>
<div class="now-main" id="nowMain">
<form class="nw-top" data-nw-top role="search" aria-label="News 찾기"><input type="search" class="nw-find" data-nw-find maxlength="100" enterkeyhint="search" placeholder="News 찾기 — 제목·문장" aria-label="News 찾기 — 제목·문장" autocomplete="off"><button type="button" class="nw-dd" data-nw-media aria-haspopup="dialog" aria-expanded="false"></button><button type="button" class="os-more" data-os-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="News 메뉴">${MORE}</button></form>
<p class="now-cand" data-now-cand hidden></p>
<div id="osPanelSearch" class="osq" data-os-search aria-label="문장 찾기" hidden></div>
<div id="nowPanelAll" role="tabpanel" aria-labelledby="osTab-all" data-now-panel-all><div class="os-list" data-nw-all aria-label="새로 온 글"></div></div>
<div id="osPanelNew" role="tabpanel" aria-labelledby="osTab-movement" data-os-panel-new hidden>
<p class="os-when" data-os-when hidden></p>
<div class="os-list" data-os-list aria-label="사회운동 글"></div>
<div class="os-sources" data-os-sources aria-label="단체 켜고 끄기"></div>
</div>
<div id="nowPanelNews" role="tabpanel" aria-labelledby="osTab-media" data-now-panel-news hidden></div>
<div id="nowPanelSaved" class="now-saved" role="tabpanel" aria-labelledby="osTab-archive" data-now-panel-saved hidden></div>
<div id="nowPanelMarks" class="now-marks" role="tabpanel" aria-labelledby="osTab-marks" data-now-panel-marks hidden></div>
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
  posts: [], postsLoaded: false, postsFailed: false, end: true, more: false, seenRead: false, media: MEDIA_ALL,
  news: [], newsLoaded: false, newsFailed: false, newsEnd: true, newsMeta: {catalog: [], enabled: []},
  query: '', searching: false, saving: new Set(), saveFailed: '', mode: 'list', reading: new Set(), readNote: new Map(), tab: '', tabSet: false, marks: new Map()});
let state = fresh(), loadSeq = 0, newsSeq = 0, layer = null;

// ---------- 서버 읽기·쓰기(모두 작업공간 소유자 RLS · Edge는 사용자 로그인 확인) ----------
const q = v => encodeURIComponent(v);
async function readCatalog() {
  const data = await rt().api('/functions/v1/outside-feed?action=catalog', {method: 'POST', body: {}, singleFlight: false, timeoutMs: 20000});
  return normalizeCatalog(data);
}
// 뉴스 클리핑 매체(news- 키)는 같은 표에 있지만 이 화면 단체가 아니다 → 서버에서 빼고 읽는다(화면 계산도 ownSourceRows로 한 번 더).
const readSources = w => rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=not.like.news-*&select=${SOURCE_COLS}`, {singleFlight: false});
function readPosts(w, keys, offset) {
  if (keys && !keys.length) return Promise.resolve([]);
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return rt().api(`/rest/v1/app_outside_posts?workspace_id=eq.${q(w)}${filter}&select=${POST_COLS}&order=published_at.desc.nullslast,fetched_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`, {singleFlight: false});
}
// [전체] 탭의 언론 기사(지운 줄 hidden_at 빼고, 최신 먼저). 매체를 고르면 그 news- 키만.
function readNews(w, keys, offset) {
  if (keys && !keys.length) return Promise.resolve([]);
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&hidden_at=is.null${filter}&select=${NEWS_COLS}&order=created_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${offset}`, {singleFlight: false});
}
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

// ---------- 매체 고르기(이 화면 메모리) ----------
const catalogOf = key => state.catalog?.find(s => s.key === key) || null;
const nameOf = key => catalogOf(key)?.name || key;
const enabledNow = () => enabledKeys([...state.sources.values()]);
const newsCatalog = () => state.newsMeta.catalog || [];
const outsideKeys = () => outsideKeysOf(state.media, state.catalog || [], enabledNow());
const newsKeys = () => newsKeysOf(state.media, newsCatalog());
const dotOf = (kind, id) => (kind === 's' ? outsideColor(id, state.catalog || []) : kind === 'n' ? newsColor({source_key: id}, newsCatalog()) : kind === 'g' ? colorVar(familyOfGroup(id), 0) : colorVar('press', id === 'foreign' ? 1 : 0));
const search = createOutsideSearch({box: $('[data-os-search]'), nameOf, workspaceOf, keysOf: () => outsideKeys()});
let mediaPicker = null;
const picker = () => (mediaPicker ||= createMovePicker({esc, id: 'nwMediaPicker', label: '매체 선택', findLabel: '매체 찾기', foot: false, currentTag: '선택됨', folderIcons: false}));
function paintMediaButton() {
  const b = $('[data-nw-media]');
  if (!b) return;
  b.textContent = `매체: ${mediaName(state.media, {oc: state.catalog || [], nc: newsCatalog()})} ▾`;
  b.hidden = state.tab === 'archive';
}
function openMediaPicker(anchor) {
  const tab = state.tab || 'all';
  anchor.setAttribute('aria-expanded', 'true');
  picker().open({anchor, place: 'below', history: PHONE.matches, canNew: false, canOut: false,
    rows: query => mediaRows({tab, oc: state.catalog || [], on: enabledNow(), nc: newsCatalog(), non: state.newsMeta.enabled || [], pick: state.media, query, dot: dotOf}),
    onPick: id => setMedia(id), onClosed: () => anchor.setAttribute('aria-expanded', 'false')});
}
function setMedia(id) {
  const next = keepMedia(state.tab || 'all', id);
  if (next === state.media) return;
  state.media = next;
  paintMediaButton();
  reloadLists();
}
// 매체·탭이 바뀌면 보이는 목록만 다시 읽는다([언론]은 그 칸 주인이, [사회운동]·[전체]는 이 모듈이).
function reloadLists() {
  if (state.tab === 'media') window.KPTUNews?.refresh?.();
  else if (state.tab === 'movement' || state.tab === 'all') { loadPosts(); if (state.tab === 'all') loadNews(); }
  if (state.query && state.searching) search.run(state.query);
}

// ---------- 상세·보관·관심 주제(공용 부품, 각 칸의 그리기 주인) ----------
const PC = window.matchMedia('(min-width:761px)');
const PHONE = window.matchMedia('(max-width:760px)');
const DESK = window.matchMedia('(min-width:1200px)'); // PC: 탭 줄이 위(밀기는 탭 줄 위에서만). 폰·폴드 펼침은 줄 밖 어디서나 밀어 탭 이동.
const mainBox = root?.querySelector('#nowMain'), detailBox = root?.querySelector('[data-now-detail]');
// 글 하나 → 상세 머리(꼬리 줄·제목·원문). 사회운동 글과 뉴스 기사 두 쪽 모두 여기서(보관 탭·함께 볼 것도 같은 길).
function describe(type, row) {
  if (type === 'news') {
    const v = itemView(row || {});
    return {meta: [v.publisher, tagLabel(newsTag(row)) || '기사', dateText(row?.published_at || row?.created_at)], title: v.title, origTitle: v.origTitle, titleLang: v.titleLang, lang: row?.lang || 'ko', url: v.url, at: row?.published_at || row?.created_at || null};
  }
  const v = postView(row || {}), tag = postTag(row || {});
  // 꼬리 줄 = 매체 · 분류(성명은 글 종류 그대로, 국제는 '국제 · 종류') · 날짜 · 글쓴이(있을 때만).
  const kind = tag === 'intl' ? `${tagLabel(tag)} · ${v.kind}` : (tag && tag !== 'statement' ? tagLabel(tag) : v.kind);
  return {meta: [nameOf(row?.source_key), kind, dateText(row?.published_at), typeof row?.author === 'string' ? row.author.trim().slice(0, 60) : ''], title: v.title, origTitle: v.origTitle, titleLang: row?.lang === 'en' && !row?.title_ko ? 'en' : '', lang: row?.lang || 'ko', url: v.url, at: row?.published_at || row?.fetched_at || null};
}
// 줄 하나(세 목록 공통 모양 news-row.mjs). 사회운동 글·언론 기사 → 그릴 값.
function rowOf(type, row, {openAttr, rowAttr, acts = '', star = false} = {}) {
  const item = {type, id: row.id}, sel = detail.current();
  const base = {key: itemKey(item), openAttr, openId: row.id, rowAttr, rowId: row.id, read: readState(item), open: !!sel && itemKey(sel) === itemKey(item), acts, star};
  if (type === 'news') {
    const v = itemView(row);
    return rowHtml({...base, title: v.title, titleLang: v.titleLang, src: v.publisher, color: newsColor(row, newsCatalog()), tag: newsTag(row), time: v.time, star: !!row.starred_at, hit: interestHit([v.title, v.origTitle, v.summary], interests.topics())}, esc);
  }
  const v = postView(row);
  return rowHtml({...base, title: v.title, titleLang: row.lang === 'en' && !row.title_ko ? 'en' : '', src: nameOf(row.source_key), badge: v.tag, color: outsideColor(row.source_key, state.catalog || []), tag: postTag(row), time: v.time, hit: interestHit([v.title, v.origTitle, v.summary], interests.topics())}, esc);
}
let detailLayer = null, interestsLayer = null, interestsAsk = 0;
const detail = createNowDetail({box: detailBox, topics: () => interests.topics(),
  onClose: () => closeDetail(),
  onChanged: (item, act) => {
    // 뉴스 별표·관심 없음은 뉴스 목록 줄과 같은 칸이라 그 목록을 다시 읽는다. 보관 탭은 늘 다시.
    if (item.type === 'news' && act !== 'memo') { window.KPTUNews?.refresh?.(); if (state.tab === 'all') loadNews({keep: true}); }
    if (item.type === 'outside' && act !== 'memo') loadMarks().then(() => { if (state.mode === 'list') paintList(); });
    if (state.tab === 'archive') saved.load();
  },
  onSignal: () => askInterests(),
  onRead: (item, row) => { const c = detail.current(); if (c && itemKey(c) === itemKey(item)) detail.setHead(describe('news', row)); window.KPTUNews?.refresh?.(); },
  onRelated: r => openRelated(r)});
const saved = createNowSaved({box: root?.querySelector('[data-now-panel-saved]'), describe, rowOf, query: () => state.query,
  onOpen: (item, head) => openDetail(item, head), onListed: () => autoOpenTop(),
  onChanged: item => { if (item.type === 'news') window.KPTUNews?.refresh?.(); else loadMarks().then(() => { if (state.mode === 'list') paintList(); }); }});
// [밑줄] 탭: 줄을 누르면 그 글을 읽어 상세를 열고 그 밑줄 자리로. 텔레그램 원문 밑줄은 텔레그램 소식 화면으로(그 소식은 거기서 연다).
const marks = createNowHighlights({box: root?.querySelector('[data-now-panel-marks]'), query: () => state.query, onOpen: h => openHighlight(h)});
async function openHighlight(h) {
  if (h.source_type === 'telegram') { window.KPTURouter?.go?.('telegram', {source: 'delegated'}); return; }
  let row = null;
  try { row = await fetchItem(h.source_type, h.source_id); } catch { row = null; }
  if (!row) { notify('원래 글을 찾지 못했어요 · 밑줄은 그대로 있어요', {record: false}); return; }
  openDetail({type: h.source_type, id: h.source_id}, describe(h.source_type, row), {highlight: h.id});
}
const interests = createNowInterests({box: root?.querySelector('[data-now-interests-box]'), onChanged: () => { paintCand(); if (state.mode === 'list') paintList(); detail.paint(); }});
// 환류 기록이 쌓이면 서버가 후보를 만들지 정한다(10건 또는 저녁 6시 뒤 그날 처음 — 서버 규칙, AI를 안 부르면 한도도 안 씀). 화면은 1분에 한 번만 묻는다.
function askInterests() {
  if (Date.now() - interestsAsk < 60000) return;
  interestsAsk = Date.now();
  rt().api('/functions/v1/ai-assist', {method: 'POST', body: {kind: 'now_interests'}, singleFlight: false, timeoutMs: 60000})
    .then(r => { if (r?.added) interests.load(); }).catch(() => {});
}
let autoOpening = false;
function openDetail(item, head, opts = {}) {
  if (!item || !head) return;
  detail.open(item, head, opts);
  // 상세를 열면 읽음(app_feed_reads, 이미 있으면 서버가 그대로 둔다). PC에서 맨 위 글을 저절로 연 것은 읽은 것으로 치지 않는다.
  if (!autoOpening) markRead(item);
  if (root) root.dataset.detail = 'open';
  mountSplit();
  // 폰(좁은 화면): 상세가 전체 화면 — 뒤로가기 한 번 = 목록(라우터 겹). PC·폴드 펼침은 오른쪽 칸이라 겹 없음.
  if (!PC.matches) { detailLayer ||= window.KPTURouter?.layer?.open('now-detail', {reopen: () => openDetail(item, head), close: () => { detailLayer = null; closeDetail({fromLayer: true}); return true; }}) || null; window.scrollTo({top: 0, behavior: 'instant'}); }
  // 주소에 연 글(?item=outside:<id>) — 새로고침해도 같은 글. PC에서 맨 위 글을 저절로 연 것은 남기지 않는다.
  if (!autoOpening) window.KPTURouter?.setPlace?.('outside', {item: itemKey(item)});
  markOpen();
}
function closeDetail({fromLayer = false} = {}) {
  const was = detail.current();
  detail.close();
  if (root) root.dataset.detail = 'closed';
  mountSplit();
  if (!fromLayer) { const l = detailLayer; detailLayer = null; l?.close(); }
  window.KPTURouter?.setPlace?.('outside', {item: null});
  markOpen();
  if (was) root?.querySelector(`[data-nw-key="${CSS.escape(itemKey(was))}"] .now-open`)?.focus({preventScroll: true});
}
// 고른 줄 표시(PC 두 칸에서 어느 글이 열렸는지). 줄만 고친다(다시 그리지 않음).
function markOpen() {
  const c = detail.current(), key = c ? itemKey(c) : '';
  root?.querySelectorAll('.now-row[data-nw-key]').forEach(el => el.classList.toggle('is-open', !!key && el.dataset.nwKey === key));
}
// 글 하나를 id로 읽는다(함께 볼 것·주소에 남은 글). 없으면 null.
async function fetchItem(type, id) {
  const w = workspaceOf();
  const rows = type === 'news'
    ? await rt().api(`/rest/v1/app_news_items?workspace_id=eq.${q(w)}&id=eq.${q(id)}&select=${NEWS_COLS}&limit=1`, {singleFlight: false})
    : await rt().api(`/rest/v1/app_outside_posts?workspace_id=eq.${q(w)}&id=eq.${q(id)}&select=${POST_COLS}&limit=1`, {singleFlight: false});
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function openRelated(r) {
  if (r.kind === 'outside' || r.kind === 'news') {
    try {
      const row = await fetchItem(r.kind, r.id);
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
  root?.querySelector(`[data-os-tab="${state.tab || 'all'}"]`)?.focus({preventScroll: true});
}

// ---------- 목록 그리기 ----------
// 날짜 묶음 → 흰 상자 안 줄. entries = [{type, row}] (그려 둘 순서대로). 묶음 머리에 안 읽은 글 수.
function daysHtml(entries, now) {
  const wrapped = entries.map(e => ({...e, published_at: e.type === 'news' ? (whenOf(e.row) ? new Date(whenOf(e.row)).toISOString() : '') : e.row.published_at}));
  return groupPosts(wrapped, now).map(g => {
    const rows = g.items.map(e => rowOf(e.type, e.row, {openAttr: 'data-now-open', acts: hoverActsHtml({isSaved: e.type === 'news' ? !!e.row.starred_at : markOf(e.row.id).archived})})).join('');
    const unread = g.items.filter(e => readState({type: e.type, id: e.row.id}) === false).length;
    return dayHtml(g.label, rows, unread, esc);
  }).join('');
}
const shownPosts = () => state.posts.filter(p => !markOf(p.id).dismissed && titleHit([postView(p).title, p.title], state.query));
const shownNews = () => state.news.filter(n => titleHit([itemView(n).title, n.title], state.query));
const moreBtn = (attr, busy) => `<button type="button" class="os-text-btn os-more-posts" ${attr}${busy ? ' disabled aria-busy="true"' : ''}>더 보기</button>`;
function listHtml() {
  if (!state.postsLoaded) return state.postsFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6, h: 44});
  if (!state.posts.length) {
    if (!state.sourcesLoaded) return emptyHtml();
    if (!enabledNow().length) return `${emptyHtml('켠 단체 없음', {attrs: 'data-os-empty="none"'})}<button type="button" class="os-text-btn" data-os-open-sources>단체 켜고 끄기</button>`;
    return emptyHtml('새 글 없음', {attrs: 'data-os-empty="posts"'});
  }
  const shown = shownPosts();
  const more = state.end ? '' : moreBtn('data-os-more-posts', state.more);
  if (!shown.length) return `${emptyHtml(state.query ? '제목에서 찾은 글 없음' : '새 글 없음', {attrs: 'data-os-empty="posts"'})}${more}`;
  return daysHtml(shown.map(row => ({type: 'outside', row})), Date.now()) + more;
}
// [전체]: 사회운동 글 + 언론 기사를 한 줄로(시각 최신 순).
function allHtml() {
  if (!state.postsLoaded && !state.newsLoaded) return state.postsFailed && state.newsFailed ? failHtml({retry: 'data-os-retry'}) : waitHtml({rows: 6, h: 44});
  const posts = shownPosts().map(row => ({id: row.id, at: row.published_at || '', row}));
  const news = shownNews().map(row => ({id: row.id, at: whenOf(row) ? new Date(whenOf(row)).toISOString() : '', row}));
  const merged = mergeFeed(posts, news);
  const more = state.end && state.newsEnd ? '' : moreBtn('data-nw-all-more', state.more);
  if (!merged.length) return `${emptyHtml(state.query ? '제목에서 찾은 글 없음' : '새 글 없음', {attrs: 'data-nw-empty'})}${more}`;
  return daysHtml(merged, Date.now()) + more;
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

// 탭 줄과 칸 보이기(단체 켜고 끄기·관심 주제 칸에서는 탭 줄·위 줄을 감춘다).
function paintTabs() {
  if (!root) return;
  const tab = state.tab || 'all';
  root.dataset.tab = tab;
  const list = state.mode === 'list';
  const tabs = $('[data-os-tabs]'), top = $('[data-nw-top]');
  if (tabs) tabs.hidden = !list;
  if (top) top.hidden = !list;
  root.querySelectorAll('[data-os-tab]').forEach(b => { const on = b.dataset.osTab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  // 단체 켜고 끄기 칸은 [사회운동] 칸 안이다.
  const show = (sel, on) => { const el = $(sel); if (el) el.hidden = !on; };
  show('[data-os-panel-new]', state.mode === 'sources' || (list && tab === 'movement'));
  show('[data-now-panel-all]', list && tab === 'all');
  show('[data-now-panel-news]', list && tab === 'media');
  show('[data-now-panel-saved]', list && tab === 'archive');
  show('[data-now-panel-marks]', list && tab === 'marks');
  show('[data-os-search]', list && state.searching && !!state.query);
  show('[data-now-interests]', state.mode === 'interests');
  paintMediaButton();
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
// 탭 하나 보이기. save=true면 서버에 마지막 탭으로 기억(view_prefs.news_tab). [언론]·[보관]은 처음 보일 때 그 칸 주인이 불러온다.
function setTab(tab, {focus = false, save = true} = {}) {
  tab = keepNowTab(tab);
  const changed = state.tab !== tab;
  state.tab = tab; state.tabSet = true;
  const media = keepMedia(tab, state.media), mediaChanged = media !== state.media;
  state.media = media;
  paintTabs();
  if (changed || mediaChanged) {
    if (tab === 'media') window.KPTUNews?.enter?.();
    else if (tab === 'archive') { saved.paint(); saved.load(); }
    else if (tab === 'marks') { marks.paint(); void marks.load(); }
    else if (tab === 'all') { if (mediaChanged || !state.newsLoaded) loadNews(); if (mediaChanged) loadPosts(); else paint(); }
    else if (mediaChanged) loadPosts(); else paint();
  }
  if (save && SAVED_TAB_IDS.includes(tab) && viewPrefs.get('news_tab') !== tab) { viewPrefs.set('news_tab', tab, {rejectable: true}); void viewPrefs.flush?.(); }
  if (focus) root?.querySelector(`[data-os-tab="${tab}"]`)?.focus({preventScroll: true});
  autoOpenTop();
}
// 처음 탭: 서버에 기억한 news_tab, 없으면 옛 now_tab을 바꿔 한 번 옮겨 적는다(옛 값은 그대로 둔다).
function restoreTab() {
  const start = startTab(viewPrefs.get('news_tab'), viewPrefs.get('now_tab'));
  setTab(start.tab, {save: start.migrate});
}

function paint() {
  if (!root) return;
  root.dataset.mode = state.mode;
  paintTabs();
  // 위쪽 작은 줄: 마지막으로 읽은 시각 · 다음 읽기(켠 단체가 있을 때만, 목록 칸에서만).
  const when = $('[data-os-when]');
  if (when) {
    const reading = [...state.reading].map(nameOf).join(', ');
    const text = state.mode !== 'list' || reading ? '' : state.sourcesLoaded ? feedWhen([...state.sources.values()]) : '';
    if (state.mode === 'list' && reading) when.innerHTML = `<span class="os-reading">${esc(reading)}</span> ${waitInlineHtml()}`;
    else when.textContent = text;
    when.hidden = !(text || (state.mode === 'list' && reading));
  }
  const list = $('[data-os-list]'), sources = $('[data-os-sources]'), all = $('[data-nw-all]');
  if (state.mode === 'sources') { sources.innerHTML = sourcesHtml(); list.replaceChildren(); }
  else { list.innerHTML = state.mode === 'list' && state.tab === 'movement' ? listHtml() : ''; sources.replaceChildren(); }
  if (all) all.innerHTML = state.mode === 'list' && state.tab === 'all' ? allHtml() : '';
  mountSplit();
  autoOpenTop();
}
function paintList() {
  if (state.mode !== 'list') return;
  if (state.tab === 'movement') { const list = $('[data-os-list]'); if (list) list.innerHTML = listHtml(); }
  else if (state.tab === 'all') { const all = $('[data-nw-all]'); if (all) all.innerHTML = allHtml(); }
  autoOpenTop();
}
// 읽음 표시가 서버에서 오면(또는 상세를 열어 읽음이 되면) 보이는 목록을 다시 그린다(각 칸 주인이 자기 칸만).
onReads(() => { paintList(); if (state.tab === 'archive') saved.paint(); });
// UI-Now PC정돈(명진 11/03 09:39): PC·폴드 펼침에서 상세 칸이 비어 안내문만 있지 않게 — 목록이 보이면 맨 위 글을 바로 연다(탭마다 이 화면에 들어온 뒤 한 번,
// 닫으면 다시 열지 않음). 글이 없는 탭(빈 목록)은 상세 칸을 열지 않고 목록이 폭을 쓴다(CSS가 data-detail="closed"일 때 한 칸).
const autoOpened = new Set();
let restoring = false; // 주소에 남은 글을 다시 열기(restorePlaced)
function autoOpenTop() {
  if (!PC.matches || state.mode !== 'list' || detail.current() || autoOpened.has(state.tab) || restoring) return;
  const panel = $(`#${PANEL[state.tab] || ''}`);
  const btn = panel?.querySelector('.now-row .now-open');
  if (!btn) return;
  autoOpened.add(state.tab);
  autoOpening = true;
  try { btn.click(); } finally { autoOpening = false; }
}

// ---------- 불러오기 ----------
function resetIfOwnerChanged() {
  const scope = scopeOf();
  if (state.scope === scope) return;
  closeLayer();
  state = fresh(); state.scope = scope;
  search.reset();
  detail.reset(); saved.reset(); marks.reset(); interests.reset();
  if (root) root.dataset.detail = 'closed';
  const f = $('[data-nw-find]'); if (f) f.value = '';
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
  const keys = outsideKeys();
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
    void ensureReads(page.map(p => ({type: 'outside', id: p.id})));
  } catch {
    if (seq !== loadSeq) return;
    if (!append) state.postsFailed = true;
  } finally {
    if (seq === loadSeq) { state.more = false; paint(); }
  }
}
async function loadNews({append = false, keep = false} = {}) {
  const w = workspaceOf(), seq = ++newsSeq;
  if (!w) return;
  if (!append) { state.newsFailed = false; if (!keep || !state.newsLoaded) { state.newsLoaded = false; state.news = []; } }
  try {
    await newsMeta();
    const rows = await readNews(w, newsKeys(), append ? state.news.length : 0);
    if (seq !== newsSeq) return;
    const got = Array.isArray(rows) ? rows : [];
    const page = got.slice(0, PAGE_SIZE);
    state.news = append ? [...state.news, ...page.filter(p => !state.news.some(x => x.id === p.id))] : page;
    state.newsEnd = got.length <= PAGE_SIZE;
    state.newsLoaded = true;
    void ensureReads(page.map(p => ({type: 'news', id: p.id})));
  } catch {
    if (seq !== newsSeq) return;
    if (!append) { state.newsFailed = true; state.newsLoaded = true; }
  } finally {
    if (seq === newsSeq) paint();
  }
}
// 언론 매체 카탈로그·켠 매체(뉴스 칸 주인 news-clipping.js가 서버에서 한 번 읽어 둔 것). 매체 고르기·색·[전체] 거르기에 쓴다.
async function newsMeta() {
  try { const m = await window.KPTUNews?.meta?.(); if (m) state.newsMeta = {catalog: m.catalog || [], enabled: m.enabled || []}; } catch { /* 없으면 언론 매체 없이 */ }
  return state.newsMeta;
}
async function loadMore() {
  if (state.more) return;
  state.more = true; paint();
  await Promise.allSettled([state.end ? null : loadPosts({append: true}), state.newsEnd ? null : loadNews({append: true})]);
  state.more = false; paint();
}

let entering = null;
async function load() {
  const w = workspaceOf();
  if (!w) return;
  const scope = state.scope;
  const [catalog, sources] = await Promise.allSettled([
    state.catalog ? Promise.resolve(state.catalog) : readCatalog(),
    readSources(w),
  ]);
  if (scope !== state.scope) return;
  if (catalog.status === 'fulfilled') { state.catalog = catalog.value; state.catalogFailed = false; } else state.catalogFailed = true;
  if (sources.status === 'fulfilled' && Array.isArray(sources.value)) {
    state.sources = new Map(ownSourceRows(sources.value).map(r => [r.source_key, r]));
    state.sourcesLoaded = true; state.sourcesFailed = false;
  } else if (!state.sourcesLoaded) state.sourcesFailed = true;
  if (!state.seenRead) {
    state.seenRead = true;
    // 지금 본 것으로 둔다(알림 줄 '새 성명 n건'이 이 시각 뒤 글만 센다). 실패해도 화면은 그대로.
    writeSeen(w, new Date().toISOString()).catch(() => {});
  }
  paintMediaButton();
  await Promise.allSettled([loadPosts({keep: true}), state.tab === 'all' ? loadNews({keep: true}) : newsMeta()]);
  paintMediaButton();
}
// 주소에 남은 글(새로고침·되돌아온 주소)을 다시 연다. 그동안 PC 맨 위 글 저절로 열기는 쉰다.
function restorePlaced() {
  const m = /^(outside|news):(.+)$/.exec(window.KPTURouter?.place?.('outside')?.item || '');
  if (!m || !isUuid(m[2]) || detail.current() || restoring) return;
  restoring = true;
  fetchItem(m[1], m[2]).then(row => {
    if (!row || detail.current() || window.KPTURouter?.current !== 'outside') return;
    autoOpened.add(state.tab);
    openDetail({type: m[1], id: row.id}, describe(m[1], row));
  }).catch(() => {}).finally(() => { restoring = false; autoOpenTop(); });
}
function enter() {
  resetIfOwnerChanged();
  restorePlaced();
  // 처음 들어올 때 탭: 노트 [기사로 가기]면 [언론], 아니면 서버에 기억한 마지막 탭(news_tab, 없으면 옛 now_tab을 옮김, 둘 다 없으면 전체).
  // 주소 ?view=news(옛 ?view=outside·?view=now 포함, S51-17 P5)는 탭을 정하지 않는다. 알림 줄 [보기]는 [사회운동](requestNewsTab).
  const asked = takeNewsTab();
  if (hasNewsItem()) { state.tab = ''; setTab('media', {save: false}); }
  else if (asked) setTab(asked, {save: false});
  else if (!state.tabSet) {
    restoreTab();
    // 화면 기억을 아직 서버에서 못 읽었으면(첫 로딩) 읽은 뒤 한 번 더 — 그사이 사용자가 탭을 고르면 그대로 둔다.
    if (viewPrefs.status?.() !== 'ok') state.tabSet = false;
  }
  // 다시 들어온 때도 보이는 탭 칸을 새로 읽는다([언론]은 그 모듈이, [보관]은 이 화면이).
  else if (state.tab === 'media') window.KPTUNews?.enter?.();
  else if (state.tab === 'archive') saved.load();
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

// [지금 채우기](NEWS-클리핑 C1, 명진 11/01 22:34): 켠 단체를 하나씩 바로 읽고, 언론 쪽은 뉴스 칸 주인이 서버 fill_now로 채운다.
// 마지막으로 읽은 지 얼마 안 된 단체·하루 횟수는 서버가 거른다(새 읽기 길을 만들지 않음).
let filling = false;
async function fillNow() {
  if (filling) return;
  const scope = state.scope;
  filling = true;
  window.KPTUNews?.act?.('fill');
  try {
    if (!state.sourcesLoaded) await load().catch(() => {});
    for (const key of enabledNow().filter(k => catalogOf(k))) { // news- 키(뉴스 클리핑 매체)는 같은 표에 있지만 이 화면 단체가 아님
      if (scope !== state.scope) break;
      await readNow(key);
    }
  } finally { filling = false; }
}
// 언론 쪽 칸(매체 켜고 끄기·키워드·별표 폴더)은 [언론] 칸 안이라 그 탭을 보인 뒤 칸 주인이 연다.
function newsPanel(mode) { if (state.tab !== 'media') setTab('media'); window.KPTUNews?.act?.(mode); }

// ---------- 찾기 칸 ----------
// 글자를 바꾸면 보이는 목록을 제목으로 바로 거른다(화면 목록에서). Enter를 누르면 문장 찾기 결과 칸이 목록 위에 열린다(지운 칸은 닫힘).
function setQuery(raw, {submit = false} = {}) {
  const query = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const changed = query !== state.query;
  state.query = query;
  if (!query) state.searching = false;
  else if (submit) state.searching = true;
  paintTabs();
  if (changed) { paintList(); window.KPTUNews?.repaint?.(); if (state.tab === 'archive') saved.paint(); if (state.tab === 'marks') marks.paint(); }
  if (submit && query) search.run(query);
  if (!query) search.clear();
}

// ---------- 누르기 ----------
const menu = createAnchoredMenu({id: 'osMenu', className: 'topline-add-menu os-menu', label: 'News 메뉴', historyKey: 'kptuOutsideMenu', key: () => 'head',
  render: () => `<button type="button" data-os-act="fill"${filling ? ' disabled' : ''}>지금 채우기</button><button type="button" data-os-act="sources">단체 켜고 끄기</button><button type="button" data-os-act="news-sources">언론 매체 켜고 끄기</button><button type="button" data-os-act="keywords">키워드 수정</button><button type="button" data-os-act="folders">별표 폴더</button><button type="button" data-os-act="interests">관심 주제</button>`,
  onAction: button => {
    const a = button.dataset.osAct;
    if (a === 'sources') openSources(); else if (a === 'fill') fillNow(); else if (a === 'interests') openInterests();
    else if (a === 'news-sources') newsPanel('sources'); else if (a === 'keywords' || a === 'folders') newsPanel(a);
  }});

root?.addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.matches('[data-os-tab]')) { setTab(b.dataset.osTab); return; }
  if (b.matches('[data-now-open]')) {
    const key = b.closest('[data-nw-key]')?.dataset.nwKey || '', [type, id] = key.split(':');
    const row = type === 'news' ? state.news.find(x => x.id === id) : state.posts.find(x => x.id === id);
    if (row) openDetail({type, id}, describe(type, row));
    return;
  }
  if (b.matches('[data-nw-media]')) { openMediaPicker(b); return; }
  if (b.matches('[data-now-interests-open]')) { openInterests(); return; }
  if (b.matches('[data-now-interests-back]')) { const l = interestsLayer; interestsLayer = null; l?.close(); backFromInterests(); return; }
  if (b.matches('[data-os-more]')) { menu.open(b); return; }
  if (b.matches('[data-os-open-sources]')) { openSources(); return; }
  if (b.matches('[data-os-back]')) { closeLayer(); backToList(); return; }
  if (b.matches('[data-os-source]')) { toggleSource(b.dataset.osSource); return; }
  if (b.matches('[data-os-more-posts]')) { loadPosts({append: true}); return; }
  if (b.matches('[data-nw-all-more]')) { loadMore(); return; }
  if (b.matches('[data-os-retry]')) { load().catch(() => {}); paint(); }
});
root?.addEventListener('input', event => { if (event.target.matches?.('[data-nw-find]')) setQuery(event.target.value); });
root?.addEventListener('submit', event => {
  if (!event.target.matches?.('[data-nw-top]')) return;
  event.preventDefault();
  setQuery($('[data-nw-find]')?.value, {submit: true});
});

// 탭 줄: 왼쪽·오른쪽 화살표로 탭 이동(WAI tablist).
root?.addEventListener('keydown', event => {
  if (!event.target.matches?.('[data-os-tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? NOW_TABS[0].id : event.key === 'End' ? NOW_TABS.at(-1).id : nowTabAt(state.tab, event.key === 'ArrowLeft' ? -1 : 1);
  if (next) setTab(next, {focus: true});
});
// 폰·폴드: 좌우로 밀어 탭 이동(NEWS P4b). 글 줄 위 밀기는 숨기기·보관(NOW-줄밀기, 명진 11/03)이 가지므로 줄·입력 칸 밖(탭 줄·날짜 머리·빈 곳)에서만.
// 가로로 충분히 민 것만. 상세가 전체 화면일 때·다른 칸(단체·관심 주제)일 때는 하지 않는다.
// S51-24 UI-빈칸손짓: 글이 짧아도 아래 빈 곳까지 밀기 칸(gesture-fill.js).
fillGestureArea(root);
let swipe = null;
const SWIPE_SKIP = '.now-row, input, textarea, select, [data-os-search], .now-detail';
root?.addEventListener('touchstart', e => {
  swipe = null;
  if (DESK.matches && !e.target.closest('[data-os-tabs]')) return;
  if (state.mode !== 'list' || (PHONE.matches && root.dataset.detail === 'open') || e.touches.length !== 1 || e.target.closest(SWIPE_SKIP)) return;
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

// 글 줄 밀기·마우스 단추(왼쪽 = 숨기기, 오른쪽 = 보관). [전체]·[사회운동]은 여기서, [언론]은 news-clipping.js, [보관]은 now-saved.js가 같은 부품(now-row-acts.js)을 붙인다.
const itemOfRow = el => { const [type, id] = String(el.dataset.nwKey || '').split(':'); return (type === 'outside' || type === 'news') && id ? {type, id} : null; };
function rowChanged(item, kind, on) {
  if (item.type === 'news') {
    const it = state.news.find(x => x.id === item.id);
    if (kind === 'hide') { if (on) state.news = state.news.filter(x => x.id !== item.id); else loadNews({keep: true}); }
    else if (it) it.starred_at = on ? new Date().toISOString() : null;
  } else {
    const m = {...markOf(item.id)};
    if (kind === 'hide') m.dismissed = on; else m.archived = on;
    state.marks.set(item.id, m);
  }
  if (state.tab === 'archive') saved.load();
  paintList();
}
for (const sel of ['[data-os-list]', '[data-nw-all]']) {
  bindNowRows(root?.querySelector(sel), {row: '[data-nw-key]', itemOf: itemOfRow,
    isSaved: item => (item.type === 'news' ? !!state.news.find(x => x.id === item.id)?.starred_at : markOf(item.id).archived), changed: rowChanged});
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'outside') return;
  // 다른 화면으로 가면 켜고 끄기 칸은 닫힌 것으로(라우터가 그 화면의 겹을 정리한다). 다음에 들어오면 목록부터, 새 표시는 다시 읽는다.
  layer = null; detailLayer = null; interestsLayer = null; autoOpened.clear();
  if (mediaPicker?.isOpen) void mediaPicker.close();
  if (state.mode !== 'list') { state.mode = 'list'; listDirty = false; }
  state.seenRead = false;
  if (detail.current()) { detail.close(); if (root) root.dataset.detail = 'closed'; }
});
window.KPTURouter?.on?.('outside', () => { enter(); });
window.addEventListener('kptu:view-prefs-ready', () => {
  if (state.tabSet || window.KPTURouter?.current !== 'outside') return;
  restoreTab();
});
window.KPTUOutside = {refresh: () => load(), showNew: () => { takeNewsTab(); setTab('movement'); }}; // showNew: 알림 줄 '새 성명 n건' [보기](notice-outside.js, 이미 불러온 때)
// [언론] 탭 칸 주인(news-clipping.js)이 쓰는 입구: 상세 열기·머리 만들기·줄 그리기·확정 관심 주제·환류 기록 뒤 후보 묻기·지금 탭·찾는 말·고른 매체.
window.KPTUNow = {
  open: (item, head) => openDetail(item, head), listed: () => autoOpenTop(), describe, rowOf, topics: () => interests.topics(), selected: () => { const c = detail.current(); return c ? itemKey(c) : ''; },
  signaled: () => askInterests(), tab: () => state.tab, openInterests: () => openInterests(), query: () => state.query, newsKeys: () => newsKeys(),
  metaChanged: m => { if (m) state.newsMeta = {catalog: m.catalog || [], enabled: m.enabled || []}; state.media = keepMedia(state.tab || 'all', state.media); paintMediaButton(); },
};
if (window.KPTURouter?.current === 'outside') enter();
})();
