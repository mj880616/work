import test from 'node:test';
import {withAiMonth} from './helpers/ai-month-fake.mjs';
import assert from 'node:assert/strict';

// S55-07 HOME-하루채우기 PR-B: the real ai-assist handler, kind=home_day_picks, with a synthetic Supabase (Auth + PostgREST with owner rows +
// operator feature check) and a mocked OpenAI. No network, no real key, synthetic text only.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const hd=await import('../../supabase/functions/ai-assist/home-day-picks.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OWNER='b0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000009';
const DAY='2026-11-09',MORNING=Date.parse('2026-11-08T23:00:00Z'),EVENING=Date.parse('2026-11-09T10:30:00Z'); // 08:00 · 19:30 KST
const N1='c0000000-0000-4000-8000-000000000001',N2='c0000000-0000-4000-8000-000000000002',N3='c0000000-0000-4000-8000-000000000003',N4='c0000000-0000-4000-8000-000000000004';
const news=(id,title,created,extra={})=>({id,workspace_id:WS,title,title_ko:null,publisher:'가상신문',summary:'',url:`https://news.example.test/${id.slice(-1)}`,published_at:created,created_at:created,hidden_at:null,...extra});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:500,output_tokens:60}});
const UPDATE_COLS=['reads','reads_at','reads_slot','news_seen_at','suggests','suggests_at','suggests_done','run_at'];

function harness({features=['calls','outside'],items=[],picks=[],notes=[],meetings=[],feeds=[],orgs=[],edits=[],assignees=[],spaces=[],usage=[],now=MORNING,openai=null,env={}}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'}],app_home_day_picks:structuredClone(picks),app_news_items:structuredClone(items),
    app_notes:structuredClone(notes),app_meetings:structuredClone(meetings),app_feed_items:structuredClone(feeds),app_suborganizations:structuredClone(orgs),app_call_edits:structuredClone(edits),
    app_suborganization_assignees:structuredClone(assignees),app_spaces:structuredClone(spaces),app_ai_daily_usage:structuredClone(usage)};
  const cmp=(v,op,val)=>{
    if(op==='eq')return String(v)===val;
    if(op==='is')return val==='null'?v==null:String(v)===val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(v));
    if(op==='gte')return v!=null&&String(v)>=val;
    if(op==='lt')return v!=null&&String(v)<val;
    throw new Error('op '+op);
  };
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){const body=JSON.parse(init.body);calls.openai.push(body);return openai?openai(body):respond(body.text.format.name==='home_day_reads'?answer([{n:1,what:'가상지부 교섭 결렬 소식',why:'가상지부 담당'}]):answer([{n:1,text:'오늘 가상 교섭 준비 회의를 했다',basis:'회의: 가상 교섭 준비'}]));}
    assert.equal(url.origin,SB);
    const owner=(headers.get('Authorization')||'')==='Bearer owner-token';
    if(url.pathname==='/auth/v1/user')return owner?respond({id:OWNER}):respond({msg:'bad'},401);
    assert.ok(owner,'REST only with the caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features')return respond(features);
    const table=url.pathname.replace('/rest/v1/','');
    calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET'){
      let out=rows.filter(r=>(table==='app_workspace_members'||table==='app_suborganization_assignees'?r.user_id===OWNER:r.workspace_id===WS)&&matches(r,url));
      if(url.searchParams.get('order')==='created_at.desc')out=[...out].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
      return respond(out);
    }
    const b=init.body?JSON.parse(init.body):null;
    if(table==='app_ai_daily_usage'&&method==='POST'){const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_home_day_picks'&&method==='POST'){
      assert.deepEqual(Object.keys(b).sort(),['day','workspace_id'],'insert only workspace and day');
      assert.equal(b.workspace_id,WS);
      if(!rows.some(r=>r.workspace_id===b.workspace_id&&r.day===b.day))rows.push({...b,reads:[],reads_at:null,reads_slot:null,news_seen_at:null,suggests:[],suggests_at:null,suggests_done:[],run_at:null});
      return respond('',201);
    }
    if(table==='app_home_day_picks'&&method==='PATCH'){
      for(const k of Object.keys(b))assert.ok(UPDATE_COLS.includes(k),'update value columns only: '+k);
      for(const r of rows)if(r.workspace_id===WS&&matches(r,url))Object.assign(r,structuredClone(b));
      return new Response(null,{status:204});
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler(withAiMonth({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-key',...env})[n],
    fetch:doFetch,now:()=>now,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})}));
  return {handler,calls,db,at:t=>{now=t;}};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const ask=(extra={})=>({kind:'home_day_picks',day:DAY,events:[],done:[],...extra});
