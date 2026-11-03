// TODO-이미함·환류 5절: 챙길 것 결과 기록(app_todo_feedback)으로 만드는 '주 1회 비율' 한 줄. 순수 함수만 둔다(읽기는 todo-radar-data.js).
// 주는 한국 날짜 월~일. 지난주와 그 전 주를 세고, 가장 많이 바뀐 결과 하나만 '+n%p / −n%p'로 비교한다(5%p 미만이면 '비슷').
export const OUTCOME_ORDER = Object.freeze(['tasked', 'already_tasked', 'done', 'dismissed', 'not_mine']);
export const OUTCOME_LABEL = Object.freeze({tasked:'할 일로', already_tasked:'이미 할 일에 있음', done:'이미 함', dismissed:'무시', not_mine:'내 일 아님'});
export const CHANGE_MIN = 5;
const DAY_MS = 86400000, KST_MS = 9 * 3600000;

// 이번 주 월요일 0시(한국)부터 거꾸로 세 경계: [그 전 주 시작, 지난주 시작, 이번 주 시작] (ISO 시각).
export function weekBounds(now = new Date()) {
  const kst = new Date(now.getTime() + KST_MS);
  const midnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_MS;
  const sinceMonday = (kst.getUTCDay() + 6) % 7;
  const thisWeek = midnight - sinceMonday * DAY_MS;
  return {prev:new Date(thisWeek - 14 * DAY_MS).toISOString(), last:new Date(thisWeek - 7 * DAY_MS).toISOString(), current:new Date(thisWeek).toISOString()};
}

export function countWeek(rows, from, to) {
  const counts = Object.fromEntries(OUTCOME_ORDER.map(k => [k, 0])), a = Date.parse(from), b = Date.parse(to);
  for (const r of rows || []) {
    const at = Date.parse(r?.created_at);
    if (Object.hasOwn(counts, r?.outcome) && at >= a && at < b) counts[r.outcome]++;
  }
  return {counts, total:OUTCOME_ORDER.reduce((n, k) => n + counts[k], 0)};
}
// 반올림한 퍼센트(합이 100이 아닐 수 있음, 건수가 0이면 모두 0).
export const percents = ({counts, total}) => Object.fromEntries(OUTCOME_ORDER.map(k => [k, total ? Math.round(counts[k] * 100 / total) : 0]));

// {text, total, pct, change:{outcome, diff}|null} 또는 두 주 모두 0건이면 null.
export function weeklySummary(rows, now = new Date()) {
  const w = weekBounds(now);
  const last = countWeek(rows, w.last, w.current), prev = countWeek(rows, w.prev, w.last);
  if (!last.total && !prev.total) return null;
  if (!last.total) return {text:'지난주 챙길 것 처리 0건', total:0, pct:percents(last), change:null};
  const pct = percents(last);
  const parts = OUTCOME_ORDER.filter(k => last.counts[k]).map(k => `${OUTCOME_LABEL[k]} ${pct[k]}%`);
  let change = null, tail = '';
  if (prev.total) {
    const before = percents(prev);
    const best = OUTCOME_ORDER.map(k => ({outcome:k, diff:pct[k] - before[k]})).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
    change = best;
    tail = Math.abs(best.diff) < CHANGE_MIN ? ' · 그 전 주와 비슷' : ` · 그 전 주보다 ${OUTCOME_LABEL[best.outcome]} ${best.diff > 0 ? '+' : '−'}${Math.abs(best.diff)}%p`;
  }
  return {text:`지난주 챙길 것 ${last.total}건 · ${parts.join(' · ')}${tail}`, total:last.total, pct, change};
}

// 펼침 안: 지난주 결과별 최근 문장 n개(고친 문장이 있으면 '제안 → 고친 것').
export function recentByOutcome(rows, now = new Date(), n = 5) {
  const w = weekBounds(now), a = Date.parse(w.last), b = Date.parse(w.current);
  const lists = Object.fromEntries(OUTCOME_ORDER.map(k => [k, []]));
  const sorted = [...(rows || [])].filter(r => Object.hasOwn(lists, r?.outcome)).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
  for (const r of sorted) {
    const at = Date.parse(r.created_at);
    if (!(at >= a && at < b) || lists[r.outcome].length >= n || typeof r.summary !== 'string') continue;
    lists[r.outcome].push(typeof r.edited === 'string' && r.edited.trim() ? `${r.summary} → ${r.edited}` : r.summary);
  }
  return OUTCOME_ORDER.filter(k => lists[k].length).map(k => ({outcome:k, label:OUTCOME_LABEL[k], lines:lists[k]}));
}
