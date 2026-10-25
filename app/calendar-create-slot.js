import {seoulDateKey,addSeoulDays} from './meeting-time.js';
// CAL-빈칸시간채우기: 달력 빈칸을 눌러(또는 끌어) 일정 만들기 창을 열 때 미리 넣을 날짜·시간 계산만 맡는다(DOM 없음).
// 창에 값을 채우는 일은 calendar-interactions-v2.js 하나가 한다. 15분 단위는 끌어옮기기(calendar-drag-model.js)와 같다.
export const SLOT_STEP=15,DEFAULT_SPAN=60,DAY_MINUTES=1440;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const pad=n=>String(n).padStart(2,'0');
// 눌린 높이 → 그날 0시부터의 분. top = 시간표 안쪽 맨 위의 화면 높이, hourPx = 1시간의 화면 높이.
export function minuteAtY(clientY,top,hourPx){return (clientY-top)/hourPx*60}
// 누른 자리가 속한 15분 칸의 시작(15시 칸 안 어디든 15:00, 15:40이면 15:30). 그날 0:00~23:45 안.
export function slotStart(minute){return clamp(Math.floor(minute/SLOT_STEP)*SLOT_STEP,0,DAY_MINUTES-SLOT_STEP)}
// 끌어 고른 범위 끝: 올림해서 끝 칸까지 포함한다.
export function slotEnd(minute){return clamp(Math.ceil(minute/SLOT_STEP)*SLOT_STEP,SLOT_STEP,DAY_MINUTES)}
// 날짜 키 + 분 → 날짜·시각(자정을 넘으면 다음 날 00:xx).
function at(date,minutes){
  const days=Math.floor(minutes/DAY_MINUTES),rest=minutes-days*DAY_MINUTES;
  return {date:days?seoulDateKey(addSeoulDays(date,days)):date,time:`${pad(Math.floor(rest/60))}:${pad(rest%60)}`};
}
// 한 번 누름: 누른 칸 시작부터 기본 1시간.
export function clickSlot(date,minute){
  const s=slotStart(minute),a=at(date,s),b=at(date,s+DEFAULT_SPAN);
  return {kind:'time',startDate:a.date,startTime:a.time,endDate:b.date,endTime:b.time};
}
// 끌어서 범위 고르기: 위아래 어느 쪽으로 끌어도 같다. 적어도 한 칸(15분).
export function rangeSlot(date,fromMinute,toMinute){
  const lo=Math.min(fromMinute,toMinute),hi=Math.max(fromMinute,toMinute);
  const s=slotStart(lo),e=Math.max(slotEnd(hi),s+SLOT_STEP),a=at(date,s),b=at(date,e);
  return {kind:'time',startDate:a.date,startTime:a.time,endDate:b.date,endTime:b.time};
}
// 주간 맨 위 종일 칸: 그날 종일(종료일은 수정 창처럼 마지막 날 포함 = 같은 날).
export function allDaySlot(date){return {kind:'allday',startDate:date,endDate:date}}
// 월간 날짜 칸: 누를 시간 자리가 없으므로 날짜만 그 칸 것으로 하고 시간은 예전과 같은 오전 9시~10시.
export const DEFAULT_START_MINUTE=9*60;
export function dateSlot(date){return clickSlot(date,DEFAULT_START_MINUTE)}
