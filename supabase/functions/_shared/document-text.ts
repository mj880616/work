// LIB-AI자동분류 (docs/design/library-ai-fill.md 3절): 자료 파일의 본문 글자를 읽는 한 곳.
// document-actions `document-text`가 부르고, 전체 검색 ②(docs/design/global-search.md 8절)도 이 함수가 저장한 글자를 찾는다.
// - 글 파일(txt·md·csv): 내려받아 UTF-8로 읽는다.
// - HWPX: 내려받아 zip 안 Contents/section*.xml의 글자만 모은다(외부 라이브러리 없음).
// - HWP(구형 한글): 내려받아 자체 읽기(_shared/hwp-text.mjs)로 본문 섹션을 하나씩 흘려 풀고 글자만 남긴다(S67-33).
//   S67-28은 npm:@ssabrojs/hwpxjs hwpToText를 썼으나 작은 보도자료 HWP에서도 Edge 메모리 한도를 넘겨 함수가 죽었다.
//   Drive는 HWP를 Google 문서로 바꾸지 못하므로 변환 길로 보내지 않는다. 외부 라이브러리 없음.
// - 브리핑 길(raw)은 HWP·HWPX를 나눠 읽는다: from(섹션·문단 위치)에서 시작해 정한 양만 읽고 next를 돌려준다(부르는 쪽이 이어 부름).
// - PDF·DOC·DOCX·RTF·ODT: Drive가 Google 문서로 바꾼 임시 사본을 text/plain으로 내보낸 뒤 사본을 지운다(OpenAI 비용 없음).
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
import { HWP_SLICE_IN, HWP_SLICE_OUT, HwpTextError, hwpPreview, hwpRead, hwpxRead, sliceTotal } from "./hwp-text.mjs";

// 사진 OCR 임시 문서 표시의 note·workspace 칸 값(바구니 기록 ID와 겹치지 않아 바구니 되찾기가 이 문서를 잡지 않는다).
const OCR_MARK = "library-text";

// 저장 상한. 자료 목록 화면 여러 곳이 app_documents를 select=*로 읽으므로 지금은 앞 12,000자만 둔다.
// 전체 검색(docs/design/global-search.md ②)이 전체 글자가 필요하면, 그 PR에서 목록 읽기 칸을 좁힌 뒤 이 값만 올린다(옛 상한 50,000자).
export const DOCUMENT_TEXT_CHARS = 12000;
export const TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;
// HWP·HWPX 내려받는 상한(S67-33: 30MB → 80MB). 본문은 흘려서 풀므로 메모리는 거의 파일 크기 한 벌이다
// (내려받기는 Content-Length 크기로 한 번에 받아 두 벌을 만들지 않는다). Edge 메모리 한도 256MB 안에서 넉넉히 남게 정한 값.
export const HWPX_MAX_BYTES = 80 * 1024 * 1024;
// 크기를 미리 알 수 없는 응답(Content-Length 없음)은 조각을 모아 합치므로 두 벌이 생긴다 → 옛 상한 30MB만 받는다.
export const UNSIZED_MAX_BYTES = 30 * 1024 * 1024;
// 자료실 저장 길(hwpxText)의 섹션 XML 상한(그대로). 브리핑 길은 흘려 읽으므로 섹션 하나 HWPX_STREAM_XML_MAX_BYTES까지.
export const HWPX_XML_MAX_BYTES = 20 * 1024 * 1024;
export const HWPX_STREAM_XML_MAX_BYTES = 400 * 1024 * 1024;
export const HWP_MAX_BYTES = HWPX_MAX_BYTES;
export const EXPORT_MAX_BYTES = 1024 * 1024;
// BRIEF-브리핑룸(docs/design/brief-room.md 2절): 브리핑 길만 끝까지 읽는다(raw). 내보내기 상한 4MB, 정리·자르기는 부르는 쪽(_shared/brief-room.mjs)이 한다.
// 저장 상한 DOCUMENT_TEXT_CHARS와 기존 document-text 동작은 그대로다(raw를 주지 않으면 지금과 같음).
export const RAW_EXPORT_MAX_BYTES = 4 * 1024 * 1024;
export const CONVERT_MAX_BYTES = 50 * 1024 * 1024;
export const TEMP_NAME = "Web2 글자 읽기 임시";
export const PHOTO_MAX_BYTES = OCR_MAX_BYTES;
export const PHOTO_READ_MS = 60000;
export const PHOTO_CLEANUP_MS = 30000;
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOC = "application/vnd.google-apps.document";
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;

