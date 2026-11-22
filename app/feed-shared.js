import {pgTextArray} from './news-clipping-model.mjs';
import {ilikeAny, NEWS_FIND_COLS, POST_FIND_COLS} from './news-find-model.mjs';
import {articleCols, flatNews, flatNewsMark, keptNews, keptOutside, outsideMarks, keepBody, hasId, isUuid, mapIds, markFields, NEWS_MARK_EMBED, KEEP_EMBED} from './feed-shared-model.mjs';
// NEWS-모두에게열기 ③ 화면(설계 docs/design/news-for-all.md 13·14절): News·[사회운동] 글을 서버에서 읽고 쓰는 유일한 길.
// - 기사·글 내용은 공용 표 한 벌(app_news_articles·app_outside_articles, 본문 블록·문장도 공용) — 가입자 모두 같은 줄(서버 정책: 로그인 + 자기 작업공간 + 차단 명단 아님).
//   화면은 공용 표에 읽기만 한다(넣기·고치기 권한 없음).
// - 숨김·폴더·읽음·반응은 사람마다(app_news_marks·app_news_reads·app_news_now_signals, app_outside_article_marks·app_outside_reads·app_outside_now_signals).
//   주소에 내 작업공간을 걸고, 서버 정책(작업공간 주인만)이 한 번 더 막는다. 다른 사람 표시는 읽을 길이 없다.
// - S68-27 READ-보관기록일원화(명진 11/22 21:37): '보관(★)'의 원본은 읽을 거리 표(app_reading_items) 한 줄(글을 가리키는 칸 news_article_id·outside_article_id).
//   읽기는 그 표(owner RLS)를 글에 붙여(embed) 읽고, 쓰기는 DB 함수 app_reading_keep 한 길(서버가 주인·News 기능 키·읽을 수 있는 글인지 본다).
//   옛 별표 칸(starred_at, 사회운동 archived_at)은 읽지도 쓰지도 않는다(지우지 않음 — 되돌리기용).
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
// 공용 기사에 붙이는 내 칸(표시 + 읽을 거리 보관 줄) — 둘 다 내 작업공간 줄만.
const mine = (w, at = '') => `${NEWS_MARK_EMBED},${KEEP_EMBED}&${at}app_news_marks.workspace_id=eq.${q(w)}&${at}app_reading_items.workspace_id=eq.${q(w)}`;
// 목록(공용 기사 + 내 표시). filter = '&source_key=in.(…)' 같은 공용 칸 조건. 돌려주는 줄은 embed 그대로 — newsPage(rows, size)로 숨김을 뺀다.
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
// ---------- 보관(= 읽을 거리 줄, S68-27) ----------
const KEEP = '/rest/v1/app_reading_items';
// 보관한 뉴스 기사(최근 보관 먼저) — 읽을 거리 줄 + 공용 기사 + 내 표시(폴더·숨김).
export async function readNewsStarred(cols, limit = 300, offset = 0) {
  const w = workspaceOf();
  const rows = await rt().api(`${KEEP}?workspace_id=eq.${q(w)}&news_article_id=not.is.null&select=id,saved_at,${T.news.art}(${articleCols(cols)},${NEWS_MARK_EMBED})&${T.news.art}.app_news_marks.workspace_id=eq.${q(w)}&order=saved_at.desc,id.desc&limit=${limit}&offset=${offset}`, {singleFlight: false});
  return (Array.isArray(rows) ? rows : []).map(keptNews).filter(Boolean);
}
// 보관한 사회운동 글(최근 보관 먼저) → [{post_id, starred_at, dismissed_at, app_outside_posts}]. embed: 공용 글 칸.
export async function readOutsideKept(embed, limit = 300) {
  const w = workspaceOf();
  const rows = await rt().api(`${KEEP}?workspace_id=eq.${q(w)}&outside_article_id=not.is.null&select=id,saved_at,${T.outside.art}(${embed},${T.outside.mark}(dismissed_at))&${T.outside.art}.${T.outside.mark}.workspace_id=eq.${q(w)}&order=saved_at.desc,id.desc&limit=${limit}`, {singleFlight: false});
  return (Array.isArray(rows) ? rows : []).map(keptOutside).filter(Boolean);
}
// 글 하나가 보관돼 있나 → 그 읽을 거리 줄 {id, saved_at} 또는 null. id는 공용 id.
async function readKeepOne(type, id) {
  const col = type === 'news' ? 'news_article_id' : 'outside_article_id';
  return first(await rt().api(`${KEEP}?workspace_id=eq.${q(workspaceOf())}&${col}=eq.${q(id)}&select=id,saved_at&limit=1`, {singleFlight: false}));
}
// 보관 켜기/끄기 한 길(DB app_reading_keep — 주인·News 기능 키·읽을 수 있는 글을 서버가 본다). savedAt: 되돌리기 때 원래 보관 시각.
// 답: 켜기 {on:true, id, saved_at}, 끄기 {on:false, removed, saved_at}. 옛 id로 오는 글도 공용 id로.
export async function writeKeep(item, on, savedAt = null) {
  const id = await articleIdOf(item?.type, item?.id);
  const body = keepBody(workspaceOf(), item?.type, id, on, savedAt);
  if (!body) throw new Error('keep');
  const out = await rt().api('/rest/v1/rpc/app_reading_keep', {method: 'POST', body, singleFlight: false});
  if (!out || out.ok !== true) throw new Error('keep');
  try { window.dispatchEvent(new CustomEvent('kptu:reading-changed', {detail: {kind: 'keep', on: !!on}})); } catch { /* 듣는 화면이 일을 막지 않는다 */ }
  return out;
}
// 내 키워드 하나에 걸린 기사(서버 키워드 단계가 내 표시 keywords 칸에 적음). 숨긴 것은 뺀다. 최근 표시 먼저.
export async function readNewsKeywordHits(word, cols, limit) {
  const w = workspaceOf();
  const rows = await rt().api(`/rest/v1/${T.news.mark}?workspace_id=eq.${q(w)}&hidden_at=is.null&keywords=cs.${q(pgTextArray([word]))}&select=folder_id,hidden_at,keywords,${T.news.art}(${articleCols(cols)},${KEEP_EMBED})&${T.news.art}.app_reading_items.workspace_id=eq.${q(w)}&order=created_at.desc,article_id.desc&limit=${limit}`, {singleFlight: false});
  return (Array.isArray(rows) ? rows : []).map(flatNewsMark).filter(Boolean);
}
// S63-11 서버 찾기([전체]·[언론] 위 찾기 칸, news-find-model.mjs): 최근 기사(since 뒤 받은 것) + 내가 보관한 기사(읽을 거리 줄, 기간 없음)에서 제목·한국어 제목·요약.
// keys: 고른 매체(news- 키, null = 모두). 숨긴 것은 뺀다. 돌려줌: {recent, kept}(옛 뉴스 줄 모양).
export async function findNewsArticles(words, cols, {since, limit, keys = null}) {
  const w = workspaceOf(), or = q(ilikeAny(NEWS_FIND_COLS, words));
  const inKeys = keys ? `in.(${keys.map(q).join(',')})` : '';
  const [recent, kept] = await Promise.all([
    rt().api(`/rest/v1/${T.news.art}?select=${articleCols(cols)},${mine(w)}&created_at=gte.${q(since)}&or=${or}${inKeys ? `&source_key=${inKeys}` : ''}&order=created_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
    rt().api(`${KEEP}?workspace_id=eq.${q(w)}&news_article_id=not.is.null&select=id,saved_at,${T.news.art}!inner(${articleCols(cols)},${NEWS_MARK_EMBED})&${T.news.art}.app_news_marks.workspace_id=eq.${q(w)}&${T.news.art}.or=${or}${inKeys ? `&${T.news.art}.source_key=${inKeys}` : ''}&order=saved_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
  ]);
  return {recent: (Array.isArray(recent) ? recent : []).map(flatNews).filter(it => it && !it.hidden_at), kept: (Array.isArray(kept) ? kept : []).map(keptNews).filter(it => it && !it.hidden_at)};
}
// 사회운동 글 찾기: 최근 글(올린 날, 없으면 받은 날이 since 뒤) + 내가 보관한 글(읽을 거리 줄, 기간 없음). keys: 고른 단체(null = 모두). 숨긴 글은 화면이 뺀다.
export async function findOutsideArticles(words, cols, {since, limit, keys = null}) {
  const w = workspaceOf(), like = ilikeAny(POST_FIND_COLS, words);
  const inKeys = keys ? `in.(${keys.map(q).join(',')})` : '';
  const [recent, kept] = await Promise.all([
    rt().api(`/rest/v1/${T.outside.art}?select=${cols}&and=${q(`(or(published_at.gte.${since},and(published_at.is.null,fetched_at.gte.${since})),or${like})`)}${inKeys ? `&source_key=${inKeys}` : ''}&order=published_at.desc.nullslast,fetched_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
    rt().api(`${KEEP}?workspace_id=eq.${q(w)}&outside_article_id=not.is.null&select=id,saved_at,${T.outside.art}!inner(${cols},${T.outside.mark}(dismissed_at))&${T.outside.art}.${T.outside.mark}.workspace_id=eq.${q(w)}&${T.outside.art}.or=${q(like)}${inKeys ? `&${T.outside.art}.source_key=${inKeys}` : ''}&order=saved_at.desc,id.desc&limit=${limit}`, {singleFlight: false}),
  ]);
  return {recent: Array.isArray(recent) ? recent.filter(r => r && hasId(r.id)) : [], kept: (Array.isArray(kept) ? kept : []).map(keptOutside).filter(m => m && !m.dismissed_at).map(m => m.app_outside_posts)};
}
// 내 표시 쓰기: 줄이 있으면 칸만 고치고, 없으면 넣는다(지울 것만 있고 줄이 없으면 할 일 없음). 돌려줌: 뉴스 {id, folder_id, hidden_at} · 사회운동 {id, dismissed_at}.
// 보관(★)은 여기서 쓰지 않는다(writeKeep 한 길).
async function writeMark(type, given, fields) {
  const t = T[type], w = workspaceOf(), body = markFields(type, fields);
  const id = await articleIdOf(type, given); // 홈 '읽을 만한 글'·AI '함께 볼 것'처럼 옛 id로 오는 글도 공용 id로
  if (!Object.keys(body).length) return {id: given};
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
// 사회운동 글 중 숨기거나 보관한 것 → [{post_id(공용 id), starred_at(보관 시각), dismissed_at}]. 숨김은 내 표시, 보관은 읽을 거리 줄(S68-27).
export async function readOutsideMarks({limit = 2000} = {}) {
  const w = workspaceOf();
  const [marks, keeps] = await Promise.all([
    rt().api(`/rest/v1/${T.outside.mark}?workspace_id=eq.${q(w)}&dismissed_at=not.is.null&select=article_id,dismissed_at&limit=${limit}`, {singleFlight: false}),
    rt().api(`${KEEP}?workspace_id=eq.${q(w)}&outside_article_id=not.is.null&select=outside_article_id,saved_at&limit=${limit}`, {singleFlight: false}),
  ]);
  return outsideMarks(marks, keeps);
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

// ---------- 둘 다 ----------
// 내 표시 하나: 뉴스 {star, dismiss}, 사회운동 {star, dismiss, has}. 보관(star) = 그 글을 가리키는 읽을 거리 줄이 있나(S68-27).
export async function readMarkOf(item) {
  const t = T[item?.type];
  if (!t) return null;
  const cols = item.type === 'news' ? 'hidden_at' : 'dismissed_at';
  const [r, k] = await Promise.all([
    rt().api(`/rest/v1/${t.mark}?workspace_id=eq.${q(workspaceOf())}&article_id=eq.${q(item.id)}&select=${cols}&limit=1`, {singleFlight: false}).then(first),
    readKeepOne(item.type, item.id),
  ]);
  return item.type === 'news'
    ? {star: !!k, dismiss: !!r?.hidden_at}
    : {star: !!k, dismiss: !!r?.dismissed_at, has: !!r || !!k};
}
// S67-11 NEWS-보관빼기: 끄기 전 내 표시 그대로(되돌리기가 원래 보관 시각·폴더로 되살려 원래 자리에 오게). 아무것도 없으면 null.
// 뉴스 {starred_at(보관 시각), folder_id, hidden_at}, 사회운동 {starred_at, dismissed_at}. 옛 id로 오는 글도 공용 id로.
export async function readMarkRaw(item) {
  const t = T[item?.type];
  if (!t || !hasId(item.id)) return null;
  const id = await articleIdOf(item.type, item.id);
  const cols = item.type === 'news' ? 'folder_id,hidden_at' : 'dismissed_at';
  const [r, k] = await Promise.all([
    rt().api(`/rest/v1/${t.mark}?workspace_id=eq.${q(workspaceOf())}&article_id=eq.${q(id)}&select=${cols}&limit=1`, {singleFlight: false}).then(first),
    readKeepOne(item.type, id),
  ]);
  if (!r && !k) return null;
  return {...(r || {}), starred_at: k?.saved_at || null};
}
// 공용 본문 블록 한 줄(없으면 null).
export const readBody = item => rt().api(`/rest/v1/${T[item.type].body}?article_id=eq.${q(item.id)}&select=blocks,state,reason&limit=1`, {singleFlight: false}).then(first);
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
