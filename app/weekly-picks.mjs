// S46-22 주간보고 제안 [×] + 받은·거절한 제안 학습 — 화면 없는 부분(모양 검사·합치기·학습 셈).
// - 저장: 그 주 요청 표 행의 draft.picks 칸 하나(서버, owner RLS). 새 표·새 칸 없음(draft jsonb 안의 칸, weekly-feedback.mjs EXTRA_KEYS).
//   {at, items:[{key, kind, from, cell, org, act, text, at}], released:[{sig, at}]}
//   act: 'drop'(거절, [×]) | 'take'(받음, [붙이기]·[+]·'이렇게 바꾸면?') | 'none'(되돌리기·다시 넣기 — 지운 표시, 합칠 때 더 나중 것이 이김)
// - 학습: 지난 주들 + 이번 주 picks 를 모아 '종류'(sig = 제안 종류|출처|칸)마다 거절·받음을 센다. 여러 주에 걸쳐 계속 거절한 종류는
//   '거절해서 안 내는 것'이 되어 다음 제안에서 빠지고(접힌 '뺀 제안'에는 남음), 받은 종류는 앞에 놓인다. [풀기]는 그 종류의 지난 셈을 지운다.
// - 브라우저 저장소에 아무것도 두지 않는다. 글은 로그에 쓰지 않는다.

export const PICK_KIND = Object.freeze({material:'칸 후보', calendar:'캘린더 추천', unmatched:'줄 못 찾은 기록', mismatch:'본문·일정표 다름', ai_line:'AI 줄 제안', review:'환류 규칙 후보'});
export const PICK_FROM = Object.freeze({record:'기록', doc:'자료', calendar:'달력', ai:'AI'});
export const PICK_ACTS = Object.freeze(['drop', 'take', 'none']);
export const PICKS_MAX = 160;      // 한 주에 남기는 항목 수(넘으면 오래된 것부터 버림)
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
  return {key:r.key, kind:r.kind, from:PICK_FROM[r.from] ? r.from : '', cell:cut(r.cell, PICK_CELL), org:cut(r.org, 60), act:r.act, text:cut(r.text, PICK_TEXT), at:ISO.test(String(r.at ?? '')) ? String(r.at) : ''};
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
  if (!items.size && !released.size) return null;
  const list = [...items.values()].sort((a, b) => time(a.at) - time(b.at)).slice(-PICKS_MAX);
  const rel = [...released.values()].sort((a, b) => time(a.at) - time(b.at)).slice(-RELEASED_MAX);
  const at = ISO.test(String(raw.at ?? '')) ? String(raw.at) : [...list, ...rel].map(x => x.at).sort().at(-1) ?? '';
  return {at, items:list, released:rel};
}
// 제안 하나에 표시(drop|take|none). item: {kind, from, cell, org, text}.
export function withPick(picks, item, act, at) {
  const p = readPicks(picks) ?? {at:'', items:[], released:[]};
  const key = item.key ?? pickKey(item);
  const next = {key, kind:item.kind, from:item.from ?? '', cell:item.cell ?? '', org:item.org ?? '', act, text:item.text ?? '', at};
  return readPicks({at, items:[...p.items.filter(x => x.key !== key), next], released:p.released});
}
export function withRelease(picks, sig, at) {
  const p = readPicks(picks) ?? {at:'', items:[], released:[]};
  return readPicks({at, items:p.items, released:[...p.released.filter(r => r.sig !== sig), {sig, at}]});
}
// 두 판 합치기: 열쇠마다 더 나중(at) 것. 기기 둘이 서로 다른 제안을 뺐으면 둘 다 남는다.
export function mergePicks(a, b) {
  const x = readPicks(a), y = readPicks(b);
  if (!x || !y) return x ?? y ?? null;
  return readPicks({items:[...x.items, ...y.items], released:[...x.released, ...y.released]});
}
// 이번 주에 뺀 제안 열쇠 → 항목.
export const droppedOf = picks => new Map((readPicks(picks)?.items ?? []).filter(x => x.act === 'drop').map(x => [x.key, x]));
// 이번 주에 '다시 넣기'한 제안 열쇠(기억으로 빠지는 종류라도 이번 주엔 보임).
export const keptOf = picks => new Set((readPicks(picks)?.items ?? []).filter(x => x.act !== 'drop').map(x => x.key));

// rows: [{week_start, picks}] (이번 주 포함, 어떤 순서든). 반환:
//   {sigs: Map sig → {drops, takes, weeks:Set, last}, blocked: [{sig, label, drops, takes, last}], score(item), blocks(item)}
export function learnPicks(rows = [], {weeks = LEARN_PICK_WEEKS} = {}) {
  const list = rows.filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.week_start ?? ''))).sort((a, b) => (a.week_start < b.week_start ? 1 : -1)).slice(0, weeks);
  const picks = list.map(r => ({week:r.week_start, p:readPicks(r.picks)})).filter(r => r.p);
  const released = new Map();
  for (const {p} of picks) for (const r of p.released) if (!released.has(r.sig) || time(r.at) > time(released.get(r.sig))) released.set(r.sig, r.at);
  const sigs = new Map();
  for (const {week, p} of picks) for (const x of p.items) {
    if (x.act === 'none') continue;
    const sig = sigOf(x);
    if (released.has(sig) && time(x.at) <= time(released.get(sig))) continue;
    const s = sigs.get(sig) ?? sigs.set(sig, {drops:0, takes:0, weeks:new Set(), last:''}).get(sig);
    if (x.act === 'drop') { s.drops++; s.weeks.add(week); } else s.takes++;
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
