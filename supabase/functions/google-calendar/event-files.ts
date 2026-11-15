// CAL-일정첨부(요청함 11/11 11:11, 명진 "1~3 좋아"): 일정 창의 [사진·파일]. 원본 위치 원칙 그대로 —
//   일정 = Google Calendar, 자료 원문 = Drive. 파일은 내 작업공간 Drive '자료실 › 일정 첨부'에 한 번만 올리고,
//   일정에는 Google 캘린더 '첨부'(events attachments, supportsAttachments=true)로 붙여 Google 캘린더 앱에서도 보이게 한다.
// - Web2 표는 두지 않는다: 어느 일정에 어느 파일이 붙었는지는 Google 일정의 attachments가 원본이다(같은 사실을 두 곳에 두지 않음).
//   서버는 화면이 보낸 id를 믿지 않고, 매번 내 Google 캘린더 토큰으로 그 일정을 다시 읽어 그 파일이 붙어 있는지 확인한다.
// - Google 요청 범위는 넓히지 않는다: 일정 쪽은 지금 있는 calendar.events, 파일 쪽은 작업공간 Drive 연결(자료실과 같은 길)만 쓴다.
// - 공유 범위를 넓히지 않는다: Drive 파일 공유 설정은 건드리지 않는다(같이 쓰는 캘린더의 상대에게는 첨부 이름만 보이고 열리지 않음).
// - 일정 쓰기는 읽은 판(etag)이 같을 때만 한다(If-Match). 그 사이 다른 기기·Google 앱에서 일정이 바뀌었으면 한 번 다시 읽어 다시 쓴다.
// - [빼기](detach-file)는 일정에서만 뗀다(Drive에 남음). [삭제](trash-file)는 떼고, 다른 Web2 기록이 같은 파일을 쓰지 않을 때만
//   '일정 첨부' 폴더에 이 앱이 올린 파일을 Drive 휴지통으로 보낸다(완전 삭제 아님, 30일 안 되살림 — FILE-첨부삭제와 같음).
//   [되돌리기](restore-file)는 휴지통에서 꺼내고 다시 붙인다. 일정을 지워도 Drive 파일은 남는다(delete-event는 Drive를 건드리지 않음).
// - 이름 수정(rename-file)은 '일정 첨부' 폴더의 내 파일만: Drive 이름을 바꾸고 일정 첨부 이름도 맞춘다(확장자는 서버가 그대로 붙임).
import { createDriveUpload, UploadError } from "../_shared/drive-upload.ts";
import type { UploadAdmin } from "../_shared/drive-upload.ts";
import { moveDriveFileToTrash } from "../_shared/drive-trash.ts";
import { checkFileBase, splitFileName } from "../_shared/file-rename-name.mjs";
import { createDrivePhoto, parsePhotoSize, PhotoError, photoErrorResponse } from "../_shared/drive-photo.ts";

