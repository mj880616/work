import test from 'node:test';
import assert from 'node:assert/strict';

// S48-3b: ① work_scope 가 사람이 [주간 정리] '한 줄'에서 뺀 줄(그 주 draft.picks work_line drop)을 AI 답과 상관없이 뺄 줄에 더하고,
// 그 줄은 AI에 보내지 않으며, 앞 주들에 뺀 줄은 personal_examples 로 준다(학습). picks 를 읽지 못해도 가르기는 그대로.
// ② weekly_review 개선 제안은 두 줄(gain·how), ③ weekly_draft 지시문은 기록 날짜·상태 표시를 읽는다. 가짜 서버·가짜 글만.
const {createAiAssistHandler}=await import('../../supabase/functions/ai-assist/handler.ts');
const scope=await import('../../supabase/functions/ai-assist/work-scope.ts');
const learn=await import('../../supabase/functions/ai-assist/weekly-learn.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OWNER='b0000000-0000-4000-8000-000000000001';
const MON='2026-10-26',NOW=Date.parse('2026-10-30T09:30:00Z');
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const note=(id,day,raw_text)=>({id,workspace_id:WS,kind:'work',journal_day:day,raw_text,title:null,metadata:{},archived_at:null,ai_export_allowed:true});
const pick=(day,text,act='drop')=>({key:`work_line|notes:lines:${day}|${text}`,kind:'work_line',from:'record',cell:`notes:lines:${day}`,org:'',act,text,at:'2026-10-29T01:00:00.000Z'});
const wrap=obj=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(obj)}]}]});
const ALLWORK=body=>{const lines=JSON.parse(body.input[1].content).lines;return respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:lines.map(l=>({ref:l.ref,scope:'work'}))})}]}],usage:{input_tokens:10,output_tokens:5}});};

function harness({weeks=[],weeksFail=false}={}){
  const calls={openai:[],rest:[],logs:[]};
  const notes=[note('n1','2026-10-26','가상지부 교섭 준비\n가상 동호회 모임'),note('n2','2026-10-28','가상 성명 초안')];
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin==='https://api.openai.com'){const body=JSON.parse(init.body);calls.openai.push(body);return ALLWORK(body);}
    assert.equal(url.origin,SB);
    if(url.pathname==='/auth/v1/user')return respond({id:OWNER});
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method,query:decodeURIComponent(url.search)});
    if(table==='app_workspace_members')return respond([{workspace_id:WS,user_id:OWNER,role:'owner'}]);
    if(table==='app_notes')return respond(notes);
    if(table==='app_ai_daily_usage')return method==='GET'?respond([]):respond('',201);
    if(table==='app_weekly_exec_requests'){assert.equal(method,'GET');if(weeksFail)return respond({message:'x'},500);return respond(weeks);}
    throw new Error('unexpected '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls};
}
const post=(handler,body)=>handler(new Request(FN,{method:'POST',headers:{Authorization:'Bearer owner-token','Content-Type':'application/json'},body:JSON.stringify(body)}));

test('work_scope: 이번 주 [빼기]한 줄은 AI에 안 보내고 뺄 줄에, 되돌린 줄(none)은 그대로, 앞 주 뺀 줄은 personal_examples',async()=>{
  const weeks=[{week_start:MON,picks:{items:[pick('2026-10-26','가상 동호회 모임'),pick('2026-10-28','가상 성명 초안','none')]}},
    {week_start:'2026-10-19',picks:{items:[pick('2026-10-20','가상 수영 강습'),pick('2026-10-21','가상 다른 줄','none'),{...pick('2026-10-22','가상 칸 아님'),cell:'summary:1'}]}}];
  const {handler,calls}=harness({weeks});
  const body=await (await post(handler,{kind:'work_scope',week_start:MON})).json();
  assert.deepEqual(body.drop,[{day:'2026-10-26',text:'가상 동호회 모임'}]);
  const sent=JSON.parse(calls.openai[0].input[1].content);
  assert.deepEqual(sent.lines.map(l=>l.text),['가상지부 교섭 준비','가상 성명 초안']);
  assert.deepEqual(sent.personal_examples,['가상 수영 강습']);
  assert.match(calls.openai[0].input[0].content,/personal_examples/);
  const read=calls.rest.find(c=>c.table==='app_weekly_exec_requests');
  assert.match(read.query,/week_start=lte\.2026-10-26/);assert.match(read.query,/workspace_id=eq\./);
  assert.ok(!/동호회|수영|성명/.test(JSON.stringify(calls.logs)),'no text in logs');
});

test('work_scope: picks 를 읽지 못해도 가르기는 그대로(예 없이)',async()=>{
  const {handler,calls}=harness({weeksFail:true});
  const res=await post(handler,{kind:'work_scope',week_start:MON});
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).drop,[]);
  assert.equal(JSON.parse(calls.openai[0].input[1].content).personal_examples,undefined);
});

test('userLineDrops·withUserDrops: 칸 모양·종류만, 100자로 잘린 기록 글은 앞부분으로 맞춤',()=>{
  const long='가'.repeat(150);
  const r=scope.userLineDrops([{week_start:MON,picks:{items:[pick('2026-10-27',long.slice(0,100)),{...pick('2026-10-27','x'),kind:'line'}]}}],MON);
  assert.equal(r.thisWeek.length,1);
  assert.deepEqual(scope.withUserDrops([],[{day:'2026-10-27',text:long},{day:'2026-10-28',text:long}],r.thisWeek),[{day:'2026-10-27',text:long}]);
  assert.deepEqual(scope.userLineDrops('nope',MON),{thisWeek:[],examples:[]});
});

test('weekly_review 개선 제안 두 줄(gain·how) — 지시문·스키마·정리',()=>{
  const sch=learn.WEEKLY_REVIEW_SCHEMA.properties.suggestions.items;
  assert.deepEqual(sch.required,['area','gain','how']);
  assert.match(learn.WEEKLY_REVIEW_INSTRUCTIONS,/무엇이 좋아지나/);assert.match(learn.WEEKLY_REVIEW_INSTRUCTIONS,/개발 용어를 쓰지 않는다/);
  const r=learn.parseWeeklyReview(wrap({candidates:[],suggestions:[{area:'material',gain:'끝난 일을 또 쓰는 일이 줄어요',how:'AI에게 기록마다 날짜와 예정/끝남을 같이 주기'},{area:'flow',gain:'가'.repeat(81),how:'x'}]}));
  assert.ok(r,'answer parsed');
  assert.deepEqual(r.suggestions,[{area:'material',text:'끝난 일을 또 쓰는 일이 줄어요',how:'AI에게 기록마다 날짜와 예정/끝남을 같이 주기'}]);
  assert.deepEqual(learn.reviewSuggestions(r.suggestions),[{id:'s1',area:'material',text:'끝난 일을 또 쓰는 일이 줄어요',how:'AI에게 기록마다 날짜와 예정/끝남을 같이 주기'}]);
});

test('weekly_draft 지시문: 기록 날짜·[끝남]/[오늘]/[예정] 표시를 읽고 끝난 일은 의미·후속 결과가 있을 때만',()=>{
  assert.match(learn.WEEKLY_DRAFT_INSTRUCTIONS,/\[끝남\]/);assert.match(learn.WEEKLY_DRAFT_INSTRUCTIONS,/후속 결과/);assert.match(learn.WEEKLY_DRAFT_INSTRUCTIONS,/표시 자체는 줄에 옮기지 않는다/);
});
