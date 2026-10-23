// share-page-read: 로그인 없이 링크 값 하나로 공유 페이지 하나만 읽는다(SHARE-현장공유, verify_jwt=false).
// 링크 값 → sha256 → 링크 행(꺼짐 아님·기한 안 지남) → 게시된 페이지의 제목·블록만 반환.
// 그 밖의 모든 경우는 같은 모양의 404. owner·workspace·내부 id·링크 원문은 응답에 넣지 않는다.

export type ShareLinkRow = {
  page_id: string;
  token_hash: string;
  expires_at: string | null;
  disabled_at: string | null;
};
export type SharePageRow = {
  id: string;
  title: string;
  blocks: unknown;
  status: string;
};
// 서버 키로 읽는 범위를 두 질의로 고정한다(링크는 지문으로, 페이지는 그 링크의 page_id로).
export type ShareReader = {
  linkByHash(hash: string): Promise<ShareLinkRow | null>;
  pageById(id: string): Promise<SharePageRow | null>;
  // ED-통합편집기 ②: 이 페이지 소속으로 기록된 사진만(page_id로 거른다). 주소는 짧게(SIGN_SECONDS) 발급한다.
  mediaForPage?(pageId: string, ids: string[]): Promise<{ id: string; storage_path: string }[]>;
  signMedia?(path: string, seconds: number): Promise<string | null>;
};
export const SIGN_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_MEDIA = 60;

// 글 블록(doc) 안 사진 칸의 src "share:<id>"를 모은다(중복 없이, 60개까지). 모양이 달라도 오류 없이 건너뛴다.
export function sharePhotoIds(blocks: unknown[]): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 40 || found.size >= MAX_MEDIA) return;
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
  return [...found];
}

export const ALLOWED_ORIGINS = new Set(["https://work.bokdoong.com"]);
export const MAX_BODY_BYTES = 1024;
const TOKEN = /^[0-9a-f]{64}$/;
const HASH = /^[0-9a-f]{64}$/;

const baseHeaders: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Origin",
};

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function tokenHash(token: string): Promise<string> {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(token.slice(i * 2, i * 2 + 2), 16);
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

// 길이가 같은 두 16진수 문자열을 끝까지 비교한다(조기 종료 없음).
export function sameHash(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(req: Request): Promise<string | null> {
  const declared = req.headers.get("Content-Length");
  if (declared !== null && !(/^\d{1,7}$/.test(declared) && Number(declared) <= MAX_BODY_BYTES)) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    return null;
  }
}

export function createShareReadHandler(
  reader: ShareReader,
  options: { now?: () => number; log?: (code: string) => void } = {},
) {
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((code: string) => console.error(code));
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin");
    const headers: Record<string, string> = { ...baseHeaders };
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "content-type, apikey, x-client-info";
      headers["Access-Control-Max-Age"] = "600";
    }
    const reply = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers });
    const notFound = () => reply({ error: "not_found" }, 404);

    // 허용 밖 Origin의 preflight에는 허용 머리를 주지 않는다(브라우저가 막음). 배포 검사용으로 상태는 204.
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ error: "origin" }, 403);
    if (req.method !== "POST") return reply({ error: "method" }, 405);
    const type = (req.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return reply({ error: "bad_request" }, 400);

    const text = await readBody(req);
    if (text === null) return reply({ error: "bad_request" }, 400);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return reply({ error: "bad_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1 || !Object.hasOwn(body, "token")) {
      return reply({ error: "bad_request" }, 400);
    }
    const token = (body as { token: unknown }).token;
    if (typeof token !== "string" || !TOKEN.test(token)) return notFound();

    try {
      const hash = await tokenHash(token);
      const link = await reader.linkByHash(hash);
      if (!link || !HASH.test(String(link.token_hash)) || !sameHash(link.token_hash, hash)) return notFound();
      if (link.disabled_at !== null) return notFound();
      if (link.expires_at !== null) {
        const until = Date.parse(link.expires_at);
        if (!Number.isFinite(until) || until <= now()) return notFound();
      }
      const page = await reader.pageById(link.page_id);
      if (!page || page.id !== link.page_id || page.status !== "published") return notFound();
      if (typeof page.title !== "string" || !Array.isArray(page.blocks)) return notFound();
      // 사진 주소: 링크가 살아 있고 게시된 페이지일 때만, 그 페이지 소속으로 기록된 사진에만 만든다. 사진 쪽 문제는 글 읽기를 막지 않는다.
      const media: Record<string, string> = {};
      const ids = reader.mediaForPage && reader.signMedia ? sharePhotoIds(page.blocks) : [];
      if (ids.length) {
        try {
          for (const row of await reader.mediaForPage!(link.page_id, ids)) {
            const url = await reader.signMedia!(row.storage_path, SIGN_SECONDS);
            if (url) media[row.id] = url;
          }
        } catch { log("share_page_media_unavailable"); }
      }
      return reply({ ok: true, page: { title: page.title, blocks: page.blocks }, ...(ids.length ? { media } : {}) }, 200);
    } catch {
      log("share_page_read_unavailable");
      return reply({ error: "unavailable" }, 503);
    }
  };
}
