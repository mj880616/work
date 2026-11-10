// FILE-첨부삭제(2026-11-10 사용자 결정 "ㅇ"): 첨부 ⋯ [삭제] — 그 기록에서 떼고 Drive 원본을 휴지통으로(완전 삭제 아님, 30일 안에 되살림).
// 서버 한 곳(document-actions action=trash-file / restore-file). 이름 고치기(file-rename.ts)와 같은 길: DB 읽기·쓰기는 모두
// 부른 사람의 로그인 토큰(RLS 소유자 정책)으로, Drive는 부른 사람의 owner 작업공간 연결 토큰으로만 한다. 새 권한·새 표 없음.
//
// trash-file {target:'note', id, drive_file_id}
//   ① 내 로그인 토큰으로 그 노트를 읽는다(남의 작업공간 줄은 RLS가 숨김 = 404). 그 노트에 그 Drive 파일이 붙어 있어야 한다.
//      화면이 보낸 작업공간 값은 받지 않는다(작업공간은 서버가 읽은 행의 값).
//   ② 노트에서 뗀다(updated_at 맞을 때만 = 그사이 바뀌었으면 아무것도 바꾸지 않고 NOTE_CHANGED).
//   ③ 같은 작업공간의 다른 줄(다른 노트 첨부·할 일 첨부·자료)이 같은 파일을 쓰면 Drive는 그대로 둔다(drive='kept').
//   ④ 아니면 Drive 원본을 휴지통으로(trashed=true, 영구 삭제 아님). 이 앱이 만든 내 파일이 아니면(403·남의 파일·폴더) 손대지 않고
//      drive='not_ours' — 화면은 '빼기만 했어요'라고 알린다. 휴지통 실패도 떼기는 이미 됐으므로 drive 값으로만 알린다.
// restore-file {target:'note', id, drive_file_id} — [되돌리기]
//   ① 그 노트를 읽는다(RLS). 이미 붙어 있으면 그대로 성공.
//   ② Drive 원본이 내 파일(ownedByMe, 폴더 아님)인지 읽고, 휴지통에 있으면 꺼낸다.
//   ③ Drive가 알려 준 이름·종류·크기로 노트에 다시 붙인다(updated_at 맞을 때만, 한 번 다시 읽어 재시도).
export type TrashTarget = 'note';
export type TrashInput = { target: TrashTarget; id: string; driveFileId: string };
export type TrashDeps = {
  userDb: (path: string, opts?: { method?: string; body?: unknown; prefer?: string }) => Promise<any>;
  // 같은 파일을 쓰는 줄 찾기 전용 읽기(서버 키). 휴지통에 간 노트(deleted_at)도 보여야 그 노트가 되돌아올 때 파일이 남는다
  // (_shared/basket-file-origin.ts·photo-prune.ts와 같은 이유로 일부러 거르지 않음). 작업공간은 ①에서 RLS로 읽은 행의 값만 넣는다.
  refDb: (path: string) => Promise<any>;
  driveToken: () => Promise<string>;
  fetch: typeof fetch;
  now: () => number;
};
export type DriveTrash = 'trashed' | 'kept' | 'not_ours' | 'missing' | 'failed' | 'unknown';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_ATTACHMENTS = 20;
const enc = encodeURIComponent;
const fail = (message: string, code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...extra });
const attOf = (row: any): any[] => Array.isArray(row?.attachments) ? row.attachments : [];

export function parseTrashRequest(body: any, action: 'trash-file' | 'restore-file'): TrashInput {
  const keys = Object.keys(body || {}).sort().join(',');
  if (keys !== 'action,drive_file_id,id,target' || body.action !== action) throw fail('요청을 확인할 수 없습니다.', 'INVALID_REQUEST');
  const target = String(body.target), id = String(body.id), driveFileId = String(body.drive_file_id);
  if (target !== 'note' || !UUID.test(id) || !DRIVE_ID.test(driveFileId)) throw fail('요청을 확인할 수 없습니다.', 'INVALID_REQUEST');
  return { target: 'note', id: id.toLowerCase(), driveFileId };
}

