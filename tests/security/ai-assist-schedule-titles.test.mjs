import test from 'node:test';
import assert from 'node:assert/strict';

// WEEKLY-일정다듬기 ④: the real ai-assist handler, kind=schedule_titles, with a synthetic Supabase (Auth + PostgREST with owner RLS) and a
// mocked OpenAI. No network, no real key, synthetic text only (가상 이름). The screen sends the week and the event lines only; the work
// records are read with the caller's token; the answer is returned, never stored.
const {createAiAssistHandler,DAILY_LIMITS,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const st=await import('../../supabase/functions/ai-assist/schedule-titles.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ORG_A='d0000000-0000-4000-8000-000000000001',FOREIGN_ORG='d0000000-0000-4000-8000-000000000009';
const PRJ='e0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-23T03:00:00Z'),WEEK='2026-10-19';
const THU='2026-10-22T01:00:00Z',OLD='2026-10-01T01:00:00Z';

const answer=items=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:3000,output_tokens:200}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({openai=null,usage=[]}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG_A,workspace_id:WS,name:'가상에이운영지부',aliases:['가상에이']},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의 조직',aliases:[]}],
    app_spaces:[{id:PRJ,workspace_id:WS,name:'가상 임단투',owner_id:OWNER,status:'active'}],
    app_suborganization_updates:[
      {id:id(1),organization_id:ORG_A,occurred_at:THU,raw_text:'가상에이운영지부 임단투 점검 회의 10.27 예정\n수고하셨습니다',detail_text:null},
      {id:id(2),organization_id:FOREIGN_ORG,occurred_at:THU,raw_text:'FOREIGN_ORG_TEXT',detail_text:null},
    ],
    app_notes:[
      {id:id(10),workspace_id:WS,kind:'basket',raw_text:'경고파업 돌입 기자회견 검암역 연락처 010-1234-5678',occurred_at:THU,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(11),workspace_id:WS,kind:'basket',raw_text:'EXCLUDED_TEXT',occurred_at:THU,journal_day:null,archived_at:null,ai_export_allowed:false},
      {id:id(12),workspace_id:WS,kind:'basket',raw_text:'ARCHIVED_TEXT',occurred_at:THU,journal_day:null,archived_at:THU,ai_export_allowed:true},
      {id:id(13),workspace_id:WS,kind:'diary',raw_text:'SECRET_DIARY',occurred_at:THU,journal_day:null,archived_at:null,ai_export_allowed:true},
      {id:id(14),workspace_id:WS,kind:'basket',raw_text:'OLD_WEEK_TEXT',occurred_at:OLD,journal_day:null,archived_at:null,ai_export_allowed:true},
    ],
    app_project_progress_updates:[{id:id(20),project_id:PRJ,summary:'임단투 3차 교섭',effective_on:'2026-10-21',created_at:THU}],
    app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER};
  const wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=Object.fromEntries(db.app_suborganizations.map(o=>[o.id,o.workspace_id]));
  const prjWs=Object.fromEntries(db.app_spaces.map(p=>[p.id,p.workspace_id]));
  const visible=(table,row,uid)=>table==='app_suborganization_updates'?wsOwner[orgWs[row.organization_id]]===uid
    :table==='app_project_progress_updates'?wsOwner[prjWs[row.project_id]]===uid
    :table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(cell,op,val)=>{
    if(op==='eq')return String(cell)===val;
    if(op==='gte')return cell!=null&&String(cell)>=val; if(op==='lt')return cell!=null&&String(cell)<val;
    if(op==='in')return val.slice(1,-1).split(',').includes(String(cell));
    if(op==='is')return val==='null'?cell==null:val==='true'?cell===true:cell===false;
    throw new Error('op '+op);
  };
  const instant=(k,v)=>/_at$/.test(k)&&typeof v==='string'&&v.includes('T')?new Date(v).toISOString():v;
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(instant(k,row[k]),v.slice(0,i),instant(k,v.slice(i+1))))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){
      calls.openai.push(JSON.parse(init.body));
      if(openai)return openai(calls.openai.at(-1));
      return respond(answer([{ref:'e1',title:'가상에이운영지부 임단투 점검 회의',place:''},{ref:'e2',title:'가상 경고파업 돌입 기자회견',place:'검암역'}]));
    }
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),'synthetic-anon-key','anon key only');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)).slice(0,Number(url.searchParams.get('limit')||1e9)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const events=[{ref:'e1',day:'2026-10-27',time:'14:00',title:'가상에이',place:''},{ref:'e2',day:'2026-10-28',time:'10:00',title:'공철 파업선포 기자회견 검암역(가안)',place:''}];
const run=(over={})=>({kind:'schedule_titles',week_start:WEEK,events,...over});
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}));
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);};

