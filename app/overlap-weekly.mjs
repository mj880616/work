// MTG-기록겹침거르기 4단계(화면 ②, docs/design/record-overlap.md 2·3.4·4.2절): 주간 정리에서 같은 일을 한 줄만 남기는 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// - 서버 겹침 표(app_record_overlaps)의 same 판정(decided_by ai·user·link)을 받아, 그 주에 실제로 보이는 줄끼리만 묶는다.
//   묶음에서 우선순위가 가장 높은 줄(사업 보고 > 프로젝트 기록 > 담당조직 기록 > 업데이트)만 남기고 낮은 줄은 "겹쳐서 뺀 줄"이 된다. 아무것도 지우지 않는다(보고 화면에서 가릴 뿐).
// - different·unsure는 아무것도 빼지 않는다(애매하면 빼지 않음). 표를 못 읽었으면 호출하는 쪽이 rows를 주지 않아 빼는 것이 없다.
// - 남길 줄이 이 주에 보이지 않으면(다른 주이거나 '보고 안 함' 종류) 그 짝은 없는 것으로 본다: 주마다 보고서가 혼자 완결되게, 줄이 어디에도 안 남는 일을 막는다.
// - AI에 물어볼 짝은 "그 주에 보이는 사업 보고 × 그 밖의 줄" 중 서로 이어질 만한 것(같은 프로젝트·조직이거나 낱말이 겹침)만, 점수 순으로 위 24쌍(8쌍씩 세 번)이다.
import {makeRef, isRef, refKind, orderPair, pairKey, relatedness, dayGap, isDayKey} from './overlap-model.mjs';

export const WEEK_MAX_PAIRS = 24; // 서버는 한 번에 8쌍까지 받는다(ai-assist overlap_check). 주 한 번 열 때 최대 세 번.
export const WEEK_BATCH = 8;
export const WEEK_BACK_WEEKS = 8; // 설계 결정 5-가: 이번 주를 포함해 최근 8주까지 자동으로 찾는다. 그보다 앞 주는 저장된 판정만 적용한다.
// 어느 쪽을 남기나(설계 3.3절 정렬 순서). 값이 코드라 바꿔도 데이터 이전이 없다.
export const PRIORITY = Object.freeze({meeting: 4, project_update: 3, org_update: 2, basket: 1});
const rank = ref => PRIORITY[refKind(ref)] ?? 0;

// 화면 줄이 가리키는 원래 기록(journal-data.js 하루 카드의 open 값)에서 겹침 참조를 만든다. 알 수 없거나 uuid 모양이 아니면 null(그 줄은 건드리지 않는다).
export function refOfOpen(open) {
  if (!open) return null;
  const record = String(open.record ?? '');
  let ref = null;
  if (open.type === 'project' && record.startsWith('progress:')) ref = makeRef('project_update', record.slice(9));
  else if (open.type === 'org' && record.startsWith('up:')) ref = makeRef('org_update', record.slice(3));
  else if (open.note) ref = makeRef('basket', open.note);
  return ref && isRef(ref) ? ref : null;
}
export const meetingRef = id => { const ref = makeRef('meeting', id); return isRef(ref) ? ref : null; };

// 서버 행에서 쓸 것만: {a, b, verdict, decidedBy, reason}. 모양이 틀린 행은 버린다.
export function cleanRows(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isRef(r.a_ref) || !isRef(r.b_ref) || r.a_ref === r.b_ref) continue;
    if (!['same', 'different', 'unsure'].includes(r.verdict)) continue;
    const {a, b} = orderPair(r.a_ref, r.b_ref);
    out.push({a, b, verdict: r.verdict, decidedBy: r.decided_by, reason: typeof r.reason === 'string' ? r.reason.trim() : ''});
  }
  return out;
}

// 보이는 줄(shown: ref의 Set)끼리의 same 짝.
function sameEdges(shown, rows) {
  return cleanRows(rows).filter(r => r.verdict === 'same' && shown.has(r.a) && shown.has(r.b));
}

