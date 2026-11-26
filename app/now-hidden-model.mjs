// S70-62 READ-밀기메뉴 [숨긴 글](명진 11/26 07:41 "근데 숨기기는 어떻게 다시 보지?"): 숨긴 글 목록의 순수 규칙(화면·서버 없음 — 단위 시험).
// 원본은 서버 표시 표(뉴스 app_news_marks.hidden_at · 사회운동 app_outside_article_marks.dismissed_at). 이 파일은 두 쪽을 합쳐 최근 숨긴 것 먼저로 줄 세운다.
export const HIDDEN_LIMIT = 100;
export const HIDDEN_TITLE = '숨긴 글';
export const UNHIDE_LABEL = '다시 보이기';
export const UNHIDE_TEXT = '다시 보이게 했어요';
export const HIDDEN_EMPTY = '숨긴 글 없음';

const ms = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
// news: 옛 뉴스 줄 모양(hidden_at 포함), outside: [{row, at}]. mine(row): 내가 넣은 기사 — 그 [삭제]도 숨김 칸(hidden_at)을 쓰므로 숨긴 글에서 뺀다(삭제는 [되돌리기]로만 되살림).
export function hiddenEntries({news = [], outside = []} = {}, {mine = () => false, limit = HIDDEN_LIMIT} = {}) {
  const seen = new Set(), out = [];
  const add = (type, row, at) => {
    if (!row || typeof row.id !== 'string' || !row.id) return;
    const key = `${type}:${row.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({type, id: row.id, key, at: at || '', row});
  };
  for (const row of Array.isArray(news) ? news : []) if (row?.hidden_at && !mine(row)) add('news', row, row.hidden_at);
  for (const x of Array.isArray(outside) ? outside : []) if (x?.at) add('outside', x.row, x.at);
  return out.sort((a, b) => ms(b.at) - ms(a.at) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, limit);
}
// 다시 보이기 뒤 목록에서 그 글 하나만 뺀다(되돌리기면 다시 읽는다).
export const withoutEntry = (entries, key) => (Array.isArray(entries) ? entries.filter(e => e.key !== key) : []);
