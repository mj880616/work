// TASK-파일붙이기: files attached to a Google task. Google Tasks stays the source of the task, Google Drive holds the file,
// and public.app_task_attachments (owner RLS) remembers which file belongs to which task. That table is reached only with
// the caller's JWT (db), never the service role. The service role (admin) is used only where library-files and
// basket-files already use it: owner membership, the Drive OAuth setting and the 자료실 folder ID.
// The app reads the table itself (GET /rest/v1/app_task_attachments, owner RLS) to show file names under each task.
// The task's notes get one line per file ("첨부: <name> <Drive link>") so the Google Tasks app shows a link instead of a file.
// Those lines belong to the table: every Web2 save rebuilds them, so an editor opened before an attach never drops a line.
import { createDriveUpload, UploadError } from "../_shared/drive-upload.ts";
import type { UploadAdmin } from "../_shared/drive-upload.ts";

export const MAX_TASK_FILES = 10;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const TASK_FILES_FOLDER = "할 일 첨부";
// Google Tasks keeps at most 8192 characters of notes.
export const NOTES_MAX = 8192;
const TASK_ID = /^[A-Za-z0-9_-]{1,200}$/;
const FILE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const COLS = "google_task_id,drive_file_id,file_name,mime_type,size_bytes,created_at";
export type TaskFile = {
  google_task_id?: string;
  drive_file_id: string;
  file_name: string;
  mime_type?: string;
  size_bytes?: number;
  created_at?: string;
};
export const fileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const LINK = /https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)\/view/;
const lineName = (name: string) => String(name || "파일").replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim() || "파일";
export const fileLine = (f: TaskFile) => `첨부: ${lineName(f.file_name)} ${fileUrl(f.drive_file_id)}`;

// Notes with exactly one line per attached file, at the end, in attach order. Lines of these files (and of `drop`, a file just
// detached) are taken out wherever they are, then added back; everything else the user wrote is kept as it is.
export function notesWithFiles(notes: string, files: TaskFile[], drop: string[] = []): string {
  const known = new Set([...files.map((f) => f.drive_file_id), ...drop]);
  const kept = String(notes || "").split("\n").filter((line) => {
    const m = line.match(LINK);
    return !(m && known.has(m[1]));
  }).join("\n").replace(/\s+$/, "");
  const lines = files.map(fileLine).join("\n");
  return kept && lines ? kept + "\n" + lines : kept || lines;
}

