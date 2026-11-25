import test from 'node:test';
import assert from 'node:assert/strict';

// FORGET-이미한일빼기(S70-20, 명진 11/25 "텔레그램에서 내가 답변을 했다거나 하면 제안 없애든지").
// 텔레그램 '나한테 온 요청' 뒤 내가 답장(reply_to)했거나, 1:1 방에서 6시간 안에 내 메시지를 보냈으면 '이미 함(저절로, 답장함)'.
// 판정 규칙(replied.ts) 단위 시험 + 지어낸 Supabase·OpenAI로 실제 handler를 돌린다. 네트워크 없음. 이름·글은 지어낸 것이다.
const {askReplied,ASK_REPLY_WINDOW_MS,REPLY_LOOKBACK_MS,AUTO_DONE_REPLIED}=await import('../../supabase/functions/collector-feed/replied.ts');
const {createCollectorFeedHandler,ASK_CANDIDATE_FN,ASK_CANDIDATE_AT_FN,OPEN_ASKS_FN,AUTO_DONE_FN,NAMES_FN,ROOM_DAY_CONTEXT_FN}=await import('../../supabase/functions/collector-feed/handler.ts');

const T0=Date.parse('2026-10-24T00:10:00Z'),H=3600_000;
const ask={ref:'1001',at:T0};
const m=(ref,at,o={})=>({ref,at,self:false,reply_to:null,...o});

test('규칙: 요청 메시지에 내가 답장(reply_to)하면 1:1 방·단체방 모두 답한 것',()=>{
  assert.equal(askReplied(ask,[m('1002',T0+60_000,{self:true,reply_to:'1001'})],false),AUTO_DONE_REPLIED);
  assert.equal(askReplied(ask,[m('1002',T0+60_000,{self:true,reply_to:'1001'})],true),AUTO_DONE_REPLIED);
  // 답장 표시는 이틀 뒤라도(3일 안) 답이다.
  assert.equal(askReplied(ask,[m('1002',T0+2*24*H,{self:true,reply_to:'1001'})],false),AUTO_DONE_REPLIED);
  assert.equal(askReplied(ask,[m('1002',T0+REPLY_LOOKBACK_MS+1,{self:true,reply_to:'1001'})],false),null);
});
test('규칙: 1:1 방은 요청 뒤 6시간 안 내 메시지면 답한 것, 6시간 밖이면 그대로',()=>{
  assert.equal(askReplied(ask,[m('1002',T0+5*H,{self:true})],true),AUTO_DONE_REPLIED);
  assert.equal(askReplied(ask,[m('1002',T0+ASK_REPLY_WINDOW_MS)].map(x=>({...x,self:true})),true),AUTO_DONE_REPLIED);
  assert.equal(askReplied(ask,[m('1002',T0+ASK_REPLY_WINDOW_MS+1,{self:true})],true),null);
});
test('규칙: 단체방에서 답장 표시 없는 내 메시지는 그대로(남에게 한 말일 수 있음)',()=>{
  assert.equal(askReplied(ask,[m('1002',T0+60_000,{self:true})],false),null);
  assert.equal(askReplied(ask,[m('1002',T0+60_000,{self:true,reply_to:'0999'})],false),null);
});
test('규칙: 남이 답한 것·요청보다 앞선 내 메시지·전달한 메시지는 그대로',()=>{
  assert.equal(askReplied(ask,[m('1002',T0+60_000,{reply_to:'1001'})],true),null,'남이 답장');
  assert.equal(askReplied(ask,[m('1000',T0-60_000,{self:true})],true),null,'요청 전 내 메시지');
  assert.equal(askReplied(ask,[m('1002',T0+60_000,{self:true,reply_to:'1001',forwarded:true})],true),null,'전달');
  assert.equal(askReplied(ask,[],true),null);
  assert.equal(askReplied({ref:'x',at:NaN},[m('1002',T0+1,{self:true})],true),null);
});

