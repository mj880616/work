import { inspectBasketOriginal } from '../_shared/basket-file-origin.ts';
import { readBoundedJson } from '../_shared/bounded-json.mjs';
import { createHwpEdit, HwpEditError } from '../_shared/hwp-edit.ts';
import { createDocumentText } from '../_shared/document-text.ts';
import { renameFile } from './file-rename.ts';
import { sendDevInbox, readDevMade } from './dev-inbox.ts';
import { withWebCors } from "../_shared/web-cors.ts";
import { callerOwnerWorkspace, WorkspaceDriveError, workspaceDriveToken } from '../_shared/workspace-drive-token.ts';
import { safeErrorLog, safeErrorMessage } from "../_shared/safe-error.ts";

const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Web2-Hwp',
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

// MULTI ②-2: Drive 토큰은 부른 사람(로그인)의 owner 작업공간(정확히 1개) 연결만(_shared/workspace-drive-token.ts). id=1의 갱신 열쇠는 읽지 않는다.
// expectedWorkspace를 주면(자료·메모 행의 작업공간) 그것이 본인 작업공간과 같을 때만. 요청마다 새로 만들고(모듈 전역 상태 없음), 한 요청 안에서만 토큰을 재사용한다.
function driveTokenFor(userId: string, expectedWorkspace?: string) {
  let pending: Promise<string> | null = null;
  return () => pending ??= (async () => {
    const reader = { rest: (path: string) => db(path) };
    const own = await callerOwnerWorkspace(reader, userId);
    if (!own || (expectedWorkspace !== undefined && own !== expectedWorkspace)) {
      throw Object.assign(new Error('워크스페이스 소유자 권한이 필요합니다.'), { code: 'FORBIDDEN' });
    }
    try {
      return await workspaceDriveToken(reader, own, { fetch, log: code => console.error('document-actions drive_token failed', { code }) });
    } catch (e) {
      if (e instanceof WorkspaceDriveError && e.code === 'drive_not_connected') {
        throw Object.assign(new Error('Google Drive가 아직 연결되지 않았어요. 자료실에서 Drive를 연결해 주세요.'), { code: 'DRIVE_NOT_CONNECTED' });
      }
      // SEC-정리묶음: Google 원문은 서버 로그에만. 화면은 이 글(토큰 갱신 실패 판정 글)만 받는다.
      throw new Error('Google Drive 토큰 갱신에 실패했습니다.');
    }
  })();
}


