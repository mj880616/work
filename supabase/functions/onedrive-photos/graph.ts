// Microsoft Graph 도우미. 요청 범위는 Files.ReadWrite + offline_access + User.Read 뿐이다(2026-10-27 결정: 사진 지우기).
// 전체 범위(.All)·앱 폴더·선택 범위는 요청도 허용도 하지 않는다(scopeAllowed).
export const SCOPE = "Files.ReadWrite offline_access User.Read";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const IMAGE_MIME = /^image\/(jpeg|png|webp|gif|heic|heif)$/i;
// 사진 메뉴 ①(PHOTO-사진메뉴): 동영상도 색인한다. 일기 날짜 화면은 계속 사진(kind='photo')만 보인다.
export const VIDEO_MIME = /^video\/(mp4|quicktime|3gpp|webm)$/i;
export const isMediaMime = (v: unknown): v is string => typeof v === "string" && (IMAGE_MIME.test(v) || VIDEO_MIME.test(v));
export const SIZES = { small: "c480x480", large: "c1600x1600" } as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// 썸네일 주소 묶음(photo-urls, 2026-10-28 OD-속도): 한 번에 받는 사진 수 상한과 Graph $batch 한 번에 넣는 사진 수(사진 1장 = 하위 요청 2개, $batch 상한 20개).
export const PHOTO_URLS_MAX = 20;
export const GRAPH_BATCH_PHOTOS = 10;
// 사진 색인(2026-10-28): 달을 열 때마다 폴더를 훑지 않고, 고른 맨 위 폴더의 delta를 나눠 받아 서버 표에 적는다.
// 한 요청 안에서 받는 양은 시간·쪽 수로 자른다(Edge 요청 시간 안에 끝나게). 못 끝내면 다음 쪽 주소를 저장하고 more:true.
export const DELTA_SELECT = "id,name,size,createdDateTime,file,folder,photo,image,video,location,fileSystemInfo,parentReference,deleted";
// 한 걸음은 화면 요청 시간(45초) 안에 넉넉히 끝나야 한다: 쪽 하나가 최대 20초 걸릴 수 있으므로 새 쪽은 8초까지만 시작한다.
export const SYNC_BUDGET_MS = 8000;
export const SYNC_MAX_PAGES = 15;
export const AUTO_SYNC_BUDGET_MS = 3000;
export const AUTO_SYNC_MAX_PAGES = 2;
export const SYNC_LOCK_MS = 60000;
export const SYNC_STALE_MS = 10 * 60 * 1000;
export const MAX_FOLDER_DEPTH = 64;
export const MAX_ITEMS = 5000;
// 사진 메뉴 ①: 최신순 쪽 읽기(library)·여러 장 옮기기/지우기·별표 거르기의 상한. Graph $batch 한 번은 하위 요청 20개까지.
export const LIBRARY_DEFAULT = 120;
export const LIBRARY_MAX = 200;
export const LIBRARY_SCAN_PAGES = 20;
export const MOVE_MAX = 50;
export const STAR_IDS_MAX = 500;
export const GRAPH_BATCH_MAX = 20;
// Web2 휴지통(명진 결정 1, 2026-10-28 22:43): 지운 사진은 고른 맨 위 폴더 안 이 폴더로 옮기고, 30일 지나면 원드라이브 휴지통으로 보낸다.
export const TRASH_NAME = ".Web2 휴지통";
export const TRASH_DAYS = 30;
export const TRASH_PURGE_STEP = 20;
export const TRASH_LIST_MAX = 2000;
// 동영상 재생·원본 받기 주소(media-url): Microsoft가 주는 사전 인증 주소는 약 1시간 산다. 화면은 이 초만큼만 쓰고 다시 받는다.
export const MEDIA_URL_TTL_S = 3000;

// 사진 메뉴 ②(폴더 보기, 2026-10-29): 폴더 만들기·이름 바꾸기의 이름 규칙. 원드라이브가 거절하는 글자(" * : < > ? / \ |)·제어 글자,
// 앞뒤 공백·끝의 점, 1~200자 밖은 받지 않는다. Web2 휴지통 이름은 만들 수 없다(휴지통 폴더와 헷갈림). 맞으면 다듬은 이름, 아니면 null.
export const FOLDER_NAME_MAX = 200;
export function cleanFolderName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.normalize("NFC").trim();
  if (!name || [...name].length > FOLDER_NAME_MAX || /["*:<>?/\\|\u0000-\u001f\u007f]/.test(name) || name.endsWith(".")) return null;
  if (name === TRASH_NAME || name === "." || name === "..") return null;
  return name;
}

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
  size?: number;
  file?: { mimeType?: string; hashes?: { sha1Hash?: string } };
  folder?: unknown;
  photo?: { takenDateTime?: string };
  image?: { width?: number; height?: number };
  video?: { duration?: number; width?: number; height?: number };
  location?: { latitude?: number; longitude?: number };
  fileSystemInfo?: { createdDateTime?: string };
  createdDateTime?: string;
  parentReference?: { path?: string; id?: string };
  deleted?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
};

