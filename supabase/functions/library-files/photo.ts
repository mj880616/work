import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import {
  createDrivePhoto,
  isUuid,
  parsePhotoSize,
  PhotoError,
  photoErrorResponse,
} from "../_shared/drive-photo.ts";

// Owner view of one library document that is an image: GET ?action=photo&document_id=<uuid>&size=small|large.
// The caller (index.ts) has already verified the login and the owner workspace.
// The document row is read with the caller's JWT (owner RLS decides) and must belong
// to that workspace; the Drive file id comes from that row, never from the request.
// Non-image documents are refused. Drive is read only; nothing is written and the
// reduced image is not stored anywhere (thumbnail is made by Drive on demand).
export type LibraryUser = Pick<SupabaseClient, "from">;
export function createLibraryPhotoHandler(
  admin: UploadAdmin,
  options: {
    fetch?: typeof fetch;
    log?: UploadLog;
    userClient?: (authorization: string) => LibraryUser;
  } = {},
) {
  const photo = createDrivePhoto(admin, options),
    log = options.log ?? ((code: string) => console.error(code));
  return async (req: Request, workspace: string, authorization: string) => {
    try {
      const url = new URL(req.url), documentId = url.searchParams.get("document_id");
      const size = parsePhotoSize(url.searchParams.get("size"));
      if (!isUuid(documentId)) throw new PhotoError(400, "photo_request_invalid");
      let db: LibraryUser | undefined;
      try {
        db = options.userClient?.(authorization);
      } catch {
        db = undefined;
      }
      if (!db) throw new PhotoError(503, "photo_unavailable");
      const result = await db.from("app_documents").select(
        "id,workspace_id,file_id,mime_type",
      ).eq("id", documentId).eq("workspace_id", workspace).maybeSingle();
      if (result.error) throw new PhotoError(503, "document_lookup_failed");
      const doc = result.data as {
        id: string;
        workspace_id: string;
        file_id: string | null;
        mime_type: string | null;
      } | null;
      if (!doc || doc.id !== documentId || doc.workspace_id !== workspace) {
        throw new PhotoError(404, "document_not_found");
      }
      if (!doc.file_id) throw new PhotoError(404, "photo_not_found");
      return await photo(doc.file_id, doc.mime_type, size);
    } catch (error) {
      return photoErrorResponse(error, log);
    }
  };
}
