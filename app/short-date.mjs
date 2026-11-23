// 목록 줄 짧은 날짜 공용 표기(서울 시간): 올해면 '11.20', 다른 해면 '25.11.20'. 화면·저장소·네트워크 없음(node --test로 시험).
// 노트 목록 날짜 칸(note-tree.mjs noteLineDate)과 브리핑 룸 다 된 줄(brief-room-model.mjs doneDate, S68-44)이 이 하나를 쓴다.
// 'M/D'(예: '11/20')는 진행 칸 수('만드는 중 17/22')와 같은 모양이라 목록 날짜로 쓰지 않는다.
const PARTS = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'});
const part = date => Object.fromEntries(PARTS.formatToParts(date).map(p => [p.type, p.value]));
export function shortListDate(value, now = new Date()) {
  const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
  const a = part(d), b = part(now);
  return a.year === b.year ? `${a.month}.${a.day}` : `${a.year.slice(2)}.${a.month}.${a.day}`;
}
