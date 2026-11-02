// JOURNAL-오늘한일업무개인 (요청함 11/01 22:56 명진): '오늘 한 일'은 업무·개인을 나눠 적지 않는다. 업무 재료(주간보고 [주간 정리]·
// 초안 복사·한글 파일 상자)로 쓸 때만 서버 AI(ai-assist kind=work_scope)가 줄마다 가르고, 업무라고 답한 줄만 쓴다(애매하면 빼기).
// 판단은 저장하지 않는다(이 화면 메모리에만, 줄이 바뀌면 다시 묻는다). 순수 함수만 — 화면 쪽은 work-scope.js.
const SEP = '\u0000';
const linesOf = row => String(row?.raw_text ?? '').split('\n').map(line => line.trim()).filter(Boolean);
const lineKey = (day, text) => `${day}${SEP}${String(text ?? '').trim()}`;

// 그 주 줄이 바뀌었는지 알아보는 열쇠: 주인·주·날짜별 줄 글. 같은 열쇠면 같은 판단을 다시 쓴다.
export function scopeKey(owner, start, lines) {
  const days = [...(lines instanceof Map ? lines.keys() : [])].sort();
  return [owner, start, ...days.map(day => `${day}=${linesOf(lines.get(day)).join('\n')}`)].join(SEP + SEP);
}
export const hasLines = lines => lines instanceof Map && [...lines.values()].some(row => linesOf(row).length > 0);
// 서버 답 drop:[{day,text}](업무로 판정되지 않은 줄 — 개인·애매·보내지 않은 줄) → 뺄 줄 열쇠 모음. 모양이 틀리면 null.
export function dropSet(drop) {
  if (!Array.isArray(drop) || !drop.every(w => w && typeof w.day === 'string' && typeof w.text === 'string')) return null;
  return new Set(drop.map(w => lineKey(w.day, w.text)));
}
// S48-3b: 사람이 [주간 정리] 참고 '한 줄'에서 ⋯ [빼기]한 줄(탭 메모리 — 서버 원본은 그 주 draft.picks, 다음에 열면 서버 work_scope 가
// 뺄 줄에 더해 돌려준다). keepLines 가 AI 판단과 함께 뺀다. 되돌리면 지운다. 로그인이 바뀌면 비운다(clearUserDrops).
const userDrops = new Set();
export const markUserDrop = (day, text, on = true) => { const k = lineKey(day, text); if (on) userDrops.add(k); else userDrops.delete(k); };
export const clearUserDrops = () => userDrops.clear();
export const isUserDrop = (day, text) => userDrops.has(lineKey(day, text));
// 동작 기록(weekly-picks.mjs) 한 줄 모양: 칸 'notes:lines:<날짜>'(서버 work-scope.ts userLineDrops 와 같음).
export const workLinePick = (day, text) => ({kind:'work_line', from:'record', cell:`notes:lines:${day}`, org:'', text:String(text ?? '').trim()});
// 그 주 줄 Map(날짜 → 업무일지 행)에서 뺄 줄을 뺀 새 Map. 남은 줄이 없는 날은 뺀다. 원래 행은 바꾸지 않는다.
// 판정 뒤 바뀐 줄은 scopeKey가 바뀌어 다시 묻는다(부르는 쪽이 열쇠가 같을 때만 이 함수를 씀).
export function keepLines(lines, drop) {
  const out = new Map();
  if (!(lines instanceof Map) || !(drop instanceof Set)) return out;
  for (const [day, row] of lines) {
    const kept = linesOf(row).filter(text => !drop.has(lineKey(day, text)) && !userDrops.has(lineKey(day, text)));
    if (kept.length) out.set(day, {...row, raw_text:kept.join('\n')});
  }
  return out;
}
