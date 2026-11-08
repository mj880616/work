import test from 'node:test';
import assert from 'node:assert/strict';

// S49-13 JOURNAL-기억할통화텔레그램: the real ai-assist handler, kind=journal_memorable, with a synthetic Supabase (Auth + PostgREST with owner RLS +
// operator feature check) and a mocked OpenAI. No network, no real key, synthetic text only.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const jm=await import('../../supabase/functions/ai-assist/journal-memorable.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OWNER='b0000000-0000-4000-8000-000000000001';
const DAY='2026-11-03',T0=Date.parse('2026-11-03T05:00:00Z'),HOUR=3600*1000;
const F1='c0000000-0000-4000-8000-000000000001',F2='c0000000-0000-4000-8000-000000000002',F3='c0000000-0000-4000-8000-000000000003';
const feed=(id,source,title,updated,extra={})=>({id,workspace_id:WS,day:DAY,source,title,summary:'',points:[],room_label:null,hidden_at:null,updated_at:updated,...extra});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:600,output_tokens:80}});

function harness({features=['calls','telegram'],feeds=[],runs=[],memo=[],picks=[],cands=[],orgs=[],assignees=[],spaces=[],now=T0,openai=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'}],app_feed_items:structuredClone(feeds),app_journal_memorable:structuredClone(memo),
    app_journal_memorable_runs:structuredClone(runs),app_ai_daily_usage:[],app_journal_memorable_picks:structuredClone(picks),app_todo_candidates:structuredClone(cands),
    app_suborganizations:structuredClone(orgs),app_suborganization_assignees:structuredClone(assignees),app_spaces:structuredClone(spaces)};
  const cmp=(v,op,val)=>{
    if(op==='eq')return String(v)===val;
    if(op==='gt')return v!=null&&Date.parse(v)>Date.parse(val);
    if(op==='is')return val==='null'?v==null:String(v)===val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(v));
    if(op==='gte')return v!=null&&String(v)>=val;
    if(op==='lt')return v!=null&&String(v)<val;
    throw new Error('op '+op);
  };
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer([{n:1,kind:'org',org:'가상지부',line:'가상지부 파업 일정 확정 논의함.',why:'가상지부'}]));}
    assert.equal(url.origin,SB);
    const owner=(headers.get('Authorization')||'')==='Bearer owner-token';
    if(url.pathname==='/auth/v1/user')return owner?respond({id:OWNER}):respond({msg:'bad'},401);
    assert.ok(owner,'REST only with the caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features')return respond(features);
    const table=url.pathname.replace('/rest/v1/','');
    calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null,prefer:headers.get('Prefer')});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>(table==='app_workspace_members'||table==='app_suborganization_assignees'?r.user_id===OWNER:r.workspace_id===WS)&&matches(r,url)));
    const b=init.body?JSON.parse(init.body):null;
    if(table==='app_ai_daily_usage'&&method==='POST'){const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_journal_memorable_runs'&&method==='POST'){if(!rows.some(r=>r.workspace_id===b.workspace_id&&r.day===b.day))rows.push(b);return respond('',201);}
    if(table==='app_journal_memorable_runs'&&method==='PATCH'){assert.deepEqual(Object.keys(b),['last_run_at']);for(const r of rows)if(r.workspace_id===WS&&matches(r,url))Object.assign(r,b);return new Response(null,{status:204});}
    if(table==='app_journal_memorable'&&method==='POST'){
      for(const x of b){assert.deepEqual(Object.keys(x).sort(),['day','feed_item_id','line','org_name','source','workspace_id'],'only the insert columns');
        if(!rows.some(r=>r.feed_item_id===x.feed_item_id))rows.push({id:`d0000000-0000-4000-8000-${String(rows.length+1).padStart(12,'0')}`,status:'suggested',...x});}
      return respond('',201);
    }
    if(table==='app_journal_memorable_picks'&&method==='POST'){
      for(const x of b){assert.deepEqual(Object.keys(x).sort(),['kind','memorable_id','reason','workspace_id'],'only the pick insert columns');
        assert.ok(db.app_journal_memorable.some(m=>m.id===x.memorable_id&&m.workspace_id===x.workspace_id),'pick belongs to a stored line');
        if(!rows.some(r=>r.memorable_id===x.memorable_id))rows.push({...x});}
      return respond('',201);
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-key'})[n],
    fetch:doFetch,now:()=>now,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db,at:t=>{now=t;}};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const ask={kind:'journal_memorable',day:DAY};

test('first open: new call/telegram go to AI once, the pick is stored, the run time is claimed, usage counted, no text in logs',async()=>{
  const {handler,calls,db}=harness({feeds:[feed(F1,'call','가상지부 파업 일정 확정','2026-11-03T03:00:00Z',{summary:'010-1234-5678 로 연락',points:['집회 11/10']}),feed(F2,'telegram','안부','2026-11-03T03:30:00Z')]});
  const res=await post(handler,ask);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'journal_memorable',day:DAY,sent:2,picked:1});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'journal_memorable');assert.equal(o.text.format.strict,true);
  assert.ok(o.input[0].content.includes("'~함.'·'~임.'"));
  assert.ok(!o.input[1].content.includes('010-1234-5678'),'phones are not sent');
  assert.ok(!o.input[1].content.includes(F1),'record ids are not sent');
  assert.deepEqual(db.app_journal_memorable.map(r=>[r.feed_item_id,r.source,r.org_name,r.line]),[[F1,'call','가상지부','가상지부 파업 일정 확정 논의함.']]);
  // FORGET-소식바로잡기: AI가 정한 종류·이유 한 줄은 새 표에(소식 줄 하나에 한 행), 기준은 '본인에게 해당하는 것' 다섯 종류.
  assert.deepEqual(db.app_journal_memorable_picks.map(r=>[r.memorable_id,r.kind,r.reason]),[[db.app_journal_memorable[0].id,'org','조직보고 · 가상지부']]);
  assert.deepEqual(o.text.format.schema.properties.items.items.properties.kind.enum,['task','event','note','org','area']);
  assert.ok(o.input[0].content.includes('본인에게 해당하는 것'));assert.ok(!o.input[0].content.includes('주간보고에 담을 만한'));
  assert.match(o.input[1].content,/고를 수 있는 수: 최대 5개/);
  assert.equal(db.app_journal_memorable_runs[0].last_run_at,new Date(T0).toISOString());
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/가상지부|파업/.test(JSON.stringify(calls.logs)));
  assert.equal(DAILY_LIMITS.journal_memorable,24);
});

