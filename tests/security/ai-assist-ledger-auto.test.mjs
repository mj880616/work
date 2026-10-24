import test from 'node:test';
import assert from 'node:assert/strict';

// LEDGER-자동기록 2단계: the real ai-assist handler, kind=ledger_auto, with a synthetic Supabase (Auth + PostgREST with owner RLS +
// the two DB functions app_auto_ledger_begin / app_auto_ledger_record of 20261024120000_ledger_auto_record) and a mocked OpenAI.
// No network, no real key, synthetic text only (가상 이름, 09xx ids). The server only adds (new / change / add_source) and marks needs_check.
const {createAiAssistHandler,DAILY_LIMITS,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const auto=await import('../../supabase/functions/ai-assist/ledger-auto.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002',MEMBER='b0000000-0000-4000-8000-000000000003';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG='d0000000-0000-4000-8000-000000000001',PROJECT='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000003';
const NOW=Date.parse('2026-10-24T03:00:00Z'),TODAY='2026-10-24',RECENT='2026-10-24T02:00:00.000Z',FIRST_RUN='2026-10-24T01:00:00.000Z';
const SECRET='SECRET_DIARY_TEXT',S2_TITLE='가상 교섭 전략 S2 제목',NEGO='NEGO_MEETING_TEXT';

const answer=(items,outdated=[])=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items,outdated})}]}],usage:{input_tokens:6000,output_tokens:500}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const item=(over={})=>({kind:'event',title:'가 지부 임금교섭 시작.',summary:'가 지부와 임금교섭 시작 합의.',date:'2026-10-20',sensitivity:'S1',source:'r1',event:'',same_as:'',counterparty:'',follow_up_on:'',decision_type:'',sure:true,...over});
const run={kind:'ledger_auto'};

