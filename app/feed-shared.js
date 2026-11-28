import {pgTextArray} from './news-clipping-model.mjs';
import {ilikeAny, NEWS_FIND_COLS, POST_FIND_COLS} from './news-find-model.mjs';
import {articleCols, flatNews, flatNewsMark, flatNewsSaved, hasId, isUuid, mapIds, markFields, outsideMarkRows, NEWS_MARK_EMBED, SAVED_EMBED} from './feed-shared-model.mjs';
// NEWS-모두에게열기 ③ 화면(설계 docs/design/news-for-all.md 13·14절): News·[사회운동] 글을 서버에서 읽고 쓰는 유일한 길.
// - 기사·글 내용은 공용 표 한 벌(app_news_articles·app_outside_articles, 본문 블록·문장도 공용) — 가입자 모두 같은 줄(서버 정책: 로그인 + 자기 작업공간 + 차단 명단 아님).
//   화면은 공용 표에 읽기만 한다(넣기·고치기 권한 없음).
// - 숨김·관심 없음·별표 폴더·읽음·반응은 사람마다(app_news_marks·app_news_reads·app_news_now_signals, app_outside_article_marks·app_outside_reads·app_outside_now_signals).
//   주소에 내 작업공간을 걸고, 서버 정책(작업공간 주인만)이 한 번 더 막는다. 다른 사람 표시는 읽을 길이 없다.
// - S68-27 READ-보관기록일원화: '보관'(별표)의 원본은 읽을 거리 표(app_reading_items, 원래 글 연결 칸 news_article_id·outside_article_id) 한 곳.
//   읽기는 글에 내 읽을 거리 줄을 붙여(embed) 보관 시각을 얻고, 쓰기는 서버 함수 app_reading_keep 하나(주인·News 기능 키·읽을 수 있는 글만 서버가 받음).
//   표시 표의 옛 별표 칸은 읽지도 쓰지도 않는다.
// - 옛 id(밑줄·노트 메모·주소·AI '함께 볼 것'에 남은 옛 app_news_items·app_outside_posts id)는 지도 함수(app_news_article_of·app_outside_article_of,
//   자기 작업공간 옛 줄만)로 바꿔 읽는다. 지도에 없으면 옛 id = 공용 id(옮길 때 운영자 줄 id를 그대로 썼다). 바꾼 값은 이 탭 메모리에만.
// - 옮기는 동안(C1 전): 옛 표를 읽는 서버 일(홈 '읽을 만한 글'·폰 알림 줄)이 그대로 돌게, 별표·숨김·읽음을 옛 표에도 같은 id로 한 번 더 써 본다
//   (자기 작업공간에 같은 id 옛 줄이 있을 때만 들어감 — 없으면 서버가 거절하고 화면은 조용히 넘어간다). C1에서 이 줄들을 지운다.
// 기기 저장 없음. 로그에 기사 제목·주소를 남기지 않는다.
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
export const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const first = r => (Array.isArray(r) ? r[0] || null : null);
const quiet = p => { Promise.resolve().then(p).catch(() => { /* 옛 표 같이 쓰기 — 실패해도 그대로 */ }); };

export const T = Object.freeze({
  news: {art: 'app_news_articles', mark: 'app_news_marks', read: 'app_news_reads', signal: 'app_news_now_signals', body: 'app_news_article_bodies', map: 'app_news_article_of', memo: 'news_item_id',
    old: {art: 'app_news_items', read: 'app_feed_reads', col: 'news_item_id'}},
  outside: {art: 'app_outside_articles', mark: 'app_outside_article_marks', read: 'app_outside_reads', signal: 'app_outside_now_signals', body: 'app_outside_article_bodies', sentences: 'app_outside_article_sentences',
    map: 'app_outside_article_of', memo: 'outside_post_id', old: {art: 'app_outside_posts', mark: 'app_outside_marks', read: 'app_feed_reads', col: 'outside_post_id'}},
});

