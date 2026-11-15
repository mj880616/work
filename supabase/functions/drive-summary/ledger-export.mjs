// AI-서버연동 S7-d: 원장 매주 Drive 내보내기(설계 docs/design/ledger-web2.md 9절).
// 순수 함수(읽기·JSON·읽기용 문서) + 주입한 fetch. Drive 쓰기와 인증은 core.mjs가 기존 경로로 한다.
// 원장 표는 service_role 권한이 없다(의도). 그래서 읽기는 소유자 로그인 토큰 + anon 키로만 한다(owner RLS 그대로).
// 원장 내용·파일 ID는 오류·응답·로그에 넣지 않는다. 오류는 단계 코드만.
const KST = 9 * 3600000, DAY = 86400000, PAGE = 500;

export const LEDGER_LIMITS = Object.freeze({
  rowsPerTable: 20000, // 1년 2,500건 규모의 여러 배. 넘으면 잘린 백업을 만들지 않고 실패한다.
  documentBytes: 4 * 1024 * 1024,
  summaryChars: 600,
  keepBackups: 8,
});

// 표별 열 허용 목록(감사 기록·후보 제외, 설계 9.1). workspace_id는 요청 조건이라 싣지 않는다.
// 열을 더하는 migration은 이 목록도 고쳐야 한다(tests/security/drive-summary-ledger-export.test.mjs가 migration과 대조).
export const LEDGER_TABLES = Object.freeze({
  app_ledger_imports: ['id', 'label', 'source_kind', 'file_sha256', 'row_counts', 'status', 'created_at', 'decided_at'],
  app_ledger_id_counters: ['scope', 'prefix', 'last_number'],
  app_ledger_topics: ['id', 'ledger_id', 'name', 'aliases', 'description', 'project_id', 'status', 'sort_order', 'import_id', 'created_at', 'updated_at'],
  app_ledger_organizations: ['id', 'ledger_id', 'name', 'aliases', 'suborganization_id', 'note', 'status', 'import_id', 'created_at', 'updated_at'],
  app_ledger_sources: ['id', 'ledger_id', 'title', 'doc_type', 'location', 'drive_file_id', 'source_date', 'coverage', 'processing_status', 'sensitivity', 'note', 'status', 'import_id', 'created_at', 'updated_at'],
  app_ledger_records: ['id', 'kind', 'ledger_id', 'title', 'summary', 'scope', 'topic_id', 'sensitivity', 'importance', 'validity', 'confidence', 'verification',
    'date_start', 'date_end', 'date_precision', 'date_note', 'event_status', 'decision_type', 'decision_reason', 'evidence_type', 'counterparty',
    'commitment_status', 'follow_up_on', 'superseded_by', 'supersede_reason', 'note', 'import_id', 'created_at', 'updated_at'],
  app_ledger_record_sources: ['id', 'record_id', 'source_id', 'locator', 'note', 'import_id', 'created_at'],
  app_ledger_links: ['id', 'record_id', 'target_record_id', 'target_organization_id', 'target_project_id', 'target_meeting_id', 'relation', 'note', 'import_id', 'created_at'],
});
const ORDER = { app_ledger_id_counters: 'scope.asc' };

export class LedgerError extends Error {
  constructor(code, status = 502) { super(code); this.status = status; }
}

export function kstDate(now) {
  return new Date(now.getTime() + KST).toISOString().slice(0, 10);
}
export const backupName = date => `원장-${date}.json`;

