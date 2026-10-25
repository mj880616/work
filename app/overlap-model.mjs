// MTG-기록겹침거르기 3단계(화면 ①, docs/design/record-overlap.md 2·4.1절): 순수 규칙만 둔다(DOM·네트워크 없음, 단위 시험 대상).
// - 새 기록을 저장한 직후, 반대편 종류 기록 중 ±14일 안의 후보를 점수로 줄 세워 위 6건만 서버 판정(ai-assist overlap_check)에 보낸다.
//   점수(같은 곳·날짜 가까움·낱말 겹침)는 후보를 고르는 순서일 뿐이고, 그것만으로 "같은 일"이라 하지 않는다. 판정은 서버 AI가 한다.
// - 쌍은 서버 표와 같은 방향(a < b, 글자 순)으로 맞춘다.
import {words} from './weekly-file-lines.mjs';

export const OVERLAP_KINDS = Object.freeze(['meeting', 'project_update', 'org_update', 'basket']);
export const OVERLAP_WINDOW_DAYS = 14;
export const OVERLAP_MAX_CANDIDATES = 6; // 서버는 한 번에 8쌍까지 받는다. 설계 2절: 여섯 건만 보낸다.
// 저장은 이미 끝났으므로 이 시간은 저장을 막지 않는다. 이 안에 답이 없으면 물음 없이 넘어간다(그 쌍은 주간보고 쪽에서 나중에 판정).
export const OVERLAP_WAIT_MS = 10000;
export const SUMMARY_MAX = 2000; // report-links-model.mjs SUMMARY_LIMIT와 같은 값(연결 요약 한도)
export const NOTICE_LABEL_CHARS = 40;

const REF = /^(meeting|project_update|org_update|basket):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const makeRef = (kind, id) => `${kind}:${String(id || '').toLowerCase()}`;
export const isRef = ref => typeof ref === 'string' && REF.test(ref);
export const refKind = ref => ref.slice(0, ref.indexOf(':'));
export const refId = ref => ref.slice(ref.indexOf(':') + 1);
// 서버 표·Edge와 같은 쌍 순서(소문자 ASCII 글자 순).
export function orderPair(x, y) {
  return x < y ? {a: x, b: y} : {a: y, b: x};
}
export const pairKey = (x, y) => { const p = orderPair(x, y); return `${p.a}|${p.b}`; };

const DAY_MS = 86400000;
const dayNumber = key => Date.parse(`${key}T00:00:00Z`) / DAY_MS;
export const isDayKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayNumber(value));
export function dayGap(x, y) {
  return isDayKey(x) && isDayKey(y) ? Math.abs(dayNumber(x) - dayNumber(y)) : Infinity;
}
// 후보를 읽을 날짜 범위(서울 날짜, 양끝 포함).
export function windowOf(day, span = OVERLAP_WINDOW_DAYS) {
  if (!isDayKey(day)) return null;
  const n = dayNumber(day), key = value => new Date(value * DAY_MS).toISOString().slice(0, 10);
  return {from: key(n - span), to: key(n + span)};
}

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cut = (text, n) => { const chars = [...clean(text)]; return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : chars.join(''); };
export const noticeLabel = (text, n = NOTICE_LABEL_CHARS) => cut(text, n);

// 후보 한 건: {ref, kind, day, text, title, target:{kind,id}|null}. record: 방금 저장한 글 {ref, day, text, target}.
// target = 프로젝트·조직 한 곳(없으면 null). 여러 곳에 한 번에 연결한 업데이트(basket)만 targets에 모두 담는다(target은 그 첫 곳). 점수는 큰 쪽이 먼저.
export const targetsOf = record => Array.isArray(record?.targets) && record.targets.length ? record.targets : record?.target ? [record.target] : [];
const sameTarget = (x, y) => !!x && !!y && x.kind === y.kind && x.id === y.id;
const sameTargetScore = (record, candidate) => targetsOf(record).some(t => sameTarget(t, candidate.target)) ? 3 : 0;
const sharedWordCount = (record, candidate) => {
  const mine = new Set(words(`${record.title || ''} ${record.text || ''}`));
  return words(`${candidate.title || ''} ${candidate.text || ''}`).filter(w => mine.has(w)).length;
};
// 날짜와 상관없이 두 글이 얼마나 이어지는지(같은 곳 3 + 겹치는 낱말 0.5씩, 낱말은 5개까지). 주간 정리가 "AI에 물어볼 만한 쌍"인지 가를 때 쓴다.
export const relatedness = (record, candidate) => sameTargetScore(record, candidate) + Math.min(sharedWordCount(record, candidate), 5) * 0.5;
export function scoreCandidate(record, candidate) {
  const gap = dayGap(record.day, candidate.day);
  if (!Number.isFinite(gap) || gap > OVERLAP_WINDOW_DAYS) return -1;
  const same = sameTargetScore(record, candidate);
  const near = (1 - gap / (OVERLAP_WINDOW_DAYS + 1)) * 2;
  return same + near + Math.min(sharedWordCount(record, candidate), 5) * 0.5;
}
// 후보를 점수 순으로 줄 세워 위 max건. 자기 자신·모양이 틀린 참조·범위 밖 날짜·같은 참조 중복은 뺀다. 같은 점수는 먼저 온 순서.
export function rankCandidates(record, candidates, max = OVERLAP_MAX_CANDIDATES) {
  const seen = new Set([record.ref]), scored = [];
  (Array.isArray(candidates) ? candidates : []).forEach((c, index) => {
    if (!c || !isRef(c.ref) || seen.has(c.ref)) return;
    const score = scoreCandidate(record, c);
    if (score < 0) return;
    seen.add(c.ref);
    scored.push({c, score, index});
  });
  scored.sort((x, y) => y.score - x.score || x.index - y.index);
  return scored.slice(0, max).map(x => x.c);
}

