import type { UploadAdmin, UploadLog } from "./drive-upload.ts";
import { createDriveUpload } from "./drive-upload.ts";

// Shared reduced-image view (basket-files note photos, library-files document images).
// The caller decides WHICH Drive file may be shown (owner-RLS lookup of the note or
// document row). This module only fetches that one file's thumbnail from Drive after
// checking it is a live, owned image. Drive is read only; nothing is written.
const DRIVE = "https://www.googleapis.com/drive/v3/files";
export const PHOTO_SIZES = { small: 480, large: 1600 } as const;
const MAX_IMAGE = 8 * 1024 * 1024;
// Fresh uploads may not have a Drive thumbnail yet; a small original is sent as is.
const MAX_ORIGINAL = 5 * 1024 * 1024;
export const PHOTO_IMAGE = /^image\/(jpeg|png|webp|gif)$/;
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isDriveId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
export const photoCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
export class PhotoError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function photoErrorResponse(error: unknown, log: UploadLog) {
  const e = error instanceof PhotoError
    ? error
    : new PhotoError(500, "photo_failed");
  log(e.code);
  return Response.json({ action: "photo", ok: false, code: e.code }, {
    status: e.status,
    headers: { ...photoCors, "Cache-Control": "no-store" },
  });
}

export function parsePhotoSize(value: string | null): keyof typeof PHOTO_SIZES {
  const size = value || "small";
  if (!Object.hasOwn(PHOTO_SIZES, size)) {
    throw new PhotoError(400, "photo_request_invalid");
  }
  return size as keyof typeof PHOTO_SIZES;
}

export function createDrivePhoto(
  admin: UploadAdmin,
  options: { fetch?: typeof fetch; log?: UploadLog } = {},
) {
  const upload = createDriveUpload(admin, options),
    request = options.fetch ?? globalThis.fetch;
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
    if (!response.ok || !PHOTO_IMAGE.test(type)) {
      throw new PhotoError(502, "photo_unavailable");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE) {
      throw new PhotoError(502, "photo_unavailable");
    }
    return { type, bytes };
  }
  // fileId and the recorded mime type must already come from a row the caller's
  // JWT may read; a non-image row is refused before any Drive call.
  return async (
    fileId: string,
    recordedMime: unknown,
    size: keyof typeof PHOTO_SIZES,
  ) => {
    if (!PHOTO_IMAGE.test(String(recordedMime || "").toLowerCase())) {
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
      meta.trashed !== false || !PHOTO_IMAGE.test(String(meta.mimeType || ""))
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
        const sized = link.href.replace(/=s\d+$/, "") + `=s${PHOTO_SIZES[size]}`;
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
        ...photoCors,
        "Content-Type": out.type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
