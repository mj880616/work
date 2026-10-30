import test from 'node:test';
import assert from 'node:assert/strict';

// DESK-현황표: the real ai-assist handler, kind=org_status_rows, with a synthetic Supabase (Auth + PostgREST with owner RLS)
// and a mocked OpenAI. No network, no real key, synthetic text only (가상 이름, 09xx ids).
// The screen sends only an organization id. The server reads the last 60 days of that organization's records with the caller's login,
// asks the AI once, checks the answer and returns at most 4 rows with evidence ids. It never writes the rows.
const {createAiAssistHandler}=await import('../../supabase/functions/ai-assist/handler.ts');
const sr=await import('../../supabase/functions/ai-assist/org-status-rows.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const ORG_A='d0000000-0000-4000-8000-000000000001',ORG_B='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const U1='e0000000-0000-4000-8000-000000000001',U2='e0000000-0000-4000-8000-000000000002',U3='e0000000-0000-4000-8000-000000000003',UOLD='e0000000-0000-4000-8000-000000000004';
const N1='f0000000-0000-4000-8000-000000000001',NDIARY='f0000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-10-30T03:00:00Z'),TODAY='2026-10-30';
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=o=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(o)}]}],usage:{input_tokens:3000,output_tokens:200}});
const GOOD={rows:[
  {day:'2026-10-29',text:'지노위 2차 조정회의 — 조정 종료(쟁의권 확보)',refs:['r1']},
  {day:'2026-10-26',text:'- 조합원 총력 결의대회',refs:['r2','r9']},
  {day:'2026-10-20',text:'연락처 010-1234-5678 공유',refs:['r4']},
  {day:'2026-10-21',text:'근거 없는 줄',refs:['r99']},
  {day:'2031-01-01',text:'엉뚱한 해',refs:['r1']},
  {day:'2026-10-29',text:'지노위 2차 조정회의 — 조정 종료(쟁의권 확보)',refs:['r1']},
  {day:'2026-10-24',text:'<b>업데이트</b> 공지',refs:['r3']},
]};

function harness({openai=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const at=d=>new Date(Date.parse(d+'T01:00:00Z')).toISOString();
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가 지부'},{id:ORG_B,workspace_id:WS,name:'나 지회'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_suborganization_updates:[
      {id:U1,organization_id:ORG_A,workspace_id:WS,occurred_at:at('2026-10-29'),raw_text:'지노위 2차 조정회의 조정 종료 UPDATE_ONE',detail_text:null},
      {id:U2,organization_id:ORG_A,workspace_id:WS,occurred_at:at('2026-10-26'),raw_text:'총력 결의대회 UPDATE_TWO',detail_text:null},
      {id:U3,organization_id:ORG_A,workspace_id:WS,occurred_at:at('2026-10-20'),raw_text:'연락처 공유 010-1111-2222',detail_text:null},
      {id:UOLD,organization_id:ORG_A,workspace_id:WS,occurred_at:at('2026-07-01'),raw_text:'OLD_RECORD',detail_text:null},
      {id:'e0000000-0000-4000-8000-000000000009',organization_id:FOREIGN_ORG,workspace_id:OTHER_WS,occurred_at:at('2026-10-29'),raw_text:'FOREIGN_RECORD',detail_text:null},
    ],
    app_notes:[
      {id:N1,workspace_id:WS,kind:'basket',raw_text:'업데이트 공지 NOTE_ONE',occurred_at:at('2026-10-24'),archived_at:null,ai_export_allowed:true,attachments:[]},
      {id:NDIARY,workspace_id:WS,kind:'diary',raw_text:'DIARY_SECRET',occurred_at:at('2026-10-24'),archived_at:null,ai_export_allowed:true,attachments:[]},
    ],
    app_record_links:[{workspace_id:WS,note_id:N1,organization_id:ORG_A,summary:'',status:'confirmed'}],
    app_documents:[],
    app_document_ai_index:[],
    app_ai_daily_usage:[],
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=Object.fromEntries(db.app_suborganizations.map(o=>[o.id,o.workspace_id]));
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id??orgWs[row.organization_id]]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val;
    if(op==='lt')return cell!=null&&String(cell)<val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
    throw new Error('op '+op);
  };
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict','offset'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      return openai?openai(calls.openai.at(-1)):respond(answer(GOOD));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features')return respond([]);
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    // Same day keys as a real URL query: the URL keeps duplicate keys (occurred_at=gte & occurred_at=lt).
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET'){
      const pairs=[...url.searchParams].filter(([k])=>!['select','limit','order','on_conflict','offset'].includes(k));
      const ok=r=>visible(table,r,uid)&&pairs.every(([k,v])=>{const i=v.indexOf('.');return cmp(r[k],v.slice(0,i),v.slice(i+1));});
      return respond(rows.filter(ok).slice(0,Number(url.searchParams.get('limit')||1e9)));
    }
    if(method==='POST'){
      assert.equal(table,'app_ai_daily_usage','the only write is the usage counter');
      const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond([],201);
    }
    if(method==='PATCH'){assert.equal(table,'app_ai_daily_usage');for(const r of rows.filter(r=>matches(r,url)))Object.assign(r,JSON.parse(init.body));return new Response(null,{status:204});}
    throw new Error('method '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);};

