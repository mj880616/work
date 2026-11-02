import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-오늘한일업무개인: the real ai-assist handler, kind=work_scope, with a synthetic Supabase (Auth + PostgREST with owner RLS) and a
// mocked OpenAI. No network, no real key, synthetic text only. The screen sends only the week's Monday; the server reads that week's
// '오늘 한 일' lines with the caller's token, sends only lines allowed to AI (no AI-off or secret-looking note, no secret-looking line),
// writes nothing but the usage row, and returns only the lines the AI called work (unsure, missing or unsent lines are left out).
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const scope=await import('../../supabase/functions/ai-assist/work-scope.ts');
const {LEDGER_AUTO_INSTRUCTIONS}=await import('../../supabase/functions/ai-assist/ledger-auto.ts');
const {SCHEDULE_TITLES_INSTRUCTIONS}=await import('../../supabase/functions/ai-assist/schedule-titles.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const MON='2026-10-26',NOW=Date.parse('2026-10-30T09:30:00Z');
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:300,output_tokens:60}});
const note=(id,day,raw_text,extra={})=>({id,workspace_id:WS,kind:'work',journal_day:day,raw_text,title:null,metadata:{},archived_at:null,ai_export_allowed:true,...extra});
const WORK=[
  note('n1','2026-10-26','가상지부 3차 교섭 준비회의\n미술 학원 다녀 옴'),
  note('n2','2026-10-28','성명 초안 정리'),
  note('n3','2026-10-29','비밀 줄',{metadata:{ai_off:true}}),
  note('n4','2026-11-02','다음 주 줄'),
  {...note('n5','2026-10-27','남의 줄'),workspace_id:OTHER_WS},
];
// The mocked AI calls lines with '학원' personal, everything else work.
const judge=body=>{const lines=JSON.parse(body.input[1].content).lines;return respond(answer(lines.map(l=>({ref:l.ref,scope:/학원/.test(l.text)?'personal':'work'}))));};

function harness({openai=judge,usage=[],work=WORK}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_notes:structuredClone(work),app_ai_daily_usage:structuredClone(usage)};
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lte'?v!=null&&String(v)<=val:op==='lt'?v!=null&&String(v)<val:op==='is'?(val==='null'?v==null:String(v)===val):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}
    // repeated keys (journal_day=gte & journal_day=lte)
    for(const k of new Set(url.searchParams.keys()))for(const v of url.searchParams.getAll(k)){if(['select','limit','order'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}
    return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){const body=JSON.parse(init.body);calls.openai.push(body);return openai(body);}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('one AI call over the week\'s allowed lines; only work lines come back, personal and AI-off lines do not; nothing stored',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,{kind:'work_scope',week_start:MON});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body,{ok:true,kind:'work_scope',week_start:MON,work:[{day:'2026-10-26',text:'가상지부 3차 교섭 준비회의'},{day:'2026-10-28',text:'성명 초안 정리'}],personal:1,skipped:1});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'work_scope');assert.equal(o.text.format.strict,true);
  const sent=o.input[1].content;
  assert.match(sent,/미술 학원/);assert.ok(!/비밀 줄|다음 주 줄|남의 줄/.test(sent),'AI-off note, other week and other workspace are not sent');
  assert.match(o.input[0].content,/애매하면 personal/);
  assert.ok(calls.rest.every(c=>c.method==='GET'||c.table==='app_ai_daily_usage'),'only the usage row is written');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/교섭|학원|성명/.test(JSON.stringify(calls.logs)),'no text in logs');
  assert.equal(DAILY_LIMITS.work_scope,30);
});

test('unsure and missing answers leave the line out (애매하면 빼기); a broken answer is an error, not a guess',async()=>{
  const partial=harness({openai:body=>{const lines=JSON.parse(body.input[1].content).lines;return respond(answer([{ref:lines[1].ref,scope:'work'},{ref:'w99',scope:'work'},{ref:lines[1].ref,scope:'personal'}]));}});
  const r=await (await post(partial.handler,{kind:'work_scope',week_start:MON})).json();
  assert.deepEqual(r.work,[{day:'2026-10-26',text:'미술 학원 다녀 옴'}],'only the line answered work, first answer wins, unknown refs ignored');
  assert.equal(r.personal,2);
  const broken=harness({openai:()=>respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}],usage:{input_tokens:1,output_tokens:1}})});
  const b=await post(broken.handler,{kind:'work_scope',week_start:MON});
  assert.equal(b.status,502);
});

test('no lines in the week: no AI call, no usage; the stranger sees only their own lines',async()=>{
  const empty=harness({work:[]});
  const r=await (await post(empty.handler,{kind:'work_scope',week_start:MON})).json();
  assert.deepEqual(r,{ok:true,kind:'work_scope',week_start:MON,work:[],personal:0,skipped:0});
  assert.equal(empty.calls.openai.length,0);assert.equal(empty.db.app_ai_daily_usage.length,0);
  const h=harness();
  const s=await (await post(h.handler,{kind:'work_scope',week_start:MON},'stranger-token')).json();
  assert.deepEqual(s.work,[{day:'2026-10-27',text:'남의 줄'}]);
});

test('bad requests are refused before any read; secret-looking lines and notes are never sent',async()=>{
  const h=harness();
  for(const body of [{kind:'work_scope'},{kind:'work_scope',week_start:'2026-10-27'},{kind:'work_scope',week_start:'10/26'},{kind:'work_scope',week_start:MON,lines:['x']}]){
    const res=await post(h.handler,body);assert.equal(res.status,400,JSON.stringify(body));
  }
  assert.equal(h.calls.openai.length,0);
  const {lines,skipped}=scope.workScopeLines([note('a',MON,'와이파이 비밀번호: 가상값'),note('b','2026-10-27','회의\n토큰: 가상'),note('c','2026-10-28','보관',{archived_at:'2026-10-28T00:00:00Z'}),note('d','2026-10-28','제외',{ai_export_allowed:false})],MON,WS);
  assert.deepEqual(lines,[]);assert.equal(skipped,5);
});

test('the same rule is in the other uses that read 오늘 한 일 lines (원장 자동 기록·주요 일정 다듬기)',()=>{
  assert.ok(LEDGER_AUTO_INSTRUCTIONS.includes(scope.WORK_PERSONAL_RULE));
  assert.ok(SCHEDULE_TITLES_INSTRUCTIONS.includes(scope.WORK_PERSONAL_RULE));
  assert.match(scope.WORK_PERSONAL_RULE,/애매하면 쓰지 않는다/);
});
