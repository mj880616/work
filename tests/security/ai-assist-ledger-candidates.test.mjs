import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// AI-서버연동 S7-c: the real ai-assist handler, kind=ledger_candidates, with a synthetic Supabase (Auth + PostgREST with owner
// RLS, the S7-a ledger tables) and a mocked OpenAI. No network, no real key, synthetic text only (가상 이름, 09xx ids).
// AI never writes the ledger: it only adds pending candidates; the run mark is a numbers-only audit note.
const {createAiAssistHandler,DAILY_LIMITS,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const ledger=await import('../../supabase/functions/ai-assist/ledger-candidates.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG='d0000000-0000-4000-8000-000000000001',PROJECT='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000003';
const NOW=Date.parse('2026-10-21T03:00:00Z'),TODAY='2026-10-21',RECENT='2026-10-21T01:00:00Z';
const SECRET='SECRET_DIARY_TEXT',S2_TITLE='가상 교섭 전략 S2 제목';

const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:6000,output_tokens:500}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const item=(over={})=>({kind:'event',title:'가 지부 임금교섭 시작.',summary:'가 지부와 임금교섭 시작 합의.',date:'2026-10-20',sensitivity:'S1',source:'r1',event:'',counterparty:'',follow_up_on:'',decision_type:'',...over});

function harness({openai=[()=>respond(answer([item()]))],runs=[],usage=[],candidates=[],ledgerMissing=false,fail={}}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_notes:[
      {id:id(1),workspace_id:WS,kind:'basket',title:null,raw_text:'가 지부와 임금교섭 시작하기로 함. 10월 20일.',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(2),workspace_id:WS,kind:'diary',title:null,raw_text:SECRET,occurred_at:RECENT,updated_at:RECENT,journal_day:TODAY,archived_at:null,ai_export_allowed:false},
      {id:id(3),workspace_id:WS,kind:'basket',title:null,raw_text:'보관한 메모 ARCHIVED_TEXT',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:RECENT,ai_export_allowed:true},
      {id:id(4),workspace_id:WS,kind:'basket',title:null,raw_text:'내보내기 금지 EXCLUDED_TEXT',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:false},
      {id:id(7),workspace_id:OTHER_WS,kind:'basket',title:null,raw_text:'FOREIGN_TEXT',occurred_at:RECENT,updated_at:RECENT,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(8),workspace_id:WS,kind:'basket',title:null,raw_text:'오래된 메모 OLD_TEXT',occurred_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',journal_day:null,archived_at:null,ai_export_allowed:true},
    ],
    app_meetings:[{id:id(10),workspace_id:WS,title:'나 회의',series_name:'나 회의',meeting_at:'2026-10-20T05:00:00Z',transcript_text:'나 회의 결과: 상대 기관이 자료를 다음 주까지 주기로 약속',updated_at:RECENT}],
    app_suborganizations:[{id:ORG,workspace_id:WS,name:'가 지부'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_suborganization_updates:[{id:id(11),organization_id:ORG,occurred_at:RECENT,raw_text:'가 지부 기록: 교섭 2차 일정 확정'},{id:id(12),organization_id:FOREIGN_ORG,occurred_at:RECENT,raw_text:'FOREIGN_ORG_TEXT'}],
    app_spaces:[{id:PROJECT,workspace_id:WS,name:'다 프로젝트',owner_id:OWNER}],
    app_project_progress_updates:[{id:id(13),project_id:PROJECT,summary:'다 프로젝트: 위원회 안건 채택',effective_on:TODAY,created_at:RECENT}],
    app_ai_daily_usage:structuredClone(usage),
    app_ledger_audit:structuredClone(runs),
    app_ledger_records:[
      {id:id(20),workspace_id:WS,kind:'event',ledger_id:'EVT-0901',title:'가상 노선 쟁점',validity:'current',scope:'work',sensitivity:'S1',updated_at:RECENT},
      {id:id(21),workspace_id:WS,kind:'event',ledger_id:'EVT-0902',title:S2_TITLE,validity:'current',scope:'work',sensitivity:'S2',updated_at:RECENT},
      {id:id(22),workspace_id:OTHER_WS,kind:'event',ledger_id:'EVT-0903',title:'FOREIGN_EVENT',validity:'current',scope:'work',sensitivity:'S1',updated_at:RECENT},
    ],
    app_ledger_organizations:[{id:id(30),workspace_id:WS,ledger_id:'ORG-0901',suborganization_id:ORG,status:'active'}],
    app_ledger_candidates:structuredClone(candidates),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
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
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai[Math.min(calls.openai.length-1,openai.length-1)]();}
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body});
    if(ledgerMissing&&table.startsWith('app_ledger_'))return respond({code:'PGRST205',message:'schema cache'},404);
    if(fail[table]&&(fail[table]===true||fail[table]===method))return respond({message:'synthetic db detail'},500);
    assert.ok(!['app_ledger_records','app_ledger_organizations','app_ledger_sources','app_ledger_links','app_ledger_record_sources'].includes(table)||method==='GET','AI never writes ledger rows');
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    if(method==='POST'){
      const body=JSON.parse(init.body),list=Array.isArray(body)?body:[body],prefer=headers.get('Prefer')||'',out=[];
      for(const b of list){
        if(!visible(table,b,uid))return respond({message:'rls'},403);
        if(table==='app_ai_daily_usage'){const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);continue;}
        if(table==='app_ledger_audit'){assert.deepEqual(Object.keys(b).sort(),['detail','event','workspace_id']);rows.push({...b,created_at:new Date(NOW).toISOString()});continue;}
        if(table==='app_ledger_candidates'){
          assert.deepEqual(Object.keys(b).sort(),['action','dedup_key','kind','origin','payload','sensitivity','title','workspace_id']);
          if(rows.some(r=>r.workspace_id===b.workspace_id&&r.status==='pending'&&r.dedup_key===b.dedup_key))return respond({code:'23505'},409);
          const row={id:id(900+rows.length),status:'pending',created_at:new Date(NOW).toISOString(),...b};rows.push(row);out.push({id:row.id});continue;
        }
        throw new Error('unexpected insert '+table);
      }
      return prefer.includes('return=representation')?respond(out,201):new Response(null,{status:201});
    }
    throw new Error('method '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const run={kind:'ledger_candidates'};
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);return b;};
const refOf=(o,text)=>JSON.parse(o.input[1].content).records.find(r=>r.text.includes(text)).ref;

