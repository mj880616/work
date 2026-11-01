// S46-22 주간보고 제안 [×] + 받은·거절한 제안 학습 — 화면 없는 부분(모양 검사·합치기·학습 셈).
// - 저장: 그 주 요청 표 행의 draft.picks 칸 하나(서버, owner RLS). 새 표·새 칸 없음(draft jsonb 안의 칸, weekly-feedback.mjs EXTRA_KEYS).
//   {at, items:[{key, kind, from, cell, org, act, text, before?, at}], released:[{sig, at}], reviews?:[at…]}
//   act(WEEKLY-한흐름확정 ①, docs/design/weekly-one-flow.md 3.1절에서 넓힘):
//     'take'(제안 그대로 [수용]) | 'edit'([고쳐서 수용], before = 제안 글) | 'drop'(제안 [빼기]·[×]) — 제안에 대한 답(학습 셈에 들어감)
//     'fix'(보고서 줄 ⋯ [고치기], before = 고치기 전 줄) | 'cut'(보고서 줄 ⋯ [빼기]) | 'add'(묶음 [+ 추가] 수기 줄) — 보고서 줄 동작(kind 'line', 학습 셈 밖)
//     'none'(되돌리기·다시 넣기 — 앞 동작을 지운 표시, 합칠 때 더 나중 것이 이김)
//   why(WEEKLY-환류전칸 ⑤, 요청함 11/01 23:42): 'drop'(제안 [빼기])에 사람이 적은 이유 한 줄(안 써도 됨, WHY_MAX자까지). 서버 환류 정리가 참고한다.
//   reviews: 이 주에 환류 정리(ai-assist weekly_review)를 부른 시각들 — 정리 시점 셈(reviewDue: 확정 때 1회 + 동작 30건·6시간, 주 3회 상한, 명진 결정 11/01).
// - 학습: 지난 주들 + 이번 주 picks 를 모아 '종류'(sig = 제안 종류|출처|칸)마다 거절·받음을 센다. 여러 주에 걸쳐 계속 거절한 종류는
//   '거절해서 안 내는 것'이 되어 다음 제안에서 빠지고(접힌 '뺀 제안'에는 남음), 받은 종류는 앞에 놓인다. [풀기]는 그 종류의 지난 셈을 지운다.
// - 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.

export const PICK_KIND = Object.freeze({material:'칸 후보', calendar:'캘린더 추천', unmatched:'줄 못 찾은 기록', mismatch:'본문·일정표 다름', ai_line:'AI 줄 제안', review:'환류 규칙 후보',
  doc:'자료 줄', org_ai:'조직 AI 요약', ai_draft:'AI 초안 줄', line:'보고서 줄'});
