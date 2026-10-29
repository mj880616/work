import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// TG-발언자이름 2단계: collector-feed telegram 입구의 선택 칸 `senders`.
// 지어낸 Supabase(PostgREST)와 지어낸 OpenAI로 실제 handler를 돌린다. 네트워크 없음. 이름·키·방은 모두 지어낸 값이다.
const {createCollectorFeedHandler,parseTelegramBody,SENDERS_FN,NAMES_FN,ROOM_TOUCH_FN,ROOM_DAY_ADD_FN}=await import('../../supabase/functions/collector-feed/handler.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-24T03:00:00Z');
const TODAY='2026-10-24';
const SECRET='synthetic-collector-feed-secret-0123456789';
const SERVICE='synthetic-service-role-key';
const KEY_A='0123456789abcdef0123456789abcdef',KEY_B='fedcba9876543210fedcba9876543210';
const NAME_A='가상김철수',NAME_B='가상이영희';
const DAY_COLS=['total_count','kept_count','room_count','personal_count','unsure_count','failed_count','batch_count','ai_requests','ai_input_tokens','ai_output_tokens'];

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const aiOk=()=>respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items:[{title:'교섭 일정',summary:'가상 교섭이 미뤄졌다.',refs:['m1','m2'],organization:null,project:null}]})}]}],usage:{input_tokens:100,output_tokens:50}});

function harness({dayRows=[],dayStatus=200,dup=false,rpc=()=>respond({ok:true,people:2,linked:2,conflicts:0}),ai=aiOk}={}){
  const calls={openai:[],rpc:[],items:[],logs:[],tables:[]};
  const days=[];
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin==='https://api.openai.com'){calls.openai.push(init.body);return ai();}
    assert.equal(url.origin,SB);
    const path=url.pathname.replace('/rest/v1/','');
    if(path.startsWith('rpc/')){
      const fn=path.slice(4);
      // 방 정보·하루 요약 함수(TG-방날짜묶기)는 별도 시험(collector-feed-tg-roomday)에서 본다. 여기서는 이름표 함수 호출만 센다.
      if(fn===ROOM_TOUCH_FN||fn===ROOM_DAY_ADD_FN)return respond({ok:true});
      if(fn===NAMES_FN){calls.tables.push('names '+JSON.stringify(JSON.parse(init.body)));return dayStatus===200?respond(dayRows):dayStatus===404?respond({message:'nf'},404):respond('boom',dayStatus);}
      assert.equal(fn,SENDERS_FN,'다른 DB 함수는 부르지 않는다');
      const args=JSON.parse(init.body);calls.rpc.push(args);return rpc(args);
    }
    calls.tables.push(`${method} ${path}`);
    if(path==='app_workspaces')return respond([{id:WS}]);
    if(path==='app_suborganizations'||path==='app_spaces')return respond([]);
    if(path==='app_feed_items'){
      if(method==='GET')return respond(dup?[{source_ref:'tg:x:1'}]:[]);
      const row=JSON.parse(init.body);calls.items.push(row);return new Response(null,{status:201});
    }
    if(path==='app_feed_days'){
      if(method==='GET')return respond(days.filter(()=>true));
      if(method==='POST'){days.push(JSON.parse(init.body));return new Response(null,{status:201});}
      return respond([{day:TODAY}]);
    }
    throw new Error('unexpected '+method+' '+path);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=(body)=>handler(new Request(`${FN}?action=telegram`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET},body:JSON.stringify(body)}));
  return {send,calls};
}
const body=(o={})=>({day:TODAY,room_key:'room-fake-1',room_label:'가상 업무방',total:3,messages:[
  {ref:'1001',at:'2026-10-24T00:10:00Z',sender:'A',text:'가상지부 교섭이 다음 주 화요일로 미뤄졌습니다'},
  {ref:'1002',at:'2026-10-24T00:12:00Z',sender:'B',text:'장소는 그대로인가요?',reply_to:'1001'},
  {ref:'1003',at:'2026-10-24T00:20:00Z',sender:'A',text:'네 그대로입니다'}],...o});
const senders2=()=>[{label:'A',key:KEY_A,name:NAME_A,self:true},{label:'B',key:KEY_B,name:NAME_B,self:false}];

test('senders가 없으면 지금과 똑같다: DB 함수를 부르지 않고 소식은 저장된다',async()=>{
  const h=harness();const r=await h.send(body());
  assert.equal(r.status,200);assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.items.length,1);
  assert.ok(!h.calls.logs.some(l=>/senders/.test(l)));
});

