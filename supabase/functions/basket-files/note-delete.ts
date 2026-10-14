import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import { createDriveUpload } from "../_shared/drive-upload.ts";
import type { OcrUser } from "./ocr.ts";

// Basket note delete: move this note's own Drive attachments to the Drive trash
// (trashed=true, never a permanent DELETE), then delete the note with the
// caller's JWT so the existing owner RLS decides. service_role never reads or
// deletes app_notes here. OCR temporary documents keep their own cleanup rules.
const MAX_BODY = 4096;
const MAX_ATTACHMENTS = 20;
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const stamp = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const cors = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
type Trash = "trashed" | "failed" | "unknown";
class DeleteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function createNoteDeleteHandler(
  admin: UploadAdmin,
  options: {
    fetch?: typeof fetch;
    log?: UploadLog;
    userClient?: (authorization: string) => OcrUser;
  } = {},
) {
  const upload = createDriveUpload(admin, options),
    request = options.fetch ?? globalThis.fetch,
    log = options.log ?? ((code: string) => console.error(code));
  async function body(req: Request) {
    const reader = req.body?.getReader();
    if (!reader) throw new DeleteError(400, "note_delete_invalid");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BODY) {
          throw new DeleteError(413, "note_delete_request_too_large");
        }
        parts.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    try {
      const value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw Error();
      }
      return value;
    } catch {
      throw new DeleteError(400, "note_delete_invalid");
    }
  }
  async function drive(url: string, init: RequestInit, token: string) {
    return await request(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  }
  // Only a file this app placed in the verified private basket folder is trashed.
  // A read failure changes nothing, so it is a skipped (failed) file. A PATCH
  // whose outcome is unclear is reported as unknown and never retried.
  async function trash(id: string, folder: string, token: string): Promise<Trash> {
    let meta;
    try {
      const r = await drive(
        `${DRIVE}/${encodeURIComponent(id)}?fields=id,mimeType,ownedByMe,trashed,parents`,
        {},
        token,
      );
      if (!r.ok) return "failed";
      meta = await r.json();
    } catch {
      return "failed";
    }
    if (
      !meta || meta.id !== id || meta.ownedByMe !== true ||
      typeof meta.trashed !== "boolean" || meta.mimeType === FOLDER_MIME ||
      !Array.isArray(meta.parents) || meta.parents.length !== 1 ||
      meta.parents[0] !== folder
    ) return "failed";
    if (meta.trashed) return "trashed";
    let r: Response;
    try {
      r = await drive(
        `${DRIVE}/${encodeURIComponent(id)}?fields=id,trashed`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        },
        token,
      );
    } catch {
      return "unknown";
    }
    if (r.status >= 400 && r.status < 500) return "failed";
    if (!r.ok) return "unknown";
    try {
      const d = await r.json();
      return d?.id === id && d?.trashed === true ? "trashed" : "unknown";
    } catch {
      return "unknown";
    }
  }
  return async (req: Request, workspace: string, authorization: string) => {
    const counts = { trashed: 0, failed: 0, unknown: 0 };
    let noteId: string | null = null, total = 0, deleteSent = false;
    const reply = (status: number, data: Record<string, unknown>) =>
      Response.json({
        action: "note-delete",
        note_id: noteId,
        attachments_total: total,
        ...counts,
        ...data,
      }, { status, headers: cors });
    const refuse = (status: number, code: string) => {
      log(code);
      return reply(status, {
        ok: false,
        note_deleted: false,
        code,
        retryable: false,
      });
    };
    let db: OcrUser | undefined;
    try {
      db = options.userClient?.(authorization);
    } catch {
      db = undefined;
    }
    async function read(id: string) {
      const result = await db!.from("app_notes").select(
        "id,workspace_id,updated_at,attachments",
      ).eq("id", id).eq("workspace_id", workspace).maybeSingle();
      if (result.error) throw new DeleteError(503, "note_lookup_failed");
      return result.data as
        | { id: string; workspace_id: string; updated_at: string; attachments: unknown }
        | null;
    }
    // Another note or a library document that points at the same Drive file keeps it.
    async function referenced(ids: string[]) {
      const kept = new Set<string>();
      const docs = await db!.from("app_documents").select("file_id").in(
        "file_id",
        ids,
      );
      if (docs.error || !Array.isArray(docs.data)) throw Error();
      for (const row of docs.data) {
        if (ids.includes(row?.file_id)) kept.add(row.file_id);
      }
      for (const id of ids) {
        const notes = await db!.from("app_notes").select("id").contains(
          "attachments",
          [{ drive_file_id: id }],
        ).neq("id", noteId!).limit(1);
        if (notes.error || !Array.isArray(notes.data)) throw Error();
        if (notes.data.length) kept.add(id);
      }
      return kept;
    }
    try {
      if (!db) throw new DeleteError(503, "note_delete_unavailable");
      const input = await body(req);
      if (
        Object.keys(input).sort().join(",") !==
          "action,note_id,note_updated_at" ||
        input.action !== "note-delete" || !uuid(input.note_id) ||
        !stamp(input.note_updated_at)
      ) throw new DeleteError(400, "note_delete_invalid");
      noteId = input.note_id;
      const note = await read(noteId!);
      if (!note) throw new DeleteError(404, "note_not_found");
      const files = note.attachments;
      if (
        note.id !== noteId || note.workspace_id !== workspace ||
        !stamp(note.updated_at) || !Array.isArray(files) ||
        files.length > MAX_ATTACHMENTS ||
        files.some((f) => !f || typeof f !== "object" || !validId(f.drive_file_id))
      ) throw new DeleteError(409, "note_state_invalid");
      const ids = files.map((f: { drive_file_id: string }) => f.drive_file_id);
      if (new Set(ids).size !== ids.length) {
        throw new DeleteError(409, "note_state_invalid");
      }
      if (note.updated_at !== input.note_updated_at) {
        throw new DeleteError(409, "note_changed");
      }
      total = ids.length;
      if (total) {
        let token = "", folder = "", kept = new Set<string>(), ready = true;
        try {
          token = await upload.driveToken();
          // Adopt the stored, verified private root only; never create a folder.
          folder = await upload.ensurePrivateRootFolder(workspace, token, {
            existingOnly: true,
          });
          kept = await referenced(ids);
        } catch {
          ready = false;
          log("note_delete_drive_unavailable");
        }
        for (const id of ids) {
          counts[ready && !kept.has(id) ? await trash(id, folder, token) : "failed"]++;
        }
      }
      deleteSent = true;
      let result;
      try {
        result = await db.from("app_notes").delete().eq("id", noteId!).eq(
          "workspace_id",
          workspace,
        ).eq("updated_at", note.updated_at).select("id");
      } catch {
        result = { data: null, error: true };
      }
      if (!result.error && Array.isArray(result.data)) {
        if (result.data.some((row: { id?: string }) => row?.id === noteId)) {
          return reply(200, { ok: true, note_deleted: true });
        }
        if (!result.data.length) {
          // The CAS matched nothing: a concurrent delete or a newer note version.
          const current = await read(noteId!).catch(() => undefined);
          if (current === undefined) {
            throw new DeleteError(503, "note_delete_result_unknown");
          }
          throw current
            ? new DeleteError(409, "note_changed")
            : new DeleteError(404, "note_not_found");
        }
      }
      // An error may still have committed. Read back instead of guessing.
      const current = await read(noteId!).catch(() => undefined);
      if (current === null) return reply(200, { ok: true, note_deleted: true });
      if (current) throw new DeleteError(500, "note_delete_failed");
      throw new DeleteError(503, "note_delete_result_unknown");
    } catch (error) {
      const e = error instanceof DeleteError
        ? error
        : new DeleteError(
          deleteSent ? 503 : 500,
          deleteSent ? "note_delete_result_unknown" : "note_delete_failed",
        );
      return refuse(e.status, e.code);
    }
  };
}
