// AI-서버연동 S7-d: 원장 매주 Drive 내보내기의 순수 판단(app/ledger-export.js가 쓴다). DOM·네트워크 없음.
const HOUR = 3600000, DAY = 24 * HOUR;
export const WEEK_MS = 7 * DAY;
export const RETRY_AFTER_FAILURE_MS = DAY; // 실패 뒤에는 하루 지나야 자동으로 다시 시도한다.
export const CHECK_EVERY_MS = 6 * HOUR;    // 한 탭에서 상태를 묻는 간격.
export const START_DELAY_MS = 2 * 60 * 1000; // 시작 요청(홈 읽기)과 겹치지 않게 연 뒤 2분 기다렸다 묻는다.
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const time = v => (typeof v === 'string' && v.length <= 40 && ISO.test(v) && Number.isFinite(Date.parse(v))) ? Date.parse(v) : null;

// GET ?action=ledger_status 답 → {state, successAt, failedAt, code} 또는 null(배포 전 함수·모양 틀림 → 칸을 숨김).
export function ledgerFromStatus(data) {
  const l = data && data.ok === true && data.ledger && typeof data.ledger === 'object' ? data.ledger : null;
  if (!l || !['found', 'none'].includes(l.state)) return null;
  const failedAt = time(l.last_failure_at);
  return { state: l.state, successAt: time(l.last_success_at), failedAt, code: failedAt !== null && typeof l.last_failure_code === 'string' && CODE.test(l.last_failure_code) ? l.last_failure_code : null };
}

// 매주 1회: 마지막 성공이 7일 넘었거나 없으면 내보낸다. 더 최근 실패가 있으면 하루 기다린다.
export function exportDue(status, now) {
  if (!status) return false;
  if (status.failedAt !== null && (status.successAt === null || status.failedAt > status.successAt) && now - status.failedAt < RETRY_AFTER_FAILURE_MS) return false;
  return status.successAt === null || now - status.successAt >= WEEK_MS;
}

// POST ?action=ledger_export 답. 옛 함수(배포 전)는 action을 몰라 사본 갱신 답(updated_at)을 준다 → not_deployed.
export function exportResult(data) {
  if (data && data.ok === true && time(data.exported_at) !== null) {
    const counts = data.counts && typeof data.counts === 'object' ? data.counts : {};
    const records = Number.isInteger(counts.app_ledger_records) ? counts.app_ledger_records : null;
    return { ok: true, at: time(data.exported_at), records };
  }
  if (data && data.ok === true) return { ok: false, code: 'NOT_DEPLOYED' };
  return { ok: false, code: typeof data?.error === 'string' && CODE.test(data.error) ? data.error : 'LEDGER_EXPORT_FAILED' };
}

const CODE_TEXT = {
  NOT_DEPLOYED: '서버 준비 전입니다(drive-summary 재배포 뒤 쓸 수 있음).',
  LEDGER_NOT_READY: '원장 표가 아직 없습니다.',
  DRIVE_PUBLIC_SHARING_FOUND: 'Drive 사본 폴더나 파일에 공개 공유가 있어 멈췄습니다. Drive에서 "일반 액세스: 제한됨"으로 바꾼 뒤 다시 하세요.',
  DRIVE_CONFIG_MISSING: 'Google Drive 연결이 없습니다.',
  DRIVE_TOKEN_FAILED: 'Google Drive 연결을 확인하지 못했습니다.',
  DRIVE_DUPLICATE_MARKERS: 'Drive에 같은 표시의 파일이 둘 있어 멈췄습니다.',
  LEDGER_DOC_LIMIT: '백업 JSON은 올렸지만 읽기용 문서가 너무 커서 목록을 싣지 못했습니다.',
  LEDGER_READ_LIMIT: '원장 행이 너무 많아 내보내지 않았습니다.',
  FORBIDDEN: '이 작업공간의 소유자만 내보낼 수 있습니다.',
  UNAUTHORIZED: '로그인이 필요합니다.',
};
export const failureText = code => CODE_TEXT[code] || `내보내지 못했습니다(단계 ${code || '알 수 없음'}). 잠시 뒤 다시 시도하세요.`;
