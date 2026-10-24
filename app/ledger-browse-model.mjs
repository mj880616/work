// AI-서버연동 S7-c: 원장 목록·검색 화면(app/ledger-browse.js)의 순수 함수. 설계: docs/design/ledger-web2.md 8·15절.
// 검색 RPC(app_ledger_search, 20261021082000)에 보낼 인자 만들기, 날짜·고정 목록 표시, 상세 칸 정리만 한다(DOM·네트워크 없음).
export const KIND_LABEL = Object.freeze({ event: '사건', change: '변화기록', decision: '결정', evidence: '근거', commitment: '약속' });
export const KINDS = Object.freeze(Object.keys(KIND_LABEL));
// 화면에 보이는 이름만 쉬운 말로(DB 값·필터 값·원장 안의 이름 KIND_LABEL은 그대로). 설명은 docs/design/ledger-web2.md 종류 정의를 짧게 줄인 것.
export const KIND_DISPLAY = Object.freeze({ event: '일어난 일', change: '바뀐 점', decision: '정한 것', evidence: '근거', commitment: '약속' });
export const KIND_HINT = Object.freeze({
  event: '추적할 일 하나(원장의 사건)', change: '일어난 일에 생긴 변화·진전(원장의 변화기록)',
  decision: '채택·기각·보류 등 정한 내용(원장의 결정)', evidence: '법령·통계·합의문 등 뒷받침 자료(원장의 근거)',
  commitment: '상대가 하기로 한 일, 후속확인일이 있음(원장의 약속)' });
export const VALIDITY_LABEL = Object.freeze({ current: '현재유효', fulfilled: '이행완료', superseded: '대체', retired: '폐기', needs_check: '확인필요' });
export const SENSITIVITY_LABEL = Object.freeze({ S0: 'S0 공개 가능', S1: 'S1 내부 업무', S2: 'S2 교섭·전략' });
export const IMPORTANCE_LABEL = Object.freeze({ very_high: '매우높음', high: '높음', normal: '보통', low: '낮음' });
export const EVENT_STATUS_LABEL = Object.freeze({ tracking: '추적중', watching: '관찰', closed: '종료', on_hold: '보류' });
export const DECISION_TYPE_LABEL = Object.freeze({ adopted: '채택', rejected: '기각', on_hold: '보류', changed: '변경' });
export const EVIDENCE_TYPE_LABEL = Object.freeze({ law: '법령', statistics: '통계', budget: '예산', agreement: '합의문', precedent: '판례·선례',
  gov_position: '정부 입장', counterpart_statement: '상대측 발언', field_fact: '현장 사실', argument: '교섭 논거', other: '기타' });
export const COMMITMENT_STATUS_LABEL = Object.freeze({ waiting: '대기', fulfilled: '이행', broken: '불이행', cancelled: '취소' });
export const CONFIDENCE_LABEL = Object.freeze({ high: '높음', medium: '중간', low: '낮음' });
export const VERIFICATION_LABEL = Object.freeze({ verified: '확인', partial: '부분확인', unverified: '미확인' });
export const DOC_TYPE_LABEL = Object.freeze({ meeting_material: '회의자료', minutes: '회의록', official_letter: '공문', news: '기사',
  statement: '성명·보도자료', law: '법령', gov_report: '정부·기관 보고서', bargaining: '교섭자료', call_transcript: '통화 전사',
  telegram: '텔레그램', email: '메일', ai_chat: 'AI 대화', internal_doc: '내부 문서', other: '기타' });
export const RELATION_LABEL = Object.freeze({ belongs_to: '소속', follow_up: '후속', supports: '뒷받침', contradicts: '반박', related: '관련',
  direct: '직접관련', joint: '공동사업', counterpart: '상대기관', reference: '참고', other: '기타' });
// 범위(L1): 기본은 업무만. 관심 정보는 따로 골라야 보인다.
export const SCOPE_CHOICES = Object.freeze([['work', '업무만'], ['all', '전체'], ['interest', '관심만']]);
export const PAGE = 50;
export const MAX_LIMIT = 200;
export const QUERY_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = v => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
  && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

export function freshFilters() {
  return { q: '', kinds: [], from: '', to: '', organization: '', topic: '', scope: 'work', inactive: false };
}

