import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import { createDriveUpload } from "../_shared/drive-upload.ts";
import { trashDriveFile } from "../_shared/drive-trash.ts";
import type { Trash } from "../_shared/drive-trash.ts";

// JOURNAL-일기사진정리: Drive photos that no longer belong to any record.
//  - action "photo-prune":  { file_ids: [1..20] }  Move those Drive files to the Drive TRASH (30 days, never a permanent DELETE),
//    but only each file that (a) lies directly in the verified private "Web2 바구니" folder, (b) is an image this app owns, and
//    (c) is listed in NO note (trashed notes included) and NO library document. A referenced file is kept (counted as kept).
//    The diary calls it right after a photo was taken out of a day; the sweep below hands it the ids a person confirmed.
//  - action "photo-orphans": { dry_run: true }  READ ONLY list of the basket folder's images that no record lists (cleanup
//    candidates). Writes nothing. Files younger than 1 hour are left out (an upload may still be saving its note).
// Both are owner-only (the caller is already the workspace owner). The reference check reads app_notes with the server key so a
// note in the app trash (hidden from the screen by RLS, restorable) still keeps its photos. Any read failure trashes nothing.
const MAX_BODY = 8192;
const MAX_IDS = 20;
const MAX_PAGES = 25;
const PAGE = 200;
const MAX_CANDIDATES = 500;
const MIN_AGE_MS = 60 * 60 * 1000;
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const cors = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
class PruneError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
type Row = { attachments?: unknown; file_id?: unknown };