// 소유자 토큰으로 표마다 전체 행을 안정된 순서로 읽는다. 표가 없으면(404) LEDGER_NOT_READY.
export async function readLedger({ fetcher, baseUrl, anonKey, userAuthorization, workspaceId }) {
  if (!anonKey || !userAuthorization) throw new LedgerError('SERVER_CONFIG_MISSING');
  const headers = { apikey: anonKey, Authorization: userAuthorization, Accept: 'application/json' };
  async function table(name) {
    const rows = [];
    for (let offset = 0; offset <= LEDGER_LIMITS.rowsPerTable; offset += PAGE) {
      const q = new URLSearchParams({ select: LEDGER_TABLES[name].join(','), workspace_id: `eq.${workspaceId}`, order: ORDER[name] || 'id.asc', limit: String(PAGE), offset: String(offset) });
      let response;
      try { response = await fetcher(`${baseUrl}/rest/v1/${name}?${q}`, { headers, signal: AbortSignal.timeout(30000) }); }
      catch { throw new LedgerError('LEDGER_READ_FAILED'); }
      if (response.status === 404) throw new LedgerError('LEDGER_NOT_READY', 409);
      if (response.status === 401 || response.status === 403) throw new LedgerError('LEDGER_READ_FORBIDDEN', 403);
      if (!response.ok) throw new LedgerError('LEDGER_READ_FAILED');
      let page;
      try { page = await response.json(); } catch { throw new LedgerError('LEDGER_READ_FAILED'); }
      if (!Array.isArray(page)) throw new LedgerError('LEDGER_READ_FAILED');
      rows.push(...page);
      if (rows.length > LEDGER_LIMITS.rowsPerTable) break;
      if (page.length < PAGE) return rows;
    }
    throw new LedgerError('LEDGER_READ_LIMIT'); // 잘린 백업은 만들지 않는다.
  }
  const names = Object.keys(LEDGER_TABLES), tables = {};
  // 차례로 읽는다(동시 요청 8개로 DB를 몰아치지 않음, 1년 규모에서 몇 초).
  for (const name of names) tables[name] = await table(name);
  return tables;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 되살리기용 JSON. 표마다 행 수와 그 표 행 배열 JSON의 sha256을 함께 적는다.
export async function buildBackup(tables, now) {
  const counts = {}, sha256 = {};
  for (const name of Object.keys(LEDGER_TABLES)) {
    const rows = tables[name] || [];
    counts[name] = rows.length;
    sha256[name] = await sha256Hex(JSON.stringify(rows));
  }
  const body = { format: 'kptu-ledger-export', version: 1, exported_at: now.toISOString(), workspace: 'kptu-work', counts, sha256, tables };
  return { text: JSON.stringify(body), counts };
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\r?\n/g, '<br>');
const p = text => `<p>${esc(text)}</p>`;
const KIND_ORDER = ['event', 'change', 'decision', 'evidence', 'commitment'];
const KIND_LABEL = { event: '사건', change: '변화기록', decision: '결정', evidence: '근거', commitment: '약속' };
const VALIDITY = { current: '현재유효', fulfilled: '이행완료', superseded: '대체', retired: '폐기', needs_check: '확인필요' };
const IMPORTANCE = { very_high: '매우높음', high: '높음' };
const EVENT_STATUS = { tracking: '추적중', watching: '관찰', closed: '종료', on_hold: '보류' };
const DECISION = { adopted: '채택', rejected: '기각', on_hold: '보류', changed: '변경' };
const COMMITMENT = { waiting: '대기', fulfilled: '이행', broken: '불이행', cancelled: '취소' };
const EVIDENCE = { law: '법령', statistics: '통계', budget: '예산', agreement: '합의문', precedent: '판례·선례', gov_position: '정부 입장', counterpart_statement: '상대측 발언', field_fact: '현장 사실', argument: '교섭 논거', other: '기타' };
const INACTIVE = new Set(['superseded', 'retired']);
export const LEDGER_TITLE = '원장 (읽기용 사본)';
const NOTICE = '이 문서는 Web2가 자동으로 만드는 원장 읽기용 사본입니다. 직접 고쳐도 다음 내보내기 때 덮어써집니다. 원본은 Web2 원장, 되살리기용 전체 백업은 같은 폴더의 "원장 백업" JSON입니다.';

export function dateText(r) {
  const s = r.date_start || '', e = r.date_end || '';
  const base = r.date_precision === 'month' ? s.slice(0, 7) : r.date_precision === 'year' ? s.slice(0, 4)
    : r.date_precision === 'range' ? `${s}~${e}` : r.date_precision === 'day' ? s : '날짜 모름';
  return r.date_note ? `${base}(${r.date_note})` : base;
}
const clip = text => { const t = String(text || ''); return t.length > LEDGER_LIMITS.summaryChars ? `${t.slice(0, LEDGER_LIMITS.summaryChars)}…` : t; };
const byDate = (a, b) => String(b.date_start || '').localeCompare(String(a.date_start || '')) || String(a.ledger_id).localeCompare(String(b.ledger_id));

// 기한 지난 약속: 저장하지 않고 내보낼 때 계산(3.1절). 대기 + 후속확인일 < 오늘(KST) + 대체·폐기 아님.
export function overdueCommitments(records, today) {
  return records.filter(r => r.kind === 'commitment' && r.commitment_status === 'waiting' && r.follow_up_on && r.follow_up_on < today && !INACTIVE.has(r.validity))
    .sort((a, b) => String(a.follow_up_on).localeCompare(String(b.follow_up_on)) || String(a.ledger_id).localeCompare(String(b.ledger_id)));
}

// 읽기용 Google 문서(HTML). S2(교섭·전략)는 ID·기준일·제목만 싣고 요지·비고·결정이유·상대측을 뺀다(설계 9.1).
export function renderLedgerDocument(tables, now) {
  const records = tables.app_ledger_records || [], sources = tables.app_ledger_sources || [];
  const orgs = new Map((tables.app_ledger_organizations || []).map(o => [o.id, o]));
  const topics = (tables.app_ledger_topics || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'ko'));
  const recordIds = new Map(records.map(r => [r.id, r.ledger_id]));
  const sourceIds = new Map(sources.map(s => [s.id, s.ledger_id]));
  const sourcesOf = new Map(), orgsOf = new Map(), parentOf = new Map();
  for (const rs of tables.app_ledger_record_sources || []) {
    const id = sourceIds.get(rs.source_id); if (!id) continue;
    const list = sourcesOf.get(rs.record_id) || []; if (!list.includes(id)) list.push(id); sourcesOf.set(rs.record_id, list);
  }
  for (const l of tables.app_ledger_links || []) {
    if (l.target_organization_id && orgs.has(l.target_organization_id)) {
      const o = orgs.get(l.target_organization_id), list = orgsOf.get(l.record_id) || [];
      list.push(`${o.name}(${o.ledger_id})`); orgsOf.set(l.record_id, list);
    }
    if (l.relation === 'belongs_to' && l.target_record_id && recordIds.has(l.target_record_id)) parentOf.set(l.record_id, recordIds.get(l.target_record_id));
  }
  const today = kstDate(now);
  function line(r) {
    const parts = [r.ledger_id, dateText(r)];
    if (r.sensitivity === 'S2') {
      parts.push('[S2 교섭·전략: 요지 생략]', r.title);
    } else {
      if (IMPORTANCE[r.importance]) parts.push(`중요 ${IMPORTANCE[r.importance]}`);
      parts.push(r.title);
      if (r.summary) parts.push(clip(r.summary));
      if (r.kind === 'event' && r.event_status) parts.push(`상태 ${EVENT_STATUS[r.event_status] || r.event_status}`);
      if (r.kind === 'decision' && r.decision_type) parts.push(`결정 ${DECISION[r.decision_type] || r.decision_type}${r.decision_reason ? `: ${clip(r.decision_reason)}` : ''}`);
      if (r.kind === 'evidence' && r.evidence_type) parts.push(`유형 ${EVIDENCE[r.evidence_type] || r.evidence_type}`);
      if (r.kind === 'commitment') parts.push(`상대측 ${r.counterparty || '-'} · 이행 ${COMMITMENT[r.commitment_status] || r.commitment_status || '-'}${r.follow_up_on ? ` · 후속확인 ${r.follow_up_on}` : ''}`);
    }
    if (r.validity && r.validity !== 'current') parts.push(VALIDITY[r.validity] || r.validity);
    if (parentOf.has(r.id)) parts.push(`소속 ${parentOf.get(r.id)}`);
    if (orgsOf.has(r.id)) parts.push(`조직 ${orgsOf.get(r.id).join(', ')}`);
    if (sourcesOf.has(r.id)) parts.push(`출처 ${sourcesOf.get(r.id).join(', ')}`);
    return p(parts.filter(Boolean).join(' · '));
  }
  const active = records.filter(r => !INACTIVE.has(r.validity));
  const work = active.filter(r => r.scope !== 'interest'), interest = active.filter(r => r.scope === 'interest');
  const inactive = records.filter(r => INACTIVE.has(r.validity));
  const out = [];
  const kinds = (list, level) => {
    for (const kind of KIND_ORDER) {
      const rows = list.filter(r => r.kind === kind).sort(byDate);
      if (!rows.length) continue;
      out.push(`<h${level}>${esc(KIND_LABEL[kind])} (${rows.length})</h${level}>`, ...rows.map(line));
    }
  };
  const topicIds = new Set(topics.map(t => t.id));
  for (const t of topics) {
    const rows = work.filter(r => r.topic_id === t.id);
    if (!rows.length) continue;
    out.push(`<h2>${esc(`${t.name} (${t.ledger_id})`)}</h2>`);
    kinds(rows, 3);
  }
  const loose = work.filter(r => !r.topic_id || !topicIds.has(r.topic_id));
  if (loose.length) { out.push('<h2>주제 없음</h2>'); kinds(loose, 3); }
  if (!work.length) out.push(p('업무 기록 없음'));
  const overdue = overdueCommitments(records, today);
  out.push('<h2>기한 지난 약속</h2>');
  if (overdue.length) {
    out.push('<table><tr><th>ID</th><th>후속확인일</th><th>지난 날</th><th>상대측</th><th>제목</th></tr>');
    for (const r of overdue) {
      const days = Math.round((Date.parse(today) - Date.parse(r.follow_up_on)) / DAY);
      const s2 = r.sensitivity === 'S2';
      out.push(`<tr><td>${esc(r.ledger_id)}</td><td>${esc(r.follow_up_on)}</td><td>${days}일</td><td>${esc(s2 ? '(S2 생략)' : r.counterparty || '-')}</td><td>${esc(r.title)}</td></tr>`);
    }
    out.push('</table>');
  } else out.push(p('기한 지난 약속 없음'));
  if (interest.length) {
    out.push('<h2>관심 정보</h2>', p('업무 밖 소식(L1). 업무 판단의 근거로 쓰지 않습니다.'));
    kinds(interest, 3);
  }
  if (inactive.length) {
    out.push('<h2>대체·폐기</h2>');
    for (const r of inactive.slice().sort(byDate)) {
      out.push(p([r.ledger_id, VALIDITY[r.validity] || r.validity, r.title, r.superseded_by && recordIds.has(r.superseded_by) ? `대체한 기록 ${recordIds.get(r.superseded_by)}` : ''].filter(Boolean).join(' · ')));
    }
  }
  const kst = new Date(now.getTime() + KST).toISOString().slice(0, 16).replace('T', ' ');
  const head = [p(`마지막 내보내기: ${kst} (KST)`), p(NOTICE), `<h1>${esc(LEDGER_TITLE)}</h1>`,
    p(`기록 ${records.length}건(업무 ${work.length} · 관심 ${interest.length} · 대체·폐기 ${inactive.length}) · 출처 ${sources.length} · 조직 ${orgs.size} · 주제 ${topics.length}`),
    p('S2(교섭·전략) 기록은 ID·기준일·제목만 싣습니다. 요지는 기록당 600자까지만 싣습니다(전체는 백업 JSON).')];
  const html = `<html><head><meta charset="utf-8"></head><body>\n${[...head, ...out].join('\n')}\n</body></html>`;
  if (new TextEncoder().encode(html).length <= LEDGER_LIMITS.documentBytes) return { html, overLimit: false };
  const diag = `<html><head><meta charset="utf-8"></head><body>\n${[...head, p('대상 축소 필요: 읽기용 문서 크기 상한(4 MiB)을 넘어 이번에는 기록 목록을 싣지 않았습니다. 백업 JSON은 정상으로 올라갔습니다.')].join('\n')}\n</body></html>`;
  return { html: diag, overLimit: true };
}

