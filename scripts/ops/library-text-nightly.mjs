// LIB-글자채우기야간: 매일 밤 예약 실행(.github/workflows/library-text-nightly.yml)이 부르는 스크립트.
// drive-summary POST ?action=text_backfill을 x-drive-summary-cron-secret 헤더로 최대 MAX_CALLS번 차례로 부른다(한 번에 자료 최대 5개).
// 남은 것이 없거나 더 읽을 것이 없으면 멈춘다. 비밀값은 환경변수로만 받고 출력하지 않는다. 응답은 건수·단계 코드만 읽는다.
export const FUNCTION_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/drive-summary?action=text_backfill';
export const MAX_CALLS = 4; // 하룻밤 최대 20개(5개 × 4번).
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const COUNT = value => (Number.isInteger(value) && value >= 0 ? value : null);

export class NightlyFailure extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'NightlyFailure';
    this.retryable = retryable;
  }
}

async function once({ secret, fetcher, url, timeoutMs }) {
  let response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'x-drive-summary-cron-secret': secret }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new NightlyFailure('글자 읽기 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* JSON이 아니면 아래에서 실패 */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) {
    throw new NightlyFailure('비밀값 불일치: Supabase Edge Function 비밀값 DRIVE_SUMMARY_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다.');
  }
  if (!response.ok || data?.ok !== true) {
    throw new NightlyFailure(`글자 읽기 실패: HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 && stage !== 'SERVER_CONFIG_MISSING' });
  }
  const counts = { asked: COUNT(data.asked), ready: COUNT(data.ready), error: COUNT(data.error), gave_up: COUNT(data.gave_up), remaining: COUNT(data.remaining) };
  if (Object.values(counts).some(v => v === null)) throw new NightlyFailure('글자 읽기 응답에 건수가 없습니다(함수가 아직 이 기능 전 판일 수 있음).');
  const doneError = typeof data.done_error === 'string' && STAGE.test(data.done_error) ? data.done_error : null;
  return { ...counts, doneAt: typeof data.done_at === 'string' ? data.done_at : null, doneError };
}

// 네트워크·서버(5xx) 오류만 한 번 다시 시도한다.
async function call(options) {
  try { return await once(options); } catch (error) {
    if (!(error instanceof NightlyFailure) || !error.retryable) throw error;
    await options.sleep(options.retryDelayMs);
    return once(options);
  }
}

export async function runNightly({ secret, fetcher = fetch, url = FUNCTION_URL, maxCalls = MAX_CALLS, timeoutMs = 170000, retryDelayMs = 60000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new NightlyFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 DRIVE_SUMMARY_CRON_SECRET이 없습니다.');
  const total = { calls: 0, asked: 0, ready: 0, error: 0, gave_up: 0, remaining: null, doneAt: null, doneError: null };
  for (let i = 0; i < maxCalls; i++) {
    const r = await call({ secret, fetcher, url, timeoutMs, retryDelayMs, sleep });
    total.calls++;
    for (const key of ['asked', 'ready', 'error', 'gave_up']) total[key] += r[key];
    total.remaining = r.remaining; total.doneAt = r.doneAt; total.doneError = r.doneError;
    if (r.remaining === 0 || r.asked === 0) break; // 다 끝났거나, 지금 읽을 수 있는 것이 없음(다른 호출이 읽는 중 등).
  }
  return total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const t = await runNightly({ secret: process.env.DRIVE_SUMMARY_CRON_SECRET });
    console.log(`예전 자료 글자 읽기: ${t.calls}번 호출, 읽음 ${t.ready} · 못 읽음 ${t.error} · 끊겨 포기 ${t.gave_up}, 남은 자료 ${t.remaining}`);
    if (t.remaining === 0) console.log(t.doneAt ? `모두 끝남(홈 알림 기록 ${t.doneAt})` : `모두 끝났지만 홈 알림 기록 실패: ${t.doneError || '알 수 없음'}`);
    if (t.remaining === 0 && !t.doneAt) console.log(`::warning title=글자 읽기 끝 기록::${t.doneError || '알 수 없음'}`);
  } catch (error) {
    const message = error instanceof NightlyFailure ? error.message : '글자 읽기 실패(예상하지 못한 오류)';
    console.log(`::error title=예전 자료 글자 읽기::${message}`);
    process.exitCode = 1;
  }
}
