function pad(n){return String(n).padStart(2,'0')}
function toLocalInput(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}
function clickedDate(cell){
  const grid=document.querySelector('#calendarGrid');
  if(!grid)return null;
  const cells=[...grid.querySelectorAll('.cal-cell')];
  const idx=cells.indexOf(cell);
  if(idx<0)return null;
  const title=document.querySelector('#monthTitle')?.textContent||'';
  const m=title.match(/(\d{4})년\s*(\d{1,2})월/);
  if(!m)return null;
  const y=Number(m[1]),month=Number(m[2])-1;
  const first=new Date(y,month,1);
  const start=new Date(first);
  start.setDate(1-first.getDay());
  const d=new Date(start);
  d.setDate(start.getDate()+idx);
  d.setHours(9,0,0,0);
  return d;
}
function openTeamEventForDate(d){
  const btn=document.querySelector('#newEventBtn');
  if(!btn)return;
  btn.click();
  const start=document.querySelector('#eventStart');
  const end=document.querySelector('#eventEnd');
  const finish=new Date(d.getTime()+60*60*1000);
  if(start)start.value=toLocalInput(d);
  if(end)end.value=toLocalInput(finish);
  setTimeout(()=>document.querySelector('#eventTitle')?.focus(),0);
}
document.addEventListener('click',e=>{
  const cell=e.target.closest?.('#calendarGrid .cal-cell');
  if(!cell)return;
  if(e.target.closest('.cal-event,button,a,input,select,textarea'))return;
  const d=clickedDate(cell);
  if(d)openTeamEventForDate(d);
});
const style=document.createElement('style');
style.textContent='#calendarGrid .cal-cell{cursor:pointer}#calendarGrid .cal-cell:hover{outline:1px solid rgba(23,50,77,.18);outline-offset:-1px}';
document.head.appendChild(style);
