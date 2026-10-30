// WEEKLY-환류학습 (docs/design/weekly-draft-feedback.md 9~13절): 주간보고 제안이 점점 나아지는 환류 구조의 화면 없는 부분.
// 같은 코드를 node 시험이 그대로 부른다. 화면·네트워크 없음. 글은 업무 글이므로 로그·오류 보고에 넣지 않는다.
//
//   pickBase(자료 목록, 보고일)         → 다음 주 바탕: 보고일 앞의 최신 '주간보고 개인본', 없으면 지금처럼 최신 팀 '주간보고 확정본'
//   teamChanges(개인본 칸, 확정본 칸)    → 팀 확정본에서 내 칸 글이 바뀐 곳(참고용 '확정본에서 바뀜' 표시)
//   diffLines / diffCells / feedbackRecord → [확정] 때 처음 초안(proposed) ↔ 내 최종 개인본 줄 비교(남김·고침·뺌·더함)
//   compareTest(AI 초안 칸, 이번 주 개인본 칸) → [학습 시험] 줄마다 같음·비슷·다름·빠짐·AI만, '그대로 쓸 수 있는 줄 n/m'
//   feedbackTrend(이번 주, 지난 주들)    → 환류 보고 ① 숫자(지난 주들과 비교)
//   readExtras / mergeExtras             → 그 주 draft 의 proposed·feedback·rules 칸 모양 검사·합치기(weekly-draft-store.js 가 씀)
//   withRule* / readRules                → '주간보고 규칙' 목록 고치기·지우기·더하기(10~20줄)
//   learnInput(행들, 보고 주)            → 학습 재료: 보고 주 '앞' 주들의 고침 기록·규칙만(이번 주 개인본·이번 주 기록은 넣지 않음)
import {squashLine} from './weekly-lines.mjs';

export const EXTRA_KEYS = Object.freeze(['proposed', 'feedback', 'rules']);
export const FEEDBACK_LINE_CHARS = 300;
export const FEEDBACK_LIST_MAX = 60;      // 고침·뺌·더함 목록마다(넘으면 숫자만 맞고 줄은 앞 60개)
export const PROPOSED_CELLS_MAX = 200;
export const RULES_MAX = 20;
export const RULE_CHARS = 120;
export const SUGGESTIONS_MAX = 4;       // 입력창 1~3 + 재료·흐름(서버 WL_SUGGESTIONS 와 같음)
export const CELL_STATS_MAX = 120;      // 고침 기록의 칸별 숫자(입력창 모양 제안 재료)
// 개선 제안 분류(서버 weekly-learn.ts SUGGESTION_AREAS 와 같음). 입력창 = 한글 파일 상자 칸 모양·칸 구성.
export const SUGGESTION_AREA = Object.freeze({input:'입력창', material:'재료', flow:'흐름'});
export const EXTRA_MAX_BYTES = 60000;     // 칸 하나 상한(draft 전체 200 KiB 안에서)
export const LEARN_WEEKS = 4;             // 학습 재료로 보는 지난 주 수
export const SIMILAR = 0.75;              // 이 이상이면 '비슷'(그대로 쓸 수 있는 줄로 셈)
export const PAIR = 0.4;                  // 이 이상이면 같은 줄을 고친 것('고침'·'다름'), 아래면 뺀 줄 + 새 줄

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SECTIONS = ['summary', 'orgs', 'sites'];
export const SECTION_LABEL = Object.freeze({summary:'요약', orgs:'산하조직', sites:'투쟁 사업장'});
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;
const line = s => [...String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, FEEDBACK_LINE_CHARS).join('');
const at40 = v => (typeof v === 'string' && v.length <= 40 ? v : '');
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const cellIdOf = (section, key, n) => `${section}\u0000${key}\u0000${n}`;
const parseId = id => { const [section, key, n] = String(id).split('\u0000'); return {section, key, n:Number(n)}; };
export const whereOf = id => { const {section, key, n} = parseId(id); return `${SECTION_LABEL[section] ?? section} · ${String(key).replace('›', ' › ')}${n ? ` (${n + 1}번째)` : ''}`; };

