import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// FEAT-1029묶음 ① Web2에 물어보기: the real ai-assist handler, kind=ask_web2, with a synthetic Supabase (Auth + PostgREST with owner RLS,
// the two search RPCs) and a mocked OpenAI. No network, no real key, synthetic text only.
// Checks: lines without evidence are dropped, S2 ledger and AI-excluded notes never reach AI, the server never reads the feed /
// personal call tables (only the search RPCs), another workspace's rows never show, no AI call without evidence, monthly / daily limits.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const ask=await import('../../supabase/functions/ai-assist/web2-ask.ts');
const ev=await import('../../supabase/functions/ai-assist/evidence.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-10-29T03:00:00Z');
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG=id(900);
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=lines=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({lines})}]}],usage:{input_tokens:900,output_tokens:120}});

// Search RPC results per workspace (what app_search_records would return under owner RLS).
const item=(kind,n,extra={})=>({kind,source:extra.source??(kind==='update'||kind==='work'?'note':kind),id:id(n),title:extra.title??`${kind} 제목 ${n}`,
  snippet:extra.snippet??`임금교섭 쟁점 ${n}`,occurred_at:extra.at??'2026-10-27T01:00:00+00:00',day:extra.day??null,organization_id:extra.org??null,
  ...(kind==='call'||kind==='telegram'?{summary:extra.summary??`임금교섭 요약 ${n} 010-1234-5678`}:{})});
const SEARCH={
  [WS]:[item('meeting',1,{org:ORG}),item('call',2,{title:'A 사업장 통화'}),{...item('telegram',3,{title:'가상 단톡 · 교섭 소식'}),room_key:'room-1'},item('update',4),item('update',5,{snippet:'AI_EXCLUDED_NOTE 임금교섭'})],
  [OTHER_WS]:[item('meeting',50,{snippet:'STRANGER_SECRET 임금교섭'})],
};
const LEDGER={
  [WS]:[{id:id(10),ledger_id:'L-1',kind:'commitment',title:'근거 자료 보내기 약속',summary:'11/1까지 인상률 근거 자료 보냄',date_start:'2026-10-27',validity:'active',sensitivity:'S1'},
        {id:id(11),ledger_id:'L-2',kind:'decision',title:'교섭 전략 회의',summary:'S2_STRATEGY_SECRET 양보선',date_start:'2026-10-26',validity:'active',sensitivity:'S2'}],
  [OTHER_WS]:[],
};

function harness({openai=null,usage=[],answers=[],search=SEARCH,ledger=LEDGER,missing=false,oldKinds=false}={}){
  const calls={openai:[],rest:[],rpc:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG,workspace_id:WS,name:'A 사업장',aliases:[]}],
    app_notes:[{id:id(4),workspace_id:WS,kind:'basket',ai_export_allowed:true},{id:id(5),workspace_id:WS,kind:'basket',ai_export_allowed:false}],
    app_ask_answers:structuredClone(answers),
    app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val:op==='lte'?v!=null&&String(v)<=val
    :op==='in'?val.replace(/^\(|\)$/g,'').split(',').includes(String(v)):op==='is'?(val==='null'?v==null:String(v)===val):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer([
      {text:'3차 교섭에서 성과급 기준이 쟁점임.',refs:['s1']},{text:'근거 없는 줄임.',refs:[]},{text:'없는 근거를 붙인 줄임.',refs:['s99']},
      {text:'<b>HTML 줄</b>',refs:['s1']},{text:'연락처 010-9999-8888 줄',refs:['s1']}]));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const myWs=Object.keys(wsOwner).find(w=>wsOwner[w]===uid);
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const name=url.pathname.slice('/rest/v1/rpc/'.length),args=JSON.parse(init.body);calls.rpc.push({name,args});
      if(name==='app_search_records'){
        if(oldKinds&&args.p_kinds.some(k=>k==='call'||k==='telegram'))return respond({code:'22023',message:'SEARCH_BAD_KIND'},400);
        const words=args.p_query.split(' ');
        const rows=search[myWs].filter(i=>args.p_kinds.includes(i.kind)&&words.every(w=>(i.title+' '+i.snippet).includes(w)||w==='임금교섭'||w==='쟁점'));
        return respond({words,groups:args.p_kinds.map(k=>({kind:k,items:rows.filter(r=>r.kind===k)}))});
      }
      if(name==='app_ledger_search')return respond(ledger[myWs]);
      throw new Error('unexpected rpc '+name);
    }
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    if(missing&&table==='app_ask_answers')return respond({code:'PGRST205'},404);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(method==='DELETE'&&table==='app_ask_answers'){const keep=rows.filter(r=>!(visible(table,r,uid)&&matches(r,url)));rows.length=0;rows.push(...keep);return new Response(null,{status:204});}
    if(method==='POST'&&table==='app_ask_answers'){
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['ai_status','lines','question','sources','workspace_id'],'only the five insert columns');
      assert.ok(visible(table,b,uid),'owner RLS');const row={...b,id:id(700+rows.length),created_at:new Date(NOW).toISOString()};rows.push(row);return respond([{id:row.id,created_at:row.created_at}],201);
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const Q='A 사업장 임금교섭 지난번 쟁점 뭐였지?';

