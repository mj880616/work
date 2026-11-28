import { isDelegatedToken } from "../_shared/delegated-token-guard.mjs";
import { createDriveUpload, UploadError } from "../_shared/drive-upload.ts";
import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import {createOcrHandler, NOTE_FILES_FOLDER} from "./ocr.ts";
import { attachmentFolder, MAX_ATTACHMENTS, validateFiles } from "./attach-common.ts";
import { createMcpAttachHandler } from "./mcp-attach.ts";
import type { McpAttachEnv } from "./mcp-attach.ts";
import { createNoteDeleteHandler } from "./note-delete.ts";
import { createPhotoHandler } from "./photo.ts";
import { createPhotoPruneHandler } from "./photo-prune.ts";
import { readMultipartForm } from "../_shared/multipart.ts";
import type {OcrUser} from "./ocr.ts";

const cors = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
type Attachment = {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// NOTE-파일붙이기: files attached to a note (kind=note) go into this folder inside the private "Web2 바구니" root, not into
// 자료실 (the library list reads app_documents only, so these files never show there). The folder is chosen here from the
// stored row's kind, never from the request. A shared folder is refused before any upload (ensurePrivateChildFolder).
// The size/name checks and the folder choice live in attach-common.ts so the Claude attach path (mcp-attach.ts) uses the same ones.
export {NOTE_FILES_FOLDER};
const characters = (text: string) => [...text].length;

export function createBasketHandler(
  admin: UploadAdmin,
  options: { fetch?: typeof fetch; log?: UploadLog; userClient?:(authorization:string)=>OcrUser; env?: McpAttachEnv } = {},
) {
  const log = options.log ?? ((code: string) => console.error(code));
  const drive = createDriveUpload(admin, { ...options, log });
  const ocr=createOcrHandler(admin,{...options,log});
  const noteDelete = createNoteDeleteHandler(admin, { ...options, log });
  const photo = createPhotoHandler(admin, { ...options, log });
  const photoPrune = createPhotoPruneHandler(admin, { ...options, log });
  const mcpAttach = createMcpAttachHandler(admin, { fetch: options.fetch, log, env: options.env });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    let token = "";
    const uploaded: string[] = [];
    let saved = false;
    let stage = "auth";
    let savingNoteId = "";
    let workspaceId = "";
    let saveFailureConfirmed = false;
    try {
      // MCP-Claude쓰기 ③: the only path that takes a delegated (Claude) key. It does its own checks (delegated key only →
      // Auth userinfo → DB gate with the same key) before any service-key or Drive request; every other action below still refuses it.
      if (new URL(req.url).searchParams.get("action") === "mcp-attach") return await mcpAttach(req);
      // Same Web2 authentication path as library-files: JWT verified by Supabase Auth, not decoded locally.
      const match = (req.headers.get("Authorization") || "").match(
        /^Bearer\s+(\S+)$/i,
      );
      if (!match) throw new UploadError(401, "session_required", "auth");
      const { data, error } = await admin.auth.getUser(match[1]);
      if (error && ![400, 401, 403, 404].includes(Number(error.status))) {
        throw new UploadError(503, "auth_unavailable", "auth");
      }
      if (error || !data.user) {
        throw new UploadError(401, "session_required", "auth");
      }
      if (isDelegatedToken(match[1])) throw new UploadError(401, "session_required", "auth");
      if (!["GET","POST"].includes(req.method)) return json({ error: "GET/POST only" }, 405);
      stage = "authorize";
      const { data: member, error: memberError } = await admin.from(
        "app_workspace_members",
      ).select("workspace_id,role")
        .eq("user_id", data.user.id).maybeSingle();
      if (memberError) {
        throw new UploadError(503, "authorize_unavailable", stage);
      }
      if (member?.role !== "owner") {
        throw new UploadError(403, "forbidden", stage);
      }
      workspaceId = member.workspace_id;
      if (
        req.method === "POST" &&
        new URL(req.url).searchParams.get("action") === "note-delete"
      ) return await noteDelete(req, workspaceId, `Bearer ${match[1]}`);
      if (
        req.method === "POST" &&
        ["photo-prune", "photo-orphans"].includes(
          new URL(req.url).searchParams.get("action") || "",
        )
      ) return await photoPrune(req, workspaceId);
      if (
        req.method === "GET" &&
        new URL(req.url).searchParams.get("action") === "photo"
      ) return await photo(req, workspaceId, `Bearer ${match[1]}`);
      if(req.method==="GET" || req.headers.get("content-type")?.split(";")[0].trim().toLowerCase()==="application/json"){
        return await ocr(req,workspaceId,`Bearer ${match[1]}`);
      }
      stage = "request";
      let form: FormData;
      try {
        // Not req.formData(): Deno cuts quoted file names at ';' and '=' (see _shared/multipart.ts).
        form = await readMultipartForm(req);
      } catch {
        throw new UploadError(400, "invalid_request", stage);
      }
      const files = validateFiles(form.getAll("file"));
      const noteId = form.get("note_id");
      if (
        noteId !== null && (typeof noteId !== "string" || !uuid.test(noteId))
      ) {
        throw new UploadError(400, "note_id_invalid", "validate");
      }
      // S71-49 NOTE-보드사진: "place=board" asks for the board photo folder. It is only a wish about which of this caller's own
      // app folders to use; the folder itself is found by the server (boardPhotoFolder), and any folder id in the request is never read.
      const place = form.get("place");
      if (place !== null && place !== "board") {
        throw new UploadError(400, "place_invalid", "validate");
      }
      let rawText = "";
      let previous: Attachment[] = [];
      let updatedAt = "";
      let noteKind = "";
      if (noteId) {
        stage = "note_lookup";
        // TRASH-다른삭제 5단계: 서버 키는 RLS(휴지통 숨김 정책)를 건너뛰므로 휴지통 노트(deleted_at 있음)에는 첨부를 올리지 않는다.
        // DB 적용 전에는 deleted_at 칸이 없어 42703으로 거절되므로, 그때만 거르기 없이 한 번 더 읽는다.
        const lookup = (live: boolean) => {
          const query = admin.from("app_notes").select(
            "id,kind,attachments,updated_at",
          ).eq("id", noteId).eq("workspace_id", member.workspace_id);
          return (live ? query.is("deleted_at", null) : query).maybeSingle();
        };
        let found = await lookup(true);
        if (found.error?.code === "42703") found = await lookup(false);
        const { data: note, error } = found;
        if (error) throw new UploadError(503, "note_lookup_failed", stage);
        if (!note) throw new UploadError(404, "note_not_found", stage);
        if (
          !Array.isArray(note.attachments) ||
          typeof note.updated_at !== "string"
        ) throw new UploadError(409, "note_state_invalid", stage);
        previous = note.attachments;
        updatedAt = note.updated_at;
        noteKind = typeof note.kind === "string" ? note.kind : "";
      } else {
        const raw = form.get("raw_text");
        if (raw !== null && typeof raw !== "string") {
          throw new UploadError(400, "raw_text_invalid", "validate");
        }
        rawText = raw || "";
        if (characters(rawText) > 20000) {
          throw new UploadError(400, "raw_text_too_long", "validate");
        }
      }
      if (previous.length + files.length > MAX_ATTACHMENTS) {
        throw new UploadError(400, "too_many_attachments", "validate");
      }
      const seen = new Set(previous.map((a) => a.drive_file_id));
      if (seen.size !== previous.length) {
        throw new UploadError(409, "duplicate_attachment", "validate");
      }
      stage = "drive_token";
      token = await drive.driveToken(member.workspace_id);
      stage = "drive_folder";
      // The update CAS below (updated_at + attachments) refuses the save if the row changed kind after this read.
      // A board photo (place=board on a note) goes to "보드 사진" inside the top app folder; when that folder cannot be used
      // (top app folder not known yet, gone, or not private) it stays in "노트 첨부" as before.
      const folder = await attachmentFolder(drive, member.workspace_id, token, noteKind, place as string | null);
      const attachments = [...previous];
      for (const file of files) {
        stage = "drive_upload";
        const fileId = await drive.upload(file, folder, token);
        // Never delete a pre-existing ID, even if an unexpected Drive response repeats it.
        if (seen.has(fileId)) {
          throw new UploadError(409, "duplicate_attachment", "drive_upload");
        }
        uploaded.push(fileId);
        seen.add(fileId);
        attachments.push({
          drive_file_id: fileId,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
        });
      }
      stage = "note_save";
      savingNoteId = noteId || crypto.randomUUID();
      // 올리는 사이 노트가 휴지통으로 갔다면(deleted_at) 저장하지 않는다(note_changed). 칸이 없을 때(42703)만 거르기 없이 다시 시도한다.
      const saveExisting = async () => {
        const run = (live: boolean) => {
          const query = admin.from("app_notes").update({
            attachments,
            updated_at: new Date().toISOString(),
          })
            .eq("id", noteId!).eq("workspace_id", member.workspace_id).eq(
              "updated_at",
              updatedAt,
            )
            .eq("attachments", JSON.stringify(previous));
          return (live ? query.is("deleted_at", null) : query).select("id")
            .maybeSingle();
        };
        const first = await run(true);
        return first.error?.code === "42703" ? await run(false) : first;
      };
      const result = noteId
        ? await saveExisting()
        : await admin.from("app_notes").insert({
          id: savingNoteId,
          workspace_id: member.workspace_id,
          raw_text: rawText,
          attachments,
        })
          .select("id").single();
      if (result.error) {
        // SQLSTATE is a completed DB rejection. Transport/5xx gateway errors may still commit later.
        saveFailureConfirmed = /^[0-9A-Z]{5}$/.test(result.error.code || "") ||
          (/^PGRST[0-9]+$/.test(result.error.code || "") &&
            result.status >= 400 && result.status < 500);
        throw new UploadError(500, "note_save_failed", stage);
      }
      if (!result.data) {
        saveFailureConfirmed = result.status >= 200 && result.status < 300;
        throw new UploadError(409, "note_changed", stage);
      }
      saved = true;
      return json({ ok: true, note_id: result.data.id, attachments });
    } catch (error) {
      // A transport error may occur after DB commit. Read back before deleting any uploaded file.
      if (!saved && stage === "note_save" && savingNoteId && uploaded.length) {
        try {
          const { data: current, error: lookupError } = await admin.from(
            "app_notes",
          ).select("id,attachments")
            .eq("id", savingNoteId).eq("workspace_id", workspaceId)
            .maybeSingle();
          if (lookupError) throw lookupError;
          const ids = new Set(
            (current?.attachments || []).map((a: Attachment) =>
              a.drive_file_id
            ),
          );
          if (uploaded.every((id) => ids.has(id))) {
            return json({
              ok: true,
              note_id: current!.id,
              attachments: current!.attachments,
            });
          }
          // A partial external mutation is also ambiguous; retain all files for reconciliation.
          if (uploaded.some((id) => ids.has(id)) || !saveFailureConfirmed) {
            throw new Error();
          }
        } catch {
          log("note_save_result_unknown");
          return json({
            error: "저장 결과를 확인하지 못했습니다. 메모를 확인해 주세요.",
            code: "note_save_result_unknown",
            stage: "note_save",
            retryable: false,
            note_id: savingNoteId,
          }, 503);
        }
      }
      if (!saved && token) {
        for (const id of uploaded) await drive.discardUploadedFile(id, token);
      }
      const e = error instanceof UploadError
        ? error
        : new UploadError(500, "internal_error", stage);
      log(e.code);
      return json({
        error: "첨부를 저장하지 못했습니다.",
        code: e.code,
        stage: e.stage,
        retryable: false,
      }, e.status);
    }
  };
}
