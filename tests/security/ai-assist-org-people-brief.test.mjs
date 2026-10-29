import test from 'node:test';
import assert from 'node:assert/strict';

// ORG-주요인물: the real ai-assist handler, kind=org_people_brief, with a synthetic Supabase (Auth + PostgREST with owner RLS)
// and a mocked OpenAI. No network, no real key, synthetic text only (가상 이름, 09xx ids).
// The screen sends only an organization id. Only records of the designated people go to the AI; personal calls never do.
const {createAiAssistHandler}=await import('../../supabase/functions/ai-assist/handler.ts');
const pb=await import('../../supabase/functions/ai-assist/org-people-brief.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const ORG_A='d0000000-0000-4000-8000-000000000001',ORG_B='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const P1='e0000000-0000-4000-8000-000000000001',P2='e0000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-10-29T03:00:00Z'),TODAY='2026-10-29';
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=o=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(o)}]}],usage:{input_tokens:3000,output_tokens:200}});

function harness({openai=null,people=null,briefs=[],missing=false,features=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가 지부'},{id:ORG_B,workspace_id:WS,name:'나 지회'},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직'}],
    app_org_key_people:people??[{id:P1,workspace_id:WS,organization_id:ORG_A,name:'김가상',match_names:['김가상','김 위원장'],sort_order:1,created_at:'2026-10-01T00:00:00Z'},
      {id:P2,workspace_id:WS,organization_id:ORG_A,name:'박가상',match_names:['박가상'],sort_order:2,created_at:'2026-10-02T00:00:00Z'}],
    app_org_key_people_briefs:structuredClone(briefs),
    app_feed_items:[
      {id:'f1',workspace_id:WS,source:'call',day:'2026-10-27',title:'가 지부 · 김가상 · 교섭',summary:'임금교섭 3차 일정 조율 CALL_SUMMARY_KIM',counterpart:'가 지부 김가상 위원장',hidden_at:null},
      {id:'f2',workspace_id:WS,source:'call',day:'2026-10-26',title:'다른 통화',summary:'UNRELATED_CALL',counterpart:'이가상',hidden_at:null},
      {id:'f3',workspace_id:WS,source:'call',day:'2026-09-01',title:'김가상 옛 통화',summary:'OLD_CALL',counterpart:'김가상',hidden_at:null},
      {id:'f4',workspace_id:WS,source:'telegram',day:'2026-10-28',room_key:'r1',room_label:'지부장방',title:'집회 공지',summary:'TG_ROOM_SUMMARY 연락처 010-1234-5678',hidden_at:null},
      {id:'f5',workspace_id:WS,source:'telegram',day:'2026-10-28',room_key:'r2',room_label:'다른 방',title:'무관',summary:'UNRELATED_TG',hidden_at:null},
    ],
    app_call_personal:[{id:'pc1',workspace_id:WS,day:'2026-10-28',counterpart:'김가상',summary:'PERSONAL_CALL_SECRET'}],
    app_tg_senders:[{id:'s1',workspace_id:WS,name:null,auto_name:'박가상',is_self:false}],
    app_tg_day_senders:[{workspace_id:WS,room_key:'r1',day:'2026-10-28',label:'A',sender_id:'s1'}],
    app_todo_candidates:[{workspace_id:WS,status:'open',summary:'김가상 위원장에게 자료 보내기',evidence:null,due:'2026-10-31',created_at:'2026-10-27T00:00:00Z'}],
    app_ledger_records:[{workspace_id:WS,kind:'commitment',commitment_status:'waiting',validity:'current',title:'인력 충원안 회신',counterparty:'박가상',follow_up_on:'2026-10-30'}],
    app_ai_daily_usage:[],
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
    throw new Error('op '+op);
  };
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      return openai?openai(calls.openai.at(-1)):respond(answer({brief:'임금교섭 3차 일정 조율 중이고 충원안 회신 대기(김가상, 박가상).',detail:'- 김가상: 교섭 일정 조율\n- 박가상: 충원안 회신 대기, 010-9999-8888'}));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only, never a service key');
    const bearer=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return users[bearer]?respond({id:users[bearer]}):respond({msg:'bad'},401);
    const uid=users[bearer];assert.ok(uid,'REST only with the caller token');
    if(url.pathname==='/rest/v1/rpc/app_my_features'){calls.features=(calls.features||0)+1;if(features==='missing')return respond({code:'PGRST202',message:'function not found'},404);return respond((features??{[OWNER]:['calls','telegram']})[uid]||[]);}
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body});
    assert.ok(!['app_call_personal','app_tg_senders','app_tg_day_senders'].includes(table),'personal calls and telegram names are never AI material');
    if(table==='app_feed_items')assert.match(url.search,/[?&]source=eq\.call&/,'only call items are read');
    if(missing&&/^app_org_key_people/.test(table))return respond({code:'PGRST205',message:'schema cache'},404);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    if(method==='POST'){
      const b=JSON.parse(init.body);
      if(!visible(table,b,uid))return respond({message:'rls'},403);
      if(table==='app_ai_daily_usage'){const i=rows.findIndex(r=>r.workspace_id===b.workspace_id&&r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond([],201);}
      assert.equal(table,'app_org_key_people_briefs');
      assert.deepEqual(Object.keys(b).sort(),['brief','day','detail','organization_id','people_ids','workspace_id']);
      if(rows.some(r=>r.organization_id===b.organization_id))return respond({code:'23505'},409);
      rows.push(b);return respond('',201);
    }
    if(method==='PATCH'){
      assert.equal(table,'app_org_key_people_briefs');
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['brief','day','detail','people_ids','updated_at']);
      for(const r of rows.filter(r=>visible(table,r,uid)&&matches(r,url)))Object.assign(r,b);
      return new Response(null,{status:204});
    }
    throw new Error('method '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)}));
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);};

