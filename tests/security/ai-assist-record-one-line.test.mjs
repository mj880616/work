import test from 'node:test';
import {withAiMonth} from './helpers/ai-month-fake.mjs';
import assert from 'node:assert/strict';

// RECORD-한줄AI요약: the real ai-assist handler, kind=record_one_line, with a synthetic Supabase (Auth + PostgREST with owner RLS
// through the organization's workspace) and a mocked OpenAI. No network, no real key, synthetic text only. The screen sends one
// organization record id; the server reads it with the caller's token, makes a one-line summary only for long text, stores it only
// in one_line of that row while one_line is still empty (raw_text untouched) and counts the call in the monthly AI usage.
const {createAiAssistHandler,DAILY_LIMITS}=await import('../../supabase/functions/ai-assist/handler.ts');
const ol=await import('../../supabase/functions/ai-assist/record-one-line.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const OWNER='b0000000-0000-4000-8000-000000000001',STRANGER='b0000000-0000-4000-8000-000000000002';
const ORG='d0000000-0000-4000-8000-000000000001',OTHER_ORG='d0000000-0000-4000-8000-000000000002';
const id=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NOW=Date.parse('2026-11-10T08:00:00Z');
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=line=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({line})}]}],usage:{input_tokens:600,output_tokens:30}});
const LONG='[합성 공영화 투쟁 경과 공유 및 감사 인사]\n\n안녕하십니까. 합성 지부입니다.\n합성시는 공영화 연구용역을 직접 추진하기로 했고, 내년 공영화를 위해 노력하겠다고 서약했습니다.\n연대해 주신 단사 동지들께 감사드립니다. 문의 010-1234-5678';
const rec=(n,extra={})=>({id:id(n),organization_id:ORG,raw_text:LONG,one_line:null,...extra});

function harness({openai=null,records=null,afterPatch=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'},{workspace_id:OTHER_WS,user_id:STRANGER,role:'owner'}],
    app_suborganizations:[{id:ORG,workspace_id:WS},{id:OTHER_ORG,workspace_id:OTHER_WS}],
    app_suborganization_updates:records||[rec(1)],
    app_ai_daily_usage:[],
  };
  const users={'owner-token':OWNER,'stranger-token':STRANGER},wsOwner={[WS]:OWNER,[OTHER_WS]:STRANGER};
  const orgWs=o=>db.app_suborganizations.find(x=>x.id===o)?.workspace_id;
  const visible=(table,row,uid)=>table==='app_workspace_members'?row.user_id===uid:table==='app_suborganization_updates'?wsOwner[orgWs(row.organization_id)]===uid:table==='app_ai_daily_usage'?row.user_id===uid:wsOwner[row.workspace_id]===uid;
  const cmp=(v,op,val)=>op==='eq'?v!=null&&String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val:op==='is'?(val==='null'?v==null:String(v)===val):(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer('합성시 공영화 연구용역 직접 추진·내년 공영화 노력 서약, 단사 연대 감사'));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=users[(headers.get('Authorization')||'').replace(/^Bearer /,'')];
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search),body:init.body?JSON.parse(init.body):null});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>visible(table,r,uid)&&matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(method==='PATCH'&&table==='app_suborganization_updates'){const b=JSON.parse(init.body);assert.deepEqual(Object.keys(b),['one_line'],'only one_line is written');const hit=rows.filter(r=>visible(table,r,uid)&&matches(r,url));hit.forEach(r=>Object.assign(r,b));afterPatch?.(db);return new Response(null,{status:204});}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler(withAiMonth({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})}));
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('owner: long record → one AI call, the summary stored only in one_line (raw_text untouched), usage counted, no text in logs',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,{kind:'record_one_line',id:id(1)});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'record_one_line',id:id(1),line:'합성시 공영화 연구용역 직접 추진·내년 공영화 노력 서약, 단사 연대 감사'});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'record_one_line');assert.equal(o.text.format.strict,true);
  assert.ok(!o.input[1].content.includes('010-1234-5678'),'phone numbers are not sent');
  assert.equal(db.app_suborganization_updates[0].raw_text,LONG);
  assert.equal(db.app_suborganization_updates[0].one_line,'합성시 공영화 연구용역 직접 추진·내년 공영화 노력 서약, 단사 연대 감사');
  const patch=calls.rest.find(c=>c.method==='PATCH'&&c.table==='app_suborganization_updates');
  assert.match(patch.query,/one_line=is\.null/);assert.match(patch.query,new RegExp(`organization_id=eq\\.${ORG}`));
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/공영화|합성시/.test(JSON.stringify(calls.logs)),'no record text in logs');
  assert.equal(DAILY_LIMITS.record_one_line,120);
});

for(const [name,extra,reason] of [
  ['a short one-line record',{raw_text:'합성 지부 3차 간담회 진행'},'short'],
  ['a record that already has one_line',{one_line:'이미 만든 한 줄'},'done'],
  ['a secret-looking record',{raw_text:`비밀번호 정리\npassword: Synthetic-Pass-1234\n${'합성 글 '.repeat(20)}`},'secret'],
])test(`skipped without AI or usage: ${name}`,async()=>{
  const {handler,calls,db}=harness({records:[rec(1,extra)]});
  const res=await post(handler,{kind:'record_one_line',id:id(1)});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'record_one_line',id:id(1),skipped:reason});
  assert.equal(calls.openai.length,0);assert.equal(db.app_ai_daily_usage.length,0);
  assert.ok(!calls.rest.some(c=>c.method==='PATCH'));
});

test('another workspace record is not found (RLS hides it) and nothing is written',async()=>{
  const {handler,calls}=harness({records:[rec(1,{organization_id:OTHER_ORG})]});
  const res=await post(handler,{kind:'record_one_line',id:id(1)});
  assert.equal(res.status,404);
  assert.equal(calls.openai.length,0);assert.ok(!calls.rest.some(c=>c.method!=='GET'&&c.table!=='app_ai_daily_usage'));
});

test('a bad AI answer (two lines, too long, html, phone) is not stored',async()=>{
  for(const bad of ['첫 줄\n둘째 줄','가'.repeat(81),'<b>합성</b>','합성 연락 010-1234-5678','']){
    const {handler,db}=harness({openai:()=>respond(answer(bad))});
    const res=await post(handler,{kind:'record_one_line',id:id(1)});
    assert.equal(res.status,200);assert.equal((await res.json()).skipped,'no_line');
    assert.equal(db.app_suborganization_updates[0].one_line,null);
  }
});

test('raw text changed between read and write: the stale line is cleared again',async()=>{
  const {handler,db}=harness({afterPatch:d=>{d.app_suborganization_updates[0].raw_text='합성 고친 원문 '.repeat(10);}});
  const res=await post(handler,{kind:'record_one_line',id:id(1)});
  assert.equal((await res.json()).skipped,'changed');
  assert.equal(db.app_suborganization_updates[0].one_line,null);
});

test('request shape: only kind and a uuid id',async()=>{
  const {handler}=harness();
  for(const body of [{kind:'record_one_line'},{kind:'record_one_line',id:'x'},{kind:'record_one_line',id:id(1),raw_text:'x'}])
    assert.equal((await post(handler,body)).status,400);
  assert.equal(ol.needsOneLine('짧은 글'),false);assert.equal(ol.needsOneLine('첫 줄\n둘째 줄'),true);assert.equal(ol.needsOneLine('가'.repeat(61)),true);
});
