// FORM-시간입력: one shared time entry for every Web2 form with a time.
// Time cells are text inputs with the number keypad: 0900 → 09:00, 930 → 09:30, 1405 → 14:05.
// Values keep their old shapes ("HH:MM", and "YYYY-MM-DDTHH:MM" for date-time holders),
// so the existing save paths still read `.value` unchanged. Dates stay native date pickers.
import {seoulInputValue,toSeoulISO} from './meeting-time.js';

const pad=n=>String(n).padStart(2,'0');
const HOUR=3600000;
const NATIVE_VALUE=typeof HTMLInputElement==='undefined'?null:Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
export const TIME_HINT='시간을 확인해 주세요';
// 칸 안 흐린 글자는 칸 이름(FORM-시간숫자): 예시 값('09:00'·'10:30')은 값처럼 보여 쓰지 않는다.
export const TIME_PLACEHOLDER='시간';
export const ALL_DAY='종일';
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
// 종일을 받는 칸(timeCell allDay): '' | 'HH:MM' | '종일' | null.
export function cellTime(raw,{allDay=false}={}){const s=String(raw??'').trim();return allDay&&s===ALL_DAY?ALL_DAY:normalizeTime(s)}
const allowsAllDay=input=>input?.dataset?.timeAllDay!==undefined;
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
  (input.closest('.dt-pair, .time-cell')||input).after(hint);input.dataset.timeHint=hint.id;
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
  const n=cellTime(input.value,{allDay:allowsAllDay(input)});
  if(n===null)return paintTimeHint(input,true);
  if(input.value!==n)input.value=n;
  paintTimeHint(input,false);
}
const isTimeCell=el=>el instanceof HTMLInputElement&&el.matches('[data-time-input]');
function installTimeCells(){
  if(window.__KPTU_TIME_INPUT__)return;window.__KPTU_TIME_INPUT__=true;
  document.addEventListener('input',e=>{
    const el=e.target;if(!isTimeCell(el))return;
    if(allowsAllDay(el)&&el.value===ALL_DAY)return paintTimeHint(el,false);
    const clean=el.value.replace(/[^\d:.]/g,'').slice(0,5);if(clean!==el.value)el.value=clean;
    if(completeTime(clean)&&normalizeTime(clean)!==null)commitTime(el);
    else if(el.getAttribute('aria-invalid')==='true'&&normalizeTime(clean)!==null)paintTimeHint(el,false);
  });
  // Entering a time cell selects the whole time, so typing overwrites it. The press that gave the focus would
  // drop the selection on release (mobile browsers place the caret then), so that one release is cancelled.
  let fresh=null;
  document.addEventListener('focusin',e=>{const el=e.target;if(!isTimeCell(el))return;fresh=el;el.select();setTimeout(()=>{if(fresh===el&&document.activeElement===el)el.select()},0)});
  document.addEventListener('focusout',e=>{if(fresh===e.target)fresh=null});
  document.addEventListener('keydown',()=>{fresh=null});
  ['mouseup','touchend'].forEach(type=>document.addEventListener(type,e=>{const el=e.target;if(fresh&&el===fresh){fresh=null;if(e.cancelable)e.preventDefault();el.select()}}));
  document.addEventListener('change',e=>{if(isTimeCell(e.target))commitTime(e.target)});
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&isTimeCell(e.target))commitTime(e.target)});
}

// 날짜 칸에 보이는 글자: 'YYYY-MM-DD'(PC·폰 같음). 비면 '날짜' 안내.
export function dateDisplay(value){return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'날짜'}

