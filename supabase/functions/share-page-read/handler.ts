// share-page-read: 로그인 없이 링크 값 하나로 공유 페이지 하나만 읽는다(SHARE-현장공유, verify_jwt=false).
// 링크 값 → sha256 → 링크 행(꺼짐 아님·기한 안 지남) → 게시된 페이지의 제목·블록만 반환.
// 그 밖의 모든 경우는 같은 모양의 404. owner·workspace·내부 id·링크 원문은 응답에 넣지 않는다.
// SHARE-보관함·HTML공유(docs/design/share-html-pages.md): 링크 값 대신 짧은 주소 {slug}(이름-무작위 8글자)도 받는다.
// 짧은 주소 → sha256 → 짧은 주소 행의 링크 지문 → 위와 같은 링크 확인(같은 링크라 끄기·기한이 같이 걸림).
// HTML 파일 판이 있는 페이지는 가장 최근 판 하나를 {kind:'html', title, html}로 돌려준다(블록 대신).
// NOTE-게시(docs/design/note-publish.md): 노트를 게시한 페이지(app_note_share_pages 짝)는 그 노트의 지금 제목·글을 글 블록 하나로 돌려준다.
// head:true면 제목만 돌려준다(Worker의 링크 미리보기 제목용, 5MB HTML을 보내지 않음).
// BLOG ①(docs/design/blog.md 4절): {blog:…} 모양은 블로그 길(./blog.ts)로 간다. 링크 길 코드는 그대로다.
import { type BlogReader, parseBlogRequest, readBlog } from "./blog.ts";

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
  // NOTE-게시: 페이지 id → 짝 표(app_note_share_pages)의 note_id(짝 없음 = null 행 없음, 노트를 완전히 지웠으면 note_id null).
  // 노트 id → 그 노트의 보여 줄 칸만(제목·글·종류·휴지통·보관). 작업공간·첨부·메타는 읽지 않는다.
  noteForPage?(pageId: string): Promise<NotePairRow | null>;
  noteById?(id: string): Promise<NoteRow | null>;
  // BLOG ①: 블로그 길 질의(없으면 블로그 요청은 모두 404).
  blog?: BlogReader;
};
export type NotePairRow = { note_id: string | null };
export type NoteRow = {
  id: string;
  kind: string;
  title: string | null;
  raw_text: string | null;
  doc: unknown;
  deleted_at: string | null;
  archived_at: string | null;
};
const MAX_NOTE_DEPTH = 40;

// 게시할 수 있는 노트: 짝이 가리킨 그 노트이고, kind 'note'이며 휴지통·보관이 아니다.
export function noteShowable(note: NoteRow | null, id: string): boolean {
  return !!note && note.id === id && note.kind === "note" && note.deleted_at === null && note.archived_at === null;
}
export function noteTitle(note: NoteRow, fallback: string): string {
  const t = typeof note.title === "string" ? note.title.trim() : "";
  return t ? [...t].slice(0, 200).join("") : fallback;
}
// 노트 글 → 공유 페이지 글 블록 하나({type:'doc', doc:{v:'ed1', doc}}). 서식이 없는 옛 노트는 줄마다 문단 하나.
// 사진 칸: 주소·번호(drive:<id> 등)는 지운다. NOTE-게시 ③: 주인이 게시하며 짝 페이지 사진으로 올려 둔 사진(photos: 노트 src → 짝 페이지 사진 id)만
// src "share:<id>"로 바꿔 넣는다(주소는 아래에서 그 페이지 소속 기록만 짧게 서명). 그 밖의 사진은 자리만 남는다.
// 파일 칸(노트 첨부): 이름·크기만 남기고 src(Drive 파일 번호)는 지운다 — 첨부 파일은 공개하지 않는다.
export function noteBlocks(note: NoteRow, photos: Map<string, string> = new Map()): unknown[] {
  const strip = (node: unknown, depth: number): unknown => {
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > MAX_NOTE_DEPTH) return null;
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "content") {
        if (Array.isArray(v)) out.content = v.map((n) => strip(n, depth + 1)).filter((n) => n !== null);
      } else if (k === "attrs" && o.type === "image") {
        const a = v && typeof v === "object" ? v as Record<string, unknown> : {};
        const attrs: Record<string, unknown> = {};
        const shared = typeof a.src === "string" ? photos.get(a.src) : undefined;
        if (shared && UUID.test(shared)) attrs.src = `share:${shared}`;
        if (typeof a.alt === "string") attrs.alt = [...a.alt].slice(0, 200).join("");
        out.attrs = attrs;
      } else if (k === "attrs" && o.type === "file") {
        const a = v && typeof v === "object" ? v as Record<string, unknown> : {};
        const attrs: Record<string, unknown> = {};
        if (typeof a.name === "string") attrs.name = [...a.name].slice(0, 200).join("");
        if (typeof a.size === "number") attrs.size = a.size;
        out.attrs = attrs;
      } else out[k] = v;
    }
    return out;
  };
  const d = note.doc && typeof note.doc === "object" ? note.doc as Record<string, unknown> : null;
  const inner = d && d.v === "ed1" && d.doc && typeof d.doc === "object" ? d.doc as Record<string, unknown> : null;
  if (inner && Array.isArray(inner.content)) {
    const doc = strip({ ...inner, type: "doc" }, 0);
    if (doc) return [{ type: "doc", doc: { v: "ed1", doc } }];
  }
  const lines = String(note.raw_text ?? "").split(/\r?\n/);
  const content = lines.map((line) => line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" });
  return [{ type: "doc", doc: { v: "ed1", doc: { type: "doc", content } } }];
}

