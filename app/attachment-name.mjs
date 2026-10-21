// BASKET-드롭제목: the file name shown for a stored basket/note attachment. Display only; the stored row is never changed.
// Old uploads can carry a broken name. Before PR #925 the server read file names with Deno req.formData(), which cut a
// quoted name at ';' or '=' and kept the opening quote, and the PC drop program (basket-pc before v0.2.1) sent Korean
// names as "=?utf-8?B?...?=", which that cut turned into a single '"'. The Drive copy got the same name, so the original
// cannot be read back: a name with no letter or digit left shows the fallback ("파일"), a cut name shows what is left.
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Cleaned stored name, or '' when nothing readable is left (e.g. `"`, `\"`, blanks). */
export function readableFileName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\\"/g, '"')
    .trim()
    .replace(/^"+/, '')
    .replace(/"+$/, '')
    .trim();
  return LETTER_OR_DIGIT.test(name) ? name : '';
}

/** Name to show for an attachment ({file_name}); fallback when the stored name is unreadable. */
export function attachmentName(file, fallback = '파일') {
  return readableFileName(file?.file_name) || fallback;
}