test('answer: one AI call, lines without evidence / unknown refs / HTML / phone dropped, stored 30 days with sources (no snippet)',async()=>{
  const {handler,calls,db}=harness({answers:[{id:id(600),workspace_id:WS,question:'옛 질문',lines:[],sources:[],ai_status:'ok',created_at:'2026-09-01T00:00:00Z'}]});
  const res=await post(handler,{kind:'ask_web2',question:Q});
  assert.equal(res.status,200);const out=await res.json();
  assert.equal(out.status,'ok');assert.equal(calls.openai.length,1);
  assert.deepEqual(out.lines,[{text:'3차 교섭에서 성과급 기준이 쟁점임.',refs:['s1']}]);
  assert.deepEqual(out.words,['사업장','임금교섭','쟁점']);
  // The organization named in the question comes first; S2 ledger shows as title/date with a tag but not sent.
  assert.equal(out.sources[0].kind,'meeting');
  const s2=out.sources.find(s=>s.id===id(11));assert.deepEqual([s2.sent,s2.tag,s2.snippet],[false,'교섭·전략','']);
  assert.equal(out.sources.find(s=>s.id===id(5)).sent,false);
  assert.equal(out.sources.find(s=>s.kind==='telegram').room,'room-1');assert.equal(out.sources.find(s=>s.kind==='call').room,null);
  // Stored: old row (31+ days) deleted, new row with sources without snippet.
  assert.equal(db.app_ask_answers.length,1);
  const saved=db.app_ask_answers[0];
  assert.equal(saved.ai_status,'ok');assert.equal(saved.question,Q);
  assert.ok(saved.sources.every(s=>!('snippet' in s)));
  assert.ok(calls.logs.every(l=>!JSON.stringify(l).includes('임금')),'no text in logs');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
});

