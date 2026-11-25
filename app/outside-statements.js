import {waitHtml, waitInlineHtml, failHtml, emptyHtml} from './wait-state.js';
import {createAnchoredMenu, anyMenuOpen, whenMenusClosed} from './anchored-menu.js';
import {claimedSince} from './row-swipe.js';
import {createOutsideSearch} from './outside-search.js';
import {createMovePicker} from './library-move-picker.js';
import {GROUPS, PAGE_SIZE, normalizeCatalog, enabledKeys, ownSourceRows, groupPosts, postView, sourceState, feedWhen, intlSplitOn, splitIntl, INTL_LABEL} from './outside-statements-model.mjs';
import {viewPrefs} from './view-prefs.js';
import {mountSplitResize} from './split-resize.js';
import {SPLIT_QUERY, NARROW_QUERY} from './screen-width.mjs';
import {followPane} from './follow-pane.js';
import {hasNewsItem, takeNewsTab, takeNewsOpen} from './news-request.mjs';
import {itemView, whenOf} from './news-clipping-model.mjs';
import {NOW_TABS, SAVED_TAB_IDS, keepNowTab, nowTabAt, startTab, openTabFor, titleHit, itemKey, isUuid, interestHit, dateText, MEDIA_ALL, mediaRows, keepMedia, mediaName, outsideKeysOf, newsKeysOf, mergeFeed, tabForItem} from './now-model.mjs';
import {outsideColor, outsideBar, newsColor, newsBar, colorVar, familyOfGroup, postTag, newsTag, tagLabel} from './news-colors.mjs';
import {rowHtml, dayHtml, runsHtml} from './news-row.mjs';
import {foldRuns, liftRelated, LIFT_LABEL} from './news-fold.mjs';
import {ensureReads, readState, markRead, onReads} from './news-reads.js';
import {createNowDetail} from './now-detail.js';
import {createNowHighlights} from './now-highlights.js';
import {createNowMemos} from './now-memos.js';
import {shortDay} from './text-highlights-model.mjs';
import {notify} from './small-notice.js';
import {openTelegramItem} from './source-open.js';
import {createNowInterests} from './now-interests.js';
import {createNowHidden} from './now-hidden.js';
import {bindNowRows, hoverActsHtml} from './now-row-acts.js';
import {readOutsideMarks, canDeleteNews} from './now-marks.js';
import {readOutsideArticles, readOutsideOne, readNewsArticles, readNewsOne, findNewsArticles, findOutsideArticles} from './feed-shared.js';
import {createFind} from './news-find.js';
import {FIND_LIMIT, FIND_EMPTY, FIND_SHORT, findTab, sinceIso, mergeFound} from './news-find-model.mjs';
import {chevHtml} from './fold-chevron.mjs';
import {newsPage} from './feed-shared-model.mjs';
import {fillGestureArea} from './gesture-fill.js';
import {sortByName} from './name-order.mjs';
// UI-검색창하나로(S70-54): 찾기 칸은 맨 위 칸(화면 찾기 등록), [매체 ▾]·⋯는 맨 위 줄 단추 자리(screen-find.js 상자)로.
import {registerScreenFind, refreshScreenFind, toolsBox} from './screen-find.js';
// OUTSIDE-바깥성명 ④ 화면 1(설계 docs/design/outside-statements.md 4절): #outsideView의 유일한 그리기 주인(News 메뉴 껍데기 — S51-17 P5에서 메뉴 이름 'News'·주소 ?view=news).
// S51-8 NEWS-전면개편 P4b(설계 docs/design/news-overhaul.md 6.1·6.3·6.4절, 시안 docs/design/mockups/news-overhaul.html ①·③):
// - 탭 [전체][사회운동][언론][보관](now-model.mjs NOW_TABS). 폰은 아래 떠 있는 탭 줄, 폴드 펼침(761~1199px)은 오른쪽 아래, PC(1200px~)는 위(명진 11/06 탭 자리 규칙).
//   좌우 밀기 = 탭 이동(글 줄 위 밀기는 숨기기·보관이 갖는다). 고른 탭은 서버 view_prefs.news_tab. news_tab이 없으면 옛 now_tab을 바꿔 한 번 옮긴다(옛 값은 지우지 않음).
// - 위 줄: 찾기 칸 하나 'News 찾기 — 제목·문장'. 탭마다 한 길(S63-11): [전체]·[언론]은 서버 찾기(news-find.js — 최근 30일 + 보관한 글의 제목·한국어 제목·요약),
//   [사회운동]·[보관]·[밑줄]은 지금 보이는 목록에서 제목 거르기 + Enter = 문장 찾기(app_outside_search·expand — 결과 칸은 outside-search.js)
//   + [매체: 전체 ▾](자료실 분류 창과 같은 부품 library-move-picker.js, 묶음 → 매체, 화면 메모리만) + ⋯(지금 채우기·단체 켜고 끄기·매체 켜고 끄기·키워드·별표 폴더·관심 주제).
// - 줄: 날짜 묶음 → 흰 상자 안 줄(news-row.mjs). 매체 색 띠·같은 색 이름·분류 꼬리표·시각·별표(news-colors.mjs). 안 읽은 글 굵게·읽은 글 흐리게(news-reads.js, 상세를 열면 읽음).
// - 각 탭 칸 안: [전체]·[사회운동] 이 모듈, [언론] news-clipping.js, [밑줄] now-highlights.js(S53-5 — 원문에서 고른 글 모아보기, 마지막 탭으로 기억하지 않음), [메모] now-memos.js(S69-70 — 메모 있는 글, 기억하지 않음). 상세 칸은 now-detail.js 하나(요약 · 시사점 · 원문 전체, S51-14 P4c — 연 글은 주소 ?item=). 관심 주제 칸은 now-interests.js.
// - 단체 켜고 끄기 칸: 카탈로그(서버 outside-feed ?action=catalog) 단체마다 켬/끔(서버 표 app_outside_sources) + 마지막으로 읽은 시각·실패 표시. 뒤로가기 한 번 = 목록(KPTURouter.layer).
// - 들어오면 본 시각(app_outside_seen, 알림 줄 '새 성명 n건'의 기준)을 지금 시각으로 바꿔 둔다(서버 저장). 줄의 '새' 표시는 읽음 굵기(news-reads.js)로 바뀌었다.
// - S63-11: [사회운동]은 국내 단체 글 먼저, 국제(외국 매체) 글은 아래 접힌 '국제' 묶음(펼침은 화면 메모리 — 새 서버 기억 칸은 DB 검사 변경이 필요해 이번엔 안 씀).
//   PC 두 칸의 오른쪽은 지금 탭 목록에 있는 글만 — 탭을 옮겨 그 탭 목록에 없는 글이면 비우고 한 줄 안내(data-detail="empty"). 주소 ?item= 글은 그 글의 탭으로 맞춘다.
// 바깥에서 온 글은 모두 글자로만 그린다(esc). 로그에 글 제목·본문을 남기지 않는다. 기기 저장 없음.

