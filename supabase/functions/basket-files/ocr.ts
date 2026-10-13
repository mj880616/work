import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import { createDriveUpload } from "../_shared/drive-upload.ts";
import { createDriveOcr, OcrError, ocrMarkers } from "../_shared/drive-ocr.ts";
import { effectiveOcrText, OCR_LIMITS } from "../_shared/basket-ocr-text.mjs";

export type OcrUser = Pick<SupabaseClient, "from" | "rpc">;
type File = {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  ocr?: Record<string, any>;
};
type Note = {
  id: string;
  workspace_id: string;
  updated_at: string;
  attachments: File[];
};
const RPC = "app_basket_update_attachment_ocr";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const stamp = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 64 && Number.isFinite(Date.parse(v));
const canonical = (v: any): string =>
  JSON.stringify(
    v && typeof v === "object"
      ? (Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
          Object.keys(v).sort().map((k) => [k, JSON.parse(canonical(v[k]))]),
        ))
      : v,
  );
const same = (a: any, b: any) => canonical(a) === canonical(b);
const reply = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
const dbStatus = (code: string) =>
  code === "PERMISSION_DENIED"
    ? 403
    : code === "NOTE_MISSING"
    ? 404
    : code === "INVALID_INPUT"
    ? 400
    : 409;

export function createOcrHandler(
  admin: UploadAdmin,
  options: {
    fetch?: typeof fetch;
    log?: UploadLog;
    userClient?: (authorization: string) => OcrUser;
  } = {},
) {
  const drive = createDriveOcr(options),
    upload = createDriveUpload(admin, options),
    log = options.log ?? ((code: string) => console.error(code));
  return async (req: Request, workspace: string, authorization: string) => {
    let db: OcrUser | undefined,
      note: Note | undefined,
      file: File | undefined,
      attempt: string | undefined,
      tempId: string | undefined,
      created = false,
      freshAttemptConfirmed = false,
      createDispatched = false,
      textChanged = false;
    async function read(id: string) {
      if (!db) throw new OcrError("OCR_DB_UNAVAILABLE");
      const result = await db.from("app_notes").select(
        "id,workspace_id,updated_at,attachments,archived_at,ai_export_allowed",
      ).eq("id", id).eq("workspace_id", workspace).maybeSingle();
      if (result.error) throw new OcrError("OCR_DB_UNAVAILABLE");
      if (!result.data) throw new OcrError("NOTE_MISSING", 404);
      const value = result.data as Note;
      if (
        value.id !== id || value.workspace_id !== workspace ||
        !stamp(value.updated_at) || !Array.isArray(value.attachments) ||
        value.attachments.length > 20
      ) throw new OcrError("OCR_NOTE_INVALID", 409);
      return value;
    }
    function target(n: Note, id: string) {
      const matches = n.attachments.filter((a) => a?.drive_file_id === id);
      if (matches.length !== 1) throw new OcrError("ATTACHMENT_CHANGED", 409);
      effectiveOcrText(matches[0]);
      return matches[0];
    }
    async function supported() {
      if (!db) return false;
      try {
        const result = await db.rpc(RPC, {
          p_note_id: null,
          p_note_updated_at: null,
          p_expected_attachment: null,
          p_ocr: null,
        });
        return !result.error && result.data?.ok === false &&
          result.data?.error === "INVALID_INPUT";
      } catch {
        return false;
      }
    }
    async function save(n: Note, f: File, next: Record<string, any>) {
      if (!db) throw new OcrError("OCR_DB_UNAVAILABLE");
      let result;
      try {
        result = await db.rpc(RPC, {
          p_note_id: n.id,
          p_note_updated_at: n.updated_at,
          p_expected_attachment: f,
          p_ocr: next,
        });
      } catch {
        result = { error: true, data: null };
      }
      if (
        !result.error && result.data?.ok === false &&
        typeof result.data.error === "string"
      ) {
        const safe = new Set([
          "NOTE_CHANGED",
          "ATTACHMENT_CHANGED",
          "NOTE_MISSING",
          "PERMISSION_DENIED",
          "INVALID_INPUT",
          "INVALID_TRANSITION",
        ]);
        const code = safe.has(result.data.error)
          ? result.data.error
          : "OCR_DB_RESULT_UNKNOWN";
        throw new OcrError(code, dbStatus(code));
      }
      if (
        !result.error && result.data?.ok === true &&
        stamp(result.data.updated_at) &&
        same(result.data.attachment, { ...f, ocr: next })
      ) {
        note = {
          ...n,
          updated_at: result.data.updated_at,
          attachments: n.attachments.map((a) =>
            a.drive_file_id === f.drive_file_id ? result.data.attachment : a
          ),
        };
        file = result.data.attachment;
        return;
      }
      // A negative read does not disprove a late commit. Never resend the RPC here.
      try {
        const current = await read(n.id),
          found = target(current, f.drive_file_id);
        if (same(found, { ...f, ocr: next })) {
          note = current;
          file = found;
          return;
        }
      } catch {
        /* Retain the known attempt and document, with no automatic write replay. */
      }
      throw new OcrError("OCR_DB_RESULT_UNKNOWN", 503, true);
    }
    async function latest() {
      if (!note || !file) throw new OcrError("OCR_NOTE_INVALID", 409);
      const current = await read(note.id),
        found = target(current, file.drive_file_id);
      if (
        found.ocr?.attempt_id !== attempt ||
        found.ocr?.original_file_id !== file.drive_file_id
      ) throw new OcrError("ATTACHMENT_CHANGED", 409);
      note = current;
      file = found;
    }
    async function jsonBody() {
      const reader = req.body?.getReader();
      if (!reader) throw new OcrError("OCR_REQUEST_INVALID", 400);
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 266240) throw new OcrError("OCR_REQUEST_TOO_LARGE", 413);
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
        throw new OcrError("OCR_REQUEST_INVALID", 400);
      }
    }
    function result(cleanup = file?.ocr?.cleanup_state) {
      return reply({
        ok: true,
        note_id: note!.id,
        updated_at: note!.updated_at,
        attachment: file,
        ocr_saved: ["done", "empty"].includes(file?.ocr?.state),
        text_changed: textChanged,
        cleanup_state: cleanup,
      });
    }
    async function cleanup(
      folder: string,
      markers: Record<string, string>,
      token: string,
      discard = false,
    ) {
      if (!note || !file || !file.ocr?.temp_document_id) {
        throw new OcrError("OCR_TEMP_UNKNOWN", 409);
      }
      if (file.ocr.cleanup_state === "deleted") return;
      const next = {
        ...file.ocr,
        cleanup_state: "delete_pending",
        ...(discard && file.ocr.state === "reading"
          ? { state: "failed", error_code: "OCR_RESULT_DISCARDED" }
          : {}),
      };
      await drive.temp(
        file.ocr.temp_document_id,
        file.drive_file_id,
        folder,
        markers,
        token,
      );
      await save(note, file, next);
      try {
        await drive.remove(
          file!.ocr!.temp_document_id,
          file!.drive_file_id,
          folder,
          markers,
          token,
        );
        let clean: Record<string, any> = {
          ...file!.ocr!,
          cleanup_state: "deleted",
        };
        delete clean.cleanup_error_code;
        try {
          await save(note!, file!, clean);
        } catch (error) {
          if (
            !(error instanceof OcrError) ||
            !["NOTE_CHANGED", "ATTACHMENT_CHANGED"].includes(error.code)
          ) throw error;
          // Only an acknowledged remote DELETE permits a cleanup-only CAS against
          // the latest same attempt. Never rebind a text result to a newer note.
          const deletedId = file!.ocr!.temp_document_id;
          await latest();
          if (file!.ocr!.temp_document_id !== deletedId) {
            throw new OcrError("ATTACHMENT_CHANGED", 409);
          }
          if (file!.ocr!.cleanup_state !== "deleted") {
            clean = { ...file!.ocr!, cleanup_state: "deleted" };
            delete clean.cleanup_error_code;
            await save(note!, file!, clean);
          }
        }
      } catch (e) {
        // A confirmed DELETE followed by uncertain DB persistence also retains its
        // ID. Do not assert deletion or retry external creation from that result.
        if (e instanceof OcrError && e.code === "OCR_DB_RESULT_UNKNOWN") {
          throw e;
        }
        const failed = {
          ...file!.ocr!,
          cleanup_state: "delete_failed",
          cleanup_error_code: "OCR_DELETE_UNKNOWN",
        };
        await save(note!, file!, failed);
      }
    }
    try {
      db = options.userClient?.(authorization);
      const url = new URL(req.url);
      if (req.method === "GET") {
        const action = url.searchParams.get("action");
        if (action === "ocr-capabilities") {
          const ready = await supported();
          let types: string[] = [];
          if (ready) {
            try {
              types = await drive.formats(await upload.driveToken());
            } catch {
              /* Unknown provider support is disabled, never guessed. */
            }
          }
          return reply({
            ok: true,
            protocol_version: 1,
            db: ready ? "supported" : "unsupported",
            supported_mime_types: types,
            limits: {
              characters: OCR_LIMITS.characters,
              utf8_bytes: OCR_LIMITS.utf8Bytes,
            },
          });
        }
        if (action !== "ocr-status" || !uuid(url.searchParams.get("note_id"))) {
          throw new OcrError("OCR_REQUEST_INVALID", 400);
        }
        note = await read(url.searchParams.get("note_id")!);
        return reply({
          ok: true,
          note_id: note.id,
          updated_at: note.updated_at,
          attachments: note.attachments,
        });
      }
      const body = await jsonBody(), action = body.action;
      const allowed = new Set([
        "action",
        "note_id",
        "note_updated_at",
        "expected_attachment",
        ...(action === "ocr-read" ? [] : [
          "attempt_id",
          ...(action === "ocr-reconcile"
            ? ["confirm_current_note_version"]
            : []),
        ]),
      ]);
      if (
        !["ocr-read", "ocr-reconcile", "ocr-cleanup"].includes(action) ||
        Object.keys(body).some((k) => !allowed.has(k)) || !uuid(body.note_id) ||
        !stamp(body.note_updated_at) ||
        !body.expected_attachment ||
        typeof body.expected_attachment !== "object" ||
        Array.isArray(body.expected_attachment)
      ) throw new OcrError("OCR_REQUEST_INVALID", 400);
      if (!await supported()) throw new OcrError("OCR_UNSUPPORTED", 409);
      note = await read(body.note_id);
      file = target(note, body.expected_attachment.drive_file_id);
      if (note.updated_at !== body.note_updated_at) {
        throw new OcrError("NOTE_CHANGED", 409);
      }
      if (!same(file, body.expected_attachment)) {
        throw new OcrError("ATTACHMENT_CHANGED", 409);
      }
      if (action !== "ocr-read") {
        attempt = body.attempt_id;
        if (!uuid(attempt) || file.ocr?.attempt_id !== attempt) {
          throw new OcrError("OCR_ATTEMPT_UNRESOLVED", 409);
        }
        if (
          file.ocr.cleanup_state === "deleted" &&
          ["done", "empty", "failed"].includes(file.ocr.state)
        ) return result();
      }
      const token = await upload.driveToken();
      // OCR adopts the existing verified private root, it never creates a folder.
      const setting = await admin.from("app_drive_settings").select(
        "basket_folder_id",
      ).eq("workspace_id", workspace).maybeSingle();
      if (setting.error || !setting.data?.basket_folder_id) {
        throw new OcrError("OCR_FOLDER_UNAVAILABLE", 409);
      }
      const folder = await upload.ensurePrivateRootFolder(workspace, token, {
        existingOnly: true,
      });
      const source = await drive.source(file, folder, token),
        sourceStamp = note.updated_at;
      let markers: Record<string, string>;
      if (action === "ocr-read") {
        if (
          !["unread", "done", "empty", "failed"].includes(
            file.ocr?.state ?? "unread",
          ) || !["none", "deleted"].includes(file.ocr?.cleanup_state ?? "none")
        ) throw new OcrError("OCR_ATTEMPT_UNRESOLVED", 409);
        if (!(await drive.formats(token)).includes(file.mime_type)) {
          throw new OcrError("OCR_SOURCE_UNSUPPORTED", 400);
        }
        const previous = effectiveOcrText(file);
        attempt = crypto.randomUUID();
        const next = {
          state: "reading",
          original_file_id: file.drive_file_id,
          attempt_id: attempt,
          cleanup_state: "create_pending",
          ...(Object.hasOwn(file.ocr ?? {}, "text") ? { text: previous } : {}),
        };
        markers = await ocrMarkers(
          note.id,
          workspace,
          file.drive_file_id,
          attempt,
          sourceStamp,
          source.version!,
        );
        await save(note, file, next);
        freshAttemptConfirmed = true;
        if (note!.updated_at !== sourceStamp) {
          throw new OcrError("NOTE_CHANGED", 409);
        }
        const candidate = await drive.create(
          source,
          file!,
          folder,
          markers,
          token,
          () => {
            createDispatched = true;
          },
        );
        created = true;
        await drive.temp(
          candidate,
          file!.drive_file_id,
          folder,
          markers,
          token,
        );
        tempId = candidate;
        await save(note!, file!, {
          ...file!.ocr,
          cleanup_state: "created",
          temp_document_id: tempId,
        });
      } else {
        attempt = body.attempt_id;
        if (!uuid(attempt) || file.ocr?.attempt_id !== attempt) {
          throw new OcrError("OCR_ATTEMPT_UNRESOLVED", 409);
        }
        const base = await ocrMarkers(
          note.id,
          workspace,
          file.drive_file_id,
          attempt,
          sourceStamp,
          source.version!,
        );
        // Recover the immutable original note stamp from the app-private document
        // marker, rather than rebinding a restarted worker to the latest note.
        delete (base as Partial<typeof base>).note_stamp;
        delete (base as Partial<typeof base>).source_version;
        tempId = file.ocr.temp_document_id;
        let candidate = tempId;
        if (!candidate) {
          if (action === "ocr-cleanup") {
            throw new OcrError("OCR_TEMP_UNKNOWN", 409);
          }
          candidate = (await drive.find(folder, base, token)) ?? undefined;
          if (!candidate) throw new OcrError("OCR_CREATE_UNKNOWN", 503, true);
        }
        const recovered = await drive.temp(
            candidate,
            file.drive_file_id,
            folder,
            base,
            token,
          ),
          properties = recovered.appProperties!;
        if (
          !stamp(properties.note_stamp) ||
          !/^\d{1,64}$/.test(properties.source_version || "")
        ) throw new OcrError("OCR_IDENTITY_INVALID", 409);
        tempId = candidate;
        markers = {
          ...base,
          note_stamp: properties.note_stamp,
          source_version: properties.source_version,
        };
        if (!file.ocr.temp_document_id) {
          await save(note, file, {
            ...file.ocr,
            cleanup_state: "created",
            temp_document_id: tempId,
          });
        }
        if (action === "ocr-cleanup") {
          await cleanup(folder, markers, token, true);
          return result();
        }
        if (markers.source_version !== source.version) {
          throw new OcrError("OCR_SOURCE_CHANGED", 409);
        }
        if (["done", "empty"].includes(file!.ocr!.state)) {
          await cleanup(folder, markers, token);
          return result();
        }
        if (file!.ocr!.state !== "reading") {
          throw new OcrError("OCR_ATTEMPT_UNRESOLVED", 409);
        }
        if (
          markers.note_stamp !== note!.updated_at &&
          body.confirm_current_note_version !== note!.updated_at
        ) throw new OcrError("NOTE_CHANGED", 409);
      }
      const text = await drive.text(tempId!, token);
      const after = await drive.source(file!, folder, token);
      if (
        after.version !== source.version ||
        after.md5Checksum !== source.md5Checksum
      ) throw new OcrError("OCR_SOURCE_CHANGED", 409);
      const previous = effectiveOcrText(file!);
      const next: Record<string, any> = {
        ...file!.ocr,
        state: text === "" ? "empty" : "done",
        text,
      };
      delete next.error_code;
      await save(note!, file!, next);
      textChanged = previous !== text;
      await cleanup(folder, markers, token);
      return result();
    } catch (error) {
      const e = error instanceof OcrError
        ? error
        : new OcrError("OCR_UNAVAILABLE");
      log(e.code);
      if (note && file && attempt) {
        try {
          await latest();
          if (file!.ocr?.state === "reading") {
            const next: Record<string, any> = {
              ...file!.ocr,
              error_code: e.code,
            };
            if (tempId && created) {
              next.temp_document_id = tempId;
              next.cleanup_state = "created";
            } else if (
              e.code === "OCR_CREATE_UNKNOWN" || (created && !tempId)
            ) next.cleanup_state = "create_unknown";
            else if (
              freshAttemptConfirmed && !createDispatched && !tempId &&
              file!.ocr!.cleanup_state === "create_pending" && !e.unknown
            ) {
              // Only this request can prove its own confirmed new attempt
              // failed before CREATE dispatch. Persisted pending/unknown
              // attempts may belong to an interrupted or late worker.
              next.state = "failed";
              next.cleanup_state = "none";
            }
            if (["OCR_TEXT_TOO_LONG", "OCR_TEXT_INVALID"].includes(e.code)) {
              next.state = "failed";
            }
            if (e.code !== "OCR_DB_RESULT_UNKNOWN") {
              await save(note!, file!, next);
            }
          }
        } catch {
          /* Never hide the original failure or drop known temporary identity. */
        }
      }
      return reply({
        ok: false,
        code: e.code,
        retryable: false,
        result_unknown: e.unknown || (created && !tempId) ||
          ["create_pending", "create_unknown"].includes(
            file?.ocr?.cleanup_state,
          ),
        ocr_saved: ["done", "empty"].includes(file?.ocr?.state),
        text_changed: textChanged,
        cleanup_state: file?.ocr?.cleanup_state,
        note_id: note?.id,
        updated_at: note?.updated_at,
        attachment: file,
        ...(tempId ? { temp_document_id: tempId } : {}),
        ...(attempt ? { attempt_id: attempt } : {}),
      }, e.status);
    }
  };
}
