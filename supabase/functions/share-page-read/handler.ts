// share-page-read: 로그인 없이 링크 값 하나로 공유 페이지 하나만 읽는다(SHARE-현장공유, verify_jwt=false).
// 링크 값 → sha256 → 링크 행(꺼짐 아님·기한 안 지남) → 게시된 페이지의 제목·블록만 반환.
// 그 밖의 모든 경우는 같은 모양의 404. owner·workspace·내부 id·링크 원문은 응답에 넣지 않는다.
// SHARE-보관함·HTML공유(docs/design/share-html-pages.md): 링크 값 대신 짧은 주소 {slug}(이름-무작위 8글자)도 받는다.
// 짧은 주소 → sha256 → 짧은 주소 행의 링크 지문 → 위와 같은 링크 확인(같은 링크라 끄기·기한이 같이 걸림).
// HTML 파일 판이 있는 페이지는 가장 최근 판 하나를 {kind:'html', title, html}로 돌려준다(블록 대신).
// head:true면 제목만 돌려준다(Worker의 링크 미리보기 제목용, 5MB HTML을 보내지 않음).

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
  // SHARE-보관함·HTML공유: 짧은 주소 지문 → 그 짧은 주소가 붙은 링크의 지문. 페이지의 가장 최근 HTML 판(없으면 null).
  slugByHash?(hash: string): Promise<{ token_hash: string; slug_hash: string } | null>;
  latestHtml?(pageId: string): Promise<string | null>;
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
// 이름(소문자·숫자·하이픈 2~40자) + "-" + DB가 만든 8글자(l·o·0·1 뺀 32글자). DB 검사(app_share_page_slugs)와 같은 모양.
const SLUG_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_CODE = /^-[a-km-np-z2-9]{8}$/;
export function slugOk(value: string): boolean {
  if (value.length < 11 || value.length > 49) return false;
  const name = value.slice(0, -9);
  return name.length >= 2 && SLUG_NAME.test(name) && SLUG_CODE.test(value.slice(-9));
}
export const MAX_HTML_BYTES = 5242880;

export async function slugHash(slug: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(slug)));
}

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
    // 받는 모양: {token} 또는 {slug}, 그리고 선택으로 head:true. 그 밖의 키·값은 모두 400.
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ error: "bad_request" }, 400);
    const keys = Object.keys(body);
    const o = body as Record<string, unknown>;
    const head = Object.hasOwn(o, "head");
    if (head && o.head !== true) return reply({ error: "bad_request" }, 400);
    const byToken = Object.hasOwn(o, "token"), bySlug = Object.hasOwn(o, "slug");
    if (byToken === bySlug || keys.length !== (head ? 2 : 1)) return reply({ error: "bad_request" }, 400);
    if (bySlug && !reader.slugByHash) return reply({ error: "bad_request" }, 400);
    const value = byToken ? o.token : o.slug;
    if (typeof value !== "string" || !(byToken ? TOKEN.test(value) : slugOk(value))) return notFound();

    try {
      let hash: string;
      if (byToken) hash = await tokenHash(value);
      else {
        const wanted = await slugHash(value);
        const short = await reader.slugByHash!(wanted);
        if (!short || !HASH.test(String(short.slug_hash)) || !sameHash(short.slug_hash, wanted)
            || !HASH.test(String(short.token_hash))) return notFound();
        hash = short.token_hash;
      }
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
      if (head) return reply({ ok: true, page: { title: page.title } }, 200);
      // HTML 판: 있으면 그 판만(블록·사진 없음). 판 질의가 실패하면 블록이 있는 페이지는 블록을 그대로 보여 준다
      // (새 표 적용 전 배포·일시 오류에도 기존 링크가 열리게). 블록도 없으면 503.
      if (reader.latestHtml) {
        let html: string | null = null;
        try { html = await reader.latestHtml(link.page_id); }
        catch {
          log("share_page_html_unavailable");
          if (!page.blocks.length) return reply({ error: "unavailable" }, 503);
        }
        if (html !== null) {
          if (typeof html !== "string" || !html.length || html.length > MAX_HTML_BYTES) return notFound();
          return reply({ ok: true, page: { kind: "html", title: page.title, html } }, 200);
        }
      }
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