function harness({openai=null,runs=[{id:id(500),workspace_id:WS,status:'done',started_at:FIRST_RUN,tokens_in:1,tokens_out:1}],seen=[],usage=[],ledgerMissing=false,recordReply=null,beginError=null,fail={}}={}){
  const calls={openai:[],rest:[],rpc:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'},{workspace_id:WS,user_id:MEMBER,role:'member'}],
    app_notes:[
      {id:id(1),workspace_id:WS,kind:'basket',title:null,raw_text:'가 지부와 임금교섭 시작하기로 함. 10월 20일.',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(2),workspace_id:WS,kind:'diary',title:null,raw_text:SECRET,occurred_at:RECENT,updated_at:RECENT,journal_day:TODAY,archived_at:null,ai_export_allowed:false},
      {id:id(3),workspace_id:WS,kind:'basket',title:null,raw_text:'보관한 메모 ARCHIVED_TEXT',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:RECENT,ai_export_allowed:true},
      {id:id(4),workspace_id:WS,kind:'basket',title:null,raw_text:'내보내기 금지 EXCLUDED_TEXT',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:false},
      {id:id(5),workspace_id:WS,kind:'note',title:'가상 노트',raw_text:'노트 본문: 위원회 구성 논의 NOTE_TEXT',occurred_at:null,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(6),workspace_id:WS,kind:'work',title:null,raw_text:'업무일지: 상대 기관 회신 대기 WORK_TEXT',occurred_at:null,updated_at:RECENT,journal_day:TODAY,archived_at:null,ai_export_allowed:true},
      {id:id(7),workspace_id:OTHER_WS,kind:'basket',title:null,raw_text:'FOREIGN_TEXT',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(8),workspace_id:WS,kind:'basket',title:null,raw_text:'켜기 전 메모 BEFORE_START_TEXT',occurred_at:'2026-10-20T00:00:00.000Z',updated_at:'2026-10-20T00:00:00.000Z',journal_day:null,archived_at:null,ai_export_allowed:true},
    ],
    app_meetings:[
      {id:id(10),workspace_id:WS,title:'나 회의',series_name:'나 회의',meeting_at:'2026-10-23T05:00:00Z',transcript_text:'나 회의 결과: 상대 기관이 자료를 다음 주까지 주기로 약속',activity_kind:'meeting',updated_at:RECENT},
      {id:id(14),workspace_id:WS,title:'가 지부 교섭',series_name:'가 지부 교섭',meeting_at:'2026-10-23T06:00:00Z',transcript_text:`교섭 3차: ${NEGO}`,activity_kind:'negotiation',updated_at:RECENT},
    ],
    app_suborganizations:[{id:ORG,workspace_id:WS,name:'가 지부'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_suborganization_updates:[{id:id(11),organization_id:ORG,occurred_at:RECENT,raw_text:'가 지부 기록: 교섭 2차 일정 확정'},{id:id(12),organization_id:FOREIGN_ORG,occurred_at:RECENT,raw_text:'FOREIGN_ORG_TEXT'}],
    app_spaces:[{id:PROJECT,workspace_id:WS,name:'다 프로젝트',owner_id:OWNER}],
    app_project_progress_updates:[{id:id(13),project_id:PROJECT,summary:'다 프로젝트: 위원회 안건 채택',effective_on:TODAY,created_at:RECENT}],
    app_ai_daily_usage:structuredClone(usage),
    app_ledger_auto_runs:structuredClone(runs),
    app_ledger_auto_sources:structuredClone(seen),
    app_ledger_records:[
      {id:id(20),workspace_id:WS,kind:'event',ledger_id:'EVT-0901',title:'가상 노선 쟁점',validity:'current',scope:'work',sensitivity:'S1',updated_at:RECENT},
      {id:id(21),workspace_id:WS,kind:'event',ledger_id:'EVT-0902',title:S2_TITLE,validity:'current',scope:'work',sensitivity:'S2',updated_at:RECENT},
      {id:id(22),workspace_id:OTHER_WS,kind:'event',ledger_id:'EVT-0903',title:'FOREIGN_EVENT',validity:'current',scope:'work',sensitivity:'S1',updated_at:RECENT},
      {id:id(23),workspace_id:WS,kind:'decision',ledger_id:'DEC-0901',title:'가 지부 교섭 위원 확정',validity:'current',scope:'work',sensitivity:'S1',updated_at:RECENT},
      {id:id(24),workspace_id:WS,kind:'event',ledger_id:'EVT-0904',title:'이미 뽑은 임금교섭 사건',validity:'current',scope:'work',sensitivity:'S1',updated_at:RECENT},
      {id:id(25),workspace_id:WS,kind:'event',ledger_id:'EVT-0905',title:'폐기된 사건',validity:'retired',scope:'work',sensitivity:'S1',updated_at:RECENT},
    ],
    app_ledger_organizations:[{id:id(30),workspace_id:WS,ledger_id:'ORG-0901',suborganization_id:ORG,status:'active'}],
    app_ledger_sources:[{id:id(40),workspace_id:WS,location:`web2:basket:${id(1)}`,status:'active'}],
    app_ledger_record_sources:[{id:id(41),workspace_id:WS,record_id:id(24),source_id:id(40)}],
    app_ledger_links:[{id:id(42),workspace_id:WS,record_id:id(23),target_organization_id:id(30)}],
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER,'member-token':MEMBER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=Object.fromEntries(db.app_suborganizations.map(o=>[o.id,o.workspace_id]));
  const projWs=Object.fromEntries(db.app_spaces.map(p=>[p.id,p.workspace_id]));
  const visible=(table,row,uid)=>table==='app_suborganization_updates'?wsOwner[orgWs[row.organization_id]]===uid
    :table==='app_project_progress_updates'?wsOwner[projWs[row.project_id]]===uid
    :table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val; if(op==='neq')return String(cell)!==val;
    if(op==='gte')return cell!=null&&String(cell)>=val; if(op==='lt')return cell!=null&&String(cell)<val;
    if(op==='in')return val.slice(1,-1).split(',').map(v=>v.replace(/^"|"$/g,'')).includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
    if(op==='not'&&val==='is.null')return cell!=null;
    throw new Error('op '+op);
  };
  const instant=(k,v)=>/_at$/.test(k)&&typeof v==='string'&&v.includes('T')?new Date(v).toISOString():v;
  const matches=(row,url)=>{
    for(const [k,v] of url.searchParams){
      if(['select','limit','order','on_conflict'].includes(k))continue;
      const i=v.indexOf('.'),op=v.slice(0,i),val=v.slice(i+1);
      if(!cmp(instant(k,row[k]),op,instant(k,val)))return false;
    }
    return true;
  };
  // DB functions (shape of 20261024120000_ledger_auto_record.sql): owner check, 16/day, one running, record = one transaction.
  const rpc=(name,args,uid)=>{
    calls.rpc.push({name,args:structuredClone(args)});
    if(name==='app_auto_ledger_begin'){
      if(beginError)return respond({code:'P0001',message:beginError+' synthetic detail'},400);
      if(wsOwner[args.p_workspace_id]!==uid)return respond({code:'42501',message:'LEDGER_AUTO_NOT_OWNER'},403);
      const runId=id(600+db.app_ledger_auto_runs.length);
      db.app_ledger_auto_runs.push({id:runId,workspace_id:args.p_workspace_id,status:'running',started_at:new Date(NOW).toISOString(),tokens_in:0,tokens_out:0});
      return respond({run_id:runId,started_at:new Date(NOW).toISOString(),first_run:false,last_done_at:null});
    }
    if(name==='app_auto_ledger_record'){
      const r=db.app_ledger_auto_runs.find(x=>x.id===args.p_run_id);
      if(!r||wsOwner[r.workspace_id]!==uid)return respond({code:'42501',message:'LEDGER_AUTO_NOT_OWNER'},403);
      if(recordReply)return respond(recordReply(args));
      const b=args.p_batch;
      assert.deepEqual(Object.keys(b).sort(),['excluded','items','needs_check','sources','tokens_in','tokens_out']);
      for(const s of b.sources){
        const i=db.app_ledger_auto_sources.findIndex(x=>x.workspace_id===r.workspace_id&&x.source_kind===s.kind&&x.source_id===s.id);
        const row={workspace_id:r.workspace_id,source_kind:s.kind,source_id:s.id,seen_updated_at:s.updated_at,last_run_id:r.id};
        if(i>=0)db.app_ledger_auto_sources[i]=row;else db.app_ledger_auto_sources.push(row);
      }
      r.status='done';
      return respond({ok:true,run_id:r.id,sources_seen:b.sources.length,records_new:b.items.filter(i=>i.op==='new').length,
        changes_linked:b.items.filter(i=>i.belongs_to).length,sources_added:b.items.filter(i=>i.op==='add_source').length,needs_check:b.needs_check.length,skipped:0,excluded:b.excluded});
    }
    throw new Error('unexpected rpc '+name);
  };
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));const f=openai??[()=>respond(answer([item()]))];return f[Math.min(calls.openai.length-1,f.length-1)](calls.openai.at(-1));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body,uid});
    if(ledgerMissing&&(table.startsWith('app_ledger_')||table.startsWith('rpc/app_auto_')))return respond({code:'PGRST205',message:'schema cache'},404);
    if(fail[table]&&(fail[table]===true||fail[table]===method))return respond({message:'synthetic db detail'},500);
    if(table.startsWith('rpc/'))return rpc(table.slice(4),JSON.parse(init.body),uid);
    // Add-only: the server never writes ledger rows directly (only through the DB function), and never deletes anything.
    assert.ok(!['app_ledger_records','app_ledger_organizations','app_ledger_sources','app_ledger_links','app_ledger_record_sources','app_ledger_record_changes','app_ledger_auto_sources'].includes(table)||method==='GET','no direct ledger writes');
    assert.notEqual(method,'DELETE','nothing is deleted');
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    if(method==='PATCH'){
      assert.equal(table,'app_ledger_auto_runs','only the run row is closed by PATCH');
      const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body).sort(),['fail_code','finished_at','status','tokens_in','tokens_out']);
      for(const r of rows)if(visible(table,r,uid)&&matches(r,url))Object.assign(r,body);
      return new Response(null,{status:204});
    }
    if(method==='POST'){
      const body=JSON.parse(init.body);
      assert.equal(table,'app_ai_daily_usage');
      if(!visible(table,body,uid))return respond({message:'rls'},403);
      const i=rows.findIndex(r=>r.workspace_id===body.workspace_id&&r.user_id===body.user_id&&r.day===body.day);if(i>=0)rows[i]={...rows[i],...body};else rows.push(body);
      return new Response(null,{status:201});
    }
    throw new Error('method '+method+' '+table);
  };
  const env={SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'};
  const handler=createAiAssistHandler({env:n=>env[n],fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);return b;};
const sentOf=o=>JSON.parse(o.input[1].content);
const refOf=(o,text)=>sentOf(o).records.find(r=>r.text.includes(text)).ref;
const batchOf=h=>h.calls.rpc.find(c=>c.name==='app_auto_ledger_record').args.p_batch;
const RPC_ORDER=h=>h.calls.rpc.map(c=>c.name);

test('six materials only (no diary·archived·AI-excluded·foreign·before start), S2 titles never sent, one shared OpenAI call, DB functions with the caller token',async()=>{
  const h=harness({openai:[o=>respond(answer([item({source:refOf(o,'임금교섭 시작')}),
    item({kind:'decision',title:'위원회 안건 채택.',summary:'안건 채택.',source:refOf(o,'안건'),decision_type:'adopted',date:TODAY}),
    item({kind:'commitment',title:'상대 기관 자료 제공 약속.',summary:'다음 주까지 자료 제공 약속.',source:refOf(o,'약속'),counterparty:'가상 상대 기관',follow_up_on:'2026-10-30'}),
    item({title:'가 지부 2차 일정.',summary:'2차 일정 확정.',source:refOf(o,'2차 일정'),date:''})]))]});
  const res=await post(h.handler,run);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);assert.equal(body.kind,'ledger_auto');assert.equal(body.records_new,4);assert.equal(body.sources_seen,7);
  assert.equal(h.calls.openai.length,1);
  const o=h.calls.openai[0],material=o.input[1].content;
  assert.equal(o.store,false);assert.equal(o.tools,undefined);assert.equal(o.text.format.name,'ledger_auto');assert.equal(o.text.format.strict,true);
  for(const hidden of [SECRET,'ARCHIVED_TEXT','EXCLUDED_TEXT','FOREIGN_TEXT','FOREIGN_ORG_TEXT','BEFORE_START_TEXT','FOREIGN_EVENT',S2_TITLE,'EVT-0902','EVT-0905',OWNER,WS,id(1)])
    assert.ok(!material.includes(hidden),hidden+' must not be sent');
  const sent=sentOf(o);
  assert.deepEqual(sent.records.map(r=>r.type).sort(),['노트','담당조직 기록','사업 보고(교섭)','사업 보고(회의)','업데이트','업무일지 한 줄','프로젝트 기록']);
  assert.ok(sent.records.every(r=>/^r\d+$/.test(r.ref)),'only short per-run refs');
  assert.ok(sent.known_records.every(r=>['EVT-0901','DEC-0901','EVT-0904'].includes(r.id)));
  const notesQuery=h.calls.rest.find(c=>c.table==='app_notes').query;
  assert.match(notesQuery,/kind=in\.\(basket,note,work\)/);assert.match(notesQuery,/archived_at=is\.null/);assert.match(notesQuery,/ai_export_allowed=is\.true/);
  assert.deepEqual(RPC_ORDER(h),['app_auto_ledger_begin','app_auto_ledger_record']);
  assert.deepEqual(h.calls.rpc[0].args,{p_workspace_id:WS});
  assert.ok(h.calls.rest.every(c=>c.uid===OWNER),'every DB call with the owner token');
  const b=batchOf(h);
  assert.equal(b.sources.length,7);
  assert.ok(b.sources.every(s=>auto.AUTO_SOURCE_KINDS.includes(s.kind)&&/^c0000000-/.test(s.id)&&s.updated_at));
  assert.ok(!b.sources.some(s=>[id(2),id(3),id(4),id(7),id(8),id(12)].includes(s.id)));
  assert.equal(b.tokens_in,6000);assert.equal(b.tokens_out,500);assert.equal(b.excluded,0);assert.deepEqual(b.needs_check,[]);
  const ev=b.items.find(i=>i.title==='가 지부 임금교섭 시작.');
  assert.deepEqual(ev.source,{kind:'basket',id:id(1),title:'Web2 업데이트 2026-10-24',doc_type:'internal_doc',source_date:'2026-10-24',sensitivity:'S1'});
  assert.equal(ev.dedup_key,`web2:basket:${id(1)}:가지부임금교섭시작`);
  assert.deepEqual(ev.record,{summary:'가 지부와 임금교섭 시작 합의.',scope:'work',validity:'current',date_start:'2026-10-20',date_precision:'day'});
  const dec=b.items.find(i=>i.kind==='decision');assert.deepEqual(dec.links,[{target_project_id:PROJECT}]);assert.equal(dec.record.decision_type,'adopted');
  const com=b.items.find(i=>i.kind==='commitment');assert.deepEqual(com.links,[{target_meeting_id:id(10)}]);assert.equal(com.record.counterparty,'가상 상대 기관');assert.equal(com.record.follow_up_on,'2026-10-30');
  const org=b.items.find(i=>i.title==='가 지부 2차 일정.');assert.deepEqual(org.links,[{target_organization:'ORG-0901',relation:'direct'}]);
  const used=h.db.app_ai_daily_usage[0];assert.equal(used.requests,1);assert.equal(used.input_tokens,6000);
});

