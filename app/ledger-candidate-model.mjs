// AI-서버연동 S7-c: 원장 후보의 모양 검사·표시·[고쳐서 확정] 내용 만들기(순수 함수, DOM·네트워크 없음).
// 설계: docs/design/ledger-web2.md 4·15절, migration 20261021190000_ledger_candidates(확정 함수가 DB에서 한 번 더 검사).
// 쓰는 곳: 후보 화면(app/ledger-candidates.js), 가져오기 화면의 Claude 후보 파일(app/ledger-import-model.mjs → [후보로 넣기]).
import { looksPersonal } from './ledger-import-model.mjs';
import { KIND_LABEL, dateLabel } from './ledger-browse-model.mjs';

export const ACTIONS = Object.freeze(['new', 'add_source', 'update', 'supersede']);
export const ACTION_LABEL = Object.freeze({ new: '새 기록', add_source: '기존 기록에 출처 추가', update: '기존 기록 고침', supersede: '기존 기록 대체' });
export const ORIGIN_LABEL = Object.freeze({ web2_ai: 'Web2 AI', claude_import: 'Claude 파일', user: '직접' });
export const ORIGIN_SOURCE_LABEL = Object.freeze({ basket: '업데이트', note: '노트', work: '일지', meeting: '회의 결과', org_update: '조직 기록', project_update: '프로젝트 기록' });
export const MAX_CANDIDATES = 500;
const KINDS = Object.keys(KIND_LABEL);
const ENTRY_KEYS = ['action', 'kind', 'title', 'sensitivity', 'target', 'dedup_key', 'payload'];
const PAYLOAD_KEYS = ['record', 'supersede_reason', 'sources', 'links', 'origin_ref'];
export const RECORD_KEYS = Object.freeze(['summary', 'scope', 'topic', 'importance', 'validity', 'confidence', 'verification', 'date_start', 'date_end',
  'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
  'commitment_status', 'follow_up_on', 'note']);
const SOURCE_KEYS = ['source', 'new', 'locator', 'note'];
const NEW_SOURCE_KEYS = ['title', 'doc_type', 'location', 'drive_file_id', 'source_date', 'sensitivity', 'note'];
const LINK_KEYS = ['target_record', 'target_organization', 'target_project_id', 'target_meeting_id', 'relation', 'note'];
const CONTROL = /[\u0000-\u001f\u007f]/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o, keys) => Object.keys(o).every(k => keys.includes(k));
export const isDay = v => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
  && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

// 후보 하나(파일의 한 줄 또는 DB 행의 kind·action·title·sensitivity + payload)의 모양. 틀리면 이유 글자, 맞으면 ''.
export function candidateProblem(c) {
  if (!isObj(c) || !onlyKeys(c, ENTRY_KEYS)) return '모르는 칸';
  if (!KINDS.includes(c.kind)) return '종류';
  const action = c.action ?? 'new';
  if (!ACTIONS.includes(action)) return '처리 방식';
  if (typeof c.title !== 'string' || !c.title.trim() || [...c.title].length > 300 || CONTROL.test(c.title)) return '제목';
  if (!['S0', 'S1', 'S2', 'S3'].includes(c.sensitivity ?? 'S1')) return '민감도';
  if ((action !== 'new') !== (typeof c.target === 'string' && c.target.trim() !== '')) return '대상 기록';
  if (c.dedup_key != null && (typeof c.dedup_key !== 'string' || [...c.dedup_key].length > 300 || CONTROL.test(c.dedup_key))) return '중복 열쇠';
  return payloadProblem(c.payload ?? {});
}
export function payloadProblem(p) {
  if (!isObj(p) || !onlyKeys(p, PAYLOAD_KEYS)) return '내용 칸';
  const rec = p.record ?? {};
  if (!isObj(rec) || !onlyKeys(rec, RECORD_KEYS)) return '기록 칸';
  for (const k of ['date_start', 'date_end', 'follow_up_on']) if (rec[k] != null && !isDay(rec[k])) return '날짜';
  if (rec.validity != null && !['current', 'needs_check', 'fulfilled'].includes(rec.validity)) return '유효상태';
  for (const [list, keys] of [[p.sources, SOURCE_KEYS], [p.links, LINK_KEYS]]) {
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 20 || list.some(e => !isObj(e) || !onlyKeys(e, keys))) return '출처·연결';
  }
  for (const s of p.sources || []) {
    if (('source' in s) === ('new' in s)) return '출처';
    if (s.new && (!isObj(s.new) || !onlyKeys(s.new, NEW_SOURCE_KEYS) || typeof s.new.title !== 'string' || !s.new.title.trim())) return '새 출처';
  }
  for (const l of p.links || []) {
    if (['target_record', 'target_organization', 'target_project_id', 'target_meeting_id'].filter(k => l[k] != null).length !== 1) return '연결 대상';
  }
  if (JSON.stringify(p).length > 60000) return '내용이 너무 큼';
  return '';
}