// 서버에 보낼 본문. 후보가 없으면 null(AI를 부르지 않는다, 비용 0).
export function buildRequest(record, ranked) {
  const pairs = (ranked || []).map(c => orderPair(record.ref, c.ref));
  return pairs.length ? {kind: 'overlap_check', pairs} : null;
}

// 서버 답에서 "같은 일"인 후보를 점수 순서대로 고른다. 답 모양이 틀리면 빈 목록(물음 없음).
export function sameCandidates(record, ranked, data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const verdicts = new Map();
  for (const r of results) {
    if (r && typeof r.a === 'string' && typeof r.b === 'string' && (r.state === 'judged' || r.state === 'decided') && r.verdict === 'same') verdicts.set(pairKey(r.a, r.b), true);
  }
  return (ranked || []).filter(c => verdicts.has(pairKey(record.ref, c.ref)));
}

// 물음에 보일 한 줄: 날짜·종류·제목(AI 이유를 그대로 쓰지 않는다, 설계 4.1절).
const shortDay = day => isDayKey(day) ? `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}` : '';
export function candidateLine(c) {
  return [shortDay(c.day), c.typeLabel, noticeLabel(c.title || c.text)].filter(Boolean).join(' · ');
}

// 사용자 판정을 서버 함수(app_record_overlap_set)에 쓸 한 쌍. verdict: 'same'(연결로 바꾸기) | 'different'(그대로 두기).
export function userVerdictPayload(workspaceId, recordRef, candidateRef, verdict) {
  if (!isRef(recordRef) || !isRef(candidateRef) || recordRef === candidateRef || !['same', 'different'].includes(verdict)) return null;
  const {a, b} = orderPair(recordRef, candidateRef);
  return {p_workspace_id: workspaceId, p_pairs: [{a_ref: a, b_ref: b, verdict, decided_by: 'user'}]};
}

// [연결로 바꾸기]가 사업 보고에 더할 것. 새 글이 프로젝트 기록이면 사업 보고(후보)에 이 프로젝트를 잇고 쓴 글을 연결 메모로 붙인다(결정 6-가).
// 새 글이 사업 보고면 후보 기록의 프로젝트·조직을 사업 보고에 잇는다(메모 없음). 반환 {meetingId, target, summary|null} 또는 null(연결할 곳을 모를 때: 같은 일 표시만).
// 담당조직 기록(org_update)은 프로젝트 기록과 같다(조직 한 곳). 여러 곳에 연결한 업데이트(basket)는 모든 곳을 잇는다(plan.targets).
export function linkPlan(record, candidate) {
  const mine = targetsOf(record);
  if (['project_update', 'org_update', 'basket'].includes(record.kind) && candidate.kind === 'meeting' && mine.length) {
    const text = clean(record.text);
    return {meetingId: refId(candidate.ref), target: mine[0], ...(record.kind === 'basket' ? {targets: mine} : {}), summary: text ? [...text].slice(0, SUMMARY_MAX).join('') : null};
  }
  if (record.kind === 'meeting' && candidate.target) return {meetingId: refId(record.ref), target: candidate.target, summary: null};
  return null;
}

// 사업 보고의 연결 목록에 한 곳을 더한 목록과 보낼 요약. 이미 있는 곳이면 목록은 그대로이고, 그곳에 메모가 이미 있으면 덮어쓰지 않는다.
// 여러 곳(plan.targets)이면 곳마다 같은 규칙을 적용한다. summaryFor = 메모를 붙일 곳 목록(summary가 있을 때만).
export function mergeTarget(current, plan) {
  const cur = Array.isArray(current) ? current : [];
  const targets = cur.map(t => ({kind: t.kind, id: t.id}));
  const summaryFor = [];
  let added = false, kept = false;
  for (const want of Array.isArray(plan.targets) && plan.targets.length ? plan.targets : [plan.target]) {
    const found = cur.find(t => sameTarget(t, want));
    if (!found) { targets.push({kind: want.kind, id: want.id}); added = true; }
    if (plan.summary && !(found && found.hasSummary)) summaryFor.push({kind: want.kind, id: want.id});
    else if (plan.summary) kept = true;
  }
  return {targets, summary: summaryFor.length ? plan.summary : null, summaryFor, added, keptSummary: kept && !summaryFor.length};
}

export const NOTICE_TEXT = Object.freeze({
  ask: '비슷한 기록이 있어요',
  link: '연결로 바꾸기',
  markSame: '같은 일로 표시',
  keep: '그대로 두기',
  working: '처리 중…',
  kept: '그대로 두었어요.',
  linked: '연결했어요.',
  linkedMemo: '연결했어요. 쓴 글은 연결 메모로 붙였어요.',
  linkedKeepMemo: '연결했어요. 이미 있는 연결 메모는 그대로 뒀어요.',
  marked: '같은 일로 표시했어요.',
  linkFailed: '연결하지 못했어요. 기록은 그대로 저장돼 있어요.',
  markFailed: '표시하지 못했어요. 기록은 그대로 저장돼 있어요.',
});
