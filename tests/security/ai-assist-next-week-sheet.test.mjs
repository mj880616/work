import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-다음주준비: the real ai-assist handler, kind=next_week_sheet, with a synthetic Supabase (Auth + PostgREST with owner RLS) and a
// mocked OpenAI. No network, no real key, synthetic text only. The screen sends next Monday, the mode (auto after Friday 15:00 KST / user)
// and the next-week material lines; the server writes only app_journal_next_week_sheets (+ AI usage), never Google, ledger, todo or meeting
// tables, keeps the lines even when AI is limited or fails, and never lets one owner touch another workspace.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const nw=await import('../../supabase/functions/ai-assist/next-week-sheet.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const WEEK='2026-11-02';
const FRI_AFTERNOON=Date.parse('2026-10-30T07:10:00Z'),FRI_MORNING=Date.parse('2026-10-30T01:00:00Z'),SAT=Date.parse('2026-10-31T03:00:00Z'),THU=Date.parse('2026-10-29T08:00:00Z');
const ITEMS=[
  {group:'events',title:'A 사업장 교섭',day:'2026-11-03',source_kind:'event',source_id:'ev_1',org:'A 사업장'},
  {group:'tasks',title:'임단협 요구안 초안 010-1234-5678',day:'2026-11-04',source_kind:'task',source_id:'task_1',org:null},
  {group:'commitments',title:'B 지부 자료 회신',day:'2026-11-05',source_kind:'ledger',source_id:'c0000000-0000-4000-8000-000000000001',org:'B 지부'},
  {group:'overdue',title:'회의록 정리',day:'2026-10-28',source_kind:'task',source_id:'task_2',org:null},
  {group:'todos',title:'현수막 시안 확인',day:null,source_kind:'todo',source_id:'d0000000-0000-4000-8000-000000000001',org:null},
  {group:'meetings',title:'A 사업장 교섭(지난 3차) 후속: 사측 안 검토',day:'2026-11-03',source_kind:'meeting',source_id:'e0000000-0000-4000-8000-000000000001',org:'A 사업장'},
];
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=lines=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({lines})}]}],usage:{input_tokens:900,output_tokens:80}});
const TOP=[{text:'화요일 교섭 전에 지난 회의 후속 정리 필요함.',refs:[0,5]},{text:'수요일 기한 요구안 초안 아직 진행 중임.',refs:[1]},{text:'B 지부 자료 회신 11/5까지임.',refs:[2,99]}];

function harness({openai=null,usage=[],sheets=[],now=FRI_AFTERNOON,missing=false}={}){
  const calls={openai:[],rest:[],logs:[],hosts:new Set()};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_journal_next_week_sheets:structuredClone(sheets),
    app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val:op==='is'?(val==='null'?v==null:String(v)===val):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    calls.hosts.add(url.origin);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer(TOP));}
    assert.equal(url.origin,SB,'no Google or other outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    if(missing&&table==='app_journal_next_week_sheets')return respond({code:'PGRST205'},404);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(table==='app_journal_next_week_sheets'&&method==='POST'){
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['ai_status','groups','made_by','top_lines','week_start','workspace_id'],'only the six insert columns');
      if(!visible(table,b,uid))return respond({code:'42501'},403);
      if(rows.some(r=>r.workspace_id===b.workspace_id&&r.week_start===b.week_start))return respond({code:'23505'},409);
      rows.push({...b,created_at:'now',updated_at:'now'});return respond('',201);
    }
    if(table==='app_journal_next_week_sheets'&&method==='PATCH'){
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['ai_status','groups','made_by','top_lines','updated_at'],'only the five update columns');
      for(const r of rows)if(visible(table,r,uid)&&matches(r,url))Object.assign(r,b);
      return new Response(null,{status:204});
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>now,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
const req=(extra={})=>({kind:'next_week_sheet',week_start:WEEK,mode:'auto',items:ITEMS,...extra});
const onlyWrites=calls=>calls.rest.filter(c=>c.method!=='GET').map(c=>c.table);

