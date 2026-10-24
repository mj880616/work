// LIB-AI자동분류 (docs/design/library-ai-fill.md 3절): 자료 파일의 본문 글자를 읽는 한 곳.
// document-actions `document-text`가 부르고, 전체 검색 ②(docs/design/global-search.md 8절)도 이 함수가 저장한 글자를 찾는다.
// - 글 파일(txt·md·csv): 내려받아 UTF-8로 읽는다.
// - HWPX: 내려받아 zip 안 Contents/section*.xml의 글자만 모은다(외부 라이브러리 없음).
// - PDF·HWP·DOC·DOCX·RTF·ODT: Drive가 Google 문서로 바꾼 임시 사본을 text/plain으로 내보낸 뒤 사본을 지운다(OpenAI 비용 없음).
//   Drive가 바꾸지 못하는 형식이면 글자 없음으로 끝난다.
//   LIB-스캔글자읽기: PDF만 변환 요청에 한국어 OCR 언어(ocrLanguage=ko)를 준다(스캔 PDF의 글자). HWP·DOC·DOCX 등은 그대로.
// - PPT·PPTX·ODP(SEARCH ②): 같은 방법으로 Google 프레젠테이션 임시 사본 → text/plain.
// - XLS·XLSX·ODS(SEARCH ②): Google 스프레드시트 임시 사본 → text/csv. Drive 내보내기는 첫 시트만 준다(나머지 시트 글자는 없음).
// - 사진 JPEG·PNG(LIB-스캔글자읽기, 2026-10-24 결정): 바구니 사진과 같은 Drive 한국어 OCR(_shared/drive-ocr.ts)을 그대로 쓴다.
//   같은 크기 상한(OCR_MAX_BYTES)·원본 비공개 확인·임시 문서 표시·임시 문서 지우기. 새 OCR 구현 없음, AI 비용 없음.
//   읽기 단계 전체 PHOTO_READ_MS, 지우기 단계 PHOTO_CLEANUP_MS 안(합쳐 ~90초, 변환 경로 최악과 같음).
// - 그 밖의 사진·파일: 읽지 않는다(파일 이름으로만 판단, 사용자 결정 ④).
// 원본 Drive 파일은 읽기만 한다(이름·위치·내용 변경 없음, ⑦). 실패는 던지지 않고 {text:'', reason}으로 돌려준다.

import { createDriveOcr, OCR_MAX_BYTES, OcrError, ocrMarkers } from "./drive-ocr.ts";

// 사진 OCR 임시 문서 표시의 note·workspace 칸 값(바구니 기록 ID와 겹치지 않아 바구니 되찾기가 이 문서를 잡지 않는다).
const OCR_MARK = "library-text";

// 저장 상한. 자료 목록 화면 여러 곳이 app_documents를 select=*로 읽으므로 지금은 앞 12,000자만 둔다.
// 전체 검색(docs/design/global-search.md ②)이 전체 글자가 필요하면, 그 PR에서 목록 읽기 칸을 좁힌 뒤 이 값만 올린다(옛 상한 50,000자).
export const DOCUMENT_TEXT_CHARS = 12000;
export const TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const HWPX_MAX_BYTES = 30 * 1024 * 1024;
export const HWPX_XML_MAX_BYTES = 20 * 1024 * 1024;
export const EXPORT_MAX_BYTES = 1024 * 1024;
export const CONVERT_MAX_BYTES = 50 * 1024 * 1024;
export const TEMP_NAME = "Web2 글자 읽기 임시";
export const PHOTO_MAX_BYTES = OCR_MAX_BYTES;
export const PHOTO_READ_MS = 60000;
export const PHOTO_CLEANUP_MS = 30000;
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOC = "application/vnd.google-apps.document";
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;

export type TextKind = "text" | "hwpx" | "convert" | "slides" | "sheet" | "image" | "none";
// 임시 사본 형식과 내보낼 글 형식. 원본은 그대로 두고 사본만 만들었다 지운다.
const CONVERT: Record<"convert" | "slides" | "sheet", { target: string; exportMime: string }> = {
  convert: { target: DOC, exportMime: "text/plain" },
  slides: { target: "application/vnd.google-apps.presentation", exportMime: "text/plain" },
  sheet: { target: "application/vnd.google-apps.spreadsheet", exportMime: "text/csv" },
};
export type TextResult = { text: string; source: "content" | "none"; reason: string; cut: boolean };