const logText=calls=>JSON.stringify(calls.logs);

test('daily limit entry exists for the new kind',()=>{assert.ok(DAILY_LIMITS.home_day_picks>=2&&DAILY_LIMITS.home_day_picks<=10);});

test('morning first open: recent news + my orgs/areas/this week go to AI once; titles/urls come from DB; row stored; claim released; usage counted',async()=>{
  const {handler,calls,db}=harness({
    items:[news(N1,'가상지부 교섭 결렬','2026-11-08T22:00:00.000Z',{summary:'문의 010-1234-5678'}),news(N2,'다른 이야기','2026-11-08T21:00:00.000Z'),
      news(N3,'옛날 글','2026-11-01T00:00:00.000Z'),news(N4,'숨긴 글','2026-11-08T22:30:00.000Z',{hidden_at:'2026-11-08T22:40:00.000Z'})],
    orgs:[{id:'o1',workspace_id:WS,name:'가상지부',active:true}],spaces:[{workspace_id:WS,name:'가상사업',status:'active'}]});
  const res=await post(handler,ask({events:[{day:'2026-11-10',start:'14:00',end:'16:00',title:'가상지부 교섭'}]}));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'home_day_reads');assert.equal(o.text.format.strict,true);
  const m=o.input[1].content;
  assert.ok(m.includes('가상지부 교섭 결렬')&&m.includes('가상지부')&&m.includes('가상사업')&&m.includes('11-10 가상지부 교섭'));
  assert.ok(!m.includes('010-1234-5678'),'phones are not sent');
  assert.ok(!m.includes(N1)&&!m.includes('https://'),'ids and urls are not sent');
  assert.ok(!m.includes('옛날 글')&&!m.includes('숨긴 글'),'old and hidden news are not sent');
  const row=db.app_home_day_picks[0];
  assert.equal(row.reads_slot,'am');assert.equal(row.run_at,null,'claim released');assert.equal(row.news_seen_at,'2026-11-08T22:00:00.000Z');
  assert.deepEqual(row.reads,[{id:N1,title:'가상지부 교섭 결렬',what:'가상지부 교섭 결렬 소식',why:'가상지부 담당',source:'가상신문',at:'2026-11-08T22:00:00.000Z',url:'https://news.example.test/1'}]);
  assert.deepEqual(body.picks.reads,row.reads);assert.deepEqual(body.picks.suggests,[]);
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!logText(calls).includes('가상'),'no text in logs');
  // 다시 열기(같은 아침): AI를 부르지 않는다.
  const again=await post(handler,ask());
  assert.equal((await again.json()).skipped,'fresh');assert.equal(calls.openai.length,1);
});

