// MTG-기록겹침거르기 5단계(화면 ③, docs/design/record-overlap.md 4.3절): 원장에서 같은 일로 보이는 두 기록을 한 줄로 합치는 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// - 합칠 후보 = 겹침 표의 same 짝(양쪽 Web2 원문)이 원장에서 서로 다른 두 기록의 근거로 각각 걸려 있는 경우. AI 호출 없음.
// - 같은 종류(일어난 일·약속 …)끼리, 제목 낱말이 하나라도 겹치는 기록만 짝을 짓는다. 한 기록이 두 원문을 다 가졌으면 이미 합쳐진 것이다.
// - 합치기 = 기존 원장 수정 요청(app_apply_ledger_fix) 하나: 남는 기록에 다른 기록의 근거를 더하고(add_source), 합쳐진 쪽은 폐기(retire, 지우지 않음).
//   새 DB 함수·표는 없다. 반영은 명진이 [합치기]를 눌러야 하고(AI는 혼자 합치지 않는다), 반영 뒤 [되돌리기]·[합침 취소]는 app_undo_ledger_fix다.
import {isRef, refKind, makeRef, orderPair, pairKey} from './overlap-model.mjs';
import {PRIORITY} from './overlap-weekly.mjs';
import {words} from './weekly-file-lines.mjs';
import {KIND_DISPLAY} from './ledger-browse-model.mjs';

export const MERGE_REASON = '겹쳐서 합침';
export const MERGE_LIMIT = 30; // 한 번에 보이는 후보 수
export const RECENT_LIMIT = 10; // 취소할 수 있는 최근 합침 수
export const MERGE_TEXT = Object.freeze({
  summary: n => `겹친 기록 ${n}건`,
  recent: n => `합친 기록 ${n}건`,
  merge: '합치기',
  apply: '반영',
  cancel: '취소',
  undo: '합침 취소',
  applied: '합쳤어요.',
  undone: '합침을 취소했어요.',
  failed: '합치지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  readFailed: '겹친 기록을 읽지 못했어요.',
  preview: (keep, drop) => `‘${keep}’에 ‘${drop}’의 근거를 더하고, ‘${drop}’은 합쳐서 폐기해요(지우지 않아요).`,
  previewSame: (keep, drop) => `‘${drop}’은 합쳐서 폐기해요(지우지 않아요). ‘${keep}’에 이미 같은 근거가 있어요.`,
});
export const SOURCE_LABEL = Object.freeze({meeting: '사업 보고', project_update: '사업영역 기록', org_update: '담당조직 기록', basket: '업데이트'});
const LIVE = new Set(['current', 'needs_check', 'fulfilled']);
const LEDGER_ID = /^[A-Z]{2,6}-[0-9]{4,6}$/;
const LOCATION = /^web2:(meeting|project_update|org_update|basket):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// 원장 출처 위치(web2:<종류>:<id>) ↔ 겹침 참조(<종류>:<id>).
export function refOfLocation(location) {
  const m = LOCATION.exec(String(location ?? '').trim().toLowerCase());
  return m ? makeRef(m[1], m[2]) : null;
}
export const locationOfRef = ref => (isRef(ref) ? `web2:${ref}` : null);

// 겹침 표 행 → same 짝(서버 표와 같은 방향). 모양이 틀린 행·same이 아닌 행은 버린다.
export function samePairs(rows) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.verdict !== 'same' || !isRef(r.a_ref) || !isRef(r.b_ref) || r.a_ref === r.b_ref) continue;
    const {a, b} = orderPair(r.a_ref, r.b_ref);
    const key = pairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({a, b, decidedBy: r.decided_by});
  }
  return out;
}

const sharedWords = (x, y) => { const mine = new Set(words(x)); return words(y).filter(w => mine.has(w)).length; };
const refRank = ref => PRIORITY[refKind(ref)] ?? 0;

