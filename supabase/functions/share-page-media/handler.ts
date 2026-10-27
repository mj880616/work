// share-page-media: 공유 페이지 사진 올리기·보기 주소·지우기·정리·휴지통 페이지 완전 삭제(ED-통합편집기 ②, SHARE-사진같이지우기, SHARE-페이지삭제, TRASH-다른삭제, verify_jwt=true).
// 로그인한 소유자만. 소유 확인은 화면이 보낸 값이 아니라 DB의 owner RLS가 한다(사용자 토큰으로 질의: 내 페이지가 아니면 행이 안 보인다).
// 사진 파일은 비공개 버킷에만 둔다(서버 키는 저장소 읽기·쓰기에만 쓴다). 위치 정보가 든 JPEG(EXIF·XMP)는 거절한다.

export const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;
export const SIGN_SECONDS = 600;
export const PRUNE_MAX = 100; // 한 번에 정리하는 사진 수(남은 것은 다음 정리 때)
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
  pageBlocks(token: string, pageId: string): Promise<unknown[] | null>; // owner RLS가 보이는 페이지의 저장된 블록만
  rowsForPage(token: string, pageId: string, limit: number): Promise<MediaRow[]>;
  putFile(path: string, bytes: Uint8Array): Promise<boolean>;
  removeFile(path: string): Promise<boolean>;
  signFile(path: string, seconds: number): Promise<string | null>;
  // SHARE-페이지삭제(완전 삭제): 이 페이지 폴더의 파일 이름(기록 없이 남은 파일까지).
  listFiles(folder: string): Promise<string[] | null>;
  // TRASH-다른삭제 공유 페이지: 완전 삭제는 휴지통에 있는 페이지만. trashedPage = 호출자(소유자)의 휴지통 목록에 이 페이지가 있는가(DB 함수 app_trash_list),
  // deletePage = DB 함수 app_trash_purge로 휴지통 페이지 행을 지운다(링크·사진 기록은 cascade, 지운 행 수).
  trashedPage(token: string, pageId: string): Promise<boolean>;
  deletePage(token: string, pageId: string): Promise<number>;
};
export const PURGE_ROUNDS = 5; // 한 번 부를 때 기록을 읽는 횟수(한 번 PRUNE_MAX장). 다 못 지우면 페이지를 남기고 503(다시 누르면 이어서)

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

