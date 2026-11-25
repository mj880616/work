// SEC-Web2CSP 보고 받는 곳(I-5, 2026-11-25 명진 결정 "추천대로"): Web2 첫 화면·로그인 화면의 보고 전용 CSP(cloudflare/web2-csp.mjs)가
// 위반을 보내는 입구. 막는 단계(enforce)로 가기 전 2주 동안 '어떤 지시어가 어느 출처를 몇 번' 걸렸는지 숫자로만 모은다.
// - 받는 모양: Reporting API(application/reports+json, type csp-violation)와 옛 report-uri(application/csp-report).
// - 남기는 것: 지시어(정해진 목록만)·막힌 주소의 출처(origin, 소문자) 또는 낱말(inline·eval·data·blob 등)·개수. 날짜는 DB가 붙인다(서울 날짜).
// - 남기지 않는 것: 쿼리·경로·조각(#)·토큰·사용자 id·문서 주소·코드 조각(sample)·줄 번호·IP·브라우저 정보. 함수는 로그도 쓰지 않는다.
// - 보고를 보낸 문서가 Web2 주소(허용 출처)일 때만 센다. 크기 16KB·보고 20개 넘으면 거절, 초당 요청 수 넘으면 429.
// 로그인 없이 브라우저가 보내므로 verify_jwt=false(docs/web2-env6b-edge-source.md 5절). DB 쓰기는 service_role로 app_csp_report_add 하나뿐.
export const BODY_MAX = 16384;
export const REPORTS_MAX = 20;
export const PER_SECOND_MAX = 30;

// 정책(cloudflare/web2-csp.mjs)에 있거나 브라우저가 effectiveDirective로 돌려주는 지시어만. DB 검사 제약과 같은 목록이다.
export const DIRECTIVES = Object.freeze([
  'default-src', 'script-src', 'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem', 'style-src-attr',
  'img-src', 'media-src', 'font-src', 'connect-src', 'worker-src', 'frame-src', 'child-src', 'manifest-src',
  'object-src', 'base-uri', 'form-action', 'frame-ancestors', 'trusted-types', 'require-trusted-types-for'
]);
const DIRECTIVE_SET = new Set(DIRECTIVES);
// 주소가 아닌 막힌 대상(브라우저가 낱말로 알림).
const WORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink']);
const TYPES = ['application/reports+json', 'application/csp-report', 'application/json'];

const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: body === undefined ? {'cache-control': 'no-store'} : {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
});

/** 지시어 이름을 정해진 목록 안으로. 'script-src-elem 'self'…' 같은 옛 violated-directive는 첫 낱말만 본다. 모르면 ''. */
export function directiveOf(value) {
  const name = String(value ?? '').trim().toLowerCase().split(/\s+/)[0] || '';
  return DIRECTIVE_SET.has(name) ? name : '';
}

/** 막힌 주소 → 출처(origin)나 낱말 하나. 쿼리·경로·아이디·비밀번호는 버린다. */
export function blockedOf(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'other';
  const word = text.toLowerCase();
  if (WORDS.has(word)) return word;
  if (word === 'data' || word.startsWith('data:')) return 'data';
  if (word === 'blob' || word.startsWith('blob:')) return 'blob';
  if (/^(chrome|moz|safari(-web)?|ms-browser)-extension:/.test(word)) return 'extension';
  let url;
  try { url = new URL(text); } catch { return 'other'; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'other';
  const origin = url.origin.toLowerCase();
  return /^https?:\/\/[a-z0-9.-]{1,80}(:[0-9]{1,5})?$/.test(origin) ? origin : 'other';
}

function originOf(value) {
  try { return new URL(String(value ?? '')).origin; } catch { return ''; }
}

/** 몸통(이미 JSON으로 읽은 값) → [{directive, blocked, hits}] 합친 목록. 모양이 틀리면 null. 허용 출처 밖 문서의 보고는 뺀다. */
export function reportItems(value, type, origins) {
  let reports;
  if (type === 'application/csp-report' || (value && !Array.isArray(value) && typeof value === 'object' && 'csp-report' in value)) {
    const r = value?.['csp-report'];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    reports = [{document: r['document-uri'], directive: r['effective-directive'] || r['violated-directive'], blocked: r['blocked-uri']}];
  } else {
    if (!Array.isArray(value) || value.length === 0 || value.length > REPORTS_MAX) return null;
    reports = [];
    for (const r of value) {
      if (!r || typeof r !== 'object' || Array.isArray(r) || !r.body || typeof r.body !== 'object') return null;
      if (r.type !== 'csp-violation') continue;
      reports.push({document: r.body.documentURL ?? r.url, directive: r.body.effectiveDirective, blocked: r.body.blockedURL});
    }
  }
  const counts = new Map();
  for (const r of reports) {
    if (!origins.has(originOf(r.document))) continue;
    const directive = directiveOf(r.directive);
    if (!directive) continue;
    const key = `${directive} ${blockedOf(r.blocked)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([key, hits]) => { const [directive, blocked] = key.split(' '); return {directive, blocked, hits}; });
}

/** 크기 상한까지만 읽는다. 넘으면 null. */
async function readLimited(req, max) {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

export function createCspReportHandler({env, origins, fetchImpl = fetch, now = () => Date.now(), perSecond = PER_SECOND_MAX}) {
  // 함수 한 벌(isolate) 안의 초당 횟수 제한. 여러 벌이 떠도 DB 함수가 하루 줄 수 상한을 따로 지킨다.
  let second = -1, used = 0;
  return async function handle(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: {'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400'}});
    }
    if (req.method !== 'POST') return reply(405, {error: 'METHOD'});
    const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(type)) return reply(415, {error: 'TYPE'});
    const length = Number(req.headers.get('content-length') || 0);
    if (!Number.isFinite(length) || length > BODY_MAX) return reply(413, {error: 'TOO_LARGE'});
    const tick = Math.floor(now() / 1000);
    if (tick !== second) { second = tick; used = 0; }
    if (++used > perSecond) return reply(429, {error: 'SLOW_DOWN'});
    const text = await readLimited(req, BODY_MAX);
    if (text === null) return reply(413, {error: 'TOO_LARGE'});
    let value;
    try { value = JSON.parse(text); } catch { return reply(400, {error: 'JSON'}); }
    const items = reportItems(value, type, origins);
    if (!items) return reply(400, {error: 'SHAPE'});
    if (!items.length) return reply(204);
    const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return reply(500, {error: 'NOT_READY'});
    const res = await fetchImpl(`${url}/rest/v1/rpc/app_csp_report_add`, {
      method: 'POST',
      headers: {apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json'},
      body: JSON.stringify({p_items: items})
    });
    if (!res.ok) return reply(502, {error: 'STORE_FAILED'});
    return reply(204);
  };
}