test("owner: one AI call with only the designated people's recent records; brief saved for today with people ids",async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,{kind:'org_people_brief',organization_id:ORG_A});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);assert.match(body.brief,/김가상, 박가상/);
  assert.equal(body.detail,'- 김가상: 교섭 일정 조율','a detail line carrying a phone number is dropped');
  assert.equal(calls.openai.length,1);
  const sent=calls.openai[0].input[1].content;
  assert.match(sent,/CALL_SUMMARY_KIM/);assert.match(sent,/자료 보내기/);assert.match(sent,/충원안/);
  for(const no of ['UNRELATED_CALL','UNRELATED_TG','TG_ROOM_SUMMARY','OLD_CALL','PERSONAL_CALL_SECRET','010-1234-5678'])assert.doesNotMatch(sent,new RegExp(no));
  assert.equal(calls.openai[0].store,false);
  const row=db.app_org_key_people_briefs.find(r=>r.organization_id===ORG_A);
  assert.equal(row.day,TODAY);assert.deepEqual(row.people_ids,[P1,P2].sort());
  assert.ok(!calls.logs.some(l=>JSON.stringify(l).includes('김가상')),'logs carry counts only');
  // Same day, same people: no second AI call, stored sentence returned.
  const again=await (await post(handler,{kind:'org_people_brief',organization_id:ORG_A})).json();
  assert.equal(again.cached,true);assert.equal(calls.openai.length,1);
});

test('a stale brief (yesterday) is replaced in place; no people means no AI call',async()=>{
  const {handler,calls,db}=harness({briefs:[{organization_id:ORG_A,workspace_id:WS,day:'2026-10-28',brief:'어제 문장',detail:null,people_ids:[P1,P2]}]});
  assert.equal((await post(handler,{kind:'org_people_brief',organization_id:ORG_A})).status,200);
  assert.equal(db.app_org_key_people_briefs.length,1);assert.equal(db.app_org_key_people_briefs[0].day,TODAY);
  const empty=await (await post(handler,{kind:'org_people_brief',organization_id:ORG_B})).json();
  assert.equal(empty.empty,true);assert.equal(calls.openai.length,1);
});

test('other workspace organization, bad input, missing table and bad AI answers are refused',async()=>{
  const {handler,calls}=harness();
  await expectError(await post(handler,{kind:'org_people_brief',organization_id:FOREIGN_ORG}),404,'not_found');
  await expectError(await post(handler,{kind:'org_people_brief',organization_id:ORG_A},'stranger-token'),404,'not_found');
  await expectError(await post(handler,{kind:'org_people_brief',organization_id:'nope'}),400,'invalid_request');
  await expectError(await post(handler,{kind:'org_people_brief',organization_id:ORG_A,extra:1}),400,'invalid_request');
  assert.equal(calls.openai.length,0);
  const m=harness({missing:true});
  await expectError(await post(m.handler,{kind:'org_people_brief',organization_id:ORG_A}),503,'org_people_not_ready');
  const bad=harness({openai:()=>respond(answer({brief:'연락처 010-1234-5678',detail:''}))});
  await expectError(await post(bad.handler,{kind:'org_people_brief',organization_id:ORG_A}),502,'ai_invalid_response');
  assert.equal(bad.db.app_org_key_people_briefs.length,0);
});

test('pure rules: name matching like the screen, answer cleanup, material shape',()=>{
  const people=pb.briefPeople([{id:P1,name:'김가상',match_names:['김 위원장','김']}]);
  assert.deepEqual(people[0].needles,['김가상','김위원장']);
  assert.deepEqual(pb.whoIn(['가 지부 김 가상 위원장'],people),['김가상']);
  assert.deepEqual(pb.whoIn(['이가상'],people),[]);
  assert.deepEqual(pb.parsePeopleBrief(JSON.stringify({brief:'<b>요즘</b>\n교섭 중(김가상)',detail:''})),{brief:'요즘 교섭 중(김가상)',detail:null});
  assert.equal(pb.parsePeopleBrief('not json'),null);
  assert.equal(pb.parsePeopleBrief(JSON.stringify({brief:'',detail:'x'})),null);
  assert.equal([...pb.parsePeopleBrief(JSON.stringify({brief:'가'.repeat(400),detail:''})).brief].length,pb.PEOPLE_BRIEF_CHARS);
  const {packed}=pb.packBriefItems([{day:'2026-10-01',type:'call',who:['김가상'],text:'안녕하세요\n교섭 메일 a@b.co'}]);
  assert.equal(packed[0].text,'교섭 메일 (연락처)');
  const material=JSON.parse(pb.peopleBriefMaterial('가 지부',people,packed,TODAY));
  assert.deepEqual(Object.keys(material),['today','organization','people','records']);
});

test('MULTI 단계 ①: without the calls feature the brief is made without call material (calls are not read)',async()=>{
  const {handler,calls}=harness({features:{}});
  const res=await post(handler,{kind:'org_people_brief',organization_id:ORG_A});
  assert.ok([200].includes(res.status));
  assert.ok(!calls.rest.some(c=>c.table==='app_feed_items'),'calls are not read');
  assert.equal(calls.features,1);
});
