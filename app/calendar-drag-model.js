import {seoulDateKey,seoulClock,seoulParts,addSeoulDays} from './meeting-time.js';
// CAL-끌어옮기기: 달력에서 일정을 끌어 옮길 때의 계산만 맡는다(DOM 없음). 끌기 처리는 calendar-drag.js, 미리보기 그리기는
// 주간(calendar-week-view.js)·월간(calendar-month-view.js) renderer, 저장은 일정 수정 창과 같은 calendar-interactions-v2.js 경로다.
// 일정 값은 Google 원래 모양 그대로 다룬다: 시간 일정 start·end = ISO 시각, 종일 일정 start = 'YYYY-MM-DD', end = 다음 날(배타적).
export const STEP=15,DAY_MINUTES=1440;
const MIN=60000,DAY=86400000;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const dayMs=key=>Date.parse(key+'T00:00:00+09:00');
const shiftDate=(key,days)=>seoulDateKey(addSeoulDays(key,days));
const ms=v=>v instanceof Date?v.getTime():DATE.test(String(v||''))?dayMs(v):Date.parse(v);
const iso=t=>new Date(t).toISOString();
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
// 15분 단위로 가장 가까운 칸(반올림).
export function snap(minutes,step=STEP){return Math.round(minutes/step)*step}
export const isAllDay=ev=>!!ev?.allDay||DATE.test(String(ev?.start||''));

// 수정 창과 같은 권한 기준: 그 일정의 캘린더가 owner·writer일 때만 끌 수 있다(calendar-interactions-v2.js ciPopulateGoogleCalendars).
export function canDrag(calendarId,state){
  const id=calendarId||'primary';
  const cal=(state?.calendars||[]).find(c=>c.id===id||(id==='primary'&&c.primary));
  return !!cal&&['owner','writer'].includes(cal.accessRole);
}

// 시간 일정 옮기기: dayDelta일 옆으로, 시작 시각은 (원래 시작 분 + minuteDelta)를 15분 칸에 맞춘다. 길이는 그대로.
// 시작은 그날 0:00~23:45 안이고, 끝은 자정을 넘을 수 있다(다음 날로 이어지는 일정).
export function moveTimed(ev,{dayDelta=0,minuteDelta=0}={}){
  const start=ms(ev.start),end=ms(ev.end),key=seoulDateKey(new Date(start));
  const startMin=(start-dayMs(key))/MIN,length=Math.max(0,end-start);
  const next=clamp(snap(startMin+minuteDelta),0,DAY_MINUTES-STEP);
  const s=dayMs(shiftDate(key,dayDelta))+next*MIN;
  return {allDay:false,start:iso(s),end:iso(s+length)};
}
// 시간 일정 끝 끌기: 끝 시각만 15분 칸에 맞춰 바꾼다. 시작 + 15분 ~ 그날 24:00.
export function resizeTimed(ev,{minuteDelta=0}={}){
  const start=ms(ev.start),end=ms(ev.end),base=dayMs(seoulDateKey(new Date(start)));
  const startMin=(start-base)/MIN,endMin=(end-base)/MIN;
  const next=clamp(snap(endMin+minuteDelta),Math.ceil((startMin+1)/STEP)*STEP,DAY_MINUTES);
  return {allDay:false,start:iso(start),end:iso(base+next*MIN)};
}
// 종일·여러 날 띠 옮기기: 시작·끝을 같은 날 수만큼 옮긴다(시간 있는 여러 날 일정은 시각 유지).
export function moveBand(ev,{dayDelta=0}={}){
  if(isAllDay(ev))return {allDay:true,start:shiftDate(ev.start,dayDelta),end:shiftDate(ev.end||shiftDate(ev.start,1),dayDelta)};
  return {allDay:false,start:iso(ms(ev.start)+dayDelta*DAY),end:iso(ms(ev.end)+dayDelta*DAY)};
}
// 띠 끝 끌기: 끝 날짜만 바꾼다. 종일은 하루 이상, 시간 있는 여러 날 일정은 끝이 시작보다 뒤여야 한다(아니면 null = 놓을 수 없음).
export function resizeBand(ev,{dayDelta=0}={}){
  if(isAllDay(ev)){
    const end=ev.end||shiftDate(ev.start,1),next=shiftDate(end,dayDelta);
    return {allDay:true,start:ev.start,end:dayMs(next)>dayMs(ev.start)?next:shiftDate(ev.start,1)};
  }
  const s=ms(ev.start),e=ms(ev.end)+dayDelta*DAY;
  return e>s?{allDay:false,start:iso(s),end:iso(e)}:null;
}
// 월간: 다른 날로 옮기기(시간·길이 유지). 종일·시간 모두 날 수만 옮긴다.
export function moveDays(ev,dayDelta){return isAllDay(ev)?moveBand(ev,{dayDelta}):{allDay:false,start:iso(ms(ev.start)+dayDelta*DAY),end:iso(ms(ev.end)+dayDelta*DAY)}}
export function dayDiff(fromKey,toKey){return Math.round((dayMs(toKey)-dayMs(fromKey))/DAY)}

// 되돌리기 값: 옮기기 전 일정의 시작·끝 그대로.
export function original(ev){return isAllDay(ev)?{allDay:true,start:String(ev.start),end:String(ev.end||shiftDate(ev.start,1))}:{allDay:false,start:iso(ms(ev.start)),end:iso(ms(ev.end))}}
export function same(ev,next){const a=original(ev);return !!next&&a.allDay===next.allDay&&(a.allDay?a.start===next.start&&a.end===next.end:ms(a.start)===ms(next.start)&&ms(a.end)===ms(next.end))}

// 수정 창 [변경사항 저장]과 같은 update-event 요청 본문. 제목·메모·장소·담당조직은 Google에서 방금 읽은 값 그대로 보내
// 시간·날짜만 바뀐다(색상은 보내지 않아 그대로, 캘린더도 그대로). 종일 end_date는 수정 창처럼 마지막 날(포함)이다.
export function updateBody(fresh,next){
  const body={action:'update-event',calendar_id:fresh.calendarId||'primary',event_id:fresh.id,title:fresh.title||'',memo:fresh.description||'',location:fresh.location||'',all_day:!!next.allDay,organization_ids:[...(fresh.organizationIds||[])]};
  if(next.allDay){body.start_date=next.start;body.end_date=shiftDate(next.end,-1)}
  else{body.start_date=seoulDateKey(new Date(ms(next.start)));body.end_date=seoulDateKey(new Date(ms(next.end)));body.start_iso=iso(ms(next.start));body.end_iso=iso(ms(next.end))}
  return body;
}

// 끄는 동안 카드에 보일 바뀔 시간.
const md=key=>{const p=seoulParts(key);return `${p.month+1}월 ${p.day}일`};
export function label(next){
  if(!next)return '';
  if(next.allDay){const last=shiftDate(next.end,-1);return last===next.start?md(next.start):`${md(next.start)}–${md(last)}`}
  const s=new Date(ms(next.start)),e=new Date(ms(next.end)),sk=seoulDateKey(s),ek=seoulDateKey(e);
  const endText=ek===sk||(ek===shiftDate(sk,1)&&seoulClock(e)==='00:00')?(seoulClock(e)==='00:00'&&ek!==sk?'24:00':seoulClock(e)):`${md(ek)} ${seoulClock(e)}`;
  return `${seoulClock(s)}–${endText}`;
}
