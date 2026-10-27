// AI-서버연동 S7-d: 매주 원장 내보내기 점검(.github/workflows/ledger-export-check.yml).
// 원장 표는 service_role 권한이 없어 예약 경로가 원장을 읽거나 내보낼 수 없다. 내보내기는 Web2(소유자 로그인)가
// 매주 한 번 자동으로 부른다. 이 스크립트는 drive-summary GET ?action=ledger_status(시각·단계 코드만)를 읽어
// 마지막 성공이 오래됐거나(8일) 마지막 실패가 더 최근이면 실패로 끝낸다 → GitHub 실패 알림.
// 비밀값은 환경변수로만 받고 출력하지 않는다.
export const STATUS_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=ledger_status';
export const STALE_DAYS = 8;
const DAY = 86400000;
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

export class CheckFailure extends Error {
  constructor(message, { retryable = false } = {}) { super(message); this.name = 'CheckFailure'; this.retryable = retryable; }
}
const time = v => (typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v))) ? Date.parse(v) : null;

export function judge(ledger, now) {
  if (!ledger || typeof ledger !== 'object' || !['found', 'none'].includes(ledger.state)) throw new CheckFailure('원장 내보내기 상태 응답 모양이 맞지 않습니다(함수 배포 전일 수 있음).');
  const ok = time(ledger.last_success_at), failed = time(ledger.last_failure_at);
  const code = typeof ledger.last_failure_code === 'string' && STAGE.test(ledger.last_failure_code) ? ledger.last_failure_code : null;
  if (failed !== null && (ok === null || failed > ok)) throw new CheckFailure(`원장 내보내기 최근 실패${code ? `: 단계 ${code}` : ''}. Web2 [원장] 화면에서 [지금 Drive로 내보내기]로 다시 시도하세요.`);
  if (ok === null) throw new CheckFailure('원장 내보내기 기록 없음: Web2 [원장] 화면에서 [지금 Drive로 내보내기]를 한 번 누르세요.');
  const days = Math.floor((now - ok) / DAY);
  if (now - ok > STALE_DAYS * DAY) throw new CheckFailure(`원장 내보내기가 ${days}일 동안 없었습니다. Web2를 열면 자동으로 내보내며, [원장] 화면에서 바로 할 수도 있습니다.`);
  return new Date(ok).toISOString();
}

async function once({ secret, fetcher, url, timeoutMs, now }) {
  let response;
  try { response = await fetcher(url, { method: 'GET', headers: { 'x-drive-summary-cron-secret': secret }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new CheckFailure('상태 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true }); }
  let data = null;
  try { data = await response.json(); } catch { /* 아래에서 실패로 본다. */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) throw new CheckFailure('비밀값 불일치: Supabase Edge Function 비밀값 DRIVE_SUMMARY_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다.');
  if (response.status === 405) throw new CheckFailure('원장 상태 읽기가 아직 배포되지 않았습니다(drive-summary 재배포 필요).');
  if (!response.ok || data?.ok !== true) throw new CheckFailure(`상태 읽기 실패: HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 });
  return judge(data.ledger, now());
}

export async function runCheck({ secret, fetcher = fetch, url = STATUS_URL, timeoutMs = 60000, retryDelayMs = 60000, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new CheckFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 DRIVE_SUMMARY_CRON_SECRET이 없습니다.');
  try { return await once({ secret, fetcher, url, timeoutMs, now }); }
  catch (error) {
    if (!(error instanceof CheckFailure) || !error.retryable) throw error;
    await sleep(retryDelayMs);
    return once({ secret, fetcher, url, timeoutMs, now });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const at = await runCheck({ secret: process.env.DRIVE_SUMMARY_CRON_SECRET });
    console.log(`원장 내보내기 정상: 마지막 성공 ${at}`);
  } catch (error) {
    const message = error instanceof CheckFailure ? error.message : '원장 내보내기 점검 실패(예상하지 못한 오류)';
    console.log(`::error title=원장 내보내기 점검::${message}`);
    process.exitCode = 1;
  }
}
