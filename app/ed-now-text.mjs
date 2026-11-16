// ED-지금시각넣기: 편집기 [넣기 ▾] → [지금 시각]이 넣는 글. 한국 시간(Asia/Seoul)·24시간·초 없음. 예: 2026. 11. 16.(월) 19:05
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function nowText(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'}).formatToParts(date).map(x => [x.type, x.value]));
  const day = DAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)];
  return `${p.year}. ${p.month}. ${p.day}.(${day}) ${p.hour}:${p.minute}`;
}
