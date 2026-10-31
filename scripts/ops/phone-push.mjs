// APP-폰알림: 예약 실행(.github/workflows/phone-push-schedule.yml)이 부르는 스크립트.
// 예약 시각(cron 글자)이나 수동 실행 입력으로 slot을 정하고 phone-push POST ?action=run&slot=…(몸통 {})을 한 번 부른다.
// 비밀값은 환경변수로만 받고 출력하지 않는다. 응답은 slot·숫자·단계 코드만 읽는다(알림 제목·기기 토큰은 받지도 찍지도 않음).
export const FUNCTION_BASE = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/phone-push';
export const SLOTS = ['quarter', 'morning', 'evening', 'friday'];
export const SCHEDULE_SLOTS = {
  '4,19,34,49 * * * *': 'quarter',
  '3 23 * * *': 'morning',
  '22 9 * * *': 'evening',
  '23 6 * * 5': 'friday',
};
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const COUNT = v => (Number.isInteger(v) && v >= 0 ? v : null);

export class PushFailure extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'PushFailure';
    this.retryable = retryable;
  }
}

export function pickSlot({ schedule, input } = {}) {
  if (typeof schedule === 'string' && schedule.trim()) {
    const slot = SCHEDULE_SLOTS[schedule.trim()];
    if (!slot) throw new PushFailure('알 수 없는 예약 시각입니다(workflow cron과 스크립트 표가 다름).');
    return slot;
  }
  if (SLOTS.includes(input)) return input;
  throw new PushFailure('slot 입력이 없습니다(quarter·morning·evening·friday).');
}

async function post({ secret, fetcher, base, timeoutMs }, slot) {
  let response;
  try {
    response = await fetcher(`${base}?action=run&slot=${slot}`, {
      method: 'POST',
      headers: { 'x-phone-push-cron-secret': secret, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PushFailure('폰 알림 예약 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* JSON이 아니면 아래에서 실패 */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) {
    throw new PushFailure('비밀값 불일치: Supabase Edge Function 비밀값 PHONE_PUSH_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다(또는 함수 첫 배포 전).');
  }
  if (!response.ok || data?.ok !== true) {
    throw new PushFailure(`폰 알림 예약 실패(${slot}): HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 && stage !== 'SERVER_CONFIG_MISSING' });
  }
  const out = { slot: data.slot, workspaces: COUNT(data.workspaces), sent: COUNT(data.sent), pruned: COUNT(data.pruned) };
  if (out.slot !== slot || Object.values(out).some(v => v === null)) throw new PushFailure('폰 알림 예약 응답 모양이 다릅니다.');
  return out;
}

export async function runPush({ secret, schedule, input, fetcher = fetch, base = FUNCTION_BASE, timeoutMs = 120000, retryDelayMs = 20000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new PushFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 PHONE_PUSH_CRON_SECRET이 없습니다.');
  const slot = pickSlot({ schedule, input });
  const options = { secret, fetcher, base, timeoutMs };
  try { return await post(options, slot); } catch (error) {
    if (!(error instanceof PushFailure) || !error.retryable) throw error;
    await sleep(retryDelayMs);
    return post(options, slot);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = await runPush({ secret: process.env.PHONE_PUSH_CRON_SECRET, schedule: process.env.PHONE_PUSH_SCHEDULE, input: process.env.PHONE_PUSH_SLOT_INPUT });
    console.log(`${r.slot}: 받을 작업공간 ${r.workspaces} · 보냄 ${r.sent} · 지난 기록 정리 ${r.pruned}`);
  } catch (error) {
    const message = error instanceof PushFailure ? error.message : '폰 알림 예약 실패(예상하지 못한 오류)';
    console.log(`::error title=폰 알림 예약::${message}`);
    process.exitCode = 1;
  }
}
