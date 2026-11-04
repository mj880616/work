import test from 'node:test';
import assert from 'node:assert/strict';

// MTG-프로젝트합치기 사업영역 AI: the real ai-assist handler, kind=area_suggest (area_week_summary was removed in S49-39), with a synthetic Supabase
// (Auth + PostgREST with owner RLS) and a mocked OpenAI. No network, no real key, synthetic text only.
// - area_suggest: the write window sends title and text; the server offers up to three of the owner's business areas. Nothing is stored.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const ba=await import('../../supabase/functions/ai-assist/business-area.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW=Date.parse('2026-10-28T03:00:00Z'),WEEK='2026-10-26';
const ROOT=id(1),AREA_A=id(2),AREA_B=id(3),ARCHIVED=id(4),LOOSE=id(5),FOREIGN=id(6);
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const aiText=obj=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(obj)}]}],usage:{input_tokens:900,output_tokens:60}});
const space=(sid,name,extra={})=>({id:sid,workspace_id:WS,owner_id:OWNER,name,parent_id:null,status:'active',metadata:{},sort_order:0,created_at:'2026-01-01T00:00:00Z',...extra});
const meeting=(n,extra={})=>({id:id(100+n),workspace_id:WS,business_area_id:null,project_id:null,title:`가상 보고 ${n}`,series_name:`가상 보고 ${n}`,
  meeting_at:'2026-10-27T01:00:00.000Z',transcript_text:'가상 결과: 면담에서 요구안을 전달함. 연락 010-1234-5678',decisions:'',notes:'',activity_kind:'meeting',next_plan:'후속 면담 일정 잡기',updated_at:'2026-10-27T02:00:00.000Z',...extra});

function harness({openai=null,usage=[],spaces=null,meetings=null,requests=null,noDraftTable=false,noAreaColumn=false}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_spaces:spaces||[space(ROOT,'가상 큰 사업',{metadata:{project_system:'v2'}}),space(AREA_A,'가상 세부 과제 가',{parent_id:ROOT}),
      space(AREA_B,'가상 세부 과제 나',{parent_id:ROOT}),space(ARCHIVED,'가상 보관 과제',{parent_id:ROOT,status:'archived'}),space(LOOSE,'v2 아닌 옛 묶음'),
      {...space(FOREIGN,'남의 과제',{metadata:{project_system:'v2'}}),workspace_id:OTHER_WS,owner_id:STRANGER}],
    app_meetings:meetings||[meeting(1,{business_area_id:AREA_A}),meeting(2,{project_id:AREA_A}),meeting(3,{project_id:AREA_B,business_area_id:ROOT}),
      meeting(4,{business_area_id:AREA_A,meeting_at:'2026-11-03T01:00:00.000Z'})],
    app_weekly_exec_requests:requests??[{id:id(900),workspace_id:WS,week_start:WEEK,items:[{text:'가상 요청'}],draft:{v:1,base:null,me:'',me_from:'',date:'',rows:[{section:'summary',key:'가›나',n:0,lines:['고친 줄']}],titles:[],issued:{at:'x',from:'generated',lines:[]}},draft_saved_at:'2026-10-27T05:00:00.000Z',updated_at:'2026-10-27T00:00:00.000Z'}],
    app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val
    :op==='is'?(val==='null'?v==null:String(v)===val):op==='in'?val.replace(/^\(|\)$/g,'').split(',').includes(String(v)):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1),db):respond(aiText({items:[{ref:'a1',summary:'가상 면담으로 요구안 전달'}]}));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    if(table==='app_weekly_exec_requests'&&noDraftTable)return respond({message:'missing'},404);
    if(table==='app_meetings'&&noAreaColumn)return respond({code:'42703',message:'column does not exist'},400);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_weekly_exec_requests'&&method==='PATCH'){
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['draft','draft_saved_at'],'only the draft and its stamp are written');
      const hit=rows.filter(r=>visible(table,r,uid)&&matches(r,url));hit.forEach(r=>Object.assign(r,b));return respond(hit.map(r=>({id:r.id})));
    }
    if(table==='app_weekly_exec_requests'&&method==='POST'){
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['draft','draft_saved_at','items','week_start','workspace_id']);
      if(b.workspace_id!==WS)return respond({},403);
      if(rows.some(r=>r.workspace_id===b.workspace_id&&r.week_start===b.week_start))return respond({code:'23505'},409);
      rows.push({id:id(901),...b});return respond([{id:id(901)}],201);
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const summary=(h,ids=[AREA_A,AREA_B])=>post(h.handler,{kind:'area_week_summary',week_start:WEEK,area_ids:ids});

