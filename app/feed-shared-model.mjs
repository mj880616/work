// NEWS-모두에게열기 ③ 화면(설계 docs/design/news-for-all.md 13·14절): 공용 기사·글 + 사람별 표시를 화면 줄 모양으로 바꾸는 규칙. 네트워크·저장 없음(node --test).
// 공용 표(app_news_articles·app_outside_articles)는 모두 같은 줄을 읽고, 별표·보관·숨김·읽음·메모는 사람마다 따로(자기 작업공간 owner 표).
// 화면 줄 모양은 바꾸지 않는다: 뉴스 줄은 옛 app_news_items 칸 그대로(folder_id·hidden_at·keywords는 내 표시에서), 사회운동 글은 옛 app_outside_posts 칸 그대로.
// S68-27 READ-보관기록일원화(명진 11/22 21:37 "저장된 기록도 일원화"): '보관'의 원본은 읽을 거리 표(app_reading_items) 한 곳이다(DB 20261122230000).
//   줄 모양의 starred_at 칸 = 그 글을 가리키는 내 읽을 거리 줄의 저장 시각(saved_at). 표시 표의 옛 별표 칸(app_news_marks.starred_at·app_outside_article_marks.starred_at·
//   archived_at)은 읽지도 쓰지도 않는다(DB에 남긴 되돌리기용 기록).

import {hasTitle} from './news-clipping-model.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
// 줄 id(서버 줄은 uuid — 모양 검사는 서버가 한다. 화면은 빈 값만 거른다).
const hasId = v => typeof v === 'string' && v.length > 0 && v.length <= 64;

// 사람별 표시 칸(뉴스). 공용 기사 칸이 아니다. 보관(starred_at)은 표시 칸이 아니라 읽을 거리 줄에서 온다.
export const NEWS_MARK_COLS = Object.freeze(['folder_id', 'hidden_at', 'keywords']);
export const NEWS_MARK_EMBED = `app_news_marks(${NEWS_MARK_COLS.join(',')})`;
// 내 읽을 거리 줄(보관) embed — 외래 키 news_article_id·outside_article_id로 글에서 거꾸로 붙인다(정책상 내 작업공간 줄만, 주소에도 작업공간을 건다).
export const SAVED_EMBED = 'app_reading_items(saved_at)';
const ROW_ONLY = new Set([...NEWS_MARK_COLS, 'starred_at']);
// 화면이 넘긴 칸 목록에서 표시·보관 칸을 빼고 공용 기사 칸만(id는 늘 앞에).
export function articleCols(cols) {
  const list = String(cols || '').split(',').map(s => s.trim()).filter(Boolean).filter(c => !ROW_ONLY.has(c) && c !== 'id');
  return ['id', ...new Set(list)].join(',');
}
const one = v => (Array.isArray(v) ? v[0] || null : v && typeof v === 'object' ? v : null);
// embed된 읽을 거리 줄 → 보관 시각(없으면 null).
export const savedAtOf = saved => one(saved)?.saved_at ?? null;
// 공용 기사 + 내 표시 + 내 보관(embed) → 옛 뉴스 줄 모양.
export function flatNews(row) {
  if (!row || !hasId(row.id)) return null;
  const {app_news_marks: marks, app_reading_items: saved, ...art} = row;
  const m = one(marks);
  return {...art, starred_at: savedAtOf(saved), folder_id: m?.folder_id ?? null, hidden_at: m?.hidden_at ?? null, keywords: Array.isArray(m?.keywords) ? m.keywords : []};
}
// 내 표시 줄(+ 공용 기사 embed, 그 안에 내 보관 embed) → 옛 뉴스 줄 모양. 키워드 칸 읽기에 쓴다.
export function flatNewsMark(mark) {
  const raw = mark?.app_news_articles;
  if (!raw || !hasId(raw.id)) return null;
  const {app_reading_items: saved, ...art} = raw;
  return {...art, starred_at: savedAtOf(saved), folder_id: mark.folder_id ?? null, hidden_at: mark.hidden_at ?? null, keywords: Array.isArray(mark.keywords) ? mark.keywords : []};
}
// 내 읽을 거리 줄(+ 공용 기사 embed, 그 안에 내 표시 embed) → 옛 뉴스 줄 모양. 보관 목록·별표 폴더 칸·찾기의 '보관한 글'에 쓴다.
export function flatNewsSaved(saved) {
  const raw = saved?.app_news_articles;
  if (!raw || !hasId(raw.id)) return null;
  const {app_news_marks: marks, ...art} = raw;
  const m = one(marks);
  return {...art, starred_at: saved.saved_at ?? null, folder_id: m?.folder_id ?? null, hidden_at: m?.hidden_at ?? null, keywords: Array.isArray(m?.keywords) ? m.keywords : []};
}
// 목록 한 쪽: 읽은 줄 수(raw, 다음 쪽 시작 자리)와 내가 숨긴 것을 뺀 줄. 숨김은 사람별이라 공용 표 주소로 거를 수 없어 화면에서 뺀다.
// S70-17 NEWS-제목꼭얻기: 제목을 못 얻은 줄(보관하지 않은 것)도 뺀다(hasTitle — 지우지 않음, 제목이 생기면 다음 읽기에서 보인다).
// 목록 줄 수·날짜 묶음의 '새 글 N'은 이 결과로 세므로 함께 맞는다. raw(다음 쪽 읽기 위치)는 뺀 줄까지 센다.
export function newsPage(rows, pageSize) {
  const got = (Array.isArray(rows) ? rows : []).map(flatNews).filter(Boolean);
  const raw = Math.min(got.length, pageSize);
  return {raw, end: got.length <= pageSize, rows: got.slice(0, pageSize).filter(it => !it.hidden_at && hasTitle(it))};
}
// 사회운동 글의 내 표시(관심 없음) + 내 보관(읽을 거리) → 한 모양({post_id, starred_at, dismissed_at, app_outside_posts}).
// marks: [{article_id, dismissed_at}], saved: [{outside_article_id, saved_at, app_outside_articles?}]. starred_at = 보관 시각.
export function outsideMarkRows(marks, saved) {
  const out = new Map();
  for (const s of Array.isArray(saved) ? saved : []) {
    if (!s || !hasId(s.outside_article_id)) continue;
    out.set(s.outside_article_id, {post_id: s.outside_article_id, starred_at: s.saved_at ?? null, dismissed_at: null, app_outside_posts: s.app_outside_articles || null});
  }
  for (const m of Array.isArray(marks) ? marks : []) {
    if (!m || !hasId(m.article_id) || !m.dismissed_at) continue;
    const had = out.get(m.article_id);
    out.set(m.article_id, had ? {...had, dismissed_at: m.dismissed_at} : {post_id: m.article_id, starred_at: null, dismissed_at: m.dismissed_at, app_outside_posts: null});
  }
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
// 표시 쓰기 몸통: 칸 이름이 허락된 것만. 보관(별표)은 표시 칸이 아니라 읽을 거리 줄(app_reading_keep)이므로 여기서 받지 않는다(S68-27).
const MARK_FIELDS = {news: ['folder_id', 'hidden_at'], outside: ['dismissed_at']};
export function markFields(type, fields) {
  const keep = MARK_FIELDS[type] || [];
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) if (keep.includes(k) && (v === null || typeof v === 'string')) out[k] = v;
  return out;
}
