import {seoulDateKey} from './meeting-time.js';
// CAL-주간시간표: PC 주간 보기의 시간표 위치 계산만 맡는다(DOM 없음). 그리기는 calendar-week-view.js 하나가 한다.
// 1시간 = HOUR px. 0~7시는 그 주에 그 시간대 시간 일정이 없으면 FOLD px 한 줄로 접고,
// 있으면 가장 이른 일정의 시(時)부터 펼친다(그 위는 계속 접음).
export const HOUR=48,FOLD=24,MIN_HEIGHT=18,EARLY_END=7;
const PAD=2,TIME_LINE=16,TITLE_LINE=15;
const dayStartMs=key=>Date.parse(key+'T00:00:00+09:00');
const parseEnd=value=>{
  if(value instanceof Date)return value.getTime();
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?dayStartMs(value):Date.parse(value);
};
// 서울 기준 그날 0시부터 지난 분.
export function dayMinute(value){const t=value instanceof Date?value.getTime():Date.parse(value);return (t-dayStartMs(seoulDateKey(new Date(t))))/60000}
// 그날 칸 안의 시작·끝 분(0~1440). 끝이 없거나 시작보다 이르면 시작과 같게 둔다(높이는 MIN_HEIGHT가 맡음).
export function eventMinutes(ev,key){
  const base=dayStartMs(key),start=(ev.start instanceof Date?ev.start.getTime():Date.parse(ev.start));
  const endMs=parseEnd(ev.end);
  const s=Math.min(1440,Math.max(0,(start-base)/60000));
  const e=Number.isFinite(endMs)?Math.min(1440,Math.max(s,(endMs-base)/60000)):s;
  return {start:s,end:e};
}
// days: [{date:'YYYY-MM-DD', events:[{id,calendarId,start,end}]}]
export function weekTimeline(days){
  let earliest=EARLY_END*60;
  for(const day of days)for(const ev of day.events){const m=eventMinutes(ev,day.date);if(m.start<earliest)earliest=m.start}
  const firstHour=Math.max(0,Math.min(EARLY_END,Math.floor(earliest/60)));
  const collapsedHeight=firstHour>0?FOLD:0;
  const y=minute=>{
    const m=Math.min(1440,Math.max(0,minute));
    if(m<firstHour*60)return firstHour?m/(firstHour*60)*collapsedHeight:0;
    return collapsedHeight+(m-firstHour*60)/60*HOUR;
  };
  const height=Math.round(y(1440));
  const ticks=[];for(let h=firstHour;h<24;h++)ticks.push({hour:h,top:y(h*60)});
  const placed=new Map();
  for(const day of days)placed.set(day.date,layoutDay(day,y));
  return {firstHour,collapsedHeight,height,ticks,y,place:key=>placed.get(key)||new Map()};
}
// 겹침 열 나누기: 서로 이어 겹치는 일정 묶음마다 빈 열에 차례로 넣고, 묶음의 열 수로 폭을 나눈다.
function layoutDay(day,y){
  const items=day.events.map(ev=>{
    const m=eventMinutes(ev,day.date),top=y(m.start),height=Math.max(MIN_HEIGHT,y(m.end)-top);
    return {key:(ev.calendarId||'primary')+':'+ev.id,top,height,bottom:top+height};
  }).sort((a,b)=>a.top-b.top||b.height-a.height);
  const out=new Map();let group=[],groupBottom=-Infinity;
  const close=()=>{const cols=Math.max(1,...group.map(g=>g.col+1));for(const g of group)out.set(g.key,{top:g.top,height:g.height,col:g.col,cols,lines:linesFor(g.height)});group=[]};
  let columns=[];
  for(const item of items){
    if(item.top>=groupBottom){close();columns=[];groupBottom=-Infinity}
    let col=columns.findIndex(bottom=>bottom<=item.top);
    if(col<0){col=columns.length;columns.push(item.bottom)}else columns[col]=item.bottom;
    group.push({...item,col});groupBottom=Math.max(groupBottom,item.bottom);
  }
  close();
  return out;
}
// 시간 윗줄 + 제목 최대 두 줄. 칸이 낮으면 제목 한 줄, 더 낮으면 시간·제목을 한 줄에 둔다(0).
export function linesFor(height){return Math.max(0,Math.min(2,Math.floor((height-PAD-TIME_LINE)/TITLE_LINE)))}