// ---- handler ----
const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-24T03:00:00Z');
const SECRET='synthetic-collector-feed-secret-0123456789';
const CID='c0000000-0000-4000-8000-000000000001',CID2='c0000000-0000-4000-8000-000000000002';
const respond=(b,status=200)=>new Response(JSON.stringify(b),{status,headers:{'Content-Type':'application/json'}});
const ai=items=>respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({day:{headline:'가상 하루',lines:['가상 줄']},items})}]}],usage:{input_tokens:10,output_tokens:5}});
const item=(ask_me,refs=['m1','m2'])=>({title:'가상 자료 요청',summary:'가상 자료를 보내 달라고 함.',refs,organization:'',project:'',ask_me});
const askOn=(quote='m1')=>({ask:true,to:'me',request:'가상 자료 금요일까지 보내기',quote,due:''});
const NO={ask:false,to:'me',request:'',quote:'',due:''};

function harness({items=[item(askOn())],open=[],selfLabel='B',atMissing=false}={}){
  const calls={rpc:[],logs:[]};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin==='https://api.openai.com')return ai(items);
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace')return respond(WS);
    if(path.startsWith('rpc/')){
      const fn=path.slice(4),args=JSON.parse(init.body);calls.rpc.push({fn,args});
      if(fn===NAMES_FN)return respond(selfLabel?[{label:selfLabel,name:'',is_self:true}]:[]);
      if(fn===ROOM_DAY_CONTEXT_FN)return respond([]);
      if(fn===ASK_CANDIDATE_AT_FN)return atMissing?respond({code:'PGRST202'},404):respond({result:'added'});
      if(fn===ASK_CANDIDATE_FN)return respond({result:'added'});
      if(fn===OPEN_ASKS_FN)return respond({rows:open});
      if(fn===AUTO_DONE_FN)return respond({done:args.p_ids.length});
      return respond({ok:true});
    }
    if(path==='app_workspaces')return respond([{id:WS}]);
    if(path==='app_suborganizations'||path==='app_spaces')return respond([]);
    if(path==='app_feed_items')return method==='GET'?respond([]):new Response(null,{status:201});
    if(path==='app_feed_days'){if(method==='GET')return respond([]);if(method==='POST')return new Response(null,{status:201});return respond([{}]);}
    throw new Error('unexpected '+method+' '+path);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=b=>handler(new Request(`${FN}?action=telegram`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET},body:JSON.stringify(b)}));
  return {send,calls,of:fn=>calls.rpc.filter(c=>c.fn===fn)};
}
// A가 요청(1001), B(나)가 뒤에 메시지. room_key 양수 = 1:1 방, 짧은 음수 = 단체방.
const body=(msgs,o={})=>({day:'2026-10-24',room_key:'12345',room_label:'가상 방',total:msgs.length,messages:msgs,...o});
const A1={ref:'1001',at:'2026-10-24T00:10:00Z',sender:'A',text:'가상 자료 금요일까지 보내 주세요'};