test('negotiation business report is at least S2 ("high when unsure"), unsure items go in as needs_check',async()=>{
  const h=harness({openai:[o=>respond(answer([item({title:'가 지부 교섭 3차 진행.',source:refOf(o,NEGO),sensitivity:'S0',sure:false}),
    item({title:'일반 회의 사실.',source:refOf(o,'약속'),sensitivity:'S0'}),item({title:'교섭 S3 내용.',source:refOf(o,NEGO),sensitivity:'S3'})]))]});
  assert.equal((await post(h.handler,run)).status,200);
  const b=batchOf(h),nego=b.items.find(i=>i.title==='가 지부 교섭 3차 진행.'),plain=b.items.find(i=>i.title==='일반 회의 사실.');
  assert.equal(nego.sensitivity,'S2');assert.equal(nego.source.sensitivity,'S2');assert.equal(nego.record.validity,'needs_check');
  assert.equal(plain.sensitivity,'S0');assert.equal(plain.record.validity,'current');
  assert.equal(b.items.length,2);assert.equal(b.excluded,1,'S3 is dropped and only counted');
  assert.match(auto.LEDGER_AUTO_INSTRUCTIONS,/애매하면 높은 쪽/);
  assert.equal(auto.sensitivityFloor({kind:'meeting',activity_kind:'negotiation'}),'S2');assert.equal(auto.sensitivityFloor({kind:'meeting',activity_kind:'policy'}),null);
});

