// Meeting wall-clock inputs always mean Korea time, independently of the device timezone.
const TIME_ZONE='Asia/Seoul';
export function formatMeetingTime(value,options={}){
  return value?new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',...options,timeZone:TIME_ZONE}).format(new Date(value)):'';
}
export function meetingInputValue(value){
  if(!value)return'';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function toMeetingISO(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new RangeError('올바른 회의 일시를 입력해 주세요.');
  const date=new Date(value+':00+09:00');
  if(Number.isNaN(date.getTime())||meetingInputValue(date)!==value)throw new RangeError('올바른 회의 일시를 입력해 주세요.');
  return date.toISOString();
}
