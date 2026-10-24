// AI-서버연동 S7-d: 원장 Drive 내보내기의 순수 판단(app/ledger-export.js가 쓴다). DOM·네트워크 없음.
// LEDGER-자동기록 3단계(설계 docs/design/ledger-auto-record.md 6절): 매주 자동 + 수동 버튼 대신, 원장이 바뀌면 10분 묶어 한 번(한 시간에 한 번까지),
// 앱을 열 때 마지막 성공이 하루 넘었고 그 뒤 원장이 바뀌었으면 한 번. 화면은 상태 한 줄(멈췄을 때만 경고).
const HOUR = 3600000, DAY = 24 * HOUR;
export const WEEK_MS = 7 * DAY;
export const RETRY_AFTER_FAILURE_MS = DAY; // 실패 뒤에는 하루 지나야 자동으로 다시 시도한다.
export const CHECK_EVERY_MS = 6 * HOUR;    // 한 탭에서 상태를 묻는 간격.
export const START_DELAY_MS = 2 * 60 * 1000; // 시작 요청(홈 읽기)과 겹치지 않게 연 뒤 2분 기다렸다 묻는다.
export const DAY_MS = DAY;
export const CHANGE_WAIT_MS = 10 * 60 * 1000; // 원장이 바뀐 뒤 10분 묶어 한 번
export const MIN_GAP_MS = HOUR;                // 한 시간에 한 번을 넘지 않는다
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const time = v => (typeof v === 'string' && v.length <= 40 && ISO.test(v) && Number.isFinite(Date.parse(v))) ? Date.parse(v) : null;

// GET ?action=ledger_status 답 → {state, successAt, failedAt, code} 또는 null(배포 전 함수·모양 틀림 → 칸을 숨김).
export function ledgerFromStatus(data) {
  const l = data && data.ok === true && data.ledger && typeof data.ledger === 'object' ? data.ledger : null;
  if (!l || !['found', 'none'].includes(l.state)) return null;
  const failedAt = time(l.last_failure_at);
  return { state: l.state, successAt: time(l.last_success_at), failedAt, code: failedAt !== null && typeof l.last_failure_code === 'string' && CODE.test(l.last_failure_code) ? l.last_failure_code : null };
}

const failedLast = s => s.failedAt !== null && (s.successAt === null || s.failedAt > s.successAt);

// 앱을 열 때 한 번: 마지막 성공이 하루 넘었고 그 뒤 원장이 바뀌었으면(lastChangeAt: 원장 기록의 가장 늦은 updated_at, 모르면 null) 내보낸다.
// 바뀐 시각을 모르면 옛 규칙(7일)으로만. 더 최근 실패가 있으면 하루 기다린다.
export function exportDue(status, now, lastChangeAt = null) {
  if (!status) return false;
  if (failedLast(status) && now - status.failedAt < RETRY_AFTER_FAILURE_MS) return false;
  if (status.successAt === null) return true;
  if (now - status.successAt >= WEEK_MS) return true;
  return lastChangeAt !== null && lastChangeAt > status.successAt && now - status.successAt >= DAY;
}

// 원장이 바뀐 뒤 언제 부를까: 10분 묶되 마지막 시도에서 한 시간이 안 지났으면 그때까지 미룬다.
export function nextExportDelay(lastAttemptAt, now) {
  const gap = lastAttemptAt === null ? 0 : lastAttemptAt + MIN_GAP_MS - now;
  return Math.max(CHANGE_WAIT_MS, gap);
}

// 상태 한 줄: 평소 {stalled:false, text:'Claude용 사본 10/23 14:20 갱신'}, 멈춤 {stalled:true, since}.
// 멈춤 = 마지막 실패가 성공보다 최근, 또는 원장이 바뀐 뒤 하루 넘게 성공 없음.
export function copyState(status, now, lastChangeAt = null) {
  if (!status) return null;
  if (failedLast(status)) return { stalled: true, since: status.successAt ?? status.failedAt, code: status.code };
  if (lastChangeAt !== null && (status.successAt === null || lastChangeAt > status.successAt) && now - lastChangeAt >= DAY) {
    return { stalled: true, since: status.successAt ?? lastChangeAt, code: null };
  }
  return { stalled: false, at: status.successAt };
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
  NOT_DEPLOYED: '서버 준비 전이에요.',
  LEDGER_NOT_READY: '원장 준비 전이에요.',
  DRIVE_PUBLIC_SHARING_FOUND: 'Drive 사본 폴더나 파일에 공개 공유가 있어 멈췄습니다. Drive에서 "일반 액세스: 제한됨"으로 바꾼 뒤 다시 하세요.',
  DRIVE_CONFIG_MISSING: 'Google Drive 연결이 없습니다.',
  DRIVE_TOKEN_FAILED: 'Google Drive 연결을 확인하지 못했습니다.',
  DRIVE_DUPLICATE_MARKERS: 'Drive에 같은 표시의 파일이 둘 있어 멈췄습니다.',
  LEDGER_DOC_LIMIT: '백업 파일은 올렸지만 읽기용 문서가 너무 커서 목록을 싣지 못했어요.',
  LEDGER_READ_LIMIT: '원장 행이 너무 많아 내보내지 않았습니다.',
  FORBIDDEN: '이 작업공간의 소유자만 내보낼 수 있습니다.',
  UNAUTHORIZED: '로그인이 필요합니다.',
};
export const failureText = code => CODE_TEXT[code] || `내보내지 못했어요(단계 ${code || '알 수 없음'}). 잠시 뒤 다시 시도해 주세요.`;
