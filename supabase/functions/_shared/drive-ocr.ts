import { decodeOcrBytes, OCR_LIMITS } from "./basket-ocr-text.mjs";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const DOC = "application/vnd.google-apps.document";
const MAX_BINARY = 104857600;
// 자료실 사진 글자 읽기(_shared/document-text.ts)가 같은 상한을 쓴다. 바구니 동작은 그대로.
export const OCR_MAX_BYTES = MAX_BINARY;
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(id);
export class OcrError extends Error {
  code: string;
  status: number;
  unknown: boolean;
  constructor(code: string, status = 503, unknown = false) {
    super(code);
    this.code = code;
    this.status = status;
    this.unknown = unknown;
  }
}
type Photo = {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};
type Meta = {
  id: string;
  name: string;
  mimeType: string;
  ownedByMe: boolean;
  trashed: boolean;
  parents: string[];
  permissions?: { type: string; role: string }[];
  capabilities?: { canDownload?: boolean; canDelete?: boolean };
  size?: string;
  version?: string;
  md5Checksum?: string;
  appProperties?: Record<string, string>;
};
const hash = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function ocrMarkers(
  note: string,
  workspace: string,
  source: string,
  attempt: string,
  stamp: string,
  version: string,
) {
  return {
    web2_ocr: "1",
    note,
    workspace,
    attempt,
    source_hash: await hash(source),
    note_stamp: stamp,
    source_version: version,
  };
}
export function createDriveOcr(options: { fetch?: typeof fetch } = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  async function request(
    url: string,
    token: string,
    init: RequestInit = {},
    code = "OCR_DRIVE_UNAVAILABLE",
  ) {
    try {
      return await fetcher(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new OcrError(code);
    }
  }
  async function json(url: string, token: string, code: string): Promise<any> {
    const r = await request(url, token, {}, code);
    if (!r.ok) throw new OcrError(code);
    try {
      return await r.json();
    } catch {
      throw new OcrError(code);
    }
  }
  const fields =
    "id,name,mimeType,ownedByMe,trashed,parents,permissions(type,role),capabilities(canDownload,canDelete),size,version,md5Checksum,appProperties";
  async function info(id: string, token: string): Promise<Meta> {
    if (!validId(id)) throw new OcrError("OCR_IDENTITY_INVALID", 409);
    return await json(
      `${DRIVE}/${encodeURIComponent(id)}?fields=${fields}`,
      token,
      "OCR_IDENTITY_UNAVAILABLE",
    );
  }
  function privateFile(meta: Meta, id: string, folder: string, mime: string) {
    if (
      meta.id !== id || meta.mimeType !== mime || meta.ownedByMe !== true ||
      meta.trashed !== false ||
      !Array.isArray(meta.parents) || meta.parents.length !== 1 ||
      meta.parents[0] !== folder ||
      !Array.isArray(meta.permissions) || meta.permissions.length !== 1 ||
      meta.permissions[0].type !== "user" ||
      meta.permissions[0].role !== "owner"
    ) throw new OcrError("OCR_IDENTITY_INVALID", 409);
  }
  async function formats(token: string) {
    const data = await json(
      "https://www.googleapis.com/drive/v3/about?fields=importFormats,exportFormats",
      token,
      "OCR_FORMATS_UNAVAILABLE",
    );
    if (
      !data || !data.importFormats || !data.exportFormats ||
      !Array.isArray(data.exportFormats[DOC]) ||
      !data.exportFormats[DOC].includes("text/plain")
    ) return [];
    return ["image/jpeg", "image/png"].filter((mime) =>
      Array.isArray(data.importFormats[mime]) &&
      data.importFormats[mime].includes(DOC)
    );
  }
  async function source(photo: Photo, folder: string, token: string) {
    if (
      !["image/jpeg", "image/png"].includes(photo.mime_type) ||
      !Number.isSafeInteger(photo.size_bytes) || photo.size_bytes < 1 ||
      photo.size_bytes > MAX_BINARY
    ) throw new OcrError("OCR_SOURCE_UNSUPPORTED", 400);
    const meta = await info(photo.drive_file_id, token);
    privateFile(meta, photo.drive_file_id, folder, photo.mime_type);
    if (
      meta.name !== photo.file_name || !/^\d+$/.test(meta.size || "") ||
      Number(meta.size) !== photo.size_bytes ||
      meta.capabilities?.canDownload !== true ||
      !/^\d{1,64}$/.test(meta.version || "")
    ) throw new OcrError("OCR_SOURCE_CHANGED", 409);
    return meta;
  }
  async function temp(
    id: string,
    original: string,
    folder: string,
    markers: Record<string, string>,
    token: string,
  ) {
    if (id === original) throw new OcrError("OCR_IDENTITY_INVALID", 409);
    const meta = await info(id, token);
    privateFile(meta, id, folder, DOC);
    if (
      !meta.appProperties ||
      Object.entries(markers).some(([key, value]) =>
        meta.appProperties?.[key] !== value
      )
    ) throw new OcrError("OCR_IDENTITY_INVALID", 409);
    return meta;
  }
  async function create(
    meta: Meta,
    photo: Photo,
    folder: string,
    markers: Record<string, string>,
    token: string,
    onDispatch: () => void = () => {},
  ) {
    if (
      !validId(folder) ||
      Object.entries(markers).some(([key, value]) =>
        key.length + value.length > 124
      )
    ) throw new OcrError("OCR_IDENTITY_INVALID", 409);
    const r = await request(
      `${DRIVE}/${encodeURIComponent(photo.drive_file_id)}?alt=media`,
      token,
      {},
      "OCR_SOURCE_UNAVAILABLE",
    );
    if (!r.ok || !r.body) throw new OcrError("OCR_SOURCE_UNAVAILABLE");
    const reader = r.body.getReader();
    let count = 0;
    const initial: Uint8Array[] = [];
    try {
      while (count < Math.min(8, photo.size_bytes)) {
        const chunk = await reader.read();
        if (chunk.done) throw new OcrError("OCR_SOURCE_CHANGED", 409);
        count += chunk.value.byteLength;
        if (count > photo.size_bytes) {
          throw new OcrError("OCR_SOURCE_CHANGED", 409);
        }
        initial.push(chunk.value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    }
    const head = new Uint8Array(count);
    let offset = 0;
    for (const part of initial) {
      head.set(part, offset);
      offset += part.length;
    }
    const signature = photo.mime_type === "image/jpeg"
      ? [255, 216, 255]
      : [137, 80, 78, 71, 13, 10, 26, 10];
    if (signature.some((byte, i) => head[i] !== byte)) {
      await reader.cancel().catch(() => {});
      throw new OcrError("OCR_SOURCE_UNSUPPORTED", 400);
    }
    const boundary = `ocr_${crypto.randomUUID()}`, encoder = new TextEncoder();
    const prefix = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${
        JSON.stringify({
          name: `Web2 OCR ${markers.attempt}`,
          mimeType: DOC,
          parents: [folder],
          appProperties: markers,
        })
      }\r\n--${boundary}\r\nContent-Type: ${photo.mime_type}\r\n\r\n`,
    );
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
    let first = true;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (first) {
            first = false;
            controller.enqueue(prefix);
            controller.enqueue(head);
            return;
          }
          const chunk = await reader.read();
          if (chunk.done) {
            if (count !== photo.size_bytes) {
              throw new OcrError("OCR_SOURCE_CHANGED", 409);
            }
            controller.enqueue(suffix);
            controller.close();
            return;
          }
          count += chunk.value.byteLength;
          if (count > photo.size_bytes || count > MAX_BINARY) {
            throw new OcrError("OCR_SOURCE_CHANGED", 409);
          }
          controller.enqueue(chunk.value);
        } catch (e) {
          controller.error(e);
          await reader.cancel().catch(() => {});
        }
      },
      cancel: () => reader.cancel(),
    });
    try {
      const init: RequestInit & { duplex: string } = {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(
            prefix.length + photo.size_bytes + suffix.length,
          ),
        },
        body: stream,
        duplex: "half",
      };
      // Tell this request exactly when remote creation may have been sent.
      // A later refusal cannot be treated as proof that no document exists.
      onDispatch();
      const response = await request(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=ko&fields=id`,
        token,
        init,
        "OCR_CREATE_UNKNOWN",
      );
      if (!response.ok) throw Error();
      const data = await response.json();
      if (!validId(data.id) || data.id === photo.drive_file_id) throw Error();
      return data.id as string;
    } catch {
      await reader.cancel().catch(() => {});
      throw new OcrError("OCR_CREATE_UNKNOWN", 503, true);
    }
  }
  async function text(id: string, token: string) {
    if (!validId(id)) throw new OcrError("OCR_IDENTITY_INVALID", 409);
    const response = await request(
      `${DRIVE}/${encodeURIComponent(id)}/export?mimeType=text%2Fplain`,
      token,
      {},
      "OCR_TEXT_UNAVAILABLE",
    );
    if (!response.ok || !response.body) {
      throw new OcrError("OCR_TEXT_UNAVAILABLE");
    }
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > OCR_LIMITS.utf8Bytes) {
          throw new OcrError("OCR_TEXT_TOO_LONG", 413);
        }
        parts.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
      }
      try {
        return decodeOcrBytes(bytes);
      } catch (e) {
        throw new OcrError(
          e instanceof Error && e.message === "OCR_TEXT_TOO_LONG"
            ? "OCR_TEXT_TOO_LONG"
            : "OCR_TEXT_INVALID",
          422,
        );
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async function find(
    folder: string,
    markers: Record<string, string>,
    token: string,
  ) {
    if (!validId(folder)) throw new OcrError("OCR_IDENTITY_INVALID", 409);
    const quote = (v: string) => v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q =
      `trashed = false and 'me' in owners and '${
        quote(folder)
      }' in parents and mimeType = '${DOC}' and ` +
      ["web2_ocr", "note", "workspace", "attempt", "source_hash"].map((key) =>
        `appProperties has { key='${key}' and value='${quote(markers[key])}' }`
      ).join(" and ");
    const params = new URLSearchParams({
        q,
        fields: "files(id),nextPageToken,incompleteSearch",
        pageSize: "100",
      }),
      seen = new Set<string>(),
      ids: string[] = [];
    for (let page = 0; page < 1000; page++) {
      const data = await json(
        `${DRIVE}?${params}`,
        token,
        "OCR_DISCOVERY_UNAVAILABLE",
      );
      if (data.incompleteSearch || !Array.isArray(data.files)) {
        throw new OcrError("OCR_DISCOVERY_UNAVAILABLE");
      }
      for (const file of data.files) {
        if (!validId(file.id)) throw new OcrError("OCR_IDENTITY_INVALID", 409);
        ids.push(file.id);
      }
      if (ids.length > 1) throw new OcrError("OCR_DISCOVERY_AMBIGUOUS", 409);
      if (!data.nextPageToken) return ids[0] ?? null;
      if (
        typeof data.nextPageToken !== "string" || seen.has(data.nextPageToken)
      ) throw new OcrError("OCR_DISCOVERY_UNAVAILABLE");
      seen.add(data.nextPageToken);
      params.set("pageToken", data.nextPageToken);
    }
    throw new OcrError("OCR_DISCOVERY_UNAVAILABLE");
  }
  async function remove(
    id: string,
    original: string,
    folder: string,
    markers: Record<string, string>,
    token: string,
  ) {
    const meta = await temp(id, original, folder, markers, token);
    if (meta.capabilities?.canDelete !== true) {
      throw new OcrError("OCR_IDENTITY_INVALID", 409);
    }
    let response;
    try {
      response = await request(`${DRIVE}/${encodeURIComponent(id)}`, token, {
        method: "DELETE",
      }, "OCR_DELETE_UNKNOWN");
    } catch {
      throw new OcrError("OCR_DELETE_UNKNOWN", 503, true);
    }
    if (response.status !== 204) {
      throw new OcrError("OCR_DELETE_UNKNOWN", 503, true);
    }
  }
  return { formats, source, temp, create, text, find, remove };
}
