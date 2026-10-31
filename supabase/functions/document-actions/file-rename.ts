// ATT-이름고치기(2026-10-31 사용자 결정 "추천안대로"): 첨부 파일 이름을 그 자리에서 고치기 — 서버 한 곳(document-actions action=rename-file).
// 화면은 {target, id, drive_file_id, base}만 보낸다. target은 첨부가 걸린 줄의 종류다.
//   note: 정리함·노트·업데이트 기록(app_notes.attachments) / task: 할 일 첨부(app_task_attachments, id=google_task_id)
//   document: 자료(app_documents — 사업 보고·담당조직·프로젝트 자료·자료실, id=자료 id, file_id=drive_file_id)
// 순서: ① 내 로그인 토큰으로 그 줄을 읽는다(남의 작업공간 줄은 RLS가 숨김 = 404). 그 줄에 그 Drive 파일이 있어야 한다.
//       ② 옛 이름의 확장자를 서버가 붙여 새 이름을 만든다(이름 규칙: _shared/file-rename-name.mjs, 화면과 같은 사본).
//       ③ Google Drive 원본 이름을 바꾼다. 실패하면 DB는 건드리지 않는다.
//       ④ 같은 작업공간에서 그 Drive 파일을 가리키는 Web2 줄(노트 첨부·할 일 첨부·자료)의 file_name을 모두 새 이름으로 맞춘다(둘이 어긋나지 않게).
//          DB 쓰기는 모두 내 로그인 토큰(RLS 소유자 정책)으로 한다. 서버 키로는 Drive 토큰만 읽는다.
// 할 일 첨부 표는 로그인 사용자에게 update 권한이 없어(select·insert·delete만), 같은 값으로 지우고 새 이름으로 다시 넣는다(기존 권한 안).
// 다시 넣기가 실패하면 원래 줄을 다시 넣어 본다. 그래도 실패하면 RESULT_UNKNOWN(화면이 다시 읽음).
import { checkFileBase, splitFileName } from '../_shared/file-rename-name.mjs';

export type RenameTarget = 'note' | 'task' | 'document';
export type RenameInput = { target: RenameTarget; id: string; driveFileId: string; base: string };
export type RenameDeps = {
  // 내 로그인 토큰으로 PostgREST를 부른다. 실패하면 던진다({status}).
  userDb: (path: string, opts?: { method?: string; body?: unknown; prefer?: string }) => Promise<any>;
  driveToken: () => Promise<string>;
  fetch: typeof fetch;
  now: () => number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const TASK_ID = /^[A-Za-z0-9_-]{1,200}$/;
const TARGETS = new Set(['note', 'task', 'document']);
const fail = (message: string, code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), { code, ...extra });
const enc = encodeURIComponent;
const attOf = (row: any): any[] => Array.isArray(row?.attachments) ? row.attachments : [];

export function parseRenameRequest(body: any): RenameInput {
  const keys = Object.keys(body || {}).sort().join(',');
  if (keys !== 'action,base,drive_file_id,id,target') throw fail('이름 바꾸기 요청을 확인할 수 없습니다.', 'INVALID_REQUEST');
  const target = String(body.target), id = String(body.id), driveFileId = String(body.drive_file_id);
  if (!TARGETS.has(target) || !DRIVE_ID.test(driveFileId) || typeof body.base !== 'string' || [...body.base].length > 400) throw fail('이름 바꾸기 요청을 확인할 수 없습니다.', 'INVALID_REQUEST');
  if ((target === 'task' ? !TASK_ID.test(id) : !UUID.test(id))) throw fail('이름 바꾸기 요청을 확인할 수 없습니다.', 'INVALID_REQUEST');
  return { target: target as RenameTarget, id: target === 'task' ? id : id.toLowerCase(), driveFileId, base: body.base };
}

