// FORM-시간입력: one shared time entry for every Web2 form with a time.
// Time cells are text inputs with the number keypad: 0900 → 09:00, 930 → 09:30, 1405 → 14:05.
// Values keep their old shapes ("HH:MM", and "YYYY-MM-DDTHH:MM" for date-time holders),
// so the existing save paths still read `.value` unchanged. Dates stay native date pickers.
import {seoulInputValue,toSeoulISO} from './meeting-time.js?v=2';

const pad=n=>String(n).padStart(2,'0');
const HOUR=3600000;
const NATIVE_VALUE=typeof HTMLInputElement==='undefined'?null:Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
export const TIME_HINT='시각을 확인해 주세요. 숫자 4자리로 입력합니다(예: 0930 → 09:30, 00:00~23:59).';
export const DEFAULT_EVENT_SPAN=2*HOUR;

// '' for an empty cell, 'HH:MM' for a valid time, null when the time cannot be read.
export function normalizeTime(raw){
  const s=String(raw??'').trim();if(!s)return'';
  let h,m,x;
  if((x=s.match(/^(\d{1,2})[:.](\d{2})$/))){h=+x[1];m=+x[2]}
  else if(/^\d{1,4}$/.test(s)){if(s.length<=2){h=+s;m=0}else{h=+s.slice(0,-2);m=+s.slice(-2)}}
  else return null;
  return h>23||m>59?null:pad(h)+':'+pad(m);
}
// A cell is complete once it holds four digits or H:MM; shorter digits wait for the user to leave the cell.
export const completeTime=raw=>/^(\d{4}|\d{1,2}[:.]\d{2})$/.test(String(raw??'').trim());

// Korea wall clock: the end that keeps `span` after the start, rolling the date past midnight.
export function shiftedEnd(startDate,startTime,span=DEFAULT_EVENT_SPAN){
  const v=seoulInputValue(new Date(Date.parse(toSeoulISO(startDate+'T'+startTime))+span));
  return {date:v.slice(0,10),time:v.slice(11)};
}
function instant(date,time){const t=normalizeTime(time);if(!date||!t)return null;try{return Date.parse(toSeoulISO(date+'T'+t))}catch{return null}}

let hintSeq=0;
function hintFor(input,create){
  const id=input.dataset.timeHint;let hint=id&&document.getElementById(id);
  if(hint||!create)return hint||null;
  hint=document.createElement('span');hint.id='timeInputHint'+(++hintSeq);hint.className='time-input-hint';hint.setAttribute('aria-live','polite');hint.hidden=true;
  (input.closest('.dt-pair')||input).after(hint);input.dataset.timeHint=hint.id;
  input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),hint.id].filter(Boolean).join(' '));
  return hint;
}
export function paintTimeHint(input,bad){
  const hint=hintFor(input,bad);
  if(bad)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
  if(hint){hint.textContent=bad?TIME_HINT:'';hint.hidden=!bad}
}
// Tidy the cell when the user finishes it; a wrong time stays as typed with the hint below.
export function commitTime(input){
  const n=normalizeTime(input.value);
  if(n===null)return paintTimeHint(input,true);
  if(input.value!==n)input.value=n;
  paintTimeHint(input,false);
}
const isTimeCell=el=>el instanceof HTMLInputElement&&el.matches('[data-time-input]');
function installTimeCells(){
  if(window.__KPTU_TIME_INPUT__)return;window.__KPTU_TIME_INPUT__=true;
  document.addEventListener('input',e=>{
    const el=e.target;if(!isTimeCell(el))return;
    const clean=el.value.replace(/[^\d:.]/g,'').slice(0,5);if(clean!==el.value)el.value=clean;
    if(completeTime(clean)&&normalizeTime(clean)!==null)commitTime(el);
    else if(el.getAttribute('aria-invalid')==='true'&&normalizeTime(clean)!==null)paintTimeHint(el,false);
  });
  document.addEventListener('change',e=>{if(isTimeCell(e.target))commitTime(e.target)});
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&isTimeCell(e.target))commitTime(e.target)});
}

// A date-time field: `holder` is the old <input type="hidden" data-datetime-input> with the old id.
// It shows a date picker and a time cell, and its `.value` reads and writes the old "YYYY-MM-DDTHH:MM".
export function bindDateTimeFields(root=document){
  root.querySelectorAll('input[data-datetime-input]:not([data-dt-bound])').forEach(holder=>{
    holder.dataset.dtBound='1';const label=holder.dataset.datetimeInput||'일시';
    const date=document.createElement('input');date.type='date';date.id=holder.id+'Date';date.setAttribute('aria-label',label+' 날짜');
    const time=document.createElement('input');time.id=holder.id+'Time';timeCellAttributes(time,label+' 시간');
    const pair=document.createElement('span');pair.className='dt-pair';pair.append(date,time);holder.after(pair);
    const read=()=>{const d=date.value,t=time.value.trim();if(!d&&!t)return'';return d+'T'+(normalizeTime(t)||t)};
    // The holder's own value is kept in step too, for readers outside this page script (extensions, tests).
    const sync=()=>NATIVE_VALUE.set.call(holder,read());
    Object.defineProperty(holder,'value',{configurable:true,get:read,
      set(v){const [d='',t='']=String(v??'').split('T');date.value=d;time.value=t.slice(0,5);paintTimeHint(time,false);sync()}});
    [date,time].forEach(el=>['input','change'].forEach(type=>el.addEventListener(type,()=>queueMicrotask(sync))));
    sync();
  });
}
function timeCellAttributes(input,label){
  input.type='text';input.inputMode='numeric';input.autocomplete='off';input.placeholder='09:00';input.maxLength=5;input.dataset.timeInput='';
  if(label)input.setAttribute('aria-label',label);
}

// Event start → end: an untouched end follows the start by two hours; once the user sets the end,
// moving the start keeps that length. All-day events are left alone.
export function linkEventEnd({startDate,startTime,endDate,endTime,allDay}){
  const state={touched:false,before:null};
  const startAt=()=>instant(startDate.value,startTime.value),endAt=()=>instant(endDate.value,endTime.value);
  const move=()=>{
    if(allDay?.checked)return;const start=startAt();if(start==null)return;const end=endAt();
    const span=state.touched&&end!=null&&state.before!=null&&end>state.before?end-state.before:DEFAULT_EVENT_SPAN;
    const next=shiftedEnd(startDate.value,normalizeTime(startTime.value),span);
    endDate.value=next.date;endTime.value=next.time;paintTimeHint(endTime,false);state.before=start;
  };
  // Remember the last readable start, so a wrong time typed on the way does not lose the length.
  [startDate,startTime].forEach(el=>el.addEventListener('focus',()=>{state.before=startAt()??state.before}));
  startDate.addEventListener('change',move);startTime.addEventListener('change',move);
  startTime.addEventListener('input',()=>{if(completeTime(startTime.value))move()});
  [endDate,endTime].forEach(el=>['input','change'].forEach(type=>el.addEventListener(type,()=>{state.touched=true})));
  return {reset({touched=false}={}){state.touched=touched;state.before=startAt()}};
}

if(typeof document!=='undefined'){installTimeCells();bindDateTimeFields()}
