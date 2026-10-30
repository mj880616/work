import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// TG-발언자이름 소급(설계 telegram-sender-names.md 3.3절 방법 나): collector-feed ?action=telegram_senders와
// 앱 스크립트 tgFeed_backfillSenders의 순수 함수. 지어낸 Supabase(PostgREST)로 실제 handler를 돌린다. 네트워크 없음.
// 이름·키·방은 모두 지어낸 값이다.
const {createCollectorFeedHandler,parseSendersBody,SENDERS_FN,SENDERS_BACKFILL_DAILY}=await import('../../supabase/functions/collector-feed/handler.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-30T03:00:00Z');
const TODAY='2026-10-30';
const SECRET='synthetic-collector-feed-secret-0123456789';
const KEY_A='0123456789abcdef0123456789abcdef',KEY_B='fedcba9876543210fedcba9876543210';
const NAME_A='가상김철수',NAME_B='가상이영희';

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({rpc=()=>respond({ok:true,people:2,linked:1,conflicts:1}),ws=JSON.stringify(WS),env={}}={}){
  const calls={rpc:[],other:[],logs:[],openai:0,feature:[]};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input));
    if(url.origin!==SB){calls.openai++;throw new Error('외부 호출 없음');}
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace'){calls.feature.push(JSON.parse(init.body));return respond(ws);}
    if(path===`rpc/${SENDERS_FN}`){const a=JSON.parse(init.body);calls.rpc.push(a);return rpc(a);}
    calls.other.push(`${init.method||'GET'} ${path}`);
    return respond([]);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-key',COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key',...env})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=(body,{secret=SECRET,action='telegram_senders'}={})=>handler(new Request(`${FN}?action=${action}`,{method:'POST',
    headers:{'Content-Type':'application/json',...(secret?{'x-collector-feed-secret':secret}:{})},body:JSON.stringify(body)}));
  return {send,calls};
}
const senders2=()=>[{label:'A',key:KEY_A,name:NAME_A,self:true},{label:'B',key:KEY_B,name:NAME_B,self:false}];
const body=(o={})=>({day:'2026-10-20',room_key:'-100123',senders:senders2(),...o});
const leaks=(text)=>[NAME_A,NAME_B,KEY_A,KEY_B].some(v=>text.includes(v));

test('정상: 이름표 함수 하나만 부르고(작업공간은 서버 허용 표의 telegram), 소식·하루 숫자·방 표·AI는 건드리지 않는다',async()=>{
  const h=harness();const r=await h.send(body());
  assert.equal(r.status,200);
  const out=await r.json();
  assert.deepEqual(out,{ok:true,people:2,linked:1,conflicts:1,name_dropped:0});
  assert.deepEqual(h.calls.feature,[{p_feature:'telegram'}]);
  assert.deepEqual(h.calls.rpc,[{p_workspace:WS,p_room_key:'-100123',p_day:'2026-10-20',p_senders:senders2()}]);
  assert.deepEqual(h.calls.other,[],'app_feed_items·app_feed_days·방 함수 등 다른 경로 없음');
  assert.equal(h.calls.openai,0);
  assert.ok(!leaks(JSON.stringify(out))&&!leaks(h.calls.logs.join('\n')),'응답·로그에 이름·키 없음');
  assert.match(h.calls.logs.join('\n'),/telegram_senders_backfill_saved.*"sent":2,"people":2,"linked":1,"conflicts":1/);
});

test('형식: key 없는 사람·빈 목록·41명·틀린 라벨/키/self·추가 칸·미래·너무 오래된 날짜는 400이고 DB에 가지 않는다',async()=>{
  const many=Array.from({length:41},(_,i)=>({label:String.fromCharCode(65+(i%26))+(i>=26?'A':''),key:KEY_A}));
  const bad=[
    body({senders:[{label:'A',name:NAME_A}]}),
    body({senders:[]}),
    body({senders:many}),
    body({senders:[{label:'a',key:KEY_A}]}),
    body({senders:[{label:'A',key:'xyz'}]}),
    body({senders:[{label:'A',key:KEY_A,self:'yes'}]}),
    body({senders:[{label:'A',key:KEY_A},{label:'A',key:KEY_B}]}),
    body({senders:[{label:'A',key:KEY_A,number:'01012345678'}]}),
    body({messages:[]}),
    body({workspace_id:WS}),
    body({day:'2026-10-31'}),
    body({day:'2026-07-01'}),
    body({room_key:'방 이름'}),
    {day:'2026-10-20',room_key:'-100123'},
  ];
  for(const b of bad){
    const h=harness();const r=await h.send(b);
    assert.equal(r.status,400,JSON.stringify(b).slice(0,80));
    assert.equal((await r.json()).error,'INVALID_BODY');
    assert.equal(h.calls.rpc.length+h.calls.feature.length,0);
  }
});

