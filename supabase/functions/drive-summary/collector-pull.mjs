// S52-46 FEED-최신화즉시수집 2/3: POST ?action=collector_pull — 통화·텔레그램 [최신화] "지금 한 번 수집".
// 설계 docs/design/feed-pull-now.md 2절 (나)·4절 차례 2. 명진 결정 11/08 08:41(F1=(나), F2=사람마다 하루 20번·3분 간격).
// - 사람 입구: 소유자 JWT만(core authorize, cron·수집 비밀 머리글은 거절). 몸통은 {source: 'telegram'|'call'}뿐(작업공간·주소 값 안 받음).
// - 운영자 확인: 서버가 service_role로 app_operator_feature_workspace('telegram'|'calls')를 불러 로그인 본인 작업공간과 같을 때만(화면 숨김 아님).
// - 횟수: DB 함수 app_feed_pull_take(20261108040000)가 센다. 간격·하루 초과는 429(웹 앱을 부르지 않음). 간격은 retry_after(초)도 싣는다(공용 런타임이 error.retryAfter로 넘김).
// - 웹 앱 깨우기: 주소·비밀값은 Supabase 비밀값(COLLECTOR_PULL_URL·COLLECTOR_PULL_SECRET)에만. 웹 앱은 머리글을 못 읽으므로 비밀값은 몸통에 넣는다.
//   10초 제한, 응답은 {ok:true}·{ok:false}인지만 보고 버린다(S53-11: 실패 까닭은 wake() 위 표). 로그·응답에 주소·비밀값·응답 원문을 남기지 않는다.
export const PULL_SOURCES = Object.freeze(['telegram', 'call']);
export const PULL_FEATURE = Object.freeze({ telegram: 'telegram', call: 'calls' });
export const PULL_BODY_BYTES = 200;
export const PULL_WAKE_TIMEOUT_MS = 10000;
const WAKE_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;

export class PullError extends Error {
  constructor(code, status, extra = null) { super(code); this.status = status; this.extra = extra; }
}

// 몸통: 정확히 {source}. 그 밖의 칸·큰 몸통은 null.
export function parsePullBody(text) {
  if (typeof text !== 'string' || !text || new TextEncoder().encode(text).length > PULL_BODY_BYTES) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'source' || !PULL_SOURCES.includes(body.source)) return null;
  return { source: body.source };
}
export const pullWakeUrlOk = url => typeof url === 'string' && WAKE_URL.test(url);

// app_feed_pull_take 결과 → 응답(또는 PullError). 모양이 다르면 서버 오류로 본다.
export function pullTakeOutcome(value) {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || typeof v !== 'object') throw new PullError('PULL_COUNT_FAILED', 502);
  const left = Number.isInteger(v.left) && v.left >= 0 && v.left <= 20 ? v.left : 0;
  if (v.ok === true) return { left };
  if (v.reason === 'cooldown') {
    const wait = Number.isInteger(v.wait_s) && v.wait_s > 0 && v.wait_s <= 180 ? v.wait_s : 180;
    throw new PullError('PULL_COOLDOWN', 429, { wait_s: wait, retry_after: wait, left });
  }
  if (v.reason === 'daily') throw new PullError('PULL_DAILY_LIMIT', 429, { wait_s: null, left: 0 });
  throw new PullError('PULL_COUNT_FAILED', 502);
}

/**
 * @param {{ env: Record<string, string | undefined>, fetcher: typeof fetch, now: () => Date,
 *   authorize: (req: Request) => Promise<{ workspaceId: string, ownerId: string | null }>,
 *   secretHeadersPresent: (req: Request) => boolean }} deps
 */