async function readNote(input: TrashInput, deps: TrashDeps) {
  const rows = await deps.userDb(`app_notes?id=eq.${enc(input.id)}&select=id,workspace_id,updated_at,attachments&limit=2`);
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || String(row.id).toLowerCase() !== input.id || typeof row.workspace_id !== 'string' || !UUID.test(row.workspace_id) || typeof row.updated_at !== 'string') {
    throw fail('첨부가 있는 기록을 찾을 수 없습니다.', 'NOT_FOUND');
  }
  return row as { id: string; workspace_id: string; updated_at: string; attachments: unknown };
}

// 노트 한 줄을 updated_at이 같을 때만 고친다. 고친 줄(새 updated_at)을 돌려주고, 맞는 줄이 없으면 null.
async function patchNote(row: { id: string; workspace_id: string; updated_at: string }, attachments: unknown[], deps: TrashDeps) {
  const done = await deps.userDb(`app_notes?id=eq.${enc(row.id)}&workspace_id=eq.${enc(row.workspace_id)}&updated_at=eq.${enc(row.updated_at)}&select=id,updated_at,attachments`, {
    method: 'PATCH', prefer: 'return=representation', body: { attachments, updated_at: new Date(deps.now()).toISOString() },
  });
  return Array.isArray(done) && done.length === 1 && typeof done[0]?.updated_at === 'string' ? done[0] : null;
}

// 같은 작업공간에서 이 파일을 아직 쓰는 줄이 있나(휴지통 노트 포함 다른 노트 첨부·할 일 첨부·자료). 읽기 실패는 '쓰는 줄 있음'으로 본다(지우지 않는 쪽).
async function stillUsed(workspaceId: string, fileId: string, deps: TrashDeps): Promise<boolean> {
  try {
    const contains = enc(JSON.stringify([{ drive_file_id: fileId }]));
    const notes = await deps.refDb(`app_notes?workspace_id=eq.${enc(workspaceId)}&attachments=cs.${contains}&select=id&limit=1`);
    const tasks = await deps.refDb(`app_task_attachments?workspace_id=eq.${enc(workspaceId)}&drive_file_id=eq.${enc(fileId)}&select=drive_file_id&limit=1`);
    const docs = await deps.refDb(`app_documents?workspace_id=eq.${enc(workspaceId)}&file_id=eq.${enc(fileId)}&select=id&limit=1`);
    if (![notes, tasks, docs].every(Array.isArray)) return true;
    return notes.length + tasks.length + docs.length > 0;
  } catch {
    return true;
  }
}

type DriveMeta = { id: string; name?: string; mimeType?: string; size?: string; ownedByMe?: boolean; trashed?: boolean };
// Drive 원본 정보. 404 → 'missing', 403(이 앱이 만들지 않은 파일 등) → 'not_ours', 그 밖의 실패 → 'failed'.
async function readDrive(fileId: string, token: string, deps: TrashDeps): Promise<DriveMeta | 'missing' | 'not_ours' | 'failed'> {
  let r: Response;
  try {
    r = await deps.fetch(`${DRIVE}/${enc(fileId)}?fields=id,name,mimeType,size,ownedByMe,trashed`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' });
  } catch {
    return 'failed';
  }
  if (r.status === 404) return 'missing';
  if (r.status === 403) return 'not_ours';
  if (!r.ok) return 'failed';
  const d = await r.json().catch(() => null);
  if (!d || d.id !== fileId || typeof d.trashed !== 'boolean') return 'failed';
  if (d.ownedByMe !== true || d.mimeType === FOLDER_MIME) return 'not_ours';
  return d as DriveMeta;
}

async function setTrashed(fileId: string, trashed: boolean, token: string, deps: TrashDeps): Promise<'done' | 'not_ours' | 'failed' | 'unknown'> {
  let r: Response;
  try {
    r = await deps.fetch(`${DRIVE}/${enc(fileId)}?fields=id,trashed`, {
      method: 'PATCH', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed }),
    });
  } catch {
    return 'unknown';
  }
  if (r.status === 403 || r.status === 404) return 'not_ours';
  if (r.status >= 400 && r.status < 500) return 'failed';
  if (!r.ok) return 'unknown';
  const d = await r.json().catch(() => null);
  return d?.id === fileId && d?.trashed === trashed ? 'done' : 'unknown';
}

async function trashDrive(fileId: string, deps: TrashDeps): Promise<DriveTrash> {
  let token: string;
  try { token = await deps.driveToken(); } catch { return 'failed'; }
  const meta = await readDrive(fileId, token, deps);
  if (typeof meta === 'string') return meta;
  if (meta.trashed) return 'trashed';
  const done = await setTrashed(fileId, true, token, deps);
  return done === 'done' ? 'trashed' : done;
}

