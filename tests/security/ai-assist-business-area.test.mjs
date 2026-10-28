import test from 'node:test';
import assert from 'node:assert/strict';

// MTG-프로젝트합치기 사업영역 AI: the real ai-assist handler, kind=area_week_summary and kind=area_suggest, with a synthetic Supabase
// (Auth + PostgREST with owner RLS) and a mocked OpenAI. No network, no real key, synthetic text only.
// - area_week_summary: the screen sends a week and business-area ids; the server reads that week's reports with the caller's token
//   (directly tagged only, like the preview table and weekly ②), makes one line per area, keeps it in the week's draft
//   (app_weekly_exec_requests.draft.area_summaries) under the draft_saved_at guard, never sends or overwrites an edited line,
//   and does not call AI again while the reports are unchanged.
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

test('area_week_summary: one AI call over that week\'s tagged reports, the line kept in the week draft (other draft parts untouched), usage counted',async()=>{
  const h=harness();
  const res=await summary(h);
  assert.equal(res.status,200);
  const got=await res.json();
  assert.deepEqual(got,{ok:true,kind:'area_week_summary',week_start:WEEK,items:[{area_id:AREA_A,summary:'가상 면담으로 요구안 전달',from:'ai'}],empty:[AREA_B],partial:false,saved:true});
  assert.equal(h.calls.openai.length,1);
  const o=h.calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'area_week_summary');assert.equal(o.text.format.strict,true);
  const material=JSON.parse(o.input[1].content);
  assert.equal(material.areas.length,1,'an area without reports this week is not sent');
  assert.equal(material.areas[0].area,'가상 큰 사업 › 가상 세부 과제 가');
  assert.deepEqual(material.areas[0].reports.map(r=>r.title),['가상 보고 1'],'only reports tagged with that area; an untagged report borrowing it, another week and a report tagged elsewhere are left out');
  assert.ok(!o.input[1].content.includes('010-1234-5678'),'phone numbers are not sent');
  const row=h.db.app_weekly_exec_requests[0];
  assert.deepEqual(row.draft.rows,[{section:'summary',key:'가›나',n:0,lines:['고친 줄']}],'edited cells stay');
  assert.ok(row.draft.issued,'issued record stays');
  assert.deepEqual(Object.keys(row.draft.area_summaries),[AREA_A]);
  const entry=row.draft.area_summaries[AREA_A];
  assert.equal(entry.text,'가상 면담으로 요구안 전달');assert.equal(entry.edited,false);assert.match(entry.hash,/^a1:[0-9a-f]{32}$/);
  assert.equal(row.draft_saved_at,new Date(NOW).toISOString());
  assert.deepEqual(row.items,[{text:'가상 요청'}],'request lines are not touched');
  const patch=h.calls.rest.find(c=>c.method==='PATCH');
  assert.match(patch.query,/draft_saved_at=eq\.2026-10-27T05:00:00\.000Z/,'written only if nobody saved in between');
  assert.equal(h.db.app_ai_daily_usage[0].requests,1);assert.equal(h.db.app_ai_daily_usage[0].input_tokens,900);
  assert.ok(!/가상|요구안|면담/.test(JSON.stringify(h.calls.logs)),'no report text or summary in logs');
  assert.equal(DAILY_LIMITS.area_week_summary,30);assert.equal(DAILY_LIMITS.area_suggest,60);
});

test('area_week_summary: unchanged reports reuse the kept line without AI or usage; a changed report asks again',async()=>{
  const h=harness();
  await summary(h);
  const again=await (await summary(h)).json();
  assert.deepEqual(again.items,[{area_id:AREA_A,summary:'가상 면담으로 요구안 전달',from:'saved'}]);
  assert.equal(again.saved,false);
  assert.equal(h.calls.openai.length,1,'no second AI call');
  assert.equal(h.db.app_ai_daily_usage[0].requests,1,'no second usage count');
  h.db.app_meetings[0].updated_at='2026-10-28T01:00:00.000Z';
  const third=await (await summary(h)).json();
  assert.equal(third.items[0].from,'ai');assert.equal(h.calls.openai.length,2);
});

test('area_week_summary: a line the owner edited is neither sent to AI nor overwritten',async()=>{
  const h=harness();
  h.db.app_weekly_exec_requests[0].draft.area_summaries={[AREA_A]:{text:'명진이 고친 가상 줄',hash:'',edited:true,at:'2026-10-27T06:00:00Z'}};
  const before=JSON.stringify(h.db.app_weekly_exec_requests[0]);
  const got=await (await summary(h)).json();
  assert.deepEqual(got.items,[{area_id:AREA_A,summary:'명진이 고친 가상 줄',from:'edited'}]);
  assert.equal(h.calls.openai.length,0);assert.equal(h.db.app_ai_daily_usage.length,0);
  assert.equal(JSON.stringify(h.db.app_weekly_exec_requests[0]),before);
  // edited for one area, AI for another: the edited one still stays as it is.
  const h2=harness({meetings:[meeting(1,{business_area_id:AREA_A}),meeting(5,{business_area_id:AREA_B})],
    openai:()=>respond(aiText({items:[{ref:'a1',summary:'가상 나 과제 진행'}]}))});
  h2.db.app_weekly_exec_requests[0].draft.area_summaries={[AREA_A]:{text:'고친 가 줄',hash:'',edited:true,at:''}};
  const got2=await (await summary(h2)).json();
  assert.deepEqual(got2.items.map(i=>i.from),['edited','ai']);
  assert.equal(JSON.parse(h2.calls.openai[0].input[1].content).areas[0].area,'가상 큰 사업 › 가상 세부 과제 나');
  const kept=h2.db.app_weekly_exec_requests[0].draft.area_summaries;
  assert.deepEqual(kept[AREA_A],{text:'고친 가 줄',hash:'',edited:true,at:''});assert.equal(kept[AREA_B].text,'가상 나 과제 진행');
});

