import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type UploadAdmin = Pick<SupabaseClient, "auth" | "from">;
export type UploadLog = (code: string) => void;
export class UploadError extends Error {
  status: number;
  code: string;
  stage: string;
  constructor(status: number, code: string, stage: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.stage = stage;
  }
}
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(id);

// Extracted from library-files: token refresh, folder POST, resumable POST/PUT and orphan DELETE.
// library-files keeps its current source until a separately approved follow-up deployment.
export function createDriveUpload(
  admin: UploadAdmin,
  options: { fetch?: typeof fetch; log?: UploadLog } = {},
) {
  const request = options.fetch ?? globalThis.fetch;
  const log = options.log ?? ((code: string) => console.error(code));
  const unavailable = (stage: string) =>
    new UploadError(503, stage + "_failed", stage);
  async function driveFetch(
    stage: string,
    url: string,
    init: RequestInit = {},
  ) {
    try {
      return await request(url, { ...init, redirect: "error" });
    } catch {
      log(stage + "_failed");
      throw unavailable(stage);
    }
  }
  async function bodyJson(response: Response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
  async function driveToken(): Promise<string> {
    const { data: c, error } = await admin.from("public_policy_drive_config")
      .select("google_client_id,google_client_secret,google_refresh_token").eq(
        "id",
        1,
      ).single();
    if (error || !c?.google_refresh_token) {
      throw new UploadError(424, "drive_not_connected", "drive_token");
    }
    const r = await driveFetch(
      "drive_token",
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: c.google_client_id,
          client_secret: c.google_client_secret,
          refresh_token: c.google_refresh_token,
          grant_type: "refresh_token",
        }),
      },
    );
    const d = await bodyJson(r);
    if (!r.ok || typeof d.access_token !== "string" || !d.access_token) {
      log("drive_token_failed");
      if (d.error === "invalid_grant" || [400, 401].includes(r.status)) {
        throw new UploadError(424, "drive_auth_expired", "drive_token");
      }
      throw unavailable("drive_token");
    }
    return d.access_token;
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  async function createFolder(
    name: string,
    parent: string,
    token: string,
  ): Promise<string> {
    const r = await driveFetch(
      "drive_folder",
      "https://www.googleapis.com/drive/v3/files?fields=id",
      {
        method: "POST",
        headers: { ...auth(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parent],
        }),
      },
    );
    const d = await bodyJson(r);
    if (!r.ok || !validId(d.id)) throw unavailable("drive_folder");
    return d.id;
  }
  async function upload(
    file: File,
    folder: string,
    token: string,
  ): Promise<string> {
    const init = await driveFetch(
      "drive_upload_init",
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
      {
        method: "POST",
        headers: {
          ...auth(token),
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": file.type || "application/octet-stream",
          "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify({ name: file.name, parents: [folder] }),
      },
    );
    const location = init.ok ? init.headers.get("location") : null;
    let url: URL;
    try {
      url = new URL(location || "");
      if (
        url.protocol !== "https:" || url.hostname !== "www.googleapis.com" ||
        url.port || url.username || url.password
      ) {
        throw new Error();
      }
    } catch {
      throw unavailable("drive_upload_init");
    }
    const up = await driveFetch("drive_upload", url.href, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Length": String(file.size),
      },
      body: file,
    });
    const d = await bodyJson(up);
    if (!up.ok || !validId(d.id)) throw unavailable("drive_upload");
    return d.id;
  }
  async function discardUploadedFile(fileId: string, token: string) {
    try {
      const r = await request(
        `https://www.googleapis.com/drive/v3/files/${
          encodeURIComponent(fileId)
        }`,
        { method: "DELETE", headers: auth(token), redirect: "error" },
      );
      if (!r.ok && r.status !== 404) log("orphan_cleanup_failed");
    } catch {
      log("orphan_cleanup_failed");
    }
  }
  const fields =
    "id,name,mimeType,ownedByMe,trashed,parents,permissions(type,role)";
  async function folderInfo(id: string, token: string) {
    if (!validId(id)) {
      throw new UploadError(409, "drive_folder_invalid", "drive_folder");
    }
    const r = await driveFetch(
      "drive_folder",
      `https://www.googleapis.com/drive/v3/files/${
        encodeURIComponent(id)
      }?fields=${fields}`,
      { headers: auth(token) },
    );
    if (r.status === 404) {
      throw new UploadError(409, "drive_folder_invalid", "drive_folder");
    }
    if (!r.ok) throw unavailable("drive_folder");
    return await bodyJson(r);
  }
  async function ensurePrivateRootFolder(
    workspaceId: string,
    token: string,
  ): Promise<string> {
    const { data: setting, error } = await admin.from("app_drive_settings")
      .select("basket_folder_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw unavailable("drive_settings");
    const root = await folderInfo("root", token);
    if (!validId(root.id)) throw unavailable("drive_folder");
    const verify = (
      f: {
        id?: unknown;
        name?: string;
        mimeType?: string;
        ownedByMe?: boolean;
        trashed?: boolean;
        parents?: string[];
        permissions?: { type: string; role: string }[];
      },
    ) => {
      if (
        !validId(f.id) || f.name !== "Web2 바구니" ||
        f.mimeType !== "application/vnd.google-apps.folder" ||
        f.ownedByMe !== true || f.trashed !== false ||
        f.parents?.length !== 1 || f.parents[0] !== root.id ||
        f.permissions?.length !== 1 || f.permissions[0].type !== "user" ||
        f.permissions[0].role !== "owner"
      ) {
        throw new UploadError(
          409,
          "drive_folder_not_private_root",
          "drive_folder",
        );
      }
      return f.id;
    };
    if (setting?.basket_folder_id) {
      return verify(await folderInfo(setting.basket_folder_id, token));
    }
    // Search own My Drive root only; never create permissions or adopt a shared folder.
    const params = new URLSearchParams({
      q: "name = 'Web2 바구니' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners and trashed = false",
      fields: `files(${fields})`,
      pageSize: "100",
      orderBy: "createdTime",
    });
    const listed = await driveFetch(
      "drive_folder",
      "https://www.googleapis.com/drive/v3/files?" + params,
      { headers: auth(token) },
    );
    const found = await bodyJson(listed);
    if (!listed.ok || !Array.isArray(found.files)) {
      throw unavailable("drive_folder");
    }
    const id = found.files.length
      ? verify(found.files[0])
      : await createFolder("Web2 바구니", "root", token);
    // Check Drive metadata even after creation. Never overwrite root/library settings.
    if (!found.files.length) verify(await folderInfo(id, token));
    if (!setting) {
      const { error } = await admin.from("app_drive_settings").upsert({
        workspace_id: workspaceId,
      }, { onConflict: "workspace_id", ignoreDuplicates: true });
      if (error) throw unavailable("drive_settings");
    }
    const { data: saved, error: saveError } = await admin.from(
      "app_drive_settings",
    ).update({ basket_folder_id: id })
      .eq("workspace_id", workspaceId).is("basket_folder_id", null).select(
        "basket_folder_id",
      ).maybeSingle();
    if (saveError) throw unavailable("drive_settings");
    if (saved?.basket_folder_id) return id;
    // A concurrent request may have stored a different owned folder; use the winner after validation.
    const { data: winner, error: readError } = await admin.from(
      "app_drive_settings",
    ).select("basket_folder_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (readError || !winner?.basket_folder_id) {
      throw unavailable("drive_settings");
    }
    return verify(await folderInfo(winner.basket_folder_id, token));
  }
  return {
    driveToken,
    createFolder,
    ensurePrivateRootFolder,
    upload,
    discardUploadedFile,
  };
}