// 화면 칸 → 검사한 RPC 인자. 잘못된 칸은 {error}로 돌려주고 RPC를 부르지 않는다(DB도 22023으로 한 번 더 막음).
export function searchArgs(filters, limit = PAGE) {
  const f = { ...freshFilters(), ...(filters || {}) };
  const q = String(f.q ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if ([...q].length > QUERY_MAX) return { error: `검색어는 ${QUERY_MAX}자까지 쓸 수 있습니다.` };
  const kinds = [...new Set((f.kinds || []).filter(k => KINDS.includes(k)))];
  if (f.from && !isDay(f.from)) return { error: '시작 날짜를 확인하세요.' };
  if (f.to && !isDay(f.to)) return { error: '끝 날짜를 확인하세요.' };
  if (f.from && f.to && f.to < f.from) return { error: '끝 날짜가 시작 날짜보다 앞입니다.' };
  const organization = UUID.test(String(f.organization || '')) ? f.organization : null;
  const topic = UUID.test(String(f.topic || '')) ? f.topic : null;
  const scope = f.scope === 'all' ? null : f.scope === 'interest' ? 'interest' : 'work';
  const n = Math.min(MAX_LIMIT, Math.max(1, Number.isSafeInteger(limit) ? limit : PAGE));
  return {
    args: {
      p_query: q, p_kinds: kinds.length && kinds.length < KINDS.length ? kinds : null,
      p_organization_id: organization, p_topic_id: topic, p_date_from: f.from || null, p_date_to: f.to || null,
      p_scope: scope, p_include_inactive: f.inactive === true, p_limit: n
    }
  };
}

// 기준일 표시: 정밀도에 맞춰(일·월·연·기간·모름). 원래 표기(date_note)가 있으면 함께.
export function dateLabel(row) {
  const s = row?.date_start, e = row?.date_end, p = row?.date_precision;
  let text = '';
  if (p === 'day' && isDay(s)) text = s;
  else if (p === 'month' && isDay(s)) text = s.slice(0, 7);
  else if (p === 'year' && isDay(s)) text = s.slice(0, 4);
  else if (p === 'range' && isDay(s) && isDay(e)) text = `${s} ~ ${e}`;
  const note = typeof row?.date_note === 'string' ? row.date_note.trim() : '';
  if (!text) return note || '날짜 모름';
  return note && note !== text ? `${text} (${note})` : text;
}

const seoulToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
// 기한 지남은 저장하지 않고 볼 때 계산한다(3.1절): 대기 중인 약속의 후속확인일이 오늘보다 앞.
export function overdue(record, now = new Date()) {
  return record?.kind === 'commitment' && record.commitment_status === 'waiting' && isDay(record.follow_up_on) && record.follow_up_on < seoulToday(now);
}

// 검색 결과 행: 모양이 맞는 행만 보여 준다(DB 응답도 믿지 않음).
export function validResult(row) {
  return !!row && typeof row === 'object' && UUID.test(String(row.id)) && typeof row.ledger_id === 'string' && KINDS.includes(row.kind)
    && typeof row.title === 'string' && row.title.trim() !== '';
}

// 상세의 칸 목록 [이름, 값]. 비어 있는 칸은 뺀다. 종류별 칸은 그 종류에서만.
export function detailFields(r, { topicName = '', supersededBy = '' } = {}) {
  if (!r) return [];
  const label = (map, v) => (v == null || v === '' ? '' : map[v] || String(v));
  const rows = [
    ['ID', r.ledger_id], ['종류', KIND_DISPLAY[r.kind] || r.kind], ['기준일', dateLabel(r)],
    ['범위', r.scope === 'interest' ? '관심' : '업무'], ['업무주제', topicName],
    ['민감도', label(SENSITIVITY_LABEL, r.sensitivity)], ['중요도', label(IMPORTANCE_LABEL, r.importance)],
    ['유효상태', label(VALIDITY_LABEL, r.validity)], ['신뢰도', label(CONFIDENCE_LABEL, r.confidence)],
    ['확인상태', label(VERIFICATION_LABEL, r.verification)]
  ];
  if (r.kind === 'event') rows.push(['사건 상태', label(EVENT_STATUS_LABEL, r.event_status)]);
  if (r.kind === 'decision') rows.push(['결정유형', label(DECISION_TYPE_LABEL, r.decision_type)], ['결정이유', r.decision_reason || '']);
  if (r.kind === 'evidence') rows.push(['근거 유형', label(EVIDENCE_TYPE_LABEL, r.evidence_type)]);
  if (r.kind === 'commitment') rows.push(['상대측', r.counterparty || ''], ['이행상태', label(COMMITMENT_STATUS_LABEL, r.commitment_status)],
    ['후속확인일', isDay(r.follow_up_on) ? r.follow_up_on + (overdue(r) ? ' (기한 지남)' : '') : '']);
  if (supersededBy || r.supersede_reason) rows.push(['대체기록', supersededBy], ['대체사유', r.supersede_reason || '']);
  rows.push(['비고', r.note || '']);
  return rows.filter(([, v]) => v != null && String(v).trim() !== '');
}

// 출처 위치가 웹 주소면 연결로, 아니면 글자로. Drive 파일 ID는 Drive 보기 주소로만 만든다.
export function sourceHref(source) {
  const loc = typeof source?.location === 'string' ? source.location.trim() : '';
  if (/^https:\/\/[^\s<>"']+$/i.test(loc)) return loc;
  if (typeof source?.drive_file_id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(source.drive_file_id)) {
    return `https://drive.google.com/file/d/${source.drive_file_id}/view`;
  }
  return '';
}

// 연결 행 → 표시용. dir: 'out'(이 기록 → 대상) / 'in'(다른 기록 → 이 기록).
export function linkLabel(link, names, dir) {
  const rel = RELATION_LABEL[link?.relation] || link?.relation || '';
  if (dir === 'in') {
    const r = names.records.get(link.record_id);
    return { relation: rel, kind: 'record', ledgerId: r?.ledger_id || '', title: r?.title || '(읽을 수 없는 기록)', dir };
  }
  if (link.target_record_id) {
    const r = names.records.get(link.target_record_id);
    return { relation: rel, kind: 'record', ledgerId: r?.ledger_id || '', title: r?.title || '(읽을 수 없는 기록)', dir };
  }
  if (link.target_organization_id) {
    const o = names.organizations.get(link.target_organization_id);
    return { relation: rel, kind: 'organization', ledgerId: o?.ledger_id || '', title: o?.name || '(읽을 수 없는 조직)', dir };
  }
  if (link.target_project_id) return { relation: rel, kind: 'project', ledgerId: '', title: names.projects.get(link.target_project_id) || '(Web2 프로젝트)', dir };
  if (link.target_meeting_id) return { relation: rel, kind: 'meeting', ledgerId: '', title: names.meetings.get(link.target_meeting_id) || '(Web2 회의)', dir };
  return { relation: rel, kind: 'other', ledgerId: '', title: '', dir };
}

// ---------- 목록 표시(화면 전용 순수 함수) ----------
const thisYear = (now = new Date()) => seoulToday(now).slice(0, 4);
// 'YYYY-MM-DD' → 올해면 'MM.DD', 아니면 'YY.MM.DD'.
export function shortDay(day, now = new Date()) {
  if (!isDay(day)) return '';
  const [y, m, d] = day.split('-');
  return y === thisYear(now) ? `${m}.${d}` : `${y.slice(2)}.${m}.${d}`;
}
// 목록 줄의 짧은 날짜. 정밀도: 일 → 10.21 / 월 → 2026.09 / 연 → 2026 / 기간 → 10.01~10.22 / 모름 → 빈칸. 전체 표기는 dateLabel(툴팁·상세).
export function shortDate(row, now = new Date()) {
  const s = row?.date_start, e = row?.date_end, p = row?.date_precision;
  if (p === 'day' && isDay(s)) return shortDay(s, now);
  if (p === 'month' && isDay(s)) return s.slice(0, 7).replace('-', '.');
  if (p === 'year' && isDay(s)) return s.slice(0, 4);
  if (p === 'range' && isDay(s) && isDay(e)) return `${shortDay(s, now)}~${shortDay(e, now)}`;
  return '';
}
export function periodLabel(from, to, now = new Date()) {
  if (!from && !to) return '';
  return `${from ? shortDay(from, now) : ''}~${to ? shortDay(to, now) : ''}`;
}

// 가져온 글에 남은 기계식 표기 '(계속추적=아니오, 상태=종료)'를 글에서 빼고 상태만 따로 돌려준다.
const MACHINE_NOTE = /\s*[(（]\s*계속\s*추적\s*[=:：]\s*[^,，)）]*[,，]\s*상태\s*[=:：]\s*([^)）]*?)\s*[)）]/g;
export function splitMachineNote(text) {
  let status = '';
  const clean = String(text ?? '').replace(MACHINE_NOTE, (_, st) => { status ||= st.trim(); return ''; }).trim();
  return { text: clean, status };
}
const norm = v => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').replace(/[\s.。…·]+$/u, '').trim();
// 요지가 제목과 같은 문장이면 요지 줄을 만들지 않는다.
export function sameSentence(a, b) { const x = norm(a); return x !== '' && x === norm(b); }

// 목록 한 줄의 표시값. 제목·요지는 기계식 표기를 뺀 글, 요지는 제목과 같으면 빈 글.
export function rowView(row, now = new Date()) {
  const t = splitMachineNote(row?.title), s = splitMachineNote(row?.summary);
  const title = t.text || String(row?.title ?? '').trim();
  const summary = sameSentence(s.text, title) ? '' : s.text;
  return { title, summary, status: s.status || t.status, date: shortDate(row, now), dateFull: dateLabel(row) };
}

// 걸려 있는 조건 → 칩 목록 [{key, label}]. key는 clearCondition에 그대로 쓴다.
export function activeConditions(filters, { organizations = [], topics = [] } = {}, now = new Date()) {
  const f = { ...freshFilters(), ...(filters || {}) };
  const out = [];
  for (const k of KINDS) if (f.kinds.includes(k)) out.push({ key: `kind:${k}`, label: KIND_DISPLAY[k] });
  const period = periodLabel(f.from, f.to, now);
  if (period) out.push({ key: 'period', label: period });
  const org = organizations.find(o => o.id === f.organization);
  if (f.organization) out.push({ key: 'organization', label: org?.name || '조직' });
  const topic = topics.find(o => o.id === f.topic);
  if (f.topic) out.push({ key: 'topic', label: topic?.name || '주제' });
  if (f.scope !== 'work') out.push({ key: 'scope', label: (SCOPE_CHOICES.find(([v]) => v === f.scope) || [])[1] || '범위' });
  if (f.inactive) out.push({ key: 'inactive', label: '지난 기록 포함' });
  return out;
}
export function clearCondition(filters, key) {
  const f = { ...freshFilters(), ...(filters || {}) };
  if (key.startsWith('kind:')) f.kinds = f.kinds.filter(k => k !== key.slice(5));
  else if (key === 'period') { f.from = ''; f.to = ''; }
  else if (key === 'organization') f.organization = '';
  else if (key === 'topic') f.topic = '';
  else if (key === 'scope') f.scope = 'work';
  else if (key === 'inactive') f.inactive = false;
  return f;
}
export const countLabel = (n, limit) => (n >= limit ? `최근 ${limit}건` : `${n}건`);

// ---------- LEDGER-자동기록 3단계(설계 docs/design/ledger-auto-record.md 3.3·8.1·9.2절) ----------
// 출처 위치 web2:<종류>:<id> → {kind, id}. 종류는 자동 기록 재료 여섯만(서버 ai-assist ledger-auto.ts web2Location과 같은 모양).
export const WEB2_SOURCE_KINDS = Object.freeze(['basket', 'note', 'work', 'meeting', 'org_update', 'project_update']);
export const WEB2_SOURCE_NAME = Object.freeze({ basket: '업데이트', note: '노트', work: '업무일지 한 줄', meeting: '사업 보고', org_update: '담당조직 기록', project_update: '프로젝트 기록' });
export function web2Source(location) {
  const m = /^web2:([a-z_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(location ?? '').trim());
  if (!m || !WEB2_SOURCE_KINDS.includes(m[1])) return null;
  return { kind: m[1], id: m[2].toLowerCase() };
}
// 원문을 여는 곳(전체 검색의 openTarget과 같은 모양: 각 화면의 기존 여는 함수). 원문 행이 없으면 null(지워졌거나 보관됨).
export function web2OpenTarget(src, row) {
  if (!src || !row) return null;
  if (src.kind === 'basket') return row.archived_at ? null : { view: 'basket', note: 'memo', id: src.id };
  if (src.kind === 'note') return row.archived_at ? null : { view: 'basket', note: 'doc', id: src.id };
  if (src.kind === 'work') return isDay(row.journal_day) ? { view: 'journal', day: row.journal_day } : null;
  if (src.kind === 'meeting') return { view: 'meetings', id: src.id };
  if (src.kind === 'org_update') return UUID.test(String(row.organization_id || '')) ? { view: 'team', id: String(row.organization_id) } : null;
  if (src.kind === 'project_update') return UUID.test(String(row.project_id || '')) ? { view: 'projects', id: String(row.project_id) } : null;
  return null;
}
// 근거 줄 글: "업데이트 · 10/22", "사업 보고 · 가 지부 3차 · 10/21".
export function web2SourceLabel(src, source) {
  const name = WEB2_SOURCE_NAME[src?.kind] || 'Web2 기록';
  const m = /\(([^()]{1,80})\)\s*$/.exec(String(source?.title ?? ''));
  const date = isDay(source?.source_date) ? `${Number(source.source_date.slice(5, 7))}/${Number(source.source_date.slice(8, 10))}` : '';
  return [name, m ? m[1].trim() : '', date].filter(Boolean).join(' · ');
}

// 변경 기록(app_ledger_record_changes) 행 → 기록별 {auto, runId, notes}. 모양이 틀린 행은 버린다(DB 응답도 믿지 않음).
const ACTIONS = ['created', 'source_added', 'needs_check', 'replaced', 'retired'];
export function changeInfo(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !UUID.test(String(r.record_id)) || !ACTIONS.includes(r.action) || !['auto', 'correction'].includes(r.route)) continue;
    const id = String(r.record_id);
    const it = out.get(id) || { auto: false, runId: null, notes: [] };
    if (r.action === 'created' && r.route === 'auto') { it.auto = true; if (UUID.test(String(r.run_id || ''))) it.runId = String(r.run_id); }
    const note = typeof r.note === 'string' ? r.note.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : '';
    if (note) it.notes.push(note);
    out.set(id, it);
  }
  return out;
}
// 자동 기록 행의 첫 줄 글(변경 기록 note가 없을 때): "자동 기록".
export const AUTO_TAG = '자동';