test('AI material: no S2 ledger text, no AI-excluded note, no ids, phones masked; server reads only the search RPCs (never feed / personal call tables)',async()=>{
  const {handler,calls}=harness();
  await post(handler,{kind:'ask_web2',question:Q});
  const sent=calls.openai[0].input[1].content;
  assert.doesNotMatch(sent,/S2_STRATEGY_SECRET|교섭 전략 회의|AI_EXCLUDED_NOTE|010-1234-5678|c0000000-/);
  assert.match(sent,/\[전화\]/);
  assert.match(sent,/업무 통화/);assert.match(sent,/텔레그램 소식/);
  const tables=new Set(calls.rest.map(r=>r.table));
  for(const t of ['app_feed_items','app_call_personal','app_tg_personal_days','app_tg_senders','app_tg_day_senders','app_call_edits'])assert.ok(!tables.has(t),t);
  assert.ok(calls.rpc.every(r=>['app_search_records','app_ledger_search'].includes(r.name)));
  assert.deepEqual(calls.rpc[0].args.p_kinds,[...ask.ASK_SEARCH_KINDS]);
  assert.equal(calls.rpc.find(r=>r.name==='app_ledger_search').args.p_max_sensitivity,'S2');
  // The static source of the ask path never names those tables either.
  const src=(await readFile(new URL('../../supabase/functions/ai-assist/web2-ask.ts',import.meta.url),'utf8'))+(await readFile(new URL('../../supabase/functions/ai-assist/evidence.ts',import.meta.url),'utf8'));
  const handlerSrc=await readFile(new URL('../../supabase/functions/ai-assist/handler.ts',import.meta.url),'utf8');
  const run=handlerSrc.slice(handlerSrc.indexOf('const ASK_TABLE'),handlerSrc.indexOf('async function insertCandidates'));
  for(const s of [src.replace(/^\/\/.*$/gm,''),run.replace(/^\s*\/\/.*$/gm,'')])assert.doesNotMatch(s,/app_feed_items|app_call_personal|app_tg_personal|app_tg_senders|raw_text/);
});

test('another workspace: only its own rows, its owner workspace is decided by the server',async()=>{
  const {handler,calls,db}=harness();
  const out=await (await post(handler,{kind:'ask_web2',question:'임금교섭 쟁점 뭐였지?'},'stranger-token')).json();
  assert.equal(out.status,'ok');
  assert.ok(out.sources.every(s=>s.id===id(50)));
  assert.doesNotMatch(calls.openai[0].input[1].content,/AI_EXCLUDED_NOTE|S2_STRATEGY/);
  assert.equal(db.app_ask_answers[0].workspace_id,OTHER_WS);
  // A workspace id in the body is refused.
  assert.equal((await post(harness().handler,{kind:'ask_web2',question:Q,workspace_id:WS},'stranger-token')).status,400);
});

test('no evidence: no AI call, stored as empty, usage untouched',async()=>{
  const {handler,calls,db}=harness({search:{[WS]:[],[OTHER_WS]:[]},ledger:{[WS]:[LEDGER[WS][1]],[OTHER_WS]:[]}});
  const out=await (await post(handler,{kind:'ask_web2',question:Q})).json();
  assert.equal(out.status,'empty');assert.equal(calls.openai.length,0);assert.equal(db.app_ai_daily_usage.length,0);
  assert.equal(db.app_ask_answers[0].ai_status,'empty');
  // Only S2 found: shown in sources, nothing sent.
  assert.deepEqual(out.sources.map(s=>[s.sent,s.tag]),[[false,'교섭·전략']]);
  // Question of only question words: no words, no search, no AI.
  const h=harness();const o2=await (await post(h.handler,{kind:'ask_web2',question:'뭐였지 언제?'})).json();
  assert.equal(o2.status,'empty');assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.openai.length,0);
});

test('limits: monthly limit and 30 a day return found sources without an AI call; total daily 80 shared',async()=>{
  const day='2026-10-29';
  const monthly=harness({usage:[{workspace_id:WS,user_id:OWNER,day,requests:1,input_tokens:200000000,output_tokens:0}]});
  const o1=await (await post(monthly.handler,{kind:'ask_web2',question:Q})).json();
  assert.equal(o1.status,'monthly_limit');assert.equal(monthly.calls.openai.length,0);assert.ok(o1.sources.length>0);
  const full=harness({answers:Array.from({length:30},(_,i)=>({id:id(800+i),workspace_id:WS,question:'질문임',lines:[],sources:[],ai_status:'ok',created_at:new Date(NOW-60000).toISOString()}))});
  const o2=await (await post(full.handler,{kind:'ask_web2',question:Q})).json();
  assert.equal(o2.status,'daily_limit');assert.equal(full.calls.openai.length,0);
  const total=harness({usage:[{workspace_id:WS,user_id:OWNER,day,requests:80,input_tokens:0,output_tokens:0}]});
  assert.equal((await (await post(total.handler,{kind:'ask_web2',question:Q})).json()).status,'daily_limit');
  assert.equal(DAILY_LIMITS.ask_web2,30);
});