test('owner: Web2 records only, known events without S2, one OpenAI call, pending candidates with a server-made Web2 source',async()=>{
  // Answer after seeing the material, so refs point at the right record.
  let material;
  const h=harness({openai:[()=>{const o=h.calls.openai[0];material=o.input[1].content;
    return respond(answer([item({source:refOf(o,'임금교섭 시작')}),
      item({kind:'change',title:'가상 노선 쟁점 2차 일정 확정.',summary:'교섭 2차 일정 확정.',source:refOf(o,'2차 일정'),event:'EVT-0901',date:''}),
      item({kind:'commitment',title:'상대 기관 자료 제공 약속.',summary:'다음 주까지 자료 제공 약속.',source:refOf(o,'약속'),counterparty:'가상 상대 기관',follow_up_on:'2026-10-28'}),
      item({kind:'decision',title:'위원회 안건 채택.',summary:'안건 채택.',source:refOf(o,'안건'),decision_type:'adopted',date:TODAY})]));}]});
  const res=await post(h.handler,run);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual({...body,checked_at:undefined},{ok:true,kind:'ledger_candidates',added:4,found:4,excluded:0,partial:false,checked_at:undefined});
  assert.equal(body.checked_at,new Date(NOW).toISOString());
  assert.equal(h.calls.openai.length,1);
  const o=h.calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.tools,undefined);assert.equal(o.text.format.name,'ledger_candidates');assert.equal(o.text.format.strict,true);
  for(const hidden of [SECRET,'ARCHIVED_TEXT','EXCLUDED_TEXT','FOREIGN_TEXT','FOREIGN_ORG_TEXT','OLD_TEXT','FOREIGN_EVENT',S2_TITLE,OWNER,WS,id(1)])assert.ok(!material.includes(hidden),hidden+' must not be sent');
  const sent=JSON.parse(material);
  assert.deepEqual(sent.known_events,[{id:'EVT-0901',title:'가상 노선 쟁점'}]);
  assert.ok(sent.records.every(r=>/^r\d+$/.test(r.ref)),'only short per-run refs');
  const notesQuery=h.calls.rest.find(c=>c.table==='app_notes').query;
  assert.match(notesQuery,/kind=in\.\(basket,note,work\)/);assert.match(notesQuery,/archived_at=is\.null/);assert.match(notesQuery,/ai_export_allowed=is\.true/);
  const saved=h.db.app_ledger_candidates;
  assert.equal(saved.length,4);
  assert.ok(saved.every(c=>c.origin==='web2_ai'&&c.action==='new'&&c.status==='pending'&&c.dedup_key.startsWith('web2:')));
  const ev=saved.find(c=>c.kind==='event');
  assert.deepEqual(ev.payload.record,{summary:'가 지부와 임금교섭 시작 합의.',scope:'work',date_start:'2026-10-20',date_precision:'day'});
  assert.deepEqual(ev.payload.sources,[{new:{title:'Web2 업데이트 2026-10-21',doc_type:'internal_doc',location:'web2:basket:'+id(1),source_date:'2026-10-21',sensitivity:'S1'}}]);
  assert.deepEqual(ev.payload.origin_ref,{kind:'basket',id:id(1),day:'2026-10-21'});
  const ch=saved.find(c=>c.kind==='change');
  assert.deepEqual(ch.payload.links,[{target_record:'EVT-0901',relation:'belongs_to'},{target_organization:'ORG-0901',relation:'direct'}]);
  const com=saved.find(c=>c.kind==='commitment');
  assert.equal(com.payload.record.counterparty,'가상 상대 기관');assert.equal(com.payload.record.follow_up_on,'2026-10-28');
  assert.deepEqual(com.payload.links,[{target_meeting_id:id(10)}]);assert.equal(com.payload.sources[0].new.doc_type,'minutes');
  const dec=saved.find(c=>c.kind==='decision');
  assert.equal(dec.payload.record.decision_type,'adopted');assert.deepEqual(dec.payload.links,[{target_project_id:PROJECT}]);
  // No full source text in candidates.
  assert.ok(!JSON.stringify(saved).includes('상대 기관이 자료를 다음 주까지 주기로 약속'));
  // Run mark: numbers only.
  const mark=h.db.app_ledger_audit.at(-1);
  assert.deepEqual(mark,{workspace_id:WS,event:'note',detail:{use:'ledger_candidates',started_at:new Date(NOW).toISOString(),partial:false,sources:4,found:4,added:4,excluded:0},created_at:new Date(NOW).toISOString()});
  assert.equal(h.db.app_ai_daily_usage[0].requests,1);assert.equal(h.db.app_ai_daily_usage[0].input_tokens,6000);
  const logText=JSON.stringify(h.calls.logs);
  assert.ok(!/지부|교섭|약속|SECRET|가상/.test(logText),'no material or candidate text in logs');
  assert.ok(h.calls.logs.some(l=>l.code==='ledger_candidates_done'&&l.detail.added===4));
});

