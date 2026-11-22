// NEWS-모두에게열기 ③ 화면(설계 docs/design/news-for-all.md 13·14절): 공용 기사·글 + 사람별 표시를 화면 줄 모양으로 바꾸는 규칙. 네트워크·저장 없음(node --test).
// 공용 표(app_news_articles·app_outside_articles)는 모두 같은 줄을 읽고, 별표·보관·숨김·읽음·메모는 사람마다 따로(자기 작업공간 owner 표).
// 화면 줄 모양은 바꾸지 않는다: 뉴스 줄은 옛 app_news_items 칸 그대로(folder_id·hidden_at·keywords는 내 표시에서), 사회운동 글은 옛 app_outside_posts 칸 그대로.
// S68-27 READ-보관기록일원화(명진 11/22 21:37 "저장된 기록도 일원화 하지 왜?"): '보관'의 원본은 읽을 거리 표(app_reading_items) 한 줄 — 그 줄이 글을 가리키면(news_article_id·
//   outside_article_id) 보관한 글이다. 화면 줄의 starred_at은 그 읽을 거리 줄의 저장 시각(saved_at)이고, 옛 표시 칸(app_news_marks.starred_at·app_outside_article_marks.starred_at)은 읽지도 쓰지도 않는다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
// 줄 id(서버 줄은 uuid — 모양 검사는 서버가 한다. 화면은 빈 값만 거른다).
const hasId = v => typeof v === 'string' && v.length > 0 && v.length <= 64;

