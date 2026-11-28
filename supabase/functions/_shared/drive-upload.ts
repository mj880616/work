import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { WorkspaceDriveError, workspaceDriveToken } from "./workspace-drive-token.ts";
// S69-22: 바구니 폴더는 내 드라이브 맨 위 또는 맨 위 앱 폴더(root_folder_id) 바로 아래 어디에 있어도 같은 폴더(옮긴 뒤 새로 안 만듦).
import { APP_FOLDER_MARK, basketFolderClause, createParentFor, isBasketFolder, renameIfOld, topParentsClause } from "./app-folders.mjs";
// S69-41: 새 바구니 폴더 이름('WORK ON+ 바구니'). 찾기·확인은 표식 또는 알려진 이름(옛·새)이라 [한곳으로 모으기]가 이름을 바꿔도 같은 폴더.
import { BOARD_PHOTO_FOLDER_NAME, FOLDER_NAMES } from "./brand-folders.mjs";

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
    appProperties?: Record<string, string>,
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
          ...(appProperties ? { appProperties } : {}),
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
    "id,name,mimeType,ownedByMe,trashed,parents,appProperties,permissions(type,role)";
  type FolderMeta = {
    id?: unknown;
    name?: string;
    mimeType?: string;
    ownedByMe?: boolean;
    trashed?: boolean;
    parents?: string[];
    permissions?: { type: string; role: string }[];
    appProperties?: Record<string, string>;
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
      .select("basket_folder_id,root_folder_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw unavailable("drive_settings");
    const appRoot = typeof setting?.root_folder_id === "string" ? setting.root_folder_id : null;
    const verify = (f: FolderMeta, atRoot: boolean) => {
      if (f.permissions === undefined) {
        throw new UploadError(
          409,
          "drive_folder_permissions_unavailable",
          "drive_folder",
        );
      }
      if (!isBasketFolder(f) || !atRoot || !privateOwnedFolder(f)) {
        throw new UploadError(
          409,
          "drive_folder_not_private_root",
          "drive_folder",
        );
      }
      return f.id as string;
    };
    // S69-42: 확인을 마친 바구니 폴더가 옛 이름('Web2 바구니')이면 쓸 때 새 이름으로(같은 자리에 새 이름 폴더가 있으면 그대로).
    // 이름만 바꾼다(id·자리·안 파일 그대로). 덤이라 실패해도 올리기는 그대로 한다(다음에 쓸 때 다시).
    const renameOld = async (f: FolderMeta) => {
      await renameIfOld({
        drive: (url: string, init: RequestInit = {}) =>
          request(url, { ...init, redirect: "error", headers: { ...(init.headers as Record<string, string> || {}), ...auth(token) } }),
        kind: "basket",
        file: { id: f.id, name: f.name, parents: f.parents },
      }).catch(() => "failed");
    };
    // Root membership comes from the query, never GET /files/root (404 with drive.file).
    // Search own My Drive root or directly inside the stored app root folder (S69-22, [앱 폴더 한곳에 모으기]);
    // never create permissions or adopt a shared folder (privateOwnedFolder: a folder under a shared parent inherits its permissions).
    const rootFolders = () =>
      listFolders(
        `${basketFolderClause()} and mimeType = 'application/vnd.google-apps.folder' and ${topParentsClause(appRoot)} and 'me' in owners and trashed = false`,
        token,
      );
    async function verifyStoredFolder(id: string) {
      const folder = await folderInfo(id, token);
      const found = await rootFolders();
      const ok = verify(folder, folder.id === id && found.some((f) => f.id === id));
      await renameOld(folder);
      return ok;
    }
    if (setting?.basket_folder_id) {
      return await verifyStoredFolder(setting.basket_folder_id);
    }
    if (options.existingOnly) {
      throw new UploadError(409, "drive_folder_missing", "drive_folder");
    }
    const found = await rootFolders();
    if (found.length) {
      verify(found[0], true);
      await renameOld(found[0]);
    }
    const id = found.length
      ? found[0].id as string
      : await createFolder(FOLDER_NAMES.basket.now, createParentFor(appRoot), token, { [APP_FOLDER_MARK]: "basket" });
    // The POST with parents:[app root or 'root'] returned this ID; verify its full metadata with explicit permissions.
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
  // existingOnly (S69-98, basket-files OCR of a note photo): only find the folder; when it is not there, refuse instead of creating it.
  async function ensurePrivateChildFolder(
    parentId: string,
    name: string,
    token: string,
    options: { existingOnly?: boolean } = {},
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
    if (options.existingOnly) {
      throw new UploadError(409, "drive_folder_missing", "drive_folder");
    }
    const id = await createFolder(name, parentId, token);
    const created = await folderInfo(id, token);
    if (created.id !== id) {
      throw new UploadError(409, "drive_folder_not_private", "drive_folder");
    }
    return verify(created);
  }
  // S71-49 NOTE-보드사진: the folder "보드 사진" directly inside the stored top app folder (app_drive_settings.root_folder_id —
  // read here with the server key for this workspace only, never taken from the request). Found or created with the same private
  // check as every child folder (ensurePrivateChildFolder). Returns null when the top app folder is not known yet, is gone, trashed or
  // not the caller's own folder, or the child folder cannot be used privately (shared / permissions unreadable): the caller then keeps
  // the earlier place ("노트 첨부" in the basket). The top app folder itself is never created here (app-folders.mjs rule).
  // existingOnly (OCR of a board photo): only find; null when it is not there.
  async function boardPhotoFolder(
    workspaceId: string,
    token: string,
    options: { existingOnly?: boolean } = {},
  ): Promise<string | null> {
    const { data, error } = await admin.from("app_drive_settings")
      .select("root_folder_id").eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw unavailable("drive_settings");
    const root = data?.root_folder_id;
    if (!validId(root)) return null;
    const r = await driveFetch(
      "drive_folder",
      `https://www.googleapis.com/drive/v3/files/${
        encodeURIComponent(root)
      }?fields=id,mimeType,ownedByMe,trashed`,
      { headers: auth(token) },
    );
    if (r.status === 404) return null;
    if (!r.ok) throw unavailable("drive_folder");
    const f = await bodyJson(r);
    if (
      f.id !== root || f.mimeType !== "application/vnd.google-apps.folder" ||
      f.ownedByMe !== true || f.trashed !== false
    ) return null;
    try {
      return await ensurePrivateChildFolder(root, BOARD_PHOTO_FOLDER_NAME, token, options);
    } catch (e) {
      if (e instanceof UploadError && e.status === 409) return null;
      throw e;
    }
  }
  // MCP-Claude쓰기 ③(설계 docs/design/mcp-claude-write.md 11.2 나): 붙일 Drive 파일이 '내 드라이브의 내 소유 보통 파일'인지만 읽는다.
  // 원본은 읽기만 한다(이름·위치·권한·내용을 바꾸는 요청 없음). 공유 드라이브·남의 파일·공유받은 파일·폴더·Google 문서 원본은 거절.
  async function ownedFileInfo(
    id: string,
    token: string,
    maxBytes: number,
  ): Promise<{ id: string; name: string; mimeType: string; size: number }> {
    if (!validId(id)) throw new UploadError(400, "drive_file_invalid", "drive_file");
    const r = await driveFetch(
      "drive_file",
      `https://www.googleapis.com/drive/v3/files/${
        encodeURIComponent(id)
      }?fields=id,name,mimeType,size,ownedByMe,trashed,driveId`,
      { headers: auth(token) },
    );
    if (r.status === 404 || r.status === 403) {
      throw new UploadError(404, "drive_file_not_found", "drive_file");
    }
    if (!r.ok) throw unavailable("drive_file");
    const f = await bodyJson(r);
    if (f.id !== id || f.trashed !== false) {
      throw new UploadError(404, "drive_file_not_found", "drive_file");
    }
    if (f.ownedByMe !== true || f.driveId) {
      throw new UploadError(403, "drive_file_not_owned", "drive_file");
    }
    const mime = typeof f.mimeType === "string" ? f.mimeType : "";
    if (
      !mime || mime.startsWith("application/vnd.google-apps.") ||
      !/^[^/\s]{1,127}\/[^/\s]{1,127}$/.test(mime)
    ) throw new UploadError(400, "drive_file_type", "drive_file");
    const size = Number(f.size);
    if (!/^[0-9]{1,12}$/.test(String(f.size ?? "")) || size <= 0) {
      throw new UploadError(400, "drive_file_type", "drive_file");
    }
    if (size > maxBytes) throw new UploadError(413, "file_too_large", "drive_file");
    const name = typeof f.name === "string" ? f.name : "";
    if ([...name].length < 1 || [...name].length > 255) {
      throw new UploadError(400, "file_metadata_invalid", "drive_file");
    }
    return { id, name, mimeType: mime, size };
  }
  // 복사본 하나를 Web2 첨부 폴더에 만든다(원본은 그대로). 실패 정리는 upload와 같은 discardUploadedFile.
  async function copyInto(
    id: string,
    name: string,
    folder: string,
    token: string,
  ): Promise<string> {
    if (!validId(id) || !validId(folder)) {
      throw new UploadError(400, "drive_file_invalid", "drive_copy");
    }
    const r = await driveFetch(
      "drive_copy",
      `https://www.googleapis.com/drive/v3/files/${
        encodeURIComponent(id)
      }/copy?fields=id`,
      {
        method: "POST",
        headers: { ...auth(token), "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ name, parents: [folder] }),
      },
    );
    const d = await bodyJson(r);
    if (!r.ok || !validId(d.id) || d.id === id) throw unavailable("drive_copy");
    return d.id;
  }
  return {
    driveToken,
    createFolder,
    ensurePrivateRootFolder,
    ensurePrivateChildFolder,
    boardPhotoFolder,
    upload,
    discardUploadedFile,
    ownedFileInfo,
    copyInto,
  };
}