test('dedup layer 1: same source and same title once per batch; DB unique key stays the final guard',async()=>{
  const h=harness({openai:[o=>respond(answer([item({source:refOf(o,'임금교섭 시작')}),item({source:refOf(o,'임금교섭 시작'),title:'가 지부, 임금교섭 시작!'})]))]});
  assert.equal((await post(h.handler,run)).status,200);
  assert.equal(batchOf(h).items.length,1);
});

test('dedup layer 2: seen sources are skipped without AI; an edited source is re-sent with what was already taken, outdated → needs_check only',async()=>{
  const all=['basket:'+id(1),'note:'+id(5),'work:'+id(6),'meeting:'+id(10),'meeting:'+id(14),'org_update:'+id(11),'project_update:'+id(13)];
  const seenAll=all.map(k=>{const [kind,sid]=k.split(':');return {workspace_id:WS,source_kind:kind,source_id:sid,seen_updated_at:RECENT,last_run_id:id(500)};});
  {const h=harness({seen:seenAll});
   const res=await post(h.handler,run);assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,kind:'ledger_auto',skipped:true,partial:false});
   assert.equal(h.calls.openai.length,0);assert.equal(h.calls.rpc.length,0,'no run is started when nothing is new');}
  // the basket note was seen before its last edit
  const seen=seenAll.map(s=>s.source_id===id(1)?{...s,seen_updated_at:'2026-10-24T01:30:00.000Z'}:s);
  const h=harness({seen,openai:[o=>{const r=sentOf(o).records;assert.equal(r.length,1);
    assert.deepEqual(r[0].already,[{id:'EVT-0904',kind:'event',title:'이미 뽑은 임금교섭 사건'}]);
    return respond(answer([item({source:r[0].ref,title:'임금교섭 날짜 변경.'})],[{record:'EVT-0904',source:r[0].ref},{record:'EVT-0901',source:r[0].ref},{record:'EVT-0902',source:r[0].ref}]));}]});
  assert.equal((await post(h.handler,run)).status,200);
  const b=batchOf(h);
  assert.deepEqual(b.sources.map(s=>s.id),[id(1)]);
  assert.deepEqual(b.needs_check,[{record:'EVT-0904'}],'only a record already taken from that source, never another or an unsent one');
  assert.ok(b.items.every(i=>['new','add_source'].includes(i.op)));
});