test('Friday after 15:00, no sheet yet: one AI call, the sheet stored only in its table, usage counted, no text in logs',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,req());
  assert.equal(res.status,200);
  const out=await res.json();
  assert.equal(out.week_start,WEEK);assert.equal(out.sheet.ai_status,'ok');assert.equal(out.sheet.made_by,'auto');
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'next_week_sheet');assert.equal(o.text.format.strict,true);
  assert.ok(o.input[0].content.includes("'~함.'·'~임.'"),'the house tone (shared AI_TONE_RULE)');
  assert.ok(!o.input[1].content.includes('010-1234-5678'),'phone numbers are not sent');
  assert.match(o.input[1].content,/\[5\] ⑥ 지난 회의 후속/);
  // Reference 99 is not in the material and is dropped; the line stays because ref 2 is real.
  assert.deepEqual(db.app_journal_next_week_sheets[0].top_lines,[{text:TOP[0].text,refs:[0,5]},{text:TOP[1].text,refs:[1]},{text:TOP[2].text,refs:[2]}]);
  assert.deepEqual(db.app_journal_next_week_sheets[0].groups,ITEMS);
  // Read-only towards every source: the only writes are the sheet and the AI usage row; no Google host is called.
  assert.deepEqual([...new Set(onlyWrites(calls))].sort(),['app_ai_daily_usage','app_journal_next_week_sheets']);
  assert.deepEqual([...calls.hosts].sort(),['https://api.openai.com',SB]);
  assert.equal(db.app_ai_daily_usage[0].requests,1);assert.equal(db.app_ai_daily_usage[0].input_tokens,900);
  assert.ok(!/교섭|요구안|지부/.test(JSON.stringify(calls.logs)),'no material in logs');
  assert.equal(DAILY_LIMITS.next_week_sheet,5);
});

for(const [name,opts,body,reason] of [
  ['auto before Friday 15:00',{now:FRI_MORNING},{},'not_yet'],
  ['auto on Thursday',{now:THU},{},'not_yet'],
  ['auto when the sheet already exists (made earlier with [지금 만들기])',{sheets:[{workspace_id:WS,week_start:WEEK,top_lines:[],groups:[],ai_status:'skipped',made_by:'user'}]},{},'done'],
])test(`auto is skipped without AI and without writes: ${name}`,async()=>{
  const {handler,calls,db}=harness(opts);
  const res=await post(handler,req(body));
  assert.equal(res.status,200);
  const out=await res.json();
  assert.equal(out.skipped,reason);
  assert.equal(calls.openai.length,0);
  assert.deepEqual(onlyWrites(calls),[],'nothing written');
  assert.equal(db.app_ai_daily_usage.length,0);
});

test('auto still works on Saturday; [지금 만들기] works before Friday 15:00; [다시 만들기] overwrites the week',async()=>{
  const sat=harness({now:SAT});
  assert.equal((await (await post(sat.handler,req())).json()).sheet.ai_status,'ok');
  const early=harness({now:THU});
  const made=await (await post(early.handler,req({mode:'user'}))).json();
  assert.equal(made.sheet.made_by,'user');assert.equal(early.db.app_journal_next_week_sheets.length,1);
  const again=harness({sheets:[{workspace_id:WS,week_start:WEEK,top_lines:[],groups:[],ai_status:'failed',made_by:'auto'}]});
  const r=await (await post(again.handler,req({mode:'user',items:ITEMS.slice(0,2)}))).json();
  assert.equal(again.db.app_journal_next_week_sheets.length,1);
  assert.equal(r.sheet.made_by,'user');assert.equal(r.sheet.groups.length,2);assert.equal(r.sheet.ai_status,'ok');
  assert.ok(again.calls.rest.some(c=>c.method==='PATCH'),'existing row is patched, not duplicated');
});

test('AI limits and failures still store the six groups without top lines',async()=>{
  const monthly=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-27',requests:1,input_tokens:9e9,output_tokens:9e9}]});
  let out=await (await post(monthly.handler,req())).json();
  assert.equal(out.sheet.ai_status,'limit');assert.deepEqual(out.sheet.top_lines,[]);assert.equal(out.sheet.groups.length,ITEMS.length);
  assert.equal(monthly.calls.openai.length,0);
  const daily=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-30',requests:80,input_tokens:1,output_tokens:1}]});
  out=await (await post(daily.handler,req())).json();
  assert.equal(out.sheet.ai_status,'limit');assert.equal(daily.calls.openai.length,0);
  const broken=harness({openai:()=>respond({error:{message:'synthetic'}},500)});
  out=await (await post(broken.handler,req())).json();
  assert.equal(out.sheet.ai_status,'failed');assert.equal(out.sheet.groups.length,ITEMS.length);
  const junk=harness({openai:()=>respond(answer([{text:'<b>x</b>',refs:[0]},{text:'근거 없는 줄임.',refs:[42]}]))});
  out=await (await post(junk.handler,req())).json();
  assert.equal(out.sheet.ai_status,'ok');assert.deepEqual(out.sheet.top_lines,[],'lines without real references are dropped');
  const empty=harness();
  out=await (await post(empty.handler,req({items:[]}))).json();
  assert.equal(out.sheet.ai_status,'skipped');assert.equal(empty.calls.openai.length,0);
});

