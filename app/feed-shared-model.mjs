// NEWS-모두에게열기 ③ 화면(설계 docs/design/news-for-all.md 13·14절): 공용 기사·글 + 사람별 표시를 화면 줄 모양으로 바꾸는 규칙. 네트워크·저장 없음(node --test).
// 공용 표(app_news_articles·app_outside_articles)는 모두 같은 줄을 읽고, 별표·보관·숨김·읽음·메모는 사람마다 따로(자기 작업공간 owner 표).
// 화면 줄 모양은 바꾸지 않는다: 뉴스 줄은 옛 app_news_items 칸 그대로(starred_at·folder_id·hidden_at·keywords는 내 표시에서), 사회운동 글은 옛 app_outside_posts 칸 그대로.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
// 줄 id(서버 줄은 uuid — 모양 검사는 서버가 한다. 화면은 빈 값만 거른다).
const hasId = v => typeof v === 'string' && v.length > 0 && v.length <= 64;

// 사람별 표시 칸(뉴스). 공용 기사 칸이 아니다.
export const NEWS_MARK_COLS = Object.freeze(['starred_at', 'folder_id', 'hidden_at', 'keywords']);
export const NEWS_MARK_EMBED = `app_news_marks(${NEWS_MARK_COLS.join(',')})`;
// 화면이 넘긴 칸 목록에서 표시 칸을 빼고 공용 기사 칸만(id는 늘 앞에).
export function articleCols(cols) {
  const list = String(cols || '').split(',').map(s => s.trim()).filter(Boolean).filter(c => !NEWS_MARK_COLS.includes(c) && c !== 'id');
  return ['id', ...new Set(list)].join(',');
}
// 공용 기사 + 내 표시(embed: 정책상 내 작업공간 줄만 오고, 주소에도 작업공간을 건다) → 옛 뉴스 줄 모양.
export function flatNews(row) {
  if (!row || !hasId(row.id)) return null;
  const {app_news_marks: marks, ...art} = row;
  const m = Array.isArray(marks) ? marks[0] || null : marks && typeof marks === 'object' ? marks : null;
  return {...art, starred_at: m?.starred_at ?? null, folder_id: m?.folder_id ?? null, hidden_at: m?.hidden_at ?? null, keywords: Array.isArray(m?.keywords) ? m.keywords : []};
}
// 내 표시 줄(+ 공용 기사 embed) → 옛 뉴스 줄 모양. 별표 칸·키워드 칸 읽기에 쓴다.
export function flatNewsMark(mark) {
  const art = mark?.app_news_articles;
  if (!art || !hasId(art.id)) return null;
  return {...art, starred_at: mark.starred_at ?? null, folder_id: mark.folder_id ?? null, hidden_at: mark.hidden_at ?? null, keywords: Array.isArray(mark.keywords) ? mark.keywords : []};
}
// 목록 한 쪽: 읽은 줄 수(raw, 다음 쪽 시작 자리)와 내가 숨긴 것을 뺀 줄. 숨김은 사람별이라 공용 표 주소로 거를 수 없어 화면에서 뺀다.
export function newsPage(rows, pageSize) {
  const got = (Array.isArray(rows) ? rows : []).map(flatNews).filter(Boolean);
  const raw = Math.min(got.length, pageSize);
  return {raw, end: got.length <= pageSize, rows: got.slice(0, pageSize).filter(it => !it.hidden_at)};
}
// 사회운동 내 표시 줄 → [보관] 탭이 쓰던 모양({post_id, starred_at, archived_at, app_outside_posts}).
export function savedOutsideMark(m) {
  if (!m || !hasId(m.article_id)) return null;
  return {post_id: m.article_id, starred_at: m.starred_at ?? null, archived_at: m.archived_at ?? null, dismissed_at: m.dismissed_at ?? null, app_outside_posts: m.app_outside_articles || null};
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
// 표시 쓰기 몸통: 칸 이름이 허락된 것만(화면 권한과 같은 칸).
const MARK_FIELDS = {news: ['starred_at', 'folder_id', 'hidden_at'], outside: ['starred_at', 'archived_at', 'dismissed_at']};
export function markFields(type, fields) {
  const keep = MARK_FIELDS[type] || [];
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) if (keep.includes(k) && (v === null || typeof v === 'string')) out[k] = v;
  return out;
}