(() => {
if (window.KPTUOutside) return;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MORE = '<span class="more-dots" aria-hidden="true">⋯</span>';
const POST_COLS = 'id,source_key,kind,lang,title,title_ko,url,published_at,fetched_at,summary_ko,key_sentences,has_body,author';
const NEWS_COLS = 'id,lane,url,title,lang,publisher,source_key,published_at,scrapped_at,created_at,state,summary,body_kind,title_ko,starred_at,author,manual_at,origin';
const SOURCE_COLS = 'source_key,enabled,last_ok_at,last_error';
const PANEL = Object.freeze({all: 'nowPanelAll', movement: 'osPanelNew', media: 'nowPanelNews', marks: 'nowPanelMarks', memos: 'nowPanelMemos'});

const TABS_HTML = NOW_TABS.map((t, i) => `<button type="button" role="tab" class="ds-seg-btn" id="osTab-${t.id}" data-os-tab="${t.id}" aria-selected="${i === 0}" aria-controls="${PANEL[t.id]}"${i ? ' tabindex="-1"' : ''}>${t.label}</button>`).join('');
// S68-28(명진 11/23 "여기서 보관 자체를 없앴으면"): 탭 줄 끝 보관 길(옛 [보관] 탭 자리)은 없앴다 — 읽을 거리로 보낸 글은 메뉴 '읽을 거리'에서 본다.
function install() {
  if (document.getElementById('outsideView')) return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend', `<section id="outsideView" class="view-panel hidden" aria-labelledby="osTitle">
<h2 id="osTitle" class="screen-title">읽을 거리</h2>
<div id="outsideRoot" class="os now" data-mode="list" data-tab="all" data-detail="closed">
<div class="os-tabs ds-seg" role="tablist" aria-label="읽을 거리 보기" data-os-tabs>${TABS_HTML}</div>
<div class="now-main" id="nowMain">
<div id="osPanelSearch" class="osq" data-os-search aria-label="문장 찾기" hidden></div>
<div id="nowPanelAll" role="tabpanel" aria-labelledby="osTab-all" data-now-panel-all><div class="os-list" data-nw-all aria-label="새로 온 글"></div></div>
<div id="osPanelNew" role="tabpanel" aria-labelledby="osTab-movement" data-os-panel-new hidden>
<p class="os-when" data-os-when hidden></p>
<div class="os-list" data-os-list aria-label="사회운동 글"></div>
<div class="os-sources" data-os-sources aria-label="단체 켜고 끄기"></div>
</div>
<div id="nowPanelNews" role="tabpanel" aria-labelledby="osTab-media" data-now-panel-news hidden></div>
<div id="nowPanelMarks" class="now-marks" role="tabpanel" aria-labelledby="osTab-marks" data-now-panel-marks hidden></div>
<div id="nowPanelMemos" class="now-memos" role="tabpanel" aria-labelledby="osTab-memos" aria-label="메모 있는 글" data-now-panel-memos hidden></div>
<div class="now-interests now-hidden" data-now-hidden hidden><div class="os-src-head"><button type="button" class="os-back" data-now-hidden-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>숨긴 글</b><span class="os-faint" data-now-hidden-count></span></div><div data-now-hidden-box></div></div>
<div class="now-interests" data-now-interests hidden><div class="os-src-head"><button type="button" class="os-back" data-now-interests-back aria-label="목록으로"><span aria-hidden="true">‹</span></button><b>관심 주제</b></div><div data-now-interests-box></div></div>
</div>
<div class="now-detail" id="nowDetail" data-now-detail aria-label="글 상세"></div>
</div></section>`);
}
install();

const root = document.getElementById('outsideRoot');
// S70-54: 옛 찾기 줄(.nw-top)의 [매체 ▾]·⋯는 맨 위 줄 단추 상자에 산다(그리기·누르기는 이 모듈 그대로). 찾기 칸은 맨 위 칸이 겸한다.
const tools = toolsBox('outside', 'outside');
tools.innerHTML = `<button type="button" class="nw-dd secondary sf-chip" data-nw-media aria-haspopup="dialog" aria-expanded="false"></button><button type="button" class="os-more icon-btn sf-more" data-os-more data-ctx="screen" aria-haspopup="true" aria-expanded="false" aria-label="읽을 거리 메뉴">${MORE}</button>`;
const $ = sel => root?.querySelector(sel) || tools.querySelector(sel);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const scopeOf = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const fresh = () => ({scope: '', catalog: null, catalogFailed: false, sources: new Map(), sourcesLoaded: false, sourcesFailed: false,
  posts: [], postsLoaded: false, postsFailed: false, end: true, more: false, seenRead: false, media: MEDIA_ALL,
  news: [], newsRaw: 0, newsLoaded: false, newsFailed: false, newsEnd: true, newsMeta: {catalog: [], enabled: []},
  query: '', searching: false, saving: new Set(), saveFailed: '', mode: 'list', reading: new Set(), readNote: new Map(), tab: '', tabSet: false, marks: new Map(), intlOpen: false});
let state = fresh(), loadSeq = 0, newsSeq = 0, layer = null;

// ---------- 서버 읽기·쓰기(모두 작업공간 소유자 RLS · Edge는 사용자 로그인 확인) ----------
const q = v => encodeURIComponent(v);
async function readCatalog() {
  const data = await rt().api('/functions/v1/outside-feed?action=catalog', {method: 'POST', body: {}, singleFlight: false, timeoutMs: 20000});
  return normalizeCatalog(data);
}
// 뉴스 클리핑 매체(news- 키)는 같은 표에 있지만 이 화면 단체가 아니다 → 서버에서 빼고 읽는다(화면 계산도 ownSourceRows로 한 번 더).
const readSources = w => rt().api(`/rest/v1/app_outside_sources?workspace_id=eq.${q(w)}&source_key=not.like.news-*&select=${SOURCE_COLS}`, {singleFlight: false});
// NEWS-모두에게열기 ③: 사회운동 글·언론 기사는 공용 표(모두 같은 목록), 별표·보관·숨김·읽음은 내 표시(feed-shared.js 한 길).
function readPosts(w, keys, offset) {
  if (keys && !keys.length) return Promise.resolve([]);
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return readOutsideArticles({cols: POST_COLS, filter, order: 'published_at.desc.nullslast,fetched_at.desc,id.desc', limit: PAGE_SIZE + 1, offset});
}
// [전체] 탭의 언론 기사(내가 숨긴 것 빼고, 최신 먼저). 매체를 고르면 그 news- 키만. 돌려줌: {rows, raw, end}(newsPage).
async function readNews(w, keys, offset) {
  if (keys && !keys.length) return {rows: [], raw: 0, end: true};
  const filter = keys ? `&source_key=in.(${keys.map(q).join(',')})` : '';
  return newsPage(await readNewsArticles({cols: NEWS_COLS, filter, order: 'created_at.desc,id.desc', limit: PAGE_SIZE + 1, offset}), PAGE_SIZE);
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
const dotOf = (kind, id) => (kind === 's' ? outsideBar(id, state.catalog || []) : kind === 'n' ? newsBar({source_key: id}, newsCatalog()) : kind === 'g' ? colorVar(familyOfGroup(id), 0) : colorVar('press', id === 'foreign' ? 1 : 0));
const search = createOutsideSearch({box: $('[data-os-search]'), nameOf, workspaceOf, keysOf: () => outsideKeys()});
// S63-11 [전체] 서버 찾기(위 찾기 칸): 언론 기사 + 사회운동 글, 최근 30일 + 보관한 글(기간 없음)의 제목·한국어 제목·요약. 고른 매체가 있으면 그것만.
const NO_FOUND = Object.freeze({recent: [], kept: []});
const allFind = createFind({
  run: async words => {
    const since = sinceIso(Date.now()), nk = newsKeys(), ok = outsideKeys();
    const [n, p] = await Promise.all([
      nk && !nk.length ? NO_FOUND : findNewsArticles(words, NEWS_COLS, {since, limit: FIND_LIMIT, keys: nk}),
      ok && !ok.length ? NO_FOUND : findOutsideArticles(words, POST_COLS, {since, limit: FIND_LIMIT, keys: ok}),
    ]);
    const news = mergeFound(n.recent, n.kept, r => Date.parse(r?.created_at || ''));
    const posts = mergeFound(p.recent, p.kept, r => Date.parse(r?.published_at || r?.fetched_at || ''));
    void ensureReads([...news.map(r => ({type: 'news', id: r.id})), ...posts.map(r => ({type: 'outside', id: r.id}))]);
    return {news, posts};
  },
  changed: () => { if (state.mode === 'list' && state.tab === 'all') paintList(); },
});
const findNews = () => allFind.get().result?.news || [];
const findPosts = () => allFind.get().result?.posts || [];
let mediaPicker = null;
const picker = () => (mediaPicker ||= createMovePicker({esc, id: 'nwMediaPicker', label: '매체 선택', findLabel: '매체 찾기', foot: false, currentTag: '선택됨', folderIcons: false}));
function paintMediaButton() {
  const b = $('[data-nw-media]');
  if (!b) return;
  b.textContent = `매체: ${mediaName(state.media, {oc: state.catalog || [], nc: newsCatalog()})} ▾`;
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
  if (state.query && state.searching && !findTab(state.tab)) search.run(state.query);
  if (state.tab === 'all' && allFind.active()) allFind.again();
}

// ---------- 상세·보관·관심 주제(공용 부품, 각 칸의 그리기 주인) ----------
// S70-58 READ-두칸보기(명진 11/26 "왼쪽 목록 오른쪽 본문 · 드래그 폭 조절 · 폴드 펼침"): 목록 | 상세 두 칸은 앱 공용 칸 나누기 폭(screen-width.mjs, 600px~ —
// 조직 관리·자료실과 같은 값)부터. 그 아래(폰·접은 폴드)만 한 칸(누르면 상세 전체 화면, 뒤로 = 목록). PHONE(~760px)은 폰 틀 판정(메뉴 창 기록)에만 남는다.
const PC = window.matchMedia(SPLIT_QUERY);
const NARROW = window.matchMedia(NARROW_QUERY);
const FRAME_PC = window.matchMedia('(min-width:761px)'); // 앱 틀이 PC인가(아니면 폴드 펼침 — 상세 칸 붙이기를 follow-pane narrow로)
const PHONE = window.matchMedia('(max-width:760px)');
const DESK = window.matchMedia('(min-width:1200px)'); // PC: 탭 줄이 위(밀기는 탭 줄 위에서만). 폰·폴드 펼침은 줄 밖 어디서나 밀어 탭 이동.
const mainBox = root?.querySelector('#nowMain'), detailBox = root?.querySelector('[data-now-detail]');
// 글 하나 → 상세 머리(꼬리 줄·제목·원문). 사회운동 글과 뉴스 기사 두 쪽 모두 여기서(보관 탭·함께 볼 것도 같은 길).
function describe(type, row) {
  if (type === 'news') {
    const v = itemView(row || {});
    // 꼬리 줄 = 매체 · 분류 · 날짜 · 기자(손으로 넣은 기사만, S67-02). 손으로 넣은 기사는 머리 줄에 작은 '직접 넣음'(now-detail.js).
    return {meta: [v.publisher, tagLabel(newsTag(row)) || '기사', dateText(row?.published_at || row?.created_at), typeof row?.author === 'string' ? row.author.trim().slice(0, 60) : ''], title: v.title, origTitle: v.origTitle, titleLang: v.titleLang, lang: row?.lang || 'ko', url: v.url, at: row?.published_at || row?.created_at || null, manual: !!row?.manual_at, mine: canDeleteNews(row)};
  }
  const v = postView(row || {}), tag = postTag(row || {});
  // 꼬리 줄 = 매체 · 분류(성명은 글 종류 그대로, 국제는 '국제 · 종류') · 날짜 · 글쓴이(있을 때만).
  const kind = tag === 'intl' ? `${tagLabel(tag)} · ${v.kind}` : (tag && tag !== 'statement' ? tagLabel(tag) : v.kind);
  return {meta: [nameOf(row?.source_key), kind, dateText(row?.published_at), typeof row?.author === 'string' ? row.author.trim().slice(0, 60) : ''], title: v.title, origTitle: v.origTitle, titleLang: row?.lang === 'en' && !row?.title_ko ? 'en' : '', lang: row?.lang || 'ko', url: v.url, at: row?.published_at || row?.fetched_at || null};
}
// 줄 하나(세 목록 공통 모양 news-row.mjs). 사회운동 글·언론 기사 → 그릴 값.
// memo = [메모] 탭 줄의 메모 첫 줄(S69-70, 꼬리 줄 아래 작게). day = 시각 대신 날짜(MM/DD — 날짜 묶음 머리가 없는 [메모] 탭).
function rowOf(type, row, {openAttr, rowAttr, acts = '', star = false, memo = '', day = false} = {}) {
  const item = {type, id: row.id}, sel = detail.current();
  const base = {key: itemKey(item), openAttr, openId: row.id, rowAttr, rowId: row.id, read: readState(item), open: !!sel && itemKey(sel) === itemKey(item), acts, star, memo};
  if (type === 'news') {
    const v = itemView(row);
    return rowHtml({...base, title: v.title, titleLang: v.titleLang, src: v.publisher, color: newsColor(row, newsCatalog()), bar: newsBar(row, newsCatalog()), tag: newsTag(row), time: day ? shortDay(row.published_at || row.created_at) : v.time, star: !!row.starred_at, hit: hitOf(type, row)}, esc);
  }
  const v = postView(row);
  return rowHtml({...base, title: v.title, titleLang: row.lang === 'en' && !row.title_ko ? 'en' : '', src: nameOf(row.source_key), badge: v.tag, color: outsideColor(row.source_key, state.catalog || []), bar: outsideBar(row.source_key, state.catalog || []), tag: postTag(row), time: day ? shortDay(row.published_at || row.fetched_at) : v.time, star: star || !!state.marks?.get(row.id)?.starred, hit: hitOf(type, row)}, esc);
}
// 확정 관심 주제에 걸린 주제 이름(줄 끝 작은 표시). NEWS-도배막기 C: 같은 값으로 위 칸 '관심 주제'에 올린다(news-fold.mjs liftRelated).
function hitOf(type, row) {
  const v = type === 'news' ? itemView(row || {}) : postView(row || {});
  return interestHit([v.title, v.origTitle, v.summary], interests.topics());
}
// NEWS-도배막기 A: 펼친 매체 묶음(화면 메모리만, 다시 그려도 그대로). [전체]·[사회운동]·[언론] 세 목록이 이 하나를 쓴다(KPTUNow.foldOpen).
const folds = new Set();
// 줄 묶음 → HTML. 같은 언론 매체가 연달아 나오면 '○○ 외 N건'으로 접는다(news-row.mjs runsHtml). rowFn = 줄 하나 그리기.
function foldedHtml(entries, rowFn) {
  return runsHtml(foldRuns(entries), {rowOf: rowFn, keyOf: e => itemKey({type: e.type, id: e.row.id}), nameOf: e => (e.type === 'news' ? itemView(e.row).publisher : ''), isOpen: key => folds.has(key)}, esc);
}
// S63-11(명진 11/16 '3 고쳐'): 서버에서 새로 온 뉴스 줄 내용(열기·채우기 뒤 제목 등) → 이 화면의 같은 기사 줄([전체] 목록·찾은 글)과 열린 상세 머리를 고친다.
// [언론] 칸 줄은 그 칸 주인(news-clipping.js fresh)이 고친다. from='news'는 그 칸이 보낸 것이라 되돌려 보내지 않는다.
const FRESH_COLS = ['title', 'title_ko', 'state', 'publisher', 'published_at', 'summary', 'lang', 'body_kind', 'author', 'manual_at', 'origin'];
function newsFresh(rows, {from = ''} = {}) {
  const list = (rows || []).filter(r => r && typeof r.id === 'string');
  if (!list.length) return;
  let changed = false;
  const lists = [state.news, findNews()];
  for (const r of list) for (const rowsOf of lists) for (const it of rowsOf) {
    if (it.id !== r.id || it === r) continue;
    for (const k of FRESH_COLS) if (k in r && it[k] !== r[k]) { it[k] = r[k]; changed = true; }
  }
  const c = detail.current(), mine = c?.type === 'news' ? list.find(r => r.id === c.id) : null;
  if (mine) { const head = describe('news', {...(state.news.find(x => x.id === c.id) || {}), ...mine}); if (JSON.stringify(head) !== JSON.stringify(detail.head())) detail.setHead(head); }
  if (changed) paintList();
  if (from !== 'news') window.KPTUNews?.fresh?.(list);
}
let detailLayer = null, interestsLayer = null, hiddenLayer = null, interestsAsk = 0;
const detail = createNowDetail({box: detailBox, topics: () => interests.topics(),
  onClose: () => closeDetail(),
  onChanged: (item, act) => {
    // 뉴스 별표·관심 없음은 뉴스 목록 줄과 같은 칸이라 그 목록을 다시 읽는다.
    // S67-11: [삭제]는 다른 탭에서 해도 [전체] 목록에서 빠져야 하므로 늘 다시 읽는다.
    if (item.type === 'news' && act !== 'memo') { window.KPTUNews?.refresh?.(); if (state.tab === 'all' || act === 'delete') loadNews({keep: true}); }
    if (item.type === 'outside' && act !== 'memo') loadMarks().then(() => { if (state.mode === 'list') paintList(); });
    // S69-70: [메모] 탭을 보고 있으면 메모·관심 없음이 바뀐 글을 다시 읽는다(다른 탭이면 들어올 때 읽음).
    if (state.tab === 'memos' && (act === 'memo' || act === 'dismiss' || act === 'delete')) void memos.load();
  },
  onSignal: () => askInterests(),
  onRead: (item, row) => { newsFresh([{...row, id: item.id}]); },
  onRelated: r => openRelated(r)});
// [밑줄] 탭: 줄을 누르면 그 글을 읽어 상세를 열고 그 밑줄 자리로. 텔레그램 원문 밑줄은 텔레그램 화면에서 그 방·날·소식 원문을 열고 그 밑줄 자리로
// (S61-51a, source-open.js openTelegramItem — 뒤로가기 한 번 = [밑줄] 탭).
const marks = createNowHighlights({box: root?.querySelector('[data-now-panel-marks]'), query: () => state.query, onOpen: h => openHighlight(h)});
// S69-70 [메모] 탭(메모 있는 글): 글에 [메모]로 남긴 노트를 모아 본다(저장하지 않은 글도). 줄을 누르면 그 글 상세.
const memos = createNowMemos({box: root?.querySelector('[data-now-panel-memos]'), query: () => state.query,
  rowOf: (type, row, o) => rowOf(type, row, o), colsOf: type => (type === 'news' ? NEWS_COLS : POST_COLS),
  onOpen: (item, row) => openDetail(item, describe(item.type, row))});
async function openHighlight(h) {
  if (h.source_type === 'telegram') {
    let ok = false;
    try { ok = await openTelegramItem(h.source_id, {highlight: h.id}); } catch { ok = false; }
    if (!ok) notify('원래 글을 찾지 못했어요 · 밑줄은 그대로 있어요', {record: false});
    return;
  }
  let row = null;
  try { row = await fetchItem(h.source_type, h.source_id); } catch { row = null; }
  if (!row) { notify('원래 글을 찾지 못했어요 · 밑줄은 그대로 있어요', {record: false}); return; }
  openDetail({type: h.source_type, id: row.id}, describe(h.source_type, row), {highlight: h.id});
}
// S70-62 [숨긴 글] 칸(머리 ⋯ [숨긴 글], 뒤로가기 한 번 = 목록): 다시 보이면 보이는 목록을 다시 읽는다.
const hidden = createNowHidden({box: root?.querySelector('[data-now-hidden-box]'),
  rowOf: (type, row, o) => rowOf(type, row, o), colsOf: type => (type === 'news' ? NEWS_COLS : POST_COLS),
  onOpen: (item, row) => openDetail(item, describe(item.type, row)),
  onCount: n => { const c = root?.querySelector('[data-now-hidden-count]'); if (c) c.textContent = n == null ? '' : String(n); },
  onChanged: () => { loadNews({keep: true}); loadMarks().then(() => { if (state.mode === 'list') paintList(); }); window.KPTUNews?.refresh?.(); }});
const interests = createNowInterests({box: root?.querySelector('[data-now-interests-box]'), onChanged: () => { if (state.mode === 'list') { paintList(); paintNewsTab(); } detail.paint(); }});
// 관심 주제가 바뀌면 [언론] 칸도 위 칸·표시를 다시(그 칸 주인 news-clipping.js가 그린다).
const paintNewsTab = () => { if (state.tab === 'media') window.KPTUNews?.repaint?.(); };
// 환류 기록이 쌓이면 서버가 후보를 만들지 정한다(10건 또는 저녁 6시 뒤 그날 처음 — 서버 규칙, AI를 안 부르면 한도도 안 씀). 화면은 1분에 한 번만 묻는다.
function askInterests() {
  if (Date.now() - interestsAsk < 60000) return;
  interestsAsk = Date.now();
  rt().api('/functions/v1/ai-assist', {method: 'POST', body: {kind: 'now_interests'}, singleFlight: false, timeoutMs: 60000})
    .then(r => { if (r?.added) interests.load(); }).catch(() => {});
}
let autoOpening = false;
// S63-11 PC 두 칸: 상세를 연 탭(detailFrom)과 다른 탭으로 옮기면 그 탭 목록이 다 그려진 뒤 한 번(fitWanted) 열린 글이 그 목록에 있는지 본다.
let detailFrom = '', fitWanted = false;
function openDetail(item, head, opts = {}) {
  if (!item || !head) return;
  const shown = !!detail.current();
  detailFrom = state.tab; fitWanted = false;
  detail.open(item, head, opts);
  // 상세를 열면 읽음(app_feed_reads, 이미 있으면 서버가 그대로 둔다). PC에서 맨 위 글을 저절로 연 것은 읽은 것으로 치지 않는다.
  if (!autoOpening) markRead(item);
  if (root) root.dataset.detail = 'open'; refreshScreenFind();
  mountSplit();
  // 폴드 펼침(600~760px, 폰 틀): 오른쪽 칸을 화면 위에 붙이고 그 칸만 스크롤(공용 follow-pane narrow — PC 틀은 now.css가 붙인다).
  if (PC.matches && !FRAME_PC.matches && detailBox) followPane(detailBox, {narrow: true, reset: !shown});
  // 폰(좁은 화면): 상세가 전체 화면 — 뒤로가기 한 번 = 목록(라우터 겹). PC·폴드 펼침은 오른쪽 칸이라 겹 없음.
  if (!PC.matches) { detailLayer ||= window.KPTURouter?.layer?.open('now-detail', {reopen: () => openDetail(item, head, {from: opts.from}), close: () => { detailLayer = null; closeDetail({fromLayer: true}); return true; }}) || null; window.scrollTo({top: 0, behavior: 'instant'}); }
  // 주소에 연 글(?item=outside:<id>) — 새로고침해도 같은 글. PC에서 맨 위 글을 저절로 연 것은 남기지 않는다.
  if (!autoOpening) window.KPTURouter?.setPlace?.('outside', {item: itemKey(item)});
  // NAV-PC뒤로직전: on PC·the unfolded Fold a post the person picked in the list is a back step of its own (router pick).
  if (opts.picked && PC.matches && !autoOpening) window.KPTURouter?.pick?.record?.('outside', {item: itemKey(item)}, {fromNone: !shown});
  markOpen();
}
// ‹ › over a picked post opens it again; a post no longer there, or the "no post" step, leaves the list only.
window.KPTURouter?.pick?.on?.('outside', ({item = null} = {}) => {
  if (!PC.matches) return true;
  const m = /^(outside|news):(.+)$/.exec(item || ''), now = detail.current();
  if (!m || !isUuid(m[2])) { if (now) closeDetail(); return true; }
  if (now && itemKey(now) === item) return true;
  fetchItem(m[1], m[2]).then(row => {
    if (window.KPTURouter?.current !== 'outside') return;
    if (row) openDetail({type: m[1], id: row.id}, describe(m[1], row)); else if (detail.current()) closeDetail();
  }).catch(() => {});
  return true;
});
function closeDetail({fromLayer = false} = {}) {
  const was = detail.current();
  detail.close();
  if (root) root.dataset.detail = 'closed'; refreshScreenFind();
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
// 글 하나를 id로 읽는다(함께 볼 것·주소·밑줄에 남은 글 — 옛 id면 공용 id로 바꿔 읽음, 돌려준 줄의 id가 공용 id). 없으면 null.
const fetchItem = (type, id) => (type === 'news' ? readNewsOne(id, NEWS_COLS) : readOutsideOne(id, POST_COLS));
async function openRelated(r) {
  if (r.kind === 'outside' || r.kind === 'news') {
    try {
      const row = await fetchItem(r.kind, r.id);
      if (row) openDetail({type: r.kind, id: row.id}, describe(r.kind, row));
    } catch { /* 못 읽으면 그대로 */ }
    return;
  }
  const view = {update: 'home', library: 'library'}[r.kind];
  if (view) window.KPTURouter?.go?.(view, {source: 'delegated'});
}
function mountSplit() {
  if (!root) return;
  // S70-58: 기본 몫은 PC 틀 3 : 2(목록 넓게), 펼친 폴드(약 690px) 2 : 3(글 칸이 너무 좁지 않게 — 폴드 칸 최소 폭은 now.css). 끈 폭은 같은 서버 값(split_ratio.now) 하나.
  const fold = !FRAME_PC.matches;
  mountSplitResize({container: root, name: 'now', label: '목록과 상세 칸 폭 조절', query: SPLIT_QUERY, columns: [
    {el: () => mainBox, varName: '--ds-split-list', minVar: '--ds-split-list-min', minFallback: 320, share: fold ? 2 : 3, id: 'nowMain'},
    {el: () => detailBox, varName: '--ds-split-detail', minVar: '--ds-split-detail-min', minFallback: 320, share: fold ? 3 : 2},
  ], active: () => PC.matches && (root.dataset.detail === 'open' || root.dataset.detail === 'empty') && root.isConnected && !document.getElementById('outsideView')?.classList.contains('hidden')});
}
// 폴드를 펼치거나 창을 넓혀 두 칸 폭이 되면: 경계를 붙이고, 열린 글이 없으면 맨 위 글을 오른쪽에(탭마다 한 번 — autoOpenTop 규칙 그대로).
PC.addEventListener?.('change', () => { if (!PC.matches || window.KPTURouter?.current !== 'outside') return; mountSplit(); autoOpenTop(); });

// ---------- 관심 주제 칸(같은 화면 안, 뒤로가기 한 번 = 목록) ----------
function openInterests() {
  if (state.mode === 'sources') { closeLayer(); state.mode = 'list'; }
  if (state.mode === 'hidden') closeHiddenLayer();
  state.mode = 'interests';
  interestsLayer ||= window.KPTURouter?.layer?.open('now-interests', {reopen: () => openInterests(), close: () => { interestsLayer = null; backFromInterests(); return true; }}) || null;
  paint();
  interests.paint();
  interests.load();
  $('[data-now-interests-back]')?.focus({preventScroll: true});
}
// ---------- 숨긴 글 칸(S70-62, 같은 화면 안, 뒤로가기 한 번 = 목록) ----------
function openHidden() {
  if (state.mode === 'sources') { closeLayer(); state.mode = 'list'; }
  if (state.mode === 'interests') { const l = interestsLayer; interestsLayer = null; l?.close(); }
  state.mode = 'hidden';
  hiddenLayer ||= window.KPTURouter?.layer?.open('now-hidden', {reopen: () => openHidden(), close: () => { hiddenLayer = null; backFromHidden(); return true; }}) || null;
  paint();
  hidden.paint();
  void hidden.load();
  window.scrollTo({top: 0, behavior: 'instant'});
  $('[data-now-hidden-back]')?.focus({preventScroll: true});
}
function closeHiddenLayer() { const l = hiddenLayer; hiddenLayer = null; l?.close(); }
function backFromHidden() {
  if (state.mode !== 'hidden') return;
  state.mode = 'list';
  paint();
  $('[data-os-more]')?.focus({preventScroll: true});
}
function backFromInterests() {
  if (state.mode !== 'interests') return;
  state.mode = 'list';
  paint();
  root?.querySelector(`[data-os-tab="${state.tab || 'all'}"]`)?.focus({preventScroll: true});
}

// ---------- 목록 그리기 ----------
// 날짜 묶음 → 흰 상자 안 줄. entries = [{type, row}] (그려 둘 순서대로). 묶음 머리에 안 읽은 글 수.
function daysHtml(entries, now, {lift = true} = {}) {
  const rowFn = e => rowOf(e.type, e.row, {openAttr: 'data-now-open', acts: hoverActsHtml({isSaved: e.type === 'news' ? !!e.row.starred_at : markOf(e.row.id).starred, canDelete: e.type === 'news' && canDeleteNews(e.row), canEdit: e.type === 'news'})});
  const unreadOf = list => list.filter(e => readState({type: e.type, id: e.row.id}) === false).length;
  // NEWS-도배막기 C: 관심 주제에 걸린 최근 글은 위 칸에 먼저(시간순 그대로), 나머지는 아래 날짜별.
  const atOf = e => (e.type === 'news' ? whenOf(e.row) : Date.parse(e.row.published_at || ''));
  const {top, rest} = lift ? liftRelated(entries, e => !!hitOf(e.type, e.row), atOf, now) : {top: [], rest: entries};
  const head = top.length ? dayHtml(LIFT_LABEL, foldedHtml(top, rowFn), unreadOf(top), esc) : '';
  const wrapped = rest.map(e => ({...e, published_at: e.type === 'news' ? (whenOf(e.row) ? new Date(whenOf(e.row)).toISOString() : '') : e.row.published_at}));
  return head + groupPosts(wrapped, now).map(g => dayHtml(g.label, foldedHtml(g.items, rowFn), unreadOf(g.items), esc)).join('');
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
  const ts = Date.now(), entries = list => list.map(row => ({type: 'outside', row}));
  if (!intlSplitOn(state.media, state.catalog || [])) return daysHtml(entries(shown), ts) + more;
  // S63-11: 국내 단체 글 먼저, 국제 글은 아래 접힌 '국제' 묶음(펼쳤을 때만 줄을 그린다 — 접힌 글이 PC 맨 위 글로 저절로 열리지 않게).
  const {home, intl} = splitIntl(shown, state.catalog || []);
  const unread = intl.filter(p => readState({type: 'outside', id: p.id}) === false).length;
  const fold = intl.length ? `<details class="os-intl" data-os-intl${state.intlOpen ? ' open' : ''}><summary class="os-intl-sum">${esc(INTL_LABEL)} · ${intl.length}건${unread ? ` · 새 글 ${unread}` : ''}${chevHtml(false)}</summary>${state.intlOpen ? daysHtml(entries(intl), ts, {lift: false}) : ''}</details>` : '';
  return (home.length ? daysHtml(entries(home), ts) : '') + fold + more;
}
// [전체] 찾은 글(서버 찾기): 사회운동 글 + 언론 기사를 시각 최신 순으로, 날짜 묶음만(관심 주제 위 칸은 목록에서만).
function allFindHtml() {
  const f = allFind.get();
  if (f.short) return emptyHtml(FIND_SHORT, {attrs: 'data-nw-empty'});
  if (f.failed) return failHtml({retry: 'data-nw-find-retry'});
  if (!f.done) return waitHtml({rows: 4, h: 44});
  const posts = findPosts().filter(p => !markOf(p.id).dismissed).map(row => ({id: row.id, at: row.published_at || row.fetched_at || '', row}));
  const news = findNews().map(row => ({id: row.id, at: whenOf(row) ? new Date(whenOf(row)).toISOString() : '', row}));
  const merged = mergeFeed(posts, news);
  if (!merged.length) return emptyHtml(FIND_EMPTY, {attrs: 'data-nw-empty'});
  return daysHtml(merged, Date.now(), {lift: false});
}
// [전체]: 사회운동 글 + 언론 기사를 한 줄로(시각 최신 순).
function allHtml() {
  if (allFind.active()) return allFindHtml();
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
    const members = sortByName(state.catalog.filter(s => s.group === g.key)); // 묶음 안은 가나다(NEWS-출처목록가나다), 묶음 순서는 GROUPS 그대로
    if (!members.length) return '';
    return `<section class="os-src-group" aria-label="${esc(g.label)}"><h3 class="os-src-group-head">${esc(g.label)}</h3>${members.map(s => {
      const row = state.sources.get(s.key), on = row?.enabled === true, busy = state.saving.has(s.key);
      const reading = state.reading.has(s.key), note = reading ? '' : state.readNote.get(s.key) || sourceState(row);
      const bad = row?.last_error ? ' is-bad' : '';
      return `<div class="os-src-row"><button type="button" class="os-switch" role="switch" data-os-source="${esc(s.key)}" aria-checked="${on}"${busy ? ' disabled' : ''}><span class="os-switch-dot" aria-hidden="true"></span><span class="os-src-name">${esc(s.name)}</span></button>${reading ? `<span class="os-src-note" data-os-reading>${waitInlineHtml()}</span>` : note ? `<span class="os-src-note${bad}">${esc(note)}</span>` : ''}</div>`;
    }).join('')}</section>`;
  }).join('');
  return head + (state.saveFailed ? failHtml({text: '저장하지 못했어요', reason: state.saveFailed}) : '') + groups;
}

// 탭 줄과 칸 보이기(단체 켜고 끄기·관심 주제 칸에서는 탭 줄·위 줄을 감춘다).
function paintTabs() {
  if (!root) return;
  const tab = state.tab || 'all';
  root.dataset.tab = tab;
  const list = state.mode === 'list';
  const tabs = $('[data-os-tabs]');
  if (tabs) tabs.hidden = !list;
  refreshScreenFind();
  root.querySelectorAll('[data-os-tab]').forEach(b => { const on = b.dataset.osTab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  // 단체 켜고 끄기 칸은 [사회운동] 칸 안이다.
  const show = (sel, on) => { const el = $(sel); if (el) el.hidden = !on; };
  show('[data-os-panel-new]', state.mode === 'sources' || (list && tab === 'movement'));
  show('[data-now-panel-all]', list && tab === 'all');
  show('[data-now-panel-news]', list && tab === 'media');
  show('[data-now-panel-marks]', list && tab === 'marks');
  show('[data-now-panel-memos]', list && tab === 'memos');
  show('[data-os-search]', list && state.searching && !!state.query && !findTab(tab));
  show('[data-now-interests]', state.mode === 'interests');
  show('[data-now-hidden]', state.mode === 'hidden');
  paintMediaButton();
}
// 관심 주제 후보는 목록 위 줄이 아니라 화면 머리 ⋯ 메뉴 안 '관심 주제 후보 n' 한 줄(S69-70, 명진 11/24 20:45 "줄 차지하는게 보기싫음 / ... 안에 넣어줘"). 0개면 그 줄도 없다.
// 탭 하나 보이기. save=true면 서버에 마지막 탭으로 기억(view_prefs.news_tab). [언론]·[밑줄]은 처음 보일 때 그 칸 주인이 불러온다.
function setTab(tab, {focus = false, save = true} = {}) {
  tab = keepNowTab(tab);
  const changed = state.tab !== tab;
  state.tab = tab; state.tabSet = true;
  const media = keepMedia(tab, state.media), mediaChanged = media !== state.media;
  state.media = media;
  if (changed && detail.current() && detailFrom !== tab) fitWanted = true;
  if (tab === 'all') allFind.set(state.query);
  paintTabs();
  if (changed || mediaChanged) {
    if (tab === 'media') window.KPTUNews?.enter?.();
    else if (tab === 'marks') { marks.paint(); void marks.load(); }
    else if (tab === 'memos') { memos.paint(); void memos.load(); }
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
onReads(() => { paintList(); });
// UI-Now PC정돈(명진 11/03 09:39): PC·폴드 펼침에서 상세 칸이 비어 안내문만 있지 않게 — 목록이 보이면 맨 위 글을 바로 연다(탭마다 이 화면에 들어온 뒤 한 번,
// 닫으면 다시 열지 않음). 글이 없는 탭(빈 목록)은 상세 칸을 열지 않고 목록이 폭을 쓴다(CSS가 data-detail="closed"일 때 한 칸).
const autoOpened = new Set();
let autoOpenWaiting = false; // 열린 메뉴가 닫힌 뒤 맨 위 글 열기를 한 번만 걸어 둠
let restoring = false; // 주소에 남은 글을 다시 열기(restorePlaced)
// S63-11: 탭 목록이 다 그려졌으면(줄·빈 목록·실패 표시) 열린 글이 그 목록에 있는지 한 번 본다. 없으면 오른쪽을 비우고 한 줄 안내.
const settled = panel => !!panel.querySelector('.now-row, details[data-os-intl], [data-wait-empty], [data-wait-fail]') && !panel.querySelector('kptu-wait:not(.wait-inline)');
function fitDetail() {
  if (!fitWanted || restoring) return;
  const c = detail.current(), panel = $(`#${PANEL[state.tab] || ''}`);
  if (!c || detailFrom === state.tab) { fitWanted = false; return; }
  const gather = state.tab === 'marks' || state.tab === 'memos'; // 모아보기 탭은 두 종류 글을 다 담아 열린 글을 그대로 둔다
  if (!gather && (!panel || !settled(panel))) return;
  fitWanted = false;
  if (!gather && panel.querySelector(`.now-row[data-nw-key="${CSS.escape(itemKey(c))}"]`)) { detailFrom = state.tab; return; }
  clearDetail(panel);
}
function clearDetail(panel) {
  detail.close();
  if (root) root.dataset.detail = PC.matches && panel?.querySelector('.now-row') ? 'empty' : 'closed'; refreshScreenFind();
  mountSplit();
  window.KPTURouter?.setPlace?.('outside', {item: null});
  markOpen();
}
function autoOpenTop() {
  if (PC.matches && state.mode === 'list') fitDetail();
  if (!PC.matches || state.mode !== 'list' || detail.current() || autoOpened.has(state.tab) || restoring) return;
  // STAB-갈래4흔들림: 목록이 오기 전에 ⋯ 같은 메뉴를 열어 두었으면, 아래 btn.click()이 '바깥 누름'으로 그 메뉴를 닫아 버린다(고르려던 항목이 사라짐).
  // 열린 메뉴가 닫힌 뒤에 한 번 다시 본다.
  if (anyMenuOpen()) { if (!autoOpenWaiting) { autoOpenWaiting = true; whenMenusClosed(() => { autoOpenWaiting = false; autoOpenTop(); }); } return; }
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
  search.reset(); allFind.reset();
  detail.reset(); marks.reset(); memos.reset(); interests.reset(); folds.clear();
  detailFrom = ''; fitWanted = false;
  if (root) root.dataset.detail = 'closed'; refreshScreenFind();
  refreshScreenFind();
}

// 숨기거나 별표(= 보관)한 사회운동 글 표시(줄 밀기·상세 단추가 같은 서버 표시를 쓴다). 숨긴 글은 목록에서 감추고, 별표한 글은 ★와 오른쪽 밀기 '보관 풀기'.
async function loadMarks() {
  const scope = state.scope;
  try {
    const rows = await readOutsideMarks();
    if (scope !== state.scope || !Array.isArray(rows)) return;
    state.marks = new Map(rows.map(r => [r.post_id, {starred: !!r.starred_at, dismissed: !!r.dismissed_at}]));
  } catch { /* 표시를 못 읽으면 목록은 그대로 */ }
}
const markOf = id => state.marks.get(id) || {starred: false, dismissed: false};
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
    const got = await readNews(w, newsKeys(), append ? state.newsRaw : 0);
    if (seq !== newsSeq) return;
    const page = got.rows;
    state.news = append ? [...state.news, ...page.filter(p => !state.news.some(x => x.id === p.id))] : page;
    state.newsRaw = (append ? state.newsRaw : 0) + got.raw;
    state.newsEnd = got.end;
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
    // S63-11: 그 글이 들어 있는 탭으로 맞춘다(기억한 마지막 탭은 그대로 — 저장하지 않음).
    const want = tabForItem(m[1], state.tab || 'all');
    if (want !== (state.tab || 'all')) setTab(want, {save: false});
    autoOpened.add(state.tab);
    openDetail({type: m[1], id: row.id}, describe(m[1], row));
  }).catch(() => {}).finally(() => { restoring = false; autoOpenTop(); });
}
async function openWanted(w, {picked = true, from = ''} = {}) {
  if (w.highlight) { void openHighlight({id: w.highlight, source_type: w.type, source_id: w.id}); return; }
  let row = null;
  try { row = await fetchItem(w.type, w.id); } catch { row = null; }
  if (!row) { notify('원래 글을 찾지 못했어요', {record: false}); return; }
  openDetail({type: w.type, id: row.id}, describe(w.type, row), {picked, from});
}
// S68-54 읽을 거리 줄에서 바로 글 보기: 라우터 openFrom의 ready에서 글을 미리 읽어 둔다(prepareItem). 들어올 때(enter)는 그 글이 든 탭만 맞추고
// 맨 위 글 저절로 열기·주소 글 다시 열기를 쉬며, 같은 순간 openItem이 상세를 연다 — 목록이 한 번도 그려져 보이지 않는다(화면 메모리만).
let prepared = null;
const preparedFor = item => !!prepared && prepared.type === item?.type && (prepared.id === item.id || prepared.row.id === item.id);
function enter() {
  resetIfOwnerChanged();
  if (prepared) {
    const tab = keepNowTab(openTabFor(prepared.type));
    autoOpened.add(tab);
    setTab(tab, {save: false});
  } else restorePlaced();
  // 처음 들어올 때 탭: 노트 [기사로 가기]면 [언론], 아니면 서버에 기억한 마지막 탭(news_tab, 없으면 옛 now_tab을 옮김, 둘 다 없으면 전체).
  // 주소 ?view=news(옛 ?view=outside·?view=now 포함, S51-17 P5)는 탭을 정하지 않는다. 알림 줄 [보기]는 [사회운동](requestNewsTab).
  const asked = takeNewsTab(), wanted = takeNewsOpen();
  if (hasNewsItem()) { state.tab = ''; setTab('media', {save: false}); }
  // NOTE-News밑줄보관보기: 노트 'News에서'의 밑줄 → [밑줄] 탭 + 그 글 그 자리로, 보관한 글 → 그 글이 든 탭([언론]·[사회운동]) + 그 글 상세(S68-24 [보관] 탭 없앰).
  else if (wanted) { setTab(openTabFor(wanted.type, !!wanted.highlight), {save: false}); void openWanted(wanted); }
  else if (asked) setTab(asked, {save: false});
  else if (!state.tabSet) {
    restoreTab();
    // 화면 기억을 아직 서버에서 못 읽었으면(첫 로딩) 읽은 뒤 한 번 더 — 그사이 사용자가 탭을 고르면 그대로 둔다.
    if (viewPrefs.status?.() !== 'ok') state.tabSet = false;
  }
  // 다시 들어온 때도 보이는 탭 칸을 새로 읽는다([언론]은 그 모듈이).
  else if (state.tab === 'media') window.KPTUNews?.enter?.();
  if (!interests.loaded()) interests.load().then(() => { if (state.mode === 'list') { paintList(); paintNewsTab(); } });
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
  const server = findTab(state.tab); // [전체]·[언론] = 서버 찾기(Enter는 바로), 그 밖 탭 = 제목 거르기 + Enter 문장 찾기
  if (!query) state.searching = false;
  else if (submit && !server) state.searching = true;
  if (state.tab === 'all') allFind.set(query, {now: submit});
  paintTabs();
  if (changed || (submit && server)) { paintList(); if (state.tab === 'media') window.KPTUNews?.repaint?.({submit}); if (state.tab === 'marks') marks.paint(); if (state.tab === 'memos') memos.paint(); }
  if (submit && query && !server) search.run(query);
  if (!query) search.clear();
}