// Claude 가져오기 파일(kind = candidates) → [후보로 넣기]에 보낼 묶음. S3·개인정보 모양은 빼고 개수만(L9), 모양이 틀리면 거부.
export function candidateFilePayload(data, sha256) {
  const list = Array.isArray(data?.candidates) ? data.candidates : null;
  const result = { payload: null, total: list?.length ?? 0, excluded: 0, personal: 0, invalid: [], kinds: {} };
  if (!list) { result.invalid.push({ index: -1, reason: 'candidates 배열' }); return result; }
  const kept = [];
  list.forEach((c, index) => {
    const problem = candidateProblem(c);
    if (problem) { result.invalid.push({ index, reason: problem }); return; }
    if ((c.sensitivity ?? 'S1') === 'S3') { result.excluded++; return; }
    if (looksPersonal(JSON.stringify(c))) { result.personal++; return; }
    kept.push(c);
    result.kinds[c.kind] = (result.kinds[c.kind] || 0) + 1;
  });
  if (list.length > MAX_CANDIDATES) result.invalid.push({ index: -1, reason: `한 묶음 ${MAX_CANDIDATES}건까지` });
  if (!kept.length && !result.invalid.length) result.invalid.push({ index: -1, reason: '넣을 후보가 없음' });
  result.payload = {
    format: 'kptu-ledger-import', version: 1, kind: 'candidates', sha256,
    label: typeof data.label === 'string' ? data.label.replace(CONTROL, ' ').trim().slice(0, 80) : '',
    candidates: kept, report: { total: list.length, excluded: result.excluded, personal: result.personal }
  };
  return result;
}

// 화면 표시용으로 정리한 후보(DB 응답도 믿지 않음). 모양이 틀리면 null.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function candidateView(row) {
  if (!isObj(row) || !UUID.test(String(row.id)) || !KINDS.includes(row.kind) || !ACTIONS.includes(row.action)
      || typeof row.title !== 'string' || !row.title.trim() || !isObj(row.payload)) return null;
  const rec = isObj(row.payload.record) ? row.payload.record : {};
  const ref = isObj(row.payload.origin_ref) ? row.payload.origin_ref : null;
  return {
    id: row.id, kind: row.kind, kindLabel: KIND_LABEL[row.kind], action: row.action, actionLabel: ACTION_LABEL[row.action],
    origin: row.origin, originLabel: ORIGIN_LABEL[row.origin] || '', title: row.title, sensitivity: row.sensitivity,
    summary: typeof rec.summary === 'string' ? rec.summary : '', date: rec.date_start || rec.date_note ? dateLabel({ date_precision: rec.date_precision || (rec.date_start ? 'day' : 'unknown'), ...rec }) : '',
    record: rec, sources: Array.isArray(row.payload.sources) ? row.payload.sources : [], links: Array.isArray(row.payload.links) ? row.payload.links : [],
    supersedeReason: typeof row.payload.supersede_reason === 'string' ? row.payload.supersede_reason : '',
    originRef: ref && typeof ref.kind === 'string' ? { label: ORIGIN_SOURCE_LABEL[ref.kind] || '기록', day: isDay(ref.day) ? ref.day : '' } : null,
    targetRecordId: row.target_record_id || null, importId: row.import_id || null, createdAt: row.created_at || '', payload: row.payload
  };
}

