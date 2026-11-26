// HWP-편집기 2단계: document-actions `hwp-open`·`hwp-overwrite`. MD-표시보완·PRESS-자료실편입: 읽기 전용 `html-view`(바구니 .html 첨부·자료실 .html 자료).
// The file, its workspace and every Drive ID come from the server-read library row
// or basket note, never from the client. Saving as a new file uses the existing
// library-files / basket-files uploads; this module only reads and overwrites.
// Overwrite rules (2026-10-15 사용자 결정): HWP originals only, only while Drive
// still holds the revision the editor opened, after a verified copy of that
// revision is kept in the "노조+ 편집 백업" folder (새 사용자는 "WORK ON+ 편집 백업", 옛 이름 "Web2 편집 백업"). Backups are never removed here,
// and nothing is ever permanently deleted or retried after an unknown result.
import { FOLDER_NAMES, NOJO_WORDS_FEATURE, driveQuoted, folderNameFor, keepOldFromFeatureWorkspace } from "./brand-folders.mjs";
// S69-22: 편집 백업 폴더는 표식(kptu_app_folder=edit_backup)으로 찾고, 맨 위 또는 맨 위 앱 폴더 바로 아래 어디에 있어도 같은 폴더.
import { APP_FOLDER_MARK, createParentFor, isDriveId, renameIfOld, topParentsClause } from "./app-folders.mjs";
type DbRequest = (path: string) => Promise<unknown>;
type Deps = {
  db: DbRequest;
  driveToken: () => Promise<string>;
  assertOwner: (userId: string, row: { workspace_id: string }) => Promise<void>;
  fetch: typeof fetch;
  now?: () => Date;
  // S68-02: 이 작업공간이 지금 이름('노조+ …', 운영자 기능 nojo_words)을 쓰나. 모르면 null(→ 지금 이름).
  // 없으면 db(서버 키)로 서버 허용 표 함수 app_operator_feature_workspace('nojo_words')를 GET으로 읽는다(stable 함수, 기존 service_role 권한).
  keepOldNames?: (workspaceId: string) => Promise<boolean | null>;
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
export const BACKUP_FOLDER = "노조+ 편집 백업";
// S68-02: 새 사용자(운영자 기능 nojo_words가 아닌 사람)가 처음 만들 때의 이름(_shared/brand-folders.mjs와 같은 값).
export const WORKON_BACKUP_FOLDER = FOLDER_NAMES.edit_backup.now; // S69-41: 이름 글자는 brand-folders.mjs DRIVE_BRAND 한 곳
if (FOLDER_NAMES.edit_backup.old !== BACKUP_FOLDER) {
  throw new Error("edit backup folder names drifted");
}
// BRAND-웹2흔적지우기: 예전에 만든 폴더 이름. 찾을 때 함께 보고, 찾으면 이름만 새 이름으로 바꾼다(파일은 그대로).
export const OLD_BACKUP_FOLDER = "Web2 편집 백업";

// TRASH-다른삭제 5단계: 서버 키(service_role)는 RLS(휴지통 숨김 정책)를 건너뛰므로 노트 id로 직접 읽을 때는 휴지통 노트(deleted_at 있음)를 뺀다.
// DB 적용 전에는 app_notes에 deleted_at 칸이 없어 PostgREST가 "column app_notes.deleted_at does not exist"(42703)로 거절한다.
// 그 거절이면 거르기 없이 한 번 더 읽는다(그때는 휴지통 행이 있을 수 없다). 다른 오류는 그대로 던진다.
// 첫 인자 db는 path를 받아 읽는 함수(서버 키)다. path는 쿼리 문자열이 이미 있는 app_notes 읽기여야 한다. (같은 규칙의 짝: document-actions/index.ts)
async function readLiveNoteRows(
  db: (path: string) => Promise<unknown>,
  path: string,
): Promise<unknown> {
  try {
    return await db(`${path}&deleted_at=is.null`);
  } catch (error) {
    const text = String((error as { message?: unknown } | null)?.message ?? "");
    if (!/deleted_at/.test(text) || !/does not exist|42703/i.test(text)) {
      throw error;
    }
    return await db(path);
  }
}
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
      const rows = await readLiveNoteRows(
        deps.db,
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
      // PRESS-자료실편입: 바구니 첨부와 자료실 자료 모두. 둘 다 위에서 서버가 읽은 행과 owner 확인을 거쳤다.
      if (!isHtmlName(found.fileName)) {
        throw refuse("NOT_HTML", "HTML 파일만 화면으로 볼 수 있습니다.");
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
  // Same checks as open: the server-read library row or note attachment, a file the owner's Drive holds, one revision.
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

  // One backup folder in the owner's own My Drive root. S68-02: 찾을 때는 세 이름("노조+ 편집 백업"·"WORK ON+ 편집 백업"·옛 "Web2 편집 백업")을
  // 모두 보고, 이름 차례(노조+ → WORK ON+ → Web2) 다음 오래된 것을 고른다 — 이미 있는 "노조+ 편집 백업"은 그대로 계속 쓴다(이름을 바꾸지 않음).
  // BRAND-웹2흔적지우기: 고른 것이 "Web2 편집 백업"이면 이름만 이 사람의 이름(아래)으로 바꾼다(실패해도 백업은 그 폴더에 그대로 한다).
  // 없을 때만 새로 만든다: 운영자 기능 nojo_words(사용자 화면)·확인 실패는 "노조+ 편집 백업", 그 밖은 "WORK ON+ 편집 백업".
  // 새 폴더를 더 만들지 않고, 안의 파일은 옮기거나 지우지 않는다.
  const keepOldNames = deps.keepOldNames ?? (async (workspaceId: string) =>
    keepOldFromFeatureWorkspace(await deps.db(`rpc/app_operator_feature_workspace?p_feature=${NOJO_WORDS_FEATURE}`), workspaceId));
  // S69-22: 맨 위 앱 폴더 id(app_drive_settings.root_folder_id, 서버 키로 읽음). 못 읽으면 null(→ 내 드라이브 맨 위만, 지금 동작).
  async function appRootOf(workspaceId: string): Promise<string | null> {
    try {
      const rows = await deps.db(`app_drive_settings?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=root_folder_id&limit=1`);
      const id = Array.isArray(rows) ? rows[0]?.root_folder_id : null;
      return isDriveId(id) ? id : null;
    } catch {
      return null;
    }
  }
  async function backupFolder(token: string, workspaceId: string) {
    const order = [...new Set([BACKUP_FOLDER, WORKON_BACKUP_FOLDER, OLD_BACKUP_FOLDER, ...FOLDER_NAMES.edit_backup.olds])];
    const appRoot = await appRootOf(workspaceId);
    const mark = `appProperties has { key='${APP_FOLDER_MARK}' and value='edit_backup' }`;
    const params = new URLSearchParams({
      q: `(${mark} or ${order.map((name) => `name = '${driveQuoted(name)}'`).join(" or ")}) and mimeType = 'application/vnd.google-apps.folder' and ${topParentsClause(appRoot)} and 'me' in owners and trashed = false`,
      fields: "incompleteSearch,files(id,name,parents,ownedByMe,trashed,appProperties)",
      orderBy: "createdTime",
      pageSize: "10",
    });
    const listed = await drive(`${DRIVE}?${params}`, { headers: auth(token) });
    const found = listed?.ok ? await listed.json().catch(() => null) : null;
    if (!found || !Array.isArray(found.files) || found.incompleteSearch) {
      return null;
    }
    const usable = found.files.filter((f: DriveFile) =>
      DRIVE_ID.test(String(f?.id ?? "")) && f.ownedByMe === true &&
      f.trashed === false
    );
    const marked = (f: DriveFile) => (f as { appProperties?: Record<string, string> }).appProperties?.[APP_FOLDER_MARK] === "edit_backup";
    // 표식이 붙은 폴더가 먼저(옮겨도·이름을 바꿔도 같은 폴더). 없으면 옛 이름 차례(노조+ → WORK ON+ → Web2).
    const pool = usable.some(marked) ? usable.filter(marked) : usable;
    const existing = order.map((name) => pool.find((f: DriveFile) => f.name === name)).find(Boolean) ?? pool[0];
    let ownName: string | null = null;
    const nameForMe = async () => ownName ?? (ownName = folderNameFor("edit_backup", await keepOldNames(workspaceId).catch(() => null)));
    if (existing) {
      const id = existing.id as string;
      const needsMark = !marked(existing);
      const mark = needsMark ? { [APP_FOLDER_MARK]: "edit_backup" } : null;
      // S69-42: 옛 이름('노조+ 편집 백업'·'Web2 편집 백업')이면 쓸 때 새 이름으로(같은 자리에 새 이름 폴더가 있으면 그대로). 덤이라 실패해도 백업은 그 폴더에 한다.
      const authed = (url: string, init: RequestInit = {}) => drive(url, { ...init, headers: { ...(init.headers as Record<string, string> || {}), ...auth(token) } });
      const renamed = await renameIfOld({ drive: authed, kind: "edit_backup", file: { id, name: existing.name, parents: (existing as { parents?: string[] }).parents }, mark });
      if (renamed === "renamed") return { id, name: FOLDER_NAMES.edit_backup.now as string };
      if (needsMark) {
        // 표식이 없던 옛 폴더는 표식을 적어 둔다(다음부터는 표식으로 찾음). 실패해도 백업은 그 폴더에 그대로 한다.
        await drive(`${DRIVE}/${encodeURIComponent(id)}?fields=id`, {
          method: "PATCH",
          headers: { ...auth(token), "Content-Type": "application/json" },
          body: JSON.stringify({ appProperties: mark }),
        }).catch(() => null);
      }
      return { id, name: typeof existing.name === "string" ? existing.name : null };
    }
    const created = await drive(`${DRIVE}?fields=id`, {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: await nameForMe(),
        mimeType: "application/vnd.google-apps.folder",
        parents: [createParentFor(appRoot)],
        appProperties: { [APP_FOLDER_MARK]: "edit_backup" },
      }),
    });
    const folder = created?.ok ? await created.json().catch(() => null) : null;
    return DRIVE_ID.test(String(folder?.id ?? "")) ? { id: folder.id as string, name: await nameForMe() } : null;
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
        "원본 사본을 편집 백업 폴더에 보관하지 못해 덮어쓰지 않았습니다. 원본은 그대로입니다.",
      );
    const folder = await backupFolder(token, src.workspaceId);
    if (!folder) throw backupFailed();
    const name = backupName(src.fileName, now());
    const copied = await drive(
      `${DRIVE}/${encodeURIComponent(src.fileId)}/copy?fields=id,name,md5Checksum`,
      {
        method: "POST",
        headers: { ...auth(token), "Content-Type": "application/json" },
        body: JSON.stringify({ name, parents: [folder.id] }),
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

    // folder: 사본이 든 폴더의 실제 이름(화면 안내 글에 그대로 쓴다, S68-02).
    const backup = { id: copy.id as string, name, folder: folder.name };
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
