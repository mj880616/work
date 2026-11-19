// S67-06 NEWS-직접넣기 사진 붙여넣기: 손으로 넣는 기사 본문에 '내가 올린 사진'(복사한 사진·폰 사진·끌어다 놓은 사진).
// 새 저장소는 없다. 사진 원본은 그 작업공간의 Google Drive(노트 첨부와 같은 'Web2 바구니' 아래 '뉴스 사진' 폴더, 공유 안 된 폴더만)에 두고,
// 기사 본문 블록에는 Drive 파일 id를 담은 '안쪽 표시 주소'(https://photo.web2.invalid/<id>.<확장자>)만 적는다.
// - .invalid는 어디로도 이어지지 않는 예약 이름이라(RFC 6761) 이 주소가 다른 곳에서 그대로 쓰여도 바깥으로 요청이 나가지 않는다.
//   본문 표 DB 검사(https 주소·2000자)를 그대로 통과하므로 DB를 바꾸지 않는다.
// - 보기: 화면이 news-feed hand_photo(로그인·운영자 기능 키·그 기사를 읽을 수 있어야 함·그 기사 본문에 그 사진이 있어야 함)로
//   부르면, 서버가 부른 사람 작업공간의 Drive 연결로 그 파일의 줄인 그림만 돌려준다(_shared/drive-photo.ts — 노트·자료실 사진 보기와 같은 부품).
//   다른 작업공간의 Drive 파일은 그 사람 Drive 연결로는 보이지 않으므로(내 것·휴지통 아님·그림만) 보이지 않는다.
// - 올리기: 그림 종류(jpg·png·webp·gif — 파일 머리 바이트로 다시 확인)와 크기(한 장 10MB)를 서버가 검사한다. 한 기사 사진 20장은 hand_fill이 막는다.
import { createDriveUpload, UploadError, type UploadAdmin } from "../_shared/drive-upload.ts";
import { createDrivePhoto, PHOTO_SIZES, PhotoError } from "../_shared/drive-photo.ts";

