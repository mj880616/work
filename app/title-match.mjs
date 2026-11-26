// S67-40(사용자 11/20 20:22 "이미 보고를 했는데 중복된 일정 보고 제안"): 두 제목이 같은 일을 가리키는지 보는 규칙 한 곳 — DOM·네트워크 없음.
// 사업 보고 달력의 '보고할까요?'·'보고할 일정'·'안 쓴 보고'(report-plan-model.mjs reportCover)와
// 조직 보고 창의 '일정 줄 대신 기록'(record-window-model.mjs sameThing)이 같이 쓴다.
//   - 띄어쓰기·문장 부호·숫자는 보지 않는다('3개노조' = '개노조', '11.18 기자회견' = '기자회견').
//   - 'same' = 한쪽이 다른 쪽에 통째로 들어 있음(빈칸을 뺀 글자 4자 이상), 또는 짧은 쪽 낱말(2자 이상)이 모두 긴 쪽에 있음(낱말 2개 이상),
//              또는 짧은 쪽 낱말 3개 이상이 긴 쪽에 있고 그 비율이 3/4 이상.
//              예) '안전운행 투쟁 기자회견' ⊂ '철도 지하철 3개노조 안전운행 투쟁 돌입 기자회견' → same
//   - 'near' = 겹치는 낱말이 하나라도 있음(같은 일인지 사람이 고를 수 있게 후보로만 쓴다).
//   - ''     = 겹치지 않음.
export const MATCH_SAME = 'same', MATCH_NEAR = 'near';
const PUNCT = /[\s·‧․.,:;!?()[\]{}<>「」『』〈〉《》【】'"“”‘’\-–—_/\\~|+*#&@%^=]+/g;
const clean = text => String(text ?? '').normalize('NFC').toLowerCase().replace(/[0-9０-９]+/g, ' ');
// 빈칸·부호·숫자를 모두 뺀 글자.
export const compactTitle = text => clean(text).replace(PUNCT, '');
// 2자 이상 낱말(겹치는 것은 하나로).
export const titleWords = text => [...new Set(clean(text).split(PUNCT).filter(w => Array.from(w).length >= 2))];

export function titleMatch(a, b) {
  const ca = compactTitle(a), cb = compactTitle(b);
  if (!ca || !cb) return '';
  const [shortC, longC] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (Array.from(shortC).length >= 4 && longC.includes(shortC)) return MATCH_SAME;
  const wa = titleWords(a), wb = titleWords(b);
  if (!wa.length || !wb.length) return '';
  // 짧은 쪽 = 낱말이 적은 쪽. 낱말이 같은 수면 글자가 짧은 쪽.
  const aShort = wa.length < wb.length || (wa.length === wb.length && ca.length <= cb.length);
  const [ws, other] = aShort ? [wa, cb] : [wb, ca];
  const hit = ws.filter(w => other.includes(w)).length;
  if (!hit) return '';
  if (ws.length >= 2 && hit === ws.length) return MATCH_SAME;
  if (hit >= 3 && hit / ws.length >= 0.75) return MATCH_SAME;
  return MATCH_NEAR;
}
