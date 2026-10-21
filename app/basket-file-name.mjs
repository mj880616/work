// BASKET-드롭제목: the name shown for a basket attachment. Display only — the stored file_name is never rewritten.
// Before basket-files read multipart itself (BASKET-파일명파싱, PR #925), Deno req.formData() cut a quoted name at ';'
// or '=' and kept '\"' escapes, and the old basket-pc client sent Korean names as a MIME encoded word — so stored names
// can be a lone '"', start with '"' ('"회의록'), carry '\"', or be '=?utf-8?B?…?='. What is still readable is shown;
// a name with no letter or digit left becomes "이름 없는 파일/사진" plus the extension its file type implies.
const EXT = {
  'application/pdf':'.pdf', 'application/x-hwp':'.hwp', 'application/haansofthwp':'.hwp', 'application/vnd.hancom.hwp':'.hwp',
  'application/hwp+zip':'.hwpx', 'application/vnd.hancom.hwpx':'.hwpx', 'application/haansofthwpx':'.hwpx',
  'application/msword':'.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
  'application/vnd.ms-excel':'.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx',
  'application/vnd.ms-powerpoint':'.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx',
  'application/zip':'.zip', 'text/plain':'.txt', 'text/csv':'.csv', 'text/html':'.html', 'text/markdown':'.md',
  'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'image/gif':'.gif', 'image/heic':'.heic',
};
const READABLE = /[\p{L}\p{N}]/u;
function decodeWord(name) {
  const m = /^=\?utf-8\?b\?([A-Za-z0-9+/=]+)\?=$/i.exec(name);
  if (!m) return name;
  try { return new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(atob(m[1]), c => c.charCodeAt(0))); } catch { return name; }
}
export const isPhotoFile = file => String(file?.mime_type || '').toLowerCase().startsWith('image/');
export function attachmentName(file) {
  let name = String(file?.file_name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  name = name.replace(/\\(["\\])/g, '$1');
  name = name.replace(/^["\s]+|["\s]+$/g, '');
  name = decodeWord(name).trim();
  if (READABLE.test(name)) return name;
  return (isPhotoFile(file) ? '이름 없는 사진' : '이름 없는 파일') + (EXT[String(file?.mime_type || '').toLowerCase().split(';')[0].trim()] || '');
}
// The list row title of an update with no text: "파일 · 이름" or "사진 · 이름".
export const attachmentTitle = file => `${isPhotoFile(file) ? '사진' : '파일'} · ${attachmentName(file)}`;
