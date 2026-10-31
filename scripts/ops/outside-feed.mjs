// OUTSIDE-바깥성명 ③: 하루 3번 예약 실행(.github/workflows/outside-feed.yml)이 부르는 스크립트.
// outside-feed POST ?action=run_plan(켠 단체 키 목록 + 2년 지난 글 문장 정리) → 단체마다 POST ?action=run {source} 차례로.
// 비밀값은 환경변수로만 받고 출력하지 않는다. 응답은 단체 키·건수·단계 코드만 읽는다(제목·본문·주소는 받지도 찍지도 않음).
export const FUNCTION_BASE = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/outside-feed';
const KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CODE = /^[a-z0-9_-]{1,40}$/;
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const COUNT = v => (Number.isInteger(v) && v >= 0 ? v : null);
export const MAX_SOURCES = 40;

export class FeedFailure extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'FeedFailure';
    this.retryable = retryable;
  }
}

async function post({ secret, fetcher, base, timeoutMs }, action, body) {
  let response;
  try {
    response = await fetcher(`${base}?action=${action}`, {
      method: 'POST',
      headers: { 'x-outside-feed-cron-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FeedFailure('바깥 성명 수집 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* JSON이 아니면 아래에서 실패 */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) {
    throw new FeedFailure('비밀값 불일치: Supabase Edge Function 비밀값 OUTSIDE_FEED_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다(또는 함수 첫 배포 전).');
  }
  if (!response.ok || data?.ok !== true) {
    throw new FeedFailure(`바깥 성명 수집 실패(${action}): HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 && stage !== 'SERVER_CONFIG_MISSING' });
  }
  return data;
}

async function call(options, action, body) {
  try { return await post(options, action, body); } catch (error) {
    if (!(error instanceof FeedFailure) || !error.retryable) throw error;
    await options.sleep(options.retryDelayMs);
    return post(options, action, body);
  }
}

// 단체 하나가 실패해도 다음 단체는 계속한다. 비밀값 불일치(401)는 바로 멈춘다.
export async function runFeed({ secret, fetcher = fetch, base = FUNCTION_BASE, timeoutMs = 150000, retryDelayMs = 30000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new FeedFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 OUTSIDE_FEED_CRON_SECRET이 없습니다.');
  const options = { secret, fetcher, base, timeoutMs, retryDelayMs, sleep };
  const plan = await call(options, 'run_plan', {});
  if (!Array.isArray(plan.sources) || COUNT(plan.pruned) === null) throw new FeedFailure('수집 계획 응답 모양이 다릅니다.');
  const keys = plan.sources.filter(k => typeof k === 'string' && KEY.test(k)).slice(0, MAX_SOURCES);
  const results = [];
  for (const source of keys) {
    try {
      const r = await call(options, 'run', { source });
      const counts = { listed: COUNT(r.listed), fresh: COUNT(r.fresh), inserted: COUNT(r.inserted), skipped: COUNT(r.skipped), deferred: COUNT(r.deferred) };
      if (r.source !== source || Object.values(counts).some(v => v === null)) throw new FeedFailure('수집 응답에 건수가 없습니다.');
      results.push({ source, status: typeof r.status === 'string' && CODE.test(r.status) ? r.status : 'unknown', ...counts });
    } catch (error) {
      if (error instanceof FeedFailure && /비밀값/.test(error.message)) throw error;
      results.push({ source, status: 'call_failed', listed: 0, fresh: 0, inserted: 0, skipped: 0, deferred: 0 });
    }
  }
  return { pruned: plan.pruned, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const t = await runFeed({ secret: process.env.OUTSIDE_FEED_CRON_SECRET });
    if (!t.results.length) console.log('켠 단체 없음(화면에서 단체를 켜면 다음 실행부터 읽음).');
    for (const r of t.results) console.log(`${r.source}: ${r.status} · 목록 ${r.listed} · 새 글 ${r.fresh} · 넣음 ${r.inserted} · 건너뜀 ${r.skipped} · 다음으로 ${r.deferred}`);
    if (t.pruned) console.log(`2년 지난 글 문장 정리: ${t.pruned}건`);
    const failed = t.results.filter(r => r.status === 'call_failed');
    if (failed.length) console.log(`::warning title=바깥 성명 수집::단체 ${failed.length}곳 호출 실패(${failed.map(r => r.source).join(', ')})`);
  } catch (error) {
    const message = error instanceof FeedFailure ? error.message : '바깥 성명 수집 실패(예상하지 못한 오류)';
    console.log(`::error title=바깥 성명 수집::${message}`);
    process.exitCode = 1;
  }
}
