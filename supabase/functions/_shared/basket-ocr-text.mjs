// Keep this pure source identical to the browser copy when that phase starts.
export const OCR_LIMITS = Object.freeze({
  characters: 16384,
  utf8Bytes: 65536,
});
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const states = new Set(["unread", "reading", "done", "empty", "failed"]);
const cleanups = new Set([
  "none",
  "create_pending",
  "create_unknown",
  "created",
  "delete_pending",
  "deleted",
  "delete_failed",
]);
const keys = new Set([
  "state",
  "attempt_id",
  "original_file_id",
  "text",
  "temp_document_id",
  "cleanup_state",
  "error_code",
  "cleanup_error_code",
]);
export function validateOcrText(text) {
  if (typeof text !== "string" || text.includes("\0")) {
    throw Error("OCR_TEXT_INVALID");
  }
  if (
    [...text].length > OCR_LIMITS.characters ||
    new TextEncoder().encode(text).length > OCR_LIMITS.utf8Bytes
  ) throw Error("OCR_TEXT_TOO_LONG");
  return text;
}
export function decodeOcrBytes(bytes) {
  if (bytes.byteLength > OCR_LIMITS.utf8Bytes) throw Error("OCR_TEXT_TOO_LONG");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("OCR_TEXT_INVALID");
  }
  validateOcrText(text);
  return /^\s*$/u.test(text) ? "" : text;
}
export function effectiveOcrText(file) {
  if (!Object.hasOwn(file || {}, "ocr")) return "";
  const o = file.ocr,
    fail = () => {
      throw Error("BASKET_ATTACHMENT_INVALID");
    };
  if (
    !o || typeof o !== "object" || Array.isArray(o) ||
    Object.keys(o).some((key) => !keys.has(key)) ||
    !["image/jpeg", "image/png"].includes(file.mime_type) ||
    !id(file.drive_file_id) ||
    o.original_file_id !== file.drive_file_id || !states.has(o.state) ||
    !cleanups.has(o.cleanup_state)
  ) fail();
  const known = ["created", "delete_pending", "deleted", "delete_failed"]
    .includes(o.cleanup_state);
  if (
    (known &&
      (!id(o.temp_document_id) || o.temp_document_id === file.drive_file_id)) ||
    (!known && Object.hasOwn(o, "temp_document_id")) ||
    (o.state !== "unread" && !uuid(o.attempt_id)) ||
    (o.state === "unread" &&
      (o.cleanup_state !== "none" ||
        ["attempt_id", "text", "temp_document_id"].some((key) =>
          Object.hasOwn(o, key)
        )))
  ) fail();
  for (const key of ["error_code", "cleanup_error_code"]) {
    if (
      Object.hasOwn(o, key) &&
      (typeof o[key] !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(o[key]))
    ) fail();
  }
  if (Object.hasOwn(o, "text")) {
    try {
      validateOcrText(o.text);
    } catch {
      fail();
    }
  }
  if (
    (o.state === "done" && (typeof o.text !== "string" || o.text === "")) ||
    (o.state === "empty" && o.text !== "") ||
    (["done", "empty"].includes(o.state) && !known)
  ) fail();
  return o.text ?? "";
}
