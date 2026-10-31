// ATT-이름고치기(2026-10-31 사용자 결정 "추천안대로"): 첨부 파일 이름 고치기의 이름 규칙 한 곳.
// 순수 함수만(브라우저·Edge 공용). Edge 사본은 supabase/functions/_shared/file-rename-name.mjs 이고, 시험이 이 줄 아래를 바이트까지 비교한다.
// 쓰는 곳: 화면 app/file-rename.js(고치는 칸·안내 글), Edge document-actions rename-file(서버가 다시 검사), ai-assist file_name(추천 다듬기).
// - 확장자(.jpg 등)는 따로 둔다. 사람은 이름 부분만 고치고, 저장할 때 원래 확장자를 그대로 붙인다(서버도 같은 규칙으로 붙임).
// - 빈 이름, 드라이브·PC에서 문제가 되는 글자(/ \ : * ? " < > | 와 제어 문자), 점으로 끝나는 이름, 너무 긴 이름은 막는다.

export const FILE_BASE_MAX = 120;
const BAD = /[\/\\:*?"<>|]/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069\ufeff]/;
const EXT = /\.([A-Za-z0-9]{1,10})$/;

const chars = (s) => [...s].length;

// '사진 216079.jpg' → {base:'사진 216079', ext:'.jpg'}. 점으로 시작하는 이름('.env')·확장자가 없는 이름은 ext ''.
export function splitFileName(name) {
  const s = String(name ?? '');
  const m = s.match(EXT);
  if (!m || m.index === 0) return { base: s, ext: '' };
  return { base: s.slice(0, m.index), ext: s.slice(m.index) };
}

// 사람이 고친 이름 부분 검사. 맞으면 {ok:true, base}, 아니면 {ok:false, code, message}(작은 빨간 글자로 보일 일상어).
export function checkFileBase(input) {
  const base = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!base) return { ok: false, code: 'empty', message: '이름을 비울 수 없어요.' };
  if (CONTROL.test(String(input ?? '').replace(/[\t\n\r]/g, ' '))) return { ok: false, code: 'bad_char', message: '보이지 않는 글자는 쓸 수 없어요.' };
  if (BAD.test(base)) return { ok: false, code: 'bad_char', message: '/ \\ : * ? " < > | 는 쓸 수 없어요.' };
  if (/^\.+$/.test(base) || base.endsWith('.')) return { ok: false, code: 'dot_end', message: '이름이 점(.)으로 끝날 수 없어요.' };
  if (chars(base) > FILE_BASE_MAX) return { ok: false, code: 'too_long', message: `이름은 ${FILE_BASE_MAX}자까지예요.` };
  return { ok: true, base };
}

// 저장할 새 이름: 고친 이름 부분 + 원래 확장자. 맞지 않으면 null.
export function renamedFileName(oldName, input) {
  const r = checkFileBase(input);
  if (!r.ok) return null;
  return r.base + splitFileName(oldName).ext;
}

// AI 추천을 이름 칸에 넣을 수 있게 다듬는다: 금지 글자는 띄어쓰기로, 줄바꿈·겹친 띄어쓰기는 하나로, 끝 점 떼기, 길이 자르기.
// 다듬은 뒤에도 맞지 않으면 ''(추천 없음).
export function tidySuggestedBase(text) {
  let s = String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069\ufeff]/g, ' ');
  s = s.replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  s = [...s].slice(0, FILE_BASE_MAX).join('').trim().replace(/[.\s]+$/, '');
  return checkFileBase(s).ok ? s : '';
}