export const PICK_FROM = Object.freeze({record:'기록', doc:'자료', calendar:'달력', ai:'AI', hand:'손'});
export const PICK_ACTS = Object.freeze(['take', 'edit', 'drop', 'fix', 'cut', 'add', 'none']);
export const ANSWER_ACTS = Object.freeze(['take', 'edit', 'drop']);     // 제안에 대한 답 — 학습 셈(learnPicks)에 들어감
export const LINE_ACTS = Object.freeze(['fix', 'cut', 'add']);          // 보고서 줄 동작
export const BEFORE_ACTS = Object.freeze(['edit', 'fix']);              // before(바꾸기 전 글)를 남기는 동작
export const WHY_ACTS = Object.freeze(['drop']);                        // why(빼는 이유, 안 써도 됨)를 남기는 동작
export const WHY_MAX = 100;
export const PICKS_MAX = 300;      // 한 주에 남기는 항목 수(넘으면 오래된 'none'부터, 그다음 오래된 것부터 버림)
export const PICKS_MAX_BYTES = 60000; // picks 칸 하나 상한(draft 전체 200 KiB 안에서 — weekly-feedback.mjs EXTRA_MAX_BYTES 와 같은 값)
export const REVIEWS_MAX = 12;
// 환류 정리 시점(명진 결정 11/01 13:32 ③): 확정 때 1회 + 확정 전이라도 새 동작 30건·마지막 정리에서 6시간, 같은 주 다시 확정은 새 동작 10건 이상, 주 3회 상한.
export const REVIEW_WEEK_MAX = 3;
export const REVIEW_OPEN_ACTIONS = 30;
export const REVIEW_OPEN_GAP_MS = 6 * 60 * 60 * 1000;
export const REVIEW_RECONFIRM_ACTIONS = 10;
export const PICK_TEXT = 100;      // 남기는 글 길이(보여 주기·다시 넣기용)
export const PICK_CELL = 80;
export const RELEASED_MAX = 40;
export const LEARN_PICK_WEEKS = 8; // 학습에 보는 주 수(이번 주 포함)
export const BLOCK_DROPS = 3;      // 이만큼 거절했고
export const BLOCK_WEEKS = 2;      // 서로 다른 주 이만큼에 걸쳐 거절했고, 받은 횟수의 두 배보다 많이 거절했으면 '안 냄'

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const one = s => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => [...one(s)].slice(0, n).join('');
// 열쇠용: 띄어쓰기·글머리·문장부호를 빼고 소문자(같은 제안이 공백 하나로 다른 것이 되지 않게).
export const squash = s => one(s).toLowerCase().replace(/^[-–·•*\s]+/, '').replace(/[\s.,·:;'"‘’“”()[\]{}~!?/\\|-]+/g, '');
const ISO = /^\d{4}-\d{2}-\d{2}T/;
const time = s => { const t = Date.parse(s ?? ''); return Number.isFinite(t) ? t : 0; };

// 제안 하나의 열쇠(그 주 안에서 같은 제안 = 같은 열쇠). cell 은 칸 이름(줄 번호 아님), 없으면 ''.
export const pickKey = ({kind, cell = '', text = ''}) => `${kind}|${cut(cell, PICK_CELL)}|${squash(text).slice(0, 120)}`;
// 제안 '종류' — 학습 단위. 같은 칸에 같은 출처의 같은 종류 제안.
export const sigOf = ({kind, from = '', cell = ''}) => `${kind}|${from}|${cut(cell, PICK_CELL)}`;
export function sigLabel(sig) {
  const [kind, from, ...rest] = String(sig).split('|'), cell = rest.join('|');
  const where = cell.replace(/^(summary|orgs|sites):/, '').replace('›', ' › ');
  return [PICK_KIND[kind] ?? kind, PICK_FROM[from], where].filter(Boolean).join(' · ');
}

function readItem(r) {
  if (!isObj(r) || !PICK_KIND[r.kind] || !PICK_ACTS.includes(r.act) || typeof r.key !== 'string' || !r.key || r.key.length > 400) return null;
  const out = {key:r.key, kind:r.kind, from:PICK_FROM[r.from] ? r.from : '', cell:cut(r.cell, PICK_CELL), org:cut(r.org, 60), act:r.act, text:cut(r.text, PICK_TEXT), at:ISO.test(String(r.at ?? '')) ? String(r.at) : ''};
  const before = BEFORE_ACTS.includes(r.act) ? cut(r.before, PICK_TEXT) : '';
  if (before) out.before = before;
  const why = WHY_ACTS.includes(r.act) ? cut(r.why, WHY_MAX) : '';
  if (why) out.why = why;
  return out;
}
const byteLen = v => new TextEncoder().encode(JSON.stringify(v)).length;
// 상한(개수·크기)을 넘으면 오래된 'none'(지운 표시)부터, 그다음 오래된 것부터 버린다. list 는 오래된 것부터.
function trimItems(list, fixed) {
  const out = [...list];
  let bytes = byteLen(out) + fixed;
  const drop = i => { bytes -= byteLen(out[i]) + 1; out.splice(i, 1); };
  while (out.length && (out.length > PICKS_MAX || bytes > PICKS_MAX_BYTES)) { const i = out.findIndex(x => x.act === 'none'); drop(i >= 0 ? i : 0); }
  return out;
}
// 서버에서 읽은 값(믿지 않는 입력) → 모양대로만. 비었으면 null.
export function readPicks(raw) {
  if (!isObj(raw)) return null;
  const items = new Map();
  for (const r of Array.isArray(raw.items) ? raw.items : []) { const x = readItem(r); if (x && (!items.has(x.key) || time(x.at) > time(items.get(x.key).at))) items.set(x.key, x); }
  const released = new Map();
  for (const r of Array.isArray(raw.released) ? raw.released : []) {
    if (!isObj(r) || typeof r.sig !== 'string' || !r.sig || r.sig.length > 200 || !ISO.test(String(r.at ?? ''))) continue;
    if (!released.has(r.sig) || time(r.at) > time(released.get(r.sig).at)) released.set(r.sig, {sig:r.sig, at:r.at});
  }
  const reviews = [...new Set((Array.isArray(raw.reviews) ? raw.reviews : []).filter(t => typeof t === 'string' && t.length <= 40 && ISO.test(t) && time(t)))].sort((a, b) => time(a) - time(b)).slice(-REVIEWS_MAX);
  if (!items.size && !released.size && !reviews.length) return null;
  const rel = [...released.values()].sort((a, b) => time(a.at) - time(b.at)).slice(-RELEASED_MAX);
  const list = trimItems([...items.values()].sort((a, b) => time(a.at) - time(b.at)), byteLen({at:'', released:rel, reviews}) + 64);
  const at = ISO.test(String(raw.at ?? '')) ? String(raw.at) : [...list, ...rel].map(x => x.at).concat(reviews).sort().at(-1) ?? '';
  return {at, items:list, released:rel, ...(reviews.length ? {reviews} : {})};
}
// 제안 하나·보고서 줄 하나에 표시(PICK_ACTS). item: {key?, kind, from, cell, org, text, before?}. key 가 없으면 pickKey(item).
// 'edit'은 item.key(또는 item 의 제안 글로 만든 열쇠) 그대로 두고 text 에 고친 글·before 에 제안 글을 둔다(같은 제안이 다시 나오지 않게).
export function withPick(picks, item, act, at) {
  const p = readPicks(picks) ?? {at:'', items:[], released:[]};
  const key = item.key ?? pickKey(item);
  const next = {key, kind:item.kind, from:item.from ?? '', cell:item.cell ?? '', org:item.org ?? '', act, text:item.text ?? '', ...(item.before ? {before:item.before} : {}), ...(item.why ? {why:item.why} : {}), at};
  return readPicks({at, items:[...p.items.filter(x => x.key !== key), next], released:p.released, reviews:p.reviews});
}
export function withRelease(picks, sig, at) {
  const p = readPicks(picks) ?? {at:'', items:[], released:[]};
  return readPicks({at, items:p.items, released:[...p.released.filter(r => r.sig !== sig), {sig, at}], reviews:p.reviews});
}
// 환류 정리(weekly_review)를 부른 시각 하나를 더한다.
export function withReview(picks, at) {
  const p = readPicks(picks) ?? {at:'', items:[], released:[]};
  return readPicks({at, items:p.items, released:p.released, reviews:[...(p.reviews ?? []), at]});
}
// 두 판 합치기: 열쇠마다 더 나중(at) 것. 기기 둘이 서로 다른 제안을 뺐으면 둘 다 남는다. 정리 시각은 둘을 합친다.
export function mergePicks(a, b) {
  const x = readPicks(a), y = readPicks(b);
  if (!x || !y) return x ?? y ?? null;
  return readPicks({items:[...x.items, ...y.items], released:[...x.released, ...y.released], reviews:[...(x.reviews ?? []), ...(y.reviews ?? [])]});
}
// 이번 주에 뺀 제안 열쇠 → 항목.
export const droppedOf = picks => new Map((readPicks(picks)?.items ?? []).filter(x => x.act === 'drop').map(x => [x.key, x]));
// 이번 주에 '다시 넣기'·받은 제안 열쇠(기억으로 빠지는 종류라도 이번 주엔 보임). 보고서 줄 동작(fix·cut·add)은 제안이 아니라 넣지 않는다.
export const keptOf = picks => new Set((readPicks(picks)?.items ?? []).filter(x => x.act === 'take' || x.act === 'edit' || x.act === 'none').map(x => x.key));

// ---- 환류 정리 시점 ----
// 마지막 정리 뒤에 쌓인 동작 수('none' 제외). since 가 ''이면 이 주 전부.
export const actionsSince = (picks, since = '') => (readPicks(picks)?.items ?? []).filter(x => x.act !== 'none' && (!since || time(x.at) > time(since))).length;
// 지금 환류 정리를 불러도 되나. when: 'open'([주간 정리]를 열 때) | 'confirm'([확정하고 한글 파일 받기]). confirmed: 이 주를 전에 확정한 적이 있나.
// 반환 {due, why, actions(마지막 정리 뒤 동작 수), last(마지막 정리 시각 | ''), used(이 주 정리 횟수)}.
//   why: 'confirm'(처음 확정) | 'reconfirm'(다시 확정, 새 동작 10건 이상) | 'actions'(확정 전 30건·6시간) | 'cap'(주 3회 다 씀) | 'few'(동작 모자람) | 'soon'(6시간 안 됨)
export function reviewDue(picks, {when = 'open', confirmed = false, now = new Date().toISOString()} = {}) {
  const p = readPicks(picks), reviews = p?.reviews ?? [], last = reviews.at(-1) ?? '', used = reviews.length, actions = actionsSince(p, last);
  const out = why => ({due:['confirm', 'reconfirm', 'actions'].includes(why), why, actions, last, used});
  if (used >= REVIEW_WEEK_MAX) return out('cap');
  if (when === 'confirm') return !confirmed ? out('confirm') : actions >= REVIEW_RECONFIRM_ACTIONS ? out('reconfirm') : out('few');
  if (actions < REVIEW_OPEN_ACTIONS) return out('few');
  return last && time(now) - time(last) < REVIEW_OPEN_GAP_MS ? out('soon') : out('actions');
}

// rows: [{week_start, picks}] (이번 주 포함, 어떤 순서든). 반환:
//   {sigs: Map sig → {drops, takes, weeks:Set, last}, blocked: [{sig, label, drops, takes, last}], score(item), blocks(item)}
export function learnPicks(rows = [], {weeks = LEARN_PICK_WEEKS} = {}) {
  const list = rows.filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.week_start ?? ''))).sort((a, b) => (a.week_start < b.week_start ? 1 : -1)).slice(0, weeks);
  const picks = list.map(r => ({week:r.week_start, p:readPicks(r.picks)})).filter(r => r.p);
  const released = new Map();
  for (const {p} of picks) for (const r of p.released) if (!released.has(r.sig) || time(r.at) > time(released.get(r.sig))) released.set(r.sig, r.at);
  const sigs = new Map();
  for (const {week, p} of picks) for (const x of p.items) {
    if (!ANSWER_ACTS.includes(x.act)) continue; // 보고서 줄 동작(fix·cut·add)·지운 표시는 제안 학습이 아니다
    const sig = sigOf(x);
    if (released.has(sig) && time(x.at) <= time(released.get(sig))) continue;
    const s = sigs.get(sig) ?? sigs.set(sig, {drops:0, takes:0, weeks:new Set(), last:''}).get(sig);
    if (x.act === 'drop') { s.drops++; s.weeks.add(week); } else s.takes++; // take·edit = 받음
    if (x.at > s.last) s.last = x.at;
  }
  const isBlocked = s => !!s && s.drops >= BLOCK_DROPS && s.weeks.size >= BLOCK_WEEKS && s.drops > s.takes * 2;
  const blocked = [...sigs].filter(([, s]) => isBlocked(s)).map(([sig, s]) => ({sig, label:sigLabel(sig), drops:s.drops, takes:s.takes, last:s.last}))
    .sort((a, b) => b.drops - a.drops || (a.sig < b.sig ? -1 : 1));
  return {
    sigs, blocked,
    blocks: item => isBlocked(sigs.get(sigOf(item))),
    score: item => { const s = sigs.get(sigOf(item)); return s ? s.takes - s.drops : 0; },
  };
}
export const emptyLearn = () => learnPicks([]);

// 제안 목록 하나 거르기: 이번 주에 뺀 것(dropped)·거절해서 안 내는 종류(learn.blocks)는 빼서 gone 으로(접힌 '뺀 제안'에서 다시 넣기),
// 남은 것은 받은 종류부터(같은 점수는 원래 순서). 같은 열쇠가 두 번이면 한 번만(중복 제안). describe(x) → {kind, from, cell, org, text}.
export function sortPicks(list, describe, {dropped = new Map(), learn = emptyLearn(), kept = new Set()} = {}) {
  const shown = [], gone = [], seen = new Set();
  list.forEach((x, i) => {
    const d = describe(x), key = pickKey(d);
    if (seen.has(key)) return;
    seen.add(key);
    const item = {...d, key, raw:x, i};
    if (dropped.has(key)) gone.push({...item, why:'drop'});
    else if (!kept.has(key) && learn.blocks(d)) gone.push({...item, why:'learn'});
    else shown.push(item);
  });
  shown.sort((a, b) => learn.score(b) - learn.score(a) || a.i - b.i);
  return {shown, gone};
}