// A date-time field: `holder` is the old <input type="hidden" data-datetime-input> with the old id.
// It shows a date picker and a time cell, and its `.value` reads and writes the old "YYYY-MM-DDTHH:MM".
export function bindDateTimeFields(root=document){
  root.querySelectorAll('input[data-datetime-input]:not([data-dt-bound])').forEach(holder=>{
    holder.dataset.dtBound='1';const label=holder.dataset.datetimeInput||'일시';
    const date=document.createElement('input');date.type='date';date.id=holder.id+'Date';date.setAttribute('aria-label',label+' 날짜');
    const time=document.createElement('input');time.id=holder.id+'Time';timeCellAttributes(time,label+' 시간');
    // 보이는 날짜 글자는 기기마다 다른 type=date 기본 표기 대신 앱이 한 가지('YYYY-MM-DD')로 그리고, 기기 달력 입력은 그 위에 투명하게 겹친다(dateText).
    const dateBox=document.createElement('span');dateBox.className='dt-date';const dateText=document.createElement('span');dateText.className='dt-date-text';dateText.setAttribute('aria-hidden','true');dateBox.append(dateText,date);
    const paintDate=()=>{dateText.textContent=dateDisplay(date.value);dateBox.classList.toggle('is-empty',!date.value)};
    date.addEventListener('input',paintDate);date.addEventListener('change',paintDate);paintDate();
    const pair=document.createElement('span');pair.className='dt-pair';pair.append(dateBox,time);holder.after(pair);
    const read=()=>{const d=date.value,t=time.value.trim();if(!d&&!t)return'';return d+'T'+(normalizeTime(t)||t)};
    // The holder's own value is kept in step too, for readers outside this page script (extensions, tests).
    const sync=()=>NATIVE_VALUE.set.call(holder,read());
    Object.defineProperty(holder,'value',{configurable:true,get:read,
      set(v){const [d='',t='']=String(v??'').split('T');date.value=d;paintDate();time.value=t.slice(0,5);paintTimeHint(time,false);sync()}});
    [date,time].forEach(el=>['input','change'].forEach(type=>el.addEventListener(type,()=>queueMicrotask(sync))));
    sync();
  });
}
function timeCellAttributes(input,label){
  input.type='text';input.inputMode='numeric';input.autocomplete='off';input.placeholder=TIME_PLACEHOLDER;input.maxLength=5;input.dataset.timeInput='';
  if(label)input.setAttribute('aria-label',label);
}

// FORM-시간숫자: 화면이 직접 만드는 시간 칸 하나(주간보고 상자 5. 주요 일정, [주간 정리] 2) 주요 일정·1) 임원 배정 요청 표).
// 숫자 자판 글 칸에 위 공용 맞춤(1030 → 10:30, 930 → 09:30, 9 → 09:00, 틀리면 칸 아래 '시간을 확인해 주세요')을 그대로 쓴다.
// allDay면 칸 옆 작은 [종일] 버튼: 누르면 칸 값이 '종일'(칸은 읽기만), 다시 누르면 누르기 전 시간으로 돌아온다.
// 버튼은 칸에 input·change 이벤트를 보내므로, 화면은 지금처럼 칸의 input·change만 들으면 된다. 돌려주는 것: 화면에 붙일 노드.
export function timeCell(input,{label='',allDay=false}={}){
  timeCellAttributes(input,label);
  if(!allDay)return input;
  input.dataset.timeAllDay='';
  const doc=input.ownerDocument||document;
  const box=doc.createElement('span');box.className='time-cell';
  const toggle=doc.createElement('button');toggle.type='button';toggle.className='mini time-all-day';toggle.textContent=ALL_DAY;toggle.dataset.timeAllDayToggle='';
  toggle.setAttribute('aria-label',`${label||'시간'} ${ALL_DAY}`);
  const paint=()=>{const on=input.value.trim()===ALL_DAY;toggle.setAttribute('aria-pressed',on?'true':'false');input.readOnly=on;toggle.disabled=input.disabled};
  toggle.addEventListener('click',()=>{
    if(input.disabled)return;
    if(input.value.trim()===ALL_DAY){input.value=input.dataset.timeBefore||'';delete input.dataset.timeBefore}
    else{const before=normalizeTime(input.value);if(before)input.dataset.timeBefore=before;input.value=ALL_DAY}
    paintTimeHint(input,false);paint();
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    if(!input.readOnly)input.focus();
  });
  paint();box.append(input,toggle);
  return box;
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
