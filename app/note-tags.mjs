// NOTE-읽생기아이디어 ② 해시태그: 노트 본문(제목·raw_text, 이미 서버 저장)의 #낱말을 읽어 모은다. 따로 저장하지 않는다(같은 자료 두 번 저장 금지).
// 규칙: 줄 처음이나 띄어쓰기·괄호·따옴표 뒤의 '#' + 글자·숫자·_·-(1~40자, 글자가 하나는 있어야 함). '# 제목'(띄움)·'##'·주소 속 '#'·'#1755'는 태그가 아니다.
// 같은 태그는 대소문자를 가리지 않고 하나로 보고, 처음 나온 모양으로 보인다.
const TAG = /(^|[\s(\[{"'“‘·,])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,39})(?![\p{L}\p{N}_-])/gu;
const LETTER = /\p{L}/u;
export const tagKey = tag => String(tag || '').toLocaleLowerCase('ko');

export function noteTags(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(TAG)) {
    const tag = m[2].replace(/[-_]+$/, '');
    if (!tag || !LETTER.test(tag)) continue;
    const key = tagKey(tag);
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

export const tagsOfNote = note => noteTags(`${note?.title || ''}\n${note?.raw_text || ''}`);

// 태그별 노트 수: 많은 순, 같으면 이름 차례. [{tag, key, count}]
export function tagGroups(notes) {
  const groups = new Map();
  for (const note of notes || []) for (const tag of tagsOfNote(note)) {
    const key = tagKey(tag), g = groups.get(key);
    if (g) g.count += 1; else groups.set(key, {tag, key, count: 1});
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'));
}

export const noteHasTag = (note, key) => tagsOfNote(note).some(tag => tagKey(tag) === key);
