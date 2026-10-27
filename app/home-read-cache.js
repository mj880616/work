import {dayKey} from './home-read-model.js';
const MAX_BYTES=20*1024,MAX_AGE=7*86400000;
const text=v=>typeof v==='string'?v:'';
// Persist display projections only. Google Tasks keeps its own task-body copy.
function project(key,value){
  if(!value||typeof value!=='object')return null;
  if(key==='tasks')return Array.isArray(value.names)?{
    names:value.names.map(r=>({id:text(r.id),names:Array.isArray(r.names)?r.names.map(text):[]})),
  }:null;
  if(!Array.isArray(value.rows))return null;
  if(key==='dday')return {rows:value.rows.slice(0,3).map(r=>({project_id:text(r.project_id),project_name:text(r.project_name),title:text(r.title),date:text(r.date)}))};
  if(key==='calendar')return value.rows.every(r=>typeof r?.start==='string'&&typeof r?.end==='string'&&Number.isFinite(Date.parse(r.start))&&Number.isFinite(Date.parse(r?.end))&&Date.parse(r.end)>Date.parse(r.start))?{day:text(value.day),rows:value.rows.map(r=>({id:text(r.id),calendarId:text(r.calendarId),start:text(r.start),end:text(r.end),allDay:!!r.allDay,title:text(r.title),color:text(r.color)}))}:null;
  if(key==='meetings')return {rows:value.rows.map(r=>({id:text(r.id),title:text(r.title),meetingName:text(r.meetingName)}))};
  return null;
}
export function createHomeCache({storage,keyPrefix,context}){
  function read(now=Date.now()){
    try{
      const ctx=context();if(!ctx?.owner||!ctx.workspaceId)return {};
      const raw=storage.getItem(keyPrefix+ctx.owner);
      if(!raw||new TextEncoder().encode(raw).length>MAX_BYTES)return {};
      const v=JSON.parse(raw);
      if(v?.version!==1||v.owner!==ctx.owner||v.workspaceId!==ctx.workspaceId||!Number.isFinite(v.savedAt)||!v.cards)return {};
      const out={};
      for(const [key,card] of Object.entries(v.cards)){
        const age=now-card?.savedAt;
        if(!Number.isFinite(card?.savedAt)||age<0||age>=MAX_AGE)continue;
        if(key==='calendar'&&card.day!==dayKey(now))continue;
        const clean=project(key,card);if(clean)out[key]={...clean,savedAt:card.savedAt};
      }
      return out;
    }catch{return {}}
  }
  function save(key,value,now=Date.now()){
    try{
      const ctx=context(),clean=project(key,value);if(!ctx?.owner||!ctx.workspaceId||!clean)return;
      const cards={...read(now),[key]:{...clean,savedAt:now}};
      const raw=JSON.stringify({version:1,owner:ctx.owner,workspaceId:ctx.workspaceId,savedAt:now,cards});
      if(new TextEncoder().encode(raw).length<=MAX_BYTES)storage.setItem(keyPrefix+ctx.owner,raw);
    }catch{}
  }
  // CAL-저장본먼저: change one saved card in place (the calendar drops an event deleted in Web2 from the home copy).
  function update(key,fn,now=Date.now()){const card=read(now)[key];if(card)save(key,fn(card),card.savedAt)}
  return {read,save,update};
}
