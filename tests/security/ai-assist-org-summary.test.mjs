import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// JOURNAL-조직현황AI요약: the real ai-assist handler, kind=org_summary, with a synthetic Supabase (Auth + PostgREST with owner RLS,
// app_weekly_org_summaries) and a mocked OpenAI. No network, no real key, synthetic text only (가상 이름, 09xx ids).
// The screen sends only a week and organization ids; an edited summary is never sent to the AI and never overwritten.
const {createAiAssistHandler,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const os=await import('../../supabase/functions/ai-assist/org-summary.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG_A='d0000000-0000-4000-8000-000000000001',ORG_B='d0000000-0000-4000-8000-000000000002',ORG_C='d0000000-0000-4000-8000-000000000003',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const NOW=Date.parse('2026-10-22T03:00:00Z'),WEEK='2026-10-19',PREV='2026-10-12';
const TUE='2026-10-20T01:00:00Z',WED='2026-10-21T02:00:00Z',LAST_WEEK='2026-10-14T01:00:00Z';

const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:5000,output_tokens:400}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const refOf=(o,name)=>JSON.parse(o.input[1].content).organizations.find(x=>x.name===name).ref;

function harness({openai=null,summaries=[],usage=[],missing=false,fail={}}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가 지부'},{id:ORG_B,workspace_id:WS,name:'나 지회'},{id:ORG_C,workspace_id:WS,name:'다 분회'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_suborganization_updates:[
      {id:id(1),organization_id:ORG_A,occurred_at:TUE,raw_text:'임금교섭 3차 실무교섭 진행\n수고하셨습니다',detail_text:null},
      {id:id(2),organization_id:ORG_A,occurred_at:LAST_WEEK,raw_text:'지난주 기록 OLD_WEEK_TEXT',detail_text:null},
      {id:id(3),organization_id:FOREIGN_ORG,occurred_at:TUE,raw_text:'FOREIGN_ORG_TEXT',detail_text:null},
    ],
    app_notes:[
      {id:id(10),workspace_id:WS,kind:'basket',raw_text:'안녕하세요 위원장님\n쟁의행위 찬반투표 10.24 예정\n연락처 010-1234-5678',occurred_at:WED,archived_at:null,ai_export_allowed:true,
        attachments:[{drive_file_id:'fileA1',file_name:'투표 공고문.hwp',mime_type:'application/x-hwp',size_bytes:10}]},
      {id:id(11),workspace_id:WS,kind:'basket',raw_text:'EXCLUDED_TEXT 내보내기 금지',occurred_at:WED,archived_at:null,ai_export_allowed:false,attachments:[]},
      {id:id(12),workspace_id:WS,kind:'basket',raw_text:'ARCHIVED_TEXT',occurred_at:WED,archived_at:WED,ai_export_allowed:true,attachments:[]},
      {id:id(13),workspace_id:WS,kind:'diary',raw_text:'SECRET_DIARY',occurred_at:WED,archived_at:null,ai_export_allowed:true,attachments:[]},
      {id:id(14),workspace_id:WS,kind:'basket',raw_text:'',occurred_at:TUE,archived_at:null,ai_export_allowed:true,
        attachments:[{drive_file_id:'fileB1',file_name:'나 지회 단협안.pdf',mime_type:'application/pdf',size_bytes:10}]},
    ],
    app_record_links:[
      {id:id(20),workspace_id:WS,note_id:id(10),organization_id:ORG_A,status:'confirmed',summary:'찬반투표 일정 공지.'},
      {id:id(21),workspace_id:WS,note_id:id(11),organization_id:ORG_A,status:'confirmed',summary:null},
      {id:id(22),workspace_id:WS,note_id:id(12),organization_id:ORG_A,status:'confirmed',summary:null},
      {id:id(23),workspace_id:WS,note_id:id(13),organization_id:ORG_A,status:'confirmed',summary:null},
      // REF-참고묶음: a reference-bundle link (no organization) is never organization material.
      {id:id(24),workspace_id:WS,note_id:id(10),organization_id:null,bundle_id:'e0000000-0000-4000-8000-000000000001',status:'confirmed',summary:'REF_BUNDLE_SUMMARY'},
    ],
    app_documents:[{id:id(30),workspace_id:WS,file_id:'fileB1',organization_id:ORG_B}],
    app_ai_daily_usage:structuredClone(usage),
    app_weekly_org_summaries:structuredClone(summaries),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=Object.fromEntries(db.app_suborganizations.map(o=>[o.id,o.workspace_id]));
  const visible=(table,row,uid)=>table==='app_suborganization_updates'?wsOwner[orgWs[row.organization_id]]===uid
    :table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val; if(op==='lt')return cell!=null&&String(cell)<val;
    if(op==='in')return val.slice(1,-1).split(',').map(v=>v.replace(/^"|"$/g,'')).includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
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
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      if(openai)return openai(calls.openai.at(-1));
      const o=calls.openai.at(-1),orgs=JSON.parse(o.input[1].content).organizations;
      return respond(answer(orgs.map(x=>({org:x.ref,lines:[`- ${x.name} 요약 줄.`,'· 쟁의행위 찬반투표 10.24.(금) 예정.','쟁의행위 찬반투표 10.24.(금) 예정']}))));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body});
    if(missing&&table==='app_weekly_org_summaries')return respond({code:'PGRST205',message:'schema cache'},404);
    if(fail[table]&&(fail[table]===true||fail[table]===method))return respond({message:'synthetic db detail'},500);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    if(method==='POST'){
      const body=JSON.parse(init.body),list=Array.isArray(body)?body:[body],out=[];
      for(const b of list){
        if(!visible(table,b,uid))return respond({message:'rls'},403);
        if(table==='app_ai_daily_usage'){const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);continue;}
        if(table==='app_weekly_org_summaries'){
          assert.deepEqual(Object.keys(b).sort(),['edited','generated_at','organization_id','summary','updated_at','week_start','workspace_id']);
          assert.equal(b.edited,false,'the AI never writes an edited summary');
          if(rows.some(r=>r.workspace_id===b.workspace_id&&r.week_start===b.week_start&&r.organization_id===b.organization_id))continue;
          const row={id:id(900+rows.length),...b};rows.push(row);out.push({id:row.id});continue;
        }
        throw new Error('unexpected insert '+table);
      }
      return respond(out,201);
    }
    if(method==='PATCH'){
      assert.equal(table,'app_weekly_org_summaries');
      assert.match(url.search,/edited=is\.false/,'every AI update is limited to unedited rows');
      const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body).sort(),['generated_at','summary','updated_at']);
      const hit=rows.filter(r=>visible(table,r,uid)&&matches(r,url));
      for(const r of hit)Object.assign(r,body);
      return respond(hit.map(r=>({id:r.id})));
    }
    throw new Error('method '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const run=(ids=[ORG_A,ORG_B,ORG_C])=>({kind:'org_summary',week_start:WEEK,organization_ids:ids});
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);return b;};

