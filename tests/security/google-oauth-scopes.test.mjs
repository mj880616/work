// S71-01 AUTH-구글권한나누기(명진 2026-11-26 10:02 'ㄱ'): 구글 창구 둘. 합성 값만(비밀값·네트워크 없음).
// - 심사용 창구(모든 사람): 요청 권한은 openid·email·calendar.events·calendar.calendarlist.readonly·tasks·drive.file 안에서만.
//   drive(전체)·tasks.readonly 없음, include_granted_scopes 없음. 구글 콘솔 '데이터 액세스'와 같은 목록.
// - 명진 전용 창구: 운영자 + Edge 비밀값 두 개일 때만, drive 하나. 운영자가 아니면 화면 값과 상관없이 늘 심사용 창구·drive.file.
// - 저장소 전체에서 drive 전체 권한을 '요청'하는 곳은 명진 전용 창구 하나뿐.
// - 토큰 새로 받기는 그 연결을 내준 창구의 앱 값으로(공용 도우미 하나).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const M = await import('../../supabase/functions/_shared/google-oauth-clients.mjs');
const { workspaceDriveToken, WorkspaceDriveError } = await import('../../supabase/functions/_shared/workspace-drive-token.ts');
const ROOT = new URL('../../', import.meta.url).pathname;
const read = p => readFileSync(join(ROOT, p), 'utf8');
const G = 'https://www.googleapis.com/auth/';
const ALLOWED = ['openid', 'email', G + 'calendar.events', G + 'calendar.calendarlist.readonly', G + 'tasks', G + 'drive.file'];
const FULL = G + 'drive';
const FULL_ID = 'synthetic-full.apps.googleusercontent.com', FULL_SECRET = 'synthetic-full-secret';
const envWith = (o = {}) => k => o[k];
const SECRETS = envWith({ GOOGLE_DRIVE_FULL_CLIENT_ID: FULL_ID, GOOGLE_DRIVE_FULL_CLIENT_SECRET: FULL_SECRET });
const CFG = { google_client_id: 'synthetic-review-client', google_client_secret: 'synthetic-review-secret' };
const scopeOf = url => new URL(url).searchParams.get('scope').split(' ');

test('심사용 창구 목록은 콘솔에 맞출 여섯 글자 그대로', () => {
  assert.deepEqual([...M.REVIEW_SCOPES].sort(), [...ALLOWED].sort());
  assert.equal(M.REVIEW_SCOPES.includes(FULL), false);
  assert.equal(M.REVIEW_SCOPES.some(s => /tasks\.readonly|drive\.readonly|gmail/.test(s)), false);
  assert.equal(M.DRIVE_FULL_SCOPE, FULL);
});

test('심사용 창구 주소: 목록 밖 권한이 섞이면 만들지 않고, include_granted_scopes가 없다', () => {
  const url = M.reviewAuthUrl({ cfg: CFG, redirectUri: 'https://sb.example.test/cb', scopes: [M.SCOPE.openid, M.SCOPE.email, M.SCOPE.tasks], state: 'tasks.web.x' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), CFG.google_client_id);
  assert.equal(u.searchParams.get('include_granted_scopes'), null);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.doesNotMatch(url, /synthetic-review-secret/);
  for (const bad of [[FULL], [M.SCOPE.driveFile, FULL], [G + 'tasks.readonly'], [G + 'drive.readonly'], []]) {
    assert.throws(() => M.reviewAuthUrl({ cfg: CFG, redirectUri: 'https://sb.example.test/cb', scopes: bad, state: 's' }), /google_scope_not_allowed/, bad.join(' '));
  }
});

