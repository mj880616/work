// WEEKLY-자료요약 화면 ① (docs/design/weekly-file-summary.md 4·5절, 11절 결정 Q3·Q5·Q6 ①): 그 주 자료실 새 자료를 [주간 정리]의
// 조직 칸·프로젝트 줄에 넣을 한 줄로 만든다. 화면 없는 순수 함수(AI·읽기·저장 없음). 판단 결과는 저장하지 않고 열 때마다 계산한다.
//   - 줄: "제목 — 요약"(요약은 자료별 AI 요약 표 app_document_ai_index의 'b1:' 행만, journal-data.js readWeekDocuments). 요약이 없으면 제목만.
//   - 같은 파일(글자 지문이 같은 자료)이 그 주에 여럿이면 먼저 올린 하나만 줄로, 끝에 "같은 파일 N번". 지난주 이전에 같은 지문이 있으면 접힘.
//   - 자리: 담당조직이 있으면 그 조직 칸에만(Q3 ①, 프로젝트에도 연결돼 있어도), 프로젝트만 있으면 그 프로젝트 줄. 회의자료(meeting_id)와
//     연결 없는 자료, 자리를 찾지 못한 자료(조직·프로젝트 이름을 못 읽음)는 지금처럼 '참고 › 자료실 새 자료'.
//   - 기록과 비교(Q6 ①, 화면 규칙): 같음 → 접어 둠("기록과 같아 뺀 자료 N"), 비슷함·같은 업데이트의 첨부 → '비슷한 기록 있음' 표시만,
//     그 밖은 새 내용. 기준값은 여기 한 곳에만 두고 tests/weekly-file-lines.test.mjs가 고정한다.

export const SAME_OVERLAP = 0.8;
export const SIMILAR_OVERLAP = 0.4;
export const CONTAIN_MIN = 10;
// 낱말 겹침으로 '같음'을 보려면 요약 낱말이 이만큼은 있어야 한다(짧은 글 하나가 우연히 겹쳐 접히지 않게, 보수적으로).
export const SAME_MIN_WORDS = 3;
export const STATUS_WORDS = Object.freeze(['예정', '검토', '확정', '취소', '진행', '완료']);
const BRIEF_HASH = /^b1:[0-9a-f]{32}$/;

const flat = text => String(text ?? '').normalize('NFKC').toLowerCase();
// 띄어쓰기·문장부호·기호를 뺀 글(통째로 들어 있는지 볼 때).
export const squeeze = text => flat(text).replace(/[\s\p{P}\p{S}]+/gu, '');
// 낱말: 띄어쓰기·문장부호로 자른 조각(한 글자 조각은 뺌 — 조사 하나로 겹침이 부풀지 않게).
export const words = text => [...new Set(flat(text).split(/[\s\p{P}\p{S}]+/u).filter(w => [...w].length >= 2))];
const numbers = text => flat(text).match(/\d+/g) || [];
const statuses = text => STATUS_WORDS.filter(word => flat(text).includes(word));
const dates = text => [...flat(text).matchAll(/(\d{1,2})\s*\.\s*(\d{1,2})\s*\./g)].map(m => `${Number(m[1])}.${Number(m[2])}`);
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

// 자료 요약 하나와 기록 하나: 'same' | 'similar' | 'new'. 요약이 없으면(제목만) 비교하지 않는다(new).
export function compareOne(summary, record) {
  const s = String(summary ?? '').trim(), r = String(record ?? '').trim();
  if (!s || !r) return 'new';
  const sq = squeeze(s), rq = squeeze(r), sw = words(s), rw = words(r);
  const shared = sw.filter(w => rw.includes(w));
  const overlap = sw.length ? shared.length / sw.length : 0;
  // 상태 낱말(예정·검토·확정·취소·진행·완료)이 다르면 같음이 아니다(비슷함까지만).
  const statusSame = sameSet(statuses(s), statuses(r));
  const contained = (rq.length >= CONTAIN_MIN && sq.includes(rq)) || (sq.length >= CONTAIN_MIN && rq.includes(sq));
  const rn = numbers(r), numbersIn = numbers(s).every(n => rn.includes(n));
  if (statusSame && (contained || (sw.length >= SAME_MIN_WORDS && overlap >= SAME_OVERLAP && numbersIn))) return 'same';
  const rd = dates(r);
  if (contained || overlap >= SIMILAR_OVERLAP || (dates(s).some(d => rd.includes(d)) && shared.length >= 2)) return 'similar';
  return 'new';
}
// 그 칸의 기록 여럿과: 가장 강한 판단.
export function compareRecords(summary, records = []) {
  let best = 'new';
  for (const record of records) {
    const v = compareOne(summary, record);
    if (v === 'same') return 'same';
    if (v === 'similar') best = 'similar';
  }
  return best;
}

