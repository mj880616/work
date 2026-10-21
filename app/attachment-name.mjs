// BASKET-드롭제목: the name shown for a stored attachment (app_notes.attachments[].file_name).
// Before the multipart fix (#925) basket-files read uploads with Deno's req.formData(), which split the
// Content-Disposition header at every ';' and '=' even inside the quoted filename and kept the opening quote.
// So a name was stored cut short with a leading '"' (`회의록; 최종=v2.hwp` → `"회의록`), and a name whose first
// character was ';' or '=' was stored as a bare '"'. The stored rows are left as they are (no data rewrite);
// only the display drops the stray quote and backslash escapes. A name with nothing left shows as `fallback`.
export function attachmentName(file, fallback = '파일') {
  let name = String((file && typeof file === 'object' ? file.file_name : file) ?? '').trim();
  // A real stored name never starts with '"' (browsers send '"' as %22, and the shared reader strips the quotes).
  if (name.startsWith('"')) name = name.slice(1).replace(/"$/, '').replace(/\\(.)/g, '$1').trim();
  return name || fallback;
}
