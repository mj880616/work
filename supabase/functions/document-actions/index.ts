import { inspectBasketOriginal } from '../_shared/basket-file-origin.ts';
import { readBoundedJson } from '../_shared/bounded-json.mjs';

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

async function db(path: string, opts: { method?: string; body?: unknown; prefer?: string; range?: [number, number] } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'Content-Type': 'application/json',
  };
  if (opts.prefer) headers.Prefer = opts.prefer;
  if (opts.range) { headers.Range = opts.range.join('-'); headers['Range-Unit'] = 'items'; }
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (opts.range && path.startsWith('app_notes?')) {
    const data = await readBoundedJson(r);
    if (!r.ok) throw new Error('DB 요청 실패');
    return { rows: data, contentRange: r.headers.get('Content-Range') };
  }
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(data?.message || data?.hint || data?.details || `DB 요청 실패 ${r.status}`);
  return opts.range ? { rows: data, contentRange: r.headers.get('Content-Range') } : data;
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
  if (doc.id !== documentId || typeof doc.workspace_id !== 'string' || (doc.file_id != null && typeof doc.file_id !== 'string')) {
    throw Object.assign(new Error('자료의 원본 연결을 확인하지 못했습니다. 삭제하지 않고 다시 확인해 주세요.'), { code: 'DOCUMENT_CHANGED' });
  }
  await assertDeleteAccess(userId, doc);

  // Fix the server-read source; a late request must not delete a replacement.
  const sourceWorkspace = doc.workspace_id, sourceFile = doc.file_id ?? null;
  let driveResult = sourceFile ? 'unchanged' : 'no_file';
  const recheckSource = async () => {
    try {
      const current = await db(`app_documents?id=eq.${encodeURIComponent(documentId)}&select=id,workspace_id,file_id&limit=1`);
      if (current?.[0]?.id !== doc.id || current[0].workspace_id !== sourceWorkspace || (current[0].file_id ?? null) !== sourceFile) {
        throw Object.assign(new Error('자료의 파일 연결이 바뀌었습니다. 다시 확인해 주세요.'), { code: 'DOCUMENT_CHANGED' });
      }
      await assertDeleteAccess(userId, current[0]);
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : new Error('자료의 현재 상태를 확인하지 못했습니다.'), { drive_result: driveResult });
    }
  };
  let token: string | undefined;
  const getToken = async () => token ?? (token = await driveAccessToken());
  const origin = sourceFile ? await inspectBasketOriginal({ userId, workspaceId: sourceWorkspace, fileId: sourceFile }, {
    readPage: (path, start, end) => db(path, { prefer: 'count=exact', range: [start, end] }),
    driveToken: getToken, fetch,
  }) : { preserveDrive: false, reason: 'ordinary_library', missing: false, trashed: false };
  driveResult = origin.preserveDrive ? 'preserved' : origin.missing ? 'missing' : origin.trashed ? 'already_trashed' : driveResult;
  await recheckSource();
  if (sourceFile && !origin.preserveDrive && !origin.missing && !origin.trashed) {
    let dr: Response;
    try {
      dr = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceFile)}`, {
        method: 'PATCH', redirect: 'error',
        headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    } catch {
      throw Object.assign(new Error('Google Drive 휴지통 이동 결과를 확인하지 못했습니다.'), { code: 'RESULT_UNKNOWN', drive_result: 'unknown' });
    }
    if (!dr.ok && dr.status !== 404) throw Object.assign(new Error('Google Drive 휴지통 이동에 실패했습니다.'), { code: 'RESULT_UNKNOWN', drive_result: 'unknown' });
    driveResult = dr.status === 404 ? 'missing' : 'trashed';
  }
  await recheckSource();
  // Preserve the existing token -> document deletion order. These REST writes
  // are not one DB transaction; any uncertain write is reported for readback.
  let tokenDeleteResult = 'not_started', documentDeleteResult = 'not_started';
  try {
    tokenDeleteResult = 'unknown';
    await db(`app_drive_download_tokens?document_id=eq.${encodeURIComponent(documentId)}`, { method: 'DELETE' });
    tokenDeleteResult = 'confirmed';
    const matchFile = sourceFile === null ? 'is.null' : `eq.${encodeURIComponent(sourceFile)}`;
    documentDeleteResult = 'unknown';
    const removed = await db(`app_documents?id=eq.${encodeURIComponent(documentId)}&workspace_id=eq.${encodeURIComponent(sourceWorkspace)}&file_id=${matchFile}`, { method: 'DELETE', prefer: 'return=representation' });
    if (!Array.isArray(removed) || removed.length !== 1 || removed[0].id !== doc.id) throw new Error('Delete result not confirmed');
    documentDeleteResult = 'confirmed';
  } catch {
    throw Object.assign(new Error('자료 등록 삭제 결과를 확인하지 못했습니다. 다시 삭제하지 말고 목록을 새로 확인해 주세요.'), { code: 'RESULT_UNKNOWN', drive_result: driveResult, token_delete_result: tokenDeleteResult, document_delete_result: documentDeleteResult });
  }
  return { ok: true, drive_result: driveResult, drive_preserved: origin.preserveDrive, reason: origin.reason };
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
    const details = e as Record<string, unknown>;
    return json({ error: e instanceof Error ? e.message : String(e), ...Object.fromEntries(['code', 'drive_result', 'token_delete_result', 'document_delete_result'].filter(key => typeof details?.[key] === 'string').map(key => [key, details[key]])) }, 400);
  }
});
