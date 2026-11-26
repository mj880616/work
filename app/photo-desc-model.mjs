// S71-62 PHOTO-설명: 설명 칸 계산(DOM 없이 읽히는 순수 모듈 — 시험이 그대로 읽는다). 그리기는 photo-desc.js.
export const DESC_MAX = 500;
// 서버(gdrive-photos cleanDesc)와 같은 다듬기: 줄바꿈·탭 = 빈칸, 빈칸 하나, 앞뒤 없음. 길이는 서버가 다시 본다.
export const tidyDesc = s => String(s ?? '').normalize('NFC').replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim();
export const descLength = s => [...String(s || '')].length;
// 자주 쓴 낱말 칩을 칸 끝에 넣기(이미 그 낱말이 있으면 그대로).
export function addWord(text, word) {
  const t = tidyDesc(text), w = tidyDesc(word);
  if (!w) return t;
  if (t.split(' ').includes(w)) return t;
  return t ? `${t} ${w}` : w;
}
// 저장 단추를 켤지: 바꾸기(set)는 처음 글과 다를 때, 붙이기(add)는 글이 있을 때. 길이를 넘으면 늘 꺼짐.
export function canSave({mode, text, before = ''}) {
  const v = tidyDesc(text);
  if (descLength(v) > DESC_MAX) return false;
  return mode === 'add' ? !!v : v !== tidyDesc(before);
}