test('another workspace is never touched: the stranger only reaches their own workspace, and a workspace id in the request is refused',async()=>{
  const h=harness({sheets:[{workspace_id:WS,week_start:WEEK,top_lines:[{text:'주인 장임.',refs:[0]}],groups:[],ai_status:'ok',made_by:'auto'}]});
  const r=await (await post(h.handler,req({mode:'user'}),'stranger-token')).json();
  assert.equal(r.sheet.made_by,'user');
  const mine=h.db.app_journal_next_week_sheets.find(x=>x.workspace_id===WS),theirs=h.db.app_journal_next_week_sheets.find(x=>x.workspace_id===OTHER_WS);
  assert.deepEqual(mine.top_lines,[{text:'주인 장임.',refs:[0]}],'owner row unchanged');
  assert.ok(theirs,'stranger row lives in the stranger workspace');
  for(const body of [req({workspace_id:WS}),req({user_id:OWNER})]){const res=await post(h.handler,body);assert.equal(res.status,400);}
  const anon=await h.handler(new Request(FN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req())}));
  assert.equal(anon.status,401);
});

test('before the DB step the server answers next_week_sheet_not_ready without calling AI; bad requests are refused',async()=>{
  const m=harness({missing:true});
  const r=await post(m.handler,req());
  assert.equal(r.status,503);assert.equal((await r.json()).error,'next_week_sheet_not_ready');assert.equal(m.calls.openai.length,0);
  const h=harness();
  const item=ITEMS[0];
  for(const body of [
    req({week_start:'2026-11-03'}),req({week_start:'2026-11-09'}),req({week_start:'2026-10-26',mode:'auto'}),req({mode:'cron'}),
    req({items:[{...item,calendar:'personal'}]}),req({items:[{...item,group:'events',source_kind:'task'}]}),req({items:[{...item,title:'가\n나'}]}),
    req({items:[{...item,title:'가'.repeat(121)}]}),req({items:[{...item,source_id:'bad id'}]}),req({items:[{...item,day:'11/3'}]}),
    req({items:Array(151).fill(item)}),{kind:'next_week_sheet',week_start:WEEK,mode:'auto'},
  ]){const res=await post(h.handler,body);assert.equal(res.status,400,JSON.stringify(body).slice(0,120));}
  assert.equal(h.calls.openai.length,0);
  // This week's Monday is accepted for [다시 만들기] only.
  assert.equal((await post(h.handler,req({week_start:'2026-10-26',mode:'user'}))).status,200);
});

test('pure helpers: Seoul clock, auto time, AI answer checks',()=>{
  assert.deepEqual(nw.seoulClock(FRI_AFTERNOON),{day:'2026-10-30',isoDow:5,hour:16,nextMonday:WEEK});
  assert.equal(nw.seoulClock(Date.parse('2026-11-01T14:00:00Z')).nextMonday,'2026-11-02','Sunday 23:00 KST');
  assert.equal(nw.seoulClock(Date.parse('2026-11-01T15:30:00Z')).nextMonday,'2026-11-09','Monday 00:30 KST');
  assert.equal(nw.autoTime(FRI_AFTERNOON),true);assert.equal(nw.autoTime(FRI_MORNING),false);assert.equal(nw.autoTime(SAT),true);assert.equal(nw.autoTime(THU),false);
  const sent=new Set([0,1]);
  assert.equal(nw.parseNextWeekSheet('not json',sent),null);
  assert.deepEqual(nw.parseNextWeekSheet(JSON.stringify({lines:[{text:'통화 010-1234-5678',refs:[0]},{text:'가'.repeat(81),refs:[0]},{text:'비밀번호: 가상',refs:[0]},{text:' 회의 준비 필요함. ',refs:[1,1,0]}]}),sent),[{text:'회의 준비 필요함.',refs:[1,0]}]);
  assert.equal(nw.parseNextWeekSheet(JSON.stringify({lines:Array(5).fill({text:'준비 필요함.',refs:[0]})}),sent).length,3);
  assert.equal(nw.nextWeekSheetMaterial(WEEK,[{...ITEMS[0],title:'와이파이 비밀번호: 가상값'}]),'','secret-looking lines are not sent');
});
