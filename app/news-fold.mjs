// NEWS-도배막기(명진 11/09 '여전히 프레시안만 잔뜩', 결정 11/10 'A + C'): News 목록 줄 순서·묶음 계산. 그리기 없는 순수 함수만.
// 세 목록([전체]·[사회운동]은 outside-statements.js, [언론]은 news-clipping.js)이 같은 규칙을 이 한 곳에서 쓴다. 서버·DB는 그대로.
// A. 같은 언론 매체 기사가 연달아 나오면 한 묶음: 첫 기사 한 줄 + 작게 '○○ 외 N건'(그리기는 news-row.mjs foldHtml).
//    단체 성명·논평(사회운동 글)은 묶지 않는다. 묶음은 날짜 묶음 안에서만(날짜를 넘지 않음).
// C. 관심 주제(now-interests.js 확정 주제)에 걸린 글은 위 칸 '관심 주제'에 먼저(시간순 그대로), 나머지는 아래 날짜별 시간순.
//    근거는 줄 끝 작은 표시(now-hit)와 같은 interestHit 하나 — 새 점수는 없다. 오래된 글이 위 칸을 늘 차지하지 않게 최근 48시간만 올린다.

export const LIFT_HOURS = 48;
export const LIFT_LABEL = '관심 주제';

// 묶음 기준: 언론 기사만 매체 키(source_key, 없으면 매체 이름). 사회운동 글·매체를 모르는 기사는 '' = 묶지 않음.
export function foldSrc(type, row) {
  if (type !== 'news' || !row) return '';
  if (typeof row.source_key === 'string' && row.source_key) return 'k:' + row.source_key;
  const p = typeof row.publisher === 'string' ? row.publisher.trim() : '';
  return p ? 'p:' + p : '';
}

// entries = [{type, row, …}] 그릴 순서. → [{lead, more: [entries]}] (more가 비면 묶지 않은 한 줄). 순서는 그대로.
export function foldRuns(entries) {
  const out = [];
  for (const e of entries || []) {
    const src = foldSrc(e?.type, e?.row), last = out.at(-1);
    if (src && last && last.src === src) last.more.push(e);
    else out.push({src, lead: e, more: []});
  }
  return out.map(({lead, more}) => ({lead, more}));
}

// 위 칸으로 올릴 글과 나머지. isHit(entry) = 관심 주제에 걸렸는지, atOf(entry) = 시각(ms, 모르면 null). 둘 다 원래 순서 유지.
export function liftRelated(entries, isHit, atOf, now = Date.now()) {
  const top = [], rest = [], since = now - LIFT_HOURS * 3600000;
  for (const e of entries || []) {
    const at = atOf(e);
    if (Number.isFinite(at) && at >= since && isHit(e)) top.push(e); else rest.push(e);
  }
  return {top, rest};
}