test('할 일·달력·Drive 연결 시작이 요청하는 권한은 모두 심사용 목록 안(drive·tasks.readonly 없음)', () => {
  const names = src => [...src.matchAll(/scopes:\[([^\]]*)\]/g)].flatMap(m => m[1].split(',').map(x => x.trim().replace(/^SCOPE\./, '')));
  for (const [fn, want] of [['google-tasks', ['openid', 'email', 'calendarEvents', 'calendarList', 'tasks']], ['google-calendar', ['openid', 'email', 'calendarEvents', 'calendarList']]]) {
    const src = read(`supabase/functions/${fn}/index.ts`), code = src.replace(/^\s*\/\/.*$/gm, '');
    assert.deepEqual(names(code), want, fn);
    for (const n of want) assert.ok(ALLOWED.includes(M.SCOPE[n]), fn + ' ' + n);
    assert.doesNotMatch(code, /include_granted_scopes|accounts\.google\.com|scope:'(openid|https)/, fn + ': 동의 화면 주소·권한 목록은 도우미로만');
    assert.match(code, /reviewAuthUrl\(\{cfg,redirectUri:CALLBACK,/, fn);
  }
  // 할 일 + 달력 + Drive(drive.file)를 다 합쳐도 여섯을 넘지 않는다.
  const union = new Set([...scopeOf(M.reviewAuthUrl({ cfg: CFG, redirectUri: 'x://cb', scopes: [M.SCOPE.openid, M.SCOPE.email, M.SCOPE.calendarEvents, M.SCOPE.calendarList, M.SCOPE.tasks], state: 's' })),
    ...M.driveStartPlan({ isOperator: false, env: SECRETS }).scopes]);
  assert.deepEqual([...union].sort(), [...ALLOWED].sort());
});

test('운영자 + 비밀값 있음 → 명진 전용 클라이언트 ID와 drive 하나', () => {
  const plan = M.driveStartPlan({ isOperator: true, env: SECRETS });
  assert.equal(plan.kind, 'full');
  assert.deepEqual(plan.scopes, [FULL]);
  const url = M.fullDriveAuthUrl({ client: plan.client, redirectUri: 'https://sb.example.test/cb', state: 'drive.full.x' });
  assert.equal(new URL(url).searchParams.get('client_id'), FULL_ID);
  assert.deepEqual(scopeOf(url), [FULL]);
  assert.equal(new URL(url).searchParams.get('include_granted_scopes'), null);
  assert.doesNotMatch(url, /synthetic-full-secret/);
  assert.equal(M.stateClientKind('drive.full.won.abc'), 'full');
  assert.equal(M.stateClientKind('drive.won.abc'), 'review');
});

test('운영자 아님 → 비밀값·화면 값과 상관없이 늘 심사용 창구·drive.file', () => {
  for (const isOperator of [false, undefined, 'true', 1, null]) {
    const plan = M.driveStartPlan({ isOperator, env: SECRETS });
    assert.deepEqual([plan.kind, plan.client, plan.scopes], ['review', null, [M.SCOPE.driveFile]], String(isOperator));
  }
  // 운영자라도 비밀값이 없거나 모양이 이상하면 심사용 창구 그대로(깨지지 않음).
  for (const env of [envWith(), envWith({ GOOGLE_DRIVE_FULL_CLIENT_ID: FULL_ID }), envWith({ GOOGLE_DRIVE_FULL_CLIENT_ID: 'a b', GOOGLE_DRIVE_FULL_CLIENT_SECRET: FULL_SECRET }), envWith({ GOOGLE_DRIVE_FULL_CLIENT_ID: FULL_ID, GOOGLE_DRIVE_FULL_CLIENT_SECRET: 'short' })]) {
    assert.equal(M.driveStartPlan({ isOperator: true, env }).kind, 'review');
  }
});

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.') || /^rhwp-|vendor/.test(name)) continue;
    const p = join(dir, name), st = statSync(join(ROOT, p));
    if (st.isDirectory()) walk(p, out);
    else if (/\.(m?js|ts|html|kt|java|json)$/.test(name) && st.size < 3_000_000) out.push(p);
  }
  return out;
}