test('전화번호·@아이디 모양 이름은 이름만 버리고 보낸다(건수만 응답)',async()=>{
  const h=harness();
  const r=await h.send(body({senders:[{label:'A',key:KEY_A,name:'010-1234-5678'},{label:'B',key:KEY_B,name:'@fakeuser'}]}));
  assert.equal(r.status,200);
  assert.equal((await r.json()).name_dropped,2);
  assert.deepEqual(h.calls.rpc[0].p_senders,[{label:'A',key:KEY_A},{label:'B',key:KEY_B}]);
});

test('권한: 비밀값 없음·틀림이면 401, 허용된 작업공간이 없으면 503(DB 함수 안 부름)',async()=>{
  for(const secret of ['', 'wrong-secret-wrong-secret-wrong-secret-00']){
    const h=harness();const r=await h.send(body(),{secret});
    assert.equal(r.status,401);assert.equal(h.calls.rpc.length+h.calls.feature.length,0);
  }
  const h=harness({ws:'null'});const r=await h.send(body());
  assert.equal(r.status,503);assert.equal((await r.json()).error,'WORKSPACE_UNAVAILABLE');assert.equal(h.calls.rpc.length,0);
});

test('DB 함수가 없거나 실패하면 503(앱 스크립트가 멈추고 다음에 이어 함). 오류 원문은 응답·로그에 없다',async()=>{
  let h=harness({rpc:()=>respond({message:'nf'},404)});
  let r=await h.send(body());
  assert.equal(r.status,503);assert.equal((await r.json()).error,'DB_UNAVAILABLE');
  h=harness({rpc:()=>respond({message:`TG_SENDER_NAME ${NAME_A}`},400)});
  r=await h.send(body());
  assert.equal(r.status,503);
  const text=JSON.stringify(await r.json())+h.calls.logs.join('\n');
  assert.ok(!leaks(text));
  assert.match(h.calls.logs.join('\n'),/telegram_senders_backfill_failed.*"stage":"TG_SENDER_NAME"/);
});

test(`하루 상한: telegram 묶음 상한과 따로 ${SENDERS_BACKFILL_DAILY}회를 넘으면 429`,async()=>{
  const h=harness();
  for(let i=0;i<SENDERS_BACKFILL_DAILY;i++) assert.equal((await h.send(body())).status,200);
  const r=await h.send(body());
  assert.equal(r.status,429);assert.equal((await r.json()).error,'DAILY_LIMIT');
  assert.equal(h.calls.rpc.length,SENDERS_BACKFILL_DAILY);
  assert.deepEqual(h.calls.other,[],'app_feed_days(batch_count)는 세지 않는다');
});