test('opening again within one hour never calls AI; after one hour with nothing new, still no AI; with a new record only the new one is sent',async()=>{
  const h=harness({feeds:[feed(F1,'call','가상지부 파업','2026-11-03T03:00:00Z')]});
  await post(h.handler,ask);
  assert.equal(h.calls.openai.length,1);
  h.at(T0+30*60*1000);
  assert.equal((await (await post(h.handler,ask)).json()).skipped,'fresh');
  h.at(T0+2*HOUR);
  assert.equal((await (await post(h.handler,ask)).json()).skipped,'no_new');
  assert.equal(h.calls.openai.length,1);
  h.db.app_feed_items.push(feed(F3,'telegram','가상지부 교섭 요구안 전달','2026-11-03T06:30:00Z'));
  h.calls.openai.length=0;
  const res=await post(h.handler,ask);
  assert.deepEqual(await res.json(),{ok:true,kind:'journal_memorable',day:DAY,sent:1,picked:1});
  assert.match(h.calls.openai[0].input[1].content,/교섭 요구안/);
  assert.match(h.calls.openai[0].input[1].content,/고를 수 있는 수: 최대 4개/,'one new-criteria line already that day');
  assert.match(h.calls.openai[0].input[1].content,/이미 있는 것[^\n]*\n- 가상지부 · 가상지부 파업 일정 확정 논의함\./);
  assert.ok(!/파업/.test(h.calls.openai[0].input[1].content.split('\n\n기록:\n\n')[1]),'the old record is not sent again (only listed as already there)');
});

test('a record already picked is not sent again, and hidden/other-day records are never read',async()=>{
  const h=harness({runs:[{workspace_id:WS,day:DAY,last_run_at:new Date(T0-2*HOUR).toISOString()}],
    memo:[{id:'m0',workspace_id:WS,day:DAY,source:'call',feed_item_id:F1,line:'이미 고름.',status:'kept'}],
    feeds:[feed(F1,'call','이미 고른 통화','2026-11-03T04:30:00Z'),feed(F2,'call','숨긴 통화','2026-11-03T04:40:00Z',{hidden_at:'2026-11-03T04:50:00Z'})]});
  assert.equal((await (await post(h.handler,ask)).json()).skipped,'no_new');
  assert.equal(h.calls.openai.length,0);
});