test('owner: one OpenAI call with the week\'s records per organization, summaries saved, original text never stored',async()=>{
  const prev={id:id(800),workspace_id:WS,week_start:PREV,organization_id:ORG_A,summary:'임금교섭 2차 실무교섭 진행.\n10.24.(금) 찬반투표 예정.',edited:true};
  const {handler,calls,db}=harness({summaries:[prev]});
  const res=await post(handler,run());
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);assert.equal(body.kind,'org_summary');assert.equal(body.week_start,WEEK);
  assert.deepEqual(body.items.map(i=>i.organization_id).sort(),[ORG_A,ORG_B].sort());
  // 다 분회 has no record this week: it is not sent and comes back as "empty".
  assert.deepEqual(body.empty,[ORG_C]);assert.deepEqual(body.kept,[]);
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.tools,undefined);assert.equal(o.text.format.name,'org_summary');assert.equal(o.text.format.strict,true);
  const material=o.input[1].content,sent=JSON.parse(material);
  assert.deepEqual(sent.week,{from:'10.19.(월)',to:'10.25.(일)'});
  assert.deepEqual(sent.organizations.map(x=>x.name),['가 지부','나 지회']);
  const a=sent.organizations[0];
  // Last week's confirmed summary is the base; the link summary is material; attachments are names only.
  assert.equal(a.last_week,prev.summary);
  assert.ok(a.records.some(r=>r.type==='연결 기록 요약'&&r.text==='찬반투표 일정 공지.'));
  assert.ok(a.records.some(r=>r.type==='업데이트'&&r.files?.[0]==='투표 공고문.hwp'));
  assert.deepEqual(sent.organizations[1].records,[{type:'업데이트',date:'10.20.(화)',files:['나 지회 단협안.pdf']}]);
  // Greetings and contacts are taken out before sending; excluded, archived, diary, other weeks and other workspaces never go.
  for(const hidden of ['안녕하세요','수고하셨습니다','010-1234-5678','EXCLUDED_TEXT','ARCHIVED_TEXT','SECRET_DIARY','OLD_WEEK_TEXT','FOREIGN_ORG_TEXT','REF_BUNDLE_SUMMARY',OWNER,WS,ORG_A,id(10)])
    assert.ok(!material.includes(hidden),hidden+' must not be sent');
  const notesQuery=calls.rest.find(c=>c.table==='app_notes').query;
  assert.match(notesQuery,/kind=eq\.basket/);assert.match(notesQuery,/archived_at=is\.null/);assert.match(notesQuery,/ai_export_allowed=is\.true/);
  assert.match(calls.rest.find(c=>c.table==='app_suborganization_updates').query,/occurred_at=gte\.2026-10-18T15:00:00\.000Z&occurred_at=lt\.2026-10-25T15:00:00\.000Z/);
  // Saved: cleaned lines (no leading marks, a repeated line once), not edited.
  const saved=db.app_weekly_org_summaries.filter(r=>r.week_start===WEEK);
  assert.equal(saved.length,2);
  assert.ok(saved.every(r=>r.edited===false&&r.workspace_id===WS&&r.generated_at===new Date(NOW).toISOString()));
  assert.equal(saved.find(r=>r.organization_id===ORG_A).summary,'가 지부 요약 줄.\n쟁의행위 찬반투표 10.24.(금) 예정.');
  assert.ok(!JSON.stringify(db.app_weekly_org_summaries).includes('임금교섭 3차 실무교섭 진행\n'),'no original text stored');
  assert.equal(db.app_ai_daily_usage[0].requests,1);assert.equal(db.app_ai_daily_usage[0].input_tokens,5000);
  assert.ok(!/지부|지회|교섭|투표/.test(JSON.stringify(calls.logs)),'no material or summary text in logs');
  assert.ok(calls.logs.some(l=>l.code==='org_summary_done'&&l.detail.written===2));
});