export function createPhotoPruneHandler(
  admin: UploadAdmin,
  options: { fetch?: typeof fetch; log?: UploadLog } = {},
) {
  const upload = createDriveUpload(admin, options),
    request = options.fetch ?? globalThis.fetch,
    log = options.log ?? ((code: string) => console.error(code));
  async function body(req: Request) {
    const reader = req.body?.getReader();
    if (!reader) throw new PruneError(400, "photo_prune_invalid");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_BODY) throw new PruneError(413, "photo_prune_request_too_large");
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
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
      return value;
    } catch {
      throw new PruneError(400, "photo_prune_invalid");
    }
  }
  // Ids that some record still lists. Notes: every row of every workspace, trashed ones included. Throws when a read fails.
  async function referenced(ids: string[]) {
    const kept = new Set<string>();
    const docs = await admin.from("app_documents").select("file_id").in("file_id", ids);
    if (docs.error || !Array.isArray(docs.data)) throw Error();
    for (const row of docs.data as Row[]) {
      if (typeof row?.file_id === "string" && ids.includes(row.file_id)) kept.add(row.file_id);
    }
    for (const id of ids) {
      // attachments is jsonb: hand PostgREST a JSON text (cs.[{...}]). A JS array would be sent as a Postgres array literal
      // (cs.{[object Object]}), which PostgREST rejects, so every check failed (503) before this fix.
      const notes = await admin.from("app_notes").select("id").contains(
        "attachments",
        JSON.stringify([{ drive_file_id: id }]),
      ).limit(1);
      if (notes.error || !Array.isArray(notes.data)) throw Error();
      if (notes.data.length) kept.add(id);
    }
    return kept;
  }
  // Every Drive id any note lists, read page by page. Throws when a read fails or the table is too big to read whole.
  async function allNoteFileIds() {
    const out = new Set<string>();
    for (let from = 0, page = 0;; from += 1000, page++) {
      if (page >= 200) throw Error();
      const r = await admin.from("app_notes").select("id,attachments")
        .order("id").range(from, from + 999);
      if (r.error || !Array.isArray(r.data)) throw Error();
      for (const row of r.data as Row[]) {
        if (!Array.isArray(row.attachments)) continue;
        for (const a of row.attachments) if (validId(a?.drive_file_id)) out.add(a.drive_file_id);
      }
      if (r.data.length < 1000) return out;
    }
  }
  async function allDocumentFileIds() {
    const out = new Set<string>();
    for (let from = 0, page = 0;; from += 1000, page++) {
      if (page >= 200) throw Error();
      const r = await admin.from("app_documents").select("file_id").order("file_id").range(from, from + 999);
      if (r.error || !Array.isArray(r.data)) throw Error();
      for (const row of r.data as Row[]) if (validId(row.file_id)) out.add(row.file_id);
      if (r.data.length < 1000) return out;
    }
  }
  async function listImages(folder: string, token: string) {
    const files: {
      id: string; name: string; mimeType: string; size: number | null; createdTime: string;
    }[] = [];
    let pageToken = "", truncated = false;
    for (let page = 0;; page++) {
      if (page >= MAX_PAGES) { truncated = true; break; }
      const q = `'${folder}' in parents and trashed = false and mimeType contains 'image/'`;
      const url = `${DRIVE}?q=${encodeURIComponent(q)}&pageSize=${PAGE}&orderBy=createdTime&fields=${
        encodeURIComponent("nextPageToken,files(id,name,mimeType,size,createdTime,ownedByMe,parents)")
      }${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const r = await request(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error();
      const d = await r.json();
      if (!d || !Array.isArray(d.files)) throw Error();
      for (const f of d.files) {
        if (
          validId(f?.id) && f.ownedByMe === true && Array.isArray(f.parents) &&
          f.parents.length === 1 && f.parents[0] === folder &&
          typeof f.mimeType === "string" && f.mimeType.startsWith("image/") &&
          typeof f.createdTime === "string"
        ) {
          files.push({
            id: f.id,
            name: typeof f.name === "string" ? f.name.slice(0, 255) : "",
            mimeType: f.mimeType,
            size: Number.isFinite(Number(f.size)) ? Number(f.size) : null,
            createdTime: f.createdTime,
          });
        }
      }
      if (!d.nextPageToken) break;
      pageToken = String(d.nextPageToken);
    }
    return { files, truncated };
  }
  const reply = (status: number, data: Record<string, unknown>) =>
    Response.json(data, { status, headers: cors });
  return async (req: Request, workspace: string) => {
    let action = "photo-prune";
    try {
      const input = await body(req);
      if (input.action !== "photo-prune" && input.action !== "photo-orphans") {
        throw new PruneError(400, "photo_prune_invalid");
      }
      action = input.action;
      let token = "", folder = "";
      const open = async () => {
        try {
          token = await upload.driveToken();
          // The stored, verified private root only; never create a folder.
          folder = await upload.ensurePrivateRootFolder(workspace, token, { existingOnly: true });
        } catch {
          log("photo_prune_drive_unavailable");
          throw new PruneError(503, "photo_prune_drive_unavailable");
        }
      };
      if (action === "photo-orphans") {
        if (Object.keys(input).sort().join(",") !== "action,dry_run" || input.dry_run !== true) {
          throw new PruneError(400, "photo_prune_invalid");
        }
        await open();
        let found, notes, docs;
        try {
          found = await listImages(folder, token);
          notes = await allNoteFileIds();
          docs = await allDocumentFileIds();
        } catch {
          log("photo_orphans_read_failed");
          throw new PruneError(503, "photo_orphans_read_failed");
        }
        const now = Date.now();
        const orphan = found.files.filter((f) => !notes.has(f.id) && !docs.has(f.id));
        const old = orphan.filter((f) => now - Date.parse(f.createdTime) >= MIN_AGE_MS);
        return reply(200, {
          ok: true,
          action,
          dry_run: true,
          drive_images: found.files.length,
          referenced: found.files.length - orphan.length,
          too_new: orphan.length - old.length,
          candidates_total: old.length,
          candidates: old.slice(0, MAX_CANDIDATES).map((f) => ({
            file_id: f.id, file_name: f.name, mime_type: f.mimeType, size_bytes: f.size, created_time: f.createdTime,
          })),
          truncated: found.truncated || old.length > MAX_CANDIDATES,
        });
      }
      const ids = input.file_ids;
      if (
        Object.keys(input).sort().join(",") !== "action,file_ids" || !Array.isArray(ids) ||
        !ids.length || ids.length > MAX_IDS || !ids.every(validId) || new Set(ids).size !== ids.length
      ) throw new PruneError(400, "photo_prune_invalid");
      await open();
      let kept: Set<string>;
      try {
        kept = await referenced(ids);
      } catch {
        log("photo_prune_reference_unavailable");
        throw new PruneError(503, "photo_prune_reference_unavailable");
      }
      const counts = { trashed: 0, kept: 0, failed: 0, unknown: 0 };
      const results: { file_id: string; result: Trash | "kept" }[] = [];
      for (const id of ids) {
        const result: Trash | "kept" = kept.has(id)
          ? "kept"
          : await trashDriveFile(request, id, folder, token, { imageOnly: true });
        counts[result]++;
        results.push({ file_id: id, result });
      }
      return reply(200, { ok: true, action, requested: ids.length, ...counts, results });
    } catch (error) {
      const e = error instanceof PruneError ? error : new PruneError(500, "photo_prune_failed");
      log(e.code);
      return reply(e.status, { ok: false, action, code: e.code });
    }
  };
}