// 후보 계산.
// pairs: samePairs 결과. records: [{id, ledger_id, kind, title, validity}]. links: [{record_id, source_id}] (records의 모든 근거 줄).
// sources: [{id, ledger_id, location, status}]. 반환: [{key, keep, drop, keepRef, dropRef, decidedBy, addSource}].
// keep/drop = 기록 {id, ledger_id, kind, title, refs:[이 기록 근거 중 겹침 참조]}. addSource = drop의 근거 중 keep에 없는 출처 ID(없으면 null).
// drop에 keep에 없는 근거가 둘 이상이면 후보로 올리지 않는다(수정 요청 한 건은 같은 기록에 근거를 하나씩만 더할 수 있다).
export function mergeCandidates({pairs, records, links, sources}) {
  const live = new Map((records || []).filter(r => r && LEDGER_ID.test(String(r.ledger_id)) && LIVE.has(r.validity)).map(r => [r.id, r]));
  const srcById = new Map((sources || []).filter(s => s && s.status !== 'retired').map(s => [s.id, s]));
  const sourcesOf = new Map(); // record id → Set(source id)
  for (const l of links || []) {
    if (!live.has(l?.record_id) || !srcById.has(l?.source_id)) continue;
    if (!sourcesOf.has(l.record_id)) sourcesOf.set(l.record_id, new Set());
    sourcesOf.get(l.record_id).add(l.source_id);
  }
  const refsOf = new Map(); // record id → [ref]
  const byRef = new Map(); // ref → [record id]
  for (const [rid, set] of sourcesOf) {
    for (const sid of set) {
      const ref = refOfLocation(srcById.get(sid).location);
      if (!ref) continue;
      if (!refsOf.has(rid)) refsOf.set(rid, []);
      if (!refsOf.get(rid).includes(ref)) refsOf.get(rid).push(ref);
      if (!byRef.has(ref)) byRef.set(ref, []);
      if (!byRef.get(ref).includes(rid)) byRef.get(ref).push(rid);
    }
  }
  const scored = [];
  for (const p of pairs || []) {
    const left = byRef.get(p.a) || [], right = byRef.get(p.b) || [];
    for (const x of left) for (const y of right) {
      if (x === y || right.includes(x) || left.includes(y)) continue; // 한 기록이 두 원문을 다 가졌으면 이미 합쳐졌다
      const rx = live.get(x), ry = live.get(y);
      if (rx.kind !== ry.kind) continue;
      const shared = sharedWords(rx.title, ry.title);
      if (!shared) continue;
      scored.push({p, x, y, shared});
    }
  }
  // 한 쌍(원문 짝)마다 가장 닮은 기록 짝부터 하나씩만 맺는다(한 기록은 한 후보에만).
  scored.sort((m, n) => n.shared - m.shared || String(m.p.a + m.p.b).localeCompare(n.p.a + n.p.b) || (live.get(m.x).ledger_id < live.get(n.x).ledger_id ? -1 : 1));
  const used = new Set(), out = [];
  for (const m of scored) {
    if (used.has(m.x) || used.has(m.y)) continue;
    const rx = live.get(m.x), ry = live.get(m.y);
    // 남길 쪽: 걸린 원문 종류의 우선순위(사업 보고 > 프로젝트 기록 > 담당조직 기록 > 업데이트), 같으면 고정 ID가 작은 쪽.
    const xFirst = refRank(m.p.a) !== refRank(m.p.b) ? refRank(m.p.a) > refRank(m.p.b) : rx.ledger_id <= ry.ledger_id;
    const [keepId, dropId, keepRef, dropRef] = xFirst ? [m.x, m.y, m.p.a, m.p.b] : [m.y, m.x, m.p.b, m.p.a];
    const keepSet = sourcesOf.get(keepId) || new Set();
    const extra = [...(sourcesOf.get(dropId) || [])].filter(sid => !keepSet.has(sid));
    if (extra.length > 1) continue;
    used.add(keepId); used.add(dropId);
    const side = id => ({id, ledger_id: live.get(id).ledger_id, kind: live.get(id).kind, title: live.get(id).title, refs: refsOf.get(id) || []});
    out.push({
      key: `${live.get(keepId).ledger_id}|${live.get(dropId).ledger_id}`,
      keep: side(keepId), drop: side(dropId), keepRef, dropRef, decidedBy: m.p.decidedBy,
      addSource: extra.length ? srcById.get(extra[0]).ledger_id : null,
    });
    if (out.length >= MERGE_LIMIT) break;
  }
  return out;
}