// ---------- 누르기 ----------
// 관심 주제 후보가 있을 때만 ⋯ 메뉴에 '관심 주제 후보 n' 한 줄(누르면 관심 주제 칸 — 옛 목록 위 [보기]와 같은 일).
const candidatesItem = () => { const n = interests.candidates(); return n ? `<button type="button" data-os-act="interests" data-os-cand>관심 주제 후보 ${n}</button>` : ''; };
const menu = createAnchoredMenu({id: 'osMenu', className: 'topline-add-menu os-menu', label: '읽을 거리 메뉴', historyKey: 'kptuOutsideMenu', key: () => 'head',
  render: () => `<button type="button" data-os-act="fill"${filling ? ' disabled' : ''}>지금 채우기</button><button type="button" data-os-act="sources">단체 켜고 끄기</button><button type="button" data-os-act="news-sources">언론 매체 켜고 끄기</button><button type="button" data-os-act="keywords">키워드 수정</button><button type="button" data-os-act="folders">별표 폴더</button><button type="button" data-os-act="interests">관심 주제</button>${candidatesItem()}<button type="button" data-os-act="hidden">숨긴 글</button><button type="button" class="row-act" data-os-act="help">쓰는 법</button>`,
  onAction: button => {
    const a = button.dataset.osAct;
    if (a === 'help') { void import('./help-link.js').then(m => m.openHelp('outside')); return; } // HELP-메뉴안쓰는법: 화면 ⋯ 맨 아래
    if (a === 'sources') openSources(); else if (a === 'fill') fillNow(); else if (a === 'interests') openInterests(); else if (a === 'hidden') openHidden();
    else if (a === 'news-sources') newsPanel('sources'); else if (a === 'keywords' || a === 'folders') newsPanel(a);
  }});

