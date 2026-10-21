// AI-서버연동 S7-b: 원장 가져오기 파일 검사기. 브라우저 안에서만 돈다(파일 원문은 서버로 보내지 않고, 검사를 통과한 행만
// app_import_ledger_apply RPC로 보낸다). 설계: docs/design/ledger-web2.md 7절, migration 20261021150000_ledger_import.
// 입력 세 가지: 시트 탭별 CSV 여러 개 / 시트 전체 xlsx 한 개 / Claude가 만든 가져오기 파일(JSON, 이 파일의 FORMAT).
// 결과: 탭별 행 수(시트 행 = 넣을 행 + 제외 + 거부), 거부 사유별 수, 고정 목록 대응표, 깨끗하면 RPC로 보낼 묶음(payload).
// 깨진 참조·고정 목록 밖 값 등 거부가 하나라도 있으면 묶음 전체를 넣지 않는다(설계 7.2). 민감도 S3·개인정보 모양은 제외(L9).
export const FORMAT = 'kptu-ledger-import';
export const VERSION = 1;
export const MAX_ROWS = 20000;

const KINDS = ['event', 'change', 'decision', 'evidence', 'commitment'];
export const SCOPES = [...KINDS, 'source', 'organization', 'topic'];

// 시트 탭 → 가져오기 대상. 이름은 띄어쓰기 무시. 가져오지 않는 탭은 L2·L3·L4.
export const TABS = {
  event: { label: '사건', names: ['사건'], scope: 'event' },
  change: { label: '변화기록', names: ['변화기록', '변화'], scope: 'change' },
  decision: { label: '결정', names: ['결정'], scope: 'decision' },
  evidence: { label: '근거', names: ['근거'], scope: 'evidence' },
  commitment: { label: '약속', names: ['약속'], scope: 'commitment' },
  source: { label: '출처', names: ['출처'], scope: 'source' },
  organization: { label: '조직', names: ['조직'], scope: 'organization' },
  org_link: { label: '조직연결', names: ['조직연결'] },
  write_request: { label: '쓰기요청', names: ['쓰기요청'] },
  topic: { label: '업무주제', names: ['업무주제', '주제사전', '주제'], scope: 'topic' }
};
export const TAB_ORDER = ['topic', 'organization', 'source', 'event', 'change', 'decision', 'evidence', 'commitment', 'org_link', 'write_request'];
export const SKIPPED_TABS = { 검색인덱스: 'L2', 설정: 'L3', 수집대상: 'L4', 수집로그: 'L4', 수집파일인덱스: 'L4', 피드백: 'L4' };

const RECORD_COLUMNS = {
  title: ['제목', '건명'], summary: ['요지', '요약', '내용'], date: ['기준일', '날짜', '일자', '시점'],
  topic: ['분야', '업무주제', '주제', '관련업무'], scope: ['범위', '정보구분', '구분'], sensitivity: ['민감도'], importance: ['중요도'],
  validity: ['유효상태', '유효성'], confidence: ['신뢰도', '확신도'], verification: ['확인상태', '검증상태', '사실확인'],
  superseded_by: ['대체기록ID', '대체기록', '대체ID'], supersede_reason: ['대체사유'], sources: ['출처', '출처ID'], note: ['비고', '메모']
};
// 칸 이름(머리줄) → 필드. 앞에 있는 이름이 먼저 맞는다. drop은 알고 있지만 가져오지 않는 칸.
export const COLUMNS = {
  event: { id: ['ID', '사건ID'], ...RECORD_COLUMNS, title: ['제목', '사건명', '건명'], status: ['상태', '진행상태'], tracking: ['계속추적', '추적여부', '추적'] },
  // 실제 시트 머리줄(2026-10-21 확인, 구조만): 변화기록 = 업데이트ID·사건ID·확인시각·새로 확인된 것·이전 상태·새 상태·출처유형·출처명·출처URL·검증상태·신문반영일.
  change: { id: ['ID', '업데이트ID', '변화기록ID', '변화ID'], event: ['사건ID', '소속사건', '관련사건', '사건'], ...RECORD_COLUMNS,
    title: ['제목', '새로 확인된 것', '건명'], date: ['기준일', '확인시각', '날짜', '일자', '시점'], prev_state: ['이전 상태'], new_state: ['새 상태'],
    source_type: ['출처유형'], source_name: ['출처명'], source_url: ['출처URL'], drop: ['신문반영일'] },
  // 결정 = 결정ID·결정일·회의명·결정주체·결정내용·관련업무·관련조직·후속조치 요지·Web2연결ID·출처ID·근거위치·유효상태·최종업데이트일·태그·대체기록ID·대체사유.
  decision: { id: ['ID', '결정ID'], ...RECORD_COLUMNS, title: ['제목', '결정내용', '결정사항', '건명'], date: ['기준일', '결정일', '날짜', '일자'],
    decision_type: ['결정유형', '유형'], decision_reason: ['결정이유', '이유'], meeting: ['회의명'], actor: ['결정주체'], related_org: ['관련조직'],
    follow: ['후속조치 요지', '후속조치'], web2: ['Web2연결ID'], tags: ['태그'], locator: ['근거위치'], drop: ['최종업데이트일'] },
  evidence: { id: ['ID', '근거ID'], ...RECORD_COLUMNS, evidence_type: ['유형', '근거유형'], locator: ['근거위치', '위치'] },
  // 약속 = 약속ID·주체·주체유형·약속내용·원문표현·기준일·기한·조건·후속확인일·중요도·이행상태·대표관련기록ID·출처ID·근거위치·GoogleTaskID·상태변경일·상태근거ID.
  commitment: { id: ['ID', '약속ID'], ...RECORD_COLUMNS, title: ['제목', '약속내용', '건명'], summary: ['요지', '원문표현', '요약', '내용'],
    counterparty: ['상대측', '주체', '상대방', '상대'], commitment_status: ['이행상태', '상태'], follow_up_on: ['후속확인일', '확인일', '기한'],
    actor_type: ['주체유형'], condition: ['기한·조건', '기한조건'], related: ['대표관련기록ID'], locator: ['근거위치'], google: ['GoogleTaskID'],
    status_basis: ['상태근거ID'], drop: ['상태변경일'] },
  source: {
    id: ['ID', '출처ID'], title: ['제목', '출처명', '문서명', '자료명'], doc_type: ['문서종류', '종류', '유형'],
    location: ['위치', '링크', 'URL', '경로', '주소'], drive_file_id: ['DriveID', '드라이브ID', '파일ID'],
    date: ['날짜', '일자', '출처날짜', '작성일', '기준일'], coverage: ['처리범위'], processing_status: ['처리상태'],
    sensitivity: ['민감도'], note: ['비고', '메모']
  },
  organization: { id: ['ID', '조직ID'], name: ['조직명', '이름', '명칭'], aliases: ['별칭', '약칭'], web2: ['Web2연결ID', 'Web2ID', '웹2연결ID'], note: ['비고', '메모'] },
  // 조직연결 = 연결ID·조직ID·기록유형·기록ID·관계유형·기준일·활성여부·출처ID·최종업데이트일·비고.
  org_link: { link_id: ['ID', '연결ID'], record: ['기록ID', '원장ID', '대상ID', '사건ID', '기록'], organization: ['조직ID', '조직'], relation: ['관계유형', '관계'],
    note: ['비고', '메모'], record_type: ['기록유형'], date: ['기준일'], active: ['활성여부'], sources: ['출처ID'], drop: ['최종업데이트일'] },
  // 쓰기요청 = 요청ID·요청시각·요청출처·작업유형·대상유형·대상기록ID·중복키·제안내용·출처ID·상태·처리시각·결과기록ID·오류·비고.
  write_request: { id: ['ID', '요청ID', '쓰기요청ID'], status: ['상태', '처리상태'], date: ['요청시각', '요청일시', '요청일', '일시', '날짜'], type: ['작업유형', '요청유형', '유형'],
    summary: ['제안내용', '요지', '요청내용', '내용', '요약'], origin: ['요청출처'], target_type: ['대상유형'], targets: ['대상기록ID'], dedup: ['중복키'],
    sources: ['출처ID'], processed: ['처리시각'], results: ['결과기록ID'], error: ['오류'], note: ['비고'] },
  topic: { id: ['ID', '주제ID'], name: ['주제명', '이름', '주제'], aliases: ['별칭'], description: ['설명'] }
};
const REQUIRED = {
  event: ['id', 'title'], change: ['id', 'title'], decision: ['id', 'title'], evidence: ['id', 'title'], commitment: ['id', 'title'],
  source: ['id', 'title'], organization: ['id', 'name'], org_link: ['record', 'organization'], write_request: ['id'], topic: ['id', 'name']
};

