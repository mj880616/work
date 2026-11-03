// TODO-이미할일있음 (2026-11-03 요청 16:04): 정리함 [챙길 것] ⋯ [이미 할 일에 있음] — 후보와 비슷한 열린 할 일을 제목 비슷한 순으로 고르는 계산(화면 없이 시험).
// 제목은 공백·문장부호를 뺀 글자 두 개 묶음(bigram)이 겹치는 비율(Dice)로 비교한다. 겹침이 없는 할 일은 보이지 않는다.
const norm = v => String(v ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');
function grams(text) {
  const s = norm(text), out = new Map();
  if (!s) return out;
  if (s.length === 1) { out.set(s, 1); return out; }
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}
export function similarity(a, b) {
  const x = grams(a), y = grams(b);
  let sx = 0, sy = 0, shared = 0;
  for (const n of x.values()) sx += n;
  for (const n of y.values()) sy += n;
  if (!sx || !sy) return 0;
  for (const [g, n] of x) shared += Math.min(n, y.get(g) || 0);
  return (2 * shared) / (sx + sy);
}
export const LINK_MIN_SCORE = 0.15, LINK_MAX = 5;
// tasks: [{id,title,due?,status?}] → 끝나지 않은 것 중 비슷한 순 최대 5개.
export function similarTasks(summary, tasks, {limit = LINK_MAX, min = LINK_MIN_SCORE} = {}) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter(t => t && typeof t.id === 'string' && t.id && typeof t.title === 'string' && t.status !== 'completed')
    .map(t => ({task: t, score: similarity(summary, t.title)}))
    .filter(x => x.score >= min)
    .sort((p, q) => q.score - p.score || String(p.task.title).localeCompare(String(q.task.title)))
    .slice(0, limit)
    .map(x => x.task);
}