test('저장소 전체에서 drive 전체 권한을 요청하는 곳은 명진 전용 창구 하나뿐', () => {
  const files = ['supabase/functions', 'app', 'scripts', 'android'].flatMap(d => { try { return walk(d); } catch { return []; } });
  // 1) 구글 동의 화면 주소를 만드는 곳은 공용 도우미 하나.
  assert.deepEqual(files.filter(f => read(f).includes('accounts.google.com/o/oauth2')), ['supabase/functions/_shared/google-oauth-clients.mjs']);
  // 2) drive 전체 권한 글자(…/auth/drive 뒤에 .이나 글자 없음)는 받은 토큰 확인용 한 곳(자료실 드라이브 자동 등록)에만 남는다. 요청 주소는 만들지 않는다.
  const literal = /googleapis\.com\/auth\/drive(?![.\w])/;
  const has = files.filter(f => literal.test(read(f)));
  assert.deepEqual(has, ['supabase/functions/library-files/drive-auto.mjs']);
  assert.doesNotMatch(read(has[0]), /accounts\.google\.com|oauth2\/v2\/auth/);
  // 3) 도우미 안에서 drive 전체를 주소에 넣는 길은 fullDriveAuthUrl 하나, 그 함수를 부르는 곳은 public-policy-drive 시작 하나.
  const helper = read('supabase/functions/_shared/google-oauth-clients.mjs');
  assert.equal((helper.match(/allowed: \[DRIVE_FULL_SCOPE\]/g) || []).length, 1);
  const callers = files.filter(f => !f.endsWith('google-oauth-clients.mjs') && /fullDriveAuthUrl\(/.test(read(f)));
  assert.deepEqual(callers, ['supabase/functions/public-policy-drive/index.ts']);
  const ppd = read(callers[0]);
  assert.match(ppd, /const plan = driveStartPlan\(\{ isOperator: await hasOperatorFeature\(workspaceId, OPERATOR_FEATURE\)/);
  assert.match(ppd, /plan\.kind === 'full'\s*\n?\s*\? fullDriveAuthUrl/);
  // 4) 코드 어디에도 include_granted_scopes를 켜는 곳이 없다.
  assert.deepEqual(files.filter(f => /include_granted_scopes\s*[:=]\s*['"]?true/.test(read(f).replace(/^\s*\/\/.*$/gm, ''))), []);
});

// 지어낸 REST 읽기 + 구글 토큰 창구. 토큰 교환에 쓴 client_id를 적는다.
function world({ kind, refresh = 'synthetic-refresh' } = {}) {
  const reads = [], posts = [];
  const rest = async path => {
    reads.push(path.split('?')[0]);
    if (path.startsWith('public_policy_drive_config')) return [CFG];
    if (path.startsWith('app_drive_connections')) return refresh ? [{ google_refresh_token: refresh }] : [];
    if (path.startsWith('app_drive_connection_clients')) return kind ? [{ oauth_client: kind }] : [];
    throw new Error('unexpected ' + path);
  };
  const fetch = async (url, init) => {
    const b = new URLSearchParams(String(init.body));
    posts.push({ url, client_id: b.get('client_id'), client_secret: b.get('client_secret'), grant: b.get('grant_type') });
    return new Response(JSON.stringify({ access_token: 'synthetic-access-' + b.get('client_id') }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { rest, fetch, reads, posts };
}
const WS = 'a0000000-0000-4000-8000-000000000001';

test('토큰 새로 받기는 연결 행의 창구 클라이언트로(full → 명진 전용, review·행 없음 → 심사용)', async () => {
  let w = world({ kind: 'full' });
  assert.equal(await workspaceDriveToken({ rest: w.rest }, WS, { fetch: w.fetch, env: SECRETS, log: () => {} }), 'synthetic-access-' + FULL_ID);
  assert.deepEqual(w.posts.map(p => [p.url, p.client_id, p.client_secret, p.grant]), [['https://oauth2.googleapis.com/token', FULL_ID, FULL_SECRET, 'refresh_token']]);
  for (const kind of ['review', undefined, 'drive']) {
    w = world({ kind });
    await workspaceDriveToken({ rest: w.rest }, WS, { fetch: w.fetch, env: SECRETS, log: () => {} });
    assert.deepEqual(w.posts.map(p => p.client_id), [CFG.google_client_id], String(kind));
    assert.ok(w.reads.includes('app_drive_connection_clients'));
  }
  // 비밀값이 없으면 창구 기록을 읽지 않고 심사용 창구(full 연결은 갱신 실패 → '[Drive 다시 연결]').
  w = world({ kind: 'full' });
  await workspaceDriveToken({ rest: w.rest }, WS, { fetch: w.fetch, env: envWith(), log: () => {} });
  assert.deepEqual(w.posts.map(p => p.client_id), [CFG.google_client_id]);
  assert.equal(w.reads.includes('app_drive_connection_clients'), false);
  // 연결이 없으면 토큰 교환 없이 424.
  w = world({ kind: 'full', refresh: '' });
  await assert.rejects(workspaceDriveToken({ rest: w.rest }, WS, { fetch: w.fetch, env: SECRETS, log: () => {} }), e => e instanceof WorkspaceDriveError && e.code === 'drive_not_connected');
  assert.equal(w.posts.length, 0);
});

test('Drive 토큰을 새로 받는 곳은 모두 같은 공용 도우미(창구 고르기·토큰 교환)를 쓴다', () => {
  for (const f of ['supabase/functions/_shared/workspace-drive-token.ts', 'supabase/functions/gdrive-photos/handler.ts', 'supabase/functions/cloud-files/handler.ts']) {
    const src = read(f);
    assert.match(src, /driveRefreshCredentials\(/, f);
    assert.match(src, /refreshAccessToken\(/, f);
    assert.doesNotMatch(src, /oauth2\.googleapis\.com\/token["'`]/, f + ': 구글 토큰 교환은 도우미로만');
    assert.doesNotMatch(src, /public_policy_drive_config\?/, f + ': 앱 값도 도우미가 읽음');
  }
  const ds = read('supabase/functions/drive-summary/core.mjs');
  assert.match(ds, /clientFor\(fullRows\.length \? 'full' : 'review', c, envOf\)/);
  assert.match(ds, /refreshAccessToken\(/);
  assert.doesNotMatch(ds, /grant_type: 'refresh_token'/);
  // 그 밖의 구글 토큰 교환은 달력·할 일 연결(심사용 창구)·코드 교환·푸시(서비스 계정)뿐.
  const all = walk('supabase/functions').filter(f => /oauth2\.googleapis\.com\/token['"`]/.test(read(f))).sort();
  assert.deepEqual(all, ['supabase/functions/_shared/fcm-send.ts', 'supabase/functions/_shared/google-calendar-token.ts', 'supabase/functions/_shared/google-oauth-clients.mjs',
    'supabase/functions/google-calendar/index.ts', 'supabase/functions/google-tasks/index.ts', 'supabase/functions/public-policy-drive/index.ts']);
  for (const f of ['supabase/functions/_shared/google-calendar-token.ts', 'supabase/functions/google-calendar/index.ts', 'supabase/functions/google-tasks/index.ts']) {
    assert.doesNotMatch(read(f), /app_drive_connections|google_refresh_token/, f + ': Drive 열쇠를 쓰지 않음');
  }
});