test('owner: one OpenAI call with event lines, names and the week\'s own records; answer returned, nothing stored',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,run());
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body,{ok:true,kind:'schedule_titles',week_start:WEEK,partial:false,items:[
    {ref:'e1',title:'가상에이운영지부 임단투 점검 회의',place:''},{ref:'e2',title:'가상 경고파업 돌입 기자회견',place:'검암역'}]});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.tools,undefined);assert.equal(o.text.format.name,'schedule_titles');assert.equal(o.text.format.strict,true);
  const material=o.input[1].content,sent=JSON.parse(material);
  assert.deepEqual(sent.events.map(e=>[e.ref,e.date,e.time,e.title]),[['e1','10.27.(화)','14:00','가상에이'],['e2','10.28.(수)','10:00','공철 파업선포 기자회견 검암역(가안)']]);
  assert.deepEqual(sent.names,{organizations:['가상에이운영지부 (다른 이름: 가상에이)'],projects:['가상 임단투']});
  assert.ok(sent.records.some(r=>r.type==='조직 기록'&&r.about==='가상에이운영지부'));
  assert.ok(sent.records.some(r=>r.type==='사업 기록'&&r.about==='가상 임단투'));
  for(const hidden of ['수고하셨습니다','010-1234-5678','EXCLUDED_TEXT','ARCHIVED_TEXT','SECRET_DIARY','OLD_WEEK_TEXT','FOREIGN_ORG_TEXT','남의 조직',OWNER,WS,ORG_A,PRJ])
    assert.ok(!material.includes(hidden),hidden+' must not be sent');
  const notes=calls.rest.find(c=>c.table==='app_notes').query;
  assert.match(notes,/kind=in\.\(basket,work\)/);assert.match(notes,/archived_at=is\.null/);assert.match(notes,/ai_export_allowed=is\.true/);
  // records from the shown week's Monday to the last event day
  assert.match(calls.rest.find(c=>c.table==='app_suborganization_updates').query,/occurred_at=gte\.2026-10-18T15:00:00\.000Z&occurred_at=lt\.2026-10-28T15:00:00\.000Z/);
  assert.ok(calls.rest.every(c=>c.method==='GET'||c.table==='app_ai_daily_usage'),'no write but the usage count');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/가상|기자회견|임단투/.test(JSON.stringify(calls.logs)),'no titles or material in logs');
  assert.ok(calls.logs.some(l=>l.code==='schedule_titles_done'&&l.detail.items===2));
  assert.equal(DAILY_LIMITS.schedule_titles,20);
});

test('untrusted answer: unknown or repeated refs, HTML, contacts, long or empty titles are dropped; a broken answer fails',async()=>{
  {const {handler,calls}=harness({openai:()=>respond(answer([
    {ref:'e9',title:'없는 일정',place:''},{ref:'e1',title:'<b>회의</b>',place:'a<i>b</i>'},{ref:'e1',title:'두 번째',place:''},
    {ref:'e2',title:'연락 010-9876-5432',place:''},{ref:'e2',title:'x'.repeat(81),place:''},{ref:'e2',title:'  ',place:''},{ref:'e2',title:'ok',place:'',extra:1}]))});
   const body=await (await post(handler,run())).json();
   assert.deepEqual(body.items,[{ref:'e1',title:'회의',place:'ab'}]);
   assert.ok(calls.logs.some(l=>l.code==='schedule_titles_done'&&l.detail.dropped===6));}
  {const {handler}=harness({openai:()=>respond({status:'completed',output:[]})});await expectError(await post(handler,run()),502,'ai_invalid_response');}
  {const {handler}=harness({openai:()=>respond({message:'down'},500)});await expectError(await post(handler,run()),503,'ai_busy');}
  assert.equal(st.parseScheduleTitles({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},events),null);
  assert.equal(st.cleanTitle('a@b.kr 회의',80),null);
});