// ① 그 줄에서 옛 이름과 작업공간을 읽는다.
async function readSource(input: RenameInput, deps: RenameDeps): Promise<{ workspaceId: string; oldName: string }> {
  let row: any, oldName: unknown;
  if (input.target === 'note') {
    const rows = await deps.userDb(`app_notes?id=eq.${enc(input.id)}&select=id,workspace_id,attachments&limit=2`);
    row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row || String(row.id).toLowerCase() !== input.id) throw fail('첨부가 있는 기록을 찾을 수 없습니다.', 'NOT_FOUND');
    oldName = attOf(row).find((a) => a && typeof a === 'object' && a.drive_file_id === input.driveFileId)?.file_name;
  } else if (input.target === 'task') {
    const rows = await deps.userDb(`app_task_attachments?google_task_id=eq.${enc(input.id)}&drive_file_id=eq.${enc(input.driveFileId)}&select=workspace_id,google_task_id,drive_file_id,file_name&limit=2`);
    row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row || row.google_task_id !== input.id) throw fail('할 일 첨부를 찾을 수 없습니다.', 'NOT_FOUND');
    oldName = row.file_name;
  } else {
    const rows = await deps.userDb(`app_documents?id=eq.${enc(input.id)}&select=id,workspace_id,file_id,file_name&limit=2`);
    row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!row || String(row.id).toLowerCase() !== input.id) throw fail('자료를 찾을 수 없습니다.', 'NOT_FOUND');
    if (row.file_id !== input.driveFileId) throw fail('이 자료의 파일이 아닙니다.', 'ATTACHMENT_NOT_FOUND');
    oldName = row.file_name;
  }
  if (typeof oldName !== 'string' || !oldName) throw fail('이 기록의 첨부가 아닙니다.', 'ATTACHMENT_NOT_FOUND');
  if (typeof row.workspace_id !== 'string' || !UUID.test(row.workspace_id)) throw fail('작업공간을 확인하지 못했습니다.', 'NOT_FOUND');
  return { workspaceId: row.workspace_id, oldName };
}