test('같은 묶음: 요청에 내가 답장하면 후보를 이미 함(저절로)으로 넣는다(요청 시각·번호 함께)',async()=>{
  const h=harness();
  const r=await h.send(body([A1,{ref:'1002',at:'2026-10-24T00:15:00Z',sender:'B',text:'네 보낼게요',reply_to:'1001'}],{room_key:'-12345'}));
  assert.equal(r.status,200);
  const [c]=h.of(ASK_CANDIDATE_AT_FN);
  assert.equal(c.args.p_auto_done,'replied');assert.equal(c.args.p_ask_ref,'1001');assert.equal(c.args.p_ask_at,'2026-10-24T00:10:00.000Z');
  assert.equal(h.of(ASK_CANDIDATE_FN).length,0,'새 함수가 있으면 옛 함수는 안 부름');
  assert.match(h.calls.logs.join('\n'),/telegram_ask_saved.*"added":1.*"auto":1/);
});
test('같은 묶음: 1:1 방 요청 뒤 6시간 안 내 메시지 → 이미 함, 남이 답한 것·내 메시지 없음 → 처리 전',async()=>{
  const mine=harness();
  await mine.send(body([A1,{ref:'1002',at:'2026-10-24T01:00:00Z',sender:'B',text:'확인했어요'}]));
  assert.equal(mine.of(ASK_CANDIDATE_AT_FN)[0].args.p_auto_done,'replied');
  const other=harness({selfLabel:'Z'});
  await other.send(body([A1,{ref:'1002',at:'2026-10-24T00:15:00Z',sender:'B',text:'제가 할게요',reply_to:'1001'}]));
  assert.equal(other.of(ASK_CANDIDATE_AT_FN)[0].args.p_auto_done,null,'남이 답장');
  assert.equal(other.of(OPEN_ASKS_FN).length,0,'내 메시지가 없으면 앞 요청을 읽지도 않음');
});
test('같은 묶음: 단체방에서 답장 표시 없는 내 메시지는 처리 전 그대로',async()=>{
  const h=harness();
  await h.send(body([A1,{ref:'1002',at:'2026-10-24T00:15:00Z',sender:'B',text:'다른 이야기'}],{room_key:'-12345'}));
  assert.equal(h.of(ASK_CANDIDATE_AT_FN)[0].args.p_auto_done,null);
});
test('다음 묶음: 앞서 올린 이 방 처리 전 요청 중 내가 답한 것만 이미 함(저절로)으로 옮긴다',async()=>{
  const h=harness({items:[item(NO,['m1'])],open:[
    {id:CID,ask_at:'2026-10-24T00:10:00Z',ask_ref:'0990'},          // 내가 0990에 답장 → 옮김
    {id:CID2,ask_at:'2026-10-24T00:10:00Z',ask_ref:'0991'},         // 단체방, 답장 아님 → 그대로
    {id:'bad',ask_at:'x',ask_ref:'0992'}]});
  await h.send(body([{ref:'1003',at:'2026-10-24T02:00:00Z',sender:'B',text:'보냈습니다',reply_to:'0990'}],{room_key:'-12345'}));
  const [o]=h.of(OPEN_ASKS_FN);assert.deepEqual(o.args,{p_workspace:WS,p_room_key:'-12345'});
  const [d]=h.of(AUTO_DONE_FN);assert.deepEqual(d.args,{p_workspace:WS,p_ids:[CID]});
  assert.match(h.calls.logs.join('\n'),/telegram_auto_done.*"count":1/);
});
test('다음 묶음: 1:1 방은 6시간 안이면 옮기고 6시간 밖이면 그대로',async()=>{
  const h=harness({items:[item(NO,['m1'])],open:[{id:CID,ask_at:'2026-10-23T23:00:00Z',ask_ref:'0990'},{id:CID2,ask_at:'2026-10-23T18:00:00Z',ask_ref:'0991'}]});
  await h.send(body([{ref:'1003',at:'2026-10-24T02:00:00Z',sender:'B',text:'네'}]));
  assert.deepEqual(h.of(AUTO_DONE_FN)[0].args.p_ids,[CID]);
});
test('DB 단계 적용 전(새 함수 404): 옛 함수로 처리 전 넣기, 앞 요청 옮기기는 조용히 건너뜀',async()=>{
  const h=harness({atMissing:true});
  const r=await h.send(body([A1,{ref:'1002',at:'2026-10-24T00:15:00Z',sender:'B',text:'네',reply_to:'1001'}]));
  assert.equal(r.status,200);
  assert.equal(h.of(ASK_CANDIDATE_FN).length,1);
  assert.deepEqual(Object.keys(h.of(ASK_CANDIDATE_FN)[0].args).sort(),['p_due','p_evidence','p_source_ref','p_summary','p_workspace']);
});
test('로그에는 수와 단계 코드만(요청 글·근거·방 번호 없음)',async()=>{
  const h=harness();
  await h.send(body([A1,{ref:'1002',at:'2026-10-24T00:15:00Z',sender:'B',text:'네 보낼게요',reply_to:'1001'}]));
  const logs=h.calls.logs.join('\n');
  for(const secret of ['가상 자료 금요일','네 보낼게요','12345','가상 방'])assert.ok(!logs.includes(secret),secret);
});
