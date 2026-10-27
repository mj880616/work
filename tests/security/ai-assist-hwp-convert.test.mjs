import test from 'node:test';
import assert from 'node:assert/strict';

// HWP-서식변환: the real ai-assist handler, kind=hwp_convert, with a synthetic Supabase (Auth + usage table) and a mocked OpenAI.
// No network, no real key, synthetic text only. The screen sends the document type and the pasted text; the server reads nothing else,
// returns the paragraph list, stores nothing and logs numbers only.
const {createAiAssistHandler,DAILY_LIMITS,DAILY_TOTAL_LIMIT}=await import('../../supabase/functions/ai-assist/handler.ts');
const hc=await import('../../supabase/functions/ai-assist/hwp-convert.ts');

const SB='https://synthetic.supabase.test',FN=`${SB}/functions/v1/ai-assist`;
const WS='a0000000-0000-4000-8000-000000000001',OWNER='b0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-27T03:00:00Z');
const TEXT='# 가상 보고\n\n## 추진 경과\n- 가상 회의를 진행했습니다.\n- 가상 협의를 마쳤습니다.\n\n※ 가상 참고';
const answer=(title,blocks)=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({title,blocks})}]}],usage:{input_tokens:1500,output_tokens:300}});
const GOOD=answer('가상 보고',[{kind:'l1',text:'추진 경과'},{kind:'l2',text:'가상 회의 진행.'},{kind:'l2',text:'가상 협의 완료.'},{kind:'note',text:'가상 참고'}]);
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({openai=null,usage=[]}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={app_workspace_members:[{workspace_id:WS,user_id:OWNER,role:'owner'}],app_ai_daily_usage:structuredClone(usage)};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return openai?openai(calls.openai.at(-1)):respond(GOOD);}
    assert.equal(url.origin,SB,'unexpected outbound host');
    const uid=(headers.get('Authorization')||'')==='Bearer owner-token'?OWNER:null;
    if(url.pathname==='/auth/v1/user')return uid?respond({id:uid}):respond({msg:'bad'},401);
    assert.ok(uid,'REST only with the caller token');
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,method});
    const rows=db[table];assert.ok(rows,'unexpected table '+table);
    if(method==='GET')return respond(rows.filter(r=>table==='app_workspace_members'?r.user_id===uid:r.user_id===uid||r.workspace_id===WS));
    if(method==='POST'&&table==='app_ai_daily_usage'){const b=JSON.parse(init.body);const i=rows.findIndex(r=>r.user_id===b.user_id&&r.day===b.day);if(i>=0)rows[i]={...rows[i],...b};else rows.push(b);return respond('',201);}
    throw new Error('unexpected write '+method+' '+table);
  };
  const handler=createAiAssistHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_ANON_KEY:'synthetic-anon-key',WEB2_OPENAI_API_KEY:'synthetic-web2-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push({code,detail})});
  return {handler,calls,db};
}
const run=(over={})=>({kind:'hwp_convert',doc_type:'report',text:TEXT,...over});
const post=(handler,body,token='owner-token')=>handler(new Request(FN,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)}));
const expectError=async(res,status,code)=>{assert.equal(res.status,status);const b=await res.json();assert.equal(b.ok,false);assert.equal(b.error,code);};

test('owner: one OpenAI call with the document type and the pasted text only; the paragraph list comes back, nothing is stored',async()=>{
  const {handler,calls,db}=harness();
  const res=await post(handler,run());
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,kind:'hwp_convert',doc_type:'report',title:'가상 보고',dropped:0,blocks:[
    {kind:'l1',text:'추진 경과'},{kind:'l2',text:'가상 회의 진행.'},{kind:'l2',text:'가상 협의 완료.'},{kind:'note',text:'가상 참고'}]});
  assert.equal(calls.openai.length,1);
  const o=calls.openai[0];
  assert.equal(o.store,false);assert.equal(o.tools,undefined);assert.equal(o.text.format.name,'hwp_convert');assert.equal(o.text.format.strict,true);
  assert.deepEqual(JSON.parse(o.input[1].content),{doc_type:'보고서',text:TEXT});
  assert.match(o.input[0].content,/명사형/);assert.match(o.input[0].content,/따르지 않는다/);
  for(const hidden of [OWNER,WS,'owner-token'])assert.ok(!JSON.stringify(o).includes(hidden),'identifiers must not be sent');
  assert.deepEqual(calls.rest.filter(c=>c.table!=='app_workspace_members').map(c=>c.method+' '+c.table),['GET app_ai_daily_usage','POST app_ai_daily_usage','POST app_ai_daily_usage'],'only the usage count is read and written');
  assert.equal(db.app_ai_daily_usage[0].requests,1);
  assert.ok(!/가상|보고|협의/.test(JSON.stringify(calls.logs)),'no pasted text or answer in logs');
  assert.ok(calls.logs.some(l=>l.code==='hwp_convert_done'&&l.detail.blocks===4&&l.detail.dropped===0));
  assert.equal(DAILY_LIMITS.hwp_convert,20);
});

