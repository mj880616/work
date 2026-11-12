import test from 'node:test';
import assert from 'node:assert/strict';

// S54-28 FORGET-소식바로잡기 ④: the real ai-assist handler, kind=journal_memorable_recheck (쌓인 소식 한 번 다시 판정), with a synthetic Supabase
// (Auth + PostgREST that applies owner RLS per caller token + operator feature check) and a mocked OpenAI. No network, no real key, synthetic text only.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const jm=await import('../../supabase/functions/ai-assist/journal-memorable.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',MEMBER='b0000000-0000-4000-8000-000000000002',OTHER='b0000000-0000-4000-8000-000000000003';
const USERS={'owner-token':OWNER,'member-token':MEMBER,'other-token':OTHER};
const T0=Date.parse('2026-11-09T05:00:00Z'); // 한국 2026-11-09 14:00 → 최근 2주 = 2026-10-26부터
const pad=n=>String(n).padStart(12,'0');
const lid=n=>`d0000000-0000-4000-8000-${pad(n)}`,fid=n=>`c0000000-0000-4000-8000-${pad(n)}`;
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:900,output_tokens:120}});
// n번 옛 소식 줄(종류·이유 없음)과 그 원본 기록. day가 클수록 최근.
const line=(n,day,extra={})=>({id:lid(n),workspace_id:WS,day,source:'call',feed_item_id:fid(n),org_name:null,line:'가상 옛 줄 '+n,status:'suggested',
  final_line:null,drop_reason:null,picked_at:`${day}T01:00:00Z`,decided_at:null,...extra});
const feed=(n,extra={})=>({id:fid(n),workspace_id:WS,source:'call',title:'가상 통화 '+n,summary:'',points:[],room_label:null,hidden_at:null,...extra});

