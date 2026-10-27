// Microsoft Graph 도우미. 요청 범위는 Files.ReadWrite + offline_access + User.Read 뿐이다(2026-10-27 결정: 사진 지우기).
// 전체 범위(.All)·앱 폴더·선택 범위는 요청도 허용도 하지 않는다(scopeAllowed).
export const SCOPE = "Files.ReadWrite offline_access User.Read";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|heic|heif)$/i;
export const SIZES = { small: "c480x480", large: "c1600x1600" } as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// 썸네일 주소 묶음(photo-urls, 2026-10-28 OD-속도): 한 번에 받는 사진 수 상한과 Graph $batch 한 번에 넣는 사진 수(사진 1장 = 하위 요청 2개, $batch 상한 20개).
export const PHOTO_URLS_MAX = 20;
export const GRAPH_BATCH_PHOTOS = 10;
// 사진 색인(2026-10-28): 달을 열 때마다 폴더를 훑지 않고, 고른 맨 위 폴더의 delta를 나눠 받아 서버 표에 적는다.
// 한 요청 안에서 받는 양은 시간·쪽 수로 자른다(Edge 요청 시간 안에 끝나게). 못 끝내면 다음 쪽 주소를 저장하고 more:true.
export const DELTA_SELECT = "id,name,file,folder,photo,fileSystemInfo,parentReference,deleted";
// 한 걸음은 화면 요청 시간(45초) 안에 넉넉히 끝나야 한다: 쪽 하나가 최대 20초 걸릴 수 있으므로 새 쪽은 8초까지만 시작한다.
export const SYNC_BUDGET_MS = 8000;
export const SYNC_MAX_PAGES = 15;
export const AUTO_SYNC_BUDGET_MS = 3000;
export const AUTO_SYNC_MAX_PAGES = 2;
export const SYNC_LOCK_MS = 60000;
export const SYNC_STALE_MS = 10 * 60 * 1000;
export const MAX_FOLDER_DEPTH = 64;
export const MAX_ITEMS = 5000;

// Retry-After(초 또는 날짜)를 1~3600초로 읽는다. 없거나 이상하면 30초.
export function retryAfterSeconds(v: string | null, nowMs: number): number {
  if (v && /^\d{1,6}$/.test(v.trim())) return Math.min(3600, Math.max(1, Number(v.trim())));
  const at = v ? Date.parse(v) : NaN;
  if (Number.isFinite(at)) return Math.min(3600, Math.max(1, Math.ceil((at - nowMs) / 1000)));
  return 30;
}

export type OneDriveItem = {
  id: string;
  name?: string;
  file?: { mimeType?: string };
  folder?: unknown;
  photo?: { takenDateTime?: string };
  fileSystemInfo?: { createdDateTime?: string };
  parentReference?: { path?: string; id?: string };
  deleted?: unknown;
};

// 로그인 응답의 허용 범위를 소문자 목록으로 만든다(Graph 주소 접두사는 뗀다).
export const normalizeScopes = (v: unknown): string[] =>
  String(v ?? "").toLowerCase().split(/\s+/).filter(Boolean).map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//, ""));

// 허용 범위가 이 기능에 맞는가: Files.ReadWrite가 있어야 하고, .All·AppFolder·Selected가 하나라도 섞이면 거절한다.
export function scopeAllowed(granted: string[]): boolean {
  return granted.includes("files.readwrite") && !granted.some((s) => /\.all$|appfolder|selected/.test(s));
}

// OneDrive 항목 id는 영문·숫자·'!'·'-'·'_'·'.' 뿐이다. 그 밖의 글자는 주소에 넣지 않는다.
export const validItemId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9!_.-]{1,200}$/.test(v);

// 다음 쪽 주소(@odata.nextLink)는 Graph 주소일 때만 따라간다(다른 곳으로 토큰이 새지 않게).
export function graphNextLink(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === "graph.microsoft.com" &&
        u.username === "" && u.password === "" && u.port === ""
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

// 서울 달력 날짜(YYYY-MM-DD). 사진을 찍은 시각(UTC)을 서울 날짜로 바꾼다.
export function seoulDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const normPath = (p: string) => {
  let s = p;
  try {
    s = decodeURIComponent(p);
  } catch { /* 그대로 비교 */ }
  return s.replace(/\/+$/, "").normalize("NFC");
};

// 사진이 지정 폴더 안(하위 폴더 포함)에 있는가. 경계는 '/'로 확인한다(Pictures2는 Pictures 밖).
export function insideFolder(itemParentPath: unknown, folderPath: unknown): boolean {
  if (typeof itemParentPath !== "string" || typeof folderPath !== "string") return false;
  const parent = normPath(itemParentPath), folder = normPath(folderPath);
  if (!folder || !parent) return false;
  return parent === folder || parent.startsWith(folder + "/");
}

// 폴더 경로 = 부모 경로 + 이름. 루트 자체(부모 경로 없음)는 고를 수 없다.
export function folderPathOf(item: OneDriveItem): string | null {
  const parent = item.parentReference?.path;
  if (typeof parent !== "string" || !parent || typeof item.name !== "string" || !item.name) return null;
  return parent.replace(/\/+$/, "") + "/" + item.name;
}

// 썸네일 주소는 Microsoft가 준 임시 주소다. https 이고 이름이 있는 호스트일 때만 받는다(내부 주소·IP 직접 접속 거절).
export function safeDownloadUrl(v: string | null): URL | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
    return u;
  } catch {
    return null;
  }
}

export function takenOf(item: OneDriveItem): { at: string; approx: boolean } | null {
  const taken = item.photo?.takenDateTime;
  if (taken && seoulDay(taken)) return { at: taken, approx: false };
  const made = item.fileSystemInfo?.createdDateTime;
  if (made && seoulDay(made)) return { at: made, approx: true };
  return null;
}