type Db = { from: (table: string) => any };
type Deps = {
  googleReq: (url: string, token: string, method?: string, body?: unknown) => Promise<any>;
  taskUrl: (listId: string, taskId: string) => string;
  listId: string;
  fetch?: typeof fetch;
  log?: (code: string) => void;
};
type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, code: string, error: string): Result => ({ status, body: { error, code } });
const DRIVE_TEXT: Record<string, string> = {
  drive_not_connected: "Google Drive 연결이 필요합니다. 자료실의 Google Drive 연결을 확인해 주세요.",
  drive_auth_expired: "Google Drive 연결이 만료됐습니다. 자료실의 Google Drive 연결을 다시 해 주세요.",
  drive_folder_not_private: `Drive의 "${TASK_FILES_FOLDER}" 폴더가 공유되어 있어 저장하지 않았습니다. 공유를 끈 뒤 다시 시도해 주세요.`,
  drive_folder_permissions_unavailable: `Drive의 "${TASK_FILES_FOLDER}" 폴더 공유 상태를 확인하지 못해 저장하지 않았습니다.`,
  drive_folder_invalid: "자료실 Drive 폴더 설정을 확인하지 못했습니다.",
};
function driveFailure(e: unknown): Result {
  if (e instanceof UploadError) {
    return fail(e.status, e.code, DRIVE_TEXT[e.code] || "Google Drive에 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return fail(503, "drive_failed", "Google Drive에 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

export function createTaskFiles(admin: UploadAdmin, deps: Deps) {
  const log = deps.log ?? ((code: string) => console.log(JSON.stringify({ fn: "google-tasks", task_files: code })));
  const drive = createDriveUpload(admin, { fetch: deps.fetch, log });

  async function listFor(db: Db, taskIds: string[]): Promise<TaskFile[]> {
    const { data, error } = await db.from("app_task_attachments").select(COLS).in("google_task_id", taskIds)
      .order("created_at", { ascending: true });
    if (error || !Array.isArray(data)) throw new Error("task_files_unavailable");
    return data;
  }
  const unavailable = () => fail(503, "task_files_unavailable", "할 일 파일 정보를 불러오지 못했습니다.");

  // Rebuild the file lines of the task's notes from the table. Throws if the table cannot be read.
  async function notesFor(db: Db, taskId: string, notes: string, drop: string[] = []) {
    const rows = await listFor(db, [taskId]);
    return notesWithFiles(notes, rows, drop);
  }

  // Read the task again and write its notes with the current file lines. Never throws; reports whether Google took it.
  async function syncNotes(db: Db, taskId: string, token: string, drop: string[] = []) {
    try {
      const rows = await listFor(db, [taskId]);
      const fresh = await deps.googleReq(deps.taskUrl(deps.listId, taskId), token);
      const notes = notesWithFiles(String(fresh?.notes || ""), rows, drop);
      if (notes === String(fresh?.notes || "")) return { synced: true, task: fresh, files: rows };
      if (notes.length > NOTES_MAX) return { synced: false, task: fresh, files: rows };
      const task = await deps.googleReq(deps.taskUrl(deps.listId, taskId), token, "PATCH", { notes });
      return { synced: true, task, files: rows };
    } catch {
      log("notes_sync_failed");
      return { synced: false, task: null, files: null };
    }
  }

  // action=update: the notes the editor sends get the current file lines. If the table cannot be read, the notes go as sent.
  async function notesForUpdate(db: Db, taskId: string, notes: string) {
    if (!TASK_ID.test(taskId)) return notes;
    try {
      return await notesFor(db, taskId, notes);
    } catch {
      return notes;
    }
  }

  // action=delete: the task is gone, so its file links go too. Drive files stay.
  async function forget(db: Db, taskId: string) {
    if (!TASK_ID.test(taskId)) return;
    const { error } = await db.from("app_task_attachments").delete().eq("google_task_id", taskId);
    if (error) throw error;
  }

  async function ownerWorkspace(userId: string) {
    const { data, error } = await admin.from("app_workspace_members").select("workspace_id,role").eq("user_id", userId)
      .maybeSingle();
    if (error) throw new UploadError(503, "authorize_unavailable", "authorize");
    if (data?.role !== "owner" || !data.workspace_id) throw new UploadError(403, "forbidden", "authorize");
    return data.workspace_id as string;
  }
  async function libraryFolder(workspaceId: string) {
    const { data, error } = await admin.from("app_drive_settings").select("library_folder_id").eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new UploadError(503, "drive_settings_failed", "drive_settings");
    if (!data?.library_folder_id) throw new UploadError(409, "library_folder_missing", "drive_folder");
    return data.library_folder_id as string;
  }

  // POST multipart action=attach: task_id + one file. Checks first (count, task, notes room), then Drive, then the link row,
  // then the notes line. A failed notes write keeps the file and the link (notes_synced:false); the next Web2 save adds the line.
  async function attach(req: Request, userId: string, db: Db, access: () => Promise<{ access_token: string }>): Promise<Result> {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, "invalid_request", "업로드 요청을 읽지 못했습니다. 다시 시도해 주세요.");
    }
    const taskId = form.get("task_id"), entries = form.getAll("file");
    if (typeof taskId !== "string" || !TASK_ID.test(taskId)) return fail(400, "task_id_invalid", "Google 할 일 ID가 없습니다.");
    if (entries.length !== 1 || !(entries[0] instanceof File)) return fail(400, "file_missing", "파일을 하나 골라 주세요.");
    const file = entries[0] as File, mime = file.type || "application/octet-stream";
    if (file.size <= 0) return fail(400, "file_empty", "빈 파일은 붙일 수 없습니다.");
    if (file.size > MAX_FILE_BYTES) return fail(413, "file_too_large", "파일은 100MB까지 붙일 수 있습니다.");
    if ([...file.name].length < 1 || [...file.name].length > 255 || /[\u0000-\u001f\u007f]/.test(file.name) ||
      !/^[^/\s]{1,127}\/[^/\s]{1,127}$/.test(mime)) return fail(400, "file_metadata_invalid", "파일 이름이나 형식을 확인해 주세요.");

    let workspaceId: string;
    try {
      workspaceId = await ownerWorkspace(userId);
    } catch (e) {
      return e instanceof UploadError && e.status === 403
        ? fail(403, "forbidden", "워크스페이스 소유자 권한이 필요합니다.")
        : fail(503, "authorize_unavailable", "권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    let existing: TaskFile[];
    try {
      existing = await listFor(db, [taskId]);
    } catch {
      return unavailable();
    }
    if (existing.length >= MAX_TASK_FILES) {
      return fail(400, "too_many_files", `한 할 일에는 파일을 ${MAX_TASK_FILES}개까지 붙일 수 있습니다.`);
    }
    const conn = await access();
    let task: any;
    try {
      task = await deps.googleReq(deps.taskUrl(deps.listId, taskId), conn.access_token);
    } catch (e: any) {
      if (e?.status === 404) return fail(404, "task_not_found", "Google 할 일을 찾을 수 없습니다.");
      throw e;
    }
    if (!task || task.deleted) return fail(404, "task_not_found", "Google 할 일을 찾을 수 없습니다.");
    const probe = { drive_file_id: "x".repeat(64), file_name: file.name };
    if (notesWithFiles(String(task.notes || ""), [...existing, probe]).length > NOTES_MAX) {
      return fail(400, "notes_too_long", "할 일 메모가 길어 파일 링크를 더 넣을 수 없습니다. 메모를 줄인 뒤 다시 시도해 주세요.");
    }

    let token = "", fileId = "";
    try {
      token = await drive.driveToken();
      const folder = await drive.ensurePrivateChildFolder(await libraryFolder(workspaceId), TASK_FILES_FOLDER, token);
      fileId = await drive.upload(file, folder, token);
    } catch (e) {
      if (e instanceof UploadError && e.code === "library_folder_missing") {
        return fail(409, e.code, "자료실 Drive 폴더가 아직 없습니다. 자료실에 파일을 한 번 올린 뒤 다시 시도해 주세요.");
      }
      return driveFailure(e);
    }
    if (!FILE_ID.test(fileId) || existing.some((f) => f.drive_file_id === fileId)) {
      return fail(409, "duplicate_file", "Drive 응답을 확인하지 못했습니다. 할 일을 다시 열어 확인해 주세요.");
    }
    const row = { workspace_id: workspaceId, google_task_id: taskId, drive_file_id: fileId, file_name: file.name, mime_type: mime, size_bytes: file.size };
    const saved = await db.from("app_task_attachments").insert(row).select(COLS).maybeSingle();
    if (saved.error || !saved.data) {
      // A completed DB rejection (SQLSTATE / 4xx PostgREST) means the row is not there: remove only the file this request made.
      // Anything else may still commit, so read back first and keep the file when the outcome is unknown.
      const definite = /^[0-9A-Z]{5}$/.test(saved.error?.code || "") ||
        (/^PGRST[0-9]+$/.test(saved.error?.code || "") && saved.status >= 400 && saved.status < 500);
      let present = false;
      try {
        present = (await listFor(db, [taskId])).some((f) => f.drive_file_id === fileId);
      } catch {
        if (!definite) {
          log("attach_result_unknown");
          return fail(503, "attach_result_unknown", "저장 결과를 확인하지 못했습니다. 할 일을 다시 열어 확인해 주세요.");
        }
      }
      if (!present) {
        if (definite) {
          await drive.discardUploadedFile(fileId, token);
          log("attach_save_failed");
          return fail(500, "attach_save_failed", "파일 연결을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        log("attach_result_unknown");
        return fail(503, "attach_result_unknown", "저장 결과를 확인하지 못했습니다. 할 일을 다시 열어 확인해 주세요.");
      }
    }
    const notes = await syncNotes(db, taskId, conn.access_token);
    const all = notes.files || [...existing, saved.data || row];
    return {
      status: 200,
      body: { ok: true, file: all.find((f) => f.drive_file_id === fileId) || row, files: all, task: notes.task, notes_synced: notes.synced },
    };
  }

  // POST JSON action=detach {task_id, drive_file_id}: the link and the notes line go; the Drive file stays.
  // The link is removed even while Google is disconnected; the notes line then waits for the next Web2 save.
  async function detach(body: any, db: Db, access: () => Promise<{ access_token: string }>): Promise<Result> {
    const taskId = String(body?.task_id || ""), fileId = String(body?.drive_file_id || "");
    if (!TASK_ID.test(taskId) || !FILE_ID.test(fileId)) return fail(400, "detach_invalid", "뺄 파일을 확인하지 못했습니다.");
    const { data, error } = await db.from("app_task_attachments").delete().eq("google_task_id", taskId).eq("drive_file_id", fileId)
      .select("drive_file_id");
    if (error || !Array.isArray(data)) return unavailable();
    if (!data.length) return fail(404, "file_not_found", "이미 빠진 파일입니다.");
    let token = "";
    try {
      token = (await access()).access_token;
    } catch {
      return { status: 200, body: { ok: true, files: null, task: null, notes_synced: false } };
    }
    const notes = await syncNotes(db, taskId, token, [fileId]);
    return { status: 200, body: { ok: true, files: notes.files, task: notes.task, notes_synced: notes.synced } };
  }

  return { attach, detach, notesForUpdate, forget };
}