test('evening: reads not redone without new news; suggestions from ended events, done tasks, meetings, work calls; diary-covered and family lines dropped; diary never sent',async()=>{
  const picks=[{workspace_id:WS,day:DAY,reads:[],reads_at:'2026-11-08T23:00:00.000Z',reads_slot:'am',news_seen_at:'2026-11-08T22:00:00.000Z',suggests:[],suggests_at:null,suggests_done:[],run_at:null}];
  const {handler,calls,db}=harness({now:EVENING,picks,env:{FAMILY_NAME:'가상이'},
    items:[news(N1,'가상지부 교섭 결렬','2026-11-08T22:00:00.000Z')],
    notes:[{workspace_id:WS,kind:'diary',journal_day:DAY,archived_at:null,raw_text:'오늘 점심에 가상 식당 회식을 했다. 비밀 일기 문장.'}],
    meetings:[{workspace_id:WS,title:'가상 교섭 준비',series_name:null,meeting_at:'2026-11-09T02:00:00.000Z'},{workspace_id:WS,title:'어제 회의',series_name:null,meeting_at:'2026-11-08T02:00:00.000Z'}],
    feeds:[{workspace_id:WS,source:'call',day:DAY,hidden_at:null,archived_at:null,title:'가상지부장 통화',summary:'교섭 일정 확인',occurred_at:'2026-11-09T03:00:00.000Z'}]});
  const events=[{day:DAY,start:'12:00',end:'13:00',title:'가상 식당 회식'},{day:DAY,start:'20:00',end:'21:00',title:'늦은 가상 모임'},{day:DAY,start:'',end:'',title:'종일 가상 휴가'},{day:DAY,start:'09:00',end:'10:00',title:'가상이 생일 준비'}];
  const res=await post(handler,ask({events,done:['가상 보도자료 보내기','어머니 병원 예약']}));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(calls.openai.length,1,'only suggestions, no new news');
  assert.equal(calls.openai[0].text.format.name,'home_day_suggests');
  const m=calls.openai[0].input[1].content;
  assert.ok(m.includes('[할 일] 가상 보도자료 보내기')&&m.includes('[회의] 가상 교섭 준비')&&m.includes('[통화] 가상지부장 통화 — 교섭 일정 확인'));
  assert.ok(!m.includes('가상 식당 회식'),'already in diary');
  assert.ok(!m.includes('늦은 가상 모임'),'not ended yet');assert.ok(!m.includes('종일'),'all-day left out');
  assert.ok(!m.includes('어머니')&&!m.includes('가상이'),'family lines left out');
  assert.ok(!m.includes('비밀 일기'),'diary text is never sent');assert.ok(!m.includes('어제 회의'));
  assert.ok(!calls.openai[0].input[0].content.includes('비밀 일기'));
  const row=db.app_home_day_picks[0];
  assert.deepEqual(row.suggests,[{id:'s1',text:'오늘 가상 교섭 준비 회의를 했다',basis:'회의: 가상 교섭 준비'}]);
  assert.equal(row.reads_slot,'am','reads kept');assert.equal(row.run_at,null);
  assert.deepEqual(body.picks.suggests,row.suggests);
  // 한 번만: 다시 열면 부르지 않는다.
  await post(handler,ask({events,done:[]}));
  assert.equal(calls.openai.length,1);
});

test('S67-47: call lines carry only the org attached to that call (user edit first); a suggestion naming another org is dropped',async()=>{
  const O1='d0000000-0000-4000-8000-000000000001',O2='d0000000-0000-4000-8000-000000000002',C1='f0000000-0000-4000-8000-000000000001',C2='f0000000-0000-4000-8000-000000000002';
  const orgs=[{id:O1,workspace_id:WS,name:'가상철도지부',aliases:['가철'],active:true,deleted_at:null},{id:O2,workspace_id:WS,name:'예시광역노조',aliases:[],active:true,deleted_at:null}];
  const picks=[{workspace_id:WS,day:DAY,reads:[],reads_at:'2026-11-08T23:00:00.000Z',reads_slot:'pm',news_seen_at:null,suggests:[],suggests_at:null,suggests_done:[],run_at:null}];
  const feeds=[
    {id:C1,workspace_id:WS,source:'call',day:DAY,hidden_at:null,archived_at:null,title:'가상철도지부 위원장 · 파업 일정과 쟁의 준비 논의',summary:null,organization_id:null,occurred_at:'2026-11-09T03:00:00.000Z'},
    {id:C2,workspace_id:WS,source:'call',day:DAY,hidden_at:null,archived_at:null,title:'가상철도지부 국장 · 교섭 자료 요청',summary:null,organization_id:O1,occurred_at:'2026-11-09T04:00:00.000Z'},
  ];
  // C2는 사람이 조직을 예시광역노조로 고쳤다(app_call_edits) — AI 값(가상철도지부)보다 앞선다.
  const edits=[{call_id:C2,workspace_id:WS,vals:{organization_id:O2}}];
  const {handler,calls,db}=harness({now:EVENING,picks,orgs,feeds,edits,notes:[{workspace_id:WS,kind:'diary',journal_day:DAY,archived_at:null,raw_text:''}],
    openai:()=>respond(answer([{n:1,text:'오늘 가상철도지부와 파업 일정을 논의했다',basis:'가상철도지부 통화에서 파업 일정 논의'},{n:2,text:'오늘 예시광역노조 교섭 자료를 챙겼다',basis:'예시광역노조 통화'}]))});
  const res=await post(handler,ask());
  assert.equal(res.status,200);
  const m=calls.openai[0].input[1].content;
  assert.ok(m.includes('[통화] 파업 일정과 쟁의 준비 논의 (조직: 없음)'),m);
  assert.ok(m.includes('[통화] 교섭 자료 요청 (조직: 예시광역노조)'),m);
  assert.ok(!m.includes('가상철도지부'),'title head org (a guess) is not sent');
  assert.ok(calls.openai[0].input[0].content.includes('다른 줄의 조직을 옮겨 붙이지 않는다'));
  assert.deepEqual(db.app_home_day_picks[0].suggests,[{id:'s1',text:'오늘 예시광역노조 교섭 자료를 챙겼다',basis:'예시광역노조 통화'}],'the line without an org cannot gain one');
});

