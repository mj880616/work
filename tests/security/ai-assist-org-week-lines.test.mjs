import test from 'node:test';
import assert from 'node:assert/strict';

// WEEKLY-메뉴짝짓기 P2: the real ai-assist handler, kind=org_week_lines, with a synthetic Supabase (Auth + PostgREST with owner RLS)
// and a mocked OpenAI. No network, no real key, synthetic text only (가상 이름, 09xx-style ids).
// The screen sends only a record kind and id. The server re-reads the record, its organization and day with the caller's login,
// tidies one line (no AI for short lines and status rows, one AI call for long text) and writes a suggested line into
// app_weekly_org_lines of that week with the caller's login — or adds the id to the same-event line, or rewrites the line from that record.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const wl=await import('../../supabase/functions/ai-assist/org-week-lines.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const ORG_A='d0000000-0000-4000-8000-000000000001',ORG_B='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const U_SHORT='e0000000-0000-4000-8000-000000000001',U_FOREIGN='e0000000-0000-4000-8000-000000000009';
const N_LONG='f0000000-0000-4000-8000-000000000001',N_DIARY='f0000000-0000-4000-8000-000000000002',N_FREE='f0000000-0000-4000-8000-000000000003';
const S_ROW='c0000000-0000-4000-8000-000000000001';
const L_OLD='90000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-11-04T03:00:00Z'),MON='2026-11-02';
const LONG='가상 지부 임단협 2차 교섭이 오후에 열렸고 사측은 임금 동결안을 고수했다.\n다음 교섭 일정은 추후 협의하기로 했다. LONG_SECRET 010-1234-5678';
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=o=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(o)}]}],usage:{input_tokens:800,output_tokens:60}});

function harness({openai=null,lines=[],aiToday=0}={}){
  const calls={openai:[],rest:[],logs:[]};
  const at=d=>new Date(Date.parse(d+'T01:00:00Z')).toISOString();
  let seq=0;const stamp=()=>new Date(NOW+(++seq)*1000).toISOString();
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가 지부'},{id:ORG_B,workspace_id:WS,name:'나 지회'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_suborganization_updates:[
      {id:U_SHORT,organization_id:ORG_A,occurred_at:at('2026-11-03'),raw_text:'- 가상 교섭 상견례.',detail_text:null},
      {id:U_FOREIGN,organization_id:FOREIGN_ORG,occurred_at:at('2026-11-03'),raw_text:'FOREIGN_RECORD',detail_text:null},
    ],
    app_notes:[
      {id:N_LONG,workspace_id:WS,kind:'basket',raw_text:LONG,occurred_at:at('2026-11-04'),archived_at:null,ai_export_allowed:true},
      {id:N_DIARY,workspace_id:WS,kind:'diary',raw_text:'DIARY_SECRET',occurred_at:at('2026-11-04'),archived_at:null,ai_export_allowed:true},
      {id:N_FREE,workspace_id:WS,kind:'basket',raw_text:'분류 안 된 업데이트',occurred_at:at('2026-11-04'),archived_at:null,ai_export_allowed:true},
    ],
    app_record_links:[
      {workspace_id:WS,note_id:N_LONG,organization_id:ORG_A,status:'confirmed'},
      {workspace_id:WS,note_id:N_LONG,organization_id:ORG_B,status:'confirmed'},
      {workspace_id:WS,note_id:N_LONG,organization_id:FOREIGN_ORG,status:'confirmed'},
    ],
    app_org_status_rows:[{id:S_ROW,workspace_id:WS,organization_id:ORG_B,day:'2026-11-05',end_day:'2026-11-07',body:'파업 찬반투표'}],
    app_weekly_org_lines:[
      ...lines.map(l=>({workspace_id:WS,week_start:MON,day:null,end_day:null,sort_order:0,state:'in',origin:'user',edited:false,source_update_ids:[],source_note_ids:[],source_status_ids:[],source_hash:null,created_at:new Date(NOW-86400000).toISOString(),updated_at:new Date(NOW-86400000).toISOString(),...l})),
      ...Array.from({length:aiToday},(_,i)=>({id:`91000000-0000-4000-8000-${String(i).padStart(12,'0')}`,workspace_id:WS,week_start:'2026-10-26',organization_id:ORG_B,body:'다른 주 AI 줄 '+i,state:'suggested',origin:'ai',created_at:new Date(NOW-3600000).toISOString(),updated_at:new Date(NOW-3600000).toISOString(),source_update_ids:[],source_note_ids:[],source_status_ids:[]})),
    ],
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
  const SKIP=['select','limit','order','on_conflict','offset'];
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      return openai?openai(calls.openai.at(-1)):respond(answer({text:'가상 지부 임단협 2차 교섭 — 사측 임금 동결안 고수.',same_as:[1,0]}));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features')return respond([]);
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    const pairs=[...url.searchParams].filter(([k])=>!SKIP.includes(k));
    const ok=r=>visible(table,r,uid)&&pairs.every(([k,v])=>{const i=v.indexOf('.');return cmp(r[k],v.slice(0,i),v.slice(i+1));});
    if(method==='GET')return respond(rows.filter(ok).slice(0,Number(url.searchParams.get('limit')||1e9)));
    const b=JSON.parse(init.body);
    if(table==='app_ai_daily_usage'){
      assert.equal(method,'POST');
      const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond([],201);
    }
    assert.equal(table,'app_weekly_org_lines','the only other write is the weekly line table');
    assert.equal(headers.get('Prefer'),'return=representation');
    if(method==='POST'){
      assert.ok(visible(table,b,uid),'RLS: own workspace only');
      for(const k of ['id','created_at','updated_at'])assert.equal(k in b,false,k+' is set by the database');
      const row={...b,id:`92000000-0000-4000-8000-${String(rows.length).padStart(12,'0')}`,created_at:new Date(NOW).toISOString(),updated_at:stamp()};rows.push(row);return respond([{id:row.id}],201);
    }
    if(method==='PATCH'){
      for(const k of ['workspace_id','organization_id','week_start','origin','updated_at'])assert.equal(k in b,false,k+' cannot be changed');
      const hit=rows.filter(ok);for(const r of hit)Object.assign(r,b,{updated_at:stamp()});return respond(hit);
    }
    throw new Error('method '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const call=async(h,source_kind,source_id,token)=>{const r=await post(h,{kind:'org_week_lines',source_kind,source_id},token);return {status:r.status,body:await r.json()};};
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);};
const weekLines=db=>db.app_weekly_org_lines.filter(l=>l.week_start===MON);

