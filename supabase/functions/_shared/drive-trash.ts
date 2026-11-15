// Shared by basket-files (note-delete.ts, photo-prune.ts) and drive-summary (library previous-file prune):
// move ONE Drive file to the Drive trash (trashed=true, never a permanent DELETE).
// Only a file this app owns and placed directly in the given verified folder is trashed. A read failure changes nothing.
// A PATCH whose outcome is unclear is reported as unknown and never retried here.
//
// Two views of the same rule:
//  - trashDriveFile (original, unchanged results): "trashed" | "failed" | "unknown".
//  - moveDriveFileToTrash / inspectDriveFile (LIB-이전파일정리): the same checks, but "not ours" (404, not owned, other folder, folder
//    item) is told apart from "try again later" (network, 5xx, rate limit), because the library job must not hide a file from
//    its list because of a temporary error.
export type Trash = "trashed" | "failed" | "unknown";
export type TrashDetail = "trashed" | "already_trashed" | "not_ours" | "retry" | "unknown";
export type InspectDetail = "ready" | "already_trashed" | "not_ours" | "retry";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const NOT_OURS_REASONS = new Set(["forbidden", "insufficientFilePermissions", "appNotAuthorizedToFile", "notFound"]);

function driveCall(request: typeof fetch, token: string) {
  return (url: string, init: RequestInit) =>
    request(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
}

async function reasonOf(r: Response): Promise<string> {
  try {
    const d = await r.json();
    const reason = d?.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : "";
  } catch {
    return "";
  }
}

async function readMeta(
  drive: ReturnType<typeof driveCall>,
  id: string,
  folder: string,
  options: { imageOnly?: boolean },
): Promise<InspectDetail> {
  let meta;
  try {
    const r = await drive(
      `${DRIVE}/${encodeURIComponent(id)}?fields=id,mimeType,ownedByMe,trashed,parents`,
      {},
    );
    if (!r.ok) {
      if (r.status === 404) return "not_ours";
      if (r.status === 403) return NOT_OURS_REASONS.has(await reasonOf(r)) ? "not_ours" : "retry";
      return "retry";
    }
    meta = await r.json();
  } catch {
    return "retry";
  }
  if (!meta || meta.id !== id || typeof meta.trashed !== "boolean") return "retry";
  if (
    meta.ownedByMe !== true || meta.mimeType === FOLDER_MIME ||
    !Array.isArray(meta.parents) || meta.parents.length !== 1 ||
    meta.parents[0] !== folder
  ) return "not_ours";
  if (
    options.imageOnly &&
    !(typeof meta.mimeType === "string" && meta.mimeType.startsWith("image/"))
  ) return "not_ours";
  return meta.trashed ? "already_trashed" : "ready";
}

// Read only: would this file be trashed? Writes nothing.
export async function inspectDriveFile(
  request: typeof fetch,
  id: string,
  folder: string,
  token: string,
  options: { imageOnly?: boolean } = {},
): Promise<InspectDetail> {
  return await readMeta(driveCall(request, token), id, folder, options);
}

export async function moveDriveFileToTrash(
  request: typeof fetch,
  id: string,
  folder: string,
  token: string,
  options: { imageOnly?: boolean } = {},
): Promise<TrashDetail> {
  const drive = driveCall(request, token);
  const seen = await readMeta(drive, id, folder, options);
  if (seen === "already_trashed") return "already_trashed";
  if (seen !== "ready") return seen;
  let r: Response;
  try {
    r = await drive(
      `${DRIVE}/${encodeURIComponent(id)}?fields=id,trashed`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
  } catch {
    return "unknown";
  }
  if (r.status >= 400 && r.status < 500) return "retry";
  if (!r.ok) return "unknown";
  try {
    const d = await r.json();
    return d?.id === id && d?.trashed === true ? "trashed" : "unknown";
  } catch {
    return "unknown";
  }
}

export async function trashDriveFile(
  request: typeof fetch,
  id: string,
  folder: string,
  token: string,
  options: { imageOnly?: boolean } = {},
): Promise<Trash> {
  const detail = await moveDriveFileToTrash(request, id, folder, token, options);
  if (detail === "trashed" || detail === "already_trashed") return "trashed";
  if (detail === "unknown") return "unknown";
  return "failed";
}
