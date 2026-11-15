// UPDATE-운영자전용기록업데이트소식 PR1: 개발 기록(app/release-notes/*.json 묶음)을 서버 표 app_release_notes에 넣는 입구.
// 부르는 쪽은 main의 Pages 배포 workflow(.github/workflows/pages-deploy.yml) 하나다. 새 비밀값 없이 GitHub Actions OIDC 토큰으로 확인한다:
//   서명(GitHub 공개 키, RS256)·발급자·대상(aud)·만료·저장소·main·그 workflow 파일·이벤트(push|workflow_dispatch)가 모두 맞을 때만.
// 맞으면 service_role로 app_release_notes_put(내용, 토큰의 커밋)을 부른다. 다른 요청은 401(토큰 없음·틀림) 또는 400(모양).
// 사용자 화면은 이 함수를 부르지 않는다(읽기는 DB 함수 app_release_notes_read가 운영자만). verify_jwt=false(GitHub 토큰은 Supabase JWT가 아님).
export const ISSUER = 'https://token.actions.githubusercontent.com';
export const AUDIENCE = 'web2-release-notes-sync';
export const REPOSITORY = 'mj880616/work';
export const WORKFLOW_REF = 'mj880616/work/.github/workflows/pages-deploy.yml@refs/heads/main';
export const BODY_MAX = 8_000_000;
const JWKS_URL = `${ISSUER}/.well-known/jwks`;

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}});
const b64url = text => {
  const pad = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
};
const decodeJson = part => JSON.parse(new TextDecoder().decode(b64url(part)));

/** GitHub OIDC 토큰의 내용(claims)이 이 입구에 맞는가. 맞으면 '' 아니면 이유. 서명은 따로 본다. */
export function claimProblem(claims, now = Date.now() / 1000) {
  if (!claims || typeof claims !== 'object') return 'claims';
  if (claims.iss !== ISSUER) return 'iss';
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(AUDIENCE)) return 'aud';
  if (typeof claims.exp !== 'number' || claims.exp < now - 30) return 'exp';
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return 'nbf';
  if (claims.repository !== REPOSITORY) return 'repository';
  if (claims.ref !== 'refs/heads/main') return 'ref';
  if (claims.job_workflow_ref !== WORKFLOW_REF && claims.workflow_ref !== WORKFLOW_REF) return 'workflow';
  if (!['push', 'workflow_dispatch'].includes(claims.event_name)) return 'event';
  if (typeof claims.sha !== 'string' || !/^[0-9a-f]{40}$/.test(claims.sha)) return 'sha';
  return '';
}

/** 묶은 기록 모양(빌드가 만든 {schema:1,current,notes:[{v,date,changes,checks}]}). 맞으면 '' 아니면 이유. */
export function notesProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1 || !Array.isArray(value.notes)) return 'shape';
  if (value.notes.length > 20000) return 'count';
  const lines = l => Array.isArray(l) && l.length <= 10 && l.every(x => typeof x === 'string' && x.length <= 300);
  for (const n of value.notes) {
    if (!n || typeof n !== 'object' || typeof n.v !== 'string' || n.v.length > 20 || typeof n.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(n.date)
      || !lines(n.changes) || !lines(n.checks ?? [])) return 'note';
  }
  return '';
}

export function createReleaseNotesSyncHandler({env, fetchImpl = fetch, subtle = crypto.subtle, now = () => Date.now() / 1000}) {
  let jwks = null, jwksAt = 0;
  async function keyFor(kid) {
    if (!jwks || now() - jwksAt > 3600 || !jwks.keys?.some(k => k.kid === kid)) {
      const res = await fetchImpl(JWKS_URL, {headers: {accept: 'application/json'}});
      if (!res.ok) throw new Error('JWKS');
      jwks = await res.json(); jwksAt = now();
    }
    const jwk = jwks.keys?.find(k => k.kid === kid && k.kty === 'RSA');
    if (!jwk) return null;
    return subtle.importKey('jwk', {kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true}, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
  }
  async function verify(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    let header, claims;
    try { header = decodeJson(parts[0]); claims = decodeJson(parts[1]); } catch { return null; }
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    const ok = await subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok || claimProblem(claims, now())) return null;
    return claims;
  }
  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, {status: 204});
    if (req.method !== 'POST') return json(405, {error: 'METHOD'});
    const auth = req.headers.get('authorization') || '';
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    if (!token) return json(401, {error: 'AUTH_REQUIRED'});
    let claims;
    try { claims = await verify(token); } catch { return json(503, {error: 'KEYS_UNAVAILABLE'}); }
    if (!claims) return json(401, {error: 'AUTH_INVALID'});
    const length = Number(req.headers.get('content-length') || 0);
    if (length > BODY_MAX) return json(413, {error: 'TOO_LARGE'});
    const text = await req.text();
    if (text.length > BODY_MAX) return json(413, {error: 'TOO_LARGE'});
    let notes;
    try { notes = JSON.parse(text); } catch { return json(400, {error: 'JSON'}); }
    const why = notesProblem(notes);
    if (why) return json(400, {error: 'SHAPE', why});
    const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return json(500, {error: 'NOT_READY'});
    const res = await fetchImpl(`${url}/rest/v1/rpc/app_release_notes_put`, {
      method: 'POST',
      headers: {apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json'},
      body: JSON.stringify({p_notes: notes, p_commit: claims.sha})
    });
    if (!res.ok) return json(502, {error: 'STORE_FAILED', status: res.status});
    return json(200, {ok: true, count: notes.notes.length, commit: claims.sha});
  };
}