test('a short organization record becomes a suggested line without AI; the same record again changes nothing',async()=>{
  const {handler,calls,db}=harness();
  const {status,body}=await call(handler,'org_update',U_SHORT);
  assert.equal(status,200);assert.equal(body.ok,true);assert.equal(body.week_start,MON);
  assert.deepEqual(body.results.map(r=>[r.organization_id,r.result]),[[ORG_A,'added']]);
  const [line]=weekLines(db);
  assert.equal(line.body,'가상 교섭 상견례','lead mark and final period removed');
  assert.equal(line.state,'suggested');assert.equal(line.origin,'plain');assert.equal(line.day,'2026-11-03');assert.equal(line.organization_id,ORG_A);
  assert.deepEqual(line.source_update_ids,[U_SHORT]);assert.match(line.source_hash,/^[0-9a-f]{32}$/);
  assert.equal(calls.openai.length,0);
  const again=await call(handler,'org_update',U_SHORT);
  assert.deepEqual(again.body.results.map(r=>r.result),['same']);
  assert.equal(weekLines(db).length,1);assert.equal(calls.rest.filter(r=>r.method!=='GET').length,1);
});

test('editing the original record rewrites the line from it; a line the user edited or dropped is kept',async()=>{
  const {handler,db}=harness();
  await call(handler,'org_update',U_SHORT);
  db.app_suborganization_updates[0].raw_text='가상 교섭 상견례 연기';
  assert.deepEqual((await call(handler,'org_update',U_SHORT)).body.results.map(r=>r.result),['rewritten']);
  assert.equal(weekLines(db)[0].body,'가상 교섭 상견례 연기');
  weekLines(db)[0].edited=true;db.app_suborganization_updates[0].raw_text='가상 교섭 상견례 취소';
  assert.deepEqual((await call(handler,'org_update',U_SHORT)).body.results.map(r=>r.result),['keep']);
  assert.equal(weekLines(db)[0].body,'가상 교섭 상견례 연기');
  weekLines(db)[0].edited=false;weekLines(db)[0].state='dropped';
  assert.deepEqual((await call(handler,'org_update',U_SHORT)).body.results.map(r=>r.result),['keep'],'a dropped suggestion is not offered again');
});

test('a long update linked to two organizations: one AI call, same event merges the id, the other gets a new AI line',async()=>{
  const {handler,calls,db}=harness({lines:[{id:L_OLD,organization_id:ORG_A,body:'임단협 2차 교섭',day:'2026-11-04',state:'in',source_update_ids:[U_SHORT]}]});
  const {status,body}=await call(handler,'note',N_LONG);
  assert.equal(status,200);
  assert.deepEqual(body.results.map(r=>[r.organization_id,r.result]),[[ORG_A,'merged'],[ORG_B,'added']],'other-workspace organization link is ignored');
  assert.equal(calls.openai.length,1,'one AI call per record');assert.equal(calls.openai[0].store,false);
  const sent=calls.openai[0].input[1].content;
  assert.match(sent,/LONG_SECRET/);assert.match(sent,/임단협 2차 교섭/);
  for(const no of [N_LONG,U_SHORT,ORG_A,'가 지부','010-1234-5678','DIARY_SECRET'])assert.doesNotMatch(sent,new RegExp(no),no);
  const merged=db.app_weekly_org_lines.find(l=>l.id===L_OLD);
  assert.equal(merged.body,'임단협 2차 교섭','merging keeps the text');assert.deepEqual(merged.source_note_ids,[N_LONG]);
  const added=weekLines(db).find(l=>l.organization_id===ORG_B);
  assert.equal(added.body,'가상 지부 임단협 2차 교섭 — 사측 임금 동결안 고수');assert.equal(added.origin,'ai');assert.equal(added.state,'suggested');
  assert.deepEqual(added.source_note_ids,[N_LONG]);
  assert.ok(!calls.logs.some(l=>JSON.stringify(l).includes('교섭')),'logs carry counts only');
});