// ---------- 옛 id → 공용 id ----------
let mapScope = '';
const mapped = {news: new Map(), outside: new Map()};
const scopeNow = () => { const c = rt()?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
function mapCheck() { const s = scopeNow(); if (s !== mapScope) { mapScope = s; mapped.news.clear(); mapped.outside.clear(); } }
// ids → Map(옛 id → 공용 id). 못 물으면 그대로(같은 id).
export async function articleOf(type, ids) {
  mapCheck();
  const t = T[type], cache = mapped[type], my = mapScope;
  const want = [...new Set((ids || []).filter(isUuid))];
  const ask = t ? want.filter(id => !cache.has(id)) : [];
  for (let i = 0; i < ask.length; i += 200) {
    const part = ask.slice(i, i + 200);
    try {
      const rows = await rt().api(`/rest/v1/rpc/${t.map}`, {method: 'POST', body: {p_old: part}, singleFlight: false});
      if (my !== mapScope) break;
      for (const [k, v] of mapIds(part, rows)) cache.set(k, v);
    } catch { /* 지도를 못 읽으면 이번엔 그대로 */ }
  }
  return new Map(want.map(id => [id, cache.get(id) || id]));
}
export const articleIdOf = async (type, id) => (isUuid(id) ? (await articleOf(type, [id])).get(id) : id);
// 이미 바꿔 둔 값만(기다리지 않음).
export const knownArticleId = (type, id) => { mapCheck(); return mapped[type]?.get(id) || id; };

// ---------- 뉴스 기사 ----------
// 공용 기사 + 내 표시 + 내 보관 embed(둘 다 내 작업공간 줄만).
const mine = w => `${NEWS_MARK_EMBED},${SAVED_EMBED}&app_news_marks.workspace_id=eq.${q(w)}&app_reading_items.workspace_id=eq.${q(w)}`;
// 목록(공용 기사 + 내 표시 + 내 보관). filter = '&source_key=in.(…)' 같은 공용 칸 조건. 돌려주는 줄은 embed 그대로 — newsPage(rows, size)로 숨김을 뺀다.
export function readNewsArticles({cols, filter = '', order = 'created_at.desc,id.desc', limit, offset = 0}) {
  const w = workspaceOf();
  return rt().api(`/rest/v1/${T.news.art}?select=${articleCols(cols)},${mine(w)}${filter}&order=${order}&limit=${limit}&offset=${offset}`, {singleFlight: false});
}
// 기사 하나(옛 id도 받음) → 옛 뉴스 줄 모양 또는 null.
export async function readNewsOne(id, cols) {
  const aid = await articleIdOf('news', id);
  if (!hasId(aid)) return null;
  const w = workspaceOf();
  return flatNews(first(await rt().api(`/rest/v1/${T.news.art}?id=eq.${q(aid)}&select=${articleCols(cols)},${mine(w)}&limit=1`, {singleFlight: false})));
}
// 내가 저장한 기사(읽을 거리 줄이 가리키는 것, 최근 보관 먼저). 별표 폴더 칸·보관 목록이 쓴다.
const R = '/rest/v1/app_reading_items';
export async function readNewsStarred(cols, limit = 300, offset = 0) {
  const w = workspaceOf();
  const rows = await rt().api(`${R}?workspace_id=eq.${q(w)}&news_article_id=not.is.null&select=id,saved_at,${T.news.art}(${articleCols(cols)},${NEWS_MARK_EMBED})&${T.news.art}.app_news_marks.workspace_id=eq.${q(w)}&order=saved_at.desc,id.desc&limit=${limit}&offset=${offset}`, {singleFlight: false});
  return (Array.isArray(rows) ? rows : []).map(flatNewsSaved).filter(Boolean);
}
// 내 키워드 하나에 걸린 기사(서버 키워드 단계가 내 표시 keywords 칸에 적음). 숨긴 것은 뺀다. 최근 표시 먼저.
export async function readNewsKeywordHits(word, cols, limit) {
  const w = workspaceOf();
  const rows = await rt().api(`/rest/v1/${T.news.mark}?workspace_id=eq.${q(w)}&hidden_at=is.null&keywords=cs.${q(pgTextArray([word]))}&select=folder_id,hidden_at,keywords,${T.news.art}(${articleCols(cols)},${SAVED_EMBED})&${T.news.art}.app_reading_items.workspace_id=eq.${q(w)}&order=created_at.desc,article_id.desc&limit=${limit}`, {singleFlight: false});
  return (Array.isArray(rows) ? rows : []).map(flatNewsMark).filter(Boolean);
}
// S63-11 서버 찾기([전체]·[언론] 위 찾기 칸, news-find-model.mjs): 최근 기사(since 뒤 받은 것) + 내가 저장한 기사(읽을 거리 줄, 기간 없음)에서 제목·한국어 제목·요약.
// keys: 고른 매체(news- 키, null = 모두). 숨긴 것은 뺀다. 돌려줌: {recent, kept}(옛 뉴스 줄 모양).
export async function findNewsArticles(words, cols, {since, limit, keys = null}) {
  const w = workspaceOf(), or = q(ilikeAny(NEWS_FIND_COLS, words));
  const inKeys = keys ? `in.(${keys.map(q).join(',')})` : '';
  const [recent, kept] = await Promise.all([
    rt().api(`/rest/v1/${T.news.art}?select=${articleCols(cols)},${mine(w)}&created_at=gte.${q(since)}&or=${or}${inKeys ? `&source_key=${inKeys}` : ''}&order=created_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
    rt().api(`${R}?workspace_id=eq.${q(w)}&news_article_id=not.is.null&select=id,saved_at,${T.news.art}!inner(${articleCols(cols)},${NEWS_MARK_EMBED})&${T.news.art}.app_news_marks.workspace_id=eq.${q(w)}&${T.news.art}.or=${or}${inKeys ? `&${T.news.art}.source_key=${inKeys}` : ''}&order=saved_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
  ]);
  return {recent: (Array.isArray(recent) ? recent : []).map(flatNews).filter(it => it && !it.hidden_at), kept: (Array.isArray(kept) ? kept : []).map(flatNewsSaved).filter(it => it && !it.hidden_at)};
}
// 사회운동 글 찾기: 최근 글(올린 날, 없으면 받은 날이 since 뒤) + 내가 보관한 글(읽을 거리 줄, 기간 없음). keys: 고른 단체(null = 모두). 숨긴 글은 화면이 뺀다.
export async function findOutsideArticles(words, cols, {since, limit, keys = null}) {
  const w = workspaceOf(), like = ilikeAny(POST_FIND_COLS, words);
  const inKeys = keys ? `in.(${keys.map(q).join(',')})` : '';
  const [recent, kept] = await Promise.all([
    rt().api(`/rest/v1/${T.outside.art}?select=${cols}&and=${q(`(or(published_at.gte.${since},and(published_at.is.null,fetched_at.gte.${since})),or${like})`)}${inKeys ? `&source_key=${inKeys}` : ''}&order=published_at.desc.nullslast,fetched_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
    rt().api(`${R}?workspace_id=eq.${q(w)}&outside_article_id=not.is.null&select=outside_article_id,${T.outside.art}!inner(${cols})&${T.outside.art}.or=${q(like)}${inKeys ? `&${T.outside.art}.source_key=${inKeys}` : ''}&order=saved_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
  ]);
  return {recent: Array.isArray(recent) ? recent.filter(r => r && hasId(r.id)) : [], kept: (Array.isArray(kept) ? kept : []).map(m => m?.[T.outside.art]).filter(r => r && hasId(r.id))};
}
// S70-62 READ-밀기메뉴 [숨긴 글](명진 11/26 07:41 "근데 숨기기는 어떻게 다시 보지?"): 내가 숨긴 글(뉴스 hidden_at · 사회운동 관심 없음 dismissed_at), 최근 숨긴 것 먼저.
// 내 표시 표(작업공간 주인 RLS 그대로) + 공용 글 표 읽기만. 돌려줌 {news: [옛 뉴스 줄 모양(hidden_at 포함)], outside: [{row, at}]}.
export async function readHiddenArticles({newsCols, postCols, limit = 100}) {
  const w = workspaceOf();
  const [news, marks] = await Promise.all([
    rt().api(`/rest/v1/${T.news.mark}?workspace_id=eq.${q(w)}&hidden_at=not.is.null&select=folder_id,hidden_at,keywords,${T.news.art}(${articleCols(newsCols)},${SAVED_EMBED})&${T.news.art}.app_reading_items.workspace_id=eq.${q(w)}&order=hidden_at.desc,article_id.desc&limit=${limit}`, {singleFlight: false}),
    rt().api(`/rest/v1/${T.outside.mark}?workspace_id=eq.${q(w)}&dismissed_at=not.is.null&select=article_id,dismissed_at&order=dismissed_at.desc,article_id.desc&limit=${limit}`, {singleFlight: false}),
  ]);
  const at = new Map((Array.isArray(marks) ? marks : []).filter(m => hasId(m?.article_id)).map(m => [m.article_id, m.dismissed_at]));
  const rows = at.size ? await readArticlesByIds('outside', [...at.keys()], postCols) : new Map();
  return {news: (Array.isArray(news) ? news : []).map(flatNewsMark).filter(Boolean), outside: [...at].map(([id, when]) => ({row: rows.get(id) || null, at: when})).filter(x => x.row)};
}
// 내 표시 쓰기(숨김·관심 없음·별표 폴더): 줄이 있으면 칸만 고치고, 없으면 넣는다(지울 것만 있고 줄이 없으면 할 일 없음).
// 돌려줌: 뉴스 {id, folder_id, hidden_at}, 사회운동 {id, dismissed_at}. 보관은 writeSaved.
async function writeMark(type, given, fields) {
  const t = T[type], w = workspaceOf(), body = markFields(type, fields);
  const id = await articleIdOf(type, given); // 홈 '읽을 만한 글'·AI '함께 볼 것'처럼 옛 id로 오는 글도 공용 id로
  const cols = type === 'news' ? 'article_id,folder_id,hidden_at' : 'article_id,dismissed_at';
  const patch = () => rt().api(`/rest/v1/${t.mark}?workspace_id=eq.${q(w)}&article_id=eq.${q(id)}&select=${cols}`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
  let row = first(await patch());
  if (!row) {
    if (!Object.values(body).some(Boolean)) return {id, ...Object.fromEntries(Object.keys(body).map(k => [k, null]))};
    try { row = first(await rt().api(`/rest/v1/${t.mark}?select=${cols}`, {method: 'POST', body: {workspace_id: w, article_id: id, ...body}, prefer: 'return=representation', singleFlight: false})); }
    catch (e) { if (e?.status !== 409) throw e; row = first(await patch()); } // 같은 때 다른 칸에서 먼저 넣었다 → 고치기
  }
  if (!row || row.article_id !== id) throw new Error('save');
  const {article_id: _a, ...rest} = row;
  return {id: given, ...rest};
}
export async function writeNewsMark(id, fields) {
  const row = await writeMark('news', id, fields);
  const w = workspaceOf(), body = markFields('news', fields);
  quiet(() => rt().api(`/rest/v1/${T.news.old.art}?workspace_id=eq.${q(w)}&id=eq.${q(id)}`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=minimal', singleFlight: false}));
  return row;
}

// ---------- 사회운동 글 ----------
export const readOutsideArticles = ({cols, filter = '', order, limit, offset = 0}) =>
  rt().api(`/rest/v1/${T.outside.art}?select=${cols}${filter}&order=${order}&limit=${limit}&offset=${offset}`, {singleFlight: false});
export async function readOutsideOne(id, cols) {
  const aid = await articleIdOf('outside', id);
  if (!hasId(aid)) return null;
  return first(await rt().api(`/rest/v1/${T.outside.art}?id=eq.${q(aid)}&select=${cols}&limit=1`, {singleFlight: false}));
}
// 사회운동 글의 내 보관(읽을 거리 줄) + 관심 없음 표시 → [{post_id(공용 id), starred_at(보관 시각), dismissed_at, app_outside_posts?}].
// saved: 보관한 글을 읽을지(embed = 글 칸까지 붙여), dismissed: 관심 없음 표시를 읽을지.
export async function readOutsideMarks({saved = true, dismissed = true, embed = '', limit = 2000} = {}) {
  const w = workspaceOf();
  const [s, m] = await Promise.all([
    saved ? rt().api(`${R}?workspace_id=eq.${q(w)}&outside_article_id=not.is.null&select=outside_article_id,saved_at${embed ? `,${T.outside.art}(${embed})` : ''}&order=saved_at.desc,id.desc&limit=${limit}`, {singleFlight: false}) : [],
    dismissed ? rt().api(`/rest/v1/${T.outside.mark}?workspace_id=eq.${q(w)}&dismissed_at=not.is.null&select=article_id,dismissed_at&limit=${limit}`, {singleFlight: false}) : [],
  ]);
  return outsideMarkRows(m, s);
}
export async function writeOutsideMark(id, fields) {
  const row = await writeMark('outside', id, fields);
  const w = workspaceOf(), body = markFields('outside', fields), at = new Date().toISOString();
  quiet(async () => {
    const old = first(await rt().api(`/rest/v1/${T.outside.old.mark}?workspace_id=eq.${q(w)}&post_id=eq.${q(id)}&select=post_id`, {method: 'PATCH', body: {...body, updated_at: at}, prefer: 'return=representation', singleFlight: false}));
    if (!old && Object.values(body).some(Boolean)) await rt().api(`/rest/v1/${T.outside.old.mark}`, {method: 'POST', body: {post_id: id, workspace_id: w, ...body}, prefer: 'return=minimal', singleFlight: false});
  });
  return row;
}

// ---------- 보관(S68-27): 원본 = 읽을 거리 줄 ----------
const LINK = {news: 'news_article_id', outside: 'outside_article_id'};
// 글 하나의 내 읽을 거리 줄(보관) → {id, saved_at} | null.
async function savedRowOf(type, id) {
  return first(await rt().api(`${R}?workspace_id=eq.${q(workspaceOf())}&${LINK[type]}=eq.${q(id)}&select=id,saved_at&limit=1`, {singleFlight: false}));
}
// 공용 id 여럿 → Map(공용 id → 보관 시각). 홈 '읽을 만한 글'이 이미 보관한 글을 거를 때 쓴다.
export async function readSavedAt(type, ids) {
  const want = [...new Set((ids || []).filter(hasId))], col = LINK[type];
  if (!col || !want.length) return new Map();
  const rows = await rt().api(`${R}?workspace_id=eq.${q(workspaceOf())}&${col}=in.(${want.map(q).join(',')})&select=${col},saved_at&limit=${want.length}`, {singleFlight: false});
  return new Map((Array.isArray(rows) ? rows : []).filter(r => hasId(r?.[col])).map(r => [r[col], r.saved_at]));
}
// 보관 켜기/끄기 한 길(서버 함수 app_reading_keep). savedAt: 되돌리기 때 원래 보관 시각(켜기만). 돌려줌: 서버 답 {ok, on, id?, saved_at?, removed?}.
export async function writeSaved(item, on, savedAt = null) {
  const w = workspaceOf();
  if (!w || !LINK[item?.type] || !hasId(item.id)) throw new Error('save');
  const id = await articleIdOf(item.type, item.id);
  const res = await rt().api('/rest/v1/rpc/app_reading_keep', {method: 'POST', body: {p_workspace: w, p_source: item.type, p_article: id, p_on: !!on, p_saved_at: on && savedAt ? savedAt : null}, singleFlight: false});
  if (!res || typeof res !== 'object' || Array.isArray(res) || res.ok !== true) throw new Error('save');
  return res;
}

// ---------- 👍·👎 평가(HOME-읽을거리평가, 사용자 2026-11-28 07:04) ----------
// 사람별 표 app_read_ratings(owner RLS): 작업공간·공용 글 하나에 평가 하나(1 좋아요, -1 별로예요). 글 제목·본문은 다시 저장하지 않는다.
// 표는 고치기 권한이 없다 — 바꾸기 = 지우고 넣기, 취소 = 지우기(시각은 서버가 정함). 서버 ai-assist(home_day_picks)가 최근 평가를 읽어 추천에 쓴다.
const RATE = '/rest/v1/app_read_ratings';
// 내 최근 평가 → [{type, id(공용 글 id), rating}].
export async function readRatings(limit = 500) {
  const w = workspaceOf();
  if (!w) return [];
  const rows = await rt().api(`${RATE}?workspace_id=eq.${q(w)}&select=news_article_id,outside_article_id,rating&order=rated_at.desc&limit=${limit}`, {singleFlight: false});
  const one = r => (hasId(r?.news_article_id) ? {type: 'news', id: r.news_article_id} : hasId(r?.outside_article_id) ? {type: 'outside', id: r.outside_article_id} : null);
  return (Array.isArray(rows) ? rows : []).map(r => { const a = one(r); return a && (r.rating === 1 || r.rating === -1) ? {...a, rating: r.rating} : null; }).filter(Boolean);
}
// 평가 쓰기. value: 1 | -1 | 0(취소). 돌려줌: 공용 글 id.
export async function writeRating(item, value) {
  const w = workspaceOf(), col = LINK[item?.type];
  if (!w || !col || !hasId(item.id) || ![1, -1, 0].includes(value)) throw new Error('rate');
  const id = await articleIdOf(item.type, item.id);
  const drop = () => rt().api(`${RATE}?workspace_id=eq.${q(w)}&${col}=eq.${q(id)}`, {method: 'DELETE', prefer: 'return=minimal', singleFlight: false});
  const put = () => rt().api(RATE, {method: 'POST', body: {workspace_id: w, [col]: id, rating: value}, prefer: 'return=minimal', singleFlight: false});
  await drop();
  if (value) {
    try { await put(); }
    catch (e) { if (e?.status !== 409) throw e; await drop(); await put(); } // 그사이 다른 기기가 넣었다 → 한 번 더 지우고 넣기
  }
  return id;
}

// ---------- 둘 다 ----------
// 내 표시 하나: 뉴스 {star, dismiss}, 사회운동 {star, dismiss, has}. star = 보관(읽을 거리 줄이 있음).
export async function readMarkOf(item) {
  const t = T[item?.type];
  if (!t) return null;
  const cols = item.type === 'news' ? 'hidden_at' : 'dismissed_at';
  const [r, s] = await Promise.all([
    rt().api(`/rest/v1/${t.mark}?workspace_id=eq.${q(workspaceOf())}&article_id=eq.${q(item.id)}&select=${cols}&limit=1`, {singleFlight: false}).then(first),
    savedRowOf(item.type, item.id),
  ]);
  return item.type === 'news'
    ? {star: !!s, dismiss: !!r?.hidden_at}
    : {star: !!s, dismiss: !!r?.dismissed_at, has: !!(r || s)};
}
// S67-11 NEWS-보관빼기: 끄기 전 내 보관·표시 그대로(되돌리기가 원래 보관 시각·폴더로 되살려 원래 자리에 오게). 둘 다 없으면 null.
// 뉴스 {starred_at(보관 시각), folder_id, hidden_at}, 사회운동 {starred_at, dismissed_at}. 옛 id로 오는 글도 공용 id로.
export async function readMarkRaw(item) {
  const t = T[item?.type];
  if (!t || !hasId(item.id)) return null;
  const id = await articleIdOf(item.type, item.id);
  const cols = item.type === 'news' ? 'folder_id,hidden_at' : 'dismissed_at';
  const [m, s] = await Promise.all([
    rt().api(`/rest/v1/${t.mark}?workspace_id=eq.${q(workspaceOf())}&article_id=eq.${q(id)}&select=${cols}&limit=1`, {singleFlight: false}).then(first),
    savedRowOf(item.type, id),
  ]);
  if (!m && !s) return null;
  return {...(m || {}), starred_at: s?.saved_at ?? null};
}
// 공용 본문 블록 한 줄(없으면 null).
export const readBody = item => rt().api(`/rest/v1/${T[item.type].body}?article_id=eq.${q(item.id)}&select=blocks,state,reason,rule&limit=1`, {singleFlight: false}).then(first);
// 내 저장된 요약·시사점 한 줄(사람별 자세히 표 — 화면은 자기 줄 읽기만, 쓰기는 서버 ai-assist). 없으면 null. S69-01: 열자마자 바로 그린다.
const DETAIL_TABLE = {news: 'app_news_now_details', outside: 'app_outside_now_details'};
export const readSavedDetail = item => rt().api(`/rest/v1/${DETAIL_TABLE[item.type]}?workspace_id=eq.${q(workspaceOf())}&article_id=eq.${q(item.id)}&select=level,summary,key_sentences,relevance,implications,related,generated_at,context_at&limit=1`, {singleFlight: false}).then(first);
// 공용 칸 몇 개(뉴스 기사·사회운동 글).
export const readArticleCols = (item, cols) => rt().api(`/rest/v1/${T[item.type].art}?id=eq.${q(item.id)}&select=${cols}&limit=1`, {singleFlight: false}).then(first);
// 사회운동 국내 글 문장(공용).
export const readSentences = id => rt().api(`/rest/v1/${T.outside.sentences}?article_id=eq.${q(id)}&select=idx,text&order=idx.asc&limit=3001`, {singleFlight: false});
// 읽음(사람별). ids → Set(읽은 공용 id).
export async function readReads(type, ids) {
  const rows = await rt().api(`/rest/v1/${T[type].read}?workspace_id=eq.${q(workspaceOf())}&article_id=in.(${ids.map(q).join(',')})&select=article_id&limit=${ids.length}`, {singleFlight: false});
  return new Set((Array.isArray(rows) ? rows : []).map(r => String(r?.article_id || '')));
}
export function writeRead(type, id) {
  const t = T[type], w = workspaceOf();
  quiet(() => rt().api(`/rest/v1/${t.old.read}?on_conflict=${t.old.col}`, {method: 'POST', body: {workspace_id: w, [t.old.col]: id}, prefer: 'resolution=ignore-duplicates,return=minimal', singleFlight: false}));
  return rt().api(`/rest/v1/${t.read}?on_conflict=workspace_id,article_id`, {method: 'POST', body: {workspace_id: w, article_id: id}, prefer: 'resolution=ignore-duplicates,return=minimal', singleFlight: false});
}
// 반응 기록 한 줄(사람별, 더하기만). 실패해도 누른 일은 그대로.
// 새 표에만 쓴다(S62-12g). 옛 표(app_now_signals)에 같은 id로 한 번 더 쓰면 뉴스 보충 함수(app_news_refs_sync 6단계)가 그 옛 줄을
// 새 표로 다시 옮겨 같은 반응이 두 줄이 된다 → 관심 주제 기준이 빨리 찬다. 옛 반응 표를 읽는 서버 일은 E3(PR 2642)로 없어졌다.
export async function writeSignal(item, action) {
  const t = T[item?.type], w = workspaceOf();
  if (!t || !w || !hasId(item.id)) return;
  const id = await articleIdOf(item.type, item.id);
  await rt().api(`/rest/v1/${t.signal}`, {method: 'POST', body: {workspace_id: w, article_id: id, action}, prefer: 'return=minimal', singleFlight: false});
}
// S69-70 [메모] 탭(메모 있는 글): 한 종류의 글 메모 노트 한 쪽(최근 고친 것 먼저, 보관한 노트 빼고). 내 작업공간 노트만(소유자 RLS 그대로).
export function readMemoNotes(type, cols, {limit, offset = 0}) {
  const t = T[type];
  if (!t) return Promise.resolve([]);
  return rt().api(`/rest/v1/app_notes?workspace_id=eq.${q(workspaceOf())}&kind=eq.note&archived_at=is.null&metadata->>${t.memo}=not.is.null&select=${cols}&order=updated_at.desc,id.desc&limit=${limit}&offset=${offset}`, {singleFlight: false});
}
// 공용 글 id 여럿 → Map(id → 줄). 목록에서 빠진 글(관심 없음·숨김·오래됨)도 id로 다시 읽는다. 뉴스는 내 표시·보관을 붙인 옛 줄 모양(readNewsOne과 같음).
export async function readArticlesByIds(type, ids, cols) {
  const t = T[type], out = new Map(), want = [...new Set((ids || []).filter(hasId))];
  if (!t) return out;
  const w = workspaceOf();
  for (let i = 0; i < want.length; i += 100) {
    const part = want.slice(i, i + 100).map(q).join(',');
    const rows = type === 'news'
      ? await rt().api(`/rest/v1/${t.art}?id=in.(${part})&select=${articleCols(cols)},${mine(w)}&limit=100`, {singleFlight: false})
      : await rt().api(`/rest/v1/${t.art}?id=in.(${part})&select=${cols}&limit=100`, {singleFlight: false});
    for (const r of Array.isArray(rows) ? rows : []) { const row = type === 'news' ? flatNews(r) : r; if (row && hasId(row.id)) out.set(row.id, row); }
  }
  return out;
}
// 글 메모 노트(metadata.news_item_id|outside_post_id). 옛 노트는 옛 id를 적었으므로 메모 노트들의 id를 지도로 바꿔 이 글 것을 찾는다(최근 고친 것 하나).
export async function readMemoNote(item, cols) {
  const t = T[item?.type];
  if (!t) return null;
  const w = workspaceOf(), base = `/rest/v1/app_notes?workspace_id=eq.${q(w)}&kind=eq.note&archived_at=is.null`;
  const direct = first(await rt().api(`${base}&metadata->>${t.memo}=eq.${q(item.id)}&select=${cols}&order=updated_at.desc&limit=1`, {singleFlight: false}));
  if (direct) return direct;
  const rows = await rt().api(`${base}&metadata->>${t.memo}=not.is.null&select=${cols}&order=updated_at.desc&limit=300`, {singleFlight: false});
  const list = (Array.isArray(rows) ? rows : []).filter(n => isUuid(n?.metadata?.[t.memo]) && n.metadata[t.memo] !== item.id);
  if (!list.length) return null;
  const map = await articleOf(item.type, list.map(n => n.metadata[t.memo]));
  return list.find(n => map.get(n.metadata[t.memo]) === item.id) || null;
}
