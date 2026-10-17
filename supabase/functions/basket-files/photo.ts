import type { UploadAdmin, UploadLog } from "../_shared/drive-upload.ts";
import { createDriveUpload } from "../_shared/drive-upload.ts";
import type { OcrUser } from "./ocr.ts";

// Owner photo view: return a reduced image of one attachment of one note.
// The note is read with the caller's JWT (owner RLS decides) and the Drive file
// must be listed in that note's attachments. Drive is read only; nothing is written.
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const SIZES = { small: 480, large: 1600 } as const;
const MAX_IMAGE = 8 * 1024 * 1024;
// Fresh uploads may not have a Drive thumbnail yet; a small original is sent as is.
const MAX_ORIGINAL = 5 * 1024 * 1024;
const IMAGE = /^image\/(jpeg|png|webp|gif)$/;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
class PhotoError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function createPhotoHandler(
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
  async function get(url: string, token: string) {
    return await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  }
  async function image(response: Response) {
    const type = (response.headers.get("content-type") || "").split(";")[0]
      .trim().toLowerCase();
    if (!response.ok || !IMAGE.test(type)) {
      throw new PhotoError(502, "photo_unavailable");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE) {
      throw new PhotoError(502, "photo_unavailable");
    }
    return { type, bytes };
  }
  return async (req: Request, workspace: string, authorization: string) => {
    try {
      const url = new URL(req.url), noteId = url.searchParams.get("note_id"),
        fileId = url.searchParams.get("file_id"),
        size = url.searchParams.get("size") || "small";
      if (
        !uuid(noteId) || !validId(fileId) ||
        !Object.hasOwn(SIZES, size)
      ) throw new PhotoError(400, "photo_request_invalid");
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
      if (!IMAGE.test(String(file.mime_type || "").toLowerCase())) {
        throw new PhotoError(415, "photo_not_image");
      }
      let token = "";
      try {
        token = await upload.driveToken();
      } catch {
        throw new PhotoError(503, "photo_unavailable");
      }
      let meta;
      try {
        const r = await get(
          `${DRIVE}/${
            encodeURIComponent(fileId)
          }?fields=id,mimeType,ownedByMe,trashed,size,thumbnailLink`,
          token,
        );
        if (r.status === 404) throw new PhotoError(404, "photo_not_found");
        if (!r.ok) throw new PhotoError(502, "photo_unavailable");
        meta = await r.json();
      } catch (e) {
        throw e instanceof PhotoError ? e : new PhotoError(502, "photo_unavailable");
      }
      if (
        !meta || meta.id !== fileId || meta.ownedByMe !== true ||
        meta.trashed !== false || !IMAGE.test(String(meta.mimeType || ""))
      ) throw new PhotoError(404, "photo_not_found");
      let out;
      try {
        const link = typeof meta.thumbnailLink === "string"
          ? new URL(meta.thumbnailLink)
          : null;
        if (
          link && link.protocol === "https:" &&
          link.hostname.endsWith(".googleusercontent.com")
        ) {
          // Drive thumbnail links end in "=s<px>"; ask for the requested long edge.
          const sized = link.href.replace(/=s\d+$/, "") +
            `=s${SIZES[size as keyof typeof SIZES]}`;
          out = await image(await get(sized, token));
        } else if (Number(meta.size) > 0 && Number(meta.size) <= MAX_ORIGINAL) {
          out = await image(
            await get(`${DRIVE}/${encodeURIComponent(fileId)}?alt=media`, token),
          );
        } else throw new PhotoError(502, "photo_unavailable");
      } catch (e) {
        throw e instanceof PhotoError ? e : new PhotoError(502, "photo_unavailable");
      }
      return new Response(out.bytes, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": out.type,
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const e = error instanceof PhotoError
        ? error
        : new PhotoError(500, "photo_failed");
      log(e.code);
      return Response.json({ action: "photo", ok: false, code: e.code }, {
        status: e.status,
        headers: { ...cors, "Cache-Control": "no-store" },
      });
    }
  };
}
