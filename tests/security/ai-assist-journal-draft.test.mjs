import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-오늘한줄초안: the real ai-assist handler, kind=journal_draft, with a synthetic Supabase (Auth + PostgREST with owner RLS) and a
// mocked OpenAI. No network, no real key, synthetic text only. The screen sends today's day and the day's material lines (after 18:00 KST);
// the server refuses to call AI when a draft or a work-journal line already exists, stores the draft only in app_journal_drafts (never in
// app_notes) and counts the call in the monthly AI usage.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const jd=await import('../../supabase/functions/ai-assist/journal-draft.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const DAY='2026-10-29',EVENING=Date.parse('2026-10-29T09:30:00Z'),MORNING=Date.parse('2026-10-29T01:00:00Z');
const LINES=['[일정] 10:00 3차 교섭 준비회의','[한 일] 요구안 초안 정리','[업무 통화] 14:20 가상지부 · 교섭 일정 확인 010-1234-5678'];
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=line=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({line})}]}],usage:{input_tokens:500,output_tokens:40}});
const DRAFT='3차 교섭 준비회의 진행함. 요구안 초안 정리함. 가상지부와 통화해 교섭 일정 확인함.';

function harness({openai=null,usage=[],drafts=[],work=[],now=EVENING,missing=false}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_notes:structuredClone(work),
    app_journal_drafts:structuredClone(drafts),
    app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val:op==='is'?(val==='null'?v==null:String(v)===val):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer(DRAFT));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),prefer:headers.get('Prefer'),body:init.body?JSON.parse(init.body):null});
    if(missing&&table==='app_journal_drafts')return respond({code:'PGRST205'},404);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(method==='POST'&&table==='app_journal_drafts'){
      const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b).sort(),['draft_text','journal_day','workspace_id'],'only the three insert columns');
      assert.ok(visible(table,b,uid),'owner RLS');
      if(!rows.some(r=>r.workspace_id===b.workspace_id&&r.journal_day===b.journal_day))rows.push(b);
      return respond('',201);
    }
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>now,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('evening, no line yet: one AI call, the draft stored only in app_journal_drafts, usage counted, no text in logs',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,{kind:'journal_draft',day:DAY,lines:LINES});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'journal_draft',day:DAY,draft:DRAFT});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'journal_draft');assert.equal(o.text.format.strict,true);
  assert.ok(o.input[0].content.includes("'~함.'·'~임.'"),'the house tone (shared AI_TONE_RULE)');
  assert.ok(!o.input[1].content.includes('010-1234-5678'),'phone numbers are not sent');
  assert.match(o.input[1].content,/가상지부/);
  assert.deepEqual(db.app_journal_drafts,[{workspace_id:WS,journal_day:DAY,draft_text:DRAFT}]);
  assert.equal(db.app_notes.length,0,'no work-journal line is written');
  const insert=calls.rest.find(c=>c.method==='POST'&&c.table==='app_journal_drafts');
  assert.match(insert.prefer,/resolution=ignore-duplicates/);
  assert.equal(db.app_ai_daily_usage[0].requests,1);assert.equal(db.app_ai_daily_usage[0].input_tokens,500);
  assert.ok(!/교섭|가상지부/.test(JSON.stringify(calls.logs)),'no material or draft in logs');
  assert.equal(DAILY_LIMITS.journal_draft,3);
});

for(const [name,opts,body,reason,draft] of [
  ['a draft already made today',{drafts:[{workspace_id:WS,journal_day:DAY,draft_text:'이미 만든 초안임.'}]},{},'done','이미 만든 초안임.'],
  ['a line already written today',{work:[{id:'n1',workspace_id:WS,kind:'work',journal_day:DAY,raw_text:'직접 쓴 한 줄'}]},{},'has_line',null],
  ['before 18:00 KST',{now:MORNING},{},'not_evening',null],
  ['another day than today',{},{day:'2026-10-28'},'not_today',null],
  ['only secret-looking material',{},{lines:['와이파이 비밀번호: 가상값']},'no_material',null],
])test(`skipped without AI and without usage: ${name}`,async()=>{
  const {handler,calls,db}=harness(opts);
  const res=await post(handler,{kind:'journal_draft',day:DAY,lines:LINES,...body});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'journal_draft',day:body.day||DAY,draft,skipped:reason});
  assert.equal(calls.openai.length,0);
  assert.ok(calls.rest.every(c=>c.method==='GET'),'nothing written');
  assert.equal(db.app_ai_daily_usage.length,0);
});