test('S67-47 pure: borrowsOrg / callDayLine',()=>{
  const orgs=[{id:'a',name:'가상철도지부',aliases:['가철']},{id:'b',name:'예시광역노조',aliases:[]}];
  assert.equal(hd.borrowsOrg('파업 일정 논의 ','가상철도지부 통화에서 파업 일정 논의',orgs),true);
  assert.equal(hd.borrowsOrg('가상철도지부 정기회의 ','오늘 가철 정기회의를 했다',orgs),false,'same org by alias');
  assert.equal(hd.borrowsOrg('교섭 예시광역노조','오늘 예시광역노조 교섭',orgs),false);
  assert.equal(hd.borrowsOrg('교섭','오늘 교섭 준비',orgs),false);
  assert.deepEqual(hd.callDayLine('가상철도지부 위원장 · 파업 논의',null,null,DAY),{kind:'통화',text:'파업 논의',day:DAY,org:''});
  assert.deepEqual(hd.callDayLine('한 줄 제목','요약',null,''),{kind:'통화',text:'한 줄 제목 — 요약',day:'',org:''});
  assert.deepEqual(hd.callDayLine('A · B','','예시광역노조',DAY),{kind:'통화',text:'B',day:DAY,org:'예시광역노조'});
});

test('evening with new news re-picks reads once; without calls feature the call table is not read at all',async()=>{
  const picks=[{workspace_id:WS,day:DAY,reads:[],reads_at:'2026-11-08T23:00:00.000Z',reads_slot:'am',news_seen_at:'2026-11-08T22:00:00.000Z',suggests:[],suggests_at:null,suggests_done:[],run_at:null}];
  const {handler,calls,db}=harness({now:EVENING,picks,features:['outside'],items:[news(N1,'가상지부 교섭 결렬','2026-11-08T22:00:00.000Z'),news(N2,'가상지부 새 소식','2026-11-09T09:00:00.000Z')],
    meetings:[{workspace_id:WS,title:'가상 교섭 준비',series_name:null,meeting_at:'2026-11-09T02:00:00.000Z'}],
    feeds:[{workspace_id:WS,source:'call',day:DAY,hidden_at:null,archived_at:null,title:'운영자 통화',summary:'',occurred_at:'2026-11-09T03:00:00.000Z'}]});
  const res=await post(handler,ask());
  assert.equal(res.status,200);
  assert.deepEqual(calls.openai.map(o=>o.text.format.name),['home_day_reads','home_day_suggests']);
  assert.equal(db.app_home_day_picks[0].reads_slot,'pm');assert.equal(db.app_home_day_picks[0].news_seen_at,'2026-11-09T09:00:00.000Z');
  assert.equal(db.app_home_day_picks[0].reads[0].id,N2,'first sent news is the newest');
  assert.ok(!calls.rest.some(r=>r.table==='app_feed_items'),'no operator feature: calls not read');
  assert.ok(!calls.openai[1].input[1].content.includes('운영자 통화'));
  assert.equal(db.app_ai_daily_usage[0].requests,2);
});

