import test from 'node:test';
import assert from 'node:assert/strict';

// FORGET-이미한일빼기(S70-20, 사용자 11/25 "텔레그램에서 내가 답변을 했다거나 하면 제안 없애든지").
// 텔레그램 '나한테 온 요청' 뒤 내가 답장(reply_to)했거나, 1:1 방에서 6시간 안에 내 메시지를 보냈으면 '이미 함(저절로, 답장함)'.
// 판정 규칙(replied.ts) 단위 시험 + 지어낸 Supabase·OpenAI로 실제 handler를 돌린다. 네트워크 없음. 이름·글은 지어낸 것이다.
const {askReplied,askDirect,messagedAfter,ASK_REPLY_WINDOW_MS,REPLY_LOOKBACK_MS,AUTO_DONE_REPLIED}=await import('../../supabase/functions/collector-feed/replied.ts');
const {createCollectorFeedHandler,ASK_CANDIDATE_FN,ASK_CANDIDATE_AT_FN,ASK_CANDIDATE_DIRECT_FN,OPEN_ASKS_FN,OPEN_ASKS_PEER_FN,AUTO_DONE_FN,NAMES_FN,ROOM_DAY_CONTEXT_FN}=await import('../../supabase/functions/collector-feed/handler.ts');

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

// direct: '직접 부름' 판(20261125160000)이 있는가. 기본은 적용 전(404) — 이 파일의 앞 시험은 20261125120000 모양을 본다.
function harness({items=[item(askOn())],open=[],fromRows=null,selfLabel='B',selfName='',atMissing=false,direct=false}={}){
  const calls={rpc:[],logs:[]};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin==='https://api.openai.com')return ai(items);
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace')return respond(WS);
    if(path.startsWith('rpc/')){
      const fn=path.slice(4),args=JSON.parse(init.body);calls.rpc.push({fn,args});
      if(fn===NAMES_FN)return respond(selfLabel?[{label:selfLabel,name:selfName,is_self:true}]:[]);
      if(fn===ASK_CANDIDATE_DIRECT_FN)return direct?respond({result:'added'}):respond({code:'PGRST202'},404);
      if(fn===ROOM_DAY_CONTEXT_FN)return respond([]);
      if(fn===ASK_CANDIDATE_AT_FN)return atMissing?respond({code:'PGRST202'},404):respond({result:'added'});
      if(fn===ASK_CANDIDATE_FN)return respond({result:'added'});
      if(fn===OPEN_ASKS_FN)return respond({rows:open});
      if(fn===OPEN_ASKS_PEER_FN)return fromRows?respond({rows:fromRows}):respond({code:'PGRST202'},404);
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

// ── FORGET-기본이미함(S70-20b) ③ 직접 부름: 1:1 방·내 메시지에 단 답장·내 이름을 부른 요청은 ★(하루 지나도 저절로 옮기지 않음) ──
test('규칙: 직접 부름 = 1:1 방 / 내 메시지에 단 답장 / 내 이름(2자 이상)을 부름, 아니면 아님',()=>{
  const me={ref:'0900',self:true,reply_to:null,text:'자료 있나요'},q=(o={})=>({ref:'1001',self:false,reply_to:null,text:'다들 금요일까지 내 주세요',...o});
  assert.equal(askDirect(q(),[me],true),true,'1:1 방');
  assert.equal(askDirect(q({reply_to:'0900'}),[me],false),true,'내 메시지에 답장');
  assert.equal(askDirect(q({reply_to:'0901'}),[me],false),false,'남의 메시지에 답장');
  assert.equal(askDirect(q({text:'가나다 님 금요일까지 부탁해요'}),[me],false,['가나다']),true,'내 이름');
  assert.equal(askDirect(q({text:'@가나다 확인 부탁'}),[me],false,['가나다']),true,'@내 이름');
  assert.equal(askDirect(q({text:'가 님 부탁'}),[me],false,['가']),false,'한 글자 이름은 쓰지 않음');
  assert.equal(askDirect(q(),[me],false,['가나다']),false,'단체방 전체 부탁');
});
test('넣기: 직접 부름 판이 있으면 그 판 하나로 p_direct와 함께 넣는다(옛 두 판은 안 부름)',async()=>{
  const h=harness({direct:true});
  await h.send(body([A1]));
  const [c]=h.of(ASK_CANDIDATE_DIRECT_FN);
  assert.equal(c.args.p_direct,true,'1:1 방');assert.equal(c.args.p_ask_ref,'1001');assert.equal(c.args.p_auto_done,null);
  assert.equal(h.of(ASK_CANDIDATE_AT_FN).length+h.of(ASK_CANDIDATE_FN).length,0);
  const g=harness({direct:true});
  await g.send(body([A1],{room_key:'-12345'}));
  assert.equal(g.of(ASK_CANDIDATE_DIRECT_FN)[0].args.p_direct,false,'단체방·이름 없음');
  const n=harness({direct:true,selfName:'가나다'});
  await n.send(body([{...A1,text:'가나다 님 자료 금요일까지 보내 주세요'}],{room_key:'-12345'}));
  assert.equal(n.of(ASK_CANDIDATE_DIRECT_FN)[0].args.p_direct,true,'단체방이라도 내 이름을 부름');
  assert.ok(!n.calls.logs.join('\n').includes('가나다'),'이름은 로그에 없음');
});
test('넣기: 직접 부름 판이 아직 없으면(404) 요청 시각 판으로 한 번만 물러난다',async()=>{
  const h=harness({items:[item(askOn()),item(askOn(),['m1'])]});
  await h.send(body([A1]));
  assert.equal(h.of(ASK_CANDIDATE_DIRECT_FN).length,1,'한 번 없으면 다시 묻지 않음');
  assert.equal(h.of(ASK_CANDIDATE_AT_FN).length,2);
  assert.ok(!('p_direct' in h.of(ASK_CANDIDATE_AT_FN)[0].args));
});

// ── ② 흔적 넓히기(다른 방 답): 단체방에서 그 사람이 한 요청 뒤 그 사람과의 1:1 방에 내 메시지 → 이미 함(답장함) ──
const KA='a1b2c3d4e5f60718',KB='0f1e2d3c4b5a6978'; // 지어낸 이름표 열쇠(해시 모양)
test('규칙: 요청 뒤 3일 안 내 메시지(전달 아님)면 다른 방 답',()=>{
  assert.equal(messagedAfter(T0,[m('2',T0+H,{self:true})]),true);
  assert.equal(messagedAfter(T0,[m('2',T0-H,{self:true})]),false,'요청보다 앞');
  assert.equal(messagedAfter(T0,[m('2',T0+H,{self:true,forwarded:true})]),false,'전달');
  assert.equal(messagedAfter(T0,[m('2',T0+H)]),false,'상대 메시지');
  assert.equal(messagedAfter(T0,[m('2',T0+REPLY_LOOKBACK_MS+1,{self:true})]),false,'3일 밖');
});
test('넣기: 부탁한 사람의 이름표 열쇠를 p_from으로(내 요청·열쇠 없는 사람은 null)',async()=>{
  const h=harness({direct:true});
  await h.send(body([A1],{room_key:'-12345',senders:[{label:'A',key:KA},{label:'B',key:KB,self:true}]}));
  assert.equal(h.of(ASK_CANDIDATE_DIRECT_FN)[0].args.p_from,KA);
  const n=harness({direct:true});
  await n.send(body([A1],{room_key:'-12345'}));
  assert.equal(n.of(ASK_CANDIDATE_DIRECT_FN)[0].args.p_from,null);
});
test('1:1 방에 내 메시지: 그 상대가 다른 방에서 한 요청 중 내 메시지보다 앞선 것만 이미 함, 로그에 열쇠·글 없음',async()=>{
  const h=harness({items:[item(NO,['m1'])],fromRows:[{id:CID,ask_at:'2026-10-24T00:10:00Z'},{id:CID2,ask_at:'2026-10-24T03:00:00Z'},{id:'bad',ask_at:'x'}]});
  await h.send(body([{ref:'2002',at:'2026-10-24T02:05:00Z',sender:'B',text:'보냈어요'}]));
  const [o]=h.of(OPEN_ASKS_PEER_FN);assert.deepEqual(o.args,{p_workspace:WS,p_room_key:'12345'});
  assert.deepEqual(h.of(AUTO_DONE_FN).at(-1).args,{p_workspace:WS,p_ids:[CID]},'내 메시지(02:05) 뒤 요청(03:00)은 그대로');
  const logs=h.calls.logs.join('\n');assert.match(logs,/telegram_auto_done_other_room.*"count":1/);
  for(const v of ['12345','보냈어요'])assert.ok(!logs.includes(v),v);
});
test('다른 방 답은 1:1 방·내 메시지일 때만, 함수가 없으면(404) 조용히 건너뜀',async()=>{
  const rows=[{id:CID,ask_at:'2026-10-24T00:10:00Z'}],msgs=[{ref:'2002',at:'2026-10-24T02:05:00Z',sender:'B',text:'네'}];
  const group=harness({items:[item(NO,['m1'])],fromRows:rows});
  await group.send(body(msgs,{room_key:'-12345'}));
  assert.equal(group.of(OPEN_ASKS_PEER_FN).length,0,'단체방');
  const noMine=harness({items:[item(NO,['m1'])],fromRows:rows});
  await noMine.send(body([{ref:'2001',at:'2026-10-24T02:00:00Z',sender:'A',text:'자료요'}]));
  assert.equal(noMine.of(OPEN_ASKS_PEER_FN).length,0,'내 메시지 없음');
  const missing=harness({items:[item(NO,['m1'])]});
  const r=await missing.send(body(msgs));
  assert.equal(r.status,200);assert.equal(missing.of(OPEN_ASKS_PEER_FN).length,1);
  assert.doesNotMatch(missing.calls.logs.join('\n'),/telegram_auto_done_failed/);
});