test('a status row goes in as it is, with its period, without AI',async()=>{
  const {handler,calls,db}=harness();
  const {body}=await call(handler,'status_row',S_ROW);
  assert.deepEqual(body.results.map(r=>r.result),['added']);
  const [line]=weekLines(db);
  assert.equal(line.body,'파업 찬반투표');assert.equal(line.day,'2026-11-05');assert.equal(line.end_day,'2026-11-07');assert.deepEqual(line.source_status_ids,[S_ROW]);
  assert.equal(calls.openai.length,0);
});

test('unlinked updates stay unclassified; diary, foreign and invisible records are refused; bad input refused',async()=>{
  const {handler,calls,db}=harness();
  const free=await call(handler,'note',N_FREE);
  assert.equal(free.status,200);assert.equal(free.body.unlinked,true);assert.deepEqual(free.body.results,[]);
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'note',source_id:N_DIARY}),404,'not_found');
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'org_update',source_id:U_FOREIGN}),404,'not_found');
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'org_update',source_id:U_SHORT},'stranger-token'),404,'not_found');
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'meeting',source_id:U_SHORT}),400,'invalid_request');
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'org_update',source_id:'nope'}),400,'invalid_request');
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'org_update',source_id:U_SHORT,organization_id:ORG_B}),400,'invalid_request');
  await expectError(await post(handler,{kind:'org_week_lines',source_kind:'org_update',source_id:U_SHORT,body:'화면 글'}),400,'invalid_request');
  assert.equal(calls.openai.length,0);assert.equal(weekLines(db).length,0);
});

test('daily AI line cap, AI failure and bad answers fall back to the first 60 characters without AI',async()=>{
  assert.equal(DAILY_LIMITS.org_week_lines,40);
  const capped=harness({aiToday:40});
  assert.deepEqual((await call(capped.handler,'note',N_LONG)).body.results.map(r=>r.result),['added','added']);
  assert.equal(capped.calls.openai.length,0);
  const line=weekLines(capped.db)[0];assert.equal(line.origin,'plain');assert.ok([...line.body].length<=60);assert.doesNotMatch(line.body,/010-1234-5678/);
  for(const openai of [()=>respond({error:'x'},500),()=>respond(answer({lines:[]}))]){
    const h=harness({openai});
    const b=(await call(h.handler,'note',N_LONG)).body;
    assert.deepEqual(b.results.map(r=>r.result),['added','added']);assert.equal(weekLines(h.db)[0].origin,'plain');
  }
});

test('the week table is full: nothing is added',async()=>{
  const {handler,db}=harness({lines:Array.from({length:40},(_,i)=>({id:`93000000-0000-4000-8000-${String(i).padStart(12,'0')}`,organization_id:ORG_A,body:'줄 '+i,sort_order:i}))});
  assert.deepEqual((await call(handler,'org_update',U_SHORT)).body.results.map(r=>r.result),['full']);
  assert.equal(weekLines(db).length,40);
});

test('pure rules: Monday, plain lines, answer checks',async()=>{
  assert.equal(wl.mondayOf('2026-11-02'),'2026-11-02');assert.equal(wl.mondayOf('2026-11-08'),'2026-11-02');assert.equal(wl.mondayOf('2026-11-04'),'2026-11-02');
  assert.equal(wl.plainLine('- 가상 상견례.'),'가상 상견례');assert.equal(wl.plainLine('두 줄\n글'),null);assert.equal(wl.plainLine('가'.repeat(41)),null);
  assert.equal(wl.oneLine('연락 010-1111-2222 <b>x</b>',60),'연락 (연락처) x');
  const groups=[['a','b'],[]];
  assert.equal(wl.parseOrgWeek('not json',groups),null);
  assert.equal(wl.parseOrgWeek(JSON.stringify({text:'',same_as:[]}),groups),null);
  assert.deepEqual(wl.parseOrgWeek(JSON.stringify({text:'가'.repeat(80),same_as:[3,1]}),groups),{text:'가'.repeat(60),sameAs:[0,0]});
  assert.deepEqual(wl.parseOrgWeek(JSON.stringify({text:'줄.',same_as:[2]}),groups),{text:'줄',sameAs:[2,0]});
  assert.equal(await wl.sourceHash('a','2026-11-02',null),await wl.sourceHash('a','2026-11-02',null));
  assert.notEqual(await wl.sourceHash('a','2026-11-02',null),await wl.sourceHash('a','2026-11-03',null));
  assert.equal(wl.withSource(Array.from({length:10},(_,i)=>String(i)),'x'),null);
});