// ---- 바탕 고르기 ----
// personal·confirmed: 자료실 행 [{id, title, file_name, document_date, created_at}] (최신순이 아니어도 됨). day: 이번 초안의 보고일(YYYY-MM-DD).
// 개인본은 보고일 '앞'(document_date < day, 날짜가 없으면 올린 날 < day)인 것만 — 이번 주 개인본은 바탕이 아니다(학습 시험에서 답을 보지 않게).
const dayOf = d => (DAY.test(String(d?.document_date ?? '')) ? d.document_date : String(d?.created_at ?? '').slice(0, 10));
const newest = list => [...list].sort((a, b) => (dayOf(b) > dayOf(a) ? 1 : dayOf(b) < dayOf(a) ? -1 : String(b.created_at ?? '') > String(a.created_at ?? '') ? 1 : -1))[0] ?? null;
export function pickBase({personal = [], confirmed = []} = {}, day = '') {
  const mine = newest((personal ?? []).filter(d => d && d.id && (!DAY.test(day) || dayOf(d) < day)));
  if (mine) return {doc:mine, from:'personal', team:newest((confirmed ?? []).filter(d => d && d.id)) };
  const team = newest((confirmed ?? []).filter(d => d && d.id));
  return team ? {doc:team, from:'confirmed', team:null} : null;
}
// 팀 확정본이 개인본보다 나중 것일 때만 '확정본에서 바뀜'을 본다(앞선 확정본은 이미 개인본에 들어 있던 것).
export const teamIsNewer = (personal, team) => !!personal && !!team && (dayOf(team) > dayOf(personal) || (dayOf(team) === dayOf(personal) && String(team.created_at ?? '') > String(personal.created_at ?? '')));

// ---- 칸 ----
// cells: Map(cellId → 줄 배열) 또는 [{section, key, n, lines}] → Map. 빈 줄은 뺀다.
export function toCells(cells) {
  const out = new Map();
  const put = (id, lines) => { const clean = (Array.isArray(lines) ? lines : []).map(line).filter(Boolean); out.set(id, clean); };
  if (cells instanceof Map) for (const [id, lines] of cells) put(id, lines);
  else for (const c of Array.isArray(cells) ? cells : []) if (c && SECTIONS.includes(c.section) && typeof c.key === 'string' && Number.isInteger(c.n) && c.n >= 0) put(cellIdOf(c.section, c.key, c.n), c.lines);
  return out;
}
export const cellList = cells => [...toCells(cells)].slice(0, PROPOSED_CELLS_MAX).map(([id, lines]) => { const {section, key, n} = parseId(id); return {section, key, n, lines}; });

// 개인본 칸 ↔ 팀 확정본 칸: 확정본에 같은 칸이 있고 글이 다를 때만(정리한 글자로 비교) → Map(cellId → 확정본 줄).
export function teamChanges(personal, team) {
  const mine = toCells(personal), theirs = toCells(team), out = new Map();
  const flat = lines => lines.map(squashLine).filter(Boolean).join('\n');
  for (const [id, lines] of theirs) if (mine.has(id) && flat(mine.get(id)) !== flat(lines)) out.set(id, lines);
  return out;
}