// ③ Drive 원본 이름 바꾸기.
async function renameDrive(fileId: string, name: string, deps: RenameDeps) {
  let r: Response;
  try {
    r = await deps.fetch(`https://www.googleapis.com/drive/v3/files/${enc(fileId)}?fields=id,name,trashed`, {
      method: 'PATCH', redirect: 'error',
      headers: { Authorization: `Bearer ${await deps.driveToken()}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name }),
    });
  } catch {
    throw fail('Google Drive 이름 바꾸기 결과를 확인하지 못했습니다. 다시 열어 확인해 주세요.', 'RESULT_UNKNOWN', { drive_result: 'unknown' });
  }
  if (r.status === 404) throw fail('Drive 원본을 찾을 수 없어 이름을 바꾸지 않았습니다.', 'DRIVE_FILE_MISSING');
  if (r.status === 403) throw fail('Drive 원본 이름을 바꿀 권한이 없습니다.', 'DRIVE_FORBIDDEN');
  if (!r.ok) throw fail('Google Drive 이름 바꾸기에 실패했습니다. 잠시 뒤 다시 해 주세요.', 'DRIVE_UNAVAILABLE');
  const d = await r.json().catch(() => null);
  if (!d || d.id !== fileId || d.name !== name) throw fail('Google Drive 이름 바꾸기 결과를 확인하지 못했습니다. 다시 열어 확인해 주세요.', 'RESULT_UNKNOWN', { drive_result: 'unknown' });
}

// ④-1 노트 첨부(jsonb 배열): 그 파일 칸의 file_name만 바꾼다. 읽은 뒤 바뀌었으면(updated_at 다름) 한 번 다시 읽어 맞춘다.
async function syncNotes(workspaceId: string, fileId: string, name: string, deps: RenameDeps): Promise<number> {
  const contains = enc(JSON.stringify([{ drive_file_id: fileId }]));
  let count = 0;
  for (let round = 0; round < 2; round++) {
    const rows = await deps.userDb(`app_notes?workspace_id=eq.${enc(workspaceId)}&attachments=cs.${contains}&select=id,attachments,updated_at&limit=50`);
    const todo = (Array.isArray(rows) ? rows : []).filter((n) => attOf(n).some((a) => a?.drive_file_id === fileId && a.file_name !== name));
    if (!todo.length) return count;
    for (const n of todo) {
      const attachments = attOf(n).map((a) => a?.drive_file_id === fileId ? { ...a, file_name: name } : a);
      const done = await deps.userDb(`app_notes?id=eq.${enc(n.id)}&workspace_id=eq.${enc(workspaceId)}&updated_at=eq.${enc(n.updated_at)}&select=id`, {
        method: 'PATCH', prefer: 'return=representation', body: { attachments, updated_at: new Date(deps.now()).toISOString() },
      });
      if (Array.isArray(done) && done.length === 1) count++;
    }
  }
  const left = await deps.userDb(`app_notes?workspace_id=eq.${enc(workspaceId)}&attachments=cs.${contains}&select=id,attachments&limit=50`);
  if ((Array.isArray(left) ? left : []).some((n) => attOf(n).some((a) => a?.drive_file_id === fileId && a.file_name !== name))) throw fail('기록의 첨부 이름을 다 맞추지 못했습니다.', 'RESULT_UNKNOWN', { drive_result: 'renamed' });
  return count;
}

// ④-2 할 일 첨부: update 권한이 없으므로 지우고 같은 값 + 새 이름으로 다시 넣는다.
async function syncTasks(workspaceId: string, fileId: string, name: string, deps: RenameDeps): Promise<number> {
  const rows = await deps.userDb(`app_task_attachments?workspace_id=eq.${enc(workspaceId)}&drive_file_id=eq.${enc(fileId)}&select=workspace_id,google_task_id,drive_file_id,file_name,mime_type,size_bytes,created_at&limit=2`);
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || row.file_name === name) return 0;
  const keep = { workspace_id: row.workspace_id, google_task_id: row.google_task_id, drive_file_id: row.drive_file_id, mime_type: row.mime_type, size_bytes: row.size_bytes };
  const gone = await deps.userDb(`app_task_attachments?workspace_id=eq.${enc(workspaceId)}&drive_file_id=eq.${enc(fileId)}&file_name=eq.${enc(row.file_name)}&select=drive_file_id`, { method: 'DELETE', prefer: 'return=representation' });
  if (!Array.isArray(gone) || gone.length !== 1) throw fail('할 일 첨부 이름을 맞추지 못했습니다.', 'RESULT_UNKNOWN', { drive_result: 'renamed' });
  try {
    await deps.userDb('app_task_attachments', { method: 'POST', prefer: 'return=minimal', body: { ...keep, file_name: name } });
  } catch {
    try { await deps.userDb('app_task_attachments', { method: 'POST', prefer: 'return=minimal', body: { ...keep, file_name: row.file_name } }); } catch { /* 아래에서 알림 */ }
    throw fail('할 일 첨부 이름을 맞추지 못했습니다. 다시 열어 확인해 주세요.', 'RESULT_UNKNOWN', { drive_result: 'renamed' });
  }
  return 1;
}

// ④-3 자료: file_name을 바꾸고, 제목이 옛 파일 이름(확장자 있거나 없거나)과 같던 자료는 제목도 새 이름 부분으로.
async function syncDocuments(workspaceId: string, fileId: string, oldName: string, name: string, deps: RenameDeps): Promise<number> {
  const rows = await deps.userDb(`app_documents?workspace_id=eq.${enc(workspaceId)}&file_id=eq.${enc(fileId)}&select=id,title,file_name&limit=20`);
  const oldBase = splitFileName(oldName).base, newBase = splitFileName(name).base;
  let count = 0;
  for (const d of Array.isArray(rows) ? rows : []) {
    if (d.file_name === name) continue;
    const title = String(d.title ?? '').trim();
    const body: Record<string, unknown> = { file_name: name };
    if (title && (title === oldName || title === oldBase || title === d.file_name || title === splitFileName(String(d.file_name ?? '')).base)) body.title = newBase;
    const done = await deps.userDb(`app_documents?id=eq.${enc(d.id)}&workspace_id=eq.${enc(workspaceId)}&file_id=eq.${enc(fileId)}&select=id,file_name`, { method: 'PATCH', prefer: 'return=representation', body });
    if (!Array.isArray(done) || done.length !== 1 || done[0].file_name !== name) throw fail('자료의 파일 이름을 맞추지 못했습니다.', 'RESULT_UNKNOWN', { drive_result: 'renamed' });
    count++;
  }
  return count;
}

export async function renameFile(body: any, deps: RenameDeps) {
  const input = parseRenameRequest(body);
  const checked = checkFileBase(input.base);
  if (!checked.ok) throw fail(checked.message, 'INVALID_NAME');
  const { workspaceId, oldName } = await readSource(input, deps);
  const name = checked.base + splitFileName(oldName).ext;
  if ([...name].length > 255) throw fail('이름이 너무 깁니다.', 'INVALID_NAME');
  if (name !== oldName) await renameDrive(input.driveFileId, name, deps);
  // 이름이 같아도 어긋난 줄이 있으면 맞춘다(전에 일부만 맞춘 경우).
  const notes = await syncNotes(workspaceId, input.driveFileId, name, deps);
  const tasks = await syncTasks(workspaceId, input.driveFileId, name, deps);
  const documents = await syncDocuments(workspaceId, input.driveFileId, oldName, name, deps);
  return { ok: true, drive_file_id: input.driveFileId, name, unchanged: name === oldName, updated: { notes, tasks, documents } };
}