// 사람별 칸(뉴스). 공용 기사 칸이 아니다 — starred_at은 읽을 거리 줄에서(KEEP_EMBED), 나머지는 내 표시(app_news_marks)에서.
export const NEWS_MARK_COLS = Object.freeze(['starred_at', 'folder_id', 'hidden_at', 'keywords']);
export const NEWS_MARK_EMBED = 'app_news_marks(folder_id,hidden_at,keywords)';
// 공용 글 → 내 읽을 거리 줄(외래 키 news_article_id·outside_article_id, 작업공간마다 한 글 한 줄). 정책상 내 작업공간 줄만 오고, 주소에도 작업공간을 건다.
export const KEEP_EMBED = 'app_reading_items(id,saved_at)';
const keepOf = v => { const k = Array.isArray(v) ? v[0] || null : v && typeof v === 'object' ? v : null; return k && hasId(k.id) ? k : null; };
// 화면이 넘긴 칸 목록에서 사람별 칸을 빼고 공용 기사 칸만(id는 늘 앞에).
export function articleCols(cols) {
  const list = String(cols || '').split(',').map(s => s.trim()).filter(Boolean).filter(c => !NEWS_MARK_COLS.includes(c) && c !== 'id');
  return ['id', ...new Set(list)].join(',');
}
// 공용 기사 + 내 표시 + 내 읽을 거리 줄(embed) → 옛 뉴스 줄 모양. starred_at = 보관한 시각(읽을 거리 줄 saved_at), reading_id = 그 줄 id.
export function flatNews(row) {
  if (!row || !hasId(row.id)) return null;
  const {app_news_marks: marks, app_reading_items: keeps, ...art} = row;
  const m = Array.isArray(marks) ? marks[0] || null : marks && typeof marks === 'object' ? marks : null;
  const k = keepOf(keeps);
  return {...art, starred_at: k?.saved_at ?? null, reading_id: k?.id ?? null, folder_id: m?.folder_id ?? null, hidden_at: m?.hidden_at ?? null, keywords: Array.isArray(m?.keywords) ? m.keywords : []};
}
// 내 표시 줄(+ 공용 기사 embed, 그 안에 내 읽을 거리 줄) → 옛 뉴스 줄 모양. 키워드 칸 읽기에 쓴다.
export function flatNewsMark(mark) {
  const raw = mark?.app_news_articles;
  if (!raw || !hasId(raw.id)) return null;
  const {app_reading_items: keeps, ...art} = raw;
  const k = keepOf(keeps);
  return {...art, starred_at: k?.saved_at ?? null, reading_id: k?.id ?? null, folder_id: mark.folder_id ?? null, hidden_at: mark.hidden_at ?? null, keywords: Array.isArray(mark.keywords) ? mark.keywords : []};
}
// 읽을 거리 줄(+ 공용 기사 embed, 그 안에 내 표시) → 옛 뉴스 줄 모양. 보관한 뉴스 기사 읽기(보관 목록·찾기 '보관한 글')에 쓴다.
export function keptNews(keep) {
  const raw = keep?.app_news_articles;
  if (!hasId(keep?.id) || !raw || !hasId(raw.id)) return null;
  const {app_news_marks: marks, ...art} = raw;
  const m = Array.isArray(marks) ? marks[0] || null : marks && typeof marks === 'object' ? marks : null;
  return {...art, starred_at: keep.saved_at ?? null, reading_id: keep.id, folder_id: m?.folder_id ?? null, hidden_at: m?.hidden_at ?? null, keywords: Array.isArray(m?.keywords) ? m.keywords : []};
}
// 읽을 거리 줄(+ 공용 사회운동 글 embed, 그 안에 내 표시) → [보관] 목록 모양({post_id, starred_at, dismissed_at, app_outside_posts}).
export function keptOutside(keep) {
  const raw = keep?.app_outside_articles;
  if (!hasId(keep?.id) || !raw || !hasId(raw.id)) return null;
  const {app_outside_article_marks: marks, ...art} = raw;
  const m = Array.isArray(marks) ? marks[0] || null : marks && typeof marks === 'object' ? marks : null;
  return {post_id: art.id, starred_at: keep.saved_at ?? null, dismissed_at: m?.dismissed_at ?? null, reading_id: keep.id, app_outside_posts: art};
}
// 목록 한 쪽: 읽은 줄 수(raw, 다음 쪽 시작 자리)와 내가 숨긴 것을 뺀 줄. 숨김은 사람별이라 공용 표 주소로 거를 수 없어 화면에서 뺀다.
export function newsPage(rows, pageSize) {
  const got = (Array.isArray(rows) ? rows : []).map(flatNews).filter(Boolean);
  const raw = Math.min(got.length, pageSize);
  return {raw, end: got.length <= pageSize, rows: got.slice(0, pageSize).filter(it => !it.hidden_at)};
}
// 사회운동 글 표시(숨김)와 읽을 거리 보관을 글마다 하나로 → [{post_id, starred_at(보관 시각), dismissed_at}]. 목록이 감추고 ★·밀기 글자를 정한다.
// marks: [{article_id, dismissed_at}], keeps: [{outside_article_id, saved_at}]. 옛 별표·보관 칸(starred_at·archived_at)은 보지 않는다(S68-27).
export function outsideMarks(marks, keeps) {
  const out = new Map();
  const at = id => out.get(id) || out.set(id, {post_id: id, starred_at: null, dismissed_at: null}).get(id);
  for (const m of Array.isArray(marks) ? marks : []) if (hasId(m?.article_id) && m.dismissed_at) at(m.article_id).dismissed_at = m.dismissed_at;
  for (const k of Array.isArray(keeps) ? keeps : []) if (hasId(k?.outside_article_id)) at(k.outside_article_id).starred_at = k.saved_at || new Date(0).toISOString();
  return [...out.values()];
}
// 옛 id → 공용 id. 지도 함수 답(rows: [{old_id, article_id}])을 넣고, 지도에 없는 id는 그대로(공용 id이거나 옮기기 전 운영자 줄 = 같은 id).
export {hasId};
export function mapIds(ids, rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) if (isUuid(r?.old_id) && isUuid(r?.article_id)) out.set(r.old_id.toLowerCase(), r.article_id.toLowerCase());
  const res = new Map();
  for (const id of ids || []) if (isUuid(id)) res.set(id, out.get(id.toLowerCase()) || id);
  return res;
}
// 표시 쓰기 몸통: 칸 이름이 허락된 것만(화면 권한과 같은 칸). S68-27: 보관(별표)은 표시 칸이 아니라 읽을 거리 줄(app_reading_keep 한 길)이라 starred_at·archived_at은 쓰지 않는다.
const MARK_FIELDS = {news: ['folder_id', 'hidden_at'], outside: ['dismissed_at']};
export function markFields(type, fields) {
  const keep = MARK_FIELDS[type] || [];
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) if (keep.includes(k) && (v === null || typeof v === 'string')) out[k] = v;
  return out;
}

// 보관 켜기/끄기 한 길(DB public.app_reading_keep, S68-27) 몸통. savedAt: 되돌리기 때 원래 보관 시각(켜기만).
export function keepBody(workspace, type, article, on, savedAt = null) {
  if (!hasId(workspace) || !['news', 'outside'].includes(type) || !hasId(article)) return null; // 모양(uuid) 검사는 서버가 한다
  const at = on && typeof savedAt === 'string' && Number.isFinite(Date.parse(savedAt)) ? savedAt : null;
  return {p_workspace: workspace, p_source: type, p_article: article, p_on: !!on, p_saved_at: at};
}