test('untrusted answer: S3 and personal-looking items are excluded and counted; bad items dropped; unknown event gets no link',async()=>{
  const {handler,db,calls}=harness({openai:[()=>respond(answer([
    item({title:'조합원 징계 건.',sensitivity:'S3'}),
    item({title:'연락처 010-1234-5678 전달.'}),
    item({source:'r99'}),
    item({kind:'evidence'}),
    item({kind:'commitment',title:'상대 약속.',counterparty:''}),
    item({date:'2026-02-30'}),
    item({title:'<b>태그</b> 지운 제목.',event:'EVT-0999',kind:'change'}),
    item({title:'<b>태그</b> 지운 제목.',event:'EVT-0999',kind:'change'}),
    {...item(),extra:1}]))]});
  const res=await post(handler,run);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.added,1);assert.equal(body.excluded,2);
  assert.equal(db.app_ledger_candidates.length,1);
  assert.equal(db.app_ledger_candidates[0].title,'태그 지운 제목.');
  assert.deepEqual(db.app_ledger_candidates[0].payload.links,[]);
  assert.ok(!JSON.stringify(db).includes('010-1234-5678')&&!JSON.stringify(db.app_ledger_candidates).includes('징계'));
  assert.ok(calls.logs.some(l=>l.code==='ledger_candidates_done'&&l.detail.dropped===6&&l.detail.excluded===2));
  assert.equal(ledger.parseLedgerCandidates(null,[],[],TODAY),null);
  assert.equal(ledger.parseLedgerCandidates({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},[],[],TODAY),null);
});

