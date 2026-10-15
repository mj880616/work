// HWP-편집기 2단계: document-actions `hwp-open`·`hwp-overwrite`. MD-표시보완: 읽기 전용 `html-view`(바구니 .html 첨부).
// The file, its workspace and every Drive ID come from the server-read library row
// or basket note, never from the client. Saving as a new file uses the existing
// library-files / basket-files uploads; this module only reads and overwrites.
// Overwrite rules (2026-10-15 사용자 결정): HWP originals only, only while Drive
// still holds the revision the editor opened, after a verified copy of that
// revision is kept in the "Web2 편집 백업" folder. Backups are never removed here,
// and nothing is ever permanently deleted or retried after an unknown result.
type DbRequest = (path: string) => Promise<unknown>;
type Deps = {
  db: DbRequest;
  driveToken: () => Promise<string>;
  assertOwner: (userId: string, row: { workspace_id: string }) => Promise<void>;
  fetch: typeof fetch;
  now?: () => Date;
};
type Source = {
  kind: "library" | "basket";
  workspaceId: string;
  fileId: string;
  fileName: string;
  format: "hwp" | "hwpx" | "html";
  documentId?: string;
  noteId?: string;
};
type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  md5Checksum?: string;
  headRevisionId?: string;
  trashed?: boolean;
  ownedByMe?: boolean;
};

export const HWP_MAX_BYTES = 30 * 1024 * 1024;
// MD-표시보완: a pasted ChatGPT HTML page shown in the memo's sandboxed frame. Read only; nothing is written.
export const HTML_VIEW_MAX_BYTES = 2 * 1024 * 1024;
export const isHtmlName = (name: string) => /\.html?$/i.test(String(name || ""));
export const BACKUP_FOLDER = "Web2 편집 백업";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const REVISION = /^[A-Za-z0-9_-]{1,255}$/;
const MD5 = /^[0-9a-f]{32}$/;
const MAGIC = { hwp: [0xd0, 0xcf, 0x11, 0xe0], hwpx: [0x50, 0x4b, 0x03, 0x04] };
const FILE_FIELDS =
  "id,name,mimeType,size,md5Checksum,headRevisionId,trashed,ownedByMe";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

// status: 400 refused before any write, 409 refused because Drive or sharing
// changed (nothing written), 503 the outcome is unknown: check, never resend.
export class HwpEditError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const refuse = (code: string, message: string) =>
  new HwpEditError(400, code, message);
const unavailable = () =>
  refuse(
    "DRIVE_UNAVAILABLE",
    "Google Drive를 확인하지 못했습니다. 아무것도 바꾸지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
  );
const changed = () =>
  new HwpEditError(
    409,
    "VERSION_CHANGED",
    "연 뒤에 Drive의 원본이 바뀌었습니다. 덮어쓰지 않았습니다. [새 파일로 저장]을 써 주세요.",
  );

export const formatOf = (name: string): "hwp" | "hwpx" | null =>
  (String(name || "").toLowerCase().match(/\.(hwpx?)$/)?.[1] as
    | "hwp"
    | "hwpx"
    | undefined) ?? null;
export const hasMagic = (bytes: Uint8Array, format: "hwp" | "hwpx") =>
  MAGIC[format].every((b, i) => bytes[i] === b);