function harness({features=['calls','telegram'],memo=[],feeds=[],picks=[],cands=[],openai=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:WS,user_id:MEMBER,role:'member'},{workspace_id:WS2,user_id:OTHER,role:'owner'}],
    app_journal_memorable:structuredClone(memo),app_journal_memorable_picks:structuredClone(picks),app_feed_items:structuredClone(feeds),app_ai_daily_usage:[],
    app_todo_candidates:structuredClone(cands),app_suborganizations:[],app_suborganization_assignees:[],app_spaces:[]};
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
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1),calls.openai.length):respond(answer([]));}
    assert.equal(url.origin,SB);
    const user=USERS[(headers.get('Authorization')||'').replace('Bearer ','')];
    if(url.pathname==='/auth/v1/user')return user?respond({id:user}):respond({msg:'bad'},401);
    assert.ok(user,'REST only with a caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features')return respond(user===OWNER?features:[]);
    const table=url.pathname.replace('/rest/v1/','');
    calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null,user});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    // owner RLS: 호출한 사람이 owner인 작업공간 줄만 보이고 바뀐다(서비스 키 없음).
    const owned=new Set(db.app_workspace_members.filter(m=>m.user_id===user&&m.role==='owner').map(m=>m.workspace_id));
    const visible=r=>table==='app_workspace_members'||table==='app_suborganization_assignees'?r.user_id===user:owned.has(r.workspace_id);
    if(method==='GET')return respond(rows.filter(r=>visible(r)&&matches(r,url)));
    const b=init.body?JSON.parse(init.body):null;
    if(table==='app_ai_daily_usage'&&method==='POST'){const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_journal_memorable_picks'&&method==='POST'){
      for(const x of b){assert.deepEqual(Object.keys(x).sort(),['kind','memorable_id','reason','workspace_id'],'only the pick insert columns');
        assert.ok(owned.has(x.workspace_id)&&db.app_journal_memorable.some(m=>m.id===x.memorable_id&&m.workspace_id===x.workspace_id),'pick belongs to my stored line');
        if(!rows.some(r=>r.memorable_id===x.memorable_id))rows.push({...x});}
      return respond('',201);
    }
    if(table==='app_journal_memorable'&&method==='PATCH'){
      assert.deepEqual(Object.keys(b).sort(),['decided_at','status'],'only status and decided_at');assert.equal(b.status,'dropped');
      for(const r of rows)if(visible(r)&&matches(r,url))Object.assign(r,b);
      return new Response(null,{status:204});
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-key'})[n],
    fetch:doFetch,now:()=>T0,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const preview={kind:'journal_memorable_recheck',mode:'preview'},run={kind:'journal_memorable_recheck',mode:'run'};
const snapshot=db=>JSON.stringify([db.app_journal_memorable,db.app_journal_memorable_picks]);

test('preview changes nothing and gives counts only; run keeps the lines AI picks (kind·reason) and moves the rest to dropped without deleting',async()=>{
  const memo=[line(1,'2026-11-08'),line(2,'2026-11-07'),line(3,'2026-11-01'),line(4,'2026-10-20')]; // 4는 2주 전보다 옛날 → 대상 아님
  const ai=()=>respond(answer([{n:2,kind:'task',org:'',line:'가상 회신 준비함.',why:'회신'}]));
  const h=harness({memo,feeds:[feed(1),feed(2),feed(3),feed(4)],openai:ai});
  const before=snapshot(h.db);
  const p=await (await post(h.handler,preview)).json();
  assert.deepEqual(p,{ok:true,kind:'journal_memorable_recheck',mode:'preview',target:3,keep:1,drop:2,left:0,promise:0,calls:1,sent:3});
  assert.equal(snapshot(h.db),before,'preview writes nothing to the news tables');
  assert.ok(!h.calls.rest.some(c=>c.method!=='GET'&&c.table!=='app_ai_daily_usage'));
  // 같은 지시문·같은 스키마(복제 아님), 고를 수 있는 수는 10, 줄마다 날짜, 기록 id·연락처는 보내지 않음.
  const o=h.calls.openai[0];
  assert.equal(o.input[0].content,jm.MEMORABLE_INSTRUCTIONS);assert.deepEqual(o.text.format.schema,jm.MEMORABLE_SCHEMA);assert.equal(o.store,false);
  assert.match(o.input[1].content,/고를 수 있는 수: 최대 10개/);assert.match(o.input[1].content,/1\. \[통화\] 날짜: 2026-11-08/);
  assert.ok(!o.input[1].content.includes(fid(1)));assert.ok(!o.input[1].content.includes('가상 통화 4'));
  assert.ok(!/가상 옛 줄 [123]$/m.test(o.input[1].content.split('기록:')[0]),'the lines being judged are not listed as already there');

  const r=await (await post(h.handler,run)).json();
  assert.equal(r.keep,1);assert.equal(r.drop,2);assert.equal(r.left,0);assert.equal(r.at,new Date(T0).toISOString());
  assert.deepEqual(r.dropped_ids.sort(),[lid(1),lid(3)]);assert.deepEqual(r.kept_ids,[lid(2)]);
  assert.equal(h.db.app_journal_memorable.length,4,'nothing deleted');
  const by=Object.fromEntries(h.db.app_journal_memorable.map(m=>[m.id,m]));
  assert.equal(by[lid(2)].status,'suggested');assert.equal(by[lid(1)].status,'dropped');assert.equal(by[lid(3)].status,'dropped');assert.equal(by[lid(4)].status,'suggested');
  assert.equal(by[lid(1)].decided_at,new Date(T0).toISOString());assert.equal(by[lid(1)].line,'가상 옛 줄 1','content columns untouched');
  assert.deepEqual(h.db.app_journal_memorable_picks.map(x=>[x.memorable_id,x.kind,x.reason]),[[lid(2),'task','할 일 · 회신']]);
  // 기록에는 id·수만(내용 없음).
  const done=h.calls.logs.filter(l=>l.code==='journal_memorable_recheck_done').at(-1).detail;
  assert.deepEqual(done.dropped_ids.sort(),[lid(1),lid(3)]);assert.ok(!/가상/.test(JSON.stringify(h.calls.logs)));
  assert.ok(DAILY_LIMITS.journal_memorable_recheck>=2);
});

test('idempotent: a second run judges nothing (no AI), and lines already on the new criteria or already decided are never touched',async()=>{
  const memo=[line(1,'2026-11-08'),line(2,'2026-11-08'),line(3,'2026-11-07',{status:'kept'}),line(5,'2026-11-06',{status:'dropped'})];
  const h=harness({memo,feeds:[feed(1),feed(2),feed(3),feed(5)],picks:[{memorable_id:lid(2),workspace_id:WS,kind:'note',reason:'기억할 것'}],
    openai:()=>respond(answer([{n:1,kind:'event',org:'',line:'가상 일정 확정함.',why:'11.14. 14:00'}]))});
  const first=await (await post(h.handler,run)).json();
  assert.deepEqual([first.target,first.keep,first.drop,first.sent],[1,1,0,1],'only the one old-criteria open line is judged');
  assert.equal(h.calls.openai.length,1);
  const after=snapshot(h.db);
  const again=await (await post(h.handler,run)).json();
  assert.deepEqual([again.target,again.keep,again.drop,again.left],[0,0,0,0]);
  assert.equal(h.calls.openai.length,1,'no second AI call');assert.equal(snapshot(h.db),after);
});

test('more than ten fitting lines: newest ten stay, everything older goes to dropped; at most three AI calls per request, unseen lines wait when room is left',async()=>{
  const many=Array.from({length:45},(_,i)=>line(i+1,`2026-11-${String(9-Math.floor(i/6)).padStart(2,'0')}`));
  const all=Array.from({length:45},(_,i)=>feed(i+1));
  // 첫 묶음(30줄)에서 AI가 10줄을 고르면 자리가 다 차서 나머지 35줄은 모두 무시(AI 한 번).
  const pickTen=()=>respond(answer(Array.from({length:12},(_,i)=>({n:i+1,kind:'note',org:'',line:'가상 기억 '+i+'.',why:''}))));
  const a=harness({memo:many,feeds:all,openai:pickTen});
  const r=await (await post(a.handler,run)).json();
  assert.deepEqual([r.target,r.keep,r.drop,r.left,r.calls],[45,10,35,0,1]);
  assert.match(a.calls.openai[0].input[1].content,/최대 10개/);
  assert.deepEqual(a.db.app_journal_memorable_picks.map(x=>x.memorable_id),many.slice(0,10).map(m=>m.id),'the newest ones stay');
  // AI가 아무것도 고르지 않으면 30줄씩 보고 무시, 횟수 상한(3) 안에서 다 봄.
  const none=harness({memo:many,feeds:all,openai:()=>respond(answer([]))});
  const n=await (await post(none.handler,run)).json();
  assert.deepEqual([n.keep,n.drop,n.left,n.calls],[0,45,0,2]);
  // 100줄이면 3번(90줄)까지만 보고, 남길 자리가 남았으니 못 본 10줄은 그대로 둔다(다음에 다시).
  const big=Array.from({length:100},(_,i)=>line(i+1,'2026-11-0'+(1+(i%8))));
  const b=harness({memo:big,feeds:Array.from({length:100},(_,i)=>feed(i+1)),openai:()=>respond(answer([]))});
  const bb=await (await post(b.handler,run)).json();
  assert.deepEqual([bb.keep,bb.drop,bb.left,bb.calls],[0,90,10,3]);
  assert.equal(b.db.app_journal_memorable.filter(m=>m.status==='suggested').length,10);
});

test('unjudgeable lines (source gone or hidden, same record as a telegram request) go to dropped without being sent; AI failure changes nothing',async()=>{
  const memo=[line(1,'2026-11-08'),line(2,'2026-11-08'),line(3,'2026-11-08',{source:'telegram'}),line(4,'2026-11-08')];
  const h=harness({memo,feeds:[feed(1),feed(2,{hidden_at:'2026-11-08T03:00:00Z'}),feed(3,{source:'telegram'})],
    cands:[{workspace_id:WS,status:'open',source_kind:'telegram',source_id:fid(3),summary:'가상 요청',created_at:'2026-11-08T03:00:00Z'}],
    openai:()=>respond(answer([{n:1,kind:'task',org:'',line:'가상 일.',why:''}]))});
  const r=await (await post(h.handler,run)).json();
  assert.deepEqual([r.target,r.keep,r.drop,r.sent],[4,1,3,1]);
  assert.ok(!h.calls.openai[0].input[1].content.includes('가상 통화 2'));
  const reads=h.calls.rest.filter(c=>c.table==='app_feed_items');
  assert.ok(reads.every(c=>/[?&]source=eq\.(call|telegram)&hidden_at=is\.null&/.test(c.query)),'each feed read pins its source and skips hidden');
  const f=harness({memo,feeds:[feed(1)],openai:()=>respond({error:'x'},500)});
  const before=snapshot(f.db);
  assert.ok((await post(f.handler,run)).status>=500);assert.equal(snapshot(f.db),before);
  const bad=harness({memo,feeds:[feed(1)],openai:()=>respond('{"oops":1}')});
  assert.equal((await post(bad.handler,run)).status,502);assert.equal(snapshot(bad.db),snapshot(harness({memo}).db));
});

test('refused: not an owner, no operator feature, another workspace untouched, bad request shape, no session',async()=>{
  const memo=[line(1,'2026-11-08')];
  const h=harness({memo,feeds:[feed(1)]});
  assert.equal((await post(h.handler,run,'member-token')).status,403,'a non-owner member is refused');
  // 다른 작업공간의 소유자는 자기 작업공간만(이 작업공간 줄은 보이지도 바뀌지도 않음) — 운영자 기능이 없으니 거절.
  assert.equal((await post(h.handler,run,'other-token')).status,403);
  assert.equal(h.db.app_journal_memorable[0].status,'suggested');
  const nofeat=harness({features:[],memo,feeds:[feed(1)]});
  const res=await post(nofeat.handler,run);
  assert.equal(res.status,403);assert.equal(nofeat.calls.openai.length,0);
  assert.ok(!nofeat.calls.rest.some(c=>c.table==='app_journal_memorable'||c.table==='app_feed_items'),'nothing read without the feature');
  for(const body of [{kind:'journal_memorable_recheck'},{kind:'journal_memorable_recheck',mode:'apply'},{...run,workspace_id:WS2},{...run,ids:[lid(1)]}])
    assert.equal((await post(h.handler,body)).status,400,JSON.stringify(body));
  assert.equal((await post(h.handler,run,'bad')).status,401);
  assert.equal(h.calls.openai.length,0);assert.equal(h.db.app_journal_memorable[0].status,'suggested');
});

test('telegram-only operator: call lines are left as they are (not read, not judged, not dropped)',async()=>{
  const memo=[line(1,'2026-11-08'),line(2,'2026-11-08',{source:'telegram'})];
  const h=harness({features:['telegram'],memo,feeds:[feed(1),feed(2,{source:'telegram'})],openai:()=>respond(answer([]))});
  const r=await (await post(h.handler,run)).json();
  assert.deepEqual([r.target,r.drop],[1,1]);
  assert.equal(h.db.app_journal_memorable.find(m=>m.id===lid(1)).status,'suggested');
  assert.ok(h.calls.rest.filter(c=>c.table==='app_feed_items').every(c=>/source=eq\.telegram/.test(c.query)));
});

test('pure split: keep up to ten, judged-but-not-picked and unjudgeable drop, unseen wait only while room is left',()=>{
  assert.deepEqual(jm.recheckSplit(['a','b','c','d'],['a','b'],['a'],['d']),{keep:['a'],drop:['b','d'],left:['c']});
  const ids=Array.from({length:12},(_,i)=>'x'+i);
  const s=jm.recheckSplit(ids,ids.slice(0,10),ids.slice(0,10),[]);
  assert.deepEqual([s.keep.length,s.drop,s.left],[10,['x10','x11'],[]]);
  assert.deepEqual(jm.parseJournalMemorableRecheckRequest({kind:'journal_memorable_recheck',mode:'run'}),{mode:'run'});
  assert.equal(jm.parseJournalMemorableRecheckRequest({kind:'journal_memorable_recheck',mode:'run',x:1}),null);
  // 일반 고르기의 상한(5)은 그대로.
  const rows=Array.from({length:8},(_,i)=>jm.toFeedRow({id:fid(i+1),source:'call',title:'제목 '+i}));
  const items=rows.map((_,i)=>({n:i+1,kind:'note',org:'',line:'줄 '+i,why:''}));
  assert.equal(jm.parseMemorable(JSON.stringify({items}),rows,9).length,5);
  assert.equal(jm.parseMemorable(JSON.stringify({items}),rows,9,jm.MEMORABLE_RECHECK_KEEP_MAX).length,8);
  assert.match(jm.memorableMaterial('2026-11-09',rows,{max:9}),/최대 5개/);
  assert.match(jm.memorableMaterial('2026-11-09',rows,{max:9,cap:99}),/최대 5개/,'only the recheck cap can raise it');
});
