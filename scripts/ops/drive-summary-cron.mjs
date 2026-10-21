// ORG-사본자동갱신: 하루 2번 예약 실행(.github/workflows/drive-summary-refresh.yml)이 부르는 스크립트.
// drive-summary를 x-drive-summary-cron-secret 헤더로 한 번 부르고, 성공(ok·updated_at)이 아니면 실패로 끝낸다.
// 비밀값은 환경변수로만 받고 출력하지 않는다. 응답 본문은 안전한 단계 코드·시각만 읽는다.
export const FUNCTION_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary';
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;

export class CronFailure extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'CronFailure';
    this.retryable = retryable;
  }
}

async function once({ secret, fetcher, url, timeoutMs }) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'x-drive-summary-cron-secret': secret },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CronFailure('사본 갱신 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* 본문이 JSON이 아니면 아래에서 실패로 본다. */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) {
    throw new CronFailure('비밀값 불일치: Supabase Edge Function 비밀값 DRIVE_SUMMARY_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다.');
  }
  if (!response.ok || data?.ok !== true) {
    throw new CronFailure(`사본 갱신 실패: HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 && !String(stage || '').startsWith('DRIVE_PUBLIC') });
  }
  if (typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at))) {
    throw new CronFailure('사본 갱신 응답에 갱신 시각이 없습니다.');
  }
  return data.updated_at;
}

// 네트워크·서버(5xx) 오류만 한 번 다시 시도한다. 인증 실패·공개 공유 발견 등은 바로 실패한다.
export async function runCron({ secret, fetcher = fetch, url = FUNCTION_URL, timeoutMs = 150000, retryDelayMs = 60000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) {
    throw new CronFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 DRIVE_SUMMARY_CRON_SECRET이 없습니다.');
  }
  try {
    return await once({ secret, fetcher, url, timeoutMs });
  } catch (error) {
    if (!(error instanceof CronFailure) || !error.retryable) throw error;
    await sleep(retryDelayMs);
    return once({ secret, fetcher, url, timeoutMs });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const updatedAt = await runCron({ secret: process.env.DRIVE_SUMMARY_CRON_SECRET });
    console.log(`Drive 읽기용 사본 갱신 성공: ${updatedAt}`);
  } catch (error) {
    const message = error instanceof CronFailure ? error.message : '사본 갱신 실패(예상하지 못한 오류)';
    console.log(`::error title=Drive 사본 갱신::${message}`);
    process.exitCode = 1;
  }
}
