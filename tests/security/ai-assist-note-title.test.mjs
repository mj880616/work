import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE-탐색기 ③: the real ai-assist handler, kind=note_title, with a synthetic Supabase (Auth + PostgREST with owner RLS) and a mocked
// OpenAI. No network, no real key, synthetic text only. The screen sends one note id; the server reads the note with the caller's token,
// makes a short title once (never over a title the owner wrote, never for AI-excluded, archived or secret-looking notes), stores it only in
// metadata.ai_title of that row (title column untouched) and counts the call in the monthly AI usage.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const nt=await import('../../supabase/functions/ai-assist/note-title.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW=Date.parse('2026-10-28T03:00:00Z'),AT='2026-10-28T01:00:00.000Z';
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=title=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title})}]}],usage:{input_tokens:400,output_tokens:20}});
const note=(n,extra={})=>({id:id(n),workspace_id:WS,kind:'note',title:'임단투 교섭 준비 메모 정리',raw_text:'임단투 교섭 준비 메모 정리\n3차 교섭 일정과 요구안 초안, 위원 구성 연락처 010-1234-5678',updated_at:AT,metadata:{folder_id:'f1',folder:'회의'},archived_at:null,ai_export_allowed:true,...extra});

function harness({openai=null,usage=[],notes=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_notes:notes||[note(1)],
    app_ai_daily_usage:structuredClone(usage),
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cell=(row,k)=>k.includes('->>')?(row[k.split('->>')[0]]||{})[k.split('->>')[1]]:row[k];
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val:op==='is'?(val==='null'?v==null:String(v)===val):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(cell(row,k),v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer('임단투 3차 교섭 준비'));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(method==='PATCH'&&table==='app_notes'){const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b),['metadata'],'only metadata is written');const hit=rows.filter(r=>visible(table,r,uid)&&matches(r,url));hit.forEach(r=>Object.assign(r,b));return new Response(null,{status:204});}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('owner: one AI call, the short title stored only in metadata.ai_title (other metadata kept, title column untouched), usage counted',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,{kind:'note_title',id:id(1)});
  assert.equal(res.status,200);
  const got=await res.json();
  assert.deepEqual(got,{ok:true,kind:'note_title',id:id(1),title:'임단투 3차 교섭 준비'});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'note_title');assert.equal(o.text.format.strict,true);
  assert.ok(!o.input[1].content.includes('010-1234-5678'),'phone numbers are not sent');
  const n=db.app_notes[0];
  assert.equal(n.title,'임단투 교섭 준비 메모 정리');
  assert.deepEqual(n.metadata,{folder_id:'f1',folder:'회의',ai_title:'임단투 3차 교섭 준비',ai_title_at:new Date(NOW).toISOString()});
  const patch=calls.rest.find(c=>c.method==='PATCH');
  assert.match(patch.query,/updated_at=eq\.2026-10-28T01:00:00\.000Z/);assert.match(patch.query,/metadata->>ai_title=is\.null/);assert.match(patch.query,/kind=eq\.note/);
  assert.equal(db.app_ai_daily_usage[0].requests,1);assert.equal(db.app_ai_daily_usage[0].input_tokens,400);
  assert.ok(!/임단투|교섭/.test(JSON.stringify(calls.logs)),'no note text or title in logs');
  assert.equal(DAILY_LIMITS.note_title,60);
});

for(const [name,extra,reason] of [
  ['an own title (different from the first line)',{title:'내가 쓴 제목'},'own_title'],
  ['an AI title already made',{metadata:{ai_title:'이미 만든 제목'}},'done'],
  ['an AI-excluded note',{ai_export_allowed:false},'not_allowed'],
  ['an archived note',{archived_at:AT},'not_allowed'],
  ['a note marked not for AI',{metadata:{ai_off:true}},'not_allowed'],
  ['a password-looking note',{title:'',raw_text:'와이파이 비밀번호: hunter2-가상\n공유기 설정'},'secret'],
  ['a key-looking note',{title:'',raw_text:'서버 설정 메모 Zx9fK2mQ7pL4vR8tW1yB6nC3dE5gH0jA'},'secret'],
  ['a very short note',{title:'',raw_text:'짧음'},'short'],
])test(`skipped without AI and without usage: ${name}`,async()=>{
  const {handler,calls,db}=harness({notes:[note(1,extra)]});
  const res=await post(handler,{kind:'note_title',id:id(1)});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'note_title',id:id(1),skipped:reason});
  assert.equal(calls.openai.length,0);
  assert.ok(calls.rest.every(c=>c.method==='GET'),'nothing written');
  assert.equal(db.app_ai_daily_usage.length,0);
});

