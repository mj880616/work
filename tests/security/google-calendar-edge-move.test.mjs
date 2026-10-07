import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';

const source=stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/google-calendar/index.ts',import.meta.url),'utf8').replace(/^import .*$/gm,''),{mode:'strip'});
const event={id:'ev',summary:'Synthetic event',start:{date:'2026-10-15'},end:{date:'2026-10-16'},extendedProperties:{private:{kptu_suborg_ids:'["org-a"]',other:'keep'}}};
const request={action:'update-event',calendar_id:'source',event_id:'ev',title:'Changed',memo:'',all_day:true,start_date:'2026-10-15',end_date:'2026-10-15'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
function harness(options={}){
  const calls=[];let handler,current=structuredClone({...event,...options.event});
  const linked=options.linked??[{id:'milestone',google_calendar_id:'source',google_event_id:'ev'}];
  const createClient=(_url,_key,config)=>{
    const scoped=config?.global?.headers?.Authorization;
    return {auth:{getUser:async()=>({data:{user:{id:'user-a'}},error:null})},from:table=>{
      const filters={};let patch=null;
      const builder={select:()=>builder,eq:(key,value)=>{filters[key]=value;return builder},in:(key,value)=>{filters[key]=value;return builder},update:value=>{patch=value;return builder},maybeSingle:async()=>({data:{access_token:'google-a',token_expires_at:new Date(Date.now()+3600000).toISOString()},error:null}),then:resolve=>{
        calls.push({table,scoped,filters:{...filters},patch});
        assert.equal(table,'app_project_milestones');assert.equal(scoped,'Bearer user-token','linkage queries must use caller JWT, never service-role authorization');
        if(patch)return resolve({data:options.zeroRows?[]:linked.map(row=>({...row,...patch})),error:options.linkFail?{message:'denied'}:null});
        return resolve({data:linked,error:options.readFail?{message:'denied'}:null});
      }};return builder;
    }};
  };
  const fetchMock=async(raw,init={})=>{
    const url=new URL(raw),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
    calls.push({path:url.pathname,method,query:Object.fromEntries(url.searchParams),body});
    if(url.pathname.endsWith('/colors'))return json({event:{}});
    if(url.pathname.includes('/calendarList'))return json({items:[{id:'source',accessRole:'owner'},{id:'target',accessRole:options.role??'writer'},...(options.moreCalendars||[])]});
    if(url.pathname.endsWith('/move')){if(options.moveFail)return json({error:{message:'move failed'}},403);assert.equal(init.body,undefined);if(options.dropPrivate)current={...current,extendedProperties:{}};return json(current)}
    if(url.pathname.endsWith('/events/ev')){
      if(method==='GET')return json(current);
      if(options.patchFail||(options.contentsFail&&body.summary))return json({error:{message:'patch failed'}},500);
      current={...current,...body};return json(current);
    }
    throw new Error('Unexpected request '+raw);
  };
  new Function('Deno','createClient','fetch',source)({env:{get:key=>({SUPABASE_URL:'https://sb.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'}[key])},serve:fn=>handler=fn},createClient,fetchMock);
  return {calls,post:async(extra={})=>{const response=await handler(new Request('https://sb.example/functions/v1/google-calendar',{method:'POST',headers:{Authorization:'Bearer user-token'},body:JSON.stringify({...request,...extra})}));return {status:response.status,body:await response.json()}}};
}

for(const target of [undefined,'source'])test('unchanged target keeps the legacy PATCH path: '+target,async()=>{
  const h=harness();const r=await h.post(target?{target_calendar_id:target}:{});
  assert.equal(r.status,200);assert.equal(r.body.event.calendarId,'source');
  assert.deepEqual(h.calls.map(c=>[c.method,c.path]),[['PATCH','/calendar/v3/calendars/source/events/ev']]);
});
test('move checks permission then moves, updates RLS-scoped linkage and patches private org metadata',async()=>{
  const h=harness();const r=await h.post({target_calendar_id:'target'});
  assert.equal(r.status,200);assert.equal(r.body.event.calendarId,'target');assert.equal(r.body.event.id,'ev');
  assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>[c.path,c.query.destination]),[['/calendar/v3/calendars/source/events/ev/move','target']]);
  const db=h.calls.find(c=>c.patch);assert.deepEqual(db.patch,{google_calendar_id:'target'});assert.equal(db.filters.google_calendar_id,'source');assert.equal(db.filters.google_event_id,'ev');
  const patch=h.calls.find(c=>c.method==='PATCH');assert.equal(patch.path,'/calendar/v3/calendars/target/events/ev');assert.equal(patch.body.extendedProperties.private.kptu_suborg_ids,'["org-a"]');assert.equal(patch.body.extendedProperties.private.other,'keep');
  assert.ok(h.calls.indexOf(db)>h.calls.findIndex(c=>c.path?.endsWith('/move')));
});
for(const role of ['reader','freeBusyReader',''])test('unwritable target is rejected before moving: '+role,async()=>{
  const h=harness({role});const r=await h.post({target_calendar_id:'target'});assert.equal(r.status,400);assert.ok(r.body.error);assert.ok(!h.calls.some(c=>c.method==='POST'||c.method==='PATCH'));
});
test('calendar not in caller calendar list is rejected',async()=>{const h=harness();const r=await h.post({target_calendar_id:'foreign'});assert.equal(r.status,400);assert.ok(!h.calls.some(c=>c.method==='POST'))});
for(const recurring of [{recurringEventId:'series'},{recurrence:['RRULE:FREQ=DAILY']}])test('recurring events cannot be moved',async()=>{const h=harness({event:recurring});const r=await h.post({target_calendar_id:'target'});assert.equal(r.status,400);assert.match(r.body.error,/반복 일정/);assert.ok(!h.calls.some(c=>c.method==='POST'))});
test('linkage read failure stops before Google move',async()=>{const h=harness({readFail:true});const r=await h.post({target_calendar_id:'target'});assert.equal(r.status,400);assert.ok(!h.calls.some(c=>c.method==='POST'))});
test('move failure leaves linkage and patch untouched',async()=>{const h=harness({moveFail:true});const r=await h.post({target_calendar_id:'target'});assert.equal(r.status,400);assert.ok(!h.calls.some(c=>c.patch||c.method==='PATCH'))});
for(const options of [{patchFail:true},{linkFail:true},{zeroRows:true}])test('post-move failure returns actual target and explicit partial failure: '+JSON.stringify(options),async()=>{
  const h=harness(options);const r=await h.post({target_calendar_id:'target',organization_ids:['org-b']});assert.equal(r.status,200);assert.equal(r.body.ok,false);assert.equal(r.body.moved,true);assert.equal(r.body.partial_failure,true);assert.equal(r.body.event.calendarId,'target');assert.match(r.body.message,/캘린더는 옮겨졌지만/);
});
test('unlinked event moves without creating a milestone',async()=>{const h=harness({linked:[]});const r=await h.post({target_calendar_id:'target'});assert.equal(r.body.ok,true);assert.ok(!h.calls.some(c=>c.patch))});

test('linkage failure still restores organization metadata',async()=>{const h=harness({linkFail:true,dropPrivate:true});const r=await h.post({target_calendar_id:'target',organization_ids:['org-b']});assert.equal(r.body.partial_failure,true);assert.deepEqual(r.body.event.organizationIds,['org-b']);assert.ok(h.calls.some(c=>c.method==='PATCH'&&c.body.extendedProperties));assert.ok(!h.calls.some(c=>c.method==='PATCH'&&c.body.summary))});

test('content failure preserves updated linkage and carried organization metadata',async()=>{const h=harness({contentsFail:true,dropPrivate:true});const r=await h.post({target_calendar_id:'target',organization_ids:['org-b']});assert.equal(r.body.failed_stage,'contents');assert.deepEqual(r.body.event.organizationIds,['org-b']);assert.ok(h.calls.some(c=>c.patch?.google_calendar_id==='target'));assert.equal(r.body.event.title,'Synthetic event')});
test('invalid patch inputs are rejected before moving',async()=>{const h=harness();const r=await h.post({target_calendar_id:'target',start_date:''});assert.equal(r.status,400);assert.ok(!h.calls.some(c=>c.method==='POST'))});