function onClick(event) {
  const b = event.target.closest('button');
  if (!b || !(root.contains(b) || tools.contains(b))) return;
  if (b.matches('[data-os-tab]')) { setTab(b.dataset.osTab); return; }
  if (b.matches('[data-now-open]')) {
    const key = b.closest('[data-nw-key]')?.dataset.nwKey || '', [type, id] = key.split(':');
    const row = type === 'news' ? state.news.find(x => x.id === id) || findNews().find(x => x.id === id) : state.posts.find(x => x.id === id) || findPosts().find(x => x.id === id);
    if (row) openDetail({type, id}, describe(type, row));
    return;
  }
  if (b.matches('[data-nw-media]')) { openMediaPicker(b); return; }
  if (b.matches('[data-now-hidden-back]')) { closeHiddenLayer(); backFromHidden(); return; }
  if (b.matches('[data-now-interests-back]')) { const l = interestsLayer; interestsLayer = null; l?.close(); backFromInterests(); return; }
  if (b.matches('[data-os-more]')) { menu.open(b); return; }
  if (b.matches('[data-os-open-sources]')) { openSources(); return; }
  if (b.matches('[data-os-back]')) { closeLayer(); backToList(); return; }
  if (b.matches('[data-os-source]')) { toggleSource(b.dataset.osSource); return; }
  if (b.matches('[data-os-more-posts]')) { loadPosts({append: true}); return; }
  if (b.matches('[data-nw-all-more]')) { loadMore(); return; }
  if (b.matches('[data-nw-find-retry]')) { allFind.again(); return; }
  if (b.matches('[data-os-retry]')) { load().catch(() => {}); paint(); }
}
root?.addEventListener('click', onClick);
tools.addEventListener('click', onClick);
// 매체 묶음 펼침·접힘을 기억. [언론] 칸(news-clipping.js)도 이 화면 안이라 같이 잡힌다.
// 누른 순간(클릭·Enter·Space 모두 click)에 바로 적는다 — toggle 알림은 늦게 와서 그사이 목록을 다시 그리면 떨어진 줄에 가 버린다.
// toggle(거품 없음 → 잡기 단계)은 그 밖의 길(브라우저 찾기로 열림 등)을 맞춘다.
const keepFold = (d, open) => { if (open) folds.add(d.dataset.nwFold); else folds.delete(d.dataset.nwFold); };
root?.addEventListener('click', event => {
  const d = event.target.closest?.('summary')?.parentElement;
  if (d?.matches?.('details[data-nw-fold]') && root.contains(d)) keepFold(d, !d.open);
}, true);
root?.addEventListener('toggle', event => {
  const d = event.target;
  if (d?.matches?.('details[data-nw-fold]') && d.isConnected) keepFold(d, d.open);
}, true);
// S63-11 '국제' 묶음 펼침(화면 메모리). 펼치면 그 안 줄을 그린다.
root?.addEventListener('toggle', event => {
  const d = event.target;
  if (!d?.matches?.('details[data-os-intl]') || !d.isConnected || d.open === state.intlOpen) return;
  state.intlOpen = d.open;
  paintList();
}, true);
// S70-54 UI-검색창하나로: 찾기는 맨 위 칸(화면 찾기). 치면 setQuery, Enter면 setQuery(…, {submit}) — 옛 찾기 줄이 하던 그대로.
// 목록 화면일 때만(단체 켜고 끄기·관심 주제 칸, [언론] 안 키워드·폴더 칸, 폰에서 글을 연 화면은 옛 줄도 없었다).
let findText = '';
registerScreenFind('outside', {
  label: '읽을 거리에서 찾기',
  foot: () => mainBox, // '전체에서 「…」 찾기 →' 줄은 목록 칸(#nowMain) 맨 아래
  active: () => window.KPTURouter?.current === 'outside' && state.mode === 'list' && !(NARROW.matches && root?.dataset.detail === 'open')
    && !(state.tab === 'media' && document.getElementById('newsRoot')?.dataset.mode && document.getElementById('newsRoot').dataset.mode !== 'list'),
  value: () => (state.query ? findText : ''),
  apply: (raw, {submit = false} = {}) => { findText = String(raw ?? ''); setQuery(findText, {submit}); },
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
  if (state.mode !== 'list' || (NARROW.matches && root.dataset.detail === 'open') || e.touches.length !== 1 || e.target.closest(SWIPE_SKIP)) return;
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

// 글 줄 밀기·마우스 단추(왼쪽 = 숨기기, 오른쪽 = 보관). [전체]·[사회운동]은 여기서, [언론]은 news-clipping.js가 같은 부품(now-row-acts.js)을 붙인다.
const itemOfRow = el => { const [type, id] = String(el.dataset.nwKey || '').split(':'); return (type === 'outside' || type === 'news') && id ? {type, id} : null; };
function rowChanged(item, kind, on) {
  if (item.type === 'news') {
    const it = state.news.find(x => x.id === item.id), hit = findNews().find(x => x.id === item.id);
    const gone = kind === 'hide' || kind === 'delete'; // S67-11: [삭제](내가 넣은 기사)도 목록에서 빠지고, 되돌리면 다시 읽는다
    if (gone) { if (on) state.news = state.news.filter(x => x.id !== item.id); else loadNews({keep: true}); }
    else if (it) it.starred_at = on ? new Date().toISOString() : null;
    if (hit && gone && on) { const r = findNews(); r.splice(r.indexOf(hit), 1); }
    else if (hit && !gone) hit.starred_at = on ? new Date().toISOString() : null;
    if (kind === 'delete') { window.KPTUNews?.refresh?.(); if (on && detail.current()?.type === 'news' && detail.current().id === item.id) closeDetail(); }
  } else {
    const m = {...markOf(item.id)};
    if (kind === 'hide') m.dismissed = on; else m.starred = on;
    state.marks.set(item.id, m);
  }
  paintList();
}
for (const sel of ['[data-os-list]', '[data-nw-all]']) {
  bindNowRows(root?.querySelector(sel), {row: '[data-nw-key]', itemOf: itemOfRow,
    isSaved: item => (item.type === 'news' ? !!(state.news.find(x => x.id === item.id) || findNews().find(x => x.id === item.id))?.starred_at : markOf(item.id).starred),
    canDelete: item => item.type === 'news' && canDeleteNews(state.news.find(x => x.id === item.id) || findNews().find(x => x.id === item.id)), changed: rowChanged,
    canEdit: item => item.type === 'news', onEdit: item => editRow(item)});
}
// S70-62 READ-밀기메뉴: 줄 [수정] = 그 글 보기를 열고 기존 ⋯ [수정] 창(now-detail edit — 뉴스 기사만: 제목·매체·본문). 사회운동 글은 수집한 그대로라 [수정]이 없다.
function editRow(item, head = null) {
  if (item?.type !== 'news') return;
  const row = state.news.find(x => x.id === item.id) || findNews().find(x => x.id === item.id);
  const h = head || (row ? describe('news', row) : null);
  if (!h) return;
  openDetail(item, h, {picked: true});
  if (detail.current()) void detail.edit();
}
window.addEventListener('kptu:view-changed', event => {
  if (event.detail?.view === 'outside') return;
  prepared = null; // S68-54: 미리 읽은 글은 이 화면으로 오는 그 걸음에만 쓴다
  // 다른 화면으로 가면 켜고 끄기 칸은 닫힌 것으로(라우터가 그 화면의 겹을 정리한다). 다음에 들어오면 목록부터, 새 표시는 다시 읽는다.
  layer = null; detailLayer = null; interestsLayer = null; hiddenLayer = null; autoOpened.clear();
  if (mediaPicker?.isOpen) void mediaPicker.close();
  if (state.mode !== 'list') { state.mode = 'list'; listDirty = false; }
  state.seenRead = false;
  if (detail.current()) { detail.close(); if (root) root.dataset.detail = 'closed'; refreshScreenFind(); }
});
window.KPTURouter?.on?.('outside', () => { enter(); });
window.addEventListener('kptu:view-prefs-ready', () => {
  if (state.tabSet || window.KPTURouter?.current !== 'outside') return;
  restoreTab();
});
// sourceName: 사회운동 글 매체 이름(목록을 읽은 뒤에만, 아니면 null — 노트 'News에서 › 보관한 글' 줄이 쓴다).
// prepareItem: 같은 줄이 openFrom의 ready에서 먼저 불러 글을 읽어 둔다(못 읽으면 false — 화면을 옮기지 않음). openItem은 그 글을 바로 연다.
// openItem: 읽을 거리 [News] 줄(reading.js)이 라우터 openFrom 안에서 부른다 — 그 글이 든 탭 + 지금 상세(원문·밑줄) 그대로.
// 저장한 글에서 연 글이라 상세에 from 'saved'를 넘긴다(아래 줄 [관심 없음] 없음, S69-03). 폰 상세 겹은 openFrom이 남긴 칸을 쓰고,
// PC는 목록 고름 기록(pick)을 남기지 않아 뒤로 한 번 = 읽을 거리.
window.KPTUOutside = {refresh: () => load(), sourceName: key => catalogOf(key)?.name || null,
  prepareItem: async item => {
    prepared = null;
    if (!item || !['news', 'outside'].includes(item.type) || !isUuid(item.id)) return false;
    let row = null;
    try { row = await fetchItem(item.type, item.id); } catch { row = null; }
    if (!row) return false;
    prepared = {type: item.type, id: item.id, row};
    return true;
  },
  dropItem: () => { prepared = null; },
  // edit(S69 저장한 글 ⋯ [수정]): 연 뒤 그 글 보기의 ⋯ [수정] 창을 바로 연다(같은 부품 now-detail edit — 뉴스 기사만).
  openItem: async (item, {edit = false} = {}) => {
    if (!item || !['news', 'outside'].includes(item.type) || !isUuid(item.id)) { prepared = null; return false; }
    if (preparedFor(item)) {
      // 미리 읽은 글: 기다림 없이 이 자리에서 연다(라우터가 화면을 옮긴 같은 순간).
      const {type, row} = prepared; prepared = null;
      setTab(openTabFor(type), {save: false});
      openDetail({type, id: row.id}, describe(type, row), {picked: false, from: 'saved'});
      if (edit && detail.current()) void detail.edit();
      return !!detail.current();
    }
    prepared = null;
    setTab(openTabFor(item.type), {save: false}); await openWanted(item, {picked: false, from: 'saved'});
    if (edit && detail.current()) void detail.edit();
    return !!detail.current();
  }};
// [언론] 탭 칸 주인(news-clipping.js)이 쓰는 입구: 상세 열기·머리 만들기·줄 그리기·확정 관심 주제·환류 기록 뒤 후보 묻기·지금 탭·찾는 말·고른 매체.
window.KPTUNow = {
  open: (item, head) => openDetail(item, head), edit: (item, head) => editRow(item, head), listed: () => autoOpenTop(), describe, rowOf, topics: () => interests.topics(), hitOf, foldedHtml, selected: () => { const c = detail.current(); return c ? itemKey(c) : ''; },
  signaled: () => askInterests(), tab: () => state.tab, newsFresh: (rows, o) => newsFresh(rows, o), openInterests: () => openInterests(), query: () => state.query, newsKeys: () => newsKeys(),
  metaChanged: m => { if (m) state.newsMeta = {catalog: m.catalog || [], enabled: m.enabled || []}; state.media = keepMedia(state.tab || 'all', state.media); paintMediaButton(); },
};
if (window.KPTURouter?.current === 'outside') enter();
})();