// NOTE-게시 ③ 사진 거울: 노트를 게시한 짝 페이지의 블록은 비어 있거나, 주인 화면이 올린 사진 줄 하나뿐인 글 블록이다
// ([{type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[{type:'image', attrs:{src:'share:<id>', key:'<64자>'}}…]}}}]).
// key = sha256("<페이지 id>:<노트 사진 src>") — Drive 파일 번호는 짝 페이지에도 남기지 않는다(app/note-publish-model.mjs photoKey와 같은 셈).
const KEY = /^[0-9a-f]{64}$/;
const DRIVE_SRC = /^drive:[A-Za-z0-9_-]{1,200}$/;
export function noteMirror(blocks: unknown): Map<string, string> | null {
  if (!Array.isArray(blocks)) return null;
  if (!blocks.length) return new Map();
  if (blocks.length !== 1) return null;
  const b = blocks[0] as Record<string, unknown> | null;
  const d = b && b.type === "doc" && b.doc && typeof b.doc === "object" ? b.doc as Record<string, unknown> : null;
  const inner = d && d.v === "ed1" && d.doc && typeof d.doc === "object" ? d.doc as Record<string, unknown> : null;
  if (!inner || !Array.isArray(inner.content) || !inner.content.length || inner.content.length > MAX_MEDIA) return null;
  const out = new Map<string, string>();
  for (const n of inner.content) {
    const o = n && typeof n === "object" ? n as Record<string, unknown> : null;
    const a = o && o.type === "image" && o.attrs && typeof o.attrs === "object" ? o.attrs as Record<string, unknown> : null;
    if (!a || typeof a.key !== "string" || !KEY.test(a.key) || typeof a.src !== "string" || !a.src.startsWith("share:") || !UUID.test(a.src.slice(6))) return null;
    out.set(a.key, a.src.slice(6));
  }
  return out;
}
export async function photoKey(pageId: string, src: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pageId}:${src}`)));
}
// 노트 글 안 사진 칸의 drive: src(중복 없이, 60개까지).
export function noteDriveSrcs(note: NoteRow): string[] {
  const found = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > MAX_NOTE_DEPTH || found.size >= MAX_MEDIA) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    const o = node as Record<string, unknown>;
    if (o.type === "image" && o.attrs && typeof o.attrs === "object") {
      const src = (o.attrs as Record<string, unknown>).src;
      if (typeof src === "string" && DRIVE_SRC.test(src)) found.add(src);
    }
    if (Array.isArray(o.content)) walk(o.content, depth + 1);
  };
  const d = note.doc && typeof note.doc === "object" ? note.doc as Record<string, unknown> : null;
  if (d && d.v === "ed1") walk(d.doc, 0);
  return [...found];
}
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

// BLOG ①: 명진 블로그 화면(bokdoong.com, docs/design/blog.md 5절) 정확히 하나를 더한다.
export const ALLOWED_ORIGINS = new Set(["https://work.bokdoong.com", "https://bokdoong.com"]);
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
    // BLOG ①: 블로그 모양은 링크 길과 섞이지 않는다. 모양이 틀린 블로그 요청도 같은 404.
    if (Object.hasOwn(o, "blog")) {
      const want = parseBlogRequest(o);
      if (!want || !reader.blog) return notFound();
      try {
        const result = await readBlog(reader.blog, want, { ids: sharePhotoIds, seconds: SIGN_SECONDS, log });
        return result.status === 200 ? reply(result.body, 200) : notFound();
      } catch {
        log("blog_read_unavailable");
        return reply({ error: "unavailable" }, 503);
      }
    }
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
      // NOTE-게시: 노트를 게시한 페이지면(짝 표에 그 페이지 줄이 있으면) 그 노트의 지금 제목·글만 보여 준다(HTML·사진·첨부 없음).
      // 짝 질의가 실패하면(새 표 적용 전 배포·일시 오류) 블록이 있는 옛 페이지는 그대로 보여 주고, 블록이 없으면 503.
      if (reader.noteForPage && reader.noteById) {
        let pair: NotePairRow | null = null, unavailable = false;
        try { pair = await reader.noteForPage(link.page_id); }
        catch { log("share_page_note_unavailable"); unavailable = true; }
        // 노트 짝 페이지의 사진 거울(위 noteMirror)은 짝을 못 읽으면 그대로 보이지 않게 503(사진만 있는 글이 따로 보이지 않게).
        const mirror = noteMirror(page.blocks);
        if (unavailable && (!page.blocks.length || (mirror && mirror.size))) return reply({ error: "unavailable" }, 503);
        if (pair) {
          if (typeof pair.note_id !== "string" || !UUID.test(pair.note_id)) return notFound();
          const note = await reader.noteById(pair.note_id);
          if (!noteShowable(note, pair.note_id)) return notFound();
          const title = noteTitle(note!, page.title);
          if (head) return reply({ ok: true, page: { title } }, 200);
          // NOTE-게시 ③: 거울에 있는 사진만 이 페이지 소속 사진 기록으로 짧게 서명한다. 사진 쪽 문제는 글 읽기를 막지 않는다(자리만 남음).
          const photos = new Map<string, string>(), media: Record<string, string> = {};
          if (mirror && mirror.size && reader.mediaForPage && reader.signMedia) {
            try {
              const wanted = new Map<string, string>();
              for (const src of noteDriveSrcs(note!)) {
                const id = mirror.get(await photoKey(link.page_id, src));
                if (id) wanted.set(src, id);
              }
              const ids = [...new Set(wanted.values())];
              const signed = new Map<string, string>();
              if (ids.length) {
                for (const row of await reader.mediaForPage(link.page_id, ids)) {
                  if (!ids.includes(row.id)) continue;
                  const url = await reader.signMedia(row.storage_path, SIGN_SECONDS);
                  if (url) signed.set(row.id, url);
                }
              }
              for (const [src, id] of wanted) if (signed.has(id)) { photos.set(src, id); media[id] = signed.get(id)!; }
            } catch { log("share_page_media_unavailable"); photos.clear(); for (const k of Object.keys(media)) delete media[k]; }
          }
          return reply({ ok: true, page: { title, blocks: noteBlocks(note!, photos) }, ...(photos.size ? { media } : {}) }, 200);
        }
        // 짝이 없어진 노트 짝 페이지(예: 휴지통에서 되살린 옛 짝 페이지)의 사진 거울은 보여 주지 않는다.
        if (mirror && mirror.size) return notFound();
      }
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
