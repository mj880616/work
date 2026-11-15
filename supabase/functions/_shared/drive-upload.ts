import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { WorkspaceDriveError, workspaceDriveToken } from "./workspace-drive-token.ts";

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
  // MULTI ②-2: 작업공간별 Drive 연결(_shared/workspace-drive-token.ts). workspaceId는 부르는 쪽이 서버에서 확인한 값만.
  async function driveToken(workspaceId: string): Promise<string> {
    try {
      return await workspaceDriveToken(admin, workspaceId, { fetch: request, log });
    } catch (e) {
      if (e instanceof WorkspaceDriveError) {
        if (e.status === 424) throw new UploadError(424, e.code, "drive_token");
        throw unavailable("drive_token");
      }
      throw e;
    }
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
  type FolderMeta = {
    id?: unknown;
    name?: string;
    mimeType?: string;
    ownedByMe?: boolean;
    trashed?: boolean;
    parents?: string[];
    permissions?: { type: string; role: string }[];
  };
  // Owned, not trashed, exactly one parent and exactly one permission (the owner): never shared, publicly or otherwise.
  const privateOwnedFolder = (f: FolderMeta) =>
    validId(f.id) && f.mimeType === "application/vnd.google-apps.folder" &&
    f.ownedByMe === true && f.trashed === false &&
    Array.isArray(f.parents) && f.parents.length === 1 &&
    Array.isArray(f.permissions) && f.permissions.length === 1 &&
    f.permissions[0].type === "user" && f.permissions[0].role === "owner";
  async function listFolders(q: string, token: string) {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,incompleteSearch,files(${fields})`,
      pageSize: "100",
      orderBy: "createdTime",
    });
    const folders: FolderMeta[] = [];
    const pages = new Set<string>();
    while (true) {
      const listed = await driveFetch(
        "drive_folder",
        "https://www.googleapis.com/drive/v3/files?" + params,
        { headers: auth(token) },
      );
      const found = await bodyJson(listed);
      if (!listed.ok || !Array.isArray(found.files) || found.incompleteSearch) {
        throw unavailable("drive_folder");
      }
      folders.push(...found.files);
      if (!found.nextPageToken) return folders;
      if (
        typeof found.nextPageToken !== "string" ||
        pages.has(found.nextPageToken)
      ) throw unavailable("drive_folder");
      pages.add(found.nextPageToken);
      params.set("pageToken", found.nextPageToken);
    }
  }
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
      throw new UploadError(409, "drive_folder_missing", "drive_folder");
    }
    if (!r.ok) throw unavailable("drive_folder");
    return await bodyJson(r);
  }
  async function ensurePrivateRootFolder(
    workspaceId: string,
    token: string,
    options: { existingOnly?: boolean } = {},
  ): Promise<string> {
    const { data: setting, error } = await admin.from("app_drive_settings")
      .select("basket_folder_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw unavailable("drive_settings");
    const verify = (f: FolderMeta, atRoot: boolean) => {
      if (f.permissions === undefined) {
        throw new UploadError(
          409,
          "drive_folder_permissions_unavailable",
          "drive_folder",
        );
      }
      if (f.name !== "Web2 바구니" || !atRoot || !privateOwnedFolder(f)) {
        throw new UploadError(
          409,
          "drive_folder_not_private_root",
          "drive_folder",
        );
      }
      return f.id as string;
    };
    // Root membership comes from the query, never GET /files/root (404 with drive.file).
    // Search own My Drive root only; never create permissions or adopt a shared folder.
    const rootFolders = () =>
      listFolders(
        "name = 'Web2 바구니' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners and trashed = false",
        token,
      );
    async function verifyStoredFolder(id: string) {
      const folder = await folderInfo(id, token);
      const found = await rootFolders();
      return verify(folder, folder.id === id && found.some((f) => f.id === id));
    }
    if (setting?.basket_folder_id) {
      return await verifyStoredFolder(setting.basket_folder_id);
    }
    if (options.existingOnly) {
      throw new UploadError(409, "drive_folder_missing", "drive_folder");
    }
    const found = await rootFolders();
    const id = found.length
      ? verify(found[0], true)
      : await createFolder("Web2 바구니", "root", token);
    // The POST with parents:['root'] returned this ID; verify its full metadata with explicit permissions.
    // Never compare parents to a root metadata ID or overwrite root/library settings.
    if (!found.length) {
      const created = await folderInfo(id, token);
      verify(created, created.id === id);
    }
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
    return await verifyStoredFolder(winner.basket_folder_id);
  }
  // A named folder directly inside an existing app folder (e.g. "할 일 첨부" in 자료실), found or created by this app.
  // The same private check as the basket root: a folder that is shared (its own or an inherited permission) is never used,
  // and no permission is created or removed. The ID is not stored; the search finds it again (drive.file sees app files only).
  async function ensurePrivateChildFolder(
    parentId: string,
    name: string,
    token: string,
  ): Promise<string> {
    if (!validId(parentId) || !/^[^'\\]{1,100}$/.test(name)) {
      throw new UploadError(409, "drive_folder_invalid", "drive_folder");
    }
    const verify = (f: FolderMeta) => {
      if (f.permissions === undefined) {
        throw new UploadError(
          409,
          "drive_folder_permissions_unavailable",
          "drive_folder",
        );
      }
      if (
        f.name !== name || !privateOwnedFolder(f) ||
        f.parents?.[0] !== parentId
      ) {
        throw new UploadError(409, "drive_folder_not_private", "drive_folder");
      }
      return f.id as string;
    };
    const found = await listFolders(
      `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and 'me' in owners and trashed = false`,
      token,
    );
    if (found.length) return verify(found[0]);
    const id = await createFolder(name, parentId, token);
    const created = await folderInfo(id, token);
    if (created.id !== id) {
      throw new UploadError(409, "drive_folder_not_private", "drive_folder");
    }
    return verify(created);
  }
  return {
    driveToken,
    createFolder,
    ensurePrivateRootFolder,
    ensurePrivateChildFolder,
    upload,
    discardUploadedFile,
  };
}