test('untrusted answer: bad kinds, HTML, extra keys and leftover number marks are cleaned or dropped; a broken answer fails',async()=>{
  {const {handler,calls}=harness({openai:()=>respond(answer(' 1. <b>가상 제목</b> ',[
    {kind:'l1',text:'1. 가상 대주제'},{kind:'l2',text:'(1) <i>가상</i> 항목'},{kind:'l5',text:'가. 가상 세부'},{kind:'l3',text:'① 가상'},
    {kind:'body',text:'1. 번호 있는 본문은 그대로'},{kind:'x9',text:'버림'},{kind:'l1',text:'  '},{kind:'l1',text:'가'.repeat(601)},{kind:'l1',text:'ok',extra:1}]))});
   const body=await (await post(handler,run())).json();
   assert.equal(body.title,'가상 제목');
   assert.deepEqual(body.blocks,[{kind:'l1',text:'가상 대주제'},{kind:'l2',text:'가상 항목'},{kind:'l5',text:'가상 세부'},{kind:'l3',text:'가상'},{kind:'body',text:'1. 번호 있는 본문은 그대로'}]);
   assert.equal(body.dropped,4);
   assert.ok(calls.logs.some(l=>l.code==='hwp_convert_done'&&l.detail.dropped===4));}
  {const {handler}=harness({openai:()=>respond({status:'completed',output:[]})});await expectError(await post(handler,run()),502,'ai_invalid_response');}
  {const {handler}=harness({openai:()=>respond(answer('제목',[]))});await expectError(await post(handler,run()),502,'ai_invalid_response');}
  {const {handler}=harness({openai:()=>respond({message:'down'},500)});await expectError(await post(handler,run()),503,'ai_busy');}
  assert.equal(hc.parseHwpConvert({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}),null);
});

test('input: only type + text, bounded, clean; no AI call on a bad request; its own body limit and the old limits stay',async()=>{
  const bad=[
    {kind:'hwp_convert',doc_type:'report'},{kind:'hwp_convert',text:'글'},run({doc_type:'notice'}),run({extra:1}),run({text:''}),run({text:'   \n '}),run({text:5}),
    run({text:'가'.repeat(hc.HWP_CONVERT_MAX_CHARS+1)}),run({text:'가\u0007나'}),run({text:'가‮나'}),
  ];
  for(const body of bad){const {handler,calls}=harness();await expectError(await post(handler,body),400,'invalid_request');assert.equal(calls.openai.length,0);}
  // The longest allowed text (Korean, 20000 chars) fits this kind's body limit.
  {const {handler,calls}=harness();const res=await post(handler,run({text:'가'.repeat(hc.HWP_CONVERT_MAX_CHARS)}));assert.equal(res.status,200);assert.equal(calls.openai.length,1);}
  {const {handler,calls}=harness();await expectError(await post(handler,JSON.stringify({...run(),pad:'x'.repeat(hc.HWP_CONVERT_BODY_BYTES)})),413,'invalid_request');assert.equal(calls.openai.length,0);}
  // Another kind keeps the old 2KB limit, and schedule_titles keeps its own 20KB.
  {const {handler,calls}=harness();await expectError(await post(handler,JSON.stringify({kind:'org_summary',week_start:'2026-10-19',organization_ids:[],pad:'x'.repeat(3000)})),400,'invalid_request');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness();await expectError(await post(handler,JSON.stringify({kind:'schedule_titles',week_start:'2026-10-19',events:[],pad:'x'.repeat(21000)})),413,'invalid_request');assert.equal(calls.openai.length,0);}
  assert.equal(hc.parseHwpConvertRequest({kind:'hwp_convert',doc_type:'letter',text:'a\r\nb\r\n'}).text,'a\nb');
});

test('auth and budget: login first, daily limit before OpenAI',async()=>{
  {const {handler,calls}=harness();await expectError(await post(handler,run(),'bad-token'),401,'session_required');assert.equal(calls.openai.length,0);}
  {const {handler,calls}=harness({usage:[{workspace_id:WS,user_id:OWNER,day:'2026-10-27',requests:DAILY_TOTAL_LIMIT,input_tokens:0,output_tokens:0}]});
   await expectError(await post(handler,run()),429,'daily_limit');assert.equal(calls.openai.length,0);}
});