test('not today, held claim, nothing to pick: no AI and no writes',async()=>{
  {const {handler,calls}=harness({items:[news(N1,'가상','2026-11-08T22:00:00.000Z')]});
   const r=await post(handler,ask({day:'2026-11-08'}));assert.equal((await r.json()).skipped,'not_today');assert.equal(calls.openai.length,0);assert.ok(!calls.rest.some(x=>x.method!=='GET'));}
  {const picks=[{workspace_id:WS,day:DAY,reads:[],reads_at:null,reads_slot:null,news_seen_at:null,suggests:[],suggests_at:null,suggests_done:[],run_at:new Date(MORNING-60000).toISOString()}];
   const {handler,calls}=harness({picks,items:[news(N1,'가상','2026-11-08T22:00:00.000Z')]});
   const r=await post(handler,ask());assert.equal((await r.json()).skipped,'busy');assert.equal(calls.openai.length,0);assert.ok(!calls.rest.some(x=>x.method!=='GET'));}
  {const {handler,calls}=harness({});
   const r=await post(handler,ask());assert.equal((await r.json()).skipped,'fresh');assert.equal(calls.openai.length,0);assert.ok(!calls.rest.some(x=>x.method!=='GET'),'no news: nothing written');}
  {// 오래된 차지(3분 넘음)는 끝나지 못한 것으로 보고 다시 차지한다.
   const picks=[{workspace_id:WS,day:DAY,reads:[],reads_at:null,reads_slot:null,news_seen_at:null,suggests:[],suggests_at:null,suggests_done:[],run_at:new Date(MORNING-10*60000).toISOString()}];
   const {handler,calls,db}=harness({picks,items:[news(N1,'가상','2026-11-08T22:00:00.000Z')]});
   assert.equal((await post(handler,ask())).status,200);assert.equal(calls.openai.length,1);assert.equal(db.app_home_day_picks[0].run_at,null);}
});

test('monthly limit: 429 monthly_limit, nothing picked, claim released (screen shows the existing limit notice)',async()=>{
  const {handler,calls,db}=harness({items:[news(N1,'가상','2026-11-08T22:00:00.000Z')],usage:[{workspace_id:WS,user_id:OWNER,day:'2026-11-02',requests:1,input_tokens:900000000,output_tokens:900000000}]});
  const r=await post(handler,ask());
  assert.equal(r.status,429);assert.equal((await r.json()).error,'monthly_limit');
  assert.equal(calls.openai.length,0);
  assert.equal(db.app_home_day_picks[0].run_at,null);assert.equal(db.app_home_day_picks[0].reads_slot,null);
});

test('AI answer is untrusted: out-of-range, duplicate, html, phone, family and over-long lines dropped; url never from AI; http url blanked',async()=>{
  const openai=b=>respond(answer([{n:9,what:'범위 밖',why:'x'},{n:1,what:'<b>굵게</b>',why:'x'},{n:1,what:'전화 010-1111-2222',why:'x'},{n:2,what:'가족 모임 소식',why:'x'},
    {n:2,what:'가'.repeat(81),why:'x'},{n:2,what:'가상 정상 줄',why:'https://evil.example 로 가기'},{n:3,what:'세번째 줄',why:'가상사업'},{n:3,what:'같은 번호',why:'x'}]));
  const {handler,db}=harness({openai,items:[news(N1,'첫 글','2026-11-08T22:00:00.000Z'),news(N2,'둘째 글','2026-11-08T21:00:00.000Z',{url:'http://plain.example.test/2'}),news(N3,'셋째 글','2026-11-08T20:00:00.000Z',{url:'javascript:alert(1)'})]});
  assert.equal((await post(handler,ask())).status,200);
  const reads=db.app_home_day_picks[0].reads;
  assert.deepEqual(reads.map(r=>[r.id,r.what,r.url]),[[N2,'가상 정상 줄',''],[N3,'세번째 줄','']]);
});

