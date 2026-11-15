// Read-only deletion guard. Never calls ensurePrivateRootFolder: that can create
// folders/settings. Remote facts here are checked by this supported Edge path.
type OriginDependencies = {
  readPage: (
    path: string,
    start: number,
    end: number,
  ) => Promise<{ rows: unknown; contentRange: string | null }>;
  driveToken: () => Promise<string>;
  fetch: typeof fetch;
};
type Folder = {
  id: string;
  name: string;
  mimeType: string;
  ownedByMe: boolean;
  trashed: boolean;
  parents: string[];
  permissions: { type: string; role: string }[];
};
type Row = Record<string, unknown>;
type Origin = {
  preserveDrive: boolean;
  reason: "note_reference" | "private_basket_original" | "ordinary_library";
  missing?: boolean;
  trashed?: boolean;
};
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const unknownOrigin = () =>
  Object.assign(
    new Error(
      "바구니 원본 보호 여부를 확인하지 못했습니다. 삭제하지 않고 다시 확인해 주세요.",
    ),
    { code: "BASKET_ORIGIN_UNKNOWN" },
  );
const folderFields =
  "id,name,mimeType,ownedByMe,trashed,parents,permissions(type,role)";

async function allRows(
  deps: OriginDependencies,
  table: string,
  filters: Record<string, string>,
  fields: string,
  order: string,
  key: (row: Row) => unknown,
  visit?: (row: Row) => boolean,
  pageSize = 100,
): Promise<Row[]> {
  const params = new URLSearchParams({ ...filters, select: fields, order });
  const result: Row[] = [], keys = new Set();
  let start = 0, expectedTotal: number | undefined;
  while (true) {
    const page = await deps.readPage(`${table}?${params}`, start, start + pageSize - 1);
    if (!Array.isArray(page.rows)) throw unknownOrigin();
    if (page.contentRange === "*/0" && !page.rows.length && start === 0) {
      return [];
    }
    const m = /^(\d+)-(\d+)\/(\d+)$/.exec(page.contentRange || "");
    if (!m) throw unknownOrigin();
    const [first, last, total] = m.slice(1).map(Number);
    if (
      ![first, last, total].every(Number.isSafeInteger) || first !== start ||
      last < first || last >= total || last > start + pageSize - 1 ||
      page.rows.length !== last - first + 1 ||
      (expectedTotal !== undefined && total !== expectedTotal)
    ) throw unknownOrigin();
    expectedTotal = total;
    for (const row of page.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw unknownOrigin();
      }
      const id = key(row);
      if (typeof id !== "string" || !id || keys.has(id)) throw unknownOrigin();
      keys.add(id);
      if (visit) { if (visit(row)) return [row]; }
      else result.push(row);
    }
    start = last + 1;
    if (start === total) return result;
  }
}

function verifyFolder(value: unknown) {
  const f = value as Partial<Folder>;
  if (
    !f || !validId(f.id) || f.name !== "Web2 바구니" ||
    f.mimeType !== "application/vnd.google-apps.folder" ||
    f.ownedByMe !== true || f.trashed !== false || !Array.isArray(f.parents) ||
    f.parents.length !== 1 || !validId(f.parents[0]) ||
    !Array.isArray(f.permissions) || f.permissions.length !== 1 ||
    f.permissions[0]?.type !== "user" || f.permissions[0]?.role !== "owner"
  ) throw unknownOrigin();
  return f.id as string;
}

async function privateRootFolders(
  deps: OriginDependencies,
  token: string,
): Promise<Map<string, Folder>> {
  const params = new URLSearchParams({
    q: "name = 'Web2 바구니' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners and trashed = false",
    fields: `nextPageToken,incompleteSearch,files(${folderFields})`,
    pageSize: "100",
    orderBy: "createdTime",
  });
  const found = new Map<string, Folder>(), pages = new Set<string>();
  while (true) {
    const r = await deps.fetch(
      "https://www.googleapis.com/drive/v3/files?" + params,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
    );
    if (!r.ok) throw unknownOrigin();
    const body = await r.json();
    if (
      !Array.isArray(body.files) ||
      (body.incompleteSearch !== undefined && body.incompleteSearch !== false)
    ) throw unknownOrigin();
    for (const folder of body.files) {
      const id = verifyFolder(folder);
      if (found.has(id)) throw unknownOrigin();
      found.set(id, folder);
    }
    if (body.nextPageToken === undefined || body.nextPageToken === "") {
      return found;
    }
    if (
      typeof body.nextPageToken !== "string" ||
      body.nextPageToken.length > 8192 || pages.has(body.nextPageToken)
    ) throw unknownOrigin();
    pages.add(body.nextPageToken);
    params.set("pageToken", body.nextPageToken);
  }
}