test('dedup layer 3: same_as adds a source to a sent record, event attaches a change; unknown, S2, retired or other-workspace ids are not used',async()=>{
  const h=harness({openai:[o=>{const r1=refOf(o,'2차 일정'),r2=refOf(o,'위원회 구성');return respond(answer([
    item({source:r1,same_as:'DEC-0901',title:'교섭 위원 확정(같은 일).'}),
    item({kind:'change',source:r1,event:'EVT-0901',title:'노선 쟁점 2차 일정.'}),
    item({source:r2,same_as:'EVT-0902',title:'S2 기록과 같다고 함.'}),
    item({source:r2,same_as:'EVT-0903',title:'남의 기록과 같다고 함.'}),
    item({kind:'change',source:r2,event:'EVT-0905',title:'폐기 사건에 이어 붙이려 함.'}),
    item({kind:'change',source:r2,event:'DEC-0901',title:'사건 아닌 기록에 이어 붙이려 함.'}),
  ]));}]});
  assert.equal((await post(h.handler,run)).status,200);
  const b=batchOf(h),byTitle=t=>b.items.find(i=>i.title===t);
  assert.deepEqual(b.items.find(i=>i.op==='add_source'),{op:'add_source',target:'DEC-0901',source:{kind:'org_update',id:id(11),title:'Web2 담당조직 기록 2026-10-24 (가 지부)',doc_type:'internal_doc',source_date:'2026-10-24',sensitivity:'S1'}});
  assert.equal(b.items.filter(i=>i.op==='add_source').length,1);
  assert.equal(byTitle('노선 쟁점 2차 일정.').kind,'change');assert.equal(byTitle('노선 쟁점 2차 일정.').belongs_to,'EVT-0901');
  for(const t of ['S2 기록과 같다고 함.','남의 기록과 같다고 함.'])assert.equal(byTitle(t).op,'new');
  for(const t of ['폐기 사건에 이어 붙이려 함.','사건 아닌 기록에 이어 붙이려 함.']){assert.equal(byTitle(t).kind,'event');assert.equal(byTitle(t).belongs_to,undefined);}
  assert.ok(!JSON.stringify(b).includes('EVT-0902')&&!JSON.stringify(b).includes('EVT-0903')&&!JSON.stringify(b).includes('EVT-0905'));
});