test('area_week_summary: S49-39 — removed. The kind is refused, no AI call, no usage line, no draft write, and the limit table no longer lists it',async()=>{
  const h=harness();
  const before=structuredClone(h.db.app_weekly_exec_requests);
  const r=await summary(h);
  assert.equal(r.status,400);
  assert.equal(h.calls.openai.length,0);
  assert.equal(h.db.app_ai_daily_usage.length,0);
  assert.deepEqual(h.db.app_weekly_exec_requests,before,'the stored draft (including old area_summaries) is untouched');
  assert.equal(Object.hasOwn(DAILY_LIMITS,'area_week_summary'),false);
  for(const name of ['parseAreaWeekRequest','areaSummaryMaterial','parseAreaSummary','withAreaSummaries','readAreaSummaries','reportOf','packAreas'])assert.equal(ba[name],undefined,name);
});

test('area_suggest: up to three of the owner\'s active business areas, unknown refs dropped, nothing stored',async()=>{
  const h=harness({openai:body=>{
    const m=JSON.parse(body.input[1].content);
    const ref=name=>m.areas.find(a=>a.name===name).ref;
    return respond(aiText({refs:[ref('가상 큰 사업 › 가상 세부 과제 나'),'r99',ref('가상 큰 사업'),ref('가상 큰 사업 › 가상 세부 과제 가'),ref('가상 큰 사업 › 가상 세부 과제 나')]}));
  }});
  const res=await post(h.handler,{kind:'area_suggest',title:'가상 국토부 면담',text:'민자철도 요구안 전달\n연락 010-1234-5678 / a@b.example\n다음 할 일: 후속 면담'});
  assert.equal(res.status,200);
  const got=await res.json();
  assert.deepEqual(got,{ok:true,kind:'area_suggest',suggestions:[
    {id:AREA_B,name:'가상 큰 사업 › 가상 세부 과제 나'},{id:ROOT,name:'가상 큰 사업'},{id:AREA_A,name:'가상 큰 사업 › 가상 세부 과제 가'}]});
  const o=h.calls.openai[0];
  assert.equal(o.text.format.name,'area_suggest');assert.equal(o.store,false);
  const m=JSON.parse(o.input[1].content);
  assert.deepEqual(m.areas.map(a=>a.name).sort(),['가상 큰 사업','가상 큰 사업 › 가상 세부 과제 가','가상 큰 사업 › 가상 세부 과제 나'].sort(),'archived, non-v2 and other owners\' areas are not offered');
  assert.ok(!o.input[1].content.includes('010-1234-5678')&&!o.input[1].content.includes('a@b.example'),'contacts are not sent');
  assert.ok(h.calls.rest.every(c=>c.method==='GET'||c.table==='app_ai_daily_usage'),'only usage is written');
  assert.equal(h.db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/국토부|민자철도|가상/.test(JSON.stringify(h.calls.logs)));
});

test('area_suggest: secret-looking or too short text and no areas skip AI; shapes and body size are checked',async()=>{
  for(const [body,reason,opts] of [
    [{title:'',text:'와이파이 비밀번호: hunter2-가상'},'secret',{}],
    [{title:'가',text:''},'short',{}],
    [{title:'가상 면담',text:'요구안 전달'},'no_areas',{spaces:[space(LOOSE,'v2 아닌 옛 묶음')]}],
  ]){
    const h=harness(opts);
    const r=await post(h.handler,{kind:'area_suggest',...body});
    assert.deepEqual(await r.json(),{ok:true,kind:'area_suggest',suggestions:[],skipped:reason});
    assert.equal(h.calls.openai.length,0);assert.equal(h.db.app_ai_daily_usage.length,0);
  }
  const h=harness({openai:()=>respond(aiText({refs:[]}))});
  const long=await post(h.handler,{kind:'area_suggest',title:'가상 면담',text:'가'.repeat(2500)});
  assert.equal(long.status,200,'this use reads up to 16KB (Korean text over the usual 2KB)');
  assert.deepEqual((await long.json()).suggestions,[]);
  for(const body of [{kind:'area_suggest',title:'가'},{kind:'area_suggest',title:'가상',text:'x',meeting_id:id(1)},{kind:'area_suggest',title:'가'.repeat(201),text:''},
    {kind:'area_suggest',title:'',text:''},{kind:'area_suggest',title:1,text:'x'}]){
    const r=await post(h.handler,body);assert.equal(r.status,400,JSON.stringify(body));
  }
  const tooBig=await post(h.handler,{kind:'area_suggest',title:'가',text:'가'.repeat(6000)});
  assert.equal(tooBig.status,413);
  const other=await post(h.handler,{kind:'note_title',id:id(1),pad:'가'.repeat(1000)});
  assert.ok([400,413].includes(other.status),'other uses keep the 2KB body limit');
});
