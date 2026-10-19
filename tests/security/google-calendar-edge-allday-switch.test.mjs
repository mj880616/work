import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

// BUG-일정시간전환: Google Calendar PATCH merges nested objects (start/end) field by field and
// clears a field only when it is sent as null. A start holding both date and dateTime is rejected
// with "Invalid start time". This fake applies those documented rules to the production handler.
const source=stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/google-calendar/index.ts',import.meta.url),'utf8').replace(/^import .*$/gm,''),{mode:'strip'});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function merge(base,patch){
  const out={...base};
  for(const [k,v] of Object.entries(patch)){
    if(v===null)delete out[k];
    else if(v&&typeof v==='object'&&!Array.isArray(v)&&base?.[k]&&typeof base[k]==='object')out[k]=merge(base[k],v);
    else out[k]=v;
  }
  return out;
}
function bothForms(edge){return edge&&edge.date!==undefined&&edge.dateTime!==undefined}
function harness(initial){
  let handler,current=structuredClone(initial);const calls=[];
  const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'user-a'}},error:null})},from:()=>{const b={select:()=>b,eq:()=>b,in:()=>b,update:()=>b,maybeSingle:async()=>({data:{access_token:'synthetic',token_expires_at:new Date(Date.now()+3600000).toISOString()},error:null}),then:resolve=>resolve({data:[],error:null})};return b}});
  const fetchMock=async(raw,init={})=>{
    const url=new URL(raw),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({path:url.pathname,method,body});
    if(url.pathname.endsWith('/colors'))return json({event:{}});
    if(url.pathname.includes('/calendarList'))return json({items:[{id:'source',accessRole:'owner'},{id:'target',accessRole:'writer'}]});
    if(url.pathname.endsWith('/move'))return json(current);
    if(url.pathname.endsWith('/events/ev')){
      if(method==='GET')return json(current);
      const next=merge(current,body);
      if(bothForms(next.start))return json({error:{code:400,message:'Invalid start time.'}},400);
      if(bothForms(next.end))return json({error:{code:400,message:'Invalid end time.'}},400);
      current=next;return json(current);
    }
    throw new Error('Unexpected request '+raw);
  };
  new Function('Deno','createClient','fetch',source)({env:{get:key=>({SUPABASE_URL:'https://sb.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-public'}[key])},serve:fn=>handler=fn},createClient,fetchMock);
  return {calls,get event(){return current},post:async body=>{const r=await handler(new Request('https://sb.example/functions/v1/google-calendar',{method:'POST',headers:{Authorization:'Bearer user-token'},body:JSON.stringify({action:'update-event',calendar_id:'source',event_id:'ev',title:'합성 일정',memo:'',...body})}));return {status:r.status,body:await r.json()}}};
}
const allDay={id:'ev',summary:'합성 일정',start:{date:'2026-10-23'},end:{date:'2026-10-24'}};
const timed={id:'ev',summary:'합성 일정',start:{dateTime:'2026-10-23T10:30:00+09:00',timeZone:'Asia/Seoul'},end:{dateTime:'2026-10-23T12:30:00+09:00',timeZone:'Asia/Seoul'}};
const toTimed={all_day:false,start_date:'2026-10-23',end_date:'2026-10-23',start_iso:'2026-10-23T01:30:00.000Z',end_iso:'2026-10-23T03:30:00.000Z'};
const toAllDay={all_day:true,start_date:'2026-10-23',end_date:'2026-10-23'};

test('all-day event switched to timed saves and leaves no date field',async()=>{
  const h=harness(allDay);const r=await h.post(toTimed);
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);assert.equal(r.body.event.allDay,false);
  assert.equal(r.body.event.start,'2026-10-23T01:30:00.000Z');assert.equal(r.body.event.end,'2026-10-23T03:30:00.000Z');
  assert.equal(h.event.start.date,undefined);assert.equal(h.event.end.date,undefined);
  const patch=h.calls.find(c=>c.method==='PATCH');assert.deepEqual(patch.body.start,{dateTime:'2026-10-23T01:30:00.000Z',date:null});
});
test('timed event switched to all-day saves and leaves no dateTime field',async()=>{
  const h=harness(timed);const r=await h.post(toAllDay);
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.event.allDay,true);
  assert.equal(r.body.event.start,'2026-10-23');assert.equal(r.body.event.end,'2026-10-24');
  assert.equal(h.event.start.dateTime,undefined);assert.equal(h.event.end.dateTime,undefined);
});
test('same-kind edits keep working: timed to timed, all-day to all-day',async()=>{
  const a=harness(timed);assert.equal((await a.post(toTimed)).body.ok,true);
  const b=harness(allDay);assert.equal((await b.post({...toAllDay,end_date:'2026-10-24'})).body.event.end,'2026-10-25');
});
test('all-day to timed while moving calendars patches the destination without both forms',async()=>{
  const h=harness(allDay);const r=await h.post({...toTimed,target_calendar_id:'target'});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);assert.equal(r.body.event.calendarId,'target');assert.equal(r.body.event.allDay,false);
});
test('the fake reproduces the reported failure for the old payload (dateTime without date:null)',()=>{
  const merged=merge(allDay,{start:{dateTime:'2026-10-23T01:30:00.000Z'},end:{dateTime:'2026-10-23T03:30:00.000Z'}});
  assert.equal(bothForms(merged.start),true);
});
test('a rejected update answers HTTP 400 with the original message, which the screen treats as "not saved"',async()=>{
  const h=harness(allDay);const r=await h.post({...toTimed,start_iso:'',end_iso:''});
  assert.equal(r.status,400);assert.equal(typeof r.body.error,'string');assert.equal(h.calls.filter(c=>c.method==='PATCH').length,0);
});