export type TextKind = "text" | "hwpx" | "hwp" | "convert" | "slides" | "sheet" | "image" | "none";
// 임시 사본 형식과 내보낼 글 형식. 원본은 그대로 두고 사본만 만들었다 지운다.
const CONVERT: Record<"convert" | "slides" | "sheet", { target: string; exportMime: string }> = {
  convert: { target: DOC, exportMime: "text/plain" },
  slides: { target: "application/vnd.google-apps.presentation", exportMime: "text/plain" },
  sheet: { target: "application/vnd.google-apps.spreadsheet", exportMime: "text/csv" },
};
// next: 나눠 읽기에서 아직 남은 곳(다음 부름의 from). total: 진행 표시용 전체 조각 수 어림(브리핑 read 단계 n/t).
export type ReadFrom = { sec: number; para: number };
// partial: "preview" = 본문을 못 읽어 HWP 미리보기 글자(앞부분만)를 돌려줌(S67-37, 브리핑 길만).
export type TextResult = { text: string; source: "content" | "none"; reason: string; cut: boolean; next?: ReadFrom | null; total?: number; partial?: "preview" };

const ext = (name: string) => String(name || "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? "";

// 파일 이름(확장자)을 먼저 보고, 확장자가 없으면 Drive가 알려 준 형식을 본다.
export function textKindOf(name: string, mime: string): TextKind {
  const e = ext(name), m = String(mime || "").toLowerCase();
  if (["txt", "md", "markdown", "csv", "tsv", "log"].includes(e)) return "text";
  if (e === "hwpx") return "hwpx";
  if (e === "hwp") return "hwp";
  if (["pdf", "doc", "docx", "rtf", "odt"].includes(e)) return "convert";
  if (["ppt", "pptx", "odp"].includes(e)) return "slides";
  if (["xls", "xlsx", "ods"].includes(e)) return "sheet";
  if (["jpg", "jpeg", "png"].includes(e)) return "image";
  if (e) return "none";
  if (/^text\/(plain|markdown|csv|tab-separated-values)$/.test(m)) return "text";
  if (m === "application/hwp+zip" || m === "application/vnd.hancom.hwpx") return "hwpx";
  if (/hwp|haansoft|hancom/.test(m)) return "hwp";
  if (m === "application/pdf" || /msword|wordprocessingml|rtf|opendocument\.text/.test(m)) return "convert";
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
// all: 브리핑 길(raw)은 끝까지 읽는다(XML 상한 maxXmlBytes는 그대로). 아니면 저장할 앞부분만큼 모이면 멈춘다.
export async function hwpxText(bytes: Uint8Array, { maxXmlBytes = HWPX_XML_MAX_BYTES, all = false } = {}): Promise<string> {
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
    if (!all && out.join("\n").length > DOCUMENT_TEXT_CHARS * 2) break;
  }
  return out.join("\n");
}

// keep: 상한을 넘으면 실패 대신 앞부분만 쓴다(내보낸 글은 어차피 앞 DOCUMENT_TEXT_CHARS자만 저장한다).
// S67-33: 응답이 크기(Content-Length)를 알려 주면 그 크기로 한 번에 받는다(조각 모아 합치기 = 두 벌을 만들지 않음).
async function readBounded(response: Response, max: number, { keep = false, unsizedMax = max } = {}): Promise<Uint8Array> {
  if (!response.body) throw new Error("EMPTY_BODY");
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (!keep && Number.isSafeInteger(declared) && declared >= 0) {
    if (declared > max) { await response.body.cancel().catch(() => {}); throw new Error("TOO_LARGE"); }
    const out = new Uint8Array(declared), reader = response.body.getReader();
    let at = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.byteLength > declared) throw new Error("READ_FAILED");
        out.set(value, at); at += value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (at !== declared) throw new Error("READ_FAILED");
    return out;
  }
  if (!keep) max = Math.min(max, unsizedMax);
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

// slice: 나눠 읽기 한 몫의 크기(시험에서 작게 줄 때만). 운영은 기본값(HWP_SLICE_IN·HWP_SLICE_OUT).
type Deps = { fetch?: typeof fetch; driveToken: () => Promise<string>; log?: (code: string) => void; slice?: { in: number; out: number } };
export type DocumentFile = { fileId: string; name: string; mime: string; size: number | null };

export function createDocumentText(deps: Deps) {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? (() => {});
  const request = (url: string, token: string, init: RequestInit = {}) =>
    doFetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000) });

  async function download(fileId: string, token: string, max: number) {
    const r = await request(`${DRIVE}/${encodeURIComponent(fileId)}?alt=media`, token);
    if (!r.ok) { await r.body?.cancel().catch(() => {}); throw new Error("DOWNLOAD_FAILED"); }
    return await readBounded(r, max, { unsizedMax: Math.min(max, UNSIZED_MAX_BYTES) });
  }

  // Drive가 Google 문서(프레젠테이션·스프레드시트)로 바꾼 임시 사본을 글로 내보낸다. 사본은 성공·실패와 관계없이 지운다(원본은 그대로).
  async function convert(fileId: string, token: string, kind: "convert" | "slides" | "sheet" = "convert", ocr = false, exportMax = EXPORT_MAX_BYTES): Promise<string> {
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
      return new TextDecoder("utf-8").decode(await readBounded(e, exportMax, { keep: true }));
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

  // HWP·HWPX 나눠 읽기. raw가 아니면(자료실 저장 길) 저장할 앞부분만큼만 한 번에 읽는다.
  // 암호·배포용 문서는 locked, 모양이 깨진 파일은 read_failed(Drive 변환은 HWP를 못 바꾸므로 다시 시도하지 않는다).
  // S67-37: 실패 로그에 단계 코드를 붙인다(document_text_hwp_read_failed:stage=section_inflate 등, 글 내용 없음).
  // 브리핑 길(raw)의 첫 몫에서 HWP 본문을 못 읽으면(깨짐·배포용) 미리보기 글자(PrvText)라도 돌려준다(partial=preview).
  // 자료실 저장 길은 미리보기를 쓰지 않는다(앞부분만인 글이 '끝까지 읽은 글자'로 저장되면 브리핑이 그것을 원문으로 쓰게 된다).
  async function hwpPart(kind: "hwp" | "hwpx", bytes: Uint8Array, opts: { raw?: boolean; from?: ReadFrom | null; maxChars?: number }): Promise<{ text: string; next: ReadFrom | null; sizes: number[]; partial?: "preview" }> {
    const raw = opts.raw === true;
    const o = {
      from: opts.from ?? { sec: 0, para: 0 },
      sliceIn: raw ? (deps.slice?.in ?? HWP_SLICE_IN) : Infinity, sliceOut: raw ? (deps.slice?.out ?? HWP_SLICE_OUT) : Infinity,
      maxChars: raw ? (opts.maxChars ?? Infinity) : DOCUMENT_TEXT_CHARS * 2,
    };
    try {
      return kind === "hwp" ? await hwpRead(bytes, o) : await hwpxRead(bytes, { ...o, maxXmlBytes: HWPX_STREAM_XML_MAX_BYTES });
    } catch (e) {
      const code = e instanceof HwpTextError ? e.code : "";
      const stage = e instanceof HwpTextError ? (/^[a-z_]{1,20}$/.test(e.stage) ? e.stage : "unknown") : "other";
      log(code === "HWP_LOCKED" ? "document_text_hwp_locked" : `document_text_hwp_read_failed:stage=${stage}`);
      const first = !opts.from || (opts.from.sec === 0 && opts.from.para === 0);
      if (raw && kind === "hwp" && first && code !== "HWPX_TOO_LARGE") {
        const preview = hwpPreview(bytes);
        if (preview.replace(/\s/g, "").length) { log("document_text_hwp_preview_used"); return { text: preview, next: null, sizes: [], partial: "preview" }; }
      }
      throw new Error(code === "HWP_LOCKED" ? "LOCKED" : code === "HWPX_TOO_LARGE" ? "TOO_LARGE" : code === "HWPX_NOT_ZIP" ? "HWPX_NOT_ZIP" : "READ_FAILED");
    }
  }

  // raw: 브리핑 길 전용. 정리(tidyText)·12,000자 자르기 없이 읽은 글 그대로(쪽 나눔 \f 포함)를 돌려준다. cut은 내보내기 상한에 걸렸는지 모르므로 false.
  // HWP·HWPX는 raw일 때 나눠 읽는다(from에서 시작, 남으면 next). maxChars: 이번에 더 받을 글자 수(브리핑 원문 상한까지 남은 양).
  async function extract(file: DocumentFile, opts: { raw?: boolean; from?: ReadFrom | null; maxChars?: number } = {}): Promise<TextResult> {
    const none = (reason: string): TextResult => ({ text: "", source: "none", reason, cut: false });
    if (!DRIVE_ID.test(file.fileId)) return none("no_file");
    const kind: TextKind = textKindOf(file.name, file.mime);
    if (kind === "none") return none("unsupported");
    const size = typeof file.size === "number" && Number.isSafeInteger(file.size) ? file.size : null;
    const max = kind === "text" ? TEXT_FILE_MAX_BYTES : kind === "hwpx" ? HWPX_MAX_BYTES : kind === "hwp" ? HWP_MAX_BYTES : kind === "image" ? PHOTO_MAX_BYTES : CONVERT_MAX_BYTES;
    if (size !== null && size > max) return none("too_large");
    let raw = "", next: ReadFrom | null = null, total = 0;
    try {
      const token = await deps.driveToken();
      if (kind === "text") raw = new TextDecoder("utf-8").decode(await download(file.fileId, token, max));
      else if (kind === "hwpx" && !opts.raw) raw = await hwpxText(await download(file.fileId, token, max));
      else if (kind === "hwp" || kind === "hwpx") {
        const part = await hwpPart(kind, await download(file.fileId, token, max), opts);
        raw = part.text; next = opts.raw ? part.next : null; total = sliceTotal(part.sizes, deps.slice?.in ?? HWP_SLICE_IN);
        if (opts.raw && part.partial === "preview") return raw.trim() ? { text: raw, source: "content", reason: "ok", cut: false, next: null, total, partial: "preview" } : none("read_failed");
      }
      else if (kind === "image") raw = await photo(file.fileId, token);
      else raw = await convert(file.fileId, token, kind, kind === "convert" && isPdf(file.name, file.mime), opts.raw ? RAW_EXPORT_MAX_BYTES : EXPORT_MAX_BYTES);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      return none(code === "CONVERT_UNSUPPORTED" ? "unsupported" : code === "TOO_LARGE" || code === "HWPX_TOO_LARGE" ? "too_large" : code === "LOCKED" ? "locked" : "read_failed");
    }
    // 나눠 읽는 중에는 이번 몫이 비어 있어도(표·그림만 있는 앞부분) 다음 몫이 있으면 계속 읽는다.
    if (opts.raw && next) return { text: raw, source: "content", reason: "ok", cut: false, next, total };
    if (opts.raw) return raw.trim() ? { text: raw, source: "content", reason: "ok", cut: false, next: null, total } : none("empty");
    const tidy = tidyText(raw);
    return tidy.text ? { text: tidy.text, source: "content", reason: "ok", cut: tidy.cut } : none("empty");
  }

  return { extract };
}
