// FILES-통합 2-②b(S49-32): 예약 실행(.github/workflows/cloud-files-jobs-cron.yml)이 5분마다 부르는 스크립트.
// cloud-files를 비밀 머리(x-cloud-files-cron-secret)로 한 번 부른다. 서버는 운영자 작업공간에서 '사람이 시작한 클라우드 전송' 중
// 잡은 실행 없이 멈춘 줄이 있을 때만 다음 실행 한 번을 깨운다(화면을 닫아도 전송 계속, 설계 H-6).
// cloud-files는 verify_jwt=true라 게이트를 지나려면 JWT 모양 열쇠가 필요하다: 프로젝트의 anon(legacy JWT) 열쇠를 CLOUD_FILES_GATEWAY_KEY로 받는다
// (함수 안 job_tick이 게이트를 지나는 방식과 같음). 그 열쇠만으로는 아무것도 못 하고, 실제 문은 함수 코드의 비밀 머리 비교다.
// 비밀값은 환경변수로만 받고 출력하지 않는다. 응답은 건수·참거짓·단계 코드만 읽는다(파일 이름·작업 내용은 받지도 찍지도 않음).
export const FUNCTION_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/cloud-files';
const STAGE = /^[a-z_]{1,40}$/;

export class SweepFailure extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'SweepFailure';
    this.retryable = retryable;
  }
}

async function once({ secret, gateway, fetcher, url, timeoutMs }) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway}`, apikey: gateway, 'x-cloud-files-cron-secret': secret, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SweepFailure('전송 이어 받기 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* JSON이 아니면 아래에서 실패 */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) {
    throw new SweepFailure('열쇠 불일치: Supabase Edge 비밀값 CLOUD_FILES_CRON_SECRET이 없거나 GitHub 비밀값과 다르거나, 게이트 열쇠 CLOUD_FILES_GATEWAY_KEY가 맞지 않습니다(또는 이 기능 전 판의 함수).');
  }
  if (!response.ok || data?.ok !== true) {
    throw new SweepFailure(`전송 이어 받기 실패: HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 });
  }
  if (!Number.isInteger(data.active) || data.active < 0 || typeof data.kicked !== 'boolean') throw new SweepFailure('전송 이어 받기 응답 모양이 다릅니다.');
  return { active: data.active, kicked: data.kicked };
}

// 네트워크·서버(5xx) 오류만 한 번 다시 시도한다.
export async function runSweep({ secret, gateway, fetcher = fetch, url = FUNCTION_URL, timeoutMs = 30000, retryDelayMs = 15000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new SweepFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 CLOUD_FILES_CRON_SECRET이 없습니다.');
  if (typeof gateway !== 'string' || !gateway.trim()) throw new SweepFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 CLOUD_FILES_GATEWAY_KEY가 없습니다.');
  const options = { secret, gateway, fetcher, url, timeoutMs };
  try { return await once(options); } catch (error) {
    if (!(error instanceof SweepFailure) || !error.retryable) throw error;
    await sleep(retryDelayMs);
    return once(options);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = await runSweep({ secret: process.env.CLOUD_FILES_CRON_SECRET, gateway: process.env.CLOUD_FILES_GATEWAY_KEY });
    console.log(r.kicked ? `멈춘 전송을 다시 깨움(이어 갈 줄 ${r.active})` : `깨울 것 없음(이어 갈 줄 ${r.active})`);
  } catch (error) {
    const message = error instanceof SweepFailure ? error.message : '전송 이어 받기 실패(예상하지 못한 오류)';
    console.log(`::error title=파일 전송 이어 받기::${message}`);
    process.exitCode = 1;
  }
}