// 자료 한 줄(꼬리표 '자료'는 화면에만, Q5 ①): "제목 — 요약" 또는 "제목".
export const fileTitle = doc => String(doc?.title || doc?.file_name || '').trim() || '(제목 없음)';
export const briefOf = doc => (doc?.brief && BRIEF_HASH.test(String(doc.brief.hash || '')) ? String(doc.brief.summary || '').trim() : '');
export const fileText = doc => { const brief = briefOf(doc); return brief ? `${fileTitle(doc)} — ${brief}` : fileTitle(doc); };

// 같은 지문 합치기: 지문이 같은 자료는 먼저 올린 하나만 남기고 `same`(그 주 같은 파일 수)을 단다. 지문 없는 자료는 그대로.
export function mergeSameFiles(docs = []) {
  const ordered = [...docs].filter(doc => doc && doc.id).sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || String(a.id).localeCompare(String(b.id)));
  const first = new Map(), out = [];
  for (const doc of ordered) {
    const hash = BRIEF_HASH.test(String(doc.brief?.hash || '')) ? doc.brief.hash : '';
    if (hash && first.has(hash)) { first.get(hash).same++; continue; }
    const kept = {doc, same:1};
    if (hash) first.set(hash, kept);
    out.push(kept);
  }
  return out.map(({doc, same}) => (same > 1 ? {...doc, same} : doc));
}

// 자리 찾기. orgs: {names: Map(id → 이름), mine: Set | null}(조직 읽기를 못 하면 names 비어 있음), projects: Map(id → 이름)(트리).
// 결과 {orgs:[{doc, id, name, prefix}], projects:[{doc, id, name}], notes:[doc]}. 회의자료는 지금처럼 참고(Q3 함께).
export function placeFiles(docs = [], {orgs = {}, projects = new Map()} = {}) {
  const names = orgs.names instanceof Map ? orgs.names : new Map(), mine = orgs.mine instanceof Set ? orgs.mine : null;
  const out = {orgs:[], projects:[], notes:[]};
  for (const doc of mergeSameFiles(docs)) {
    const org = doc.organization_id ? String(doc.organization_id).toLowerCase() : '', project = doc.project_id ? String(doc.project_id) : '';
    if (doc.meeting_id) out.notes.push(doc);
    else if (org && names.has(org)) out.orgs.push({doc, id:org, name:names.get(org), others:!!(mine && !mine.has(org))});
    else if (!org && project && projects.has(project)) out.projects.push({doc, id:project, name:projects.get(project)});
    else out.notes.push(doc);
  }
  return out;
}

// 판단 하나: records = 그 칸의 기록 글, attached = 그 칸에 이미 보이는 바구니 업데이트의 첨부 Drive 파일 id(Set).
// 지난주 이전에 같은 파일을 올렸으면(repeat) 접힘. 결과 {verdict:'same'|'similar'|'new', reason:'record'|'repeat'|'attached'|''}.
export function fileVerdict(doc, {records = [], attached = new Set()} = {}) {
  if (doc?.repeat) return {verdict:'same', reason:'repeat'};
  const v = compareRecords(briefOf(doc), records);
  if (v === 'same') return {verdict:'same', reason:'record'};
  if (v === 'similar') return {verdict:'similar', reason:'record'};
  if (doc?.file_id && attached.has(String(doc.file_id))) return {verdict:'similar', reason:'attached'};
  return {verdict:'new', reason:''};
}

// 화면·복사·한글 파일 후보가 같이 쓰는 항목: {day, text, requests:[], file:{id, verdict, reason, same}}. 접힌 항목(verdict 'same')은
// 화면의 "기록과 같아 뺀 자료 N"에만 보이고 복사·한글 파일 후보에는 들어가지 않는다.
export const fileItem = (doc, day, verdict) => ({day, text:fileText(doc), requests:[], file:{id:doc.id, verdict:verdict.verdict, reason:verdict.reason, same:doc.same || 1}});
// 화면 ②(설계 6절): 그 주 임시저장 draft.docs의 고침 — drop(뺌), text(고친 줄, 그 주 보고 글만·자료 요약은 그대로), keep(접힌 자료를 넣음).
export const isFolded = item => item?.file?.verdict === 'same' && !item.file.kept && !item.file.dropped;
export const isDroppedFile = item => !!item?.file?.dropped;
export const shownItems = items => (items || []).filter(item => !isFolded(item) && !isDroppedFile(item));
// 고침 하나를 항목에 단다(edit 없으면 그대로). 고친 줄이면 원래 줄은 file.original에 남는다.
export function applyDocEdit(item, edit) {
  if (!item?.file || !edit) return item;
  const file = {...item.file};
  let text = item.text;
  if (edit.text) { file.original = item.text; file.edited = true; text = edit.text; }
  if (edit.keep && file.verdict === 'same') file.kept = true;
  if (edit.drop) file.dropped = true;
  return {...item, text, file};
}
// 칸 안 자리: 'dropped'(뺀 자료 N) | 'folded'(기록과 같아 뺀 자료 N) | 'items'(보이는 줄).
export const fileBucket = item => (isDroppedFile(item) ? 'dropped' : isFolded(item) ? 'folded' : 'items');
