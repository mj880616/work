import { createDriveUpload, UploadError } from "../_shared/drive-upload.ts";
import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
const MAX_FILE = 100 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;
const characters = (text: string) => [...text].length;
function validateFiles(files: FormDataEntryValue[]): File[] {
  if (!files.length || files.some((f) => !(f instanceof File))) {
    throw new UploadError(400, "file_missing", "validate");
  }
  if (files.length > MAX_ATTACHMENTS) {
    throw new UploadError(400, "too_many_attachments", "validate");
  }
  for (const f of files as File[]) {
    if (f.size <= 0) throw new UploadError(400, "file_empty", "validate");
    if (f.size > MAX_FILE) {
      throw new UploadError(413, "file_too_large", "validate");
    }
    if (
      characters(f.name) < 1 || characters(f.name) > 255 ||
      !/^[^/\s]{1,127}\/[^/\s]{1,127}$/.test(
        f.type || "application/octet-stream",
      )
    ) {
      throw new UploadError(400, "file_metadata_invalid", "validate");
    }
  }
  return files as File[];
}

export function createBasketHandler(
  admin: UploadAdmin,
  options: { fetch?: typeof fetch; log?: UploadLog } = {},
) {
  const log = options.log ?? ((code: string) => console.error(code));
  const drive = createDriveUpload(admin, { ...options, log });
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
      if (req.method !== "POST") return json({ error: "POST only" }, 405);
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
      stage = "request";
      let form: FormData;
      try {
        form = await req.formData();
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
      let rawText = "";
      let previous: Attachment[] = [];
      let updatedAt = "";
      if (noteId) {
        stage = "note_lookup";
        const { data: note, error } = await admin.from("app_notes").select(
          "id,attachments,updated_at",
        )
          .eq("id", noteId).eq("workspace_id", member.workspace_id)
          .maybeSingle();
        if (error) throw new UploadError(503, "note_lookup_failed", stage);
        if (!note) throw new UploadError(404, "note_not_found", stage);
        if (
          !Array.isArray(note.attachments) ||
          typeof note.updated_at !== "string"
        ) throw new UploadError(409, "note_state_invalid", stage);
        previous = note.attachments;
        updatedAt = note.updated_at;
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
      token = await drive.driveToken();
      stage = "drive_folder";
      const folder = await drive.ensurePrivateRootFolder(
        member.workspace_id,
        token,
      );
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
      const result = noteId
        ? await admin.from("app_notes").update({
          attachments,
          updated_at: new Date().toISOString(),
        })
          .eq("id", noteId).eq("workspace_id", member.workspace_id).eq(
            "updated_at",
            updatedAt,
          )
          .eq("attachments", JSON.stringify(previous)).select("id")
          .maybeSingle()
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
