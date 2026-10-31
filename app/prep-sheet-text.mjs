// 준비 '한 장' 줄 글 규칙(순수 함수, 시험: tests/prep-sheet-text.test.mjs). 다음 주 준비·교섭 전 한 장이 같이 쓴다.
// - wordClip: 글을 max 글자 안으로 줄일 때 낱말 중간에서 자르지 않는다(마지막 띄어쓰기 앞에서 끊고 '…'). 줄인 결과도 한 줄·max 글자 이하.
// - tidyCut: 이미 max 글자에서 잘려 저장된 옛 줄(낱말 중간에서 끊김)을 화면에서 낱말 앞으로 정리. max보다 짧은 글은 그대로.
// - splitLead: 줄 글을 '한 문장 요약'(늘 보임)과 나머지 세부(접기)로 나눈다. 문장 끝(. ! ? 。 …) 뒤 띄어쓰기에서만 나눈다.
// - numberGroups: 묶음 이름 앞 동그라미 번호를 보이는 묶음 차례로 다시 매긴다(빈 묶음을 빼도 번호가 비지 않게).
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const flat = text => String(text ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const LEAD_MIN = 6;

function cutAtWord(chars, max) {
  const head = chars.slice(0, Math.max(1, max - 1));
  const lastSpace = head.lastIndexOf(' ');
  const kept = lastSpace >= Math.floor(max / 2) ? head.slice(0, lastSpace) : head;
  return kept.join('').replace(/[\s,·:;—-]+$/u, '') + '…';
}

export function wordClip(text, max) {
  const chars = [...flat(text)];
  return chars.length <= max ? chars.join('') : cutAtWord(chars, max);
}

export function tidyCut(text, max) {
  const chars = [...flat(text)];
  if (chars.length < max) return chars.join('');
  const last = chars[chars.length - 1];
  if (chars.length === max && /[.!?。…)\]"'”’]/u.test(last)) return chars.join('');
  return cutAtWord(chars, max);
}

export function splitLead(text) {
  const s = flat(text);
  const re = /[.!?。…](?=\s)/gu;
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + 1, lead = s.slice(0, end).trim(), rest = s.slice(end).trim();
    if ([...lead].length < LEAD_MIN) continue;
    return rest ? {lead, rest} : {lead:s, rest:''};
  }
  return {lead:s, rest:''};
}

export function numberGroups(groups) {
  return (groups || []).map((g, i) => {
    const name = String(g.label ?? '').replace(/^[①-⑳]\s*/u, '');
    return {...g, label:i < CIRCLED.length ? `${CIRCLED[i]} ${name}` : `${i + 1}. ${name}`};
  });
}
