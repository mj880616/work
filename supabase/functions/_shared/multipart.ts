// multipart/form-data reader shared by the upload functions (basket-files, library-files, meeting-files,
// workspace-drive upload).
// Why not req.formData(): Deno's parser splits Content-Disposition parameters on every ';' and '=' even inside a
// quoted string, so a browser upload named `회의록; 최종=v2.hwp` arrived as `"회의록`. This reader tokenizes the
// header properly (quoted strings, backslash escapes, RFC 5987 filename*) and keeps the rest of the contract:
// file parts become File objects, other parts become UTF-8 strings.
// Memory matches req.formData(): the body is read once and each part is copied into its own Blob/string.

export class MultipartError extends Error {}

const MAX_PARTS = 64;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_NAME_CHARS = 1024;
const utf8 = new TextDecoder("utf-8");
const ascii = (text: string) => new TextEncoder().encode(text);

type Params = Map<string, string>;

/** `value; key=token; key="quoted \" string"` → lowercase type + first occurrence of each lowercase key. */
export function parseHeaderParams(value: string): { type: string; params: Params } {
  const params: Params = new Map();
  let i = value.indexOf(";");
  const type = (i < 0 ? value : value.slice(0, i)).trim().toLowerCase();
  if (i < 0) return { type, params };
  const n = value.length;
  while (i < n) {
    // at ';'
    i++;
    while (i < n && (value[i] === " " || value[i] === "\t")) i++;
    let k = i;
    while (k < n && value[k] !== "=" && value[k] !== ";") k++;
    const key = value.slice(i, k).trim().toLowerCase();
    i = k;
    if (i >= n || value[i] === ";") continue;
    i++; // '='
    while (i < n && (value[i] === " " || value[i] === "\t")) i++;
    let v = "";
    if (value[i] === '"') {
      i++;
      while (i < n && value[i] !== '"') {
        if (value[i] === "\\" && i + 1 < n) i++;
        v += value[i++];
      }
      i++; // closing quote (or past end when unterminated)
      while (i < n && value[i] !== ";") i++; // ignore anything between the quote and the next ';'
    } else {
      let e = i;
      while (e < n && value[e] !== ";") e++;
      v = value.slice(i, e).trim();
      i = e;
    }
    if (key && !params.has(key)) params.set(key, v);
  }
  return { type, params };
}

/** RFC 5987 ext-value `charset'lang'%xx...`; null when malformed or the charset is unsupported. */
export function decodeExtValue(value: string): string | null {
  const m = /^([A-Za-z0-9!#$&+\-^_`{}~]+)'[A-Za-z0-9-]*'(.*)$/.exec(value.trim());
  if (!m) return null;
  const charset = m[1].toLowerCase();
  const raw = m[2];
  if (!/^(?:[A-Za-z0-9!#$&+\-.^_`|~]|%[0-9A-Fa-f]{2})*$/.test(raw)) return null;
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "%") {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(raw.charCodeAt(i));
  }
  if (charset === "utf-8") {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    } catch {
      return null;
    }
  }
  if (charset === "iso-8859-1") return String.fromCharCode(...bytes);
  return null;
}

/** Name as stored: no control characters, last path segment only (both separators), trimmed. */
export function cleanFileName(raw: string): string {
  const noControl = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  const cut = Math.max(noControl.lastIndexOf("/"), noControl.lastIndexOf("\\"));
  return (cut >= 0 ? noControl.slice(cut + 1) : noControl).trim();
}

function indexOf(hay: Uint8Array<ArrayBuffer>, needle: Uint8Array, from: number): number {
  const first = needle[0];
  const last = hay.length - needle.length;
  for (let i = hay.indexOf(first, from); i >= 0 && i <= last; i = hay.indexOf(first, i + 1)) {
    let j = 1;
    while (j < needle.length && hay[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

function delimiterEnds(body: Uint8Array, at: number): boolean {
  if (body[at] === 0x2d && body[at + 1] === 0x2d) return true;
  while (body[at] === 0x20 || body[at] === 0x09) at++;
  return body[at] === 0x0d && body[at + 1] === 0x0a;
}

export function parseMultipart(body: Uint8Array<ArrayBuffer>, contentType: string | null): FormData {
  const { type, params } = parseHeaderParams(contentType || "");
  const boundary = params.get("boundary") || "";
  if (type !== "multipart/form-data" || !/^[ -~]{1,70}$/.test(boundary)) {
    throw new MultipartError("content_type");
  }
  const dash = ascii("--" + boundary);
  const delimiter = ascii("\r\n--" + boundary);
  const form = new FormData();
  // First delimiter: at the very start, or after a preamble line.
  let pos = body.length >= dash.length && dash.every((b, i) => body[i] === b) ? 0 : indexOf(body, delimiter, 0) + 2;
  if (pos < 2 && pos !== 0) throw new MultipartError("no_boundary");
  let parts = 0;
  for (;;) {
    pos += dash.length;
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) return form; // closing "--boundary--"
    while (body[pos] === 0x20 || body[pos] === 0x09) pos++; // transport padding
    if (body[pos] !== 0x0d || body[pos + 1] !== 0x0a) throw new MultipartError("delimiter");
    pos += 2;
    if (++parts > MAX_PARTS) throw new MultipartError("too_many_parts");
    const headerEnd = indexOf(body, ascii("\r\n\r\n"), pos);
    // An empty header block ends right at the CRLF that follows the delimiter line.
    const emptyHeaders = body[pos] === 0x0d && body[pos + 1] === 0x0a;
    const hEnd = emptyHeaders ? pos : headerEnd;
    if (hEnd < 0 || hEnd - pos > MAX_HEADER_BYTES) throw new MultipartError("headers");
    const headers = new Map<string, string>();
    for (const line of utf8.decode(body.subarray(pos, hEnd)).split("\r\n")) {
      const c = line.indexOf(":");
      if (c <= 0) continue;
      const key = line.slice(0, c).trim().toLowerCase();
      if (!headers.has(key)) headers.set(key, line.slice(c + 1).trim());
    }
    const start = emptyHeaders ? pos + 2 : hEnd + 4;
    // A real delimiter line ends in "--" or (padding +) CRLF; "\r\n--B" followed by other bytes is content.
    let end = indexOf(body, delimiter, start);
    while (end >= 0 && !delimiterEnds(body, end + delimiter.length)) end = indexOf(body, delimiter, end + 1);
    if (end < 0) throw new MultipartError("unterminated");
    const disposition = parseHeaderParams(headers.get("content-disposition") || "");
    const name = disposition.params.get("name");
    if (disposition.type !== "form-data" || name === undefined || [...name].length > MAX_NAME_CHARS) {
      throw new MultipartError("disposition");
    }
    const content = body.subarray(start, end);
    const star = disposition.params.get("filename*");
    const plain = disposition.params.get("filename");
    if (star !== undefined || plain !== undefined) {
      const decoded = star === undefined ? null : decodeExtValue(star);
      const fileName = cleanFileName(decoded ?? plain ?? "");
      const partType = (headers.get("content-type") || "").trim();
      form.append(name, new File([content], fileName, { type: partType }));
    } else {
      form.append(name, utf8.decode(content));
    }
    pos = end + 2;
  }
}

export async function readMultipartForm(req: Request): Promise<FormData> {
  return parseMultipart(new Uint8Array(await req.arrayBuffer()), req.headers.get("content-type"));
}