// 고정 목록(20261021082000 CHECK와 같은 값). [값, 화면 이름]
export const FIXED = {
  sensitivity: [['S0', 'S0 공개 가능'], ['S1', 'S1 내부 업무'], ['S2', 'S2 교섭·전략'], ['S3', 'S3 민감 — 가져오지 않음']],
  importance: [['very_high', '매우높음'], ['high', '높음'], ['normal', '보통'], ['low', '낮음']],
  validity: [['current', '현재유효'], ['fulfilled', '이행완료'], ['superseded', '대체'], ['retired', '폐기'], ['needs_check', '확인필요']],
  confidence: [['', '(비움)'], ['high', '높음'], ['medium', '중간'], ['low', '낮음']],
  verification: [['', '(비움)'], ['verified', '확인'], ['partial', '부분확인'], ['unverified', '미확인']],
  event_status: [['tracking', '추적중'], ['watching', '관찰'], ['closed', '종료'], ['on_hold', '보류']],
  decision_type: [['', '(비움)'], ['adopted', '채택'], ['rejected', '기각'], ['on_hold', '보류'], ['changed', '변경']],
  evidence_type: [['law', '법령'], ['statistics', '통계'], ['budget', '예산'], ['agreement', '합의문'], ['precedent', '판례·선례'],
    ['gov_position', '정부 입장'], ['counterpart_statement', '상대측 발언'], ['field_fact', '현장 사실'], ['argument', '교섭 논거'], ['other', '기타']],
  commitment_status: [['waiting', '대기'], ['fulfilled', '이행'], ['broken', '불이행'], ['cancelled', '취소']],
  doc_type: [['meeting_material', '회의자료'], ['minutes', '회의록'], ['official_letter', '공문'], ['news', '기사'], ['statement', '성명·보도자료'],
    ['law', '법령'], ['gov_report', '정부·기관 보고서'], ['bargaining', '교섭자료'], ['call_transcript', '통화 전사'], ['telegram', '텔레그램'],
    ['email', '메일'], ['ai_chat', 'AI 대화'], ['internal_doc', '내부 문서'], ['other', '기타']],
  processing_status: [['unprocessed', '미처리'], ['partial', '부분처리'], ['done', '처리완료']],
  relation: [['direct', '직접관련'], ['joint', '공동사업'], ['counterpart', '상대기관'], ['reference', '참고'], ['other', '기타']],
  scope: [['work', '업무'], ['interest', '관심']]
};
export const MAP_LABELS = {
  sensitivity: '민감도', importance: '중요도', validity: '유효상태', confidence: '신뢰도', verification: '확인상태',
  event_status: '사건 상태(상태 / 계속추적)', decision_type: '결정유형', evidence_type: '근거 유형', commitment_status: '약속 이행상태',
  doc_type: '출처 문서종류', processing_status: '출처 처리상태', relation: '조직연결 관계유형', scope: '범위(업무·관심)', topic: '분야 → 업무주제'
};
const has = (raw, re) => re.test(raw);
// Claude 초안 대응 규칙(L6). 맞는 규칙이 없으면 기본값 + "애매" 표시 → 사용자가 표에서 고친다.
const GUESS = {
  sensitivity: raw => has(raw, /S3|민감|개인/i) ? 'S3' : has(raw, /S2|교섭|전략/i) ? 'S2' : has(raw, /S0|공개/i) ? 'S0' : has(raw, /S1|내부|업무/i) ? 'S1' : null,
  importance: raw => has(raw, /매우|최상|very/i) ? 'very_high' : has(raw, /높|상|high/i) ? 'high' : has(raw, /낮|하|low/i) ? 'low' : has(raw, /중|보통|normal/i) ? 'normal' : null,
  validity: raw => has(raw, /대체/) ? 'superseded' : has(raw, /폐기|무효|철회/) ? 'retired' : has(raw, /이행|완료/) ? 'fulfilled' : has(raw, /확인|검토/) ? 'needs_check' : has(raw, /유효|현재/) ? 'current' : null,
  confidence: raw => has(raw, /높|상|high/i) ? 'high' : has(raw, /낮|하|low/i) ? 'low' : has(raw, /중|보통|medium/i) ? 'medium' : null,
  verification: raw => has(raw, /부분/) ? 'partial' : has(raw, /미확인|미검증|확인\s*안/) ? 'unverified' : has(raw, /확인|검증/) ? 'verified' : null,
  event_status: raw => {
    const [status = '', tracking = ''] = raw.split(' / ');
    if (has(status, /종료|완료|마감|끝/)) return 'closed';
    if (has(status, /보류|중단/)) return 'on_hold';
    if (has(tracking, /^(y|yes|o|예|true|1|추적|계속)/i)) return 'tracking';
    if (has(status, /추적|진행/)) return 'tracking';
    if (has(tracking, /^(n|no|x|아니|false|0)/i) || has(status, /관찰|모니터/)) return 'watching';
    return null;
  },
  decision_type: raw => has(raw, /기각|불채택|반려/) ? 'rejected' : has(raw, /채택|확정|결정/) ? 'adopted' : has(raw, /보류/) ? 'on_hold' : has(raw, /변경|수정/) ? 'changed' : null,
  evidence_type: raw => has(raw, /법|조항|시행령|조례|규정/) ? 'law' : has(raw, /통계|수치|데이터|지표/) ? 'statistics'
    : has(raw, /예산|인건비|재정|비용/) ? 'budget' : has(raw, /합의|협약|단협|협정/) ? 'agreement' : has(raw, /판례|판결|선례|사례/) ? 'precedent'
    : has(raw, /정부|부처|기관\s*입장|국토|기재/) ? 'gov_position' : has(raw, /발언|사측|상대/) ? 'counterpart_statement'
    : has(raw, /현장|실태|조사/) ? 'field_fact' : has(raw, /논거|논리|주장/) ? 'argument' : null,
  commitment_status: raw => has(raw, /불이행|파기|미이행/) ? 'broken' : has(raw, /취소|철회/) ? 'cancelled' : has(raw, /이행|완료/) ? 'fulfilled' : has(raw, /대기|진행|예정|확인중/) ? 'waiting' : null,
  doc_type: raw => has(raw, /회의록/) ? 'minutes' : has(raw, /회의/) ? 'meeting_material' : has(raw, /공문/) ? 'official_letter'
    : has(raw, /성명|보도자료/) ? 'statement' : has(raw, /기사|언론|뉴스/) ? 'news' : has(raw, /법령|법률|시행령/) ? 'law'
    : has(raw, /보고서|정부|기관/) ? 'gov_report' : has(raw, /교섭/) ? 'bargaining' : has(raw, /통화|전사|녹음/) ? 'call_transcript'
    : has(raw, /텔레그램/) ? 'telegram' : has(raw, /메일/) ? 'email' : has(raw, /AI|GPT|대화|Claude/i) ? 'ai_chat' : has(raw, /내부|문서/) ? 'internal_doc' : null,
  processing_status: raw => has(raw, /부분/) ? 'partial' : has(raw, /미처리|대기|전/) ? 'unprocessed' : has(raw, /완료|처리/) ? 'done' : null,
  relation: raw => has(raw, /공동|연대|함께/) ? 'joint' : has(raw, /상대|사측|교섭|정부/) ? 'counterpart' : has(raw, /참고|관찰/) ? 'reference' : has(raw, /직접|소속|당사자|주관/) ? 'direct' : null,
  scope: raw => has(raw, /관심|업무\s*밖|기타\s*정보/) ? 'interest' : has(raw, /업무/) ? 'work' : null
};
// 빈칸일 때 값. null이면 빈칸도 대응표에 나와 사용자가 고른다(필수 칸).
const EMPTY = { sensitivity: 'S1', importance: 'normal', validity: 'current', confidence: '', verification: '', event_status: null,
  decision_type: '', evidence_type: 'other', commitment_status: null, doc_type: 'other', processing_status: 'unprocessed', relation: null, scope: 'work', topic: '' };
const FALLBACK = { sensitivity: 'S1', importance: 'normal', validity: 'needs_check', confidence: '', verification: '', event_status: 'watching',
  decision_type: '', evidence_type: 'other', commitment_status: 'waiting', doc_type: 'other', processing_status: 'unprocessed', relation: 'other', scope: 'work', topic: '' };

export const REASONS = {
  missing_column: '필요한 칸이 없음', missing_id: 'ID 빈칸', bad_id: 'ID 모양이 다름', mixed_prefix: '한 탭 안에서 ID 접두어가 섞임',
  prefix_conflict: '원장 번호표의 접두어와 다름', prefix_shared: '다른 탭과 접두어가 같음', duplicate_id: '같은 ID가 두 번',
  existing_id: '이미 원장에 있는 ID', empty_title: '제목·이름 빈칸', too_long: '글자 수 초과', bad_date: '날짜를 읽을 수 없음',
  bad_value: '고정 목록 밖 값', broken_ref: '없는 ID를 가리킴(깨진 참조)', excluded_ref: '민감으로 제외한 행을 가리킴',
  supersede_mismatch: '유효상태 "대체"와 대체기록이 맞지 않음', missing_counterparty: '약속의 상대측 빈칸', duplicate_web2: '같은 Web2 담당조직에 원장 조직 둘',
  self_link: '자기 자신을 가리킴', duplicate_link: '같은 연결이 두 번', too_many: '행이 너무 많음', bad_file: '파일 모양이 다름',
  s3: '민감도 S3', personal: '개인정보 모양(주민번호·휴대전화)', excluded_link: '민감 제외 행에 걸린 연결(빠짐)',
  id_padded: 'ID 숫자를 4자리로 맞춤', date_unknown: '날짜를 읽지 못해 "모름"으로 두고 원래 표기를 남김', web2_missing: 'Web2 담당조직을 찾지 못해 연결 없이 넣음',
  date_month_start: '날짜가 일 단위가 아니라 그 달·해 첫날로 넣음',
  title_cut: '제목이 길어 앞 300자만 제목으로(전체는 요지에)', source_text_kept: '출처가 ID가 아니라 글자라 비고에 남김',
  source_title_prefix: '출처명이 출처 제목 앞부분과 같아(뒤 괄호만 다름) 그 출처에 연결',
  date_text_kept: '날짜 칸을 읽지 못해 비고에 남김', legacy_id_kept: '옛 쓰기요청 ID 모양이 달라 원래 표기로 보관',
  idx_ref_ignored: '검색인덱스(IDX) 참조는 가져오지 않음(L2)', link_kind_unsupported: '기록이 아닌 행(출처 등)을 가리키는 연결은 담을 칸이 없어 뺌',
  duplicate_link_skipped: '같은 연결이 두 번 — 한 번만 넣음'
};