test('a note changed after it was read is not overwritten; another owner\'s note is not found; bad requests are refused',async()=>{
  const {handler,calls,db}=harness({openai:()=>{db.app_notes[0].updated_at='2026-10-28T02:00:00.000Z';return respond(answer('임단투 3차 교섭 준비'));}});
  const res=await post(handler,{kind:'note_title',id:id(1)});
  assert.deepEqual(await res.json(),{ok:true,kind:'note_title',id:id(1),skipped:'changed'});
  assert.equal(db.app_notes[0].metadata.ai_title,undefined);
  assert.equal(db.app_ai_daily_usage[0].requests,1,'the AI call still counts');
  const other=harness();
  const r2=await post(other.handler,{kind:'note_title',id:id(1)},'stranger-token');
  assert.equal(r2.status,404);assert.equal(other.calls.openai.length,0);
  for(const body of [{kind:'note_title'},{kind:'note_title',id:'not-a-uuid'},{kind:'note_title',id:id(1),title:'x'}]){
    const r=await post(other.handler,body);assert.equal(r.status,400);
  }
});

test('the monthly AI limit applies before any call',async()=>{
  const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-27',requests:1,input_tokens:9e9,output_tokens:9e9}]});
  const res=await post(handler,{kind:'note_title',id:id(1)});
  assert.equal(res.status,429);assert.equal((await res.json()).error,'monthly_limit');
  assert.equal(calls.openai.length,0);
});

test('AI answers are checked: multi-line, HTML, too long, phone or secret-looking titles are not stored',async()=>{
  for(const bad of ['가\n나','<b>제목</b>','가'.repeat(31),'연락 010-1234-5678','비밀번호: 가상']){
    assert.equal(nt.parseNoteTitle(JSON.stringify({title:bad})),null,bad);
  }
  assert.equal(nt.parseNoteTitle(JSON.stringify({title:' "Web2 노트 개편." '})),'Web2 노트 개편');
  assert.equal(nt.parseNoteTitle('not json'),null);
  assert.equal(nt.hasOwnTitle('# 가 제목'.replace('# ',''),'# 가 제목\n본문'),false,'a title filled from the first line is not an own title');
  assert.equal(nt.hasOwnTitle('',''),false);
  assert.equal(nt.hasOwnTitle('다른 제목','첫 줄\n본문'),true);
  assert.equal(nt.looksSecret('회의 메모 https://example.test/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),false);
  assert.equal(nt.looksSecret('일정 정리 3차 교섭'),false);
});

// NOTE-비밀메모 서버 쪽: [AI 제외 풀기](metadata.ai_off=false)로 푼 비밀 모양 노트는 AI 제목을 만든다(재료로 본문이 들어간다).
test('NOTE-비밀메모: 풀어 준 비밀 모양 노트는 AI 요청 본문에 들어가고, 풀지 않은 노트는 건너뛴다(기록에 글 없음)',async()=>{
  const text='와이파이 비밀번호 바꾼 날 메모 UNLOCKED_TEXT\n공유기 설정 순서 정리';
  const unlocked=harness({notes:[note(1,{title:'',raw_text:text,metadata:{ai_off:false}})]});
  const res=await post(unlocked.handler,{kind:'note_title',id:id(1)});
  assert.equal(res.status,200);
  assert.equal(unlocked.calls.openai.length,1);
  assert.ok(JSON.stringify(unlocked.calls.openai[0].input).includes('UNLOCKED_TEXT'),'[AI 제외 풀기] 노트는 보낸다');
  const locked=harness({notes:[note(1,{title:'',raw_text:text,metadata:{}})]});
  const r2=await post(locked.handler,{kind:'note_title',id:id(1)});
  assert.equal((await r2.json()).skipped,'secret');
  assert.equal(locked.calls.openai.length,0);
  assert.ok(!JSON.stringify(locked.calls.logs).includes('UNLOCKED_TEXT'),'기록에 글 없음');
});
