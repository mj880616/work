// S69 READ-첨부본문(사용자 11/24): 기관·정부 게시판 글은 페이지에 그림·짧은 글뿐이고 본문은 첨부 파일(PDF·HWP·HWPX)에 있다.
// 페이지 본문이 짧을 때(news-feed/attach.ts withAttachment) 그 페이지의 첨부 파일 링크를 찾아 글자를 읽는 한 곳.
// - 링크 찾기(attachmentLinks): <a>의 주소 끝이 .pdf·.hwp·.hwpx이거나, 주소가 내려받기 입구여도 링크 글자·title·download에
//   그런 파일 이름이 보이는 것만. javascript:·mailto:·#은 버린다. 읽는 쪽(부르는 함수의 공용 읽기)이 주소 규칙·이름 풀이 확인을 다시 한다.
// - 읽기(readAttachment): 부르는 쪽 공용 읽기의 getBytes(GET만, 쿠키 없음, 크기 상한 ATTACH_MAX_BYTES)로 받아
//   파일 머리 바이트로 종류를 정한다(%PDF- = PDF · D0CF11E0 = HWP · PK = HWPX). 글자 읽기는 기존·자체 부품만:
//   HWP·HWPX = _shared/hwp-text.mjs(자료실 글자 읽기와 같은 것), PDF = _shared/pdf-text.mjs. 외부 서비스·AI·Drive 없음.
// - 한 번에 ATTACH_TRIES개까지만 시도하고, 글자가 ATTACH_TEXT_MIN 이상 나온 첫 파일을 쓴다. 실패는 던지지 않고 null.
import { decodeText } from "./html-entities.ts";
import { hwpPreview, hwpRead, hwpxRead } from "./hwp-text.mjs";
import { pdfText } from "./pdf-text.mjs";

export type AttachKind = "pdf" | "hwp" | "hwpx";
export type AttachLink = { url: string; kind: AttachKind | null };
export type ByteGot = { ok: true; bytes: Uint8Array; url: string; contentType: string | null } | { ok: false; code: string };
export type ByteReader = { getBytes?: (rawUrl: string, accept: string, maxBytes: number) => Promise<ByteGot> };

export const ATTACH_MAX_BYTES = 15 * 1024 * 1024;
export const ATTACH_TRIES = 2;
export const ATTACH_LINKS_MAX = 6;
export const ATTACH_TEXT_MIN = 50;
export const ATTACH_TEXT_MAX = 60000;
export const ACCEPT_FILE = "application/pdf,application/x-hwp,application/haansofthwp,application/vnd.hancom.hwp,application/vnd.hancom.hwpx,application/hwp+zip,application/octet-stream;q=0.9,*/*;q=0.5";

const EXT = /\.(hwpx|hwp|pdf)(?:$|[?#\s)\]])/i;
const ORDER: Record<AttachKind, number> = { hwpx: 0, hwp: 1, pdf: 2 };
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeText(m[1] ?? m[2] ?? m[3] ?? "") : null;
};
const kindIn = (v: string | null): AttachKind | null => {
  const m = v ? EXT.exec(v) : null;
  return m ? m[1].toLowerCase() as AttachKind : null;
};

// 페이지의 첨부 링크 → 읽을 차례(HWPX → HWP → PDF, 같은 종류는 페이지 순서). 같은 주소는 한 번.
export function attachmentLinks(html: string, base: string): AttachLink[] {
  if (typeof html !== "string" || !html) return [];
  const out: (AttachLink & { at: number })[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]{0,800}?)<\/a\s*>/gi;
  let m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(html)) && n++ < 3000) {
    const tag = m[1], inner = decodeText(m[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    const href = attr(tag, "href");
    if (!href || /^\s*(javascript|mailto|tel|data):/i.test(href) || href.trim().startsWith("#")) continue;
    let u: URL;
    try { u = new URL(href.trim(), base); } catch { continue; }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    u.hash = "";
    const kind = kindIn(safe(u.pathname)) ?? kindIn(attr(tag, "download")) ?? kindIn(attr(tag, "title")) ?? kindIn(inner);
    if (!kind || seen.has(u.href)) continue;
    seen.add(u.href);
    out.push({ url: u.href, kind, at: out.length });
  }
  return out.sort((a, b) => ORDER[a.kind!] - ORDER[b.kind!] || a.at - b.at).slice(0, ATTACH_LINKS_MAX).map(({ url, kind }) => ({ url, kind }));
}
function safe(v: string) { try { return decodeURIComponent(v); } catch { return v; } }

// 파일 머리 바이트 → 종류(이름·형식 머리글은 믿지 않는다).
export function sniffKind(bytes: Uint8Array): AttachKind | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  const head = String.fromCharCode(...bytes.subarray(0, Math.min(1024, bytes.length)));
  if (head.includes("%PDF-")) return "pdf";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "hwp";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "hwpx";
  return null;
}
// 읽은 글자 다듬기: 줄마다 빈칸 하나로, 빈 줄 빼기, 상한.
export function tidyAttached(text: string, max = ATTACH_TEXT_MAX): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n")
    // deno-lint-ignore no-control-regex
    .map((l) => l.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t 　]+/g, " ").trim()).filter(Boolean);
  return [...lines.join("\n")].slice(0, max).join("").trim();
}
export async function attachedText(bytes: Uint8Array, max = ATTACH_TEXT_MAX): Promise<{ text: string; kind: AttachKind } | null> {
  const kind = sniffKind(bytes);
  if (!kind) return null;
  let raw = "";
  try {
    if (kind === "pdf") raw = await pdfText(bytes, { maxChars: max });
    else if (kind === "hwp") { raw = (await hwpRead(bytes, { maxChars: max })).text; if (!raw.trim()) raw = hwpPreview(bytes); }
    else raw = (await hwpxRead(bytes, { maxChars: max })).text;
  } catch { raw = kind === "hwp" ? safePreview(bytes) : ""; }
  const text = tidyAttached(raw, max);
  return text ? { text, kind } : null;
}
function safePreview(bytes: Uint8Array) { try { return hwpPreview(bytes); } catch { return ""; } }

// 링크 차례대로 ATTACH_TRIES개까지 받아 글자가 충분한 첫 파일. 공용 읽기에 getBytes가 없으면 null(읽지 않음).
export async function readAttachment(reader: ByteReader, links: AttachLink[], log?: (code: string, detail?: Record<string, unknown>) => void): Promise<{ text: string; kind: AttachKind } | null> {
  if (typeof reader?.getBytes !== "function") return null;
  for (const link of links.slice(0, ATTACH_TRIES)) {
    let got: ByteGot;
    try { got = await reader.getBytes(link.url, ACCEPT_FILE, ATTACH_MAX_BYTES); } catch { continue; }
    if (!got.ok) { log?.("attach_fetch_failed", { why: got.code }); continue; }
    const out = await attachedText(got.bytes);
    log?.("attach_read", { kind: out?.kind ?? "none", chars: out ? [...out.text].length : 0 });
    if (out && [...out.text].length >= ATTACH_TEXT_MIN) return out;
  }
  return null;
}