test('an edited summary is not sent and not overwritten; an AI summary is replaced on the next run',async()=>{
  const edited={id:id(801),workspace_id:WS,week_start:WEEK,organization_id:ORG_A,summary:'내가 고친 요약.',edited:true};
  const ai={id:id(802),workspace_id:WS,week_start:WEEK,organization_id:ORG_B,summary:'예전 AI 요약.',edited:false};
  const {handler,calls,db}=harness({summaries:[edited,ai]});
  const res=await post(handler,run([ORG_A,ORG_B]));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body.kept,[ORG_A]);
  assert.deepEqual(body.items.map(i=>i.organization_id),[ORG_B]);
  assert.deepEqual(JSON.parse(calls.openai[0].input[1].content).organizations.map(x=>x.name),['나 지회']);
  assert.equal(db.app_weekly_org_summaries.find(r=>r.id===edited.id).summary,'내가 고친 요약.');
  assert.equal(db.app_weekly_org_summaries.find(r=>r.id===ai.id).summary,'나 지회 요약 줄.\n쟁의행위 찬반투표 10.24.(금) 예정.');
  // Only edited ones asked for: no AI call, no usage.
  const again=harness({summaries:[edited]});
  const r2=await post(again.handler,run([ORG_A]));
  assert.equal(r2.status,200);assert.deepEqual((await r2.json()).kept,[ORG_A]);
  assert.equal(again.calls.openai.length,0);assert.equal(again.db.app_ai_daily_usage.length,0);
});

test('a summary edited while the AI was answering is kept (the update is limited to unedited rows)',async()=>{
  const ai={id:id(803),workspace_id:WS,week_start:WEEK,organization_id:ORG_A,summary:'AI 요약.',edited:false};
  const h=harness({summaries:[ai],openai:o=>{
    const row=h.db.app_weekly_org_summaries.find(r=>r.id===ai.id);row.summary='그 사이 고친 요약.';row.edited=true;
    return respond(answer([{org:refOf(o,'가 지부'),lines:['새 AI 요약.']}]));}});
  const res=await post(h.handler,run([ORG_A]));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body.items,[]);assert.deepEqual(body.kept,[ORG_A]);
  assert.equal(h.db.app_weekly_org_summaries[0].summary,'그 사이 고친 요약.');
});