test('소스: 소급 입구는 표를 직접 쓰지 않고 이름표 함수만 부른다',()=>{
  const src=readFileSync(new URL('../../supabase/functions/collector-feed/handler.ts',import.meta.url),'utf8');
  const fn=src.slice(src.indexOf('async function runTelegramSenders'),src.indexOf('// 방 정보·하루 요약 저장'));
  assert.ok(fn.length>200);
  assert.ok(!/db\.(insert|patch|get)\(|addDay|claimBatch|callOpenAi|ROOM_/.test(fn));
  assert.equal([...fn.matchAll(/rpcObject\(/g)].length,1);
  assert.ok(!/log\([^)]*(senders\)|name|key)/.test(fn.replace(/telegram_senders_backfill_\w+|name_dropped/g,'')),'로그에 이름·키 없음');
});

// ---- 앱 스크립트 순수 함수 ----

const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const sandbox={module:{exports:{}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
const G=sandbox.module.exports;
const plain=(o)=>JSON.parse(JSON.stringify(o));

test('날짜 범위: 기본 14일 전 ~ 어제(오늘 제외), 틀린 값은 14',()=>{
  assert.deepEqual(plain(G.tgFeedSendersBackRange(TODAY,null)),{from:'2026-10-16',to:'2026-10-29'});
  assert.deepEqual(plain(G.tgFeedSendersBackRange(TODAY,'3')),{from:'2026-10-27',to:'2026-10-29'});
  for(const v of ['0','-1','1.5','abc','61']) assert.equal(G.tgFeedSendersBackRange(TODAY,v).from,'2026-10-16',v);
});

test('진행 위치: 방은 key 순서, 같은 방은 마지막 날 다음부터, 끝나면 없음. 틀린 상태 글은 처음부터',()=>{
  const bs=G.tgFeedSendersBackClean(JSON.stringify({from:'2026-10-27',to:'2026-10-29',room:'-200',day:'2026-10-27',fetch:{d:TODAY,n:12}}));
  assert.deepEqual(plain(G.tgFeedSendersBackDays(bs,'-100')),[],'앞선 방은 끝남');
  assert.deepEqual(plain(G.tgFeedSendersBackDays(bs,'-200')),['2026-10-28','2026-10-29']);
  assert.deepEqual(plain(G.tgFeedSendersBackDays(bs,'-300')),['2026-10-27','2026-10-28','2026-10-29']);
  assert.equal(bs.fetch.n,12);
  assert.deepEqual(plain(G.tgFeedSendersBackDays({...plain(bs),end:true},'-300')),[]);
  for(const raw of ['', '{', 'null', JSON.stringify({from:'2026-10-29',to:'2026-10-27'}), JSON.stringify({from:'x',to:'y'})]){
    const c=G.tgFeedSendersBackClean(raw);
    assert.equal(c.from,'');assert.equal(c.end,false);assert.deepEqual(plain(G.tgFeedSendersBackDays(c,'-1')),[]);
  }
  assert.equal(G.tgFeedSendersBackClean(JSON.stringify({from:'2026-10-27',to:'2026-10-29',room:'방 이름'})).room,'');
});

test('평소와 같은 라벨 규칙으로 만든 이름표가 key 있는 사람만 남고, 몸통은 서버 parseSendersBody에서 그대로 읽힌다',()=>{
  const msgs=[
    {message_id:5,date_utc:'2026-10-20T01:00:00Z',sender_id:'9002',sender_name:NAME_B,sender_is_self:false,text:'가상 안건'},
    {message_id:6,date_utc:'2026-10-20T01:01:00Z',sender_id:'9001',sender_name:NAME_A,sender_is_self:true,text:'네'},
    {message_id:7,date_utc:'2026-10-20T01:02:00Z',text:'번호 없는 사람'},
    {message_id:8,date_utc:'2026-10-20T01:03:00Z',sender_id:'9002',text:'첨부만',service_action:'pin'},
  ].map(m=>G.tgFeedParseMessage(m));
  const grouped=G.tgFeedGroupDay(msgs,'2026-10-20');
  const labels=G.tgFeedAssignSenders(grouped.messages).map(m=>m.sender);
  assert.deepEqual(plain(labels),['A','B','C']);
  const keyFn=(n)=>n==='9001'?KEY_A:KEY_B;
  const list=G.tgFeedSendersBackList(G.tgFeedBuildSenders(grouped.messages,keyFn));
  assert.deepEqual(plain(list),[{label:'A',key:KEY_B,name:NAME_B,self:false},{label:'B',key:KEY_A,name:NAME_A,self:true}],'번호 없는 C는 뺀다');
  const parsed=parseSendersBody(plain(G.tgFeedSendersBackBody('2026-10-20','-100123',list)),TODAY);
  assert.deepEqual(parsed.senders,plain(list));
  assert.deepEqual(plain(G.tgFeedSendersBackList(Array.from({length:45},(_,i)=>({label:'A'+i,key:KEY_A})))).length,40);
});

test('앱 스크립트 소스: 소급은 telegram_senders로만 보내고, 시험 모드면 보내지 않고 진행 위치도 적지 않으며, 로그에 이름·key가 없다',()=>{
  const fn=source.slice(source.indexOf('function tgFeed_backfillSenders()'),source.indexOf('function tgFeed_backfillSendersReset'));
  assert.ok(fn.length>2000);
  assert.ok(fn.includes("tgFeed_postAction_('telegram_senders'"));
  assert.ok(!/tgFeed_post_\(|tgFeedBuildBody|tgFeed_saveState_|TG_FEED_STATE_KEY|TG_FEED_REWIND/.test(fn),'소식 보내기·진행 기록을 쓰지 않는다');
  assert.match(fn,/if \(test\) \{ t\.roomDays\+\+; t\.people \+= senders\.length; \}\s*else \{/,'시험 모드는 세기만');
  for(const m of fn.matchAll(/setProperty\(TG_FEED_SENDERS_BACK_STATE_KEY/g)){
    const before=fn.slice(Math.max(0,m.index-80),m.index);
    assert.match(before,/!test/,'시험 모드에서는 진행 위치를 적지 않는다');
  }
  assert.match(fn,/LockService\.getScriptLock\(\)/,'매시 보내기와 같은 잠금');
  for(const m of fn.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\)/g)) assert.ok(!/senderName|senderId|senders\b|SENDER_KEY|\.name\b|\.key\b|room\.label/.test(m[1]),m[0]);
  assert.match(source,/function tgFeed_readDays_\(run, entry, days, firstVisit, allowShrink, narrow, untilMs\)/);
});