test('bad answer leaves the slot open (next open retries); bad requests are 400',async()=>{
  const {handler,db}=harness({openai:()=>respond(answer('not-array')),items:[news(N1,'가상','2026-11-08T22:00:00.000Z')]});
  assert.equal((await post(handler,ask())).status,200);
  assert.equal(db.app_home_day_picks[0].reads_slot,null);assert.equal(db.app_home_day_picks[0].run_at,null);
  const {handler:h2,calls}=harness({});
  const bad=[{kind:'home_day_picks',day:DAY,events:[]},{...ask(),extra:1},{...ask(),day:'2026-13-01'},
    ask({events:[{day:'2026-11-17',start:'',end:'',title:'다음 주'}]}),ask({events:[{day:DAY,start:'25:00',end:'',title:'x'}]}),
    ask({events:[{day:DAY,start:'',end:'10:00',title:'x'}]}),ask({events:[{day:DAY,start:'09:00',end:'',title:'가'.repeat(121)}]}),
    ask({events:[{day:DAY,start:'09:00',end:'',title:'x',place:'y'}]}),ask({done:['']}),ask({done:Array(31).fill('x')}),ask({done:['줄\u202e바꿈']}),
    ask({events:Array(41).fill({day:DAY,start:'',end:'',title:'x'})})];
  for(const b of bad)assert.equal((await post(h2,b)).status,400,JSON.stringify(b).slice(0,80));
  assert.equal(calls.openai.length,0);
  assert.equal((await post(h2,ask(),'stranger')).status,401);
});

test('pure rules: slot, due, diary overlap, ended events',()=>{
  assert.equal(hd.daySlot(MORNING),'am');assert.equal(hd.daySlot(EVENING),'pm');
  assert.equal(hd.readsDue(null,'am',null),false,'no news, nothing to do');
  assert.equal(hd.readsDue(null,'am','2026-11-08T22:00:00Z'),true);
  assert.equal(hd.readsDue({reads_slot:'am',news_seen_at:'2026-11-08T22:00:00Z'},'am','2026-11-09T01:00:00Z'),false,'once per slot');
  assert.equal(hd.readsDue({reads_slot:'am',news_seen_at:'2026-11-08T22:00:00Z'},'pm','2026-11-08T22:00:00Z'),false,'evening: no new news');
  assert.equal(hd.readsDue({reads_slot:'am',news_seen_at:'2026-11-08T22:00:00Z'},'pm','2026-11-09T09:00:00Z'),true);
  assert.equal(hd.readsDue({reads_slot:'pm',news_seen_at:'x'},'pm','2026-11-09T11:00:00Z'),false);
  assert.equal(hd.suggestsDue(null,DAY,MORNING),false);assert.equal(hd.suggestsDue(null,DAY,EVENING),true);assert.equal(hd.suggestsDue({suggests_at:'2026-11-09T09:00:00Z'},DAY,EVENING),false);
  assert.equal(hd.suggestsDue({suggests_at:'2026-11-08T10:00:00Z'},DAY,EVENING),true,'S67-46: made another day -> pick again');
  assert.equal(hd.suggestsDue({suggests_at:'x'},DAY,EVENING),true,'unknown made time -> pick again');
  assert.equal(hd.diaryCovers('가상 식당 회식','오늘 가상식당회식!'),true);
  assert.equal(hd.diaryCovers('가상지부 교섭 준비 회의','교섭 준비를 했다 가상지부'),true);
  assert.equal(hd.diaryCovers('가상 보도자료 보내기','오늘 회식'),false);assert.equal(hd.diaryCovers('회의','회의'),false,'too short to judge alone');
  assert.deepEqual(hd.startedToday([{day:DAY,start:'09:00',end:'',title:'a'},{day:DAY,start:'09:00',end:'20:00',title:'b'},{day:'2026-11-10',start:'09:00',end:'10:00',title:'c'},{day:DAY,start:'20:00',end:'21:00',title:'d'},{day:DAY,start:'',end:'',title:'e'}],DAY,'19:30').map(e=>e.title),['a','b'],'ended or in progress today; not later, not all-day, not another day');
  assert.equal(hd.familyName(' 가상이 '),'가상이');assert.equal(hd.familyName('상대'),null);assert.equal(hd.familyName('<x>'),null);
  assert.equal(hd.weekStart('2026-11-09'),'2026-11-09');assert.equal(hd.weekStart('2026-11-15'),'2026-11-09');
});

