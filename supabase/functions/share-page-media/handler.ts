// share-page-media: 공유 페이지 사진 올리기·보기 주소·지우기(ED-통합편집기 ②, verify_jwt=true).
// 로그인한 소유자만. 소유 확인은 화면이 보낸 값이 아니라 DB의 owner RLS가 한다(사용자 토큰으로 질의: 내 페이지가 아니면 행이 안 보인다).
// 사진 파일은 비공개 버킷에만 둔다(서버 키는 저장소 읽기·쓰기에만 쓴다). 위치 정보가 든 JPEG(EXIF·XMP)는 거절한다.

export const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;
export const SIGN_SECONDS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type MediaRow = { id: string; page_id: string; storage_path: string };
// 모든 접근을 이 틈새로 고정한다. 아래 token은 호출자의 로그인 토큰이다.
export type MediaDeps = {
  userId(token: string): Promise<string | null>;
  pageWorkspace(token: string, pageId: string): Promise<string | null>; // owner RLS가 보이는 페이지만
  insertRow(token: string, row: Record<string, unknown>): Promise<boolean>;
  rowsFor(token: string, pageId: string, ids: string[]): Promise<MediaRow[]>;
  rowById(token: string, id: string): Promise<MediaRow | null>;
  deleteRow(token: string, id: string): Promise<boolean>;
  putFile(path: string, bytes: Uint8Array): Promise<boolean>;
  removeFile(path: string): Promise<boolean>;
  signFile(path: string, seconds: number): Promise<string | null>;
};

const headers: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "600",
};

export type JpegInfo = { width: number; height: number };
// JPEG를 머리 구간만 훑어 확인한다: 시작 표시, 크기, 그림 크기(SOF). APP1(EXIF·XMP)·APP13(IPTC)가 있으면 null(거절).
// 화면이 canvas로 다시 그린 사진에는 이런 구간이 없다. 있다면 화면이 원본을 그대로 보낸 것이다.
export function inspectJpeg(b: Uint8Array): JpegInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  let size: JpegInfo | null = null;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; }
    if (m === 0xd9) return null; // 그림 없이 끝
    if (m === 0xda) return size; // 압축 데이터 시작: 머리 구간 끝
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    if (m === 0xe1 || m === 0xed) return null;
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 8) return null;
      size = { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

export function createShareMediaHandler(deps: MediaDeps, options: { newId?: () => string; log?: (code: string) => void } = {}) {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const log = options.log ?? ((code: string) => console.error(code));
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") return reply({ error: "method" }, 405);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "login" }, 401);
    const declared = req.headers.get("Content-Length");
    if (declared !== null && !(/^\d{1,9}$/.test(declared) && Number(declared) <= MAX_BODY_BYTES)) return reply({ error: "too_large" }, 413);
    try {
      if (!(await deps.userId(token))) return reply({ error: "login" }, 401);
      const type = (req.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();

      if (type === "multipart/form-data") {
        const form = await req.formData();
        const pageId = String(form.get("page_id") || "");
        const file = form.get("image");
        if (!UUID.test(pageId) || !(file instanceof File)) return reply({ error: "bad_request" }, 400);
        if (file.size > MAX_BYTES) return reply({ error: "too_large" }, 413);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = inspectJpeg(bytes);
        if (!info || info.width < 1 || info.height < 1 || info.width > 8000 || info.height > 8000) return reply({ error: "bad_image" }, 422);
        const workspace = await deps.pageWorkspace(token, pageId);
        if (!workspace) return reply({ error: "not_found" }, 404);
        const id = newId();
        const path = `${pageId}/${id}.jpg`;
        if (!(await deps.putFile(path, bytes))) return reply({ error: "unavailable" }, 503);
        const saved = await deps.insertRow(token, { id, workspace_id: workspace, page_id: pageId, storage_path: path, width: info.width, height: info.height, bytes: bytes.length });
        if (!saved) { await deps.removeFile(path); return reply({ error: "unavailable" }, 503); }
        return reply({ ok: true, id, src: `share:${id}`, width: info.width, height: info.height }, 200);
      }

      if (type !== "application/json") return reply({ error: "bad_request" }, 400);
      let body: Record<string, unknown>;
      try { body = JSON.parse(await req.text()); } catch { return reply({ error: "bad_request" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "bad_request" }, 400);

      if (body.action === "sign") {
        const pageId = String(body.page_id || "");
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
        if (!UUID.test(pageId) || ids.length > 60 || !ids.every((x) => UUID.test(x))) return reply({ error: "bad_request" }, 400);
        const urls: Record<string, string> = {};
        for (const row of await deps.rowsFor(token, pageId, ids)) {
          const url = await deps.signFile(row.storage_path, SIGN_SECONDS);
          if (url) urls[row.id] = url;
        }
        return reply({ ok: true, urls }, 200);
      }

      if (body.action === "delete") {
        const id = String(body.id || "");
        if (!UUID.test(id)) return reply({ error: "bad_request" }, 400);
        const row = await deps.rowById(token, id);
        if (!row) return reply({ error: "not_found" }, 404);
        if (!(await deps.deleteRow(token, id))) return reply({ error: "unavailable" }, 503);
        await deps.removeFile(row.storage_path);
        return reply({ ok: true }, 200);
      }
      return reply({ error: "bad_request" }, 400);
    } catch {
      log("share_page_media_unavailable");
      return reply({ error: "unavailable" }, 503);
    }
  };
}