test('operator feature is checked on the server: no feature, no read, no AI',async()=>{
  const h=harness({features:[],feeds:[feed(F1,'call','통화','2026-11-03T03:00:00Z')]});
  assert.equal((await (await post(h.handler,ask)).json()).skipped,'not_allowed');
  assert.equal(h.calls.openai.length,0);assert.ok(!h.calls.rest.some(c=>c.table==='app_feed_items'));
  const t=harness({features:['telegram'],feeds:[feed(F1,'call','통화 기록','2026-11-03T03:00:00Z'),feed(F2,'telegram','텔레그램 기록','2026-11-03T03:00:00Z')]});
  await post(t.handler,ask);
  const reads=t.calls.rest.filter(c=>c.table==='app_feed_items');
  assert.equal(reads.length,1);assert.match(reads[0].query,/[?&]source=eq\.telegram&/);
  assert.ok(!/통화 기록/.test(t.calls.openai[0].input[1].content));
});

test('AI failure releases the claim so the next open retries; a broken answer stores nothing',async()=>{
  const h=harness({feeds:[feed(F1,'call','가상지부 파업','2026-11-03T03:00:00Z')],openai:()=>respond({error:'x'},500)});
  const res=await post(h.handler,ask);
  assert.ok(res.status>=500);
  assert.ok(Date.parse(h.db.app_journal_memorable_runs[0].last_run_at)<T0-HOUR*24,'released to the distant past');
  const b=harness({feeds:[feed(F1,'call','가상지부 파업','2026-11-03T03:00:00Z')],openai:()=>respond(answer([{n:9,org:'',line:'없는 번호'},{n:1,org:'',line:'<b>x</b>'},{n:1,org:'',line:'전화 010-1111-2222'}]))});
  const r=await post(b.handler,ask);
  assert.deepEqual(await r.json(),{ok:true,kind:'journal_memorable',day:DAY,sent:1,picked:0});
  assert.equal(b.db.app_journal_memorable.length,0);
});

test('request shape and day range are checked; missing table reads as not ready',async()=>{
  const h=harness();
  for(const body of [{kind:'journal_memorable'},{kind:'journal_memorable',day:'11/03'},{...ask,extra:1},{kind:'journal_memorable',day:'2026-13-45'}])assert.equal((await post(h.handler,body)).status,400,JSON.stringify(body));
  assert.equal((await (await post(h.handler,{kind:'journal_memorable',day:'2026-10-01'})).json()).skipped,'out_of_range');
  assert.equal((await (await post(h.handler,{kind:'journal_memorable',day:'2026-11-09'})).json()).skipped,'out_of_range');
  assert.equal((await post(h.handler,ask,'bad')).status,401);
});

test('day cap: five new-criteria lines that day means no AI at all; old-criteria lines (no pick) do not count',async()=>{
  const ids=[1,2,3,4,5,6].map(n=>`d0000000-0000-4000-8000-00000000010${n}`);
  const memo=ids.map((id,i)=>({id,workspace_id:WS,day:DAY,source:'call',feed_item_id:`e0000000-0000-4000-8000-00000000000${i}`,org_name:null,line:'가상 줄 '+i,status:'suggested',picked_at:'2026-11-03T01:00:00Z'}));
  const full=harness({memo,picks:ids.slice(0,5).map(memorable_id=>({memorable_id,workspace_id:WS,kind:'task',reason:'할 일'})),feeds:[feed(F1,'call','가상 새 통화','2026-11-03T03:00:00Z')]});
  assert.equal((await (await post(full.handler,ask)).json()).skipped,'day_full');
  assert.equal(full.calls.openai.length,0);
  const four=harness({memo,picks:ids.slice(0,4).map(memorable_id=>({memorable_id,workspace_id:WS,kind:'task',reason:'할 일'})),feeds:[feed(F1,'call','가상 새 통화','2026-11-03T03:00:00Z'),feed(F2,'call','가상 다른 통화','2026-11-03T03:10:00Z')],
    openai:()=>respond(answer([{n:1,kind:'task',org:'',line:'가상 일 하나.',why:''},{n:2,kind:'note',org:'',line:'가상 일 둘.',why:''}]))});
  assert.deepEqual(await (await post(four.handler,ask)).json(),{ok:true,kind:'journal_memorable',day:DAY,sent:2,picked:1});
  assert.match(four.calls.openai[0].input[1].content,/최대 1개/);
});