export async function inspectBasketOriginal(
  input: { userId: string; workspaceId: string; fileId: string },
  deps: OriginDependencies,
): Promise<Origin> {
  try {
    if (
      !validId(input.userId) || !validId(input.workspaceId) ||
      !validId(input.fileId)
    ) throw unknownOrigin();
    const members = await allRows(
      deps,
      "app_workspace_members",
      { user_id: `eq.${input.userId}`, role: "eq.owner" },
      "workspace_id,role",
      "workspace_id.asc",
      (r) => r.workspace_id,
    );
    if (
      !members.some((r) => r.workspace_id === input.workspaceId) ||
      members.some((r) => r.role !== "owner" || !validId(r.workspace_id))
    ) throw unknownOrigin();
    for (const member of members) {
      // Stream note pages: do not retain every attachment/OCR payload in memory.
      const referenced = await allRows(
        deps,
        "app_notes",
        { workspace_id: `eq.${member.workspace_id}` },
        "id,workspace_id,attachments",
        "id.asc",
        (r) => r.id,
        (note) => {
          if (
            note.workspace_id !== member.workspace_id ||
            !Array.isArray(note.attachments)
          ) throw unknownOrigin();
          for (const attachment of note.attachments) {
            if (
              !attachment || typeof attachment !== "object" ||
              !validId(attachment.drive_file_id)
            ) throw unknownOrigin();
            if (attachment.drive_file_id === input.fileId) return true;
          }
          return false;
        },
        5,
      );
      // A known reference needs no folder lookup/OAuth refresh. No archive,
      // AI permission, or link status filter is applied to this read.
      if (referenced.length) {
        return { preserveDrive: true, reason: "note_reference" };
      }
    }
    const token = await deps.driveToken();
    const r = await deps.fetch(
      `https://www.googleapis.com/drive/v3/files/${
        encodeURIComponent(input.fileId)
      }?fields=id,trashed,parents`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
    );
    if (r.status === 404) {
      return {
        preserveDrive: false,
        reason: "ordinary_library",
        missing: true,
      };
    }
    if (!r.ok) throw new Error("Google Drive 파일 상태를 확인하지 못했습니다.");
    const file = await r.json();
    if (
      file.id !== input.fileId || typeof file.trashed !== "boolean" ||
      !Array.isArray(file.parents) || !file.parents.every(validId)
    ) throw unknownOrigin();
    const roots = await privateRootFolders(deps, token);
    for (const member of members) {
      const settings = await allRows(
        deps,
        "app_drive_settings",
        { workspace_id: `eq.${member.workspace_id}` },
        "basket_folder_id",
        "workspace_id.asc",
        (r) => r.basket_folder_id === null ? "none" : r.basket_folder_id,
      );
      if (settings.length > 1) throw unknownOrigin();
      const id = settings[0]?.basket_folder_id;
      if (id === undefined || id === null) continue;
      if (!validId(id) || !roots.has(id)) throw unknownOrigin();
      const stored = await deps.fetch(
        `https://www.googleapis.com/drive/v3/files/${
          encodeURIComponent(id)
        }?fields=${folderFields}`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
      );
      if (!stored.ok) throw unknownOrigin();
      const folder = await stored.json();
      if (
        verifyFolder(folder) !== id ||
        JSON.stringify(folder.parents) !==
          JSON.stringify(roots.get(id)!.parents)
      ) throw unknownOrigin();
    }
    if (file.parents.some((id: string) => roots.has(id))) {
      return {
        preserveDrive: true,
        reason: "private_basket_original",
        trashed: file.trashed,
      };
    }
    return {
      preserveDrive: false,
      reason: "ordinary_library",
      trashed: file.trashed,
    };
  } catch (e) {
    if (
      e instanceof Error &&
      e.message === "Google Drive 파일 상태를 확인하지 못했습니다."
    ) throw e;
    throw unknownOrigin();
  }
}