test('source is required: items without a sent ref, with bad fields, or without a counterparty are dropped',async()=>{
  const h=harness({openai:[o=>respond(answer([item({source:'r99'}),item({source:''}),item({source:refOf(o,'안건'),date:'2026-02-30'}),
    item({kind:'commitment',source:refOf(o,'약속'),counterparty:''}),{...item({source:refOf(o,'안건')}),extra:'x'},
    item({source:refOf(o,'안건'),title:'<b>태그</b> 남은 제목 010-1234-5678'}),item({source:refOf(o,'안건'),title:'근거 있는 기록.'})]))]});
  assert.equal((await post(h.handler,run)).status,200);
  const b=batchOf(h);
  assert.deepEqual(b.items.map(i=>i.title),['근거 있는 기록.']);
  assert.equal(b.excluded,1,'personal-number shape only counted');
  assert.ok(b.items.every(i=>i.source&&i.source.kind&&i.source.id));
});

test('broken AI answers fail the run (closed as failed), nothing reaches the ledger function',async()=>{
  for(const bad of [{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}]},
    {status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:[]})}]}]},
    {status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}]){
    const h=harness({openai:[()=>respond(bad)]});
    await expectError(await post(h.handler,run),502,'ai_invalid_response');
    assert.deepEqual(RPC_ORDER(h),['app_auto_ledger_begin']);
    const r=h.db.app_ledger_auto_runs.at(-1);assert.equal(r.status,'failed');assert.equal(r.fail_code,'LEDGER_AUTO_AI_INVALID_RESPONSE');
  }
  const h=harness({openai:[()=>respond({error:{message:'synthetic'}},500)]});
  await expectError(await post(h.handler,run),503,'ai_busy');
  assert.equal(h.calls.openai.length,2,'shared callOpenAi retries once');
  assert.equal(h.db.app_ledger_auto_runs.at(-1).status,'failed');
});

