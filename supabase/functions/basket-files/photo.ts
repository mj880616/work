import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import {
  createDrivePhoto,
  isDriveId,
  isUuid,
  parsePhotoSize,
  PhotoError,
  photoErrorResponse,
} from "../_shared/drive-photo.ts";
import type { OcrUser } from "./ocr.ts";

// Owner photo view: return a reduced image of one attachment of one note.
// The note is read with the caller's JWT (owner RLS decides) and the Drive file
// must be listed in that note's attachments. Drive is read only; nothing is written.
// The Drive thumbnail part is shared with library-files (_shared/drive-photo.ts).
export function createPhotoHandler(
  admin: UploadAdmin,
  options: {
    fetch?: typeof fetch;
    log?: UploadLog;
    userClient?: (authorization: string) => OcrUser;
  } = {},
) {
  const photo = createDrivePhoto(admin, options),
    log = options.log ?? ((code: string) => console.error(code));
  return async (req: Request, workspace: string, authorization: string) => {
    try {
      const url = new URL(req.url), noteId = url.searchParams.get("note_id"),
        fileId = url.searchParams.get("file_id");
      const size = parsePhotoSize(url.searchParams.get("size"));
      if (!isUuid(noteId) || !isDriveId(fileId)) {
        throw new PhotoError(400, "photo_request_invalid");
      }
      let db: OcrUser | undefined;
      try {
        db = options.userClient?.(authorization);
      } catch {
        db = undefined;
      }
      if (!db) throw new PhotoError(503, "photo_unavailable");
      const result = await db.from("app_notes").select("id,attachments").eq(
        "id",
        noteId,
      ).eq("workspace_id", workspace).maybeSingle();
      if (result.error) throw new PhotoError(503, "note_lookup_failed");
      const note = result.data as { id: string; attachments: unknown } | null;
      if (!note || note.id !== noteId) {
        throw new PhotoError(404, "note_not_found");
      }
      const file = Array.isArray(note.attachments)
        ? note.attachments.find((a) => a?.drive_file_id === fileId)
        : undefined;
      if (!file) throw new PhotoError(404, "photo_not_found");
      return await photo(fileId, file.mime_type, size);
    } catch (error) {
      return photoErrorResponse(error, log);
    }
  };
}