// 저장된 블록의 글(doc) 블록 안 사진 칸 src "share:<id>"를 모두 모은다. 정리(prune)가 "쓰는 사진"을 빠뜨리면 쓰는 사진을 지우게 되므로
// 개수 제한 없이 끝까지 보고, 모양을 다 읽지 못하면(너무 깊음) null을 돌려 아무것도 지우지 않게 한다.
const MAX_DEPTH = 80;
export function usedPhotoIds(blocks: unknown): Set<string> | null {
  if (!Array.isArray(blocks)) return null;
  const found = new Set<string>();
  let ok = true;
  const walk = (node: unknown, depth: number) => {
    if (!ok || !node || typeof node !== "object") return;
    if (depth > MAX_DEPTH) { ok = false; return; }
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    const o = node as Record<string, unknown>;
    if (o.type === "image" && o.attrs && typeof o.attrs === "object") {
      const src = (o.attrs as Record<string, unknown>).src;
      if (typeof src === "string" && src.startsWith("share:") && UUID.test(src.slice(6))) found.add(src.slice(6));
    }
    if (Array.isArray(o.content)) walk(o.content, depth + 1);
    if (o.doc) walk(o.doc, depth + 1);
  };
  for (const b of blocks) if (b && typeof b === "object" && (b as Record<string, unknown>).type === "doc") walk((b as Record<string, unknown>).doc, 0);
  return ok ? found : null;
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
        // 파일 먼저, 기록은 그다음. 파일을 못 지우면 기록이 남아 다음 정리(prune) 때 다시 지운다(기록 없는 파일이 남지 않게).
        if (!(await deps.removeFile(row.storage_path))) return reply({ error: "unavailable" }, 503);
        if (!(await deps.deleteRow(token, id))) return reply({ error: "unavailable" }, 503);
        return reply({ ok: true }, 200);
      }

      // SHARE-사진같이지우기: 이 페이지의 저장된 글에서 더는 쓰지 않는 사진의 파일과 기록을 지운다.
      // 무엇을 쓰는지는 화면이 아니라 DB에 저장된 블록으로 정한다. keep은 아직 저장 안 한 편집 화면에 남아 있는 사진 id(지울 대상에서 빼기만 함).
      if (body.action === "prune") {
        const pageId = String(body.page_id || "");
        const keep = Array.isArray(body.keep) ? body.keep.map(String) : [];
        if (!UUID.test(pageId) || keep.length > 200 || !keep.every((x) => UUID.test(x))) return reply({ error: "bad_request" }, 400);
        const blocks = await deps.pageBlocks(token, pageId);
        if (blocks === null) return reply({ error: "not_found" }, 404);
        const used = usedPhotoIds(blocks);
        if (!used) return reply({ error: "unreadable" }, 409);
        for (const id of keep) used.add(id);
        let removed = 0, failed = 0;
        for (const row of await deps.rowsForPage(token, pageId, PRUNE_MAX)) {
          if (row.page_id !== pageId || used.has(row.id)) continue;
          // 파일 먼저 지우고 기록을 지운다. 어느 쪽이든 실패하면 기록이 남아 다음 정리 때 다시 시도한다.
          if (await deps.removeFile(row.storage_path) && await deps.deleteRow(token, row.id)) removed++;
          else failed++;
        }
        if (failed) log("share_page_media_prune_left");
        return reply({ ok: true, removed, failed }, 200);
      }
      // SHARE-페이지삭제 + TRASH-다른삭제: 휴지통에 있는 페이지 하나를 되살릴 수 없게 지운다. 사진 파일(비공개 버킷) → 페이지 행(링크·사진 기록은 DB cascade) 순서.
      // 휴지통에 없는 페이지(살아 있는 페이지·남의 페이지)는 404이고 아무것도 지우지 않는다: 삭제는 먼저 휴지통으로 가고, 영구 삭제는 휴지통에서만 한다.
      // 소유 확인은 사용자 토큰 + DB 함수(소유자의 휴지통 목록). 서버 키는 이 페이지 폴더(page_id/)의 파일 지우기에만 쓴다.
      // 파일을 하나라도 못 지우면 페이지·기록을 그대로 두고 503: 다시 부르면 남은 것부터 이어서 지운다(따로 "삭제 대기" 칸 없음).
      if (body.action === "purge_page") {
        const pageId = String(body.page_id || "");
        if (!UUID.test(pageId)) return reply({ error: "bad_request" }, 400);
        if (!(await deps.trashedPage(token, pageId))) return reply({ error: "not_found" }, 404);
        const folder = `${pageId}/`;
        let failed = 0, removed = 0, rest = false;
        for (let round = 0; round < PURGE_ROUNDS; round++) {
          const rows = (await deps.rowsForPage(token, pageId, PRUNE_MAX)).filter((r) => r.page_id === pageId && r.storage_path.startsWith(folder));
          if (!rows.length) break;
          for (const row of rows) {
            if (await deps.removeFile(row.storage_path) && await deps.deleteRow(token, row.id)) removed++;
            else failed++;
          }
          if (failed) break;
          if (round === PURGE_ROUNDS - 1) rest = true;
        }
        if (failed || rest) { log("share_page_media_purge_left"); return reply({ error: "unavailable", removed, failed }, 503); }
        // 기록 없이 남은 파일(올리다 끊긴 것)도 이 폴더에서 지운다. 이름은 버킷이 준 것 중 사진 모양만.
        // 지운 뒤 다시 읽어 폴더가 빌 때까지(최대 PURGE_ROUNDS번). 끝까지 비지 않으면 false(페이지를 남겨 다음에 이어서).
        const sweep = async () => {
          for (let round = 0; round < PURGE_ROUNDS; round++) {
            const names = await deps.listFiles(pageId);
            if (names === null) return false;
            const photos = names.filter((name) => /^[0-9a-f-]{36}\.jpg$/.test(name));
            if (!photos.length) return true;
            for (const name of photos) if (!(await deps.removeFile(folder + name))) return false;
          }
          return false;
        };
        if (!(await sweep())) { log("share_page_media_purge_left"); return reply({ error: "unavailable", removed, failed: 1 }, 503); }
        const gone = await deps.deletePage(token, pageId);
        if (gone !== 1) return reply({ error: "not_found" }, 404);
        // 지우는 사이 올라온 사진이 있으면 한 번 더 비운다(페이지가 없어져 그 뒤 올리기는 기록에서 거절되고 파일도 지워진다).
        if (!(await sweep())) log("share_page_media_purge_left");
        return reply({ ok: true, removed }, 200);
      }
      return reply({ error: "bad_request" }, 400);
    } catch {
      log("share_page_media_unavailable");
      return reply({ error: "unavailable" }, 503);
    }
  };
}
