// S63-11 NEWS-서버찾기(사용자 11/16 결정 '4 고쳐'): News [전체]·[언론] 탭 위 찾기 칸 = 서버 찾기. 그리기·네트워크 없는 순수 함수만(node --test).
// - 찾는 곳: 최근 FIND_DAYS일 글(뉴스 기사는 받은 날, 사회운동 글은 올린 날·없으면 받은 날) + 보관한 글(뉴스 별표, 사회운동 보관·별표)은 기간 없이.
// - 찾는 칸: 제목·한국어 제목·요약(뉴스 summary, 사회운동 summary_ko). 공용 표 읽기 정책(로그인 + 자기 작업공간 + 차단 명단 아님)과 내 표시 owner 정책 그대로 — 새 권한 없음.
// - 낱말은 순서대로 이어 찾는다('철도 파업' → '*철도*파업*'). 서버 거르기 글자(PostgREST)에서 뜻이 있는 글자(* % _ \ ")는 빼고 큰따옴표로 감싼다.
// [사회운동] 탭은 예전 그대로(화면 제목 거르기 + Enter = 문장 찾기 outside-search.js) — 탭마다 한 길.
export const FIND_DAYS = 30;
export const FIND_LIMIT = 60;
export const FIND_MIN_CHARS = 2;
export const FIND_WAIT_MS = 350;
export const FIND_TABS = Object.freeze(['all', 'media']);
export const findTab = tab => FIND_TABS.includes(tab);
export const NEWS_FIND_COLS = Object.freeze(['title', 'title_ko', 'summary']);
export const POST_FIND_COLS = Object.freeze(['title', 'title_ko', 'summary_ko']);
// 찾는 말 → 낱말 목록(없거나 너무 짧으면 null).
export function findWords(raw) {
  // eslint-disable-next-line no-control-regex
  const words = String(raw ?? '').replace(/[*%_\\"\u0000-\u001f\u007f]/g, ' ').split(/\s+/).filter(Boolean);
  return [...words.join('')].length >= FIND_MIN_CHARS ? words.slice(0, 8) : null;
}
// 낱말 → 칸마다 ilike 조건을 or로 묶은 글자 '(title.ilike."*철도*",…)'. 주소에 넣을 때는 따로 encodeURIComponent.
export function ilikeAny(cols, words) {
  const pattern = `*${words.join('*')}*`;
  return `(${cols.map(c => `${c}.ilike."${pattern}"`).join(',')})`;
}
export const sinceIso = (nowMs, days = FIND_DAYS) => new Date(nowMs - days * 86400000).toISOString();
// 최근 글 + 보관한 글 → 하나(같은 id는 한 번), 시각 최신 순. atOf(row) = 시각(ms, 모르면 NaN).
export function mergeFound(recent, kept, atOf) {
  const seen = new Set(), out = [];
  for (const r of [...(recent || []), ...(kept || [])]) {
    if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue;
    seen.add(r.id); out.push(r);
  }
  const at = r => { const t = atOf(r); return Number.isFinite(t) ? t : -Infinity; };
  return out.sort((a, b) => at(b) - at(a) || String(a.id).localeCompare(String(b.id)));
}
// 찾은 결과가 없을 때 한 줄(ui-words: '~이 없어요').
export const FIND_EMPTY = `최근 ${FIND_DAYS}일·저장한 글에서 찾은 글이 없어요`;
export const FIND_SHORT = `${FIND_MIN_CHARS}글자부터 찾아요`;
