// 출처 켜기/끄기 공용 규칙(S49-21 FILES-출처켜고끄기): 사진 화면(photo-sources-model.mjs)과 [파일] 화면(files-sources-model.mjs)이 같이 쓴다.
// 서버 view_prefs 값({이름: 참·거짓}) → 이름마다 참·거짓(모양이 틀린 칸은 기본값), 하나 뒤집기. 화면 없이 시험한다.
export const SOURCES_OFF_TEXT = '위 출처 아이콘을 켜 주세요';
export function parseFlags(value, names, defaults) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const name of names) out[name] = typeof v[name] === 'boolean' ? v[name] : defaults[name];
  return out;
}
export function toggleFlag(value, names, defaults, name) {
  const next = parseFlags(value, names, defaults);
  if (!names.includes(name)) return next;
  next[name] = !next[name];
  return next;
}
