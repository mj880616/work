import test from 'node:test';
import {withAiMonth, AI_MONTH_UNDER} from './helpers/ai-month-fake.mjs';
import assert from 'node:assert/strict';

// SEARCH-비슷한것찾기 ②(S70-67): the real ai-assist handler, kind=find_expand, with a synthetic Supabase (Auth + PostgREST with owner RLS)
// and a mocked OpenAI. No network, no real key, synthetic text only. The screen sends only the typed search text; the server reads no user
// records and sends the AI nothing but that text and today's date, turns the answer into {words, from, to}, saves nothing, and counts the call
// in the AI usage. Over the daily or monthly limit the AI is not called (429), so the screen keeps only the letter-similar results.
const {createAiAssistHandler,DAILY_LIMITS,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const fe=await import('../../supabase/functions/ai-assist/find-expand.ts');
const {AI_ASSIST_KIND_FEATURES}=await import('../../supabase/functions/_shared/ai-features.mjs');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OWNER='b0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-11-25T23:30:00Z'); // 서울 2026-11-26
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const answer=obj=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(obj)}]}],usage:{input_tokens:120,output_tokens:30}});
// 사용자 자료 표(있어도 읽으면 안 됨). 이름·글은 지어낸 것.
const USER_TABLES=['app_notes','app_meetings','app_updates','app_documents','app_diary_entries','app_tasks'];

function harness({openai=null,usage=[],aiMonth=AI_MONTH_UNDER}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'}],app_ai_daily_usage:structuredClone(usage),app_ai_usage_events:[]};
  for(const t of USER_TABLES)db[t]=[{id:'x',workspace_id:WS,title:'가상 비밀 회의 메모',raw_text:'가상 본문'}];
  const cmp=(v,op,val)=>op==='eq'?String(v)===val:op==='gte'?v!=null&&String(v)>=val:op==='lt'?v!=null&&String(v)<val:(()=>{throw new Error('op '+op)})();
  const matches=(row,url)=>{for(const [k,v] of url.searchParams){if(['select','limit','order','on_conflict'].includes(k))continue;const i=v.indexOf('.');if(!cmp(row[k],v.slice(0,i),v.slice(i+1)))return false;}return true;};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(answer({words:['교섭','협의','간담회'],from:'2026-10-01',to:'2026-10-31'}));}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const token=(headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(url.pathname==='/auth/v1/user')return token==='owner-token'?respond({id:OWNER}):respond({msg:'bad'},401);
    assert.equal(token,'owner-token','REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method});
    assert.ok(!USER_TABLES.includes(table),'no user records are read: '+table);
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>matches(r,url)));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    if(method==='POST'&&table==='app_ai_usage_events'){rows.push(JSON.parse(init.body));return respond('',201);}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler(withAiMonth({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})},aiMonth));
  return {handler,calls,db};
}
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));

test('only the typed text and today (Seoul) go to the AI; no user record is read; words and period come back; usage counted',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,{kind:'find_expand',text:'  지난달   교섭 관련 회의 '});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'find_expand',words:['교섭','협의','간담회'],from:'2026-10-01',to:'2026-10-31'});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.text.format.name,'find_expand');assert.equal(o.text.format.strict,true);
  assert.equal(o.input.length,2);
  assert.equal(o.input[0].role,'developer');assert.equal(o.input[0].content,fe.FIND_EXPAND_INSTRUCTIONS,'fixed instructions only');
  assert.deepEqual(JSON.parse(o.input[1].content),{today:'2026-11-26',text:'지난달 교섭 관련 회의'},'nothing but the text and the date');
  assert.ok(!JSON.stringify(o).includes('가상 비밀'),'no user record text in the AI request');
  assert.deepEqual([...new Set(calls.rest.map(c=>c.table))].sort(),['app_ai_daily_usage','app_ai_usage_events','app_workspace_members']);
  assert.equal(db.app_ai_daily_usage[0].requests,1);assert.equal(db.app_ai_daily_usage[0].input_tokens,120);
  assert.equal(db.app_ai_usage_events[0].feature,'other');
  assert.ok(!/교섭|회의|협의/.test(JSON.stringify(calls.logs)),'no search text or words in logs');
  assert.equal(AI_ASSIST_KIND_FEATURES.find_expand,'other');
  assert.ok(DAILY_LIMITS.find_expand>0&&DAILY_LIMITS.find_expand<=DAILY_TOTAL_LIMIT);
});

test('over the daily limit or the monthly limit: no AI call (429), so the screen keeps only the letter-similar results',async()=>{
  const daily=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-11-26',requests:DAILY_TOTAL_LIMIT,input_tokens:1,output_tokens:1}]});
  const r1=await post(daily.handler,{kind:'find_expand',text:'교섭'});
  assert.equal(r1.status,429);assert.equal((await r1.json()).error,'daily_limit');
  assert.equal(daily.calls.openai.length,0);
  const monthly=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-11-20',requests:1,input_tokens:9e9,output_tokens:9e9}]});
  const r2=await post(monthly.handler,{kind:'find_expand',text:'교섭'});
  assert.equal(r2.status,429);assert.equal((await r2.json()).error,'monthly_limit');
  assert.equal(monthly.calls.openai.length,0);
});

test('bad requests are refused before any AI call; signed-out callers get 401',async()=>{
  const {handler,calls}=harness();
  for(const body of [{kind:'find_expand'},{kind:'find_expand',text:''},{kind:'find_expand',text:'가'},{kind:'find_expand',text:'가'.repeat(101)},
    {kind:'find_expand',text:'줄\n바꿈'},{kind:'find_expand',text:'교섭',today:'2026-01-01'},{kind:'find_expand',text:'교섭',items:['가상']},{kind:'find_expand',text:42}]){
    const r=await post(handler,body);assert.equal(r.status,400,JSON.stringify(body));
  }
  const r=await post(handler,{kind:'find_expand',text:'교섭'},'nobody');
  assert.equal(r.status,401);
  assert.equal(calls.openai.length,0);
});

test('AI answers are checked: bad dates drop the period, odd words are dropped, nothing usable comes back empty',async()=>{
  assert.deepEqual(fe.parseFindExpand(JSON.stringify({words:[' "교섭". ','교섭','<b>x</b>','줄\n바꿈','가'.repeat(21),'협의','',7],from:'2026-02-30',to:'2026-03-01'})),{words:['교섭','협의'],from:'',to:''});
  assert.deepEqual(fe.parseFindExpand(JSON.stringify({words:['a'],from:'2026-10-31',to:'2026-10-01'})),{words:['a'],from:'',to:''},'reversed period dropped');
  assert.equal(fe.parseFindExpand(JSON.stringify({words:Array.from({length:20},(_,i)=>'w'+i),from:'',to:''})).words.length,8);
  assert.equal(fe.parseFindExpand(JSON.stringify({words:[],from:'',to:''})),null);
  assert.equal(fe.parseFindExpand('not json'),null);
  const {handler}=harness({openai:()=>respond(answer({words:['<script>'],from:'x',to:''}))});
  const res=await post(handler,{kind:'find_expand',text:'교섭'});
  assert.deepEqual(await res.json(),{ok:true,kind:'find_expand',words:[],from:'',to:''});
});