test('same text once: a record a telegram request already points to is never sent; open requests and my orgs/areas go along as context',async()=>{
  const h=harness({feeds:[feed(F1,'call','가상 통화','2026-11-03T03:00:00Z'),feed(F2,'telegram','가상 요청 글','2026-11-03T03:10:00Z')],
    cands:[{workspace_id:WS,status:'open',source_kind:'telegram',source_id:F2,summary:'가상 요청 처리',created_at:'2026-11-03T03:20:00Z'}],
    orgs:[{id:'o1',workspace_id:WS,name:'가상지부',active:true},{id:'o2',workspace_id:WS,name:'남의지부',active:true}],assignees:[{user_id:OWNER,organization_id:'o1'}],
    spaces:[{workspace_id:WS,name:'가상 공동투쟁',status:'active'}]});
  assert.deepEqual(await (await post(h.handler,ask)).json(),{ok:true,kind:'journal_memorable',day:DAY,sent:1,picked:1});
  const sent=h.calls.openai[0].input[1].content;
  assert.ok(!sent.includes('가상 요청 글'),'the telegram request record is not sent again');
  assert.match(sent,/내 담당조직: 가상지부\n/);assert.ok(!sent.includes('남의지부'),'only my orgs when I have assignments');
  assert.match(sent,/내 사업: 가상 공동투쟁/);assert.match(sent,/- 가상 요청 처리/);
  assert.ok(!/가상 요청|가상지부/.test(JSON.stringify(h.calls.logs)));
});

test('pure rules: due after one hour, answers re-checked, secrets dropped from material',()=>{
  assert.equal(jm.memorableDue(null,T0),true);assert.equal(jm.memorableDue(new Date(T0-HOUR+1).toISOString(),T0),false);assert.equal(jm.memorableDue(new Date(T0-HOUR).toISOString(),T0),true);
  assert.equal(jm.toFeedRow({id:F1,source:'call',title:'비밀번호: abc12345 입니다',summary:'',points:[]}),null);
  assert.equal(jm.toFeedRow({id:'x',source:'call',title:'제목'}),null);
  const rows=[jm.toFeedRow({id:F1,source:'call',title:'제목'}),jm.toFeedRow({id:F2,source:'telegram',title:'다른 제목'})];
  const ok=jm.parseMemorable(JSON.stringify({items:[{n:2,kind:'event',org:'지부',line:'일정 확정함.',why:'11.14. 14:00'},{n:2,kind:'task',org:'',line:'중복',why:''},{n:1,kind:'org',org:'x'.repeat(61),line:'긴 조직',why:''},{n:1,kind:'org',org:'',line:'가'.repeat(161),why:''},{n:1,kind:'weekly',org:'',line:'다섯 밖 종류',why:''},{n:1,kind:'note',org:'',line:'이유가 김',why:'가'.repeat(41)}]}),rows);
  assert.deepEqual(ok,[{feed_item_id:F2,source:'telegram',org_name:'지부',line:'일정 확정함.',kind:'event',reason:'일정 · 11.14. 14:00'}]);
  const two=jm.parseMemorable(JSON.stringify({items:[{n:1,kind:'task',org:'',line:'하나',why:''},{n:2,kind:'note',org:'',line:'둘',why:'약속'}]}),rows,1);
  assert.deepEqual(two.map(p=>[p.kind,p.reason]),[['task','할 일']],'at most the room left that day');
  // 맥락도 믿지 않는 입력: 연락처 지움, 비밀 모양 줄 빠짐, 수는 1~5.
  const m=jm.memorableMaterial(DAY,rows,{orgs:['가상지부','가상지부'],areas:[],known:['010-1234-5678 회신','비밀번호: abc12345 입니다'],max:9});
  assert.match(m,/내 담당조직: 가상지부\n내 사업: \(없음\)/);assert.match(m,/최대 5개/);assert.match(m,/- \[전화\] 회신/);assert.ok(!m.includes('abc12345'));
  assert.equal(jm.parseMemorable('not json',rows),null);
});