test('senders가 있으면 형식 검사 뒤 app_tg_senders_upsert를 한 번 부르고(작업공간은 서버가 정함) 소식도 저장한다',async()=>{
  const h=harness();const r=await h.send(body({senders:senders2()}));
  assert.equal(r.status,200);assert.equal(h.calls.items.length,1);
  assert.equal(h.calls.rpc.length,1);
  assert.deepEqual(h.calls.rpc[0],{p_workspace:WS,p_room_key:'room-fake-1',p_day:TODAY,p_senders:senders2()});
  assert.match(h.calls.logs.join('\n'),/telegram_senders_saved/);
  assert.match(h.calls.logs.find(l=>/telegram_senders_saved/.test(l)),/"people":2,"linked":2,"conflicts":0/);
});

test('이름은 AI 입력에만 들어가고(요청 senders 이름), 번호·key는 AI 입력·저장 줄·응답·로그 어디에도 없다. 이름은 저장 줄·응답·로그에도 없다',async()=>{
  const h=harness();const r=await h.send(body({senders:senders2()}));
  const text=await r.text();
  assert.equal(h.calls.openai.length,1);
  const ai=JSON.parse(h.calls.openai[0]).input[1].content;
  assert.match(ai,new RegExp(`m1 \\d\\d:\\d\\d 나: `),'self=true인 A는 "나"');
  assert.match(ai,new RegExp(`m2 \\d\\d:\\d\\d ${NAME_B} \\(m1에 답\\): `));
  assert.ok(!/\d\d:\d\d [AB]\b/.test(ai),'라벨이 이름으로 바뀌었다');
  for(const secret of [KEY_A,KEY_B])assert.ok(!h.calls.openai[0].includes(secret),'AI 입력에 key 없음');
  for(const secret of [NAME_A,NAME_B,KEY_A,KEY_B]){
    assert.ok(!JSON.stringify(h.calls.items).includes(secret),'저장 줄');
    assert.ok(!text.includes(secret),'응답');
    assert.ok(!h.calls.logs.join('\n').includes(secret),'로그');
  }
  assert.match(h.calls.items[0].raw_text,/\bA: /,'원문 줄은 라벨 그대로');
});

test('AI 표시 이름 우선순위: 이름표 손 이름 → 나 → 요청 이름 → 라벨. 번호·@아이디는 AI에 없다',async()=>{
  const dayRows=[
    {label:'A',name:'가상손이름',is_self:false},
    {label:'B',name:null,is_self:true},
    {label:'C',name:null,is_self:false},
    {label:'Z',name:'가상없는라벨',is_self:false},
  ];
  const msgs=['A','B','C','D'].map((l,i)=>({ref:String(2000+i),at:'2026-10-24T00:1'+i+':00Z',sender:l,text:'가상 글 '+i}));
  const h=harness({dayRows});
  const r=await h.send(body({total:4,messages:msgs,senders:[{label:'A',key:KEY_A,name:'요청이름A'},{label:'C',key:KEY_B,name:'요청이름C'}]}));
  assert.equal(r.status,200);
  const ai=JSON.parse(h.calls.openai[0]).input[1].content;
  assert.match(ai,/m1 \d\d:\d\d 가상손이름: /);
  assert.match(ai,/m2 \d\d:\d\d 나: /);
  assert.match(ai,/m3 \d\d:\d\d 요청이름C: /);
  assert.match(ai,/m4 \d\d:\d\d D: /);
  assert.ok(!ai.includes('요청이름A'),'손 이름이 요청 이름을 이긴다');
  assert.ok(!ai.includes(KEY_A)&&!ai.includes(KEY_B));
  assert.ok(!h.calls.logs.join('\n').includes('가상손이름')&&!h.calls.logs.join('\n').includes('요청이름C'));
  assert.ok(!ai.includes('가상없는라벨'));
  assert.ok(h.calls.tables.includes(`names ${JSON.stringify({p_workspace:WS,p_room_key:'room-fake-1',p_day:TODAY})}`),'읽기 함수 인자: 작업공간은 서버 값');
});