test('another owner\'s draft and line are not seen (owner RLS); a draft made meanwhile on another device is kept',async()=>{
  // The stranger's rows are invisible to the owner, so the owner still gets a draft of their own.
  const h=harness({drafts:[{workspace_id:OTHER_WS,journal_day:DAY,draft_text:'남의 초안임.'}],work:[{id:'n9',workspace_id:OTHER_WS,kind:'work',journal_day:DAY,raw_text:'남의 줄'}]});
  const r=await post(h.handler,{kind:'journal_draft',day:DAY,lines:LINES});
  assert.equal((await r.json()).draft,DRAFT);
  // Another device inserts first while the AI is answering: the insert is ignored and that draft is returned.
  const raced=harness({openai:()=>{raced.db.app_journal_drafts.push({workspace_id:WS,journal_day:DAY,draft_text:'다른 기기 초안임.'});return respond(answer(DRAFT));}});
  const r2=await post(raced.handler,{kind:'journal_draft',day:DAY,lines:LINES});
  assert.equal((await r2.json()).draft,'다른 기기 초안임.');
  assert.equal(raced.db.app_journal_drafts.length,1);
});

test('before the DB step the server answers journal_draft_not_ready without calling AI; bad requests are refused',async()=>{
  const m=harness({missing:true});
  const r=await post(m.handler,{kind:'journal_draft',day:DAY,lines:LINES});
  assert.equal(r.status,503);assert.equal((await r.json()).error,'journal_draft_not_ready');assert.equal(m.calls.openai.length,0);
  const h=harness();
  for(const body of [
    {kind:'journal_draft',day:DAY},{kind:'journal_draft',day:'10/29',lines:LINES},{kind:'journal_draft',day:DAY,lines:[]},
    {kind:'journal_draft',day:DAY,lines:['가\n나']},{kind:'journal_draft',day:DAY,lines:[' 앞 공백']},{kind:'journal_draft',day:DAY,lines:['가'.repeat(161)]},
    {kind:'journal_draft',day:DAY,lines:Array(61).fill('줄')},{kind:'journal_draft',day:DAY,lines:LINES,workspace_id:WS},
  ]){const res=await post(h.handler,body);assert.equal(res.status,400,JSON.stringify(body).slice(0,80));}
  assert.equal(h.calls.openai.length,0);
});

test('the monthly AI limit applies before any call',async()=>{
  const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-27',requests:1,input_tokens:9e9,output_tokens:9e9}]});
  const res=await post(handler,{kind:'journal_draft',day:DAY,lines:LINES});
  assert.equal(res.status,429);assert.equal((await res.json()).error,'monthly_limit');
  assert.equal(calls.openai.length,0);
});

test('AI answers are checked: multi-line, HTML, too long, phone or secret-looking drafts are not stored',async()=>{
  for(const bad of ['가함.\n나함.','<b>회의함</b>','가'.repeat(201),'통화함 010-1234-5678','비밀번호: 가상','']){
    assert.equal(jd.parseJournalDraft(JSON.stringify({line:bad})),null,bad);
  }
  assert.equal(jd.parseJournalDraft(JSON.stringify({line:' "회의 진행함.  자료 정리함." '})),'회의 진행함. 자료 정리함.');
  assert.equal(jd.parseJournalDraft('not json'),null);
  const {handler,db}=harness({openai:()=>respond(answer('<script>x</script>'))});
  const res=await post(handler,{kind:'journal_draft',day:DAY,lines:LINES});
  assert.deepEqual(await res.json(),{ok:true,kind:'journal_draft',day:DAY,draft:null,skipped:'no_draft'});
  assert.equal(db.app_journal_drafts.length,0);
  assert.equal(jd.seoulHour(EVENING),18);assert.equal(jd.seoulHour(MORNING),10);
});