export const OWN_PHOTO_HOST = "photo.web2.invalid";
export const HAND_PHOTO_FOLDER = "뉴스 사진";
// 한 장 10MB: 폰 사진(보통 2~6MB)·화면 캡처는 넉넉히 들어가고, Edge 함수 한 번에 받기 무리 없는 크기.
export const HAND_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const HAND_PHOTO_REQ_MAX = HAND_PHOTO_MAX_BYTES + 64 * 1024;
export const HAND_PHOTO_TYPES: Readonly<Record<string, string>> = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" });
const EXT_TYPE: Readonly<Record<string, string>> = Object.freeze({ jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" });
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const OWN = /^https:\/\/photo\.web2\.invalid\/([A-Za-z0-9_-]{10,200})\.(jpg|png|webp|gif)$/;

export const ownPhotoSrc = (id: string, ext: string) => `https://${OWN_PHOTO_HOST}/${id}.${ext}`;
export function ownPhotoOf(src: unknown): { id: string; type: string } | null {
  const m = typeof src === "string" ? OWN.exec(src) : null;
  return m ? { id: m[1], type: EXT_TYPE[m[2]] } : null;
}
// 파일 머리 바이트로 본 그림 종류('' = 그림 아님). 화면이 알려 준 종류와 같아야 받는다.
export function sniffImage(head: Uint8Array): string {
  const b = (i: number) => head[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return "image/png";
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return "image/gif";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "image/webp";
  return "";
}

export function photoSizeOf(v: unknown): keyof typeof PHOTO_SIZES | null {
  const s = v === undefined || v === null ? "small" : v;
  return typeof s === "string" && Object.prototype.hasOwnProperty.call(PHOTO_SIZES, s) ? s as keyof typeof PHOTO_SIZES : null;
}

export class HandPhotoFail extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
type Rest = (path: string) => Promise<unknown>;
const two = (n: number) => String(n).padStart(2, "0");

export function createHandPhotos(rest: Rest, opts: { fetch?: typeof fetch; log?: (code: string) => void } = {}) {
  // workspace-drive-token은 REST 읽기 함수도 받는다(news-feed는 supabase-js를 쓰지 않음). 여기서 쓰는 부분은 토큰·폴더·올리기·지우기뿐(관리자 쓰기 없음).
  const admin = { rest } as unknown as UploadAdmin;
  const drive = createDriveUpload(admin, opts), photo = createDrivePhoto(admin, opts);

  async function basketRoot(ws: string): Promise<string> {
    let rows: unknown;
    try { rows = await rest(`app_drive_settings?workspace_id=eq.${encodeURIComponent(ws)}&select=basket_folder_id&limit=1`); } catch { throw new HandPhotoFail(503, "DRIVE_SETTINGS_UNAVAILABLE"); }
    const id = Array.isArray(rows) ? (rows[0] as { basket_folder_id?: unknown } | undefined)?.basket_folder_id : null;
    if (typeof id !== "string" || !id) throw new HandPhotoFail(409, "DRIVE_FOLDER_MISSING");
    return id;
  }
  // 한 장 올리기 → {id, src}. 검사 먼저(종류·크기·머리 바이트), 그다음 Drive.
  async function put(ws: string, articleId: string, file: unknown, nowMs: number) {
    if (!(file instanceof File)) throw new HandPhotoFail(400, "FILE_MISSING");
    if (file.size <= 0) throw new HandPhotoFail(400, "FILE_EMPTY");
    if (file.size > HAND_PHOTO_MAX_BYTES) throw new HandPhotoFail(413, "PHOTO_TOO_LARGE");
    const said = String(file.type || "").toLowerCase(), ext = HAND_PHOTO_TYPES[said];
    if (!ext) throw new HandPhotoFail(415, "PHOTO_TYPE");
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (sniffImage(head) !== said) throw new HandPhotoFail(415, "PHOTO_TYPE");
    const d = new Date(nowMs + 9 * 3600000);
    const name = `뉴스 사진 ${articleId.slice(0, 8)} ${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}.${ext}`;
    const named = new File([file], name, { type: said });
    let token = "", id = "";
    try {
      token = await drive.driveToken(ws);
      const folder = await drive.ensurePrivateChildFolder(await basketRoot(ws), HAND_PHOTO_FOLDER, token);
      id = await drive.upload(named, folder, token);
    } catch (e) {
      if (e instanceof HandPhotoFail) throw e;
      if (e instanceof UploadError) {
        if (e.status === 424) throw new HandPhotoFail(424, "DRIVE_NOT_CONNECTED");
        if (e.code === "drive_folder_not_private" || e.code === "drive_folder_permissions_unavailable") throw new HandPhotoFail(409, "DRIVE_FOLDER_SHARED");
      }
      throw new HandPhotoFail(503, "DRIVE_UNAVAILABLE");
    }
    if (!DRIVE_ID.test(id)) {
      if (id && token) await drive.discardUploadedFile(id, token);
      throw new HandPhotoFail(503, "DRIVE_UNAVAILABLE");
    }
    return { id, src: ownPhotoSrc(id, ext) };
  }
  // 줄인 그림 한 장. blocks = 그 기사 본문 블록(부르는 쪽이 '그 사람이 읽을 수 있는 기사'를 먼저 확인). 본문에 없는 사진은 404.
  async function view(ws: string, blocks: unknown, fileId: unknown, size: keyof typeof PHOTO_SIZES): Promise<Response> {
    if (typeof fileId !== "string" || !DRIVE_ID.test(fileId)) throw new HandPhotoFail(400, "INVALID_BODY");
    const hit = (Array.isArray(blocks) ? blocks : []).map((b) => (b && typeof b === "object" && (b as { t?: unknown }).t === "img" ? ownPhotoOf((b as { src?: unknown }).src) : null))
      .find((p) => p?.id === fileId);
    if (!hit) throw new HandPhotoFail(404, "PHOTO_NOT_FOUND");
    try {
      return await photo(fileId, hit.type, size, ws);
    } catch (e) {
      if (e instanceof PhotoError) throw new HandPhotoFail(e.status, e.status === 404 ? "PHOTO_NOT_FOUND" : "PHOTO_UNAVAILABLE");
      throw new HandPhotoFail(502, "PHOTO_UNAVAILABLE");
    }
  }
  return { put, view };
}