test('area_week_summary: no week row yet → a row is made with empty request lines; a save in between is not overwritten; no draft table → answer without saving',async()=>{
  const h=harness({requests:[]});
  const got=await (await summary(h)).json();
  assert.equal(got.saved,true);
  const row=h.db.app_weekly_exec_requests[0];
  assert.deepEqual(row.items,[]);assert.equal(row.week_start,WEEK);assert.equal(row.draft.v,1);assert.equal(row.draft.area_summaries[AREA_A].text,'가상 면담으로 요구안 전달');

  const h2=harness({openai:(_,db)=>{db.app_weekly_exec_requests[0].draft_saved_at='2026-10-28T02:59:00.000Z';return respond(aiText({items:[{ref:'a1',summary:'가상 면담으로 요구안 전달'}]}));}});
  const got2=await (await summary(h2)).json();
  assert.equal(got2.saved,false);assert.equal(got2.items[0].summary,'가상 면담으로 요구안 전달');
  assert.equal(h2.db.app_weekly_exec_requests[0].draft.area_summaries,undefined,'the other device\'s save stays');

  const h3=harness({noDraftTable:true});
  const r3=await summary(h3);
  assert.equal(r3.status,200);const got3=await r3.json();
  assert.equal(got3.saved,false);assert.equal(got3.items[0].from,'ai');
  assert.ok(h3.calls.rest.every(c=>c.table!=='app_weekly_exec_requests'||c.method==='GET'));
});

test('area_week_summary: refused shapes, other owners\' areas, missing area column, monthly limit',async()=>{
  const h=harness();
  for(const body of [
    {kind:'area_week_summary',week_start:'2026-10-27',area_ids:[AREA_A]},
    {kind:'area_week_summary',week_start:WEEK,area_ids:[]},
    {kind:'area_week_summary',week_start:WEEK,area_ids:[AREA_A,AREA_A]},
    {kind:'area_week_summary',week_start:WEEK,area_ids:['not-a-uuid']},
    {kind:'area_week_summary',week_start:WEEK,area_ids:Array.from({length:21},(_,i)=>id(200+i))},
    {kind:'area_week_summary',week_start:WEEK,area_ids:[AREA_A],text:'x'},
    {kind:'area_week_summary',week_start:'2024-01-01',area_ids:[AREA_A]},
  ]){const r=await post(h.handler,body);assert.equal(r.status,400,JSON.stringify(body));}
  for(const ids of [[FOREIGN],[LOOSE],[id(999)]]){const r=await summary(h,ids);assert.equal(r.status,404);}
  const r2=await summary(harness(),[AREA_A]).then(r=>r.status);assert.equal(r2,200);
  const stranger=await post(h.handler,{kind:'area_week_summary',week_start:WEEK,area_ids:[AREA_A]},'stranger-token');
  assert.equal(stranger.status,404);
  assert.equal(h.calls.openai.length,0);
  const missing=await summary(harness({noAreaColumn:true}));
  assert.equal(missing.status,503);assert.equal((await missing.json()).error,'area_not_ready');
  const limited=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-27',requests:1,input_tokens:9e9,output_tokens:9e9}]});
  const r=await summary(limited);
  assert.equal(r.status,429);assert.equal((await r.json()).error,'monthly_limit');assert.equal(limited.calls.openai.length,0);
});

test('area_week_summary: AI answers are checked (unknown refs, multi-line, HTML, too long, contacts are dropped)',async()=>{
  const packed=[{ref:'a1',id:AREA_A,name:'가',reports:[]},{ref:'a2',id:AREA_B,name:'나',reports:[]}];
  const parsed=ba.parseAreaSummary(JSON.stringify({items:[{ref:'a1',summary:'- "가상 진행"'},{ref:'a9',summary:'모르는 참조'},{ref:'a2',summary:'가\n나'},{ref:'a1',summary:'두 번째'}]}),packed);
  assert.deepEqual(parsed.items.map(i=>[i.area.id,i.summary]),[[AREA_A,'가상 진행']]);assert.equal(parsed.dropped,3);
  for(const bad of ['<b>x</b>','가'.repeat(121),'연락 010-1234-5678','메일 a@b.example','비밀번호: 가상',''])assert.equal(ba.cleanAreaLine(bad),null,bad);
  assert.equal(ba.parseAreaSummary('not json',packed),null);
  const h=harness({openai:()=>respond(aiText({items:[{ref:'a1',summary:'<script>x</script>'}]}))});
  const got=await (await summary(h)).json();
  assert.deepEqual(got.items,[]);assert.deepEqual(got.empty.sort(),[AREA_A,AREA_B].sort());assert.equal(got.saved,false);
  assert.equal(h.db.app_weekly_exec_requests[0].draft.area_summaries,undefined);
  // the draft helper never touches edited entries and refuses an oversized draft
  const d={v:1,rows:[],titles:[],area_summaries:{[AREA_A]:{text:'고친 줄',hash:'',edited:true,at:''}}};
  assert.equal(ba.withAreaSummaries(d,[{id:AREA_A,text:'AI 줄',hash:'a1:'+'0'.repeat(32)}],'t'),null);
  const big={v:1,rows:[{section:'summary',key:'k',n:0,lines:['가'.repeat(70000)]}],titles:[]};
  assert.equal(ba.withAreaSummaries(big,[{id:AREA_B,text:'AI 줄',hash:'a1:'+'0'.repeat(32)}],'t'),null);
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
