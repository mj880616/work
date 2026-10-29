import test from 'node:test';
import assert from 'node:assert/strict';

// CALL-개인통화함 4단계: the real ai-assist handler, kind=call_refill, with a synthetic Supabase (Auth + PostgREST + the DB function
// app_call_work_info) and a mocked OpenAI. No network, no real key, synthetic text only.
const {createAiAssistHandler,DAILY_TOTAL_LIMIT,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const cr=await import('../../supabase/functions/ai-assist/call-refill.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG_A='d0000000-0000-4000-8000-000000000001',ORG_B='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const NOW=Date.parse('2026-10-25T03:00:00Z');
const MOVED='2026-10-25T02:00:00Z';

const answer=o=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(o)}]}],usage:{input_tokens:3000,output_tokens:60}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const callRow=(n,over={})=>({id:id(n),workspace_id:WS,source:'call',day:'2026-10-20',title:'옛 제목',summary:'요약 문장',points:['핵심 하나'],counterpart:null,organization_id:null,
  raw_text:'나: 안녕하세요\n상대: 가 지부 홍길동 지부장입니다. 연락처 010-1234-5678, 주민번호 900101-1234567. 임금교섭 3차 일정 협의하려고요.',
  hidden_at:null,moved_at:MOVED,refilled_at:null,...over});
const good={topic:'임금교섭 3차 일정 협의',organization_ref:'',person_name:'홍길동',person_title:'지부장'};

function harness({openai=null,feed=[callRow(1)],usage=[],rpcFail=null,feedFail=0,features=null}={}){
  const calls={openai:[],rest:[],rpc:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가 지부',active:true},{id:ORG_B,workspace_id:WS,name:'쓰지 않는 조직',active:false},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직',active:true}],
    app_feed_items:structuredClone(feed),app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(t,r,uid)=>t==='app_workspace_members'?r.user_id===uid:wsOwner[r.workspace_id]===uid;
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      return openai?openai(calls.openai.at(-1)):respond(answer(good));
    }
    assert.equal(url.origin,SB);assert.equal(headers.get('apikey'),'synthetic-anon-key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid);
    if(url.pathname==='/rest/v1/rpc/app_my_features'){calls.features=(calls.features||0)+1;if(features==='missing')return respond({code:'PGRST202',message:'function not found'},404);return respond((features??{[OWNER]:['calls','telegram']})[uid]||[]);}
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    if(table==='rpc/app_call_work_info'){
      const a=JSON.parse(init.body);calls.rpc.push(a);
      if(rpcFail)return respond(rpcFail.body,rpcFail.status);
      const r=db.app_feed_items.find(x=>x.id===a.p_id);
      if(!r||wsOwner[r.workspace_id]!==uid)return respond({code:'P0002',message:'CALL_NOT_FOUND'},404);
      if(r.moved_at==null||r.refilled_at!=null)return respond({code:'23514',message:'CALL_REFILL_NOT_PENDING'},400);
      r.title=a.p_title||r.title;r.counterpart=a.p_counterpart;r.organization_id=a.p_organization_id;r.refilled_at=new Date(NOW).toISOString();
      return respond({ok:true,id:r.id});
    }
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(table==='app_feed_items'&&feedFail)return respond({code:'42703',message:'column moved_at does not exist'},feedFail);
    if(method==='POST'){
      assert.equal(table,'app_ai_daily_usage');const b=JSON.parse(init.body);
      const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);
      return new Response(null,{status:204});
    }
    assert.equal(method,'GET');
    const eq=[...url.searchParams].filter(([k,v])=>v.startsWith('eq.'));
    return respond(rows.filter(r=>visible(table,r,uid)&&eq.every(([k,v])=>String(r[k])===v.slice(3))).slice(0,Number(url.searchParams.get('limit')||1e9)));
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const req=n=>({kind:'call_refill',id:id(n)});
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);return b;};