// ATT-이름고치기: 이름 바꾸기의 DB 읽기·쓰기는 내 로그인 토큰으로(RLS 소유자 정책). 서버 키는 쓰지 않는다.
function userDbFor(token: string) {
  return async (path: string, opts: { method?: string; body?: unknown; prefer?: string } = {}) => {
    if (!ANON) throw Object.assign(new Error('서버 설정을 확인하지 못했습니다.'), { code: 'CONFIG_MISSING' });
    const headers: Record<string, string> = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (opts.prefer) headers.Prefer = opts.prefer;
    const r = await fetch(`${SB}/rest/v1/${path}`, { method: opts.method || 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await r.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) throw Object.assign(new Error(`DB 요청 실패 ${r.status}`), { status: r.status });
    return data;
  };
}

const fail = (message: string, code: string) => Object.assign(new Error(message), { code });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;

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
  const getToken = async () => token ?? (token = await driveTokenFor(userId, sourceWorkspace)());
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

// BASKET-4b-1 B: register a basket note attachment in the library as a second
// reference to the same Drive file. No copy, move or upload: deleting either side
// later keeps the original (inspectBasketOriginal above, basket note-delete).
// No unique index on app_documents.file_id exists, so the duplicate check is a
// read before the write; the caller holds one request per attachment.
async function registeredDocument(workspaceId: string, fileId: string) {
  const rows = await db(`app_documents?workspace_id=eq.${encodeURIComponent(workspaceId)}&file_id=eq.${encodeURIComponent(fileId)}&select=id,title&order=created_at.asc&limit=1`);
  if (!Array.isArray(rows)) throw fail('자료실 등록 여부를 확인하지 못했습니다.', 'LOOKUP_FAILED');
  return rows[0] ? { id: String(rows[0].id), title: String(rows[0].title ?? '') } : null;
}

// TRASH-다른삭제 5단계: 서버 키(service_role)는 RLS(휴지통 숨김 정책)를 건너뛰므로 노트 id로 직접 읽을 때는 휴지통 노트(deleted_at 있음)를 뺀다.
// DB 적용 전에는 app_notes에 deleted_at 칸이 없어 PostgREST가 "column app_notes.deleted_at does not exist"(42703)로 거절한다.
// 그 거절이면 거르기 없이 한 번 더 읽는다(그때는 휴지통 행이 있을 수 없다). 다른 오류는 그대로 던진다. (같은 규칙의 짝: _shared/hwp-edit.ts readLiveNoteRows)
async function readLiveNoteRows(path: string) {
  try {
    return await db(`${path}&deleted_at=is.null`);
  } catch (error) {
    const text = String((error as { message?: unknown } | null)?.message ?? '');
    if (!/deleted_at/.test(text) || !/does not exist|42703/i.test(text)) throw error;
    return await db(path);
  }
}

type Attachment = { drive_file_id?: unknown; file_name?: unknown; mime_type?: unknown; size_bytes?: unknown };

async function registerBasketAttachment(userId: string, body: { note_id?: unknown; drive_file_id?: unknown }) {
  const noteId = String(body?.note_id || ''), fileId = String(body?.drive_file_id || '');
  if (!UUID.test(noteId) || !DRIVE_ID.test(fileId)) throw fail('보낼 바구니 첨부를 확인할 수 없습니다.', 'INVALID_REQUEST');
  // Workspace, file name, type and size come from the server-read note, never the client.
  // TRASH-다른삭제 5단계: 서버 키는 RLS를 건너뛰므로 휴지통 노트의 첨부는 자료로 등록하지 않는다(DB 적용 전 칸이 없을 때는 거르기 없이 읽는다).
  const notes = await readLiveNoteRows(`app_notes?id=eq.${encodeURIComponent(noteId)}&select=id,workspace_id,attachments&limit=1`);
  const note = notes?.[0];
  if (!note || note.id !== noteId || typeof note.workspace_id !== 'string') throw fail('메모를 찾을 수 없습니다.', 'NOTE_NOT_FOUND');
  await assertDeleteAccess(userId, note);
  const workspaceId = note.workspace_id;
  const attachment: Attachment | undefined = Array.isArray(note.attachments)
    ? note.attachments.find((a: unknown) => !!a && typeof a === 'object' && (a as Attachment).drive_file_id === fileId)
    : undefined;
  if (!attachment) throw fail('이 메모의 첨부가 아닙니다.', 'ATTACHMENT_NOT_FOUND');
  const existing = await registeredDocument(workspaceId, fileId);
  if (existing) return { ok: true, result: 'exists', document: existing };
  return await registerDriveDocument(userId, workspaceId, fileId, attachment, '바구니 메모 첨부에서 등록(같은 Drive 원본)');
}

// BASKET-4b-1 B 등록의 뒷부분(FILES-자료실로보내기도 같이 씀): 그 작업공간 Drive 연결로 원본을 다시 읽어(내 소유·휴지통 아님) 같은 Drive 원본을
// 가리키는 자료 행 하나를 만든다. 복사·이동·올리기 없음. 이름·종류·크기는 known(서버가 읽은 값)이 먼저, 없으면 Drive 값.
type KnownFile = { file_name?: unknown; mime_type?: unknown; size_bytes?: unknown };
async function registerDriveDocument(userId: string, workspaceId: string, fileId: string, known: KnownFile, note: string) {
  const token = await driveTokenFor(userId, workspaceId)();
  let r: Response;
  try {
    r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,trashed,ownedByMe`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
    });
  } catch {
    throw fail('Google Drive 원본을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'DRIVE_UNAVAILABLE');
  }
  if (r.status === 404) throw fail('Drive 원본을 찾을 수 없습니다.', 'DRIVE_FILE_MISSING');
  if (!r.ok) throw fail('Google Drive 원본을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 'DRIVE_UNAVAILABLE');
  const file = await r.json().catch(() => null);
  if (!file || file.id !== fileId || file.ownedByMe !== true || typeof file.trashed !== 'boolean') throw fail('Drive 원본을 확인하지 못했습니다.', 'DRIVE_FILE_INVALID');
  if (file.trashed) throw fail('Drive 원본이 휴지통에 있어 보내지 않았습니다.', 'DRIVE_FILE_TRASHED');

  const fileName = typeof known.file_name === 'string' && known.file_name.trim() ? known.file_name.trim().slice(0, 255) : String(file.name || '첨부').slice(0, 255);
  const title = fileName.replace(/\.[^.]+$/, '').trim() || fileName;
  const size = typeof known.size_bytes === 'number' && Number.isSafeInteger(known.size_bytes) && known.size_bytes >= 0 ? known.size_bytes : (Number.isSafeInteger(Number(file.size)) ? Number(file.size) : null);
  const link = typeof file.webViewLink === 'string' && file.webViewLink.startsWith('https://') ? file.webViewLink : `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  const row = {
    workspace_id: workspaceId, project_id: null, meeting_id: null, title, category: '기타', source: null, document_date: null, description: null, tags: [],
    drive_url: link, file_id: fileId, file_name: fileName,
    mime_type: typeof known.mime_type === 'string' && known.mime_type ? known.mime_type : String(file.mimeType || 'application/octet-stream'),
    file_size: size, visibility: 'private', uploaded_by: userId, auto_classified: false,
    classification_note: note,
  };
  // Re-check right before the write to narrow the window of a parallel send.
  const again = await registeredDocument(workspaceId, fileId);
  if (again) return { ok: true, result: 'exists', document: again };
  const unknown = () => fail('자료실 등록 결과를 확인하지 못했습니다. 다시 보내지 말고 자료실 목록을 먼저 확인해 주세요.', 'RESULT_UNKNOWN');
  let w: Response;
  try {
    w = await fetch(`${SB}/rest/v1/app_documents?select=id,title,workspace_id,file_id`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
  } catch {
    throw unknown();
  }
  // A 5xx or a lost/odd body may still have committed; never send again from here.
  if (w.status >= 500) throw unknown();
  if (!w.ok) throw fail('자료실에 등록하지 못했습니다.', 'REGISTER_REJECTED');
  const created = await w.json().catch(() => null);
  if (!Array.isArray(created) || created.length !== 1 || created[0]?.file_id !== fileId || created[0]?.workspace_id !== workspaceId || typeof created[0]?.id !== 'string') throw unknown();
  return { ok: true, result: 'created', document: { id: created[0].id, title: String(created[0].title ?? title) } };
}

// FILES-자료실로보내기(S52-26, 명진 11/07 11:41 '(가) 연결만'): [파일]의 구글 드라이브 파일을 사본 없이 자료실 자료로 연결한다.
// 작업공간은 부른 사람의 owner 작업공간 하나(화면 값 믿지 않음). 그 파일은 그 작업공간의 [파일] 색인(app_cloud_items, 서버만 씀)에
// 구글(gd)·파일(폴더 아님)·휴지통 아님으로 있어야 하고, 등록은 그 작업공간 Drive 연결로 원본을 다시 읽은 뒤(registerDriveDocument:
// 내 소유·휴지통 아님) 한다. 다른 작업공간의 색인·Drive 연결은 읽지도 쓰지도 않는다. 이미 같은 원본 자료가 있으면 새로 만들지 않는다(exists).
// 이름·종류·크기는 색인 값. 제목·분류·사업영역 등은 화면이 그 뒤 자기 로그인(owner RLS)으로 고친다(자료실 [정보 수정]과 같은 길).
async function registerDriveFile(userId: string, body: { drive_file_id?: unknown }) {
  const fileId = String(body?.drive_file_id || '');
  if (!DRIVE_ID.test(fileId)) throw fail('보낼 구글 드라이브 파일을 확인할 수 없습니다.', 'INVALID_REQUEST');
  const own = await callerOwnerWorkspace({ rest: (path: string) => db(path) }, userId);
  if (!own) throw fail('워크스페이스 소유자 권한이 필요합니다.', 'FORBIDDEN');
  const rows = await db(`app_cloud_items?workspace_id=eq.${encodeURIComponent(own)}&source=eq.gd&item_id=eq.${encodeURIComponent(fileId)}&select=item_id,name,is_folder,mime,size_bytes,trashed&limit=1`);
  const item = Array.isArray(rows) ? rows[0] : null;
  if (!item || item.item_id !== fileId || item.is_folder !== false || item.trashed !== false) throw fail('[파일]의 구글 드라이브 파일이 아닙니다.', 'FILE_NOT_FOUND');
  const existing = await registeredDocument(own, fileId);
  if (existing) return { ok: true, result: 'exists', document: existing };
  return await registerDriveDocument(userId, own, fileId, { file_name: item.name, mime_type: item.mime, size_bytes: Number.isSafeInteger(Number(item.size_bytes)) && item.size_bytes != null ? Number(item.size_bytes) : undefined }, '[파일]의 구글 드라이브에서 연결(같은 Drive 원본)');
}

// HWP-편집기 2단계: open an HWP/HWPX library document or basket attachment in the
// editor and overwrite an HWP original (../_shared/hwp-edit.ts). Saving as a new
// file goes through the existing library-files / basket-files uploads.
// MULTI ②-2: Drive 토큰이 부른 사람의 작업공간 연결이어야 하므로 요청마다 만든다.
const hwpEditFor = (userId: string) => createHwpEdit({ db: path => db(path), driveToken: driveTokenFor(userId), assertOwner: assertDeleteAccess, fetch });
function hwpFailure(e: unknown) {
  const known = e instanceof HwpEditError;
  const backup = (e as { backup?: unknown })?.backup;
  if (!known) console.error('document-actions hwp failed', safeErrorLog(e));
  // Anything not classified happened before a Drive write: a refusal that changed nothing.
  return json({ error: safeErrorMessage(e), code: known ? e.code : 'HWP_REFUSED', ...(backup ? { backup } : {}) }, known ? e.status : 400);
}

// LIB-AI자동분류: 자료 파일의 본문 글자 앞부분을 읽어 이미 있는 app_documents.extracted_text 칸에 둔다(../_shared/document-text.ts).
// 자료·업무공간·Drive 파일 ID는 서버가 DB에서 읽는다(화면 값 믿지 않음). 원본 Drive 파일은 읽기만 한다(이름·위치 그대로).
// 글자는 화면에 돌려주지 않는다(상태만). 이미 읽은 자료는 다시 읽지 않는다. AI는 부르지 않는다(ai-assist가 이 칸을 읽음).
// MULTI ②-2: 자료 행의 작업공간(본인 owner 확인됨)의 Drive 연결로만 읽는다. 요청마다 만든다.
const textReader = (userId: string, workspaceId: string) => createDocumentText({ driveToken: driveTokenFor(userId, workspaceId), fetch, log: code => console.error(JSON.stringify({ fn: 'document-actions', code })) });
async function readDocumentText(userId: string, body: { document_id?: unknown }) {
  const id = String(body?.document_id || '').toLowerCase();
  if (!UUID.test(id)) throw fail('자료를 확인할 수 없습니다.', 'INVALID_REQUEST');
  const rows = await db(`app_documents?id=eq.${encodeURIComponent(id)}&select=id,workspace_id,file_id,file_name,mime_type,file_size,extraction_status&limit=1`);
  const doc = rows?.[0];
  if (!doc || doc.id !== id || typeof doc.workspace_id !== 'string') throw fail('자료를 찾을 수 없습니다.', 'DOCUMENT_NOT_FOUND');
  try { await assertDeleteAccess(userId, doc); } catch { throw fail('워크스페이스 소유자 권한이 필요합니다.', 'FORBIDDEN'); }
  if (doc.extraction_status === 'ready') return { ok: true, status: 'ready', reason: 'cached' };
  const result = await textReader(userId, doc.workspace_id).extract({
    fileId: typeof doc.file_id === 'string' ? doc.file_id : '', name: String(doc.file_name || ''), mime: String(doc.mime_type || ''),
    size: Number.isSafeInteger(doc.file_size) ? doc.file_size : null,
  });
  const status = result.source === 'content' ? 'ready' : 'error';
  await db(`app_documents?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(doc.workspace_id)}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { extracted_text: result.text || null, extraction_status: status, extraction_error: status === 'ready' ? null : result.reason, extracted_at: new Date().toISOString() },
  });
  return { ok: true, status, reason: result.reason };
}

Deno.serve(withWebCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const user = await getUser(req);
    if ((req.headers.get('content-type') || '').toLowerCase().startsWith('multipart/form-data')) {
      let form: FormData;
      try { form = await req.formData(); } catch { return json({ error: '저장 요청을 읽지 못했습니다. 아무것도 바꾸지 않았습니다.', code: 'INVALID_REQUEST' }, 400); }
      if (form.get('action') !== 'hwp-overwrite') return json({ error: 'Unknown action' }, 400);
      try { return json(await hwpEditFor(user.id).overwrite(user.id, form)); } catch (e) { return hwpFailure(e); }
    }
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    if (action === 'hwp-open') {
      try {
        const { bytes, info } = await hwpEditFor(user.id).open(user.id, body);
        return new Response(bytes, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Web2-Hwp': encodeURIComponent(JSON.stringify(info)) } });
      } catch (e) { return hwpFailure(e); }
    }
    if (action === 'html-view') {
      try {
        const r = json(await hwpEditFor(user.id).openHtml(user.id, body));
        r.headers.set('Cache-Control', 'no-store');
        return r;
      } catch (e) { return hwpFailure(e); }
    }
    if (action === 'document-text') {
      try {
        return json(await readDocumentText(user.id, body));
      } catch (e) {
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'TEXT_FAILED';
        console.error('document-actions read-text failed', safeErrorLog(e));
        return json({ error: safeErrorMessage(e), code }, code === 'TEXT_FAILED' ? 503 : 400);
      }
    }
    if (action === 'rename-file') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      try {
        return json(await renameFile(body, { userDb: userDbFor(token), driveToken: driveTokenFor(user.id), fetch, now: Date.now }));
      } catch (e) {
        // 400: 아무것도 바꾸지 않고 거절. 503: Drive 또는 일부 줄이 바뀌었을 수 있다 — 화면이 다시 읽는다.
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'RESULT_UNKNOWN';
        console.error('document-actions rename-file failed', { code });
        const known = ['INVALID_REQUEST', 'INVALID_NAME', 'NOT_FOUND', 'ATTACHMENT_NOT_FOUND', 'DRIVE_FILE_MISSING', 'DRIVE_FORBIDDEN', 'DRIVE_UNAVAILABLE', 'RESULT_UNKNOWN', 'CONFIG_MISSING'].includes(code);
        const message = known && e instanceof Error ? e.message : '이름 바꾸기 결과를 확인하지 못했습니다. 다시 열어 확인해 주세요.';
        return json({ error: message, code: known ? code : 'RESULT_UNKNOWN' }, code === 'RESULT_UNKNOWN' || !known || code === 'DRIVE_UNAVAILABLE' || code === 'CONFIG_MISSING' ? 503 : 400);
      }
    }
    if (action === 'dev-inbox') {
      // WEEKLY-개발후보연결(S48-49): [만들기]로 보낸 개선 제안 한 건을 'Web2 요청함' 문서 끝에 더한다(./dev-inbox.ts — 로그인·owner·운영자 기능·저장값 다시 확인).
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      try {
        return json(await sendDevInbox(body, { userId: user.id, db: (path, opts = {}) => db(path, opts), userDb: userDbFor(token), driveToken: driveTokenFor(user.id), fetch, now: Date.now, docId: Deno.env.get('WEB2_DEV_INBOX_DOC_ID') }));
      } catch (e) {
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'RESULT_UNKNOWN';
        const known = ['INVALID_REQUEST', 'FORBIDDEN', 'FEATURE_REQUIRED', 'NOT_FOUND', 'NOT_ANSWERED', 'READ_FAILED', 'DOC_UNAVAILABLE', 'RESULT_UNKNOWN', 'CONFIG_MISSING'].includes(code);
        const status = known && typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 503;
        console.error('document-actions dev-inbox failed', { code: known ? code : 'RESULT_UNKNOWN' });
        return json({ error: known && e instanceof Error ? e.message : '요청함에 더했는지 확인하지 못했습니다.', code: known ? code : 'RESULT_UNKNOWN' }, status);
      }
    }
    if (action === 'dev-made') {
      // WEEKLY-개발후보CC 2단계(S48-57): 요청함 덩어리 아래 CC가 적은 '완료 #NNN'을 서버가 읽어 그 주 만들기 제안에 made 번호를 남긴다(./dev-inbox.ts readDevMade — 같은 로그인·owner·운영자 기능 확인).
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      try {
        return json(await readDevMade(body, { userId: user.id, db: (path, opts = {}) => db(path, opts), userDb: userDbFor(token), driveToken: driveTokenFor(user.id), fetch, now: Date.now, docId: Deno.env.get('WEB2_DEV_INBOX_DOC_ID') }));
      } catch (e) {
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : 'RESULT_UNKNOWN';
        const known = ['INVALID_REQUEST', 'FORBIDDEN', 'FEATURE_REQUIRED', 'NOT_FOUND', 'READ_FAILED', 'DOC_UNAVAILABLE', 'WRITE_FAILED', 'CONFIG_MISSING'].includes(code);
        const status = known && typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 503;
        console.error('document-actions dev-made failed', { code: known ? code : 'RESULT_UNKNOWN' });
        return json({ error: known && e instanceof Error ? e.message : '번호를 읽지 못했습니다.', code: known ? code : 'RESULT_UNKNOWN' }, status);
      }
    }
    if (action === 'register-drive-file') {
      try {
        return json(await registerDriveFile(user.id, body));
      } catch (e) {
        // 400: refused before any write. 503: the write may have happened (check the library first).
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : undefined;
        console.error('document-actions register-drive failed', safeErrorLog(e));
        return json({ error: safeErrorMessage(e), ...(code ? { code } : {}) }, code === 'RESULT_UNKNOWN' ? 503 : 400);
      }
    }
    if (action === 'register-basket-attachment') {
      try {
        return json(await registerBasketAttachment(user.id, body));
      } catch (e) {
        // 400: refused before any write. 503: the write may have happened; the
        // caller must check the library instead of sending again.
        const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : undefined;
        console.error('document-actions register failed', safeErrorLog(e));
        return json({ error: safeErrorMessage(e), ...(code ? { code } : {}) }, code === 'RESULT_UNKNOWN' ? 503 : 400);
      }
    }
    const documentId = String(body?.document_id || '');
    if (!documentId) return json({ error: 'document_id가 필요합니다.' }, 400);
    if (action === 'delete') return json(await deleteDocument(user.id, documentId));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('document-actions failed', safeErrorLog(e));
    const details = e as Record<string, unknown>;
    return json({ error: safeErrorMessage(e), ...Object.fromEntries(['code', 'drive_result', 'token_delete_result', 'document_delete_result'].filter(key => typeof details?.[key] === 'string').map(key => [key, details[key]])) }, 400);
  }
}));