// ---------- 파일 읽기 ----------
const norm = value => String(value ?? '').replace(/[\s()（）]/g, '').toLowerCase();
const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const oneLine = value => clean(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const noCtrl = value => clean(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// RFC 4180 CSV(따옴표 안 쉼표·줄바꿈·"" 지원). 맨 앞 BOM 제거.
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Google 시트 CSV 내려받기 이름은 "<시트 이름> - <탭 이름>.csv". 탭 이름만 꺼낸다.
export function tabNameFromFile(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const at = base.lastIndexOf(' - ');
  return (at >= 0 ? base.slice(at + 3) : base).trim();
}
export function tabKey(name) {
  const n = norm(name);
  for (const [key, tab] of Object.entries(TABS)) if (tab.names.some(x => norm(x) === n)) return key;
  return null;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlText = s => s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENTITIES[e] ?? m));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

// xlsx(zip) 안의 파일 몇 개만 푼다. 압축은 저장(0)·deflate(8)만(시트 프로그램이 만드는 모양).
async function unzip(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('xlsx 파일이 아닙니다.');
  const count = view.getUint16(end + 10, true); let at = view.getUint32(end + 16, true);
  const out = new Map(); const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('xlsx 목차가 깨졌습니다.');
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, decoder.decode(data));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, decoder.decode(new Uint8Array(await new Response(stream).arrayBuffer())));
    } else throw new Error('xlsx 압축 방식을 읽을 수 없습니다.');
  }
  return out;
}
const columnIndex = ref => { let n = 0; for (const c of ref.replace(/[0-9]/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
export async function readXlsx(bytes) {
  const files = await unzip(bytes, name => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => xmlText([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const rels = new Map([...(files.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)]
    .map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const tabs = [];
  for (const m of (files.get('xl/workbook.xml') || '').matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText(attr(m[0], 'name') || ''), rid = attr(m[0], 'r:id');
    const target = (rels.get(rid) || '').replace(/^\/?(xl\/)?/, '');
    const xml = files.get('xl/' + target);
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const row = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(' ' + c[1], 'r'), type = attr(' ' + c[1], 't');
        const inner = c[2] || '';
        let value = '';
        if (type === 's') value = shared[Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? '';
        else if (type === 'inlineStr') value = xmlText([...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
        else value = xmlText(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        const index = ref ? columnIndex(ref) : row.length;
        while (row.length < index) row.push('');
        row[index] = value;
      }
      rows.push(row);
    }
    tabs.push({ name, rows });
  }
  return tabs;
}

// files: [{name, bytes: Uint8Array}] → {type:'tabs'|'json', tabs?, data?, sha256, source_kind}.
// 지문: 파일 하나면 그 파일 sha256, CSV 여러 개면 "이름\nsha256\n"을 이름순으로 이어 붙인 것의 sha256.
export async function readInputFiles(files) {
  if (!files?.length) throw new Error('파일을 고르세요.');
  const decoder = new TextDecoder();
  const hashes = [];
  for (const f of files) hashes.push({ name: f.name, sha: await sha256Hex(f.bytes) });
  const fingerprint = files.length === 1 ? hashes[0].sha
    : await sha256Hex(new TextEncoder().encode(hashes.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(h => `${h.name}\n${h.sha}\n`).join('')));
  const types = files.map(f => /\.json$/i.test(f.name) ? 'json' : /\.xlsx$/i.test(f.name) ? 'xlsx' : /\.(csv|txt)$/i.test(f.name) ? 'csv' : 'other');
  if (types.includes('other')) throw new Error('CSV·xlsx·가져오기 파일(JSON)만 읽습니다.');
  if (types.includes('json') || types.includes('xlsx')) {
    if (files.length !== 1) throw new Error('xlsx와 가져오기 파일은 한 개씩만 올립니다(CSV는 여러 개 가능).');
    if (types[0] === 'json') {
      let data;
      try { data = JSON.parse(decoder.decode(files[0].bytes)); } catch { throw new Error('가져오기 파일(JSON)을 읽을 수 없습니다.'); }
      return { type: 'json', data, sha256: fingerprint, source_kind: 'claude_file', fileNames: [files[0].name] };
    }
    return { type: 'tabs', tabs: await readXlsx(files[0].bytes), sha256: fingerprint, source_kind: 'sheet_csv', fileNames: [files[0].name] };
  }
  const tabs = files.map(f => ({ name: tabNameFromFile(f.name), rows: parseCSV(decoder.decode(f.bytes)) }));
  return { type: 'tabs', tabs, sha256: fingerprint, source_kind: 'sheet_csv', fileNames: files.map(f => f.name) };
}

// ---------- 값 변환 ----------
const ID_RE = /^([A-Z]{2,6})-?(\d{1,6})$/;
// 시트 ID → 원장 모양(접두어-4~6자리, 4자리 미만만 0 채움). {id, padded} 또는 {error}.
export function normalizeId(raw) {
  const m = String(raw ?? '').trim().toUpperCase().match(ID_RE);
  if (!m) return { error: 'bad_id' };
  const number = String(Number(m[2]));
  const canonical = number.padStart(4, '0');
  if (m[2].length > 4 && m[2] !== number) return { error: 'bad_id' };
  return { id: `${m[1]}-${canonical}`, prefix: m[1], padded: m[2] !== canonical };
}
// 참조는 대문자 접두어 + 하이픈 + 숫자만(SRC-0034, EVT-12). "Web2"·"COVID19"처럼 하이픈 없는 낱말이나 낱말 중간은 ID가 아니다.
const REF_RE = /(?<![A-Za-z0-9])([A-Z]{2,6})-(\d{1,6})(?![0-9A-Za-z])(?:\s*[~∼〜]\s*(?:([A-Z]{2,6})-)?(\d{1,6})(?![0-9A-Za-z]))?/g;
// "SRC-0907~SRC-0909, SRC-0912" → 한 줄씩. 범위는 200개까지.
export function expandRefs(text) {
  const out = []; let bad = false;
  for (const m of String(text ?? '').matchAll(REF_RE)) {
    const prefix = m[1].toUpperCase();
    if (m[4] === undefined) { out.push(normalizeId(prefix + '-' + m[2]).id); continue; }
    if (m[3] && m[3].toUpperCase() !== prefix) { bad = true; continue; }
    const a = Number(m[2]), b = Number(m[4]);
    if (b < a || b - a > 200) { bad = true; continue; }
    for (let n = a; n <= b; n++) out.push(normalizeId(prefix + '-' + n).id);
  }
  return { ids: [...new Set(out.filter(Boolean))], bad, rest: String(text ?? '').replace(REF_RE, '').replace(/[\s,;、/·]+/g, '') };
}

const pad2 = n => String(n).padStart(2, '0');
const realDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 1900 && y <= 2100;
};
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// 한 점(일·월·연)을 읽는다. Excel 날짜 번호(xlsx)도 일로.
function datePoint(raw) {
  // 시각이 붙은 값(2026-09-24 14:30, 2026-09-24T14:30:00)은 날짜만 본다.
  const s = raw.trim().replace(/(?:[T\s]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)$/, '').replace(/\.$/, '');
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/);
  if (m && realDate(+m[1], +m[2], +m[3])) return { precision: 'day', start: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, end: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` };
  m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*월?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && realDate(+m[1], +m[2], 1)) return { precision: 'month', start: `${m[1]}-${pad2(m[2])}-01`, end: `${m[1]}-${pad2(m[2])}-${pad2(lastDay(+m[1], +m[2]))}` };
  m = s.match(/^(\d{4})\s*년?$/);
  if (m && realDate(+m[1], 1, 1)) return { precision: 'year', start: `${m[1]}-01-01`, end: `${m[1]}-12-31` };
  m = s.match(/^(\d{5})(?:\.\d+)?$/);
  if (m) {
    const t = new Date(Date.UTC(1899, 11, 30) + Number(m[1]) * 86400000);
    const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, d = t.getUTCDate();
    if (realDate(y, mo, d)) return { precision: 'day', start: `${y}-${pad2(mo)}-${pad2(d)}`, end: `${y}-${pad2(mo)}-${pad2(d)}` };
  }
  return null;
}
// 기준일 정밀도 변환: 일 / 월(1일) / 연(1월 1일) / 기간(시작<끝) / 모름. 일이 아니면 원래 표기를 date_note에.
export function parseLedgerDate(raw) {
  const text = oneLine(raw);
  if (!text) return { date_start: null, date_end: null, date_precision: 'unknown', date_note: '' };
  if (text.length > 200) return { error: 'too_long' };
  const point = datePoint(text);
  if (point) return { date_start: point.start, date_end: null, date_precision: point.precision, date_note: point.precision === 'day' ? '' : text };
  const range = text.split(/\s*[~∼〜]\s*/);
  if (range.length === 2) {
    const a = datePoint(range[0]), b = datePoint(range[1]);
    if (a && b) {
      if (b.end < a.start) return { error: 'bad_date' };
      if (a.start === b.end) return { date_start: a.start, date_end: null, date_precision: 'day', date_note: text };
      return { date_start: a.start, date_end: b.end, date_precision: 'range', date_note: text };
    }
  }
  // 날짜 모양인데 달력에 없는 날(2026-02-30)은 거부. 그 밖의 글(○○ 이전 등)은 모름 + 원래 표기.
  if (/^\d{4}\s*[-./년]\s*\d{1,2}(\s*[-./월]\s*\d{1,2})?\s*일?\.?$/.test(text) || range.length === 2 && range.every(x => /^\d{4}/.test(x))) return { error: 'bad_date' };
  return { date_start: null, date_end: null, date_precision: 'unknown', date_note: text, warning: 'date_unknown' };
}
// 날짜 하나만 받는 칸(출처 날짜·후속확인일): 일. 월·연이면 첫날 + 알림. 못 읽으면 거부.
export function parseDay(raw) {
  const text = oneLine(raw);
  if (!text) return { date: null };
  const point = datePoint(text);
  if (!point) return { error: 'bad_date' };
  return { date: point.start, warning: point.precision === 'day' ? null : 'date_month_start' };
}
function occurredAt(raw) {
  const text = oneLine(raw);
  const m = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m || !realDate(+m[1], +m[2], +m[3])) return null;
  return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}T${pad2(m[4] || 0)}:${m[5] || '00'}:00+09:00`;
}

const PERSONAL = [/(?<!\d)\d{6}\s?-\s?[1-4]\d{6}(?!\d)/, /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/];
export const looksPersonal = text => PERSONAL.some(re => re.test(String(text ?? '')));
const splitAliases = raw => [...new Set(clean(raw).split(/[,;、/\n]+/).map(oneLine).filter(Boolean))];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- 탭 → 표 ----------
function headerMap(key, header) {
  const columns = COLUMNS[key];
  const used = new Set(); const fields = {}; const matched = []; const dropped = [];
  const normalized = header.map(norm);
  for (const [field, aliases] of Object.entries(columns)) {
    for (const alias of aliases) {
      const at = normalized.findIndex((h, i) => h && !used.has(i) && h === norm(alias));
      if (at < 0) continue;
      used.add(at);
      if (field === 'drop') { dropped.push(header[at]); continue; }
      fields[field] = at; matched.push({ header: header[at], field });
      if (field !== 'drop') break;
    }
  }
  const unknown = header.filter((h, i) => clean(h) && !used.has(i));
  const missing = REQUIRED[key].filter(f => fields[f] === undefined);
  return { fields, matched, dropped, unknown, missing };
}

function mappingKeyOf(field, row, get) {
  if (field === 'event_status') { const s = oneLine(get('status')), t = oneLine(get('tracking')); return s || t ? `${s} / ${t}` : ''; }
  return oneLine(get(field));
}

// 참조 칸 → ID 목록. 검색인덱스(IDX-…)는 가져오지 않으므로(L2) 빼고 알림만 남긴다.
function refsOf(text, issues, tab, id) {
  const refs = expandRefs(text);
  const kept = refs.ids.filter(x => !x.startsWith('IDX-'));
  const idx = kept.length !== refs.ids.length;
  if (idx) issues.push({ level: 'warning', reason: 'idx_ref_ignored', tab, id: String(id).slice(0, 60) });
  return { ...refs, ids: kept, idx };
}

// 시트 탭(행 배열) → 가져오기 파일 모양(canonical) + 탭별 행 정보. 고정 목록 값은 mapping(사용자가 고친 대응표)으로 바꾼다.
export function sheetToCanonical(input, mapping) {
  const tabs = []; const skipped = []; const unknownTabs = []; const issues = [];
  const out = { format: FORMAT, version: VERSION, kind: 'sheet', topics: [], organizations: [], sources: [], records: [], record_sources: [], links: [], legacy_write_requests: [] };
  const seenTabs = new Set();
  const byKey = new Map();
  for (const tab of input.tabs) {
    const key = tabKey(tab.name);
    if (!key) {
      const skip = Object.entries(SKIPPED_TABS).find(([n]) => norm(n) === norm(tab.name));
      (skip ? skipped : unknownTabs).push(skip ? { name: tab.name, decision: skip[1] } : { name: tab.name });
      continue;
    }
    if (seenTabs.has(key)) { issues.push({ level: 'error', reason: 'bad_file', tab: key, id: `${TABS[key].label} 탭이 두 번` }); continue; }
    seenTabs.add(key); byKey.set(key, tab);
  }
  // 대응표 값: 사용자가 고른 값 → 없으면 규칙 추측 → 없으면 빈칸 값/기본값.
  const pick = (field, raw) => {
    const chosen = mapping?.[field]?.[raw];
    if (chosen !== undefined) return chosen;
    if (!raw) return EMPTY[field] ?? FALLBACK[field];
    return (field === 'topic' ? null : GUESS[field]?.(raw)) ?? FALLBACK[field];
  };
  const textBy = new Map();
  const sourceTitles = [];
  for (const key of TAB_ORDER) {
    const tab = byKey.get(key);
    if (!tab) continue;
    const rows = tab.rows.map(r => r.map(c => String(c ?? '')));
    const headerAt = rows.findIndex(r => r.some(c => clean(c)));
    const header = headerAt >= 0 ? rows[headerAt] : [];
    const info = { key, label: TABS[key].label, name: tab.name, sheetRows: 0, blankRows: 0, ...headerMap(key, header), rows: [] };
    tabs.push(info);
    if (info.missing.length) {
      issues.push({ level: 'error', reason: 'missing_column', tab: key, id: info.missing.join(', ') });
      for (const r of rows.slice(headerAt + 1)) { if (r.some(c => clean(c))) { info.sheetRows++; info.rows.push({ rejected: true }); } else info.blankRows++; }
      continue;
    }
    for (const [index, r] of rows.slice(headerAt + 1).entries()) {
      if (!r.some(c => clean(c))) { info.blankRows++; continue; }
      info.sheetRows++;
      const rowNo = headerAt + 2 + index;
      const get = field => info.fields[field] === undefined ? '' : (r[info.fields[field]] ?? '');
      const personal = r.some(looksPersonal);
      const meta = { _tab: key, _row: rowNo, ...(personal ? { _personal: true } : {}) };
      const row = { key, rowNo };
      info.rows.push(row);
      const idRaw = get('id');
      const rawId = oneLine(idRaw);
      const idCheck = rawId ? normalizeId(rawId) : { error: 'missing_id' };
      if (key !== 'org_link' && key !== 'write_request') {
        if (idCheck.error) { issues.push({ level: 'error', reason: idCheck.error, tab: key, id: rawId || `${rowNo}행`, row: rowNo }); row.rejected = true; continue; }
        if (idCheck.padded) issues.push({ level: 'warning', reason: 'id_padded', tab: key, id: idCheck.id });
      }
      const id = idCheck.id;
      if (key === 'topic') {
        out.topics.push({ ...meta, ledger_id: id, name: oneLine(get('name')), aliases: splitAliases(get('aliases')), description: noCtrl(get('description')), status: 'active', sort_order: out.topics.length });
        textBy.set('topic:' + norm(get('name')), id);
      } else if (key === 'organization') {
        const web2 = oneLine(get('web2'));
        out.organizations.push({ ...meta, ledger_id: id, name: oneLine(get('name')), aliases: splitAliases(get('aliases')), suborganization_id: web2 || null, note: noCtrl(get('note')), status: 'active' });
      } else if (key === 'source') {
        const day = parseDay(get('date'));
        if (day.error) { issues.push({ level: 'error', reason: day.error, tab: key, id, row: rowNo }); row.rejected = true; continue; }
        if (day.warning) issues.push({ level: 'warning', reason: day.warning, tab: key, id });
        const sens = pick('sensitivity', oneLine(get('sensitivity')));
        out.sources.push({ ...meta, ledger_id: id, title: oneLine(get('title')), doc_type: pick('doc_type', oneLine(get('doc_type'))), location: oneLine(get('location')),
          drive_file_id: oneLine(get('drive_file_id')) || null, source_date: day.date, coverage: noCtrl(get('coverage')),
          processing_status: pick('processing_status', oneLine(get('processing_status'))), sensitivity: sens, note: noCtrl(get('note')), status: 'active' });
        textBy.set('source:' + norm(get('title')), id);
        sourceTitles.push([oneLine(get('title')), id]);
      } else if (TABS[key].scope && KINDS.includes(TABS[key].scope)) {
        const kind = key;
        const date = parseLedgerDate(get('date'));
        if (date.error) { issues.push({ level: 'error', reason: date.error, tab: key, id, row: rowNo }); row.rejected = true; continue; }
        if (date.warning) issues.push({ level: 'warning', reason: date.warning, tab: key, id });
        // 제목이 길면(결정내용·새로 확인된 것 등) 앞부분만 제목으로, 전체는 요지에.
        let title = oneLine(get('title')), summary = noCtrl(get('summary'));
        if (title.length > 300) {
          if (!summary) summary = noCtrl(get('title'));
          title = title.slice(0, 299) + '…';
          issues.push({ level: 'warning', reason: 'title_cut', tab: key, id });
        }
        // 담을 칸이 따로 없는 시트 칸은 "이름: 값" 줄로 비고에 모은다(내용을 버리지 않음).
        const extra = [];
        const keep = (label, field) => { const v = oneLine(get(field)); if (v) extra.push(`${label}: ${v}`); };
        if (kind === 'change') {
          const prev = oneLine(get('prev_state')), next = oneLine(get('new_state'));
          if (prev || next) extra.push(`상태 변화: ${prev || '-'} → ${next || '-'}`);
          keep('출처유형', 'source_type'); keep('출처URL', 'source_url');
        }
        if (kind === 'decision') { keep('회의명', 'meeting'); keep('결정주체', 'actor'); keep('후속조치 요지', 'follow'); keep('관련조직', 'related_org'); keep('Web2연결ID', 'web2'); keep('태그', 'tags'); }
        if (kind === 'commitment') { keep('주체유형', 'actor_type'); keep('기한·조건', 'condition'); keep('GoogleTaskID', 'google'); keep('상태근거ID', 'status_basis'); }
        const rec = { ...meta, kind, ledger_id: id, title, summary: summary.slice(0, 4000), scope: pick('scope', oneLine(get('scope'))),
          topic: pick('topic', oneLine(get('topic'))) || null, sensitivity: pick('sensitivity', oneLine(get('sensitivity'))),
          importance: pick('importance', oneLine(get('importance'))), validity: pick('validity', oneLine(get('validity'))),
          confidence: pick('confidence', oneLine(get('confidence'))) || null, verification: pick('verification', oneLine(get('verification'))) || null,
          date_start: date.date_start, date_end: date.date_end, date_precision: date.date_precision, date_note: date.date_note,
          event_status: null, decision_type: null, decision_reason: null, evidence_type: null, counterparty: null, commitment_status: null, follow_up_on: null,
          superseded_by: null, supersede_reason: oneLine(get('supersede_reason')) || null, note: noCtrl(get('note')) };
        const sup = oneLine(get('superseded_by'));
        if (sup) {
          const n = normalizeId(sup);
          if (n.error) { issues.push({ level: 'error', reason: 'broken_ref', tab: key, id: `${id} 대체기록 "${sup.slice(0, 30)}" — ID 모양이 아님`, row: rowNo }); row.rejected = true; continue; }
          rec.superseded_by = n.id;
        }
        if (kind === 'event') rec.event_status = pick('event_status', mappingKeyOf('event_status', r, get));
        if (kind === 'decision') { rec.decision_type = pick('decision_type', oneLine(get('decision_type'))) || null; rec.decision_reason = noCtrl(get('decision_reason')) || null; }
        if (kind === 'evidence') rec.evidence_type = pick('evidence_type', oneLine(get('evidence_type'))) || null;
        if (kind === 'commitment') {
          // 후속확인일을 날짜로 못 읽으면 비우고 원래 글자를 비고에(거부하지 않음).
          const follow = parseDay(get('follow_up_on'));
          if (follow.error) { extra.push(`후속확인일: ${oneLine(get('follow_up_on'))}`); issues.push({ level: 'warning', reason: 'date_text_kept', tab: key, id }); }
          else if (follow.warning) issues.push({ level: 'warning', reason: follow.warning, tab: key, id });
          rec.counterparty = oneLine(get('counterparty')).slice(0, 200) || null;
          rec.commitment_status = pick('commitment_status', oneLine(get('commitment_status')));
          rec.follow_up_on = follow.date || null;
        }
        // 출처 칸: ID(범위 포함)로 풀고, ID가 없으면 출처 제목과 정확히 같은 것. 그래도 없으면 글자를 비고에 남김(알림).
        const locator = oneLine(get('locator')).slice(0, 500);
        const srcCells = [['출처', clean(get('sources'))], ['출처명', kind === 'change' ? clean(get('source_name')) : '']].filter(([, v]) => v);
        for (const [label, srcText] of srcCells) {
          let refs = refsOf(srcText, issues, key, id);
          // 출처명 칸은 칸 전체가 ID 목록일 때만 ID로 본다(자유 글 속 낱말을 ID로 읽지 않음).
          if (label === '출처명' && refs.ids.length && refs.rest) refs = { ids: [], bad: false, idx: false, rest: refs.rest };
          let ids = refs.ids;
          if (!ids.length && !refs.idx) {
            const byTitle = textBy.get('source:' + norm(srcText));
            if (byTitle) ids = [byTitle];
            else {
              // 출처 제목 = 출처명 + 뒤 괄호 꼬리 하나(예: "… (2026-09-22 입력)")이고 그런 출처가 하나뿐이면 연결.
              const name = oneLine(srcText);
              const hits = sourceTitles.filter(([t]) => t.startsWith(name) && /^\s*[(（][^()（）]*[)）]$/.test(t.slice(name.length)));
              if (name && hits.length === 1) { ids = [hits[0][1]]; issues.push({ level: 'warning', reason: 'source_title_prefix', tab: key, id: `${id} → ${hits[0][1]}` }); }
            }
          }
          if (refs.bad) { issues.push({ level: 'error', reason: 'broken_ref', tab: key, id: `${id} 출처 "${oneLine(srcText).slice(0, 40)}" — 범위를 읽을 수 없음`, row: rowNo }); row.rejected = true; break; }
          if (!ids.length) {
            if (!refs.idx) { extra.push(`${label}: ${oneLine(srcText)}`); issues.push({ level: 'warning', reason: 'source_text_kept', tab: key, id }); }
            continue;
          }
          for (const source of ids) out.record_sources.push({ ...meta, record: id, source, locator, note: '' });
        }
        if (row.rejected) { out.record_sources = out.record_sources.filter(x => x.record !== id || x._tab !== key); continue; }
        if (kind === 'change') {
          const ev = oneLine(get('event'));
          if (ev) {
            const refs = expandRefs(ev);
            if (refs.bad || refs.ids.length !== 1) { issues.push({ level: 'error', reason: 'broken_ref', tab: key, id: `${id} 사건ID "${ev.slice(0, 40)}" — 사건 ID 하나여야 함`, row: rowNo }); row.rejected = true; out.record_sources = out.record_sources.filter(x => x.record !== id || x._tab !== key); continue; }
            out.links.push({ ...meta, record: id, target_record: refs.ids[0], target_organization: null, relation: 'belongs_to', note: '' });
          }
        }
        if (kind === 'commitment') {
          for (const target of refsOf(get('related'), issues, key, id).ids) if (target !== id) out.links.push({ ...meta, record: id, target_record: target, target_organization: null, relation: 'related', note: '' });
        }
        if (extra.length) rec.note = [rec.note, ...extra].filter(Boolean).join('\n').slice(0, 4000);
        out.records.push(rec);
      } else if (key === 'org_link') {
        const recText = oneLine(get('record')), orgText = oneLine(get('organization'));
        const rec = refsOf(recText, issues, key, recText), org = expandRefs(orgText);
        if (rec.bad || org.bad || !rec.ids.length || org.ids.length !== 1) {
          if (rec.idx && !rec.ids.length) { row.excludedIdx = true; issues.push({ level: 'excluded', reason: 'idx_ref_ignored', tab: key, id: recText.slice(0, 40), row: rowNo }); continue; }
          const what = !rec.ids.length || rec.bad ? `기록ID "${recText.slice(0, 30)}"` : `조직ID "${orgText.slice(0, 30)}"`;
          issues.push({ level: 'error', reason: 'broken_ref', tab: key, id: `${recText.slice(0, 20)} → ${orgText.slice(0, 20)} — ${what}를 ID로 읽을 수 없음`, row: rowNo });
          row.rejected = true; continue;
        }
        const extra = [];
        for (const [label, field] of [['기준일', 'date'], ['활성여부', 'active'], ['출처ID', 'sources']]) { const v = oneLine(get(field)); if (v) extra.push(`${label}: ${v}`); }
        const note = [noCtrl(get('note')), ...extra].filter(Boolean).join(' / ').slice(0, 500);
        for (const target of rec.ids) out.links.push({ ...meta, record: target, target_record: null, target_organization: org.ids[0], relation: pick('relation', oneLine(get('relation'))), note });
      } else if (key === 'write_request') {
        // 옛 ID는 REQ-0001 모양이면 그대로, 다른 모양(REQ-20260924…)이면 원래 표기를 detail에 보관한다(L7, 감사 기록은 번호를 새로 받지 않음).
        if (!rawId) { issues.push({ level: 'error', reason: 'missing_id', tab: key, id: `${rowNo}행`, row: rowNo }); row.rejected = true; continue; }
        const legacy = rawId.toUpperCase();
        const shaped = /^[A-Z]{2,6}-[0-9]{1,6}$/.test(legacy);
        if (!shaped) issues.push({ level: 'warning', reason: 'legacy_id_kept', tab: key, id: rawId.slice(0, 60) });
        const detail = {};
        for (const [field, name] of [['status', 'status'], ['date', 'date'], ['type', 'type'], ['summary', 'summary'], ['origin', 'origin'], ['target_type', 'target_type'],
          ['targets', 'targets'], ['dedup', 'dedup_key'], ['sources', 'sources'], ['processed', 'processed_at'], ['results', 'results'], ['error', 'error'], ['note', 'note']]) {
          const v = noCtrl(get(field)).slice(0, 2000);
          if (v || ['status', 'date', 'type', 'summary'].includes(field)) detail[name] = v;
        }
        if (/IDX-?\d/i.test(`${get('targets')} ${get('results')}`)) issues.push({ level: 'warning', reason: 'idx_ref_ignored', tab: key, id: rawId.slice(0, 60) });
        if (!shaped) detail.legacy_id_original = rawId.slice(0, 200);
        out.legacy_write_requests.push({ ...meta, legacy_id: shaped ? legacy : null, occurred_at: occurredAt(get('date')), detail });
      }
    }
  }
  return { canonical: out, tabs, skipped, unknownTabs, issues };
}

// 대응표: 필드마다 시트에 나온 값(빈칸 포함)과 고른 값. 사용자가 고치면 analyze를 다시 부른다.
export function buildMapping(input, overrides = {}, topicOptions = []) {
  const fields = {};
  const add = (field, raw) => {
    const slot = fields[field] ||= new Map();
    const entry = slot.get(raw) || { raw, count: 0 };
    entry.count++; slot.set(raw, entry);
  };
  for (const tab of input.tabs) {
    const key = tabKey(tab.name);
    if (!key) continue;
    const rows = tab.rows.map(r => r.map(c => String(c ?? '')));
    const headerAt = rows.findIndex(r => r.some(c => clean(c)));
    if (headerAt < 0) continue;
    const { fields: at } = headerMap(key, rows[headerAt]);
    for (const r of rows.slice(headerAt + 1)) {
      if (!r.some(c => clean(c))) continue;
      const get = f => at[f] === undefined ? '' : (r[at[f]] ?? '');
      const present = f => at[f] !== undefined;
      const scope = TABS[key].scope;
      if (KINDS.includes(scope)) {
        for (const f of ['sensitivity', 'importance', 'validity', 'confidence', 'verification', 'scope', 'topic']) if (present(f)) add(f, oneLine(get(f)));
        if (key === 'event') add('event_status', mappingKeyOf('event_status', r, get));
        if (key === 'decision' && present('decision_type')) add('decision_type', oneLine(get('decision_type')));
        if (key === 'evidence' && present('evidence_type')) add('evidence_type', oneLine(get('evidence_type')));
        if (key === 'commitment') add('commitment_status', oneLine(get('commitment_status')));
      } else if (key === 'source') {
        for (const f of ['doc_type', 'processing_status', 'sensitivity']) if (present(f)) add(f, oneLine(get(f)));
      } else if (key === 'org_link') add('relation', oneLine(get('relation')));
    }
  }
  const result = {};
  for (const [field, slot] of Object.entries(fields)) {
    const options = field === 'topic' ? [['', '(주제 없음)'], ...topicOptions.map(t => [t.ledger_id, `${t.ledger_id} ${t.name}`])] : FIXED[field];
    const values = [...slot.values()].sort((a, b) => b.count - a.count || (a.raw < b.raw ? -1 : 1)).map(entry => {
      const guess = !entry.raw ? (EMPTY[field] ?? null) : field === 'topic' ? guessTopic(entry.raw, topicOptions) : (GUESS[field]?.(entry.raw) ?? null);
      const chosen = overrides[field]?.[entry.raw];
      const value = chosen !== undefined ? chosen : (guess ?? FALLBACK[field]);
      return { raw: entry.raw, count: entry.count, value, guessed: chosen === undefined, ambiguous: chosen === undefined && guess === null && (!!entry.raw || EMPTY[field] === null) };
    });
    // 빈칸만 있고 빈칸 값이 정해져 있으면(선택 칸) 표에 내지 않는다.
    if (values.every(v => !v.raw && EMPTY[field] != null)) continue;
    result[field] = { label: MAP_LABELS[field], options, values };
  }
  return result;
}
function guessTopic(raw, topics) {
  const n = norm(raw);
  const hit = topics.find(t => norm(t.name) === n || (t.aliases || []).some(a => norm(a) === n) || norm(t.ledger_id) === n);
  return hit ? hit.ledger_id : null;
}
export const mappingValues = mapping => Object.fromEntries(Object.entries(mapping).map(([f, m]) => [f, Object.fromEntries(m.values.map(v => [v.raw, v.value]))]));

// ---------- 묶음 검사(시트에서 바꾼 것과 Claude 가져오기 파일 공통) ----------
const LIMITS = {
  title: 300, summary: 4000, note: 4000, name_topic: 80, name_org: 120, description: 500, location: 2000, coverage: 1000, source_note: 2000,
  org_note: 2000, locator: 500, link_note: 500, date_note: 200, counterparty: 200, decision_reason: 2000, supersede_reason: 1000
};
const values = field => FIXED[field].map(([v]) => v).filter(Boolean);
const inList = (field, v, optional) => (optional && (v === null || v === undefined || v === '')) || values(field).includes(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && realDate(+v.slice(0, 4), +v.slice(5, 7), +v.slice(8, 10));

// ctx: {prefixes:{scope:prefix}(DB 번호표), existing:{records,sources,organizations,topics: Set(ID)}, suborganizations: Set(uuid)}
export function validateCanonical(file, ctx = {}, carried = []) {
  const issues = [...carried];
  const push = (level, reason, table, id, extra = {}) => issues.push({ level, reason, table, tab: extra.tab, id, row: extra.row });
  const existing = ctx.existing || {};
  const tables = ['topics', 'organizations', 'sources', 'records', 'record_sources', 'links', 'legacy_write_requests'];
  for (const t of tables) {
    if (file[t] !== undefined && !Array.isArray(file[t])) { push('error', 'bad_file', t, t); file[t] = []; }
    file[t] = (file[t] || []).filter(r => r && typeof r === 'object' && !Array.isArray(r) || (push('error', 'bad_file', t, t), false));
    if (file[t].length > MAX_ROWS) push('error', 'too_many', t, `${t} ${file[t].length}`);
  }
  const tabOf = (table, row) => row._tab || ({ topics: 'topic', organizations: 'organization', sources: 'source', record_sources: 'evidence', legacy_write_requests: 'write_request' }[table]
    || (table === 'records' ? row.kind : table === 'links' ? (row.target_organization ? 'org_link' : 'change') : table));
  const where = (table, row) => ({ tab: tabOf(table, row), row: row._row });

  // 1) 민감 제외(S3·개인정보 모양): 행을 빼고 개수만 남긴다(L9).
  const excluded = { records: new Set(), sources: new Set(), organizations: new Set(), topics: new Set() };
  const kept = {};
  for (const t of ['topics', 'organizations', 'sources', 'records']) {
    kept[t] = [];
    for (const row of file[t]) {
      const text = Object.entries(row).filter(([k]) => !k.startsWith('_')).map(([, v]) => Array.isArray(v) ? v.join(' ') : String(v ?? '')).join('\n');
      if (row.sensitivity === 'S3') { push('excluded', 's3', t, row.ledger_id, where(t, row)); excluded[t].add(row.ledger_id); continue; }
      if (row._personal || looksPersonal(text)) { push('excluded', 'personal', t, row.ledger_id, where(t, row)); excluded[t].add(row.ledger_id); continue; }
      kept[t].push(row);
    }
  }
  const legacy = [];
  for (const row of file.legacy_write_requests) {
    if (row._personal || looksPersonal(JSON.stringify(row.detail ?? {}))) { push('excluded', 'personal', 'legacy_write_requests', row.legacy_id, where('legacy_write_requests', row)); continue; }
    legacy.push(row);
  }

  // 2) ID: 모양·접두어(탭마다 하나, 번호표와 같음, 탭끼리 다름)·중복·이미 원장에 있음.
  const prefixes = {};
  const ids = { records: new Set(), sources: new Set(), organizations: new Set(), topics: new Set() };
  const bad = new Set();
  const scopeOf = (t, row) => t === 'records' ? row.kind : { topics: 'topic', organizations: 'organization', sources: 'source' }[t];
  for (const t of ['topics', 'organizations', 'sources', 'records']) {
    for (const row of kept[t]) {
      const scope = scopeOf(t, row);
      if (t === 'records' && !KINDS.includes(row.kind)) { push('error', 'bad_value', t, `${row.ledger_id ?? '?'} kind`, where(t, row)); bad.add(row); continue; }
      const n = typeof row.ledger_id === 'string' ? normalizeId(row.ledger_id) : { error: 'missing_id' };
      if (n.error || n.id !== row.ledger_id) { push('error', n.error || 'bad_id', t, String(row.ledger_id ?? ''), where(t, row)); bad.add(row); continue; }
      const seen = prefixes[scope] ||= new Map();
      seen.set(n.prefix, (seen.get(n.prefix) || 0) + 1);
      if (ids[t].has(row.ledger_id)) { push('error', 'duplicate_id', t, row.ledger_id, where(t, row)); bad.add(row); continue; }
      ids[t].add(row.ledger_id);
      if (existing[t]?.has?.(row.ledger_id)) { push('error', 'existing_id', t, row.ledger_id, where(t, row)); bad.add(row); }
    }
  }
  const idPrefixes = {};
  for (const [scope, seen] of Object.entries(prefixes)) {
    const [main] = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    if (seen.size > 1) push('error', 'mixed_prefix', null, `${scope}: ${[...seen.keys()].join(', ')}`, { tab: scope === 'topic' ? 'topic' : scope });
    idPrefixes[scope] = main[0];
    if (ctx.prefixes?.[scope] && ctx.prefixes[scope] !== main[0]) push('error', 'prefix_conflict', null, `${scope}: ${main[0]} ≠ ${ctx.prefixes[scope]}`, { tab: scope });
  }
  const owners = new Map();
  for (const [scope, prefix] of Object.entries({ ...ctx.prefixes, ...idPrefixes })) {
    if (owners.has(prefix) && owners.get(prefix) !== scope) push('error', 'prefix_shared', null, `${prefix}: ${owners.get(prefix)}·${scope}`, { tab: scope });
    owners.set(prefix, scope);
  }
  if (file.id_prefixes && typeof file.id_prefixes === 'object') {
    for (const [scope, prefix] of Object.entries(file.id_prefixes)) {
      if (!SCOPES.includes(scope) || !/^[A-Z]{2,6}$/.test(String(prefix))) push('error', 'bad_file', null, `id_prefixes ${scope}`);
      else if (idPrefixes[scope] && idPrefixes[scope] !== prefix) push('error', 'mixed_prefix', null, `${scope}: ${idPrefixes[scope]} ≠ ${prefix}`, { tab: scope });
      else idPrefixes[scope] = prefix;
    }
  }
  const known = t => id => ids[t].has(id) || existing[t]?.has?.(id);

  // 3) 행 내용: 고정 목록·길이·날짜·종류별 칸.
  const tooLong = (v, max) => typeof v === 'string' && v.length > max;
  const text = v => v === null || v === undefined || typeof v === 'string';
  const rowError = (t, row, reason, id = row.ledger_id) => { push('error', reason, t, id, where(t, row)); bad.add(row); };
  const web2Seen = new Map();
  for (const row of kept.topics) {
    if (!row.name || !oneLine(row.name)) rowError('topics', row, 'empty_title');
    else if (tooLong(row.name, LIMITS.name_topic) || tooLong(row.description, LIMITS.description) || !aliasesOk(row.aliases)) rowError('topics', row, 'too_long');
    else if (row.status !== undefined && !['active', 'retired'].includes(row.status)) rowError('topics', row, 'bad_value');
  }
  const topicNames = new Set();
  for (const row of kept.topics) { if (topicNames.has(row.name)) rowError('topics', row, 'duplicate_id', `${row.ledger_id} 이름 ${row.name}`); topicNames.add(row.name); }
  for (const row of kept.organizations) {
    if (!row.name || !oneLine(row.name)) rowError('organizations', row, 'empty_title');
    else if (tooLong(row.name, LIMITS.name_org) || tooLong(row.note, LIMITS.org_note) || !aliasesOk(row.aliases)) rowError('organizations', row, 'too_long');
    if (row.suborganization_id) {
      if (!UUID_RE.test(row.suborganization_id) || (ctx.suborganizations && !ctx.suborganizations.has(row.suborganization_id))) {
        push('warning', 'web2_missing', 'organizations', `${row.ledger_id} → ${String(row.suborganization_id).slice(0, 40)}`, where('organizations', row));
        row.suborganization_id = null;
      } else if (web2Seen.has(row.suborganization_id) || ctx.linkedSuborganizations?.has?.(row.suborganization_id)) rowError('organizations', row, 'duplicate_web2');
      else web2Seen.set(row.suborganization_id, row.ledger_id);
    }
  }
  for (const row of kept.sources) {
    if (!row.title || !oneLine(row.title)) rowError('sources', row, 'empty_title');
    else if (tooLong(row.title, LIMITS.title) || tooLong(row.location, LIMITS.location) || tooLong(row.coverage, LIMITS.coverage) || tooLong(row.note, LIMITS.source_note)) rowError('sources', row, 'too_long');
    else if (!inList('doc_type', row.doc_type ?? 'other') || !inList('processing_status', row.processing_status ?? 'unprocessed')
      || !['S0', 'S1', 'S2'].includes(row.sensitivity ?? 'S1') || (row.drive_file_id && !/^[A-Za-z0-9_-]{10,200}$/.test(row.drive_file_id))
      || (row.source_date && !isDate(row.source_date)) || !['active', 'retired', undefined].includes(row.status)) rowError('sources', row, 'bad_value');
  }
  for (const row of kept.records) {
    if (bad.has(row)) continue;
    const fail = reason => rowError('records', row, reason);
    if (!row.title || !oneLine(row.title)) { fail('empty_title'); continue; }
    if (![row.title, row.summary, row.note, row.date_note, row.counterparty, row.decision_reason, row.supersede_reason].every(text)) { fail('bad_value'); continue; }
    if (tooLong(row.title, LIMITS.title) || tooLong(row.summary, LIMITS.summary) || tooLong(row.note, LIMITS.note) || tooLong(row.date_note, LIMITS.date_note)
      || tooLong(row.counterparty, LIMITS.counterparty) || tooLong(row.decision_reason, LIMITS.decision_reason) || tooLong(row.supersede_reason, LIMITS.supersede_reason)) { fail('too_long'); continue; }
    if (!inList('scope', row.scope ?? 'work') || !['S0', 'S1', 'S2'].includes(row.sensitivity ?? 'S1') || !inList('importance', row.importance ?? 'normal')
      || !inList('validity', row.validity ?? 'current') || !inList('confidence', row.confidence, true) || !inList('verification', row.verification, true)) { fail('bad_value'); continue; }
    if (!dateOk(row)) { fail('bad_date'); continue; }
    const k = row.kind;
    if ((k === 'event') !== !!row.event_status || (row.event_status && !inList('event_status', row.event_status))) { fail('bad_value'); continue; }
    if ((k !== 'decision' && (row.decision_type || row.decision_reason)) || !inList('decision_type', row.decision_type, true)) { fail('bad_value'); continue; }
    if ((k !== 'evidence' && row.evidence_type) || !inList('evidence_type', row.evidence_type, true)) { fail('bad_value'); continue; }
    if (k === 'commitment' && !row.counterparty) { fail('missing_counterparty'); continue; }
    if ((k === 'commitment') !== !!row.commitment_status || (row.commitment_status && !inList('commitment_status', row.commitment_status))
      || (k !== 'commitment' && (row.counterparty || row.follow_up_on)) || (row.follow_up_on && !isDate(row.follow_up_on))) { fail('bad_value'); continue; }
    if ((row.validity === 'superseded') !== !!row.superseded_by) { fail('supersede_mismatch'); continue; }
    if (row.superseded_by && row.superseded_by === row.ledger_id) { fail('self_link'); continue; }
    if (row.superseded_by) {
      if (excluded.records.has(row.superseded_by)) { push('error', 'excluded_ref', 'records', `${row.ledger_id} → ${row.superseded_by}`, where('records', row)); bad.add(row); continue; }
      if (!known('records')(row.superseded_by)) { push('error', 'broken_ref', 'records', `${row.ledger_id} 대체기록 → ${row.superseded_by} (없는 ID: ${row.superseded_by})`, where('records', row)); bad.add(row); continue; }
    }
    if (row.topic) {
      if (excluded.topics.has(row.topic)) { push('error', 'excluded_ref', 'records', `${row.ledger_id} → ${row.topic}`, where('records', row)); bad.add(row); continue; }
      if (!known('topics')(row.topic)) { push('error', 'broken_ref', 'records', `${row.ledger_id} 주제 → ${row.topic} (없는 ID: ${row.topic})`, where('records', row)); bad.add(row); continue; }
    }
  }
  // 대체 관계 순환(A→B→A)은 DB가 넣을 순서를 찾지 못하므로 미리 거부.
  const supMap = new Map(kept.records.filter(r => r.superseded_by).map(r => [r.ledger_id, r.superseded_by]));
  for (const start of supMap.keys()) {
    const seen = new Set([start]); let at = supMap.get(start);
    while (at && supMap.has(at)) { if (seen.has(at)) { const row = kept.records.find(r => r.ledger_id === start); if (!bad.has(row)) { push('error', 'broken_ref', 'records', `${start} 대체 순환`, where('records', row)); bad.add(row); } break; } seen.add(at); at = supMap.get(at); }
  }

  // 4) 연결: 깨진 참조는 거부, 민감 제외 행에 걸린 연결은 빠짐(개수만).
  const recordSources = []; const links = [];
  const rsSeen = new Set();
  for (const row of file.record_sources) {
    const w = where('record_sources', row);
    if (excluded.records.has(row.record) || excluded.sources.has(row.source)) { push('excluded', 'excluded_link', 'record_sources', `${row.record} → ${row.source}`, { ...w, link: true }); continue; }
    if (!known('records')(row.record) || !known('sources')(row.source)) {
      const missing = [!known('records')(row.record) && row.record, !known('sources')(row.source) && row.source].filter(Boolean).join(', ');
      push('error', 'broken_ref', 'record_sources', `${row.record} → ${row.source} (없는 ID: ${missing})`, { ...w, link: true }); continue;
    }
    if (tooLong(row.locator, LIMITS.locator) || tooLong(row.note, LIMITS.link_note)) { push('error', 'too_long', 'record_sources', `${row.record} → ${row.source}`, { ...w, link: true }); continue; }
    const key = `${row.record}|${row.source}|${row.locator || ''}`;
    if (rsSeen.has(key)) continue;
    rsSeen.add(key); recordSources.push(row);
  }
  const linkSeen = new Set();
  for (const row of file.links) {
    const w = where('links', row);
    const target = row.target_record || row.target_organization;
    const label = `${row.record} → ${target ?? '?'}`;
    if (!!row.target_record === !!row.target_organization) { push('error', 'bad_value', 'links', label, w); continue; }
    if (excluded.records.has(row.record) || excluded.records.has(row.target_record) || excluded.organizations.has(row.target_organization)) { push('excluded', 'excluded_link', 'links', label, w); continue; }
    // 기록이 아닌 행(출처·조직·주제)을 기록 자리에서 가리키면 담을 칸이 없으므로 빼고 알림.
    const other = id => id && !known('records')(id) && (known('sources')(id) || known('organizations')(id) || known('topics')(id));
    if (other(row.record) || other(row.target_record)) { push('warning', 'link_kind_unsupported', 'links', label, w); continue; }
    if (!known('records')(row.record) || (row.target_record && !known('records')(row.target_record)) || (row.target_organization && !known('organizations')(row.target_organization))) {
      const missing = [!known('records')(row.record) && row.record, row.target_record && !known('records')(row.target_record) && row.target_record,
        row.target_organization && !known('organizations')(row.target_organization) && row.target_organization].filter(Boolean).join(', ');
      push('error', 'broken_ref', 'links', `${label} (없는 ID: ${missing})`, w); continue;
    }
    if (row.target_record && row.target_record === row.record) { push('error', 'self_link', 'links', label, w); continue; }
    const relations = row.target_record ? ['belongs_to', 'follow_up', 'supports', 'contradicts', 'related'] : values('relation');
    if (!relations.includes(row.relation)) { push('error', 'bad_value', 'links', label, w); continue; }
    if (tooLong(row.note, LIMITS.link_note)) { push('error', 'too_long', 'links', label, w); continue; }
    const key = `${row.record}|${row.target_record || ''}|${row.target_organization || ''}|${row.relation}`;
    if (linkSeen.has(key)) { push('warning', 'duplicate_link_skipped', 'links', label, w); continue; }
    linkSeen.add(key); links.push(row);
  }
  const legacySeen = new Set();
  const legacyKept = [];
  for (const row of legacy) {
    const w = where('legacy_write_requests', row);
    // REQ-0001 모양은 legacy_id(유일 색인)로, 다른 모양은 legacy_id 없이 detail.legacy_id_original에 원래 표기를 보관(L7).
    const original = typeof row.detail?.legacy_id_original === 'string' && row.detail.legacy_id_original.trim() ? row.detail.legacy_id_original.trim() : null;
    if (row.legacy_id === null && original) row.legacy_id = null;
    else if (!/^[A-Z]{2,6}-[0-9]{1,6}$/.test(String(row.legacy_id ?? ''))) { push('error', 'bad_id', 'legacy_write_requests', String(row.legacy_id ?? ''), w); continue; }
    const seenKey = row.legacy_id || 'original:' + original;
    const exists = row.legacy_id && ctx.existing?.legacy?.has?.(row.legacy_id);
    if (legacySeen.has(seenKey) || exists) { push('error', exists ? 'existing_id' : 'duplicate_id', 'legacy_write_requests', row.legacy_id || original, w); continue; }
    if (row.detail !== undefined && (typeof row.detail !== 'object' || Array.isArray(row.detail) || JSON.stringify(row.detail).length > 60000)) { push('error', 'bad_value', 'legacy_write_requests', row.legacy_id, w); continue; }
    legacySeen.add(seenKey); legacyKept.push(row);
  }

  const strip = row => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('_')));
  const payload = {
    format: FORMAT, version: VERSION, kind: 'sheet', id_prefixes: idPrefixes,
    topics: kept.topics.filter(r => !bad.has(r)).map(strip), organizations: kept.organizations.filter(r => !bad.has(r)).map(strip),
    sources: kept.sources.filter(r => !bad.has(r)).map(strip), records: kept.records.filter(r => !bad.has(r)).map(strip),
    record_sources: recordSources.map(strip), links: links.map(strip), legacy_write_requests: legacyKept.map(strip)
  };
  return { payload, issues, idPrefixes };
}
function aliasesOk(aliases) {
  if (aliases === undefined) return true;
  return Array.isArray(aliases) && aliases.length <= 20 && aliases.every(a => typeof a === 'string' && a && !/[\u0000-\u001f\u007f]/.test(a)) && aliases.join('').length <= 1000;
}
function dateOk(row) {
  const { date_start: s, date_end: e, date_precision: p = 'unknown' } = row;
  if ((s && !isDate(s)) || (e && !isDate(e)) || (e && !s) || (e && s && e < s)) return false;
  if (p === 'unknown') return !s && !e;
  if (p === 'day') return !!s && (!e || e === s);
  if (p === 'month') return !!s && s.endsWith('-01') && !e;
  if (p === 'year') return !!s && s.endsWith('-01-01') && !e;
  if (p === 'range') return !!s && !!e && e > s;
  return false;
}

// ---------- 전체 검사 ----------
// input: readInputFiles 결과. ctx: DB에서 읽은 번호표·기존 ID·담당조직. overrides: 사용자가 고친 대응표({field:{raw:value}}).
export function analyze(input, ctx = {}, overrides = {}, label = '') {
  const result = { kind: 'sheet', source_kind: input.source_kind, sha256: input.sha256, label: oneLine(label).slice(0, 80), tabs: [], skipped: [], unknownTabs: [], mapping: {}, issues: [], ok: false, payload: null };
  let canonical; let carried = []; let sheetTabs = null;
  if (input.type === 'json') {
    const data = input.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== FORMAT || data.version !== VERSION || !['sheet', 'candidates'].includes(data.kind)) {
      result.issues = [{ level: 'error', reason: 'bad_file', id: '가져오기 파일 형식(format·version·kind)' }];
      return finish(result);
    }
    if (data.kind === 'candidates') return candidatesSummary(result, data);
    canonical = JSON.parse(JSON.stringify(data));
    if (!result.label && typeof data.label === 'string') result.label = oneLine(data.label).slice(0, 80);
  } else {
    const topicOptions = topicChoices(input, ctx);
    result.mapping = buildMapping(input, overrides, topicOptions);
    const sheet = sheetToCanonical(input, mappingValues(result.mapping));
    canonical = sheet.canonical; carried = sheet.issues; sheetTabs = sheet.tabs;
    result.skipped = sheet.skipped; result.unknownTabs = sheet.unknownTabs;
  }
  const checked = validateCanonical(canonical, ctx, carried);
  result.issues = checked.issues;
  result.idPrefixes = checked.idPrefixes;
  result.tabs = tabCounts(sheetTabs, canonical, checked);
  result.payload = { ...checked.payload, label: result.label, sha256: input.sha256, source_kind: input.source_kind,
    report: { tabs: Object.fromEntries(result.tabs.map(t => [t.key, t.key === 'org_link' && t.linkShift ? [t.sheetRows, t.excluded, t.rejected, t.linkShift] : [t.sheetRows, t.excluded, t.rejected]])) } };
  return finish(result);
}
function topicChoices(input, ctx) {
  const list = [...(ctx.topics || [])];
  for (const tab of input.tabs) {
    if (tabKey(tab.name) !== 'topic') continue;
    const rows = tab.rows.map(r => r.map(c => String(c ?? '')));
    const headerAt = rows.findIndex(r => r.some(c => clean(c)));
    if (headerAt < 0) continue;
    const { fields } = headerMap('topic', rows[headerAt]);
    for (const r of rows.slice(headerAt + 1)) {
      const id = normalizeId(oneLine(r[fields.id] ?? '')).id;
      if (id) list.push({ ledger_id: id, name: oneLine(r[fields.name] ?? ''), aliases: splitAliases(r[fields.aliases] ?? '') });
    }
  }
  const seen = new Set();
  return list.filter(t => !seen.has(t.ledger_id) && seen.add(t.ledger_id));
}
// 탭별: 시트 행 = 넣을 행 + 제외 + 거부. 거부·제외는 행 단위(연결 행 빠짐은 따로 셈).
function tabCounts(sheetTabs, canonical, checked) {
  const byTab = new Map();
  const slot = key => { if (!byTab.has(key)) byTab.set(key, { key, label: TABS[key]?.label || key, sheetRows: 0, blankRows: 0, importRows: 0, excluded: 0, rejected: 0, droppedLinks: 0, matched: [], unknown: [], dropped: [], missing: [] }); return byTab.get(key); };
  const rowKey = new Set();
  for (const issue of checked.issues) {
    if (!issue.tab || !TABS[issue.tab]) continue;
    const s = slot(issue.tab);
    const id = `${issue.tab}|${issue.row ?? issue.id}`;
    if (issue.level === 'excluded' && issue.reason === 'excluded_link' && issue.tab !== 'org_link') { s.droppedLinks++; continue; }
    if (issue.level === 'warning' || rowKey.has(id)) continue;
    if (issue.level === 'error' && ['missing_column', 'mixed_prefix', 'prefix_conflict', 'prefix_shared', 'bad_file', 'too_many'].includes(issue.reason)) continue;
    if (issue.level === 'error' && issue.row === undefined && ['record_sources', 'links'].includes(issue.table)) continue;
    rowKey.add(id);
    if (issue.level === 'excluded') s.excluded++; else s.rejected++;
  }
  if (sheetTabs) {
    for (const t of sheetTabs) {
      const s = slot(t.key);
      Object.assign(s, { sheetRows: t.sheetRows, blankRows: t.blankRows, matched: t.matched, unknown: t.unknown, dropped: t.dropped, missing: t.missing });
      if (t.missing.length) s.rejected = t.sheetRows;
      s.importRows = Math.max(0, s.sheetRows - s.excluded - s.rejected);
    }
    const orgLinks = byTab.get('org_link');
    if (orgLinks) orgLinks.linkShift = checked.payload.links.filter(l => l.target_organization).length - orgLinks.importRows;
  } else {
    // Claude 가져오기 파일: 표 행이 곧 시트 행.
    const p = checked.payload;
    const counts = { topic: [canonical.topics, p.topics], organization: [canonical.organizations, p.organizations], source: [canonical.sources, p.sources],
      write_request: [canonical.legacy_write_requests, p.legacy_write_requests] };
    for (const k of KINDS) counts[k] = [canonical.records.filter(r => r.kind === k), p.records.filter(r => r.kind === k)];
    counts.org_link = [canonical.links.filter(l => l.target_organization), p.links.filter(l => l.target_organization)];
    for (const [k, [all, kept]] of Object.entries(counts)) {
      if (!all.length && !byTab.has(k)) continue;
      const s = slot(k); s.sheetRows = all.length; s.importRows = kept.length; s.rejected = Math.max(0, all.length - kept.length - s.excluded);
    }
  }
  return TAB_ORDER.filter(k => byTab.has(k)).map(k => byTab.get(k));
}
function candidatesSummary(result, data) {
  result.kind = 'candidates';
  const list = Array.isArray(data.candidates) ? data.candidates : null;
  if (!list) { result.issues = [{ level: 'error', reason: 'bad_file', id: 'candidates 배열' }]; return finish(result); }
  const kinds = {};
  let invalid = 0;
  for (const c of list) {
    const ok = c && typeof c === 'object' && KINDS.includes(c.kind) && ['new', 'add_source', 'update', 'supersede'].includes(c.action ?? 'new')
      && typeof c.title === 'string' && oneLine(c.title) && ['S0', 'S1', 'S2', 'S3'].includes(c.sensitivity ?? 'S1');
    if (!ok) invalid++; else kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  }
  result.candidates = { total: list.length, invalid, kinds, excluded: list.filter(c => c?.sensitivity === 'S3').length };
  if (invalid) result.issues.push({ level: 'error', reason: 'bad_file', id: `후보 ${invalid}건 모양이 다름` });
  return finish(result);
}
function finish(result) {
  const groups = {};
  for (const issue of result.issues) {
    const g = groups[issue.level] ||= new Map();
    const entry = g.get(issue.reason) || { reason: issue.reason, label: REASONS[issue.reason] || issue.reason, count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 10 && issue.id) entry.samples.push(issue.id);
    g.set(issue.reason, entry);
  }
  result.summary = Object.fromEntries(['error', 'excluded', 'warning'].map(l => [l, [...(groups[l]?.values() || [])].sort((a, b) => b.count - a.count)]));
  result.errorCount = result.summary.error.reduce((n, e) => n + e.count, 0);
  result.ok = result.kind === 'sheet' && result.errorCount === 0 && !!result.payload && !!result.label;
  if (result.payload) result.counts = {
    topics: result.payload.topics.length, organizations: result.payload.organizations.length, sources: result.payload.sources.length,
    records: Object.fromEntries(KINDS.map(k => [k, result.payload.records.filter(r => r.kind === k).length])),
    record_sources: result.payload.record_sources.length, links_to_records: result.payload.links.filter(l => l.target_record).length,
    links_to_organizations: result.payload.links.filter(l => l.target_organization).length, legacy_write_requests: result.payload.legacy_write_requests.length
  };
  return result;
}

// 숫자 확인: 시트 행 수 = DB에 들어간 수 + 제외 + 거부(탭별). db = app_import_ledger_counts 결과.
export function numberCheck(report, db) {
  const inserted = {
    topic: db?.topics, organization: db?.organizations, source: db?.sources, org_link: db?.links_to_organizations,
    write_request: db?.legacy_write_requests, ...Object.fromEntries(KINDS.map(k => [k, db?.records_by_kind?.[k] ?? 0]))
  };
  // 4번째 값(조직연결만): 한 행에 기록 ID가 여럿이라 늘어난 연결 수 − 겹치거나 담을 수 없어 뺀 연결 수.
  return Object.entries(report?.tabs || {}).filter(([k]) => TABS[k]).sort((a, b) => TAB_ORDER.indexOf(a[0]) - TAB_ORDER.indexOf(b[0])).map(([key, [sheet, excluded, rejected, shift = 0]]) => {
    const n = Number(inserted[key] ?? 0);
    return { key, label: TABS[key].label, sheet, inserted: n, excluded, rejected, shift, ok: sheet + shift === n + excluded + rejected };
  });
}
