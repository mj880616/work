import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";
import { safeErrorLog, safeErrorMessage } from "../_shared/safe-error.ts";
import { callerOwnerWorkspace } from "../_shared/workspace-drive-token.ts";
import { driveStartPlan, fullDriveAuthUrl, fullDriveClient, grantsFullDrive, reviewAuthUrl, reviewClient, stateClientKind } from "../_shared/google-oauth-clients.mjs";
const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// DOMAIN-주소이전 ①-D1: Google 연결 뒤 돌아갈 Web2 화면은 새 주소(bokdoong.com). 허용 주소(ALLOWED_ORIGINS)는 옛 주소도 그대로 받는다.
const DRIVE_APP_URL = 'https://bokdoong.com/work/app/?view=library';
const CALENDAR_APP_URL = 'https://bokdoong.com/work/app/';
const CALLBACK_URL = `${SB}/functions/v1/public-policy-drive/callback`;
// DOMAIN-nojoplus 1단계: 연결을 nojoplus.com 화면에서 시작했으면(요청 Origin이 정확히 이 값) state에 'nojo' 칸을 넣고,
// 돌아갈 때 같은 주소로 보낸다(로그인 정보는 주소마다 따로라 다른 주소로 돌아가면 로그인 화면이 뜬다).
// 돌아갈 곳은 이 두 고정 주소 중 하나뿐이다. state는 서버에 해시로 저장된 값과 맞아야 연결이 저장된다(바뀐 state는 'invalid_state').
// DOMAIN-workonplus 1단계: workonplus.com에서 시작했으면 'won' 칸으로 같은 방식(정확한 Origin일 때만, 돌아갈 곳은 고정 주소).
const NEW_APP_ORIGIN = 'https://nojoplus.com';
const WORKON_APP_ORIGIN = 'https://workonplus.com';
function startedOnNewHost(req: Request) {
  return req.headers.get('Origin') === NEW_APP_ORIGIN;
}
function startedOnWorkon(req: Request) {
  return req.headers.get('Origin') === WORKON_APP_ORIGIN;
}
function returnOrigin(state?: string | null) {
  const parts = state?.split('.') || [];
  if (parts.includes('won')) return WORKON_APP_ORIGIN;
  return parts.includes('nojo') ? NEW_APP_ORIGIN : null;
}
const ALLOWED_ORIGINS = new Set([
  'https://mj880616.github.io',
  'https://work.bokdoong.com',
  'https://desk.bokdoong.com',
  'https://bokdoong.com',
  // DOMAIN-nojoplus 1단계: 새 Web2 주소(정확한 출처 하나).
  'https://nojoplus.com',
  // DOMAIN-workonplus 1단계: WORK ON+ 주소(정확한 출처 하나).
  'https://workonplus.com',
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://mj880616.github.io';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// SEC-정리묶음·EDGE-서버함수정리: DB 오류 원문은 응답·로그 어디에도 싣지 않고, 상태 번호만 남긴다.
async function serviceFail(r: Response) {
  console.error('public-policy-drive db request failed', { status: r.status });
  return new Error(`DB 요청 실패 (${r.status})`);
}

async function serviceGet(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
  });
  if (!r.ok) throw await serviceFail(r);
  return await r.json();
}

async function servicePost(path: string, payload: unknown, prefer = 'return=minimal') {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: prefer
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await serviceFail(r);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function servicePatch(path: string, payload: unknown, prefer = 'return=minimal') {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: prefer
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw await serviceFail(r);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function serviceDelete(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
  });
  if (!r.ok) throw await serviceFail(r);
}

async function getOAuthConfig() {
  const rows = await serviceGet('public_policy_drive_config?id=eq.1&select=google_client_id,google_client_secret');
  const c = Array.isArray(rows) ? rows[0] : null;
  if (!c?.google_client_id || !c?.google_client_secret) throw new Error('Google OAuth 설정이 없습니다.');
  return c;
}