test('daily limit 16: counted from the run table (AI-less failures not counted); DB limit and busy map to fixed messages',async()=>{
  assert.equal(DAILY_LIMITS.ledger_auto,16);
  const today=n=>Array.from({length:n},(_,i)=>({id:id(700+i),workspace_id:WS,status:'done',started_at:'2026-10-24T00:10:00.000Z',tokens_in:10,tokens_out:1}));
  {const h=harness({runs:today(16)});await expectError(await post(h.handler,run),429,'daily_limit');assert.equal(h.calls.openai.length,0);assert.equal(h.calls.rpc.length,0);}
  {const h=harness({runs:[...today(15),...Array.from({length:5},(_,i)=>({id:id(750+i),workspace_id:WS,status:'failed',started_at:'2026-10-24T00:20:00.000Z',tokens_in:0,tokens_out:0}))]});
   assert.equal((await post(h.handler,run)).status,200);}
  {const h=harness({runs:[...today(16).map(r=>({...r,started_at:'2026-10-23T10:00:00.000Z'}))]});assert.equal((await post(h.handler,run)).status,200,'yesterday (KST) does not count');}
  {const h=harness({beginError:'LEDGER_AUTO_DAILY_LIMIT'});const b=await expectError(await post(h.handler,run),429,'daily_limit');assert.ok(!JSON.stringify(b).includes('synthetic detail'));assert.equal(h.calls.openai.length,0);}
  {const h=harness({beginError:'LEDGER_AUTO_BUSY'});await expectError(await post(h.handler,run),409,'ledger_busy');assert.equal(h.calls.openai.length,0);}
  {const h=harness({usage:[{workspace_id:WS,user_id:OWNER,day:TODAY,requests:DAILY_TOTAL_LIMIT,input_tokens:0,output_tokens:0}]});await expectError(await post(h.handler,run),429,'daily_limit');assert.equal(h.calls.rpc.length,0);}
});

test('add only: DB rejection keeps everything (run failed by the DB), server never patches or deletes ledger rows',async()=>{
  const h=harness({recordReply:()=>({ok:false,run_id:id(601),error:'LEDGER_ID_PREFIX_MISSING',constraint:null})});
  const res=await post(h.handler,run);
  assert.equal(res.status,503);const b=await res.json();assert.equal(b.error,'ledger_record_failed');assert.equal(b.reason,'LEDGER_ID_PREFIX_MISSING');
  assert.ok(h.calls.rest.filter(c=>c.method!=='GET').every(c=>c.table==='app_ai_daily_usage'||c.table.startsWith('rpc/')||c.table==='app_ledger_auto_runs'));
  const allowed=['new','add_source'];
  const h2=harness();assert.equal((await post(h2.handler,run)).status,200);
  assert.ok(batchOf(h2).items.every(i=>allowed.includes(i.op)));
  assert.ok(!h2.calls.rest.some(c=>c.method==='PATCH'),'a successful run patches nothing');
  // a direct writer for retire/replace does not exist in the module
  assert.equal(typeof auto.buildAutoBatch,'function');
  assert.ok(!/retire|replace|supersede/.test(JSON.stringify(batchOf(h2))));
});