// [틀린 기록으로 표시]의 이유(사람이 고름). 수정 요청 함수 app_apply_ledger_fix의 retire로 보낸다(폐기, 지우지 않음).
export const RETIRE_REASONS = Object.freeze([['wrong', '사실과 달라요'], ['duplicate', '같은 기록이 이미 있어요'], ['not_ledger', '원장에 둘 일이 아니에요']]);
export function retireRequest(ledgerId, reasonKey) {
  const reason = (RETIRE_REASONS.find(([k]) => k === reasonKey) || [])[1];
  if (!reason || !/^[A-Z]{2,6}-[0-9]{4,6}$/.test(String(ledgerId || ''))) return null;
  return { format: 'kptu-ledger-fix', version: 1, received_from: 'user', items: [{ target: ledgerId, do: 'retire', reason }] };
}
// DB 함수 거절 → 일상어(코드 글자는 화면에 쓰지 않음).
export function undoErrorText(e) {
  const m = String(e?.message || '');
  if (e?.status === 404 || /PGRST202|42883/.test(m)) return '되돌리기 준비 전이에요.';
  if (/UNDO_CHANGED/.test(m)) return '그 뒤에 고친 기록이 있어 되돌리지 않았어요.';
  if (/UNDO_REFERENCED/.test(m)) return '다른 기록이 이 기록을 가리키고 있어 되돌리지 않았어요.';
  if (/UNDO_NOT_DONE|UNDO_NOT_APPLIED/.test(m)) return '이미 되돌렸어요.';
  if (/TARGET_INACTIVE/.test(m)) return '이미 대체됐거나 폐기된 기록이에요.';
  if (/NOT_OWNER|42501/.test(m) || e?.status === 401 || e?.status === 403) return '로그인한 소유자만 할 수 있어요.';
  return '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}
