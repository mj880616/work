// All Web2 wall-clock inputs and displayed dates mean Korea time.
// Keep date-only values (all-day events / task due dates) as calendar dates.
export const TIME_ZONE='Asia/Seoul';
const KST=9*3600000,DAY=86400000;
const pad=n=>String(n).padStart(2,'0');
const instant=value=>new Date(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00+09:00':value);
const partsFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function seoulParts(value=new Date()){
  const parts=partsFormatter.formatToParts(instant(value));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return {year:+p.year,month:+p.month-1,day:+p.day,hour:+p.hour,minute:+p.minute,second:+p.second,weekday:new Date(Date.UTC(+p.year,+p.month-1,+p.day)).getUTCDay()};
}
export function seoulDateKey(value=new Date()){
  const p=seoulParts(value);return `${p.year}-${pad(p.month+1)}-${pad(p.day)}`;
}
// month is zero-based, like Date; overflow is intentional for calendar navigation.
export const seoulDate=(year,month,day=1,hour=0,minute=0)=>new Date(Date.UTC(year,month,day,hour,minute)-KST);
export const seoulDayStart=value=>instant(seoulDateKey(value));
export const addSeoulDays=(value,days)=>new Date(instant(value).getTime()+days*DAY);
export const seoulClock=value=>seoulInputValue(value).slice(11);
export function formatSeoulTime(value,options={}){
  return value?new Intl.DateTimeFormat('ko-KR',{...options,timeZone:TIME_ZONE}).format(instant(value)):'';
}
export function formatMeetingTime(value,options={}){
  return formatSeoulTime(value,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',...options});
}
export function seoulInputValue(value){
  if(!value)return'';
  const p=seoulParts(value);
  return `${p.year}-${pad(p.month+1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function toSeoulISO(value){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new RangeError('올바른 일시를 입력해 주세요.');
  const date=new Date(value+':00+09:00');
  if(Number.isNaN(date.getTime())||seoulInputValue(date)!==value)throw new RangeError('올바른 일시를 입력해 주세요.');
  return date.toISOString();
}
// Meeting callers keep their existing API and use the same implementation.
export const meetingInputValue=seoulInputValue;
export const toMeetingISO=toSeoulISO;