// ---- 줄 비교 ----
const grams = s => { const k = squashLine(s), out = new Map(); if ([...k].length < 2) { if (k) out.set(k, 1); return out; } const c = [...k]; for (let i = 0; i < c.length - 1; i++) { const g = c[i] + c[i + 1]; out.set(g, (out.get(g) ?? 0) + 1); } return out; };
// 두 줄이 얼마나 같은가(0~1, 글자 두 개씩 묶음의 Dice). 공백·문장부호는 보지 않는다.
export function similarity(a, b) {
  const x = grams(a), y = grams(b);
  if (!x.size || !y.size) return 0;
  let both = 0, nx = 0, ny = 0;
  for (const v of x.values()) nx += v;
  for (const v of y.values()) ny += v;
  for (const [g, v] of x) both += Math.min(v, y.get(g) ?? 0);
  return (2 * both) / (nx + ny);
}
// before(초안 줄) → after(최종 줄): 정리한 글자가 같으면 kept, 비슷한 짝(PAIR 이상, 높은 것부터)은 changed, 남은 초안 줄은 dropped, 남은 최종 줄은 added.
export function diffLines(before = [], after = []) {
  const b = before.map(line).filter(Boolean), a = after.map(line).filter(Boolean);
  const usedA = new Set(), usedB = new Set(), kept = [];
  b.forEach((x, i) => { const k = squashLine(x); const j = a.findIndex((y, jj) => !usedA.has(jj) && squashLine(y) === k); if (j >= 0) { usedA.add(j); usedB.add(i); kept.push(a[j]); } });
  const pairs = [];
  b.forEach((x, i) => { if (usedB.has(i)) return; a.forEach((y, j) => { if (usedA.has(j)) return; const score = similarity(x, y); if (score >= PAIR) pairs.push({i, j, score}); }); });
  pairs.sort((p, q) => q.score - p.score || p.i - q.i || p.j - q.j);
  const changed = [];
  for (const p of pairs) if (!usedB.has(p.i) && !usedA.has(p.j)) { usedB.add(p.i); usedA.add(p.j); changed.push({before:b[p.i], after:a[p.j], score:Math.round(p.score * 100) / 100, i:p.i}); }
  changed.sort((p, q) => p.i - q.i);
  return {kept, changed:changed.map(({i, ...rest}) => rest), dropped:b.filter((_, i) => !usedB.has(i)), added:a.filter((_, j) => !usedA.has(j))};
}
// 칸 단위로 비교해 모은다. 초안에만 있는 칸은 뺀 줄, 최종에만 있는 칸은 새 줄.
export function diffCells(proposed, final) {
  const p = toCells(proposed), f = toCells(final), out = {kept:0, changed:[], dropped:[], added:[], proposed:0, final:0, cells:[]};
  for (const id of [...new Set([...p.keys(), ...f.keys()])]) {
    const before = p.get(id) ?? [], after = f.get(id) ?? [], d = diffLines(before, after), where = whereOf(id);
    out.proposed += before.length; out.final += after.length; out.kept += d.kept.length;
    // 칸마다 숫자만(글 없음): 매번 비워 두는 칸·늘 손으로 다시 쓰는 칸·늘 지우는 줄을 환류 보고가 여러 주에 걸쳐 센다.
    out.cells.push({where, proposed:before.length, final:after.length, kept:d.kept.length, changed:d.changed.length, dropped:d.dropped.length, added:d.added.length});
    for (const c of d.changed) out.changed.push({where, before:c.before, after:c.after});
    for (const t of d.dropped) out.dropped.push({where, text:t});
    for (const t of d.added) out.added.push({where, text:t});
  }
  return out;
}
// [확정] 때 서버(그 주 행의 draft.feedback)에 남길 기록. 사람이 확정한 최종 글만 '배울 값'이다.
export function feedbackRecord({week, at, proposed, final, from = 'confirm'}) {
  const d = diffCells(proposed, final);
  const counts = {kept:d.kept, changed:d.changed.length, dropped:d.dropped.length, added:d.added.length, proposed:d.proposed, final:d.final};
  const trim = list => list.slice(0, FEEDBACK_LIST_MAX);
  return readFeedback({at, week, from, counts, cells:d.cells.slice(0, CELL_STATS_MAX), changed:trim(d.changed), dropped:trim(d.dropped), added:trim(d.added)});
}
// 초안 줄 가운데 그대로 남은 비율(0~100, 초안 줄이 없으면 null).
export const keptRate = counts => (counts && counts.proposed > 0 ? Math.round((counts.kept / counts.proposed) * 100) : null);
// 환류 보고 ①: 이번 주 숫자 + 지난 주들(오래된 것부터 최대 LEARN_WEEKS) 남김 비율.
export function feedbackTrend(current, previous = []) {
  const now = readFeedback(current);
  if (!now) return null;
  const prev = previous.map(readFeedback).filter(f => f && f.week < now.week).sort((a, b) => (a.week < b.week ? -1 : 1)).slice(-LEARN_WEEKS)
    .map(f => ({week:f.week, rate:keptRate(f.counts)}));
  const rate = keptRate(now.counts), known = prev.filter(p => p.rate != null);
  const avg = known.length ? Math.round(known.reduce((n, p) => n + p.rate, 0) / known.length) : null;
  return {counts:now.counts, rate, prev, avg, better:rate != null && avg != null ? rate - avg : null};
}