const ext = (name: string) => String(name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "";

// 파일 이름(확장자)을 먼저 보고, 확장자가 없으면 Drive가 알려 준 형식을 본다.
export function textKindOf(name: string, mime: string): TextKind {
  const e = ext(name), m = String(mime || "").toLowerCase();
  if (["txt", "md", "markdown", "csv", "tsv", "log"].includes(e)) return "text";
  if (e === "hwpx") return "hwpx";
  if (["pdf", "hwp", "doc", "docx", "rtf", "odt"].includes(e)) return "convert";
  if (["ppt", "pptx", "odp"].includes(e)) return "slides";
  if (["xls", "xlsx", "ods"].includes(e)) return "sheet";
  if (["jpg", "jpeg", "png"].includes(e)) return "image";
  if (e) return "none";
  if (/^text\/(plain|markdown|csv|tab-separated-values)$/.test(m)) return "text";
  if (m === "application/hwp+zip" || m === "application/vnd.hancom.hwpx") return "hwpx";
  if (m === "application/pdf" || /msword|wordprocessingml|hwp|haansoft|rtf|opendocument\.text/.test(m)) return "convert";
  if (/ms-powerpoint|presentationml|opendocument\.presentation/.test(m)) return "slides";
  if (/ms-excel|spreadsheetml|opendocument\.spreadsheet/.test(m)) return "sheet";
  if (m === "image/jpeg" || m === "image/png") return "image";
  return "none";
}

// 스캔 PDF만 OCR 언어를 준다(HWP·DOCX 등 다른 변환은 그대로).
export function isPdf(name: string, mime: string): boolean {
  const e = ext(name);
  return e ? e === "pdf" : String(mime || "").toLowerCase() === "application/pdf";
}

// AI에 보낼 글 정리: 제어 문자 제거, 빈 줄 줄이기, 앞부분만(잘랐는지 함께 알림).
export function tidyText(raw: string, limit = DOCUMENT_TEXT_CHARS): { text: string; cut: boolean } {
  const text = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "")
    .replace(/[ \t 　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = [...text];
  return chars.length > limit ? { text: chars.slice(0, limit).join(""), cut: true } : { text, cut: false };
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/gi, (all, v: string) => {
    if (v[0] !== "#") return ENTITY[v.toLowerCase()] ?? all;
    const n = v[1] === "x" || v[1] === "X" ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
    return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}

// HWPX 본문 XML 한 쪽에서 글자만: 문단(<hp:p>)마다 <hp:t> 안의 글을 모은다. 표 안 문단도 한 줄씩 나온다.
export function hwpxSectionText(xml: string): string {
  const lines: string[] = [];
  for (const para of xml.split(/<\/hp:p>/)) {
    let line = "";
    for (const m of para.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)) {
      line += decodeEntities(m[1].replace(/<hp:tab\b[^>]*\/>/g, " ").replace(/<[^>]*>/g, ""));
    }
    if (line.trim()) lines.push(line);
  }
  return lines.join("\n");
}

async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
  // Type-only cast for the strict Deno check (drive-summary bundles this file too); no runtime change.
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error("HWPX_TOO_LARGE");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

// HWPX(zip)의 Contents/section0.xml, section1.xml …을 차례로 읽는다. zip 모양이 이상하면 빈 글.
export async function hwpxText(bytes: Uint8Array, { maxXmlBytes = HWPX_XML_MAX_BYTES } = {}): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("HWPX_NOT_ZIP");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const sections: { n: number; method: number; size: number; offset: number }[] = [];
  const decoder = new TextDecoder("utf-8");
  for (let k = 0; k < count; k++) {
    if (at + 46 > len || view.getUint32(at, true) !== 0x02014b50) throw new Error("HWPX_NOT_ZIP");
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const m = name.match(/^Contents\/section(\d{1,4})\.xml$/i);
    if (m) sections.push({ n: Number(m[1]), method, size, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  sections.sort((a, b) => a.n - b.n);
  const out: string[] = [];
  let total = 0;
  for (const s of sections) {
    if (s.offset + 30 > len || view.getUint32(s.offset, true) !== 0x04034b50) throw new Error("HWPX_NOT_ZIP");
    const start = s.offset + 30 + view.getUint16(s.offset + 26, true) + view.getUint16(s.offset + 28, true);
    if (start + s.size > len) throw new Error("HWPX_NOT_ZIP");
    const raw = bytes.subarray(start, start + s.size);
    const xml = s.method === 0 ? raw : s.method === 8 ? await inflateRaw(raw, maxXmlBytes - total) : null;
    if (!xml) continue;
    total += xml.byteLength;
    if (total > maxXmlBytes) throw new Error("HWPX_TOO_LARGE");
    out.push(hwpxSectionText(decoder.decode(xml)));
    // 앞부분만 쓰므로 충분히 모이면 멈춘다.
    if (out.join("\n").length > DOCUMENT_TEXT_CHARS * 2) break;
  }
  return out.join("\n");
}

// keep: 상한을 넘으면 실패 대신 앞부분만 쓴다(내보낸 글은 어차피 앞 DOCUMENT_TEXT_CHARS자만 저장한다).
async function readBounded(response: Response, max: number, { keep = false } = {}): Promise<Uint8Array> {
  if (!response.body) throw new Error("EMPTY_BODY");
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > max) {
        if (!keep) throw new Error("TOO_LARGE");
        parts.push(value.subarray(0, max - size));
        size = max;
        break;
      }
      size += value.byteLength;
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

type Deps = { fetch?: typeof fetch; driveToken: () => Promise<string>; log?: (code: string) => void };
export type DocumentFile = { fileId: string; name: string; mime: string; size: number | null };

export function createDocumentText(deps: Deps) {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? (() => {});
  const request = (url: string, token: string, init: RequestInit = {}) =>
    doFetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000) });

  async function download(fileId: string, token: string, max: number) {
    const r = await request(`${DRIVE}/${encodeURIComponent(fileId)}?alt=media`, token);
    if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("DOWNLOAD_FAILED"); }
    return await readBounded(r, max);
  }

  // Drive가 Google 문서(프레젠테이션·스프레드시트)로 바꾼 임시 사본을 글로 내보낸다. 사본은 성공·실패와 관계없이 지운다(원본은 그대로).
  async function convert(fileId: string, token: string, kind: "convert" | "slides" | "sheet" = "convert", ocr = false): Promise<string> {
    const { target, exportMime } = CONVERT[kind];
    const r = await request(`${DRIVE}/${encodeURIComponent(fileId)}/copy?fields=id,mimeType${ocr ? "&ocrLanguage=ko" : ""}`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: TEMP_NAME, mimeType: target, appProperties: { web2_text_tmp: "1" } }),
    });
    if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("CONVERT_UNSUPPORTED"); }
    const made = await r.json().catch(() => null) as { id?: unknown; mimeType?: unknown } | null;
    const copy = typeof made?.id === "string" && DRIVE_ID.test(made.id) && made.id !== fileId ? made.id : null;
    if (!copy) throw new Error("CONVERT_UNKNOWN");
    try {
      if (made?.mimeType !== target) throw new Error("CONVERT_UNSUPPORTED");
      const e = await request(`${DRIVE}/${encodeURIComponent(copy)}/export?mimeType=${encodeURIComponent(exportMime)}`, token);
      if (!e.ok) { await e.body?.cancel().catch(() => {}); throw new Error("EXPORT_FAILED"); }
      // 큰 문서·표는 앞 1MB만 읽는다(잘린 끝 글자는 저장 상한 밖이라 남지 않는다).
      return new TextDecoder("utf-8").decode(await readBounded(e, EXPORT_MAX_BYTES, { keep: true }));
    } finally {
      try {
        const d = await request(`${DRIVE}/${encodeURIComponent(copy)}`, token, { method: "DELETE" });
        await d.body?.cancel().catch(() => {});
        if (d.status !== 204 && d.status !== 404) log("document_text_temp_delete_failed");
      } catch {
        log("document_text_temp_delete_failed");
      }
    }
  }

  // 사진 JPEG·PNG: 바구니와 같은 drive-ocr 흐름(원본 확인 → 한국어 OCR 임시 문서 → 글 내보내기 → 임시 문서 지우기).
  // 원본은 읽기만 한다. 임시 문서는 원본과 같은 폴더에 생기고, 성공·실패와 관계없이 지운다(만들었는지 모르면 표시로 찾아 지운다).
  const within = (ms: number): typeof fetch => {
    const deadline = AbortSignal.timeout(ms);
    return ((input: RequestInfo | URL, init: RequestInit = {}) =>
      doFetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline })) as typeof fetch;
  };
  async function photo(fileId: string, token: string): Promise<string> {
    const readFetch = within(PHOTO_READ_MS), reading = createDriveOcr({ fetch: readFetch });
    let folder = "", markers: Record<string, string> | null = null, tempId: string | null = null, unknown = false;
    try {
      const m = await readFetch(`${DRIVE}/${encodeURIComponent(fileId)}?fields=name,mimeType,size,parents`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000),
      });
      if (!m.ok) { await m.body?.cancel().catch(() => {}); throw new Error("READ_FAILED"); }
      const meta = await m.json().catch(() => null) as { name?: unknown; mimeType?: unknown; size?: unknown; parents?: unknown } | null;
      const parents = Array.isArray(meta?.parents) ? meta.parents : [];
      if (typeof meta?.mimeType !== "string" || !["image/jpeg", "image/png"].includes(meta.mimeType)) throw new Error("CONVERT_UNSUPPORTED");
      if (typeof meta.size !== "string" || !/^\d{1,15}$/.test(meta.size)) throw new Error("READ_FAILED");
      if (Number(meta.size) > PHOTO_MAX_BYTES) throw new Error("TOO_LARGE");
      if (parents.length !== 1 || typeof parents[0] !== "string" || !DRIVE_ID.test(parents[0]) || typeof meta.name !== "string") throw new Error("READ_FAILED");
      folder = parents[0];
      const file = { drive_file_id: fileId, file_name: meta.name, mime_type: meta.mimeType, size_bytes: Number(meta.size) };
      if (!(await reading.formats(token)).includes(file.mime_type)) throw new Error("CONVERT_UNSUPPORTED");
      const source = await reading.source(file, folder, token);
      const attempt = crypto.randomUUID();
      markers = await ocrMarkers(OCR_MARK, OCR_MARK, fileId, attempt, new Date().toISOString(), source.version!);
      try {
        tempId = await reading.create(source, file, folder, markers, token);
      } catch (e) {
        unknown = e instanceof OcrError && e.unknown;
        throw e;
      }
      await reading.temp(tempId, fileId, folder, markers, token);
      return await reading.text(tempId, token);
    } catch (e) {
      if (e instanceof OcrError) {
        throw new Error(e.code === "OCR_SOURCE_UNSUPPORTED" ? "CONVERT_UNSUPPORTED" : e.code === "OCR_TEXT_TOO_LONG" ? "TOO_LARGE" : "READ_FAILED");
      }
      throw e;
    } finally {
      if (markers && (tempId || unknown)) {
        const cleaning = createDriveOcr({ fetch: within(PHOTO_CLEANUP_MS) });
        try {
          const id = tempId ?? await cleaning.find(folder, markers, token);
          if (id) await cleaning.remove(id, fileId, folder, markers, token);
        } catch {
          log("document_text_temp_delete_failed");
        }
      }
    }
  }

  async function extract(file: DocumentFile): Promise<TextResult> {
    const none = (reason: string): TextResult => ({ text: "", source: "none", reason, cut: false });
    if (!DRIVE_ID.test(file.fileId)) return none("no_file");
    const kind = textKindOf(file.name, file.mime);
    if (kind === "none") return none("unsupported");
    const size = typeof file.size === "number" && Number.isSafeInteger(file.size) ? file.size : null;
    const max = kind === "text" ? TEXT_FILE_MAX_BYTES : kind === "hwpx" ? HWPX_MAX_BYTES : kind === "image" ? PHOTO_MAX_BYTES : CONVERT_MAX_BYTES;
    if (size !== null && size > max) return none("too_large");
    let raw = "";
    try {
      const token = await deps.driveToken();
      if (kind === "text") raw = new TextDecoder("utf-8").decode(await download(file.fileId, token, max));
      else if (kind === "hwpx") raw = await hwpxText(await download(file.fileId, token, max));
      else if (kind === "image") raw = await photo(file.fileId, token);
      else raw = await convert(file.fileId, token, kind, kind === "convert" && isPdf(file.name, file.mime));
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      return none(code === "CONVERT_UNSUPPORTED" ? "unsupported" : code === "TOO_LARGE" || code === "HWPX_TOO_LARGE" ? "too_large" : "read_failed");
    }
    const tidy = tidyText(raw);
    return tidy.text ? { text: tidy.text, source: "content", reason: "ok", cut: tidy.cut } : none("empty");
  }

  return { extract };
}