// NEWS-운영자만(S63-03, 사용자 11/16): '읽을 만한 글'은 News 기사에서 고르므로 기능 키 'outside'가 없는 작업공간은 뉴스를 읽지 않고 고르지 않는다.
test("NEWS-운영자만: 'outside' 키가 없으면 뉴스 표를 읽지 않고 '읽을 만한 글' AI를 부르지 않는다(지운 것 없음)",async()=>{
  const {handler,calls,db}=harness({features:[],items:[news(N1,'가상지부 교섭 결렬','2026-11-08T22:00:00.000Z')]});
  const res=await post(handler,ask());
  assert.equal(res.status,200);
  assert.ok(!calls.rest.some(r=>r.table==='app_news_items'),'뉴스 표 읽기 없음');
  assert.ok(!calls.openai.some(o=>o.text.format.name==='home_day_reads'),'읽을 만한 글 AI 없음');
  assert.equal(db.app_news_items.length,1,'모인 글은 그대로');
});

// S67-46(사용자 11/20 "11월 20일인데 오늘 / 옛 일정이 제안으로"): 기록 제안 재료는 오늘(한국 날짜) 일만. 다른 날 줄은 재료·AI 답 모두에서 빠지고,
// 다른 날 만든 저장 제안은 돌려주지 않고 새로 고른다. 합성 자료만.
const D20='2026-11-20',EVE20=Date.parse('2026-11-20T12:37:00Z'); // 21:37 KST
test('S67-46: 어제·지난주 회의·통화는 재료에서 빠지고(한국 자정 경계), 지운 회의도 빠진다',async()=>{
  const picks=[{workspace_id:WS,day:D20,reads:[],reads_at:null,reads_slot:'pm',news_seen_at:null,suggests:[],suggests_at:null,suggests_done:[],run_at:null}];
  const {handler,calls}=harness({now:EVE20,picks,features:['calls'],
    notes:[{workspace_id:WS,kind:'diary',journal_day:D20,archived_at:null,raw_text:''}],
    meetings:[{workspace_id:WS,title:'오늘 가상 회의',series_name:null,meeting_at:'2026-11-19T15:00:00.000Z'},
      {workspace_id:WS,title:'지운 가상 회의',series_name:null,meeting_at:'2026-11-20T02:00:00.000Z',deleted_at:'2026-11-20T03:00:00.000Z'}],
    feeds:[{workspace_id:WS,source:'call',day:D20,hidden_at:null,archived_at:null,title:'오늘 가상 통화',summary:'',occurred_at:'2026-11-20T01:00:00.000Z'},
      {workspace_id:WS,source:'call',day:D20,hidden_at:null,archived_at:null,title:'지난주 가상지부 통화',summary:'',occurred_at:'2026-11-13T01:00:00.000Z'}]});
  const events=[{day:'2026-11-19',start:'23:00',end:'23:59',title:'어제 밤 가상 모임'},{day:'2026-11-17',start:'10:00',end:'12:00',title:'지난 가상 총회'},{day:D20,start:'21:00',end:'23:00',title:'지금 하는 가상 모임'}];
  const res=await post(handler,{kind:'home_day_picks',day:D20,events,done:[]});
  assert.equal(res.status,200);
  const m=calls.openai.find(o=>o.text.format.name==='home_day_suggests').input[1].content;
  assert.ok(m.includes('[회의] 오늘 가상 회의'),'한국 0시 회의는 오늘');
  assert.ok(m.includes('[통화] 오늘 가상 통화')&&m.includes('[일정] 지금 하는 가상 모임'),'오늘 통화·진행 중 일정');
  assert.ok(!m.includes('지난주 가상지부 통화'),'녹음 시각이 다른 날인 통화는 빠짐');
  assert.ok(!m.includes('어제 밤')&&!m.includes('지난 가상 총회'),'다른 날 일정은 빠짐');
  assert.ok(!m.includes('지운 가상 회의'),'지운 회의는 빠짐');
  assert.ok(calls.rest.some(r=>r.table==='app_meetings'&&r.query.includes('deleted_at=is.null')));
});
test('S67-46: 다른 날 만든 저장 제안은 돌려주지 않고 새로 고른다; AI 답이 다른 날 줄에 기대면 버린다',async()=>{
  const old=[{id:'s1',text:'오늘 옛 총회에 함께했다',basis:'옛 총회'}];
  const picks=[{workspace_id:WS,day:D20,reads:[],reads_at:null,reads_slot:'pm',news_seen_at:null,suggests:old,suggests_at:'2026-11-13T12:00:00.000Z',suggests_done:[],run_at:null}];
  const {handler,calls,db}=harness({now:EVE20,picks,features:[],notes:[{workspace_id:WS,kind:'diary',journal_day:D20,archived_at:null,raw_text:''}],
    meetings:[{workspace_id:WS,title:'오늘 가상 회의',series_name:null,meeting_at:'2026-11-20T02:00:00.000Z'}]});
  const res=await post(handler,{kind:'home_day_picks',day:D20,events:[],done:[]});
  const body=await res.json();
  assert.equal(calls.openai.length,1,'stale suggestions are picked again');
  assert.deepEqual(body.picks.suggests,[{id:'s1',text:'오늘 가상 교섭 준비 회의를 했다',basis:'회의: 가상 교섭 준비'}]);
  assert.equal(hd.seoulDayOf(db.app_home_day_picks[0].suggests_at),D20);
  // 저장 줄의 제안이 다른 날 것이면 화면에 돌려주는 모양에서도 비운다.
  assert.deepEqual(hd.dayPicksOut({suggests:old,suggests_at:'2026-11-13T12:00:00.000Z'},D20).suggests,[]);
  assert.deepEqual(hd.dayPicksOut({suggests:old,suggests_at:'2026-11-19T15:00:00.000Z'},D20).suggests,old,'한국 0시에 만든 것은 그 날');
  // AI 답 검사: 다른 날 줄(어떻게든 들어온 것)에 기댄 제안은 버린다.
  const sent=[{kind:'회의',text:'오늘 일',day:D20},{kind:'통화',text:'옛 일',day:'2026-11-13'}];
  const got=hd.parseSuggests(JSON.stringify({items:[{n:2,text:'오늘 옛 통화를 했다',basis:'옛 통화'},{n:1,text:'오늘 회의를 했다',basis:'회의'}]}),sent,null,D20);
  assert.deepEqual(got,[{id:'s1',text:'오늘 회의를 했다',basis:'회의'}]);
  assert.deepEqual(hd.dayLines(sent,'',null,D20).map(l=>l.text),['오늘 일']);
});

