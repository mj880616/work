// NEWS-클리핑 B: 하루 3번 예약 실행(.github/workflows/news-feed.yml)이 부르는 스크립트.
// news-feed POST ?action=run_plan(켠 매체 키 목록) → 매체마다 run {step:'media',source} → run {step:'keywords'} → {step:'pending'} → {step:'titles'}(외국어 제목만 한국어로) → {step:'prune'}.
// 비밀값은 환경변수로만 받고 출력하지 않는다. 응답은 키·건수·단계 코드만 읽는다(제목·본문·주소·키워드는 받지도 찍지도 않음).
export const FUNCTION_BASE = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/news-feed';
const KEY = /^news-[a-z0-9-]{1,34}$/;
const CODE = /^[a-z0-9_-]{1,40}$/;
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const COUNT = v => (Number.isInteger(v) && v >= 0 ? v : 0);
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
      headers: { 'x-news-feed-cron-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FeedFailure('뉴스 클리핑 수집 요청이 서버에 닿지 않았습니다(네트워크·시간 초과).', { retryable: true });
  }
  let data = null;
  try { data = await response.json(); } catch { /* JSON이 아니면 아래에서 실패 */ }
  const stage = typeof data?.error === 'string' && STAGE.test(data.error) ? data.error : null;
  if (response.status === 401) {
    throw new FeedFailure('비밀값 불일치: Supabase Edge Function 비밀값 NEWS_FEED_CRON_SECRET이 등록되지 않았거나 GitHub 비밀값과 다릅니다(또는 함수 첫 배포 전).');
  }
  if (!response.ok || data?.ok !== true) {
    throw new FeedFailure(`뉴스 클리핑 수집 실패(${action}): HTTP ${response.status}${stage ? `, 단계 ${stage}` : ''}`, { retryable: response.status >= 500 && stage !== 'SERVER_CONFIG_MISSING' });
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

// 단계 하나가 실패해도 다음 단계는 계속한다. 비밀값 불일치(401)는 바로 멈춘다.
export async function runNewsFeed({ secret, fetcher = fetch, base = FUNCTION_BASE, timeoutMs = 150000, retryDelayMs = 30000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (typeof secret !== 'string' || !secret.trim()) throw new FeedFailure('비밀값 미등록: GitHub 저장소 Actions 비밀값 NEWS_FEED_CRON_SECRET이 없습니다.');
  const options = { secret, fetcher, base, timeoutMs, retryDelayMs, sleep };
  const plan = await call(options, 'run_plan', {});
  if (!Array.isArray(plan.media)) throw new FeedFailure('수집 계획 응답 모양이 다릅니다.');
  const steps = [...plan.media.filter(k => typeof k === 'string' && KEY.test(k)).slice(0, MAX_SOURCES).map(source => ({ step: 'media', source })),
    { step: 'keywords' }, { step: 'pending' }, { step: 'titles' }, { step: 'prune' }];
  const results = [];
  for (const s of steps) {
    const name = s.source ?? s.step;
    try {
      const r = await call(options, 'run', s);
      results.push({ name, status: typeof r.status === 'string' && CODE.test(r.status) ? r.status : 'ok',
        n: COUNT(r.inserted ?? r.done ?? r.removed), deferred: COUNT(r.deferred) });
    } catch (error) {
      if (error instanceof FeedFailure && /비밀값/.test(error.message)) throw error;
      results.push({ name, status: 'call_failed', n: 0, deferred: 0 });
    }
  }
  return { results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const t = await runNewsFeed({ secret: process.env.NEWS_FEED_CRON_SECRET });
    for (const r of t.results) console.log(`${r.name}: ${r.status} · ${r.n}건 · 다음으로 ${r.deferred}`);
    const failed = t.results.filter(r => r.status === 'call_failed');
    if (failed.length) console.log(`::warning title=뉴스 클리핑 수집::${failed.length}단계 호출 실패(${failed.map(r => r.name).join(', ')})`);
  } catch (error) {
    const message = error instanceof FeedFailure ? error.message : '뉴스 클리핑 수집 실패(예상하지 못한 오류)';
    console.log(`::error title=뉴스 클리핑 수집::${message}`);
    process.exitCode = 1;
  }
}