// [고쳐서 확정] 칸 → app_confirm_ledger_candidate의 p_edit. 비운 칸은 내용에서 뺀다. 틀리면 {error}.
export const EDIT_FIELDS = Object.freeze({
  common: ['title', 'summary', 'date_start', 'sensitivity', 'scope', 'note'],
  event: ['event_status'], decision: ['decision_type', 'decision_reason'], evidence: ['evidence_type'],
  commitment: ['counterparty', 'commitment_status', 'follow_up_on'], change: []
});
export function editPayload(view, form) {
  const text = v => String(v ?? '').replace(/\r\n?/g, '\n').trim();
  const line = v => text(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  const title = line(form.title);
  if (!title) return { error: '제목을 써 주세요.' };
  if ([...title].length > 300) return { error: '제목은 300자까지 쓸 수 있습니다.' };
  const sensitivity = ['S0', 'S1', 'S2'].includes(form.sensitivity) ? form.sensitivity : null;
  if (!sensitivity) return { error: '민감도를 고르세요. S3(개인 민감)은 원장에 넣지 않으므로 [버림]을 누르세요.' };
  const rec = { ...view.record };
  const set = (k, v) => { if (v === '' || v == null) delete rec[k]; else rec[k] = v; };
  const summary = text(form.summary);
  if ([...summary].length > 4000) return { error: '요지는 4,000자까지 쓸 수 있습니다.' };
  set('summary', summary);
  set('note', text(form.note));
  set('scope', form.scope === 'interest' ? 'interest' : 'work');
  const day = line(form.date_start);
  if (day && !isDay(day)) return { error: '기준일을 확인하세요.' };
  // 화면에서 고친 기준일은 하루 정밀도로(월·연·기간은 그대로 두려면 칸을 고치지 않음).
  if (day !== (view.record.date_start || '')) {
    delete rec.date_end;
    if (day) { rec.date_start = day; rec.date_precision = 'day'; } else { delete rec.date_start; rec.date_precision = 'unknown'; }
  }
  for (const k of EDIT_FIELDS[view.kind] || []) {
    const v = k === 'decision_reason' ? text(form[k]) : line(form[k]);
    if (k === 'follow_up_on' && v && !isDay(v)) return { error: '후속확인일을 확인하세요.' };
    set(k, v);
  }
  if (view.kind === 'commitment' && !rec.counterparty) return { error: '약속은 상대측을 써야 합니다.' };
  const payload = { ...view.payload, record: rec };
  const problem = payloadProblem(payload);
  if (problem) return { error: `내용을 확인하세요(${problem}).` };
  return { edit: { title, sensitivity, payload } };
}

// 확정 함수의 오류 → 일상어.
export const CONFIRM_ERRORS = Object.freeze([
  [/LEDGER_CANDIDATE_DECIDED/, '이미 확정하거나 버린 후보입니다.'],
  [/LEDGER_CANDIDATE_NOT_FOUND/, '후보를 찾을 수 없습니다.'],
  [/LEDGER_CANDIDATE_UPDATE_MANUAL/, '기존 기록 고침 후보는 원장 기록을 직접 고친 뒤 [버림]으로 정리하세요.'],
  [/LEDGER_CANDIDATE_TARGET_INACTIVE/, '대체할 기록이 이미 대체되었거나 폐기되었습니다.'],
  [/LEDGER_CANDIDATE_BROKEN_REF:?\s*(.*)/, '원장에 없는 ID를 가리킵니다.'],
  [/LEDGER_ID_PREFIX_MISSING/, '원장 번호표에 이 종류의 접두어가 없습니다. 먼저 시트를 가져와 번호표를 만드세요.'],
  [/LEDGER_CANDIDATE_BAD_RECORD:?\s*(.*)/, '원장 칸 규칙에 맞지 않습니다. [고쳐서 확정]으로 고치세요.'],
  [/LEDGER_CANDIDATE_BAD_PAYLOAD:?\s*(.*)/, '후보 내용의 모양이 맞지 않습니다.'],
  [/LEDGER_CANDIDATE_BAD_EDIT/, '고친 내용의 모양이 맞지 않습니다.'],
  [/42501|permission denied/i, '이 작업공간의 소유자만 확정할 수 있습니다.']
]);
export function confirmError(error) {
  const text = String(error?.message || error || '');
  for (const [re, label] of CONFIRM_ERRORS) {
    const m = text.match(re);
    if (m) return m[1] ? `${label} (${m[1].slice(0, 200)})` : label;
  }
  if (error?.status === 0 || /timeout|network|fetch/i.test(text)) return '연결이 끊겨 결과를 확인하지 못했습니다. 목록을 다시 읽어 확인하세요.';
  return '확정하지 못했습니다. 잠시 뒤 다시 시도하세요.';
}

// 확정 취소(app_unconfirm_ledger_candidate) 오류 → 일상어. 거절이면 아무것도 바뀌지 않았다.
export const UNDO_SECONDS = 10;
export const UNDO_ERRORS = Object.freeze([
  [/LEDGER_UNDO_NOT_CONFIRMED/, '이미 대기로 돌아갔거나 버린 후보입니다.'],
  [/LEDGER_UNDO_NOT_FOUND/, '후보나 원장 기록을 찾을 수 없습니다.'],
  [/LEDGER_UNDO_IMPORTED/, '가져오기(시트 이전)로 들어온 기록이라 확정 취소를 할 수 없습니다.'],
  [/LEDGER_UNDO_REFERENCED/, '다른 기록이나 후보가 이 기록을 연결·대체·대상으로 가리키고 있어 취소할 수 없습니다. 그쪽을 먼저 정리하세요.'],
  [/LEDGER_UNDO_TARGET_CHANGED/, '이 확정이 대체한 기록이 그 뒤 고쳐져서 취소할 수 없습니다.'],
  [/LEDGER_UNDO_RECORD_CHANGED/, '확정 뒤 이 기록(또는 출처·연결)을 고쳐서 취소할 수 없습니다. 원장 기록을 직접 고치세요.'],
  [/LEDGER_UNDO_DUPLICATE_PENDING/, '같은 내용의 대기 후보가 이미 있어 취소할 수 없습니다. 그 후보를 먼저 정리하세요.'],
  [/42501|permission denied/i, '이 작업공간의 소유자만 확정을 취소할 수 있습니다.']
]);
export function undoError(error) {
  const text = String(error?.message || error || '');
  for (const [re, label] of UNDO_ERRORS) if (re.test(text)) return label;
  if (error?.status === 0 || /timeout|network|fetch/i.test(text)) return '연결이 끊겨 결과를 확인하지 못했습니다. 목록을 다시 읽어 확인하세요.';
  return '확정을 취소하지 못했습니다. 잠시 뒤 다시 시도하세요.';
}