test('the same Web2 record and title is not suggested again, whatever happened to the first candidate',async()=>{
  const key=ledger.ledgerDedupKey({kind:'basket',id:id(1)},'가 지부 임금교섭 시작.');
  const h=harness({candidates:[{id:id(800),workspace_id:WS,status:'discarded',dedup_key:key}],
    openai:[()=>{const o=h.calls.openai[0];return respond(answer([item({source:refOf(o,'임금교섭 시작')}),item({title:'다른 제목.',source:refOf(o,'임금교섭 시작')})]));}]});
  const res=await post(h.handler,run);
  assert.equal(res.status,200);
  assert.equal((await res.json()).added,1);
  const saved=h.db.app_ledger_candidates.filter(c=>c.status==='pending');
  assert.deepEqual(saved.map(c=>c.title),['다른 제목.']);
  assert.match(h.calls.rest.find(c=>c.table==='app_ledger_candidates'&&c.method==='GET').query,/dedup_key=in\.\("web2:basket:/);
});

test('limits: five runs a day, the shared daily total and the monthly budget stop before OpenAI',async()=>{
  const mark=(n,at=RECENT)=>Array.from({length:n},()=>({workspace_id:WS,event:'note',target_table:null,detail:{use:'ledger_candidates',started_at:at},created_at:at}));
  {const {handler,calls}=harness({runs:mark(DAILY_LIMITS.ledger_candidates)});
   await expectError(await post(handler,run),429,'daily_limit');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness({runs:mark(DAILY_LIMITS.ledger_candidates,'2026-10-20T01:00:00Z')});
   assert.equal((await post(handler,run)).status,200);assert.equal(calls.openai.length,1);}
  {const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:TODAY,requests:DAILY_TOTAL_LIMIT,input_tokens:0,output_tokens:0}]});
   await expectError(await post(handler,run),429,'daily_limit');assert.equal(calls.openai.length,0);}
  {const {handler,calls,db}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-02',requests:1,input_tokens:50_000_000,output_tokens:0}]});
   await expectError(await post(handler,run),429,'monthly_limit');assert.equal(calls.openai.length,0);assert.equal(db.app_ledger_candidates.length,0);}
  {const {handler,calls}=harness({fail:{app_ai_daily_usage:'POST'}});
   await expectError(await post(handler,run),503,'usage_unavailable');assert.equal(calls.openai.length,0);}
});

test('baseline: the last run start; nothing new means no OpenAI call and a run mark with zeros',async()=>{
  const later='2026-10-21T02:00:00Z';
  const {handler,calls,db}=harness({runs:[{workspace_id:WS,event:'note',target_table:null,detail:{use:'ledger_candidates',started_at:later},created_at:later}]});
  const res=await post(handler,run);
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).added,0);
  assert.equal(calls.openai.length,0);
  assert.match(calls.rest.find(c=>c.table==='app_notes').query,/updated_at=gte\.2026-10-21T02:00:00/);
  assert.deepEqual(db.app_ledger_audit.at(-1).detail,{use:'ledger_candidates',started_at:new Date(NOW).toISOString(),partial:false,sources:0,found:0,added:0,excluded:0});
});

test('not ready, failures and input: ledger tables missing, AI answer broken, extra keys, stranger, no login',async()=>{
  {const {handler,calls}=harness({ledgerMissing:true});await expectError(await post(handler,run),503,'ledger_not_ready');assert.equal(calls.openai.length,0);}
  {const {handler,calls,db}=harness({openai:[()=>respond({status:'completed',output:[]})]});
   await expectError(await post(handler,run),502,'ai_invalid_response');assert.equal(calls.openai.length,1);assert.equal(db.app_ledger_candidates.length,0);
   assert.equal(db.app_ai_daily_usage[0].requests,1,'a failed call still counts');}
  {const {handler,calls}=harness({fail:{app_ledger_candidates:'POST'}});
   const b=await expectError(await post(handler,run),503,'ledger_unavailable');assert.ok(!JSON.stringify(b).includes('synthetic db detail'));assert.ok(!JSON.stringify(calls.logs).includes('synthetic'));}
  for(const body of [{kind:'ledger_candidates',mode:'again'},{kind:'ledger_candidates',workspace_id:WS},{kind:'ledger_candidates',text:'x'}]){
   const {handler,calls}=harness();await expectError(await post(handler,body),400,'invalid_request');assert.equal(calls.openai.length,0);}
  {const {handler,db}=harness();
   assert.equal((await post(handler,run,'stranger-token')).status,200);
   assert.ok(db.app_ledger_candidates.every(c=>c.workspace_id===OTHER_WS));}
  {const {handler,calls}=harness();await expectError(await post(handler,run,null),401,'session_required');assert.equal(calls.openai.length,0);}
});

test('source: no service role, no tools, no ledger row writes, logs carry numbers only',()=>{
  const all=readFileSync('supabase/functions/ai-assist/handler.ts','utf8')+readFileSync('supabase/functions/ai-assist/ledger-candidates.ts','utf8');
  assert.doesNotMatch(all,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.doesNotMatch(all,/tools\s*:/);
  assert.doesNotMatch(all,/app_confirm_ledger_candidate|rest\/v1\/app_ledger_records[^?]*", \{\s*method: "POST"|app_import_ledger/);
  const logs=[...all.matchAll(/log\("([a-z_]+)"(?:,\s*(\{[^}]*\}))?\)/g)];
  for(const [,code,detail] of logs)if(detail)assert.doesNotMatch(detail,/summary|text|evidence|material|title|raw/,code);
});
