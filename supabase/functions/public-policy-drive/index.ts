const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// DOMAIN-주소이전 ①-D1: Google 연결 뒤 돌아갈 Web2 화면은 새 주소(bokdoong.com). 허용 주소(ALLOWED_ORIGINS)는 옛 주소도 그대로 받는다.
const DRIVE_APP_URL = 'https://bokdoong.com/work/app/?view=library';
const CALENDAR_APP_URL = 'https://bokdoong.com/work/app/';
const CALLBACK_URL = `${SB}/functions/v1/public-policy-drive/callback`;
const ALLOWED_ORIGINS = new Set([
  'https://mj880616.github.io',
  'https://work.bokdoong.com',
  'https://desk.bokdoong.com',
  'https://bokdoong.com',
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

// SEC-정리묶음: DB 오류 원문은 서버 로그에만 남기고, 응답에는 상태 번호가 든 우리 글만 싣는다.
async function serviceFail(r: Response) {
  console.error('public-policy-drive db request failed', { status: r.status, detail: (await r.text().catch(() => '')).slice(0, 500) });
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
  return data;
}

async function assertDriveAdmin(userId: string) {
  const workspaces = await serviceGet('app_workspaces?slug=eq.kptu-work&select=id&limit=1');
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) throw new Error('워크스페이스를 찾을 수 없습니다.');
  const members = await serviceGet(
    `app_workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&select=role&limit=1`
  );
  const role = members?.[0]?.role;
  if (!['owner', 'admin'].includes(role)) throw new Error('Drive 재연결은 관리자만 할 수 있습니다.');
}

// S46-24(명진 G1 2026-10-31): 자료실·바구니가 쓰는 drive.file에 더해, 사진 출처 구글 드라이브(Edge gdrive-photos)용 drive(읽기·쓰기)를 요청한다.
// 동의 화면에서 drive 칸만 끄고 동의해도 연결은 저장되고(drive.file 기능 그대로), 사진 출처만 '권한 없음'으로 돌려보낸다.
// 이 함수와 기존 Drive 함수들이 부르는 API는 바뀌지 않는다. 쓰기 동작은 gdrive-photos에만 있다.
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FULL_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_SCOPES = [DRIVE_FILE_SCOPE, DRIVE_FULL_SCOPE];
// Google 토큰 응답의 scope(공백으로 나눈 목록)에 drive 전체 권한이 정확히 들어 있는지. 'drive.file'·'drive.readonly'는 아니다.
function grantedFullDrive(scope: unknown) {
  return typeof scope === 'string' && scope.split(/\s+/).includes(DRIVE_FULL_SCOPE);
}

async function startDriveAuth(req: Request) {
  const user = await getUser(req);
  await assertDriveAdmin(user.id);
  const cfg = await getOAuthConfig();
  const raw = 'drive.' + crypto.randomUUID() + crypto.randomUUID();
  const stateHash = await sha256(raw);
  await servicePost('app_google_oauth_states', {
    state_hash: stateHash,
    user_id: user.id,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  const params = new URLSearchParams({
    client_id: cfg.google_client_id,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: DRIVE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: raw,
    include_granted_scopes: 'true'
  });
  return json(req, {
    url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
    callback: CALLBACK_URL
  });
}

function driveRedirect(result: 'connected' | 'error', reason?: string, photos?: 'scope_missing') {
  const u = new URL(DRIVE_APP_URL);
  u.searchParams.set('drive', result);
  if (reason) u.searchParams.set('reason', reason);
  if (photos) u.searchParams.set('photos', photos);
  return u.toString();
}
function calendarRedirect(result: 'connected' | 'error', state?: string | null) {
  const u = new URL(CALENDAR_APP_URL);
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
        console.error(e);
        return json(req, { error: e instanceof Error ? e.message : String(e) }, 403);
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
  if (!code || !state) return Response.redirect(isDriveState ? driveRedirect('error', 'missing_oauth_params') : calendarRedirect('error', state), 302);

  try {
    const stateHash = await sha256(state);
    const rows = await serviceGet(
      `app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*`
    );
    if (!Array.isArray(rows) || !rows.length) {
      return Response.redirect(isDriveState ? driveRedirect('error', 'invalid_state') : calendarRedirect('error', state), 302);
    }

    const row = rows[0];
    const cfg = await getOAuthConfig();
    const tokenBody = new URLSearchParams({
      code,
      client_id: cfg.google_client_id,
      client_secret: cfg.google_client_secret,
      redirect_uri: CALLBACK_URL,
      grant_type: 'authorization_code'
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    if (!tokenRes.ok) {
      console.error(await tokenRes.text());
      await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
      return Response.redirect(isDriveState ? driveRedirect('error', 'token_exchange_failed') : calendarRedirect('error', state), 302);
    }

    const tokens = await tokenRes.json();

    if (isDriveState) {
      if (!tokens.refresh_token || !tokens.access_token) {
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'refresh_token_missing'), 302);
      }
      const driveCheck = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      if (!driveCheck.ok) {
        console.error(await driveCheck.text());
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'drive_scope_failed'), 302);
      }

      const workspaces = await serviceGet('app_workspaces?slug=eq.kptu-work&select=id&limit=1');
      const workspaceId = workspaces?.[0]?.id;
      if (!workspaceId) {
        await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
        return Response.redirect(driveRedirect('error', 'workspace_missing'), 302);
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
          console.error(await folderCheck.text());
          await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`).catch(() => {});
          return Response.redirect(driveRedirect('error', 'drive_folder_access_failed'), 302);
        }
      }

      await servicePatch('public_policy_drive_config?id=eq.1', {
        google_refresh_token: tokens.refresh_token,
        updated_at: new Date().toISOString()
      });
      await serviceDelete(`app_google_oauth_states?state_hash=eq.${encodeURIComponent(stateHash)}`);
      return Response.redirect(driveRedirect('connected', undefined, grantedFullDrive(tokens.scope) ? undefined : 'scope_missing'), 302);
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
    console.error(e);
    return Response.redirect(isDriveState ? driveRedirect('error', 'callback_failed') : calendarRedirect('error', state), 302);
  }
});
