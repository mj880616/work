const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
});

async function db(path: string, opts: { method?: string; body?: unknown; prefer?: string } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'Content-Type': 'application/json',
  };
  if (opts.prefer) headers.Prefer = opts.prefer;
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(data?.message || data?.hint || data?.details || `DB 요청 실패 ${r.status}`);
  return data;
}

async function getUser(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('로그인이 필요합니다.');
  const r = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${token}` },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.id) throw new Error('로그인 세션을 확인할 수 없습니다.');
  return data;
}

async function driveAccessToken() {
  const rows = await db('public_policy_drive_config?id=eq.1&select=google_client_id,google_client_secret,google_refresh_token&limit=1');
  const c = rows?.[0];
  if (!c?.google_client_id || !c?.google_client_secret || !c?.google_refresh_token) {
    throw new Error('Google Drive 연결 설정이 완료되지 않았습니다.');
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.google_client_id,
      client_secret: c.google_client_secret,
      refresh_token: c.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || 'Google Drive 토큰 갱신에 실패했습니다.');
  return d.access_token as string;
}

async function assertDeleteAccess(userId: string, doc: any) {
  const members = await db(`app_workspace_members?workspace_id=eq.${encodeURIComponent(doc.workspace_id)}&user_id=eq.${encodeURIComponent(userId)}&select=role&limit=1`);
  if (members?.[0]?.role !== 'owner') {
    throw new Error('워크스페이스 소유자 권한이 필요합니다.');
  }
}

async function deleteDocument(userId: string, documentId: string) {
  const rows = await db(`app_documents?id=eq.${encodeURIComponent(documentId)}&select=*&limit=1`);
  const doc = rows?.[0];
  if (!doc) throw new Error('파일을 찾을 수 없습니다.');
  await assertDeleteAccess(userId, doc);

  if (doc.file_id) {
    const token = await driveAccessToken();
    const dr = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.file_id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dr.ok && dr.status !== 404) {
      const text = await dr.text();
      throw new Error(text || 'Google Drive 파일 삭제에 실패했습니다.');
    }
  }

  await db(`app_drive_download_tokens?document_id=eq.${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  await db(`app_documents?id=eq.${encodeURIComponent(documentId)}`, { method: 'DELETE' });
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const user = await getUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const documentId = String(body?.document_id || '');
    if (!documentId) return json({ error: 'document_id가 필요합니다.' }, 400);
    if (action === 'delete') return json(await deleteDocument(user.id, documentId));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