test('이름표 조회가 실패하면 요청 이름·라벨로 물러나고 소식 저장은 계속한다. 같은 이름 둘은 (라벨)로 구분한다',async()=>{
  for(const dayStatus of [401,403,404,500]){
    const h=harness({dayStatus});const r=await h.send(body({senders:[{label:'A',key:KEY_A,name:NAME_A}]}));
    assert.equal(r.status,200);assert.equal(h.calls.items.length,1);
    const ai=JSON.parse(h.calls.openai[0]).input[1].content;
    assert.match(ai,new RegExp(`m1 \\d\\d:\\d\\d ${NAME_A}: `));assert.match(ai,/m2 \d\d:\d\d B \(m1에 답\): /);
    assert.match(h.calls.logs.join('\n'),/telegram_sender_names_failed.*(READ|FN_MISSING)/);
    assert.ok(!h.calls.logs.join('\n').includes(NAME_A));
  }
  const h=harness();await h.send(body({senders:[{label:'A',key:KEY_A,name:'가상동명'},{label:'B',key:KEY_B,name:'가상동명'}]}));
  const ai=JSON.parse(h.calls.openai[0]).input[1].content;
  assert.match(ai,/가상동명\(A\): /);assert.match(ai,/가상동명\(B\) \(m1에 답\): /);
});

test('DB 함수가 실패(오류 코드·없음·네트워크·깨진 응답)해도 소식 저장은 계속되고 로그에는 단계 코드만 남는다',async()=>{
  const cases=[
    [()=>respond({code:'P0001',message:`TG_SENDER_NAME ${NAME_A}`,details:KEY_A},400),'TG_SENDER_NAME'],
    [()=>respond({message:'not found'},404),'FN_MISSING'],
    [()=>respond('boom',500),'DB_STATUS_500'],
    [()=>respond([1,2]),'DB_BAD_RESPONSE'],
    [()=>{throw new Error('net '+NAME_A);},'DB_UNAVAILABLE'],
  ];
  for(const [rpc,code] of cases){
    const h=harness({rpc});const r=await h.send(body({senders:senders2()}));
    assert.equal(r.status,200,code);assert.equal(h.calls.items.length,1,code);
    const logs=h.calls.logs.join('\n');
    assert.match(logs,new RegExp(`telegram_senders_failed.*${code}`));
    for(const secret of [NAME_A,NAME_B,KEY_A,KEY_B])assert.ok(!logs.includes(secret),code);
  }
});

test('형식이 틀린 senders는 통째로 버리고(DB 함수 호출 없음) 소식 저장은 계속, 로그는 코드 하나',async()=>{
  const bad=[
    'A',{},
    Array.from({length:41},(_,i)=>({label:String.fromCharCode(65+i%26)+(i>=26?'A':'')})),
    [{label:'a',key:KEY_A}],[{label:'AAAA'}],[{label:'A',key:'XYZ'}],[{label:'A',key:'0123456789ABCDEF0123456789ABCDEF'}],
    [{label:'A',key:'0123456789abcde'}],[{label:'A',key:KEY_A+'0'}],
    [{label:'A',name:'가'.repeat(41)}],[{label:'A',name:'줄\n바꿈'}],[{label:'A',name:'탭\t'}],[{label:'A',name:'   '}],[{label:'A',name:7}],
    [{label:'A',self:'yes'}],[{label:'A',extra:1}],[{label:'A'},{label:'A'}],[null],['A'],
    [{label:'A',key:KEY_A,workspace_id:WS}],
  ];
  for(const senders of bad){
    const h=harness();const r=await h.send(body({senders}));
    assert.equal(r.status,200,JSON.stringify(senders).slice(0,60));
    assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.items.length,1);
    assert.match(h.calls.logs.join('\n'),/telegram_senders_dropped.*INVALID/);
    assert.ok(!h.calls.logs.join('\n').includes('가'.repeat(41)));
  }
  // 경계값은 통과: 이름 40자, 키 16자, 40명
  const h=harness();
  await h.send(body({senders:[{label:'A',key:'0123456789abcdef',name:'가'.repeat(40)}]}));
  assert.equal(h.calls.rpc.length,1);
});

test('전화번호·@아이디 모양의 이름은 이름만 버리고 키는 보낸다',async()=>{
  for(const name of ['@gildong','+82 10-1234-5678','010-1234-5678']){
    const h=harness();const r=await h.send(body({senders:[{label:'A',key:KEY_A,name}]}));
    assert.equal(r.status,200);
    assert.deepEqual(h.calls.rpc[0].p_senders,[{label:'A',key:KEY_A}]);
    assert.ok(!h.calls.logs.join('\n').includes(name));
    assert.match(h.calls.logs.join('\n'),/telegram_senders_name_dropped/);
  }
  const h=harness();await h.send(body({senders:[{label:'A',name:'김 대리 (가상)'}]}));
  assert.deepEqual(h.calls.rpc[0].p_senders,[{label:'A',name:'김 대리 (가상)'}]);
});