test('input: only week + event lines in the two report weeks, known keys, bounded sizes; no AI call on a bad request',async()=>{
  const bad=[
    {kind:'schedule_titles',week_start:WEEK},
    run({week_start:'2026-10-20'}),run({week_start:'2026-02-30'}),run({week_start:'2020-01-06'}),run({extra:1}),run({events:[]}),
    run({events:[{...events[0],day:'2026-10-25'}]}),run({events:[{...events[0],day:'2026-11-09'}]}),
    run({events:[{...events[0],time:'25:00'}]}),run({events:[{...events[0],ref:'e31'}]}),run({events:[events[0],{...events[1],ref:'e1'}]}),
    run({events:[{...events[0],title:''}]}),run({events:[{...events[0],title:'x'.repeat(81)}]}),run({events:[{...events[0],title:'<b>x</b>'}]}),
    run({events:[{...events[0],place:'x'.repeat(61)}]}),run({events:[{...events[0],note:'원문'}]}),run({events:[{...events[0],title:'a\u0007b'}]}),
    run({events:Array.from({length:31},(_,i)=>({...events[0],ref:`e${i+1}`}))}),
  ];
  for(const body of bad){const {handler,calls}=harness();await expectError(await post(handler,body),400,'invalid_request');assert.equal(calls.openai.length,0);}
  // 30 lines with long titles fit the 20KB body this kind gets; a bigger body is refused before reading the database.
  const many=Array.from({length:30},(_,i)=>({ref:`e${i+1}`,day:'2026-10-27',time:'종일',title:'가'.repeat(80),place:'나'.repeat(60)}));
  {const {handler,calls}=harness({openai:()=>respond(answer([]))});const res=await post(handler,run({events:many}));assert.equal(res.status,200);assert.equal(calls.openai.length,1);}
  {const {handler,calls}=harness();await expectError(await post(handler,JSON.stringify({...run(),pad:'x'.repeat(21000)})),413,'invalid_request');assert.equal(calls.rest.filter(c=>c.table!=='app_workspace_members').length,0);}
  // Another kind still gets the old 2KB limit.
  {const {handler,calls}=harness();await expectError(await post(handler,JSON.stringify({kind:'org_summary',week_start:WEEK,organization_ids:[ORG_A],pad:'x'.repeat(3000)})),400,'invalid_request');assert.equal(calls.openai.length,0);}
});

test('auth and budget: login and owner first, daily limit before OpenAI',async()=>{
  {const {handler,calls}=harness();await expectError(await post(handler,run(),'bad-token'),401,'session_required');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness();const res=await post(handler,run(),'stranger-token');
   // A stranger owns another workspace: only that workspace's (empty) records, never the owner's.
   assert.equal(res.status,200);const sent=JSON.parse(calls.openai[0].input[1].content);
   assert.deepEqual(sent.names.organizations,['남의 조직']);assert.ok(!JSON.stringify(sent).includes('가상에이운영지부'));}
  {const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-23',requests:DAILY_TOTAL_LIMIT,input_tokens:0,output_tokens:0}]});
   await expectError(await post(handler,run()),429,'daily_limit');assert.equal(calls.openai.length,0);}
  // Pure parts.
  assert.equal(st.parseScheduleRequest({kind:'schedule_titles',week_start:WEEK,events}).events.length,2);
  const p=st.packScheduleRecords([{day:'2026-10-20',at:1,type:'work',label:'',text:'같은 글'},{day:'2026-10-21',at:2,type:'update',label:'',text:'같은  글'}]);
  assert.equal(p.records.length,1);
  assert.equal(st.packScheduleRecords([{day:'2026-10-20',at:1,type:'work',label:'',text:'가'.repeat(1000)},{day:'2026-10-21',at:2,type:'work',label:'',text:'나'.repeat(1000)}],{total:1100}).partial,true);
});