export function createCollectorPull({ env, fetcher, now, authorize, secretHeadersPresent }) {
  const service = () => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' });
  async function rpc(name, body, code) {
    let response;
    try {
      response = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: service(), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    } catch { throw new PullError(code, 502); }
    if (response.status === 404) { try { await response.body?.cancel(); } catch { /* ignore */ } throw new PullError('PULL_NOT_READY', 503); }
    if (!response.ok) { try { await response.body?.cancel(); } catch { /* ignore */ } throw new PullError(code, 502); }
    try { return await response.json(); } catch { throw new PullError(code, 502); }
  }
  // S53-11: 깨우기 실패를 까닭별 코드로 나눈다(상태 번호는 모두 502). 화면이 코드별 한 줄을 고른다.
  //   PULL_WAKE_REFUSED     웹 앱이 {ok:false} — 비밀값 불일치·몸통 모양 다름(웹 앱이 까닭을 알려 주지 않으므로 둘을 나누지 않음)
  //   PULL_WAKE_TIMEOUT     10초 안에 답 없음
  //   PULL_WAKE_UNREACHABLE 연결 자체가 안 됨
  //   PULL_WAKE_HTTP        HTTP 오류 또는 {ok:true|false}가 아닌 답(예: 로그인 화면 HTML — 웹 앱 접근 설정)
  // 응답 원문·주소·비밀값은 코드에도 로그에도 싣지 않는다.
  async function wake(source) {
    let response;
    try {
      response = await fetcher(env.COLLECTOR_PULL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.COLLECTOR_PULL_SECRET, source }), redirect: 'follow',
        signal: AbortSignal.timeout(PULL_WAKE_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error && typeof error === 'object' ? error.name : '';
      throw new PullError(name === 'TimeoutError' || name === 'AbortError' ? 'PULL_WAKE_TIMEOUT' : 'PULL_WAKE_UNREACHABLE', 502);
    }
    if (!response.ok) { try { await response.body?.cancel(); } catch { /* ignore */ } throw new PullError('PULL_WAKE_HTTP', 502); }
    let body = null;
    try { body = await response.json(); } catch (error) {
      const name = error && typeof error === 'object' ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') throw new PullError('PULL_WAKE_TIMEOUT', 502);
      body = null;
    }
    if (body && typeof body === 'object' && body.ok === true) return;
    if (body && typeof body === 'object' && !Array.isArray(body) && body.ok === false) throw new PullError('PULL_WAKE_REFUSED', 502);
    throw new PullError('PULL_WAKE_HTTP', 502);
  }
  return async function collectorPull(req) {
    const at = () => now().toISOString();
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new PullError('SERVER_CONFIG_MISSING', 503);
      if (secretHeadersPresent(req)) throw new PullError('UNAUTHORIZED', 401);
      const { workspaceId, ownerId } = await authorize(req);
      if (!ownerId) throw new PullError('UNAUTHORIZED', 401);
      const length = Number(req.headers.get('content-length') || 0);
      if (length > PULL_BODY_BYTES) throw new PullError('INVALID_BODY', 400);
      const body = parsePullBody(await req.text().catch(() => ''));
      if (!body) throw new PullError('INVALID_BODY', 400);
      const allowed = await rpc('app_operator_feature_workspace', { p_feature: PULL_FEATURE[body.source] }, 'FEATURE_CHECK_FAILED');
      if (typeof allowed !== 'string' || allowed !== workspaceId) throw new PullError('NOT_OPERATOR', 403);
      if (!pullWakeUrlOk(env.COLLECTOR_PULL_URL) || typeof env.COLLECTOR_PULL_SECRET !== 'string' || env.COLLECTOR_PULL_SECRET.length < 32) {
        throw new PullError('SERVER_CONFIG_MISSING', 503);
      }
      const requestedAt = at();
      const { left } = pullTakeOutcome(await rpc('app_feed_pull_take', { p_user: ownerId, p_workspace: workspaceId, p_source: body.source }, 'PULL_COUNT_FAILED'));
      await wake(body.source);
      return { status: 200, body: { ok: true, source: body.source, requested_at: requestedAt, left } };
    } catch (error) {
      const known = error instanceof PullError || (error && typeof error.status === 'number' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message));
      const code = known ? error.message : 'PULL_FAILED';
      const status = known ? error.status : 502;
      return { status, body: { ok: false, error: code, ...(error instanceof PullError && error.extra ? error.extra : {}), checked_at: at() } };
    }
  };
}