test('request shape: question only, 4~200 chars, one line, no secrets; table missing → not ready; DB before stage 1 → base kinds',async()=>{
  const {handler}=harness();
  for(const body of [{kind:'ask_web2'},{kind:'ask_web2',question:'짧음'},{kind:'ask_web2',question:'가'.repeat(201)},{kind:'ask_web2',question:'두 줄\n질문임'},
    {kind:'ask_web2',question:' 앞 공백 질문'},{kind:'ask_web2',question:Q,lines:[]}])assert.equal((await post(handler,body)).status,400,JSON.stringify(body).slice(0,40));
  const secret=await post(handler,{kind:'ask_web2',question:'비밀번호: hunter2 뭐였지'});
  assert.equal(secret.status,400);assert.equal((await secret.json()).error,'ask_secret');
  assert.equal((await post(harness({missing:true}).handler,{kind:'ask_web2',question:Q})).status,503);
  const old=harness({oldKinds:true});const out=await (await post(old.handler,{kind:'ask_web2',question:Q})).json();
  assert.equal(out.status,'ok');assert.deepEqual(old.calls.rpc.filter(r=>r.name==='app_search_records').at(-1).args.p_kinds,[...ask.ASK_BASE_KINDS]);
  assert.equal((await post(handler,{kind:'ask_web2',question:Q},'nobody')).status,401);
});

test('invalid AI answer: stored as failed, no lines',async()=>{
  const {handler,db}=harness({openai:()=>respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}],usage:{input_tokens:1,output_tokens:1}})});
  const out=await (await post(handler,{kind:'ask_web2',question:Q})).json();
  assert.equal(out.status,'failed');assert.deepEqual(out.lines,[]);assert.equal(db.app_ask_answers[0].ai_status,'failed');
});

test('shared evidence check (evidence.ts): refs must be in the allowed set, lines need a ref, max lines/chars, no HTML/contact/secret',()=>{
  const allowed=new Set(['s1','s2']);
  const raw=JSON.stringify({lines:[{text:' 첫 줄임. ',refs:['s1','s1','s2','s3']},{text:'근거 없음',refs:['s9']},{text:'가'.repeat(121),refs:['s1']},
    {text:'메일 a@b.co',refs:['s1']},{text:'토큰: abc',refs:['s1']},{text:'<i>x</i>',refs:['s1']},{text:'둘째 줄임.',refs:['s2']}]});
  assert.deepEqual(ev.evidenceLines(raw,allowed,{maxLines:6,maxChars:120}),[{text:'첫 줄임.',refs:['s1','s2']},{text:'둘째 줄임.',refs:['s2']}]);
  assert.equal(ev.evidenceLines('{"x":1}',allowed,{maxLines:6,maxChars:120}),null);
  assert.equal(ev.evidenceLines('[]',allowed,{maxLines:6,maxChars:120}),null);
  assert.equal(ev.maskEvidenceText('전화 010-1234-5678 메일 a@b.co','100'.length*20),'전화 [전화] 메일 [이메일]');
  assert.deepEqual(ev.evidenceSchema(3).properties.lines.maxItems,3);
});

test('words: question words and particles removed, max 6, at least 2 chars',()=>{
  assert.deepEqual(ask.askWords('A 사업장 임금교섭 지난번 쟁점 뭐였지?'),['사업장','임금교섭','쟁점']);
  assert.deepEqual(ask.askWords('B 지부와 단체협약에서 합의했나'),['지부','단체협약','합의']);
  assert.ok(ask.askWords('하나 둘셋 넷다섯 여섯일곱 여덟아홉 열하나 열둘셋').length<=6);
  assert.deepEqual(ask.askWords('뭐 언제 왜'),[]);
});