// ---- 학습 시험 ----
// AI 초안 칸 ↔ 이번 주 개인본 칸. 줄마다: same(같음) · similar(비슷, SIMILAR 이상) · differ(다름, 짝은 있으나 많이 고침) · ai_only(AI만, 개인본에 없음) · missing(빠짐, AI가 못 씀).
// usable = 같음 + 비슷, total = 개인본 줄 수.
export function compareTest(ai, mine) {
  const a = toCells(ai), m = toCells(mine), rows = [];
  let usable = 0, total = 0;
  for (const id of [...new Set([...m.keys(), ...a.keys()])]) {
    const d = diffLines(a.get(id) ?? [], m.get(id) ?? []), where = whereOf(id);
    total += (m.get(id) ?? []).length;
    for (const t of d.kept) { rows.push({where, status:'same', ai:t, mine:t}); usable++; }
    for (const c of d.changed) { const status = c.score >= SIMILAR ? 'similar' : 'differ'; if (status === 'similar') usable++; rows.push({where, status, ai:c.before, mine:c.after}); }
    for (const t of d.added) rows.push({where, status:'missing', ai:'', mine:t});
    for (const t of d.dropped) rows.push({where, status:'ai_only', ai:t, mine:''});
  }
  return {rows, usable, total, pct:total ? Math.round((usable / total) * 100) : 0};
}
export const TEST_STATUS = Object.freeze({same:'같음', similar:'비슷', differ:'다름', missing:'빠짐', ai_only:'AI만'});

// ---- 학습 재료 ----
// rows: 요청 표 행 [{week_start, draft}] (서버에서 읽은 것). week: 초안을 만드는 주(월요일).
// 보고 주 '앞' 주의 고침 기록만(최근 LEARN_WEEKS개), 규칙은 앞 주들 가운데 가장 나중 것. 이번 주 행은 아무것도 쓰지 않는다(학습 시험이 답을 보지 않게).
export function learnInput(rows, week) {
  const before = (Array.isArray(rows) ? rows : []).filter(r => r && DAY.test(String(r.week_start)) && r.week_start < week).sort((x, y) => (x.week_start < y.week_start ? 1 : -1));
  const feedback = before.map(r => readFeedback(r.draft?.feedback)).filter(Boolean).slice(0, LEARN_WEEKS);
  const rules = before.map(r => readRules(r.draft?.rules)).find(Boolean) ?? null;
  return {feedback, rules, weeks:feedback.length};
}