// "2026-10-15 1430" in Korean time, for the backup file name.
export function stamp(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}${parts.minute}`;
}
export function backupName(fileName: string, date: Date) {
  const base = String(fileName || "").replace(/\.hwp$/i, "").trim() || "문서";
  return `${base} 편집 전 백업 ${stamp(date)}.hwp`;
}

export function createHwpEdit(deps: Deps) {
  const now = deps.now ?? (() => new Date());
  async function drive(url: string, init: RequestInit = {}) {
    try {
      return await deps.fetch(url, { ...init, redirect: "error" });
    } catch {
      return null;
    }
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function source(
    userId: string,
    input: { document_id?: unknown; note_id?: unknown; drive_file_id?: unknown },
    want: "hwp" | "html" = "hwp",
  ): Promise<Source> {
    const documentId = typeof input.document_id === "string"
      ? input.document_id
      : "";
    const noteId = typeof input.note_id === "string" ? input.note_id : "";
    const fileId = typeof input.drive_file_id === "string"
      ? input.drive_file_id
      : "";
    let found: Source;
    if (documentId && !noteId && !fileId) {
      if (!UUID.test(documentId)) {
        throw refuse("INVALID_REQUEST", "열 문서를 확인할 수 없습니다.");
      }
      const rows = await deps.db(
        `app_documents?id=eq.${
          encodeURIComponent(documentId)
        }&select=id,workspace_id,file_id,file_name&limit=1`,
      );
      const doc = Array.isArray(rows) ? rows[0] : null;
      if (!doc || doc.id !== documentId || typeof doc.workspace_id !== "string") {
        throw refuse("DOCUMENT_NOT_FOUND", "자료를 찾을 수 없습니다.");
      }
      await deps.assertOwner(userId, doc);
      if (!DRIVE_ID.test(String(doc.file_id ?? ""))) {
        throw refuse("DRIVE_FILE_MISSING", "이 자료에는 Drive 파일이 없습니다.");
      }
      found = {
        kind: "library",
        workspaceId: doc.workspace_id,
        fileId: doc.file_id,
        fileName: String(doc.file_name || ""),
        format: "hwp",
        documentId,
      };
    } else if (noteId && fileId && !documentId) {
      if (!UUID.test(noteId) || !DRIVE_ID.test(fileId)) {
        throw refuse("INVALID_REQUEST", "열 첨부를 확인할 수 없습니다.");
      }
      const rows = await deps.db(
        `app_notes?id=eq.${
          encodeURIComponent(noteId)
        }&select=id,workspace_id,attachments&limit=1`,
      );
      const note = Array.isArray(rows) ? rows[0] : null;
      if (
        !note || note.id !== noteId || typeof note.workspace_id !== "string"
      ) throw refuse("NOTE_NOT_FOUND", "메모를 찾을 수 없습니다.");
      await deps.assertOwner(userId, note);
      const attachment = Array.isArray(note.attachments)
        ? note.attachments.find((a: unknown) =>
          !!a && typeof a === "object" &&
          (a as { drive_file_id?: unknown }).drive_file_id === fileId
        )
        : undefined;
      if (!attachment) {
        throw refuse("ATTACHMENT_NOT_FOUND", "이 메모의 첨부가 아닙니다.");
      }
      found = {
        kind: "basket",
        workspaceId: note.workspace_id,
        fileId,
        fileName: String(attachment.file_name || ""),
        format: "hwp",
        noteId,
      };
    } else {
      throw refuse("INVALID_REQUEST", "열 파일을 확인할 수 없습니다.");
    }
    if (want === "html") {
      if (found.kind !== "basket") {
        throw refuse("INVALID_REQUEST", "바구니 메모의 첨부만 화면으로 볼 수 있습니다.");
      }
      if (!isHtmlName(found.fileName)) {
        throw refuse("NOT_HTML", "HTML 첨부만 화면으로 볼 수 있습니다.");
      }
      return { ...found, format: "html" };
    }
    const format = formatOf(found.fileName);
    if (!format) {
      throw refuse("NOT_HWP", "HWP·HWPX 파일만 편집할 수 있습니다.");
    }
    return { ...found, format };
  }

  // Both the library and the basket point at this Drive file.
  async function shared(src: Source) {
    const ws = encodeURIComponent(src.workspaceId);
    const rows = src.kind === "library"
      ? await deps.db(
        `app_notes?workspace_id=eq.${ws}&attachments=cs.${
          encodeURIComponent(JSON.stringify([{ drive_file_id: src.fileId }]))
        }&select=id&limit=1`,
      )
      : await deps.db(
        `app_documents?workspace_id=eq.${ws}&file_id=eq.${
          encodeURIComponent(src.fileId)
        }&select=id&limit=1`,
      );
    if (!Array.isArray(rows)) throw unavailable();
    return rows.length > 0;
  }

  async function meta(
    fileId: string,
    token: string,
    max = HWP_MAX_BYTES,
  ): Promise<DriveFile> {
    const r = await drive(
      `${DRIVE}/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}`,
      { headers: auth(token) },
    );
    if (r?.status === 404) {
      throw refuse("DRIVE_FILE_MISSING", "Drive에서 원본을 찾을 수 없습니다.");
    }
    if (!r?.ok) throw unavailable();
    const f = await r.json().catch(() => null);
    if (
      !f || f.id !== fileId || f.ownedByMe !== true ||
      typeof f.trashed !== "boolean" || !REVISION.test(String(f.headRevisionId ?? "")) ||
      !MD5.test(String(f.md5Checksum ?? "")) ||
      !/^\d{1,12}$/.test(String(f.size ?? ""))
    ) throw refuse("DRIVE_FILE_INVALID", "Drive 원본을 확인하지 못했습니다.");
    if (f.trashed) {
      throw refuse("DRIVE_FILE_TRASHED", "Drive 원본이 휴지통에 있습니다.");
    }
    if (Number(f.size) <= 0 || Number(f.size) > max) {
      throw refuse(
        "FILE_TOO_LARGE",
        max === HWP_MAX_BYTES
          ? "30MB보다 큰 파일은 편집기에서 열지 않습니다."
          : "2MB보다 큰 HTML은 화면으로 보지 않습니다. Drive에서 열어 주세요.",
      );
    }
    return f;
  }

  async function open(
    userId: string,
    input: Record<string, unknown>,
  ) {
    const src = await source(userId, input);
    const isShared = await shared(src);
    const token = await deps.driveToken();
    const before = await meta(src.fileId, token);
    const r = await drive(
      `${DRIVE}/${encodeURIComponent(src.fileId)}?alt=media`,
      { headers: auth(token) },
    );
    if (!r?.ok) throw unavailable();
    const bytes = new Uint8Array(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
    // The revision the editor works on: unchanged across the download.
    const after = await meta(src.fileId, token);
    if (
      after.headRevisionId !== before.headRevisionId ||
      after.md5Checksum !== before.md5Checksum ||
      bytes.length !== Number(before.size)
    ) {
      throw new HwpEditError(
        409,
        "DRIVE_FILE_CHANGING",
        "Drive 원본이 바뀌는 중입니다. 잠시 뒤 다시 열어 주세요.",
      );
    }
    if (!hasMagic(bytes, src.format)) {
      throw refuse("NOT_HWP", "HWP·HWPX 파일 내용이 아닙니다.");
    }
    return {
      bytes,
      info: {
        source: src.kind,
        file_name: src.fileName,
        format: src.format,
        size: bytes.length,
        revision: before.headRevisionId,
        md5: before.md5Checksum,
        can_overwrite: src.format === "hwp",
        shared: isShared,
      },
    };
  }

  // The bytes as text for the memo's sandboxed frame (html-frame.js adds the network-blocking policy).
  // Same checks as open: the server-read note and attachment, a file the owner's Drive holds, one revision.
  async function openHtml(userId: string, input: Record<string, unknown>) {
    const src = await source(userId, input, "html");
    const token = await deps.driveToken();
    const before = await meta(src.fileId, token, HTML_VIEW_MAX_BYTES);
    const r = await drive(
      `${DRIVE}/${encodeURIComponent(src.fileId)}?alt=media`,
      { headers: auth(token) },
    );
    if (!r?.ok) throw unavailable();
    const bytes = new Uint8Array(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (bytes.length !== Number(before.size)) {
      throw new HwpEditError(
        409,
        "DRIVE_FILE_CHANGING",
        "Drive 원본이 바뀌는 중입니다. 잠시 뒤 다시 열어 주세요.",
      );
    }
    return {
      ok: true,
      file_name: src.fileName,
      size: bytes.length,
      html: new TextDecoder("utf-8").decode(bytes),
    };
  }

  // One "Web2 편집 백업" folder in the owner's own My Drive root; the oldest wins.
  async function backupFolder(token: string) {
    const params = new URLSearchParams({
      q: `name = '${BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners and trashed = false`,
      fields: "incompleteSearch,files(id,ownedByMe,trashed)",
      orderBy: "createdTime",
      pageSize: "10",
    });
    const listed = await drive(`${DRIVE}?${params}`, { headers: auth(token) });
    const found = listed?.ok ? await listed.json().catch(() => null) : null;
    if (!found || !Array.isArray(found.files) || found.incompleteSearch) {
      return null;
    }
    const existing = found.files.find((f: DriveFile) =>
      DRIVE_ID.test(String(f?.id ?? "")) && f.ownedByMe === true &&
      f.trashed === false
    );
    if (existing) return existing.id as string;
    const created = await drive(`${DRIVE}?fields=id`, {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: BACKUP_FOLDER,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      }),
    });
    const folder = created?.ok ? await created.json().catch(() => null) : null;
    return DRIVE_ID.test(String(folder?.id ?? "")) ? folder.id as string : null;
  }

  async function overwrite(userId: string, form: FormData) {
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : undefined;
    };
    const src = await source(userId, {
      document_id: field("document_id"),
      note_id: field("note_id"),
      drive_file_id: field("drive_file_id"),
    });
    if (src.format !== "hwp") {
      throw refuse(
        "OVERWRITE_HWP_ONLY",
        "HWPX 원본은 덮어쓰지 않습니다. 새 HWP 파일로 저장해 주세요.",
      );
    }
    const baseRevision = field("base_revision") ?? "",
      baseMd5 = field("base_md5") ?? "";
    if (!REVISION.test(baseRevision) || !MD5.test(baseMd5)) {
      throw refuse("INVALID_REQUEST", "연 버전을 확인할 수 없습니다.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      throw refuse("FILE_MISSING", "저장할 파일이 없습니다.");
    }
    if (file.size > HWP_MAX_BYTES) {
      throw refuse("FILE_TOO_LARGE", "30MB보다 큰 파일은 저장하지 않습니다.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasMagic(bytes, "hwp")) {
      throw refuse("NOT_HWP", "HWP 파일 내용이 아닙니다.");
    }
    if (await shared(src) && field("confirm_shared") !== "1") {
      throw new HwpEditError(
        409,
        "SHARED_CONFIRM_REQUIRED",
        "바구니와 자료실이 같은 원본을 씁니다. 양쪽에 반영되는 것을 확인해 주세요.",
      );
    }
    const token = await deps.driveToken();
    const current = await meta(src.fileId, token);
    if (
      current.headRevisionId !== baseRevision || current.md5Checksum !== baseMd5
    ) throw changed();

    // Backup first. Without a verified copy of the opened revision, never overwrite.
    const backupFailed = () =>
      refuse(
        "BACKUP_FAILED",
        `원본 사본을 "${BACKUP_FOLDER}" 폴더에 보관하지 못해 덮어쓰지 않았습니다. 원본은 그대로입니다.`,
      );
    const folder = await backupFolder(token);
    if (!folder) throw backupFailed();
    const name = backupName(src.fileName, now());
    const copied = await drive(
      `${DRIVE}/${encodeURIComponent(src.fileId)}/copy?fields=id,name,md5Checksum`,
      {
        method: "POST",
        headers: { ...auth(token), "Content-Type": "application/json" },
        body: JSON.stringify({ name, parents: [folder] }),
      },
    );
    const copy = copied?.ok ? await copied.json().catch(() => null) : null;
    if (!copy || !DRIVE_ID.test(String(copy.id ?? "")) || copy.id === src.fileId) {
      throw backupFailed();
    }
    // The copy holds another revision: Drive changed after the check above.
    if (copy.md5Checksum !== baseMd5) throw changed();
    const again = await meta(src.fileId, token);
    if (again.headRevisionId !== baseRevision || again.md5Checksum !== baseMd5) {
      throw changed();
    }

    const backup = { id: copy.id as string, name };
    const unknown = () =>
      Object.assign(
        new HwpEditError(
          503,
          "RESULT_UNKNOWN",
          "덮어쓰기 결과를 확인하지 못했습니다. 다시 저장하지 말고 Drive에서 원본을 먼저 확인해 주세요. 편집 전 사본은 백업 폴더에 있습니다.",
        ),
        { backup },
      );
    const written = await drive(
      `https://www.googleapis.com/upload/drive/v3/files/${
        encodeURIComponent(src.fileId)
      }?uploadType=media&fields=id,headRevisionId,md5Checksum,size`,
      {
        method: "PATCH",
        headers: {
          ...auth(token),
          "Content-Type": current.mimeType || "application/x-hwp",
        },
        body: bytes,
      },
    );
    if (!written || written.status >= 500) throw unknown();
    if (!written.ok) {
      throw Object.assign(
        refuse(
          "OVERWRITE_REJECTED",
          "Drive가 덮어쓰기를 거절했습니다. 원본은 그대로입니다.",
        ),
        { backup },
      );
    }
    const result = await written.json().catch(() => null);
    if (
      !result || result.id !== src.fileId ||
      !REVISION.test(String(result.headRevisionId ?? "")) ||
      !MD5.test(String(result.md5Checksum ?? "")) ||
      Number(result.size) !== bytes.length
    ) throw unknown();
    return {
      ok: true,
      result: "overwritten",
      backup,
      revision: result.headRevisionId,
      md5: result.md5Checksum,
      size: bytes.length,
    };
  }

  return { open, overwrite, openHtml };
}