test('owner: one call, full text sent without phone/ID numbers, topic·org·name·title saved through the DB function only',async()=>{
  const h=harness({openai:()=>respond(answer({...good,organization_ref:'o1'}))});
  const res=await post(h.handler,req(1));
  assert.equal(res.status,200);const body=await res.json();
  assert.deepEqual(body,{ok:true,kind:'call_refill',id:id(1),title:'임금교섭 3차 일정 협의',counterpart:'가 지부 홍길동 지부장',organization_id:ORG_A});
  assert.equal(h.calls.openai.length,1);
  const o=h.calls.openai[0],material=o.input[1].content,sent=JSON.parse(material);
  assert.equal(o.store,false);assert.equal(o.tools,undefined);assert.equal(o.text.format.name,'call_refill');assert.equal(o.text.format.strict,true);
  assert.ok(sent.call.text.includes('홍길동 지부장입니다'),'full text, not only the summary');
  for(const hidden of ['010-1234-5678','900101-1234567','1234567',OWNER,WS,ORG_A,'남의 조직','쓰지 않는 조직'])assert.ok(!material.includes(hidden),hidden+' must not be sent');
  assert.deepEqual(sent.organizations,[{ref:'o1',name:'가 지부'}]);
  // Saved only through app_call_work_info (no direct PATCH); summary·points·raw_text stay.
  assert.deepEqual(h.calls.rpc,[{p_id:id(1),p_title:'임금교섭 3차 일정 협의',p_counterpart:'가 지부 홍길동 지부장',p_organization_id:ORG_A}]);
  assert.ok(h.calls.rest.every(c=>c.method==='GET'||c.table==='app_ai_daily_usage'||c.table==='rpc/app_call_work_info'));
  const row=h.db.app_feed_items[0];
  assert.equal(row.summary,'요약 문장');assert.deepEqual(row.points,['핵심 하나']);assert.ok(row.raw_text.includes('임금교섭'));assert.ok(row.refilled_at);
  assert.match(h.calls.rest.find(c=>c.table==='app_feed_items').query,/[?&]source=eq\.call&/);
  assert.equal(h.db.app_ai_daily_usage[0].requests,1);assert.equal(h.db.app_ai_daily_usage[0].input_tokens,3000);
  assert.ok(!/홍길동|임금교섭|가 지부/.test(JSON.stringify(h.calls.logs)),'no call text in logs');
});

test('the AI answer is checked again: unknown org ref, non-names and personal numbers are dropped; a bad topic saves nothing; empty fields keep the old values',async()=>{
  // unknown org ref → no org; "상대방" is not a name; keeps the existing org and counterpart
  {const h=harness({feed:[callRow(1,{organization_id:ORG_A,counterpart:'가 지부 김철수 과장'})],
     openai:()=>respond(answer({topic:'<b>일정</b> 협의',organization_ref:'o99',person_name:'상대방',person_title:'과장'}))});
   const b=await (await post(h.handler,req(1))).json();
   assert.equal(b.title,'일정 협의');assert.equal(b.organization_id,ORG_A);assert.equal(b.counterpart,'가 지부 김철수 과장');}
  // a phone/ID-looking name is dropped, a name with a title but no org
  {const h=harness({openai:()=>respond(answer({...good,person_name:'010-9999-8888',person_title:'지부장'}))});
   const b=await (await post(h.handler,req(1))).json();assert.equal(b.counterpart,null);assert.equal(b.organization_id,null);}
  // a bad topic (phone number inside / too long / not an object) → 502, nothing saved, still counted as used
  for(const bad of [{...good,topic:'연락 010-1234-5678'},{...good,topic:'가'.repeat(81)},{...good,topic:''},{...good,extra:1},{topic:'x'}]){
    const h=harness({openai:()=>respond(answer(bad))});
    await expectError(await post(h.handler,req(1)),502,'ai_invalid_response');
    assert.equal(h.calls.rpc.length,0);assert.equal(h.db.app_feed_items[0].refilled_at,null);assert.equal(h.db.app_ai_daily_usage[0].requests,1);
  }
  assert.equal(cr.parseCallRefill('not json',[]),null);
});

test('only an unfilled, moved, visible work call of the owner is refilled; otherwise no AI call',async()=>{
  const cases=[
    [callRow(1,{moved_at:null}),409,'call_refill_not_pending'],[callRow(1,{refilled_at:MOVED}),409,'call_refill_not_pending'],[callRow(1,{hidden_at:MOVED}),409,'call_refill_not_pending'],
    [callRow(1,{source:'telegram'}),404,'not_found'],[callRow(1,{workspace_id:OTHER_WS}),404,'not_found'],
  ];
  for(const [row,status,code] of cases){
    const h=harness({feed:[row]});
    await expectError(await post(h.handler,req(1)),status,code);
    assert.equal(h.calls.openai.length,0);assert.equal(h.db.app_ai_daily_usage.length,0);
  }
  {const h=harness();await expectError(await post(h.handler,req(7)),404,'not_found');assert.equal(h.calls.openai.length,0);}
  // another user's workspace has no calls feature (MULTI 단계 ①) → 403 before any read, no AI
  {const h=harness();await expectError(await post(h.handler,req(1),'stranger-token'),403,'forbidden');assert.equal(h.calls.openai.length,0);assert.ok(!h.calls.rest.some(c=>c.table==='app_feed_items'));}
  // no text at all (전문 비움 + 요약 없음) → skipped, no AI
  {const h=harness({feed:[callRow(1,{raw_text:null,summary:'',points:[]})]});
   assert.deepEqual(await (await post(h.handler,req(1))).json(),{ok:true,kind:'call_refill',id:id(1),skipped:true});assert.equal(h.calls.openai.length,0);}
  // 전문을 비운 통화는 요약·핵심내용으로 대신한다
  {const h=harness({feed:[callRow(1,{raw_text:null})]});
   assert.equal((await post(h.handler,req(1))).status,200);assert.ok(JSON.parse(h.calls.openai[0].input[1].content).call.text.includes('핵심 하나'));}
});