// ---- 칸 모양(서버 draft 안) ----
const cleanCells = list => cellList(Array.isArray(list) ? list : []);
export function readProposed(raw) {
  if (!isObj(raw) || !at40(raw.at)) return null;
  const out = {at:raw.at, cells:cleanCells(raw.cells)};
  if (isObj(raw.base)) out.base = {from:raw.base.from === 'personal' ? 'personal' : raw.base.from === 'file' ? 'file' : 'confirmed', ...(typeof raw.base.document_id === 'string' && raw.base.document_id.length <= 64 ? {document_id:raw.base.document_id} : {})};
  if (raw.ai === true) out.ai = true;
  return bytes(out) > EXTRA_MAX_BYTES ? null : out;
}
const cleanPairs = list => (Array.isArray(list) ? list : []).slice(0, FEEDBACK_LIST_MAX).map(c => (isObj(c) ? {where:line(c.where).slice(0, 80), before:line(c.before), after:line(c.after)} : null)).filter(c => c && c.before && c.after);
const cleanTexts = list => (Array.isArray(list) ? list : []).slice(0, FEEDBACK_LIST_MAX).map(c => (isObj(c) ? {where:line(c.where).slice(0, 80), text:line(c.text)} : null)).filter(c => c && c.text);
const count = v => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : 0);
const cleanStats = list => (Array.isArray(list) ? list : []).slice(0, CELL_STATS_MAX).map(c => (isObj(c) && line(c.where) ? {where:line(c.where).slice(0, 80), proposed:count(c.proposed), final:count(c.final), kept:count(c.kept), changed:count(c.changed), dropped:count(c.dropped), added:count(c.added)} : null)).filter(Boolean);
export function readReview(raw) {
  if (!isObj(raw) || !at40(raw.at)) return null;
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : []).map(t => line(t).slice(0, RULE_CHARS)).filter(Boolean).slice(0, 10);
  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : []).slice(0, SUGGESTIONS_MAX).map((s, i) => (isObj(s) && line(s.text) ? {id:typeof s.id === 'string' && /^s[1-4]$/.test(s.id) ? s.id : `s${i + 1}`, ...(Object.hasOwn(SUGGESTION_AREA, s.area) ? {area:s.area} : {}), text:line(s.text).slice(0, 200), ...(s.answer === 'yes' || s.answer === 'no' ? {answer:s.answer} : {})} : null)).filter(Boolean);
  return {at:raw.at, candidates, suggestions, ...(raw.ai === false ? {ai:false} : {})};
}
export function readFeedback(raw) {
  if (!isObj(raw) || !at40(raw.at) || !DAY.test(String(raw.week ?? ''))) return null;
  const c = isObj(raw.counts) ? raw.counts : {};
  const out = {at:raw.at, week:raw.week, from:raw.from === 'test' ? 'test' : 'confirm',
    counts:{kept:count(c.kept), changed:count(c.changed), dropped:count(c.dropped), added:count(c.added), proposed:count(c.proposed), final:count(c.final)},
    changed:cleanPairs(raw.changed), dropped:cleanTexts(raw.dropped), added:cleanTexts(raw.added)};
  const stats = cleanStats(raw.cells);
  if (stats.length) out.cells = stats;
  const review = readReview(raw.review);
  if (review) out.review = review;
  return bytes(out) > EXTRA_MAX_BYTES ? null : out;
}
export function readRules(raw) {
  if (!isObj(raw) || !at40(raw.at)) return null;
  const seen = new Set(), lines = [];
  for (const r of Array.isArray(raw.lines) ? raw.lines : []) {
    const text = line(isObj(r) ? r.text : r).slice(0, RULE_CHARS), k = squashLine(text);
    if (!text || seen.has(k) || lines.length >= RULES_MAX) continue;
    seen.add(k); lines.push({text, from:isObj(r) && (r.from === 'edited' || r.from === 'added') ? r.from : 'auto'});
  }
  return {at:raw.at, ...(DAY.test(String(raw.week ?? '')) ? {week:raw.week} : {}), lines};
}
export function readExtras(draft) {
  const out = {};
  if (!isObj(draft)) return out;
  const p = readProposed(draft.proposed), f = readFeedback(draft.feedback), r = readRules(draft.rules);
  if (p) out.proposed = p;
  if (f) out.feedback = f;
  if (r) out.rules = r;
  return out;
}
// 칸마다 더 나중(at)의 것(같으면 앞). 없는 쪽은 무시.
export function mergeExtras(a = {}, b = {}) {
  const out = {};
  for (const key of EXTRA_KEYS) {
    const x = a?.[key], y = b?.[key];
    const tx = Date.parse(x?.at ?? ''), ty = Date.parse(y?.at ?? '');
    const pick = !x ? y : !y ? x : Number.isFinite(ty) && !(Number.isFinite(tx) && tx >= ty) ? y : x;
    if (pick) out[key] = pick;
  }
  return out;
}

// ---- 규칙 목록 고치기 ----
const ruleBase = rules => readRules(rules) ?? {at:'', lines:[]};
export function withRuleText(rules, i, text, at) {
  const r = ruleBase(rules), t = line(text).slice(0, RULE_CHARS);
  if (!r.lines[i]) return r;
  const lines = r.lines.map((x, j) => (j === i ? {text:t, from:'edited'} : x)).filter(x => x.text);
  return readRules({...r, at, lines});
}
export const withoutRule = (rules, i, at) => { const r = ruleBase(rules); return readRules({...r, at, lines:r.lines.filter((_, j) => j !== i)}); };
export function withRule(rules, text, at) {
  const r = ruleBase(rules), t = line(text).slice(0, RULE_CHARS);
  if (!t) return r;
  if (r.lines.length >= RULES_MAX) throw Object.assign(new Error(`규칙은 ${RULES_MAX}줄까지예요.`), {code:'too_many'});
  return readRules({...r, at, lines:[...r.lines, {text:t, from:'added'}]});
}
// 환류 보고 개선 제안 하나에 승인/아니 답.
export function withAnswer(feedback, id, answer) {
  const f = readFeedback(feedback);
  if (!f?.review) return f;
  return readFeedback({...f, review:{...f.review, suggestions:f.review.suggestions.map(s => (s.id === id ? {...s, answer} : s))}});
}