async function getUser(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('로그인이 필요합니다.');
  const r = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${token}` }
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.id) throw new Error('로그인 세션을 확인할 수 없습니다.');
  if (isDelegatedToken(token)) throw new Error('로그인 세션을 확인할 수 없습니다.');
  return data;
}

// MULTI ②-2 (S49-53): Drive 연결은 고정 작업공간 대신 '부른 사람이 owner인 작업공간(정확히 1개)'에 저장한다.
// 작업공간은 로그인(Auth)과 서버 표로만 정한다(화면 값 없음). 다른 작업공간의 연결을 덮어쓸 길이 없다.
async function ownWorkspace(userId: string) {
  const workspaceId = await callerOwnerWorkspace({ rest: serviceGet }, userId);
  if (!workspaceId) throw new Error('내 작업공간을 확인하지 못했습니다.');
  return workspaceId;
}

// 운영자 기능(서버 허용 표)이 이 작업공간에 있는지. service_role 전용 RPC app_operator_feature_workspace(허용된 작업공간이 정확히 하나면 그 id).
async function operatorFeatureWorkspace(feature: string): Promise<string | null> {
  const r = await fetch(`${SB}/rest/v1/rpc/app_operator_feature_workspace`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_feature: feature }),
  });
  if (!r.ok) throw await serviceFail(r);
  const v = await r.json().catch(() => null);
  return typeof v === 'string' ? v : null;
}
async function hasOperatorFeature(workspaceId: string, feature: string) {
  return (await operatorFeatureWorkspace(feature)) === workspaceId;
}

// S71-01 AUTH-구글권한나누기(명진 2026-11-26 10:02 'ㄱ'): 구글 창구 둘. 권한 목록·창구 고르기는 _shared/google-oauth-clients.mjs 한 곳.
// - 모든 사람(심사용 창구, 지금 OAuth 클라이언트): drive.file만. include_granted_scopes 없음(옛 허락이 합쳐지지 않게).
// - 운영자 작업공간(서버 허용 표 'calls') + 명진 전용 창구 비밀값 있음: 명진 전용 창구로 드라이브 전체(drive)만.
//   비밀값이 없으면 운영자도 심사용 창구·drive.file 그대로(사진·파일의 구글 칸은 지금처럼 '[Drive 다시 연결]').
// - 화면이 보낸 값(full·scope·workspace_id 등)은 보지 않는다. 운영자 판정은 시작과 콜백 두 번 모두 서버 허용 표로.
// S62-11(모든 작업공간 drive 요청)은 이 결정으로 바뀌었다: 운영자가 아니면 drive 전체를 요청하지 않는다.
const OPERATOR_FEATURE = 'calls';

// 작업공간 Drive 연결의 창구 기록(app_drive_connection_clients, service_role만). 있으면 고치고 없으면 넣는다(workspace_id는 고칠 권한이 없어 두 단계).
async function saveConnectionClient(workspaceId: string, kind: 'review' | 'full', now: string) {
  const changed = await servicePatch(`app_drive_connection_clients?workspace_id=eq.${encodeURIComponent(workspaceId)}`, { oauth_client: kind, updated_at: now }, 'return=representation');
  if (!Array.isArray(changed) || changed.length !== 1) {
    await servicePost('app_drive_connection_clients', { workspace_id: workspaceId, oauth_client: kind, updated_at: now });
  }
}

async function startDriveAuth(req: Request) {
  const user = await getUser(req);
  const workspaceId = await ownWorkspace(user.id);
  const cfg = await getOAuthConfig();
  const plan = driveStartPlan({ isOperator: await hasOperatorFeature(workspaceId, OPERATOR_FEATURE), env: (k: string) => Deno.env.get(k) });
  const raw = 'drive.' + (plan.kind === 'full' ? 'full.' : '') + (startedOnWorkon(req) ? 'won.' : startedOnNewHost(req) ? 'nojo.' : '') + crypto.randomUUID() + crypto.randomUUID();
  const stateHash = await sha256(raw);
  await servicePost('app_google_oauth_states', {
    state_hash: stateHash,
    user_id: user.id,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  const url = plan.kind === 'full'
    ? fullDriveAuthUrl({ client: plan.client, redirectUri: CALLBACK_URL, state: raw })
    : reviewAuthUrl({ cfg, redirectUri: CALLBACK_URL, scopes: plan.scopes, state: raw });
  return json(req, { url, callback: CALLBACK_URL });
}

function driveRedirect(result: 'connected' | 'error', reason?: string, photos?: 'scope_missing', state?: string | null) {
  const u = new URL(DRIVE_APP_URL);
  const back = returnOrigin(state);
  if (back) u.host = new URL(back).host;
  u.searchParams.set('drive', result);
  if (reason) u.searchParams.set('reason', reason);
  if (photos) u.searchParams.set('photos', photos);
  return u.toString();
}
function calendarRedirect(result: 'connected' | 'error', state?: string | null) {
  const u = new URL(CALENDAR_APP_URL);
  const back = returnOrigin(state);
  if (back) u.host = new URL(back).host;
  u.searchParams.set('view', 'calendar');
  u.searchParams.set('google', result);
  if (state?.split('.').includes('android')) u.searchParams.set('native', 'android');
  return u.toString();
}

function oauthKind(state: string | null) {
  if (state?.startsWith('drive.')) return 'drive';
  if (state?.startsWith('tasks.')) return 'tasks';
  return 'calendar';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop() || '';

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const requestedAction = action === 'drive-start' ? 'drive-start' : String(body?.action || '');
    if (requestedAction === 'drive-start') {
      try {
        return await startDriveAuth(req);
      } catch (e) {
        console.error('public-policy-drive drive-start failed', safeErrorLog(e));
        return json(req, { error: safeErrorMessage(e) }, 403);
      }
    }
  }

  if (req.method !== 'GET' || action !== 'callback') {
    return json(req, {
      error: 'Deprecated endpoint',
      message: 'Web1 자료실 업로드 기능은 Web2 자료실로 통합되었습니다.'
    }, 410);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const isDriveState = oauthKind(state) === 'drive';
  if (!code || !state) return Response.redirect(isDriveState ? driveRedirect('error', 'missing_oauth_params', undefined, state) : calendarRedirect('error', state), 302);

  try {
    const stateHash = await sha256(state);
    const rows = await serviceGet(
      `app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*`
    );
    if (!Array.isArray(rows) || !rows.length) {
      return Response.redirect(isDriveState ? driveRedirect('error', 'invalid_state', undefined, state) : calendarRedirect('error', state), 302);
    }

    const row = rows[0];
    const cfg = await getOAuthConfig();
    // S71-01: 코드는 그것을 내준 창구로만 바꿀 수 있다. state는 서버가 만든 글자(해시가 맞아야 여기까지 옴)라 창구 표시를 믿는다.
    // 명진 전용 창구인데 비밀값이 없으면(그 사이 지움) 저장하지 않는다.
    const clientKind = isDriveState ? stateClientKind(state) : 'review';
    const client = clientKind === 'full' ? fullDriveClient((k: string) => Deno.env.get(k)) : reviewClient(cfg);
    if (!client) throw new Error('Google OAuth 설정이 없습니다.');
    const tokenBody = new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: CALLBACK_URL,
      grant_type: 'authorization_code'
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    if (!tokenRes.ok) {
      console.error('public-policy-drive token exchange failed', { status: tokenRes.status });
      await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
      return Response.redirect(isDriveState ? driveRedirect('error', 'token_exchange_failed', undefined, state) : calendarRedirect('error', state), 302);
    }

    const tokens = await tokenRes.json();

    if (isDriveState) {
      if (!tokens.refresh_token || !tokens.access_token) {
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'refresh_token_missing', undefined, state), 302);
      }
      const driveCheck = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (!driveCheck.ok) {
        console.error('public-policy-drive drive check failed', { status: driveCheck.status });
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'drive_scope_failed', undefined, state), 302);
      }

      // 연결을 시작한 사람(state의 user_id)이 지금도 owner인 작업공간. 화면 값은 쓰지 않는다.
      const workspaceId = await callerOwnerWorkspace({ rest: serviceGet }, row.user_id).catch(() => null);
      if (!workspaceId) {
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'workspace_missing', undefined, state), 302);
      }
      const settings = await serviceGet(
        `app_drive_settings?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=library_folder_id,root_folder_id&limit=1`
      );
      const folderId = settings?.[0]?.library_folder_id || settings?.[0]?.root_folder_id || null;
      if (folderId) {
        const folderCheck = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (!folderCheck.ok) {
          console.error('public-policy-drive folder check failed', { status: folderCheck.status });
          await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
          return Response.redirect(driveRedirect('error', 'drive_folder_access_failed', undefined, state), 302);
        }
      }

      // 명진 전용 창구 연결은 지금도 운영자 작업공간일 때만 저장한다(시작 뒤 허용 표가 바뀌었으면 거절).
      const isOperator = await hasOperatorFeature(workspaceId, OPERATOR_FEATURE);
      if (clientKind === 'full' && !isOperator) {
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'callback_failed', undefined, state), 302);
      }
      const now = new Date().toISOString();
      // full_drive는 '구글이 실제로 그 권한을 준' 때만 true. 심사용 창구는 drive를 요청하지 않으므로 늘 false.
      const fullDrive = clientKind === 'full' && grantsFullDrive(tokens.scope);
      // 있으면 고치고 없으면 넣는다(표 권한이 workspace_id 고치기를 주지 않으므로 upsert 대신 두 단계).
      const changed = await servicePatch(`app_drive_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}`, {
        google_refresh_token: tokens.refresh_token,
        full_drive: fullDrive,
        connected_at: now,
        updated_at: now
      }, 'return=representation');
      if (!Array.isArray(changed) || changed.length !== 1) {
        await servicePost('app_drive_connections', {
          workspace_id: workspaceId,
          google_refresh_token: tokens.refresh_token,
          full_drive: fullDrive,
          connected_at: now,
          updated_at: now
        });
      }
      // S71-01: 이 연결을 내준 창구를 적는다(갱신 때 같은 창구로). 행이 없으면 심사용 창구로 본다.
      await saveConnectionClient(workspaceId, clientKind, now);
      // Expand(②-2): 운영자 작업공간이면 옛 자리(id=1)도 같이 갱신한다. 운영자 전용 함수(drive-summary)가 아직 id=1을 읽는다.
      // 다른 작업공간은 id=1을 절대 쓰지 않는다(명진 Drive 연결을 덮어쓰지 못함).
      if (isOperator) {
        await servicePatch('public_policy_drive_config?id=eq.1', {
          google_refresh_token: tokens.refresh_token,
          updated_at: now
        });
      }
      await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`);
      // 사진 권한 안내는 드라이브 전체를 받을 수 있는 운영자가 받지 못했을 때만(S71-01: 다른 사람은 drive 전체를 요청하지 않는다).
      return Response.redirect(driveRedirect('connected', undefined, isOperator && !fullDrive ? 'scope_missing' : undefined, state), 302);
    }

    let email: string | null = null;
    try {
      const ir = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (ir.ok) {
        const info = await ir.json();
        email = info.email || null;
      }
    } catch {}

    const prev = await serviceGet(
      `app_google_calendar_connections?user_id=eq.${row.user_id}&select=refresh_token`
    );

    await servicePost(
      'app_google_calendar_connections?on_conflict=user_id',
      {
        user_id: row.user_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || prev?.[0]?.refresh_token || null,
        token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        google_email: email,
        enabled: true,
        updated_at: new Date().toISOString()
      },
      'resolution=merge-duplicates,return=minimal'
    );

    await serviceDelete(
      `app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`
    );
    return Response.redirect(calendarRedirect('connected', state), 302);
  } catch (e) {
    console.error('public-policy-drive callback failed', safeErrorLog(e));
    return Response.redirect(isDriveState ? driveRedirect('error', 'callback_failed', undefined, state) : calendarRedirect('error', state), 302);
  }
});