test('이 묶음 메시지에 없는 라벨은 건너뛴다(묶음이 나뉘어도 같은 목록을 보냄). 남는 라벨이 없으면 DB 함수를 부르지 않는다',async()=>{
  let h=harness();await h.send(body({senders:[...senders2(),{label:'C',key:'aaaaaaaaaaaaaaaa'}]}));
  assert.deepEqual(h.calls.rpc[0].p_senders.map(s=>s.label),['A','B']);
  assert.match(h.calls.logs.join('\n'),/"skipped":1/);
  h=harness();await h.send(body({senders:[{label:'C',key:'aaaaaaaaaaaaaaaa'}]}));
  assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.items.length,1);
  h=harness();const r=await h.send(body({messages:[],total:2,senders:senders2()}));
  assert.equal(r.status,200);assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.openai.length,0);
});

test('같은 묶음이 다시 와도(AI·소식 저장은 건너뜀) 이름표는 다시 보낸다. AI가 실패해도 이름표는 시도하고 오류는 그대로 돌려준다',async()=>{
  let h=harness({dup:true});const r=await h.send(body({senders:senders2()}));
  assert.equal(r.status,200);assert.equal((await r.json()).duplicate,true);
  assert.equal(h.calls.rpc.length,1);assert.equal(h.calls.openai.length,0);assert.equal(h.calls.items.length,0);
  h=harness({ai:()=>respond({error:'x'},500)});const f=await h.send(body({senders:senders2()}));
  assert.ok(f.status>=500);assert.equal(h.calls.rpc.length,1);assert.equal(h.calls.items.length,0);
});

test('안전한 입구 규칙은 그대로: senders 칸이 있어도 알 수 없는 칸·workspace 칸은 400',async()=>{
  for(const extra of [{workspace_id:WS},{sender_names:{}},{owner:'x'}]){
    const h=harness();const r=await h.send(body({senders:senders2(),...extra}));
    assert.equal(r.status,400);assert.equal(h.calls.rpc.length,0);assert.equal(h.calls.items.length,0);
  }
});

test('parseTelegramBody: senders 결과 모양',()=>{
  const ok=parseTelegramBody(body({senders:senders2()}),TODAY);
  assert.equal(ok.sendersInvalid,false);assert.deepEqual(ok.senders,senders2());
  const none=parseTelegramBody(body(),TODAY);
  assert.deepEqual(none.senders,[]);assert.equal(none.sendersInvalid,false);
  assert.equal(parseTelegramBody(body({senders:[{label:'A',key:'zz'}]}),TODAY).sendersInvalid,true);
});

test('소스: 번호 원문 칸·로그에 이름을 쓰는 코드·DB 표 직접 쓰기가 없다(함수 한 개만 부른다)',()=>{
  const src=readFileSync('supabase/functions/collector-feed/handler.ts','utf8');
  assert.equal([...src.matchAll(/rpcObject\(/g)].length,5,'정의 1 + 사용 4(이름표·방 정보·하루 요약·나한테 온 요청 후보)');
  assert.equal([...src.matchAll(/rpcObject\((\w+),/g)].map(m=>m[1]).filter(n=>n!=='fn').sort().join(),'ASK_CANDIDATE_FN,ROOM_DAY_ADD_FN,ROOM_TOUCH_FN,SENDERS_FN','쓰는 DB 함수는 이 넷뿐(이름 읽기는 rpc로 별도, 후보는 FEAT-1029 ⑤)');
  const code=src.replace(/\/\/.*$/gm,'');
  assert.ok(!/app_tg_senders['"`?]|app_tg_day_senders/.test(code),'표를 직접 읽거나 쓰지 않는다');
  assert.equal([...code.matchAll(/db\.rpc\(NAMES_FN/g)].length,1,'읽기 전용 함수 호출 한 곳(AI 표시 이름)');
  assert.ok(!/sender_id|phone|telegram_user/.test(src.replace(/\/\/.*$/gm,'')),'번호 원문 칸 없음');
  assert.ok(/telegramMaterial\([^)]*, names, earlier\.items, self, input\.chat_kind\)/.test(src),'AI 재료에는 표시 이름 목록(names)만 넘긴다(key·번호 없음). 뒤의 earlier.items는 앞서 모인 소식(TG-1시간수집), self는 나 라벨·chat_kind는 방 종류(FEAT-1029 ⑤)');
  assert.ok(!/log\([^)]*names/.test(code.replace(/telegram_sender_names_failed/g,'')),'로그에 이름 없음');
});