// 폴더 appProperties → 내보내기 상태(시각·단계 코드만, 다른 속성은 내지 않음).
const TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const time = v => (typeof v === 'string' && v.length <= 40 && TIME.test(v) && Number.isFinite(Date.parse(v))) ? new Date(Date.parse(v)).toISOString() : null;
export function ledgerStatus(appProperties, found = true) {
  const a = appProperties && typeof appProperties === 'object' ? appProperties : {};
  const failedAt = time(a.ledger_last_failure_at);
  return {
    state: found ? 'found' : 'none',
    last_success_at: time(a.ledger_last_success_at),
    last_failure_at: failedAt,
    last_failure_code: failedAt && typeof a.ledger_last_failure_summary === 'string' && CODE.test(a.ledger_last_failure_summary) ? a.ledger_last_failure_summary : null,
  };
}

// 보관 개수 넘는 백업(날짜 오래된 것부터). 날짜 표시가 이상한 파일은 건드리지 않는다.
export function backupsToTrash(files, keep = LEDGER_LIMITS.keepBackups) {
  return files.filter(f => /^\d{4}-\d{2}-\d{2}$/.test(String(f?.appProperties?.kptu_export_date || '')))
    .sort((a, b) => b.appProperties.kptu_export_date.localeCompare(a.appProperties.kptu_export_date) || String(a.id).localeCompare(String(b.id)))
    .slice(keep);
}