export async function trashFile(body: any, deps: TrashDeps) {
  const input = parseTrashRequest(body, 'trash-file');
  const row = await readNote(input, deps);
  const files = attOf(row);
  const file = files.find((a) => a && typeof a === 'object' && a.drive_file_id === input.driveFileId);
  if (!file) throw fail('이 기록의 첨부가 아닙니다.', 'ATTACHMENT_NOT_FOUND');
  const saved = await patchNote(row, files.filter((a) => a?.drive_file_id !== input.driveFileId), deps);
  if (!saved) throw fail('기록이 그사이 바뀌었어요. 다시 불러온 뒤 지워 주세요.', 'NOTE_CHANGED');
  const drive: DriveTrash = await stillUsed(row.workspace_id, input.driveFileId, deps) ? 'kept' : await trashDrive(input.driveFileId, deps);
  return { ok: true, detached: true, drive, target: input.target, id: input.id, drive_file_id: input.driveFileId, note: { id: saved.id, updated_at: saved.updated_at } };
}

export async function restoreFile(body: any, deps: TrashDeps) {
  const input = parseTrashRequest(body, 'restore-file');
  let row = await readNote(input, deps);
  if (attOf(row).some((a) => a?.drive_file_id === input.driveFileId)) {
    return { ok: true, already: true, target: input.target, id: input.id, drive_file_id: input.driveFileId, note: { id: row.id, updated_at: row.updated_at } };
  }
  if (attOf(row).length >= MAX_ATTACHMENTS) throw fail('첨부는 20개까지예요. 하나를 뺀 뒤 되돌려 주세요.', 'TOO_MANY_ATTACHMENTS');
  let token: string;
  try { token = await deps.driveToken(); } catch (e) {
    throw fail('Google Drive를 확인하지 못했어요. 잠시 뒤 다시 해 주세요.', (e as { code?: string })?.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'DRIVE_UNAVAILABLE');
  }
  const meta = await readDrive(input.driveFileId, token, deps);
  if (meta === 'missing') throw fail('Drive 원본을 찾을 수 없어 되돌리지 못했어요.', 'DRIVE_FILE_MISSING');
  if (meta === 'not_ours') throw fail('Drive 원본을 되돌릴 권한이 없어요.', 'DRIVE_FORBIDDEN');
  if (meta === 'failed') throw fail('Google Drive를 확인하지 못했어요. 잠시 뒤 다시 해 주세요.', 'DRIVE_UNAVAILABLE');
  if (meta.trashed) {
    const done = await setTrashed(input.driveFileId, false, token, deps);
    if (done === 'not_ours') throw fail('Drive 원본을 되돌릴 권한이 없어요.', 'DRIVE_FORBIDDEN');
    if (done !== 'done') throw fail('Drive 휴지통에서 꺼내지 못했어요. 잠시 뒤 다시 해 주세요.', done === 'unknown' ? 'RESULT_UNKNOWN' : 'DRIVE_UNAVAILABLE');
  }
  const size = Number(meta.size);
  const attachment = {
    drive_file_id: input.driveFileId,
    file_name: typeof meta.name === 'string' && meta.name ? meta.name : '파일',
    mime_type: typeof meta.mimeType === 'string' && meta.mimeType ? meta.mimeType : 'application/octet-stream',
    size_bytes: Number.isSafeInteger(size) && size >= 0 ? size : 0,
  };
  for (let round = 0; round < 2; round++) {
    if (round) row = await readNote(input, deps);
    const files = attOf(row);
    if (files.some((a) => a?.drive_file_id === input.driveFileId)) return { ok: true, already: true, target: input.target, id: input.id, drive_file_id: input.driveFileId, note: { id: row.id, updated_at: row.updated_at } };
    if (files.length >= MAX_ATTACHMENTS) break;
    const saved = await patchNote(row, [...files, attachment], deps);
    if (saved) return { ok: true, restored: true, target: input.target, id: input.id, drive_file_id: input.driveFileId, note: { id: saved.id, updated_at: saved.updated_at } };
  }
  throw fail('Drive 휴지통에서는 꺼냈지만 기록에 다시 붙이지 못했어요. 다시 열어 확인해 주세요.', 'RESULT_UNKNOWN', { drive_result: 'restored' });
}