export const EVENT_FILES_FOLDER = "일정 첨부";
// Google 캘린더는 한 일정에 첨부를 25개까지 둔다.
export const MAX_EVENT_FILES = 25;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const FILE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const REF = /^[^\s\u0000-\u001f\u007f/]{1,1024}$/;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const CAL = "https://www.googleapis.com/calendar/v3/calendars";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const enc = encodeURIComponent;
// Drive 파일을 일정 첨부로 붙일 때 Google이 요구하는 주소 모양(Drive alternateLink와 같은 모양).
export const driveLink = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=drivesdk`;

export type EventFile = { drive_file_id: string; file_name: string; mime_type: string };
type Result = { status: number; body: Record<string, unknown> };
type Db = { from: (table: string) => any };
type Deps = {
  // index.ts normEvent와 같은 첨부 정리(화이트리스트)를 받는다 — 같은 규칙을 두 곳에 두지 않는다.
  files: (raw: unknown) => EventFile[];
  fetch?: typeof fetch;
  log?: (code: string) => void;
};
type Ctx = { workspaceId: string; db: Db; access: () => Promise<{ access_token: string }> };
const fail = (status: number, code: string, error: string): Result => ({ status, body: { error, code } });

const DRIVE_TEXT: Record<string, string> = {
  drive_not_connected: "Google Drive 연결이 필요합니다. 자료실의 Google Drive 연결을 확인해 주세요.",
  drive_auth_expired: "Google Drive 연결이 만료됐습니다. 자료실의 Google Drive 연결을 다시 해 주세요.",
  drive_folder_not_private: `Drive의 "${EVENT_FILES_FOLDER}" 폴더가 공유되어 있어 저장하지 않았습니다. 공유를 끈 뒤 다시 시도해 주세요.`,
  drive_folder_permissions_unavailable: `Drive의 "${EVENT_FILES_FOLDER}" 폴더 공유 상태를 확인하지 못해 저장하지 않았습니다.`,
  drive_folder_invalid: "자료실 Drive 폴더 설정을 확인하지 못했습니다.",
  library_folder_missing: "자료실 Drive 폴더가 아직 없습니다. 자료실에 파일을 한 번 올린 뒤 다시 시도해 주세요.",
};
function driveFailure(e: unknown): Result {
  if (e instanceof UploadError) {
    return fail(e.status, e.code, DRIVE_TEXT[e.code] || "Google Drive에 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return fail(503, "drive_failed", "Google Drive에 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

// 요청의 일정 주소. calendar_id·event_id는 Google이 판단하고(남의 일정이면 Google이 거절), 여기서는 모양만 본다.
function ref(body: any): { calendarId: string; eventId: string } | null {
  const calendarId = String(body?.calendar_id ?? "primary"), eventId = String(body?.event_id ?? "");
  return REF.test(calendarId) && REF.test(eventId) ? { calendarId, eventId } : null;
}

export function createEventFiles(admin: UploadAdmin, deps: Deps) {
  const request = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? ((code: string) => console.log(JSON.stringify({ fn: "google-calendar", event_files: code })));
  const drive = createDriveUpload(admin, { fetch: request, log });
  const photoOf = createDrivePhoto(admin, { fetch: request, log });

  // ---- Google 캘린더 ----
  type Ev = { etag: string; raw: any[]; files: EventFile[] };
  const eventUrl = (r: { calendarId: string; eventId: string }) => `${CAL}/${enc(r.calendarId)}/events/${enc(r.eventId)}`;
  async function readEvent(r: { calendarId: string; eventId: string }, token: string): Promise<Ev | Result> {
    let res: Response;
    try {
      res = await request(eventUrl(r) + "?fields=" + enc("id,etag,status,attachments"), { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
    } catch {
      return fail(503, "calendar_failed", "Google 캘린더를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const d = await res.json().catch(() => null);
    if (res.status === 404 || res.status === 410 || d?.status === "cancelled") return fail(404, "event_not_found", "Google 일정을 찾을 수 없습니다.");
    if (res.status === 401) return fail(401, "calendar_auth", "Google 재인증이 필요합니다.");
    if (!res.ok || typeof d?.etag !== "string") return fail(503, "calendar_failed", "Google 캘린더를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    const raw = Array.isArray(d.attachments) ? d.attachments : [];
    return { etag: d.etag, raw, files: deps.files(raw) };
  }
  // 첨부 목록 쓰기. 결과: 'ok'(새 목록) | 'conflict'(그 사이 바뀜) | 'rejected'(Google이 거절 — 아무것도 안 바뀜) | 'unknown'.
  async function writeAttachments(r: { calendarId: string; eventId: string }, token: string, etag: string, list: any[]) {
    const body = { attachments: list.map((a) => ({ fileUrl: a.fileUrl, ...(a.title ? { title: a.title } : {}), ...(a.mimeType ? { mimeType: a.mimeType } : {}), ...(a.iconLink ? { iconLink: a.iconLink } : {}) })) };
    let res: Response;
    try {
      res = await request(eventUrl(r) + "?supportsAttachments=true&fields=" + enc("id,etag,attachments"), {
        method: "PATCH", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify(body),
      });
    } catch {
      return { state: "unknown" as const };
    }
    if (res.status === 412) return { state: "conflict" as const };
    const d = await res.json().catch(() => null);
    if (res.ok && d && typeof d.etag === "string") return { state: "ok" as const, files: deps.files(d.attachments) };
    if (res.status >= 400 && res.status < 500) return { state: "rejected" as const, status: res.status };
    return { state: "unknown" as const };
  }
  // 읽기 → 고치기 → 쓰기. 그 사이 바뀌었으면(412) 한 번만 다시 읽어 다시 쓴다. change(ev)가 Result를 돌려주면 그대로 멈춘다.
  async function editAttachments(r: { calendarId: string; eventId: string }, token: string, change: (ev: Ev) => any[] | Result) {
    for (let round = 0; round < 2; round++) {
      const ev = await readEvent(r, token);
      if ("status" in ev) return { result: ev as Result };
      const next = change(ev);
      if (!Array.isArray(next)) return { result: next as Result };
      const done = await writeAttachments(r, token, ev.etag, next);
      if (done.state === "conflict") continue;
      return { done, before: ev };
    }
    return { result: fail(409, "event_changed", "다른 곳에서 일정이 바뀌는 중이라 저장하지 못했습니다. 다시 시도해 주세요.") };
  }
  const rejected = (status?: number) => status === 403
    ? fail(403, "event_read_only", "이 일정은 고칠 수 없는 일정이라 파일을 붙이지 못했습니다.")
    : fail(400, "calendar_rejected", "Google 캘린더가 첨부 저장을 받지 않았습니다.");
  const unknown = () => fail(503, "attach_result_unknown", "저장 결과를 확인하지 못했습니다. 일정을 다시 열어 확인해 주세요.");
  const isDrive = (a: any, id: string) => a?.fileId === id;

  // ---- Drive ----
  async function libraryFolder(workspaceId: string) {
    const { data, error } = await admin.from("app_drive_settings").select("library_folder_id").eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw new UploadError(503, "drive_settings_failed", "drive_settings");
    if (!data?.library_folder_id) throw new UploadError(409, "library_folder_missing", "drive_folder");
    return data.library_folder_id as string;
  }
  async function eventFolder(workspaceId: string) {
    const token = await drive.driveToken(workspaceId);
    const folder = await drive.ensurePrivateChildFolder(await libraryFolder(workspaceId), EVENT_FILES_FOLDER, token);
    return { token, folder };
  }
  // '일정 첨부' 폴더 바로 아래의 내 파일인지. 돌려줌: 정보 | 'missing' | 'not_ours' | 'failed'.
  async function ownFile(fileId: string, folder: string, token: string) {
    let r: Response;
    try {
      r = await request(`${DRIVE}/${enc(fileId)}?fields=id,name,mimeType,size,ownedByMe,trashed,parents`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
    } catch {
      return "failed" as const;
    }
    if (r.status === 404) return "missing" as const;
    if (r.status === 403) return "not_ours" as const;
    if (!r.ok) return "failed" as const;
    const d = await r.json().catch(() => null);
    if (!d || d.id !== fileId || typeof d.trashed !== "boolean") return "failed" as const;
    if (d.ownedByMe !== true || d.mimeType === FOLDER_MIME || !Array.isArray(d.parents) || d.parents.length !== 1 || d.parents[0] !== folder) return "not_ours" as const;
    return d as { id: string; name: string; mimeType: string; size?: string; trashed: boolean };
  }
  async function drivePatch(fileId: string, token: string, body: unknown) {
    try {
      const r = await request(`${DRIVE}/${enc(fileId)}?fields=id,name,trashed`, {
        method: "PATCH", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.ok ? await r.json().catch(() => null) : null;
    } catch {
      return null;
    }
  }
  // 같은 작업공간에서 이 파일을 쓰는 다른 Web2 기록(자료·할 일 첨부·노트 첨부)이 있나. 내 로그인 토큰(RLS)으로 읽고, 읽기 실패는 '씀'(지우지 않는 쪽).
  async function usedElsewhere(db: Db, workspaceId: string, fileId: string) {
    try {
      const reads = await Promise.all([
        db.from("app_documents").select("id").eq("workspace_id", workspaceId).eq("file_id", fileId).limit(1),
        db.from("app_task_attachments").select("drive_file_id").eq("workspace_id", workspaceId).eq("drive_file_id", fileId).limit(1),
        db.from("app_notes").select("id").eq("workspace_id", workspaceId).contains("attachments", JSON.stringify([{ drive_file_id: fileId }])).limit(1),
      ]);
      if (reads.some((x: any) => x?.error || !Array.isArray(x?.data))) return true;
      return reads.some((x: any) => x.data.length > 0);
    } catch {
      return true;
    }
  }

  // POST multipart action=attach-file: calendar_id + event_id + 파일 하나. 확인(일정·개수) → Drive 올리기 → 일정 첨부 쓰기.
  // Google이 확실히 거절하면 이번에 올린 파일만 지운다. 결과를 모르면 파일을 남기고 다시 읽어 확인한다.
  async function attach(req: Request, ctx: Ctx): Promise<Result> {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, "invalid_request", "업로드 요청을 읽지 못했습니다. 다시 시도해 주세요.");
    }
    const r = ref({ calendar_id: form.get("calendar_id") ?? "primary", event_id: form.get("event_id") });
    const entries = form.getAll("file");
    if (!r) return fail(400, "event_invalid", "Google 일정 ID가 없습니다.");
    if (entries.length !== 1 || !(entries[0] instanceof File)) return fail(400, "file_missing", "파일을 하나 골라 주세요.");
    const file = entries[0] as File, mime = file.type || "application/octet-stream";
    if (file.size <= 0) return fail(400, "file_empty", "빈 파일은 붙일 수 없습니다.");
    if (file.size > MAX_FILE_BYTES) return fail(413, "file_too_large", "파일은 100MB까지 붙일 수 있습니다.");
    if ([...file.name].length < 1 || [...file.name].length > 255 || /[\u0000-\u001f\u007f]/.test(file.name) ||
      !/^[^/\s]{1,127}\/[^/\s]{1,127}$/.test(mime)) return fail(400, "file_metadata_invalid", "파일 이름이나 형식을 확인해 주세요.");
    const cal = (await ctx.access()).access_token;
    const first = await readEvent(r, cal);
    if ("status" in first) return first as Result;
    if (first.raw.length >= MAX_EVENT_FILES) return fail(400, "too_many_files", `한 일정에는 파일을 ${MAX_EVENT_FILES}개까지 붙일 수 있습니다.`);
    let token = "", fileId = "";
    try {
      const at = await eventFolder(ctx.workspaceId);
      token = at.token;
      fileId = await drive.upload(file, at.folder, token);
    } catch (e) {
      return driveFailure(e);
    }
    if (!FILE_ID.test(fileId)) return unknown();
    const added = { fileUrl: driveLink(fileId), title: file.name, mimeType: mime };
    const out = await editAttachments(r, cal, (ev) => {
      if (ev.raw.some((a) => isDrive(a, fileId))) return ev.raw;
      if (ev.raw.length >= MAX_EVENT_FILES) return fail(400, "too_many_files", `한 일정에는 파일을 ${MAX_EVENT_FILES}개까지 붙일 수 있습니다.`);
      return [...ev.raw, added];
    });
    const done = out.done;
    if (done?.state === "ok") {
      const files = done.files.some((f) => f.drive_file_id === fileId) ? done.files : [...done.files, { drive_file_id: fileId, file_name: file.name, mime_type: mime }];
      return { status: 200, body: { ok: true, file: files.find((f) => f.drive_file_id === fileId), files } };
    }
    // 붙이지 못함이 확실하면(거절·개수 초과·일정 없음) 이번에 올린 파일만 지운다.
    if (out.result || done?.state === "rejected") {
      await drive.discardUploadedFile(fileId, token);
      log("attach_rejected");
      return out.result || rejected(done?.state === "rejected" ? done.status : undefined);
    }
    // 결과 모름: 다시 읽어 붙어 있으면 성공, 아니면 파일은 남기고(나중에 지우면 됨) 결과 모름으로 알린다.
    const check = await readEvent(r, cal);
    if (!("status" in check) && check.files.some((f) => f.drive_file_id === fileId)) {
      return { status: 200, body: { ok: true, file: check.files.find((f) => f.drive_file_id === fileId), files: check.files } };
    }
    log("attach_result_unknown");
    return unknown();
  }

  // POST {action:'detach-file', calendar_id, event_id, drive_file_id}: 일정에서만 뗀다. Drive 파일은 남는다.
  async function detach(body: any, ctx: Ctx): Promise<Result> {
    const r = ref(body), fileId = String(body?.drive_file_id || "");
    if (!r || !FILE_ID.test(fileId)) return fail(400, "detach_invalid", "뺄 파일을 확인하지 못했습니다.");
    const cal = (await ctx.access()).access_token;
    const out = await editAttachments(r, cal, (ev) => ev.raw.some((a) => isDrive(a, fileId)) ? ev.raw.filter((a) => !isDrive(a, fileId)) : fail(404, "file_not_found", "이미 빠진 파일입니다."));
    if (out.result) return out.result;
    if (out.done?.state === "ok") return { status: 200, body: { ok: true, files: out.done.files } };
    return out.done?.state === "rejected" ? rejected(out.done.status) : unknown();
  }

  // 휴지통·되돌리기에 쓰는 '다시 붙이기'(올리기 없음). '일정 첨부' 폴더의 내 파일만, 이름·종류는 Drive 값으로.
  async function attachExisting(r: { calendarId: string; eventId: string }, meta: { id: string; name: string; mimeType: string }, cal: string): Promise<Result> {
    const out = await editAttachments(r, cal, (ev) => {
      if (ev.raw.some((a) => isDrive(a, meta.id))) return ev.raw;
      if (ev.raw.length >= MAX_EVENT_FILES) return fail(400, "too_many_files", `한 일정에는 파일을 ${MAX_EVENT_FILES}개까지 붙일 수 있습니다.`);
      return [...ev.raw, { fileUrl: driveLink(meta.id), title: meta.name, mimeType: meta.mimeType }];
    });
    if (out.result) return out.result;
    if (out.done?.state === "ok") return { status: 200, body: { ok: true, files: out.done.files } };
    return out.done?.state === "rejected" ? rejected(out.done.status) : unknown();
  }

  // POST {action:'trash-file', ...}: [삭제] = 일정에서 떼고, 다른 기록이 쓰지 않으면 Drive 휴지통으로. drive: trashed|kept|not_ours|missing|failed.
  async function trash(body: any, ctx: Ctx): Promise<Result> {
    const r = ref(body), fileId = String(body?.drive_file_id || "");
    if (!r || !FILE_ID.test(fileId)) return fail(400, "trash_invalid", "삭제할 파일을 확인하지 못했습니다.");
    const off = await detach({ ...body, drive_file_id: fileId }, ctx);
    if (off.status !== 200) return off;
    let driveState = "failed";
    try {
      if (await usedElsewhere(ctx.db, ctx.workspaceId, fileId)) driveState = "kept";
      else {
        const at = await eventFolder(ctx.workspaceId);
        const moved = await moveDriveFileToTrash(request, fileId, at.folder, at.token);
        driveState = moved === "trashed" || moved === "already_trashed" ? "trashed" : moved === "not_ours" ? "not_ours" : "failed";
      }
    } catch {
      driveState = "failed";
    }
    return { status: 200, body: { ok: true, detached: true, drive: driveState, drive_file_id: fileId, files: off.body.files } };
  }

  // POST {action:'restore-file', ...}: [되돌리기] = Drive 휴지통에서 꺼내고 다시 붙인다.
  async function restore(body: any, ctx: Ctx): Promise<Result> {
    const r = ref(body), fileId = String(body?.drive_file_id || "");
    if (!r || !FILE_ID.test(fileId)) return fail(400, "restore_invalid", "되돌릴 파일을 확인하지 못했습니다.");
    let at: { token: string; folder: string };
    try {
      at = await eventFolder(ctx.workspaceId);
    } catch (e) {
      return driveFailure(e);
    }
    const meta = await ownFile(fileId, at.folder, at.token);
    if (meta === "missing") return fail(404, "file_not_found", "Drive 원본을 찾을 수 없어 되돌리지 못했습니다.");
    if (meta === "not_ours") return fail(403, "drive_forbidden", "Drive 원본을 되돌릴 권한이 없습니다.");
    if (meta === "failed") return fail(503, "drive_failed", "Google Drive를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    if (meta.trashed) {
      const back = await drivePatch(fileId, at.token, { trashed: false });
      if (!back || back.id !== fileId || back.trashed !== false) return fail(503, "drive_failed", "Drive 휴지통에서 꺼내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const cal = (await ctx.access()).access_token;
    const on = await attachExisting(r, meta, cal);
    return on.status === 200 ? { status: 200, body: { ...on.body, restored: true, drive_file_id: fileId } } : on;
  }

  // POST {action:'rename-file', calendar_id, event_id, drive_file_id, base}: '일정 첨부' 폴더의 내 파일만.
  // 확장자는 옛 이름 것을 서버가 붙인다. Drive 이름을 먼저 바꾸고, 일정 첨부 이름을 맞춘다(실패하면 event_synced:false).
  async function rename(body: any, ctx: Ctx): Promise<Result> {
    const r = ref(body), fileId = String(body?.drive_file_id || "");
    if (!r || !FILE_ID.test(fileId) || typeof body?.base !== "string" || [...body.base].length > 400) return fail(400, "rename_invalid", "이름 바꾸기 요청을 확인할 수 없습니다.");
    const checked = checkFileBase(body.base);
    if (!checked.ok) return fail(400, "name_invalid", checked.message || "이름을 확인해 주세요.");
    const cal = (await ctx.access()).access_token;
    const ev = await readEvent(r, cal);
    if ("status" in ev) return ev as Result;
    if (!ev.raw.some((a) => isDrive(a, fileId))) return fail(404, "file_not_found", "이 일정에 붙어 있지 않은 파일입니다.");
    let at: { token: string; folder: string };
    try {
      at = await eventFolder(ctx.workspaceId);
    } catch (e) {
      return driveFailure(e);
    }
    const meta = await ownFile(fileId, at.folder, at.token);
    if (meta === "missing") return fail(404, "file_not_found", "Drive 원본을 찾을 수 없습니다.");
    if (meta === "not_ours") return fail(403, "drive_forbidden", "이 앱이 올린 파일만 이름을 고칠 수 있습니다.");
    if (meta === "failed") return fail(503, "drive_failed", "Google Drive를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    const name = checked.base + splitFileName(meta.name).ext;
    if (name !== meta.name) {
      const done = await drivePatch(fileId, at.token, { name });
      if (!done || done.id !== fileId || done.name !== name) return fail(503, "drive_failed", "Drive 이름을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const out = await editAttachments(r, cal, (now) => now.raw.map((a) => isDrive(a, fileId) ? { ...a, title: name } : a));
    const synced = out.done?.state === "ok";
    return { status: 200, body: { ok: true, name, drive_file_id: fileId, event_synced: synced, files: synced ? out.done!.files : null } };
  }

  // GET ?action=file-photo&calendarId&eventId&fileId&size=small|large: 일정 창의 작은 그림·크게 보기.
  // 그 파일이 지금 그 일정에 붙어 있는지 내 캘린더 토큰으로 확인한 뒤, 공용 줄인 그림(_shared/drive-photo.ts)으로 Drive 썸네일만 돌려준다.
  // Drive는 읽기만, 그림은 어디에도 저장하지 않는다(내 작업공간 Drive 연결이 가진 내 파일만 — 남의 파일은 404).
  async function photo(url: URL, ctx: Ctx): Promise<Response> {
    try {
      const r = ref({ calendar_id: url.searchParams.get("calendarId") ?? "primary", event_id: url.searchParams.get("eventId") });
      const fileId = String(url.searchParams.get("fileId") || ""), size = parsePhotoSize(url.searchParams.get("size"));
      if (!r || !FILE_ID.test(fileId)) throw new PhotoError(400, "photo_request_invalid");
      const ev = await readEvent(r, (await ctx.access()).access_token);
      if ("status" in ev) throw new PhotoError((ev as Result).status === 404 ? 404 : 503, "photo_unavailable");
      const file = ev.files.find((f) => f.drive_file_id === fileId);
      if (!file) throw new PhotoError(404, "photo_not_found");
      return await photoOf(fileId, file.mime_type, size, ctx.workspaceId);
    } catch (error) {
      return photoErrorResponse(error, log);
    }
  }

  return { attach, detach, trash, restore, rename, photo };
}