// 수정 요청(반영할 때와 해 보기에 같은 모양). 모양이 틀리면 null.
export function mergeRequest(candidate) {
  const keep = candidate?.keep?.ledger_id, drop = candidate?.drop?.ledger_id;
  if (!LEDGER_ID.test(String(keep)) || !LEDGER_ID.test(String(drop)) || keep === drop) return null;
  const items = [];
  if (candidate.addSource) {
    if (!LEDGER_ID.test(String(candidate.addSource))) return null;
    items.push({target: keep, do: 'add_source', source: {ledger_id: candidate.addSource}, reason: MERGE_REASON});
  }
  items.push({target: drop, do: 'retire', reason: `${MERGE_REASON} · ${keep}에 근거를 모음`});
  return {format: 'kptu-ledger-fix', version: 1, received_from: 'user', items};
}

const clip = (text, n = 40) => { const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()]; return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : chars.join(''); };
export const sideLabel = side => clip(side?.title) || '이 기록';
// 미리보기 한 줄(고정 ID·DB 낱말 없음). 폐기 문구가 "틀린 기록"으로 읽히지 않게 이 모듈이 따로 만든다.
export function previewText(candidate) {
  const keep = sideLabel(candidate.keep), drop = sideLabel(candidate.drop);
  return candidate.addSource ? MERGE_TEXT.preview(keep, drop) : MERGE_TEXT.previewSame(keep, drop);
}
// 해 보기 결과가 우리가 보낸 요청과 맞는지(대상·동작 그대로, 항목 수 같음).
export function dryRunMatches(dry, request) {
  if (!dry || dry.dry_run !== true || !Array.isArray(dry.items) || !request || dry.items.length !== request.items.length) return false;
  return request.items.every((it, i) => dry.items[i]?.target === it.target && dry.items[i]?.do === it.do);
}
// 꼬리표: 걸린 원문 종류들("사업 보고 · 프로젝트 기록").
export function originLabel(side) {
  return [...new Set((side?.refs || []).map(ref => SOURCE_LABEL[refKind(ref)]).filter(Boolean))].join(' · ');
}
export const kindLabel = kind => KIND_DISPLAY[kind] || '기록';

// 최근 합침: 반영된 수정 요청(app_ledger_fix_requests: id, applied_at, request) 중 이 화면이 만든 것만.
// 반환 [{fixId, at, keep, drop}] (keep/drop = 고정 ID). 우리가 만든 모양(retire 이유가 MERGE_REASON으로 시작)만 인정한다.
export function recentMerges(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const items = r?.request?.items;
    if (typeof r?.id !== 'string' || !Array.isArray(items) || !items.length || items.length > 2 || r.request.received_from !== 'user') continue;
    const retire = items.find(it => it?.do === 'retire' && typeof it.reason === 'string' && it.reason.startsWith(MERGE_REASON) && LEDGER_ID.test(String(it.target)));
    if (!retire) continue;
    const add = items.find(it => it?.do === 'add_source');
    if (items.length !== (add ? 2 : 1) || (add && !LEDGER_ID.test(String(add.target)))) continue;
    const keep = add?.target || (/ ([A-Z]{2,6}-[0-9]{4,6})에 근거를 모음$/.exec(retire.reason) || [])[1];
    if (!keep) continue;
    out.push({fixId: r.id, at: r.applied_at, keep, drop: retire.target});
    if (out.length >= RECENT_LIMIT) break;
  }
  return out;
}

// 읽기 경로 도우미: 후보 계산에 필요한 위치 목록(원문 참조 → 출처 위치).
export const locationsOf = pairs => [...new Set((pairs || []).flatMap(p => [p.a, p.b]).map(locationOfRef).filter(Boolean))];
