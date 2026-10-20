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
};

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
      return reply({ ok: true, page: { title: page.title, blocks: page.blocks } }, 200);
    } catch {
      log("share_page_read_unavailable");
      return reply({ error: "unavailable" }, 503);
    }
  };
}
