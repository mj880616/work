// Microsoft Graph 도우미. 요청 범위는 Files.ReadWrite + offline_access + User.Read 뿐이다(2026-10-27 결정: 사진 지우기).
// 전체 범위(.All)·앱 폴더·선택 범위는 요청도 허용도 하지 않는다(scopeAllowed).
export const SCOPE = "Files.ReadWrite offline_access User.Read";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|heic|heif)$/i;
export const SIZES = { small: "c480x480", large: "c1600x1600" } as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_FOLDER_DEPTH = 3;
export const MAX_REQUESTS = 40;
export const MAX_ITEMS = 5000;

export type OneDriveItem = {
  id: string;
  name?: string;
  file?: { mimeType?: string };
  folder?: unknown;
  photo?: { takenDateTime?: string };
  fileSystemInfo?: { createdDateTime?: string };
  parentReference?: { path?: string };
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