const intIn = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const numIn = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// 스크린샷 추정: Graph에 스크린샷 표시가 없어서 파일 이름으로만 본다(안드로이드 Screenshot_…, 아이폰·PC 'Screen Shot'·'스크린샷'·'캡처').
export const isScreenshotName = (name: unknown) =>
  typeof name === "string" && /^(screenshot|screen[ _-]?shot|스크린샷|화면[ _]?캡처|캡처)/i.test(name.normalize("NFC"));

// 색인 새 칸(DB 20261028220000): 종류·형식·크기·가로세로·길이·sha1·위치·스크린샷. 값이 이상하면 그 칸만 비운다(DB 검사와 같은 범위).
export function mediaFields(item: OneDriveItem) {
  const mime = String(item.file?.mimeType || "").toLowerCase();
  const kind = VIDEO_MIME.test(mime) ? "video" : "photo";
  const sha = String(item.file?.hashes?.sha1Hash || "").toLowerCase();
  const lat = numIn(item.location?.latitude, -90, 90), lon = numIn(item.location?.longitude, -180, 180);
  const both = lat !== null && lon !== null;
  return {
    kind,
    mime: /^(image|video)\/[a-z0-9.+-]{1,80}$/.test(mime) ? mime : null,
    size_bytes: intIn(item.size, 0, Number.MAX_SAFE_INTEGER),
    width: intIn(kind === "video" ? item.video?.width : item.image?.width, 1, 100000),
    height: intIn(kind === "video" ? item.video?.height : item.image?.height, 1, 100000),
    duration_ms: kind === "video" ? intIn(item.video?.duration, 0, 864000000) : null,
    sha1: /^[0-9a-f]{40}$/.test(sha) ? sha : null,
    lat: both ? lat : null,
    lon: both ? lon : null,
    screenshot: kind === "photo" && isScreenshotName(item.name),
    // 올린 시각(원드라이브에 파일이 생긴 시각, 진짜 UTC). 없거나 이상하면 비움(정렬은 찍은 시각으로 대신).
    uploaded_at: uploadedOf(item),
  };
}

export function uploadedOf(item: OneDriveItem): string | null {
  const v = item.createdDateTime;
  if (typeof v !== "string" || v.length > 40) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// PHOTO-정렬: 사진 목록 정렬 기준(화면 view_prefs.photo_view.sort, DB 검사와 같은 값). 기본은 찍은 날 최근 먼저.
export const SORTS = ["taken_desc", "taken_asc", "uploaded_desc", "name_asc", "size_desc", "duration_desc"] as const;
export type Sort = typeof SORTS[number];

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

// 찍은 시각(photo.takenDateTime)은 카메라 EXIF의 '그 자리 벽시계' 시각이다. EXIF에는 시간대가 없는데 Graph는 끝에 'Z'(UTC)를
// 붙여 준다(폰이 한국 시각 10:00에 찍으면 "…T10:00:00Z"). 그대로 UTC로 읽으면 서울 시각이 9시간 늦게(19:00) 보이고, 15시 이후
// 사진은 다음 날로 묶인다. 그래서 'Z'나 시간대 없는 값은 서울 벽시계(UTC+9, 서머타임 없음)로 보고 진짜 UTC로 바꾼다.
// 시간대(±hh:mm)를 밝혀 준 값만 그대로 믿는다. 해외에서 찍은 사진은 그 나라 벽시계라 이 규칙으로는 알 수 없다(추정 한계).
// 파일 생성 시각(fileSystemInfo.createdDateTime)은 진짜 UTC라 바꾸지 않는다(approx 줄).
export const CAMERA_CLOCK_OFFSET_MS = 9 * 3600 * 1000;
// 이 시각보다 먼저 다 받은 색인은 옛 규칙(찍은 시각을 UTC로 읽음)으로 적혀 있다. 이 고침이 배포된 뒤 한 번 처음부터 다시 받는다(handler syncStep).
// 배포보다 앞서기만 하면 된다(배포 뒤 새로 다 받은 색인은 이보다 늦으므로 다시 받지 않는다).
// PHOTO-정렬(2026-10-30): 올린 시각(uploaded_at, DB 20261030150000) 칸을 옛 줄에도 채우려고 기준을 한 번 더 옮겼다(이보다 먼저 다 받은 색인은 한 번 다시 받는다).
export const TAKEN_FIX_AT = "2026-10-30T04:30:00Z";
export function cameraClockToUtc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)(Z|[+-]\d{2}:\d{2})?$/.exec(v.trim());
  if (!m) return null;
  const zone = m[2];
  if (zone && zone !== "Z") {
    const ms = Date.parse(m[1] + zone);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const wall = Date.parse(m[1] + "Z");
  return Number.isFinite(wall) ? new Date(wall - CAMERA_CLOCK_OFFSET_MS).toISOString() : null;
}

export function takenOf(item: OneDriveItem): { at: string; approx: boolean } | null {
  const taken = cameraClockToUtc(item.photo?.takenDateTime);
  if (taken && seoulDay(taken)) return { at: taken, approx: false };
  const made = item.fileSystemInfo?.createdDateTime;
  if (made && seoulDay(made)) return { at: made, approx: true };
  return null;
}