test('anon, non-owner member and odd bodies are rejected before any read; a stranger only sees their own workspace',async()=>{
  {const h=harness();await expectError(await post(h.handler,run,null),401,'session_required');assert.equal(h.calls.rest.length,0);assert.equal(h.calls.openai.length,0);}
  {const h=harness();await expectError(await post(h.handler,run,'bad-token'),401,'session_required');assert.equal(h.calls.openai.length,0);}
  {const h=harness();await expectError(await post(h.handler,run,'member-token'),403,'forbidden');assert.equal(h.calls.openai.length,0);assert.equal(h.calls.rpc.length,0);}
  for(const body of [{kind:'ledger_auto',workspace_id:WS},{kind:'ledger_auto',sources:[id(1)]},{kind:'ledger_auto',batch:{}}]){
    const h=harness();await expectError(await post(h.handler,body),400,'invalid_request');assert.equal(h.calls.rpc.length,0);
  }
  {const h=harness({runs:[{id:id(510),workspace_id:OTHER_WS,status:'done',started_at:FIRST_RUN,tokens_in:1,tokens_out:1}],
     openai:[o=>{const m=o.input[1].content;assert.ok(m.includes('FOREIGN_TEXT'));for(const x of ['가 지부와 임금교섭',NEGO,'가상 노선 쟁점','EVT-0901'])assert.ok(!m.includes(x));return respond(answer([]));}]});
   assert.equal((await post(h.handler,run,'stranger-token')).status,200);
   assert.deepEqual(h.calls.rpc[0].args,{p_workspace_id:OTHER_WS});assert.ok(h.calls.rest.every(c=>c.uid===STRANGER));}
});

test('no raw text in logs or error responses; ledger tables missing → not ready',async()=>{
  const h=harness({openai:[o=>respond(answer([item({source:refOf(o,'임금교섭 시작')})]))]});
  assert.equal((await post(h.handler,run)).status,200);
  const logs=JSON.stringify(h.calls.logs);
  for(const x of ['임금교섭',SECRET,NEGO,'가 지부','EVT-09','synthetic-web2-openai-key','owner-token'])assert.ok(!logs.includes(x),x+' leaked into logs');
  assert.ok(h.calls.logs.some(l=>l.code==='ledger_auto_done'));
  {const m=harness({ledgerMissing:true});await expectError(await post(m.handler,run),503,'ledger_not_ready');assert.equal(m.calls.openai.length,0);}
  {const f=harness({fail:{app_ledger_records:'GET'}});const b=await expectError(await post(f.handler,run),503,'ledger_unavailable');
   assert.ok(!JSON.stringify(b).includes('synthetic db detail'));assert.equal(f.calls.openai.length,0);assert.equal(f.db.app_ledger_auto_runs.at(-1).status,'failed','begun run is closed');}
});

test('old ledger_candidates kind is unchanged and still accepted',async()=>{
  assert.equal(DAILY_LIMITS.ledger_candidates,5);
  const src=await (await import('node:fs/promises')).readFile(new URL('../../supabase/functions/ai-assist/handler.ts',import.meta.url),'utf8');
  assert.match(src,/if \(input\.kind === "ledger_candidates"\) return await runLedgerCandidates/);
  assert.ok(!/SERVICE_ROLE_KEY|env\([^)]*SERVICE/.test(src.slice(src.indexOf('// ---- 쓰임 ledger_auto'),src.indexOf('// ---- 자료실 빈 칸 채우기'))),'no service role key in ledger_auto');
  assert.ok(!/SERVICE_ROLE/.test(src),'handler never reads a service role key');
});
