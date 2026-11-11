// note-import가 읽은 글을 노트용 결과로 다듬는 순수 함수(네트워크·DB 없음).
// 본문 뽑기는 뉴스와 같은 부품(news-feed/page.ts readArticlePage → _shared/feed-extract.ts)을 그대로 부른다. 여기서는 그 부품에 없는 세 가지만 한다:
// 받는 형식 검사(글자 판만), 저자 읽기, 노트 글자 상한으로 자르기(사진 블록은 1단계에서 뺀다 — 명진 결정 2026-11-11).
import { cut, oneLine } from "../outside-feed/parse.ts";
import { decodeText } from "../_shared/html-entities.ts";
import type { Block } from "../_shared/feed-extract.ts";

// 노트 본문 상한(app_notes.raw_text 20000자, app/basket-data.js와 같음). 화면이 블록을 노트 글로 바꿀 때 붙는
// 줄바꿈·소제목·인용 표시 몫으로 블록마다 NOTE_BLOCK_OVERHEAD자를 미리 셈한다(바꾼 글이 상한을 넘지 않게).
export const NOTE_BODY_MAX_CHARS = 20000;
export const NOTE_BLOCK_OVERHEAD = 6;
export const AUTHOR_MAX_CHARS = 120;
const LD_MAX_CHARS = 200000;
const LD_MAX_SCRIPTS = 12;

const len = (s: string) => [...s].length;

// 받는 형식: 글자 판만(html·xhtml·text). 형식 표시가 없으면 받지 않는다(추측하지 않음).
export type TextKind = "html" | "plain";
export function textKind(contentType: string | null | undefined): TextKind | null {
  if (typeof contentType !== "string") return null;
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type === "text/plain") return "plain";
  return null;
}

// ---- 저자 ----------------------------------------------------------------------------------------------------------
// 이름 한 줄로 다듬기. 주소·전자우편·꾸밈 글(꺾쇠)이 든 값은 이름이 아닌 것으로 본다.
function authorName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = cut(oneLine(decodeText(v)), AUTHOR_MAX_CHARS);
  if (!t || /^https?:\/\//i.test(t) || /[<>{}]/.test(t) || /\S+@\S+\.\S+/.test(t)) return null;
  return t;
}
// 구조화 데이터(JSON-LD)의 author: 글자 · {name} · 그 목록(세 명까지 쉼표로).
function authorOf(v: unknown): string | null {
  if (typeof v === "string") return authorName(v);
  if (Array.isArray(v)) {
    const names: string[] = [];
    for (const one of v.slice(0, 10)) {
      const n = authorOf(one);
      if (n && !names.includes(n)) names.push(n);
      if (names.length >= 3) break;
    }
    return names.length ? authorName(names.join(", ")) : null;
  }
  if (v && typeof v === "object") return authorName((v as Record<string, unknown>).name);
  return null;
}
function ldAuthor(v: unknown, depth: number): string | null {
  if (!v || typeof v !== "object" || depth > 4) return null;
  if (Array.isArray(v)) {
    for (const one of v.slice(0, 50)) { const n = ldAuthor(one, depth + 1); if (n) return n; }
    return null;
  }
  const o = v as Record<string, unknown>;
  if ("author" in o) { const n = authorOf(o.author); if (n) return n; }
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage"]) {
    if (k in o) { const n = ldAuthor(o[k], depth + 1); if (n) return n; }
  }
  return null;
}
function metaContent(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(`<meta\\b[^>]*(?:property|name|itemprop)\\s*=\\s*["']${k.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = re.exec(html)?.[0];
    if (!tag) continue;
    const v = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    const t = authorName(v ?? null);
    if (t) return t;
  }
  return null;
}
// 저자: 구조화 데이터(JSON-LD author) → 메타(author 등). 못 읽으면 null(칸을 비움).
export function readAuthor(html: string): string | null {
  if (typeof html !== "string") return null;
  const scripts = html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi);
  let seen = 0;
  for (const m of scripts) {
    if (++seen > LD_MAX_SCRIPTS) break;
    if (m[1].length > LD_MAX_CHARS) continue;
    let v: unknown;
    try { v = JSON.parse(m[1]); } catch { continue; }
    const n = ldAuthor(v, 0);
    if (n) return n;
  }
  return metaContent(html, ["author", "article:author", "dable:author", "parsely-author", "sailthru.author", "byl"]);
}

// ---- 노트용 본문 ----------------------------------------------------------------------------------------------------
export type NoteBlock = { t: "p" | "h" | "quote"; text: string };
export type NoteBody = { blocks: NoteBlock[]; chars: number; truncated: boolean };
// 글자 블록만 남기고(사진 제외) 노트 글자 상한 안으로 자른다. chars는 남긴 블록 글자 수의 합.
export function noteBody(blocks: readonly Block[], max = NOTE_BODY_MAX_CHARS): NoteBody {
  const out: NoteBlock[] = [];
  let used = 0, chars = 0, truncated = false;
  for (const b of blocks) {
    if (b.t !== "p" && b.t !== "h" && b.t !== "quote") continue;
    if (typeof b.text !== "string" || !b.text) continue;
    const room = max - used - NOTE_BLOCK_OVERHEAD;
    if (room <= 0) { truncated = true; break; }
    const text = cut(b.text, room);
    if (len(text) < len(b.text)) truncated = true;
    out.push({ t: b.t, text });
    chars += len(text);
    used += len(text) + NOTE_BLOCK_OVERHEAD;
    if (truncated) break;
  }
  return { blocks: out, chars, truncated };
}
