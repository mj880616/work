// Shared by note-delete.ts and photo-prune.ts: move ONE Drive file to the Drive trash (trashed=true, never a permanent DELETE).
// Only a file this app placed directly in the verified private basket folder is trashed. A read failure changes nothing, so it
// is a skipped (failed) file. A PATCH whose outcome is unclear is reported as unknown and never retried.
export type Trash = "trashed" | "failed" | "unknown";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function trashDriveFile(
  request: typeof fetch,
  id: string,
  folder: string,
  token: string,
  options: { imageOnly?: boolean } = {},
): Promise<Trash> {
  const drive = (url: string, init: RequestInit) =>
    request(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  let meta;
  try {
    const r = await drive(
      `${DRIVE}/${encodeURIComponent(id)}?fields=id,mimeType,ownedByMe,trashed,parents`,
      {},
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
  if (
    options.imageOnly &&
    !(typeof meta.mimeType === "string" && meta.mimeType.startsWith("image/"))
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