test('owner: one AI call with the last 60 days of that organization; at most 4 checked rows with evidence ids; nothing saved',async()=>{
  const {handler,calls}=harness();
  const res=await post(handler,{kind:'org_status_rows',organization_id:ORG_A});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);assert.equal(body.kind,'org_status_rows');
  assert.deepEqual(body.rows,[
    {day:'2026-10-29',text:'지노위 2차 조정회의 — 조정 종료(쟁의권 확보)',evidence:[U1]},
    {day:'2026-10-26',text:'조합원 총력 결의대회',evidence:[U2]},
    {day:'2026-10-24',text:'업데이트 공지',evidence:[N1]},
  ],'phone rows, unknown refs, far dates, duplicates and tags are dropped; lead marks removed');
  assert.equal(calls.openai.length,1);assert.equal(calls.openai[0].store,false);
  const sent=calls.openai[0].input[1].content;
  assert.match(sent,/UPDATE_ONE/);assert.match(sent,/NOTE_ONE/);
  for(const no of ['OLD_RECORD','FOREIGN_RECORD','DIARY_SECRET','010-1111-2222',U1,N1])assert.doesNotMatch(sent,new RegExp(no),no);
  assert.ok(!calls.rest.some(r=>r.method!=='GET'&&r.table!=='app_ai_daily_usage'),'no writes except the usage counter');
  assert.ok(!calls.logs.some(l=>JSON.stringify(l).includes('지노위')),'logs carry counts only');
});

test('an organization with no recent records returns an empty list without an AI call',async()=>{
  const {handler,calls}=harness();
  const b=await (await post(handler,{kind:'org_status_rows',organization_id:ORG_B})).json();
  assert.equal(b.ok,true);assert.equal(b.empty,true);assert.deepEqual(b.rows,[]);assert.equal(calls.openai.length,0);
});

test('other workspace organization, bad input and bad AI answers are refused',async()=>{
  const {handler,calls}=harness();
  await expectError(await post(handler,{kind:'org_status_rows',organization_id:FOREIGN_ORG}),404,'not_found');
  await expectError(await post(handler,{kind:'org_status_rows',organization_id:ORG_A},'stranger-token'),404,'not_found');
  await expectError(await post(handler,{kind:'org_status_rows',organization_id:'nope'}),400,'invalid_request');
  await expectError(await post(handler,{kind:'org_status_rows',organization_id:ORG_A,rows:[]}),400,'invalid_request');
  assert.equal(calls.openai.length,0);
  const bad=harness({openai:()=>respond(answer({lines:[]}))});
  await expectError(await post(bad.handler,{kind:'org_status_rows',organization_id:ORG_A}),502,'ai_invalid_response');
});

test('pure rules: packing order, material refs only, answer cleanup',()=>{
  const {packed}=sr.packStatusRecords([
    {day:'2026-10-01',at:1,type:'org_update',text:'옛 기록',ref:U3},
    {day:'2026-10-29',at:3,type:'org_update',text:'새 기록 010-2222-3333',ref:U1},
    {day:'bad',at:2,type:'org_update',text:'날짜 없음'},
  ]);
  assert.deepEqual(packed.map(p=>[p.key,p.day,p.ref]),[['r1','2026-10-29',U1],['r2','2026-10-01',U3]]);
  assert.match(packed[0].text,/\(연락처\)/);
  const m=JSON.parse(sr.statusRowsMaterial('가 지부',packed,TODAY));
  assert.deepEqual(Object.keys(m.records[0]).sort(),['day','kind','ref','text']);
  assert.doesNotMatch(JSON.stringify(m),new RegExp(U1),'record ids never go to the AI');
  assert.equal(sr.parseStatusRows('not json',packed,TODAY),null);
  assert.deepEqual(sr.parseStatusRows(JSON.stringify({rows:[{day:'2026-02-30',text:'없는 날',refs:['r1']}]}),packed,TODAY),[]);
  const many=sr.parseStatusRows(JSON.stringify({rows:Array.from({length:8},(_,i)=>({day:`2026-10-${String(10+i)}`,text:'줄'+i,refs:['r1']}))}),packed,TODAY);
  assert.equal(many.length,4);assert.deepEqual(many.map(r=>r.day),['2026-10-13','2026-10-12','2026-10-11','2026-10-10']);
  assert.equal(sr.parseStatusRows(JSON.stringify({rows:[{day:'2026-10-29',text:'가'.repeat(120),refs:['r1']}]}),packed,TODAY)[0].text.length,80);
});
