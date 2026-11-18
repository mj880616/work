import test from 'node:test';
import assert from 'node:assert/strict';
// AI-사람별한도(MULTI 단계 ③): 판정 공용 함수(_shared/ai-user-cap.mjs)와 뉴스·사회운동 멈춤 판정(_shared/news-days.ts aiMonthStop).
// 숫자는 DB 함수가 주고(이번 서울 달만 — tests/auth-handoff/ai-user-cap-db.test.mjs), 원 셈·한도 판정은 여기 한 곳이다.
const cap=await import('../../supabase/functions/_shared/ai-user-cap.mjs');
const prices=await import('../../supabase/functions/_shared/ai-prices.mjs');
const {aiMonthStop}=await import('../../supabase/functions/_shared/news-days.ts');
const app=await import('../../app/ai-cap.mjs');
const base={month:'2026-11',exempt:false,cap_krw:3000,openai_input_tokens:0,openai_output_tokens:0,gemini:[]};

test('judge: OpenAI + Gemini won from the one price table; under / at / over the cap; operator exempt',()=>{
  const at={...base,openai_input_tokens:20_000_000,openai_output_tokens:280_000}; // 2,800 + 196 = 2,996원
  assert.deepEqual(cap.judgeAiMonth(at),{month:'2026-11',exempt:false,cap_krw:3000,used_krw:2996,capped:false});
  const g={model:'gemini-3.5-transcribe',input_tokens:10_000,audio_tokens:10_000,output_tokens:0};
  const krwG=prices.geminiKrw(g.model,g.input_tokens,g.audio_tokens,g.output_tokens);
  const over=cap.judgeAiMonth({...at,gemini:[g]});
  assert.equal(over.capped,2996+krwG>=3000);
  assert.equal(cap.judgeAiMonth({...base,openai_input_tokens:30_000_000}).capped,true); // 4,200원
  assert.equal(cap.judgeAiMonth({...base,openai_input_tokens:30_000_000,exempt:true}).capped,false,'operator workspace never capped');
  assert.equal(cap.judgeAiMonth({...base,cap_krw:0}).capped,true,'a cap of 0 stops AI from the first call');
  assert.equal(cap.judgeAiMonth({...base,openai_input_tokens:'12'}).used_krw,0,'tokens as text (bigint) are read');
  assert.equal(cap.AI_USER_CAP_DEFAULT_KRW,3000);
  assert.equal(prices.OPENAI_DEFAULT_IN_KRW,cap.DEFAULT_OPENAI_PRICE.input);
});

test('judge: bad shapes are unknown (null) → callers stay closed (usage_unavailable)',async()=>{
  for(const bad of [null,[],{},{...base,month:'2026-1'},{...base,exempt:'no'},{...base,cap_krw:-1},{...base,cap_krw:1.5},{...base,gemini:null},{...base,gemini:[{}]}])
    assert.equal(cap.judgeAiMonth(bad),null,JSON.stringify(bad));
  assert.deepEqual(await cap.checkAiUserCap(async()=>{throw new Error('down');}),{ok:false,status:503,code:'usage_unavailable',message:'AI 사용 기록을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'});
  const r=await cap.checkAiUserCap(async()=>({...base,openai_input_tokens:30_000_000,cap_krw:12000}));
  assert.deepEqual(r,{ok:true,month:{month:'2026-11',exempt:false,cap_krw:12000,used_krw:4200,capped:false}});
});

test('message: one line with the cap amount; the screen helper recognizes it',async()=>{
  assert.equal(cap.aiCapMessage(),'이번 달 AI 사용 한도(3,000원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.');
  assert.equal(cap.aiCapMessage(12000),'이번 달 AI 사용 한도(12,000원)를 다 썼어요. 다음 달 1일에 다시 쓸 수 있어요.');
  assert.equal(app.AI_CAP_TEXT,cap.aiCapMessage());
  assert.equal(app.aiCapText(cap.aiCapMessage(12000)),cap.aiCapMessage(12000));
  assert.equal(app.aiCapText('<b>x</b>'),app.AI_CAP_TEXT,'only the fixed shape is shown as is');
  for(const x of ['ai_monthly_cap','AI_MONTHLY_CAP',cap.aiCapMessage(5000),{code:'http_429',message:cap.aiCapMessage()},{error:'ai_monthly_cap'}])assert.equal(app.isAiCap(x),true);
  for(const x of ['monthly_limit','',null,{code:'daily_limit'}])assert.equal(app.isAiCap(x),false);
  const r=await cap.checkAiUserCap(async()=>({...base,openai_input_tokens:30_000_000}));
  assert.deepEqual(r,{ok:false,status:429,code:'ai_monthly_cap',message:cap.aiCapMessage()});
});

test('server reader: service role function with the server-verified workspace only; AiCapError carries status·code',async()=>{
  const calls=[];
  const admin=m=>({rpc:async(name,args)=>{calls.push([name,args]);return m;}});
  await cap.assertAiUserCap(admin({data:base,error:null}),'ws-1');
  assert.deepEqual(calls,[['app_workspace_ai_month',{p_workspace:'ws-1'}]]);
  await assert.rejects(cap.assertAiUserCap(admin({data:{...base,openai_input_tokens:30_000_000},error:null}),'ws-1'),e=>e instanceof cap.AiCapError&&e.status===429&&e.code==='ai_monthly_cap');
  await assert.rejects(cap.assertAiUserCap(admin({data:null,error:{code:'42501'}}),'ws-1'),e=>e instanceof cap.AiCapError&&e.status===503&&e.code==='usage_unavailable');
});

test('news·outside: old news month limit first, then the per-person cap; unreadable cap stays closed',async()=>{
  const db=(newsRows,month,fail=false)=>({get:async p=>{
    if(p.startsWith('rpc/app_workspace_ai_month?')){assert.equal(p,'rpc/app_workspace_ai_month?p_workspace=ws-1');if(fail)throw new Error('down');return [month];}
    if(p.startsWith('app_news_days?'))return newsRows;throw new Error('unexpected '+p);},send:async()=>[]});
  const NOW=Date.parse('2026-11-13T03:00:00Z');
  assert.equal(await aiMonthStop(db([],base),'ws-1',NOW),null);
  assert.equal(await aiMonthStop(db([{ai_input_tokens:40_000_000,ai_output_tokens:0}],base),'ws-1',NOW),'MONTHLY_LIMIT');
  assert.equal(await aiMonthStop(db([],{...base,openai_input_tokens:30_000_000}),'ws-1',NOW),'AI_MONTHLY_CAP');
  assert.equal(await aiMonthStop(db([],{...base,openai_input_tokens:30_000_000,exempt:true}),'ws-1',NOW),null);
  assert.equal(await aiMonthStop(db([],base,true),'ws-1',NOW),'USAGE_UNAVAILABLE');
});
