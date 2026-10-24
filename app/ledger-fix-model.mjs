// LEDGER-수정요청(설계 docs/design/ledger-auto-record.md 7절·10절 4번, 명진 요청 2026-10-24 07:17): 원장 고치기 칸(app/ledger-fix.js)의 순수 함수.
// 입력칸 하나: 일상어 한 줄(서버 ai-assist ledger_fix가 수정 요청 모양으로 바꿈) 또는 Claude 수정안 덩어리(kptu-ledger-fix JSON, 그대로 해 보기).
// 미리보기는 DB 함수 해 보기(app_apply_ledger_fix p_dry_run=true)의 전·후를 일상어 한 줄씩으로 바꾼다(고정 ID·DB 낱말 없음). DOM·네트워크 없음.
import { KIND_DISPLAY, EVENT_STATUS_LABEL, DECISION_TYPE_LABEL, EVIDENCE_TYPE_LABEL, COMMITMENT_STATUS_LABEL, SENSITIVITY_LABEL, IMPORTANCE_LABEL } from './ledger-browse-model.mjs';

export const FIX_TEXT_MAX = 500;
export const PASTE_MAX = 60000;
export const UNDO_MS = 10000;
const LEDGER_ID = /^[A-Z]{2,6}-[0-9]{4,6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 입력 글 → {mode:'paste', request} (Claude 덩어리) / {mode:'text', text} (일상어) / {error}.
// 덩어리는 모양만 가볍게 보고(최종 검사는 DB 함수), received_from이 없으면 'claude_chat'으로 둔다.
export function readInput(raw) {
  const value = String(raw ?? '');
  const trimmed = value.trim();
  if (!trimmed) return { error: '고칠 내용이나 새로 넣을 내용을 써 주세요.' };
  if (trimmed.startsWith('{')) {
    if (trimmed.length > PASTE_MAX) return { error: '붙여 넣은 글이 너무 길어요.' };
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { return { error: 'Claude 수정안 모양이 아니에요. 덩어리 전체를 그대로 붙여 넣어 주세요.' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.format !== 'kptu-ledger-fix' || parsed.version !== 1
        || !Array.isArray(parsed.items) || parsed.items.length < 1 || parsed.items.length > 20) {
      return { error: 'Claude 수정안 모양이 아니에요. 덩어리 전체를 그대로 붙여 넣어 주세요.' };
    }
    return { mode: 'paste', request: { received_from: 'claude_chat', ...parsed } };
  }
  const text = trimmed.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ');
  if ([...text].length > FIX_TEXT_MAX) return { error: `${FIX_TEXT_MAX}자까지 쓸 수 있어요.` };
  return { mode: 'text', text };
}

// 서버(ai-assist ledger_fix) 요청 몸통.
export function serverBody(text, target) {
  const body = { kind: 'ledger_fix', text };
  if (typeof target === 'string' && LEDGER_ID.test(target)) body.target = target;
  return body;
}

// 미리보기·반영에 쓰는 대상 고정 ID들(이름을 읽어 오려고).
export function targetsOf(request) {
  const out = new Set();
  for (const it of Array.isArray(request?.items) ? request.items : []) {
    if (typeof it?.target === 'string' && LEDGER_ID.test(it.target)) out.add(it.target);
    if (typeof it?.belongs_to === 'string' && LEDGER_ID.test(it.belongs_to)) out.add(it.belongs_to);
  }
  return [...out];
}

export const FIELD_LABEL = Object.freeze({
  title: '제목', summary: '요지', date_start: '날짜', date_end: '끝 날짜', date_note: '날짜 메모', scope: '범위', topic: '주제', sensitivity: '공개 범위',
  importance: '중요도', confidence: '신뢰도', verification: '확인', event_status: '진행', decision_type: '결정', decision_reason: '결정 이유',
  evidence_type: '근거 종류', counterparty: '상대', commitment_status: '이행', follow_up_on: '확인일', note: '비고'
});
// 미리보기에 보이지 않는 따라오는 칸(날짜를 하루로 맞추는 값).
const QUIET = new Set(['date_precision', 'date_end']);
const VALUE_LABEL = {
  event_status: EVENT_STATUS_LABEL, decision_type: DECISION_TYPE_LABEL, evidence_type: EVIDENCE_TYPE_LABEL,
  commitment_status: COMMITMENT_STATUS_LABEL, sensitivity: SENSITIVITY_LABEL, importance: IMPORTANCE_LABEL,
  scope: { work: '업무', interest: '관심' }
};
const shortDay = v => (typeof v === 'string' && DAY.test(v) ? `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : '');
const clip = (v, n = 40) => { const s = [...String(v ?? '').replace(/\s+/g, ' ').trim()]; return s.length > n ? s.slice(0, n).join('') + '…' : s.join(''); };

// 칸 값 → 화면 글. names.topics: Map(주제 ID·uuid → 이름).
export function valueText(field, value, names = {}) {
  if (value === null || value === undefined || value === '') return '없음';
  if (field === 'date_start' || field === 'follow_up_on' || field === 'date_end') return shortDay(value) || String(value);
  if (field === 'topic') return names.topics?.get?.(String(value)) || '다른 주제';
  if (VALUE_LABEL[field]) return VALUE_LABEL[field][value] || String(value);
  return `‘${clip(value)}’`;
}

// 해 보기 결과 한 항목 → 일상어 한 줄. names.records: Map(고정 ID → 제목).
export function previewLine(item, names = {}) {
  const title = id => (names.records?.get?.(id) ? `‘${clip(names.records.get(id))}’` : '그 기록');
  const changes = (Array.isArray(item?.changes) ? item.changes : []).filter(c => c && typeof c.field === 'string' && !QUIET.has(c.field));
  if (item?.do === 'replace') {
    const parts = changes.map(c => `${FIELD_LABEL[c.field] || '칸'} ${valueText(c.field, c.before, names)} → ${valueText(c.field, c.after, names)}`);
    return `${title(item.target)}: ${parts.join(', ') || '내용'}로 고침. 옛 기록은 대체됨으로 남김.`;
  }
  if (item?.do === 'retire') return `${title(item.target)}을(를) 틀린 기록으로 폐기(지우지 않음).`;
  if (item?.do === 'add_source') {
    const already = changes.some(c => c.after === 'already attached');
    return already ? `${title(item.target)}: 그 근거는 이미 붙어 있어요.` : `${title(item.target)}에 근거 추가.`;
  }
  if (item?.do === 'add') {
    const by = Object.fromEntries(changes.map(c => [c.field, c.after]));
    const kind = KIND_DISPLAY[item.kind] || '기록';
    const extra = ['date_start', 'counterparty', 'follow_up_on', 'event_status', 'decision_type', 'topic']
      .filter(f => by[f] !== undefined && by[f] !== null && by[f] !== '')
      .map(f => `${FIELD_LABEL[f]} ${valueText(f, by[f], names)}`);
    return `새 기록(${kind}) ‘${clip(by.title || '')}’${extra.length ? ' · ' + extra.join(' · ') : ''} 넣음.`;
  }
  return '알 수 없는 바꾸기(반영하지 않는 게 좋아요).';
}

// 해 보기 결과 → 미리보기 줄 목록. 모양이 틀리면 null.
export function previewLines(dry, names = {}) {
  if (!dry || typeof dry !== 'object' || dry.dry_run !== true || !Array.isArray(dry.items) || !dry.items.length) return null;
  return dry.items.map(it => previewLine(it, names));
}

// 반영 결과 → 알림 글.
export function appliedText(result) {
  const n = Number.isInteger(result?.applied) ? result.applied : 0;
  return n > 1 ? `원장에 ${n}건 반영했어요.` : '원장에 반영했어요.';
}

// DB·서버 거절 → 일상어(코드 글자는 화면에 쓰지 않음).
export function fixErrorText(e) {
  const m = String(e?.message || e?.code || '');
  if (e?.status === 404 || /PGRST202|42883/.test(m)) return '원장 고치기 준비 전이에요.';
  if (/NOT_OWNER|42501/.test(m) || e?.status === 401 || e?.status === 403) return '로그인한 소유자만 할 수 있어요.';
  if (/TARGET_INACTIVE/.test(m)) return '이미 대체됐거나 폐기된 기록이에요.';
  if (/BROKEN_REF/.test(m)) return '가리킨 기록·조직·주제를 원장에서 찾지 못했어요.';
  if (/PERSONAL/.test(m)) return '전화번호·주민번호 같은 개인정보는 넣을 수 없어요.';
  if (/BAD_REQUEST|BAD_ITEM|BAD_RECORD/.test(m)) return '원장 형식에 맞지 않아요. 내용을 바꿔 다시 해 보세요.';
  return '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}