test('untrusted answer: unknown refs, repeats, contacts, HTML and empty lines are dropped; a broken answer saves nothing',async()=>{
  {const {handler,db,calls}=harness({openai:o=>respond(answer([
    {org:'o99',lines:['없는 조직.']},
    {org:refOf(o,'가 지부'),lines:['<b>교섭</b> 진행.','연락처 010-9876-5432 공유.','  ','x'.repeat(200)]},
    {org:refOf(o,'가 지부'),lines:['두 번째 답.']},
    {org:refOf(o,'나 지회'),lines:[]},
    {org:refOf(o,'나 지회'),lines:['ok'],extra:1}]))});
   const res=await post(handler,run([ORG_A,ORG_B]));
   assert.equal(res.status,200);
   const body=await res.json();
   assert.deepEqual(body.items,[{organization_id:ORG_A,summary:'교섭 진행.'}]);
   assert.deepEqual(body.empty,[ORG_B]);
   assert.ok(!JSON.stringify(db.app_weekly_org_summaries).includes('010-9876-5432'));
   assert.ok(calls.logs.some(l=>l.code==='org_summary_done'&&l.detail.dropped===4));}
  {const {handler,db}=harness({openai:()=>respond({status:'completed',output:[]})});
   await expectError(await post(handler,run()),502,'ai_invalid_response');
   assert.equal(db.app_weekly_org_summaries.length,0);assert.equal(db.app_ai_daily_usage[0].requests,1,'a failed call still counts');}
  {const {handler,db}=harness({openai:()=>respond({message:'down'},500)});
   await expectError(await post(handler,run()),503,'ai_busy');assert.equal(db.app_weekly_org_summaries.length,0);}
  assert.equal(os.parseOrgSummary(null,[]),null);
  assert.equal(os.parseOrgSummary({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},[]),null);
  assert.equal(os.cleanSummaryLine('1. 첫 줄.'),'첫 줄.');assert.equal(os.cleanSummaryLine('○ 동그라미.'),'동그라미.');
  assert.equal(os.cleanSummaryLine('mail me a@b.kr'),null);
});

test('input and limits: only week + organization ids, a Monday, no foreign organization, budget before OpenAI',async()=>{
  for(const body of [
    {kind:'org_summary',week_start:WEEK},
    {kind:'org_summary',week_start:'2026-10-20',organization_ids:[ORG_A]},
    {kind:'org_summary',week_start:'2026-02-30',organization_ids:[ORG_A]},
    {kind:'org_summary',week_start:WEEK,organization_ids:[ORG_A,ORG_A]},
    {kind:'org_summary',week_start:WEEK,organization_ids:[]},
    {kind:'org_summary',week_start:WEEK,organization_ids:Array.from({length:21},(_,i)=>id(500+i))},
    {kind:'org_summary',week_start:WEEK,organization_ids:['not-a-uuid']},
    {kind:'org_summary',week_start:WEEK,organization_ids:[ORG_A],text:'원문'},
    {kind:'org_summary',week_start:'2020-01-06',organization_ids:[ORG_A]},
  ]){const {handler,calls}=harness();await expectError(await post(handler,body),400,'invalid_request');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness();await expectError(await post(handler,run([FOREIGN_ORG])),404,'not_found');assert.equal(calls.openai.length,0);}
  {const {handler,calls,db}=harness();
   const res=await post(handler,run([ORG_A,FOREIGN_ORG]));assert.equal(res.status,200);
   assert.ok(!calls.openai[0].input[1].content.includes('남의 조직'));assert.ok(db.app_weekly_org_summaries.every(r=>r.organization_id===ORG_A));}
  {const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-22',requests:DAILY_TOTAL_LIMIT,input_tokens:0,output_tokens:0}]});
   await expectError(await post(handler,run()),429,'daily_limit');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-02',requests:1,input_tokens:50_000_000,output_tokens:0}]});
   await expectError(await post(handler,run()),429,'monthly_limit');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness({missing:true});await expectError(await post(handler,run()),503,'org_summary_not_ready');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness({fail:{app_weekly_org_summaries:'POST'}});
   const b=await expectError(await post(handler,run()),503,'org_summary_unavailable');assert.ok(!JSON.stringify(b).includes('synthetic'));assert.ok(!JSON.stringify(calls.logs).includes('synthetic'));}
  {const {handler,calls}=harness();await expectError(await post(handler,run(),null),401,'session_required');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness();await expectError(await post(handler,run(),'stranger-token'),404,'not_found');assert.equal(calls.openai.length,0);}
});

test('source: no service role, no tools, logs carry numbers only',()=>{
  const all=readFileSync('supabase/functions/ai-assist/handler.ts','utf8')+readFileSync('supabase/functions/ai-assist/org-summary.ts','utf8');
  assert.doesNotMatch(all,/SUPABASE_SERVICE_ROLE_KEY|service_role/);
  assert.doesNotMatch(all,/tools\s*:/);
  assert.doesNotMatch(all,/(?<!WEB2_)OPENAI_API_KEY"/);
  const logs=[...all.matchAll(/log\("([a-z_]+)"(?:,\s*(\{[^}]*\}))?\)/g)];
  for(const [,code,detail] of logs)if(detail)assert.doesNotMatch(detail,/summary|text|material|title|raw|name/,code);
});