test('request shape: id only; extra keys, bad ids and other methods are refused',async()=>{
  const h=harness();
  for(const bad of [{kind:'call_refill'},{kind:'call_refill',id:'x'},{kind:'call_refill',id:id(1),workspace_id:WS},{kind:'call_refill',id:id(1),title:'직접'}])
    await expectError(await post(h.handler,bad),400,'invalid_request');
  assert.equal(h.calls.openai.length,0);
  const get=await h.handler(new Request(FN,{method:'GET',headers:{Authorization:'Bearer owner-token'}}));assert.equal(get.status,405);
});

test('limits: call_refill has its own daily count inside the total 80; a second call on an already-filled row is refused by the DB function too',async()=>{
  assert.equal(DAILY_TOTAL_LIMIT,80);assert.ok(DAILY_LIMITS.call_refill>0&&DAILY_LIMITS.call_refill<=DAILY_TOTAL_LIMIT);
  const full=[{workspace_id:WS,user_id:OWNER,day:'2026-10-25',requests:80,input_tokens:0,output_tokens:0}];
  const h=harness({usage:full});await expectError(await post(h.handler,req(1)),429,'daily_limit');assert.equal(h.calls.openai.length,0);
  // DB function says already filled (race) → 409
  const r=harness({rpcFail:{status:400,body:{code:'23514',message:'CALL_REFILL_NOT_PENDING'}}});
  await expectError(await post(r.handler,req(1)),409,'call_refill_not_pending');
  // DB function missing → not ready; other failure → unavailable, no raw error text
  const n=harness({rpcFail:{status:404,body:{code:'PGRST202',message:'function not found'}}});await expectError(await post(n.handler,req(1)),503,'call_refill_not_ready');
  const f=harness({rpcFail:{status:500,body:{message:'synthetic db detail'}}});const b=await expectError(await post(f.handler,req(1)),503,'call_refill_unavailable');
  assert.ok(!JSON.stringify(b).includes('synthetic db detail'));
  // columns not applied yet → not ready, no AI
  const c=harness({feedFail:400});await expectError(await post(c.handler,req(1)),503,'call_refill_not_ready');assert.equal(c.calls.openai.length,0);
});

test('pure helpers: long text keeps head and tail, personal shapes are removed',()=>{
  const long='가'.repeat(40000)+'끝';
  const t=cr.refillText({title:'',summary:'',points:[],raw_text:long,counterpart:null,day:''});
  assert.ok([...t].length<=cr.CALL_REFILL_TEXT_CHARS+20&&t.includes('중간 생략')&&t.endsWith('끝'));
  assert.equal(cr.cleanCallText('전화 02-123-4567 / 01012345678 / 900101-1234567 / a@b.co / 2026-10-24'),'전화  /  /  /  / 2026-10-24');
  assert.deepEqual(cr.parseCallRefillRequest({kind:'call_refill',id:id(1).toUpperCase()}),{id:id(1)});
});

test('MULTI 단계 ①: call_refill only for a workspace the server allow table marks for calls; missing check function means not ready',async()=>{
  for(const features of [{},{[OWNER]:['telegram']}]){
    const h=harness({features});
    await expectError(await post(h.handler,req(1)),403,'forbidden');
    assert.equal(h.calls.openai.length,0);assert.equal(h.calls.features,1);
    assert.ok(!h.calls.rest.some(c=>c.table==='app_feed_items'||c.table==='rpc/app_call_work_info'),'no call read or write');
  }
  const m=harness({features:'missing'});await expectError(await post(m.handler,req(1)),503,'call_refill_not_ready');assert.equal(m.calls.openai.length,0);
  const ok=harness();const res=await post(ok.handler,req(1));assert.equal(res.status,200);assert.equal(ok.calls.features,1);
});
