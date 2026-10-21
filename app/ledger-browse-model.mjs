// AI-서버연동 S7-c: 원장 목록·검색 화면(app/ledger-browse.js)의 순수 함수. 설계: docs/design/ledger-web2.md 8·15절.
// 검색 RPC(app_ledger_search, 20261021082000)에 보낼 인자 만들기, 날짜·고정 목록 표시, 상세 칸 정리만 한다(DOM·네트워크 없음).
export const KIND_LABEL = Object.freeze({ event: '사건', change: '변화기록', decision: '결정', evidence: '근거', commitment: '약속' });
export const KINDS = Object.freeze(Object.keys(KIND_LABEL));
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
export const SCOPE_CHOICES = Object.freeze([['work', '업무만'], ['all', '업무 + 관심'], ['interest', '관심만']]);
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
    ['ID', r.ledger_id], ['종류', KIND_LABEL[r.kind] || r.kind], ['기준일', dateLabel(r)],
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