// 겹침 묶음을 찾아 뺄 줄을 정한다. 반환 Map(뺄 ref → {keep:[남는 ref], edges:[그 줄에 닿은 same 짝]}).
// 묶음 = same 짝으로 이어진 보이는 줄들(A~B, B~C는 한 묶음). 묶음의 최고 우선순위 줄만 남는다(같은 우선순위끼리는 모두 남는다).
export function planOverlaps(shown, rows) {
  const edges = sameEdges(shown instanceof Set ? shown : new Set(shown), rows);
  const next = new Map();
  for (const e of edges) {
    if (!next.has(e.a)) next.set(e.a, []);
    if (!next.has(e.b)) next.set(e.b, []);
    next.get(e.a).push(e); next.get(e.b).push(e);
  }
  const removed = new Map(), seen = new Set();
  for (const start of [...next.keys()].sort()) {
    if (seen.has(start)) continue;
    const group = [], queue = [start];
    seen.add(start);
    while (queue.length) {
      const ref = queue.shift();
      group.push(ref);
      for (const e of next.get(ref)) for (const other of [e.a, e.b]) if (!seen.has(other)) { seen.add(other); queue.push(other); }
    }
    const top = Math.max(...group.map(rank)), keep = group.filter(ref => rank(ref) === top).sort();
    // 가장 높은 우선순위가 알 수 없는 종류(0)뿐이면 아무것도 빼지 않는다.
    if (top <= 0) continue;
    for (const ref of group) if (rank(ref) < top) removed.set(ref, {keep, edges: next.get(ref)});
  }
  return removed;
}

// [되살리기]가 사용자 판정 different로 쓸 짝들. 먼저 우선순위가 같거나 높은 쪽과의 짝만 끊고, 그래도 다른 줄을 거쳐 이어져 있으면 닿은 짝을 모두 끊는다.
export function reviveEdges(ref, shown, rows) {
  const set = shown instanceof Set ? shown : new Set(shown);
  const all = sameEdges(set, rows).filter(e => e.a === ref || e.b === ref);
  const other = e => (e.a === ref ? e.b : e.a);
  const strong = all.filter(e => rank(other(e)) >= rank(ref));
  const cut = list => new Set(list.map(e => pairKey(e.a, e.b)));
  const left = list => (Array.isArray(rows) ? rows : []).filter(r => r && !cut(list).has(pairKey(...Object.values(orderPair(String(r.a_ref), String(r.b_ref))))));
  const pick = !planOverlaps(set, left(strong)).has(ref) ? strong : all;
  return pick.map(e => ({a: e.a, b: e.b}));
}

// 이 주 보이는 줄 하나가 겹침으로 빠졌는지 보여 줄 때 쓰는 이유 한 줄: 남는 줄과 직접 이어진 짝의 이유(AI 한 줄)를 먼저 쓴다.
export function reasonOf(entry) {
  const direct = entry.edges.find(e => entry.keep.includes(e.a) || entry.keep.includes(e.b));
  return (direct?.reason || entry.edges.find(e => e.reason)?.reason || '');
}

// AI에 물어볼 짝. records: 사업 보고가 아닌 줄 [{ref, day, text, title, target}], meetings: [{ref, day, title, targets:[{kind,id}]}].
// 이미 표에 행이 있는 짝(어떤 판정이든)은 다시 묻지 않는다. 서로 이어질 만한 쌍(같은 곳이거나 낱말 겹침)만, 점수(이어짐 + 날짜 가까움) 순으로 위 max쌍.
export function weekCandidates(records, meetings, rows, max = WEEK_MAX_PAIRS) {
  const known = new Set(cleanRows(rows).map(r => pairKey(r.a, r.b)));
  const seenRecord = new Set(), scored = [];
  let index = 0;
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || !isRef(rec.ref) || refKind(rec.ref) === 'meeting' || seenRecord.has(rec.ref)) continue;
    seenRecord.add(rec.ref);
    for (const meet of Array.isArray(meetings) ? meetings : []) {
      if (!meet || !isRef(meet.ref) || refKind(meet.ref) !== 'meeting') continue;
      const {a, b} = orderPair(rec.ref, meet.ref), key = `${a}|${b}`;
      if (known.has(key)) continue;
      const targets = meet.targets?.length ? meet.targets : [null];
      const link = Math.max(...targets.map(target => relatedness(rec, {title: meet.title, text: '', target})));
      if (!(link > 0)) continue;
      const gap = dayGap(rec.day, meet.day);
      const near = isDayKey(rec.day) && isDayKey(meet.day) ? Math.max(0, 1 - gap / 15) * 2 : 0;
      scored.push({pair: {a, b}, score: link + near, index: index++});
    }
  }
  scored.sort((x, y) => y.score - x.score || x.index - y.index);
  return scored.slice(0, max).map(x => x.pair);
}

export const batches = (pairs, size = WEEK_BATCH) => Array.from({length: Math.ceil(pairs.length / size)}, (_, i) => pairs.slice(i * size, (i + 1) * size));

export const OVERLAP_WEEK_TEXT = Object.freeze({
  count: n => `겹쳐서 ${n}건 뺐어요`,
  show: '보기',
  kept: '남긴 사업 보고',
  revive: '되살리기',
  reviving: '되살리는 중…',
  revived: '되살렸어요.',
  reviveFailed: '되살리지 못했어요. 잠시 뒤 다시 눌러 주세요.',
});