// S67-52 HOME-칸끄기: '이런 기록은 어때요?'를 끈 사람(suggests:false)은 저녁에도 기록 제안 AI를 부르지 않는다. 읽을 만한 글은 그대로.
test('suggests:false (card turned off): no suggestion AI in the evening; reads still picked; other values for suggests are 400',async()=>{
  const picks=[{workspace_id:WS,day:DAY,reads:[],reads_at:'2026-11-08T23:00:00.000Z',reads_slot:'am',news_seen_at:'2026-11-08T22:00:00.000Z',suggests:[],suggests_at:null,suggests_done:[],run_at:null}];
  const {handler,calls,db}=harness({now:EVENING,picks,items:[news(N1,'가상지부 교섭 결렬','2026-11-08T22:00:00.000Z'),news(N2,'가상지부 새 소식','2026-11-09T09:00:00.000Z')],
    meetings:[{workspace_id:WS,title:'가상 교섭 준비',series_name:null,meeting_at:'2026-11-09T02:00:00.000Z'}]});
  const res=await post(handler,ask({suggests:false}));
  assert.equal(res.status,200);
  assert.deepEqual(calls.openai.map(o=>o.text.format.name),['home_day_reads'],'only reads, no suggestions');
  assert.deepEqual(db.app_home_day_picks[0].suggests,[]);assert.equal(db.app_home_day_picks[0].suggests_at,null);
  assert.ok(!calls.rest.some(r=>r.table==='app_meetings'),'suggestion material not read');
  // 새 뉴스도 없으면 AI를 전혀 부르지 않는다.
  const again=await post(handler,ask({suggests:false}));
  assert.equal((await again.json()).skipped,'fresh');assert.equal(calls.openai.length,1);
  for(const v of [true,'false',0,null])assert.equal((await post(handler,ask({suggests:v}))).status,400,String(v));
  assert.deepEqual(hd.parseHomeDayPicksRequest({kind:'home_day_picks',day:DAY,events:[],done:[]}).suggests,true);
  assert.equal(hd.parseHomeDayPicksRequest({kind:'home_day_picks',day:DAY,events:[],done:[],suggests:false}).suggests,false);
});
